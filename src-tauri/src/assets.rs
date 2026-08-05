use super::{content_root, is_windows_reserved, ApiResult, ContentApiError};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

const ASSET_DIRECTORY_NAME: &str = ".assets";
const MAX_IMAGE_BYTES: usize = 16 * 1024 * 1024;
const MAX_BASE64_CHARS: usize = MAX_IMAGE_BYTES.div_ceil(3) * 4;
const MAX_IMAGE_DIMENSION: u32 = 16_384;
const MAX_IMAGE_PIXELS: u64 = 64 * 1024 * 1024;
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ImageFormat {
    extension: &'static str,
    media_type: &'static str,
    width: u32,
    height: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredImageAsset {
    path: String,
    media_type: &'static str,
    byte_length: usize,
    sha256: String,
    deduplicated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImageAssetTransfer {
    path: String,
    media_type: &'static str,
    byte_length: usize,
    sha256: String,
    data_base64: String,
}

struct DiskImageAsset {
    path: String,
    format: ImageFormat,
    sha256: String,
    bytes: Vec<u8>,
}

fn invalid_image(message: impl Into<String>) -> ContentApiError {
    ContentApiError::new("invalid_image", message)
}

fn validate_dimensions(width: u32, height: u32) -> ApiResult<()> {
    if width == 0
        || height == 0
        || width > MAX_IMAGE_DIMENSION
        || height > MAX_IMAGE_DIMENSION
        || u64::from(width) * u64::from(height) > MAX_IMAGE_PIXELS
    {
        return Err(invalid_image(
            "The image dimensions are invalid or unreasonably large.",
        ));
    }
    Ok(())
}

fn read_be_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_be_bytes(
        bytes.get(offset..offset + 4)?.try_into().ok()?,
    ))
}

fn read_le_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(
        bytes.get(offset..offset + 4)?.try_into().ok()?,
    ))
}

fn read_be_u16(bytes: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_be_bytes(
        bytes.get(offset..offset + 2)?.try_into().ok()?,
    ))
}

fn read_le_u16(bytes: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_le_bytes(
        bytes.get(offset..offset + 2)?.try_into().ok()?,
    ))
}

fn inspect_png(bytes: &[u8]) -> ApiResult<Option<ImageFormat>> {
    const SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
    if bytes.len() < 33 || bytes.get(..8) != Some(SIGNATURE) {
        return Ok(None);
    }
    let mut offset = 8usize;
    let mut dimensions = None;
    while offset.checked_add(12).is_some_and(|end| end <= bytes.len()) {
        let length = read_be_u32(bytes, offset)
            .ok_or_else(|| invalid_image("The PNG contains a truncated chunk."))?
            as usize;
        let chunk_end = offset
            .checked_add(12)
            .and_then(|value| value.checked_add(length))
            .filter(|end| *end <= bytes.len())
            .ok_or_else(|| invalid_image("The PNG contains a truncated chunk."))?;
        let chunk_type = bytes
            .get(offset + 4..offset + 8)
            .ok_or_else(|| invalid_image("The PNG contains a truncated chunk."))?;
        if dimensions.is_none() {
            if chunk_type != b"IHDR" || length != 13 {
                return Err(invalid_image(
                    "The PNG does not begin with a valid IHDR chunk.",
                ));
            }
            let width = read_be_u32(bytes, offset + 8)
                .ok_or_else(|| invalid_image("The PNG IHDR is truncated."))?;
            let height = read_be_u32(bytes, offset + 12)
                .ok_or_else(|| invalid_image("The PNG IHDR is truncated."))?;
            validate_dimensions(width, height)?;
            dimensions = Some((width, height));
        }
        if chunk_type == b"IEND" {
            if length != 0 || chunk_end != bytes.len() {
                return Err(invalid_image("The PNG must end exactly at its IEND chunk."));
            }
            let (width, height) = dimensions.expect("IHDR checked before IEND");
            return Ok(Some(ImageFormat {
                extension: "png",
                media_type: "image/png",
                width,
                height,
            }));
        }
        offset = chunk_end;
    }
    Err(invalid_image("The PNG is missing its final IEND chunk."))
}

fn jpeg_start_of_frame(marker: u8) -> bool {
    matches!(
        marker,
        0xc0 | 0xc1 | 0xc2 | 0xc3 | 0xc5 | 0xc6 | 0xc7 | 0xc9 | 0xca | 0xcb | 0xcd | 0xce | 0xcf
    )
}

fn inspect_jpeg(bytes: &[u8]) -> ApiResult<Option<ImageFormat>> {
    if bytes.len() < 4 || bytes.get(..2) != Some(&[0xff, 0xd8]) {
        return Ok(None);
    }
    if bytes.get(bytes.len() - 2..) != Some(&[0xff, 0xd9]) {
        return Err(invalid_image(
            "The JPEG must end exactly at its EOI marker.",
        ));
    }
    let mut offset = 2usize;
    let mut dimensions = None;
    while offset + 1 < bytes.len() {
        if bytes[offset] != 0xff {
            return Err(invalid_image("The JPEG marker stream is malformed."));
        }
        while bytes.get(offset) == Some(&0xff) {
            offset += 1;
        }
        let marker = *bytes
            .get(offset)
            .ok_or_else(|| invalid_image("The JPEG marker stream is malformed."))?;
        offset += 1;
        if marker == 0x00 {
            return Err(invalid_image("The JPEG marker stream is malformed."));
        }
        if marker == 0xd9 || marker == 0xda {
            break;
        }
        if marker == 0x01 || (0xd0..=0xd8).contains(&marker) {
            continue;
        }
        let length = usize::from(
            read_be_u16(bytes, offset)
                .ok_or_else(|| invalid_image("The JPEG contains a truncated segment."))?,
        );
        let end = offset
            .checked_add(length)
            .filter(|end| length >= 2 && *end <= bytes.len())
            .ok_or_else(|| invalid_image("The JPEG contains an invalid segment length."))?;
        if jpeg_start_of_frame(marker) {
            if length < 7 {
                return Err(invalid_image("The JPEG frame header is truncated."));
            }
            let height = u32::from(
                read_be_u16(bytes, offset + 3)
                    .ok_or_else(|| invalid_image("The JPEG frame header is truncated."))?,
            );
            let width = u32::from(
                read_be_u16(bytes, offset + 5)
                    .ok_or_else(|| invalid_image("The JPEG frame header is truncated."))?,
            );
            validate_dimensions(width, height)?;
            dimensions = Some((width, height));
        }
        offset = end;
    }
    let (width, height) = dimensions
        .ok_or_else(|| invalid_image("The JPEG does not contain a supported frame header."))?;
    Ok(Some(ImageFormat {
        extension: "jpg",
        media_type: "image/jpeg",
        width,
        height,
    }))
}

fn consume_gif_sub_blocks(bytes: &[u8], offset: &mut usize) -> ApiResult<()> {
    while *offset < bytes.len() {
        let length = usize::from(bytes[*offset]);
        *offset += 1;
        if length == 0 {
            return Ok(());
        }
        *offset = offset
            .checked_add(length)
            .filter(|end| *end <= bytes.len())
            .ok_or_else(|| invalid_image("The GIF contains a truncated data block."))?;
    }
    Err(invalid_image(
        "The GIF contains an unterminated data block.",
    ))
}

fn inspect_gif(bytes: &[u8]) -> ApiResult<Option<ImageFormat>> {
    if bytes.len() < 14 || !matches!(bytes.get(..6), Some(b"GIF87a" | b"GIF89a")) {
        return Ok(None);
    }
    let width = u32::from(read_le_u16(bytes, 6).expect("GIF header length checked"));
    let height = u32::from(read_le_u16(bytes, 8).expect("GIF header length checked"));
    validate_dimensions(width, height)?;
    let global_table_bytes = if bytes[10] & 0x80 != 0 {
        3usize * (1usize << (usize::from(bytes[10] & 0x07) + 1))
    } else {
        0
    };
    let mut offset = 13usize
        .checked_add(global_table_bytes)
        .ok_or_else(|| invalid_image("The GIF colour table is invalid."))?;
    let mut saw_image = false;
    while offset < bytes.len() {
        let block = bytes[offset];
        offset += 1;
        if block == 0x3b {
            if !saw_image || offset != bytes.len() {
                return Err(invalid_image(
                    "The GIF must contain an image and end exactly at its trailer.",
                ));
            }
            return Ok(Some(ImageFormat {
                extension: "gif",
                media_type: "image/gif",
                width,
                height,
            }));
        }
        if block == 0x21 {
            if offset >= bytes.len() {
                return Err(invalid_image("The GIF extension is truncated."));
            }
            offset += 1;
            consume_gif_sub_blocks(bytes, &mut offset)?;
            continue;
        }
        if block != 0x2c || offset + 9 > bytes.len() {
            return Err(invalid_image("The GIF block stream is malformed."));
        }
        let frame_width = u32::from(
            read_le_u16(bytes, offset + 4)
                .ok_or_else(|| invalid_image("The GIF image descriptor is truncated."))?,
        );
        let frame_height = u32::from(
            read_le_u16(bytes, offset + 6)
                .ok_or_else(|| invalid_image("The GIF image descriptor is truncated."))?,
        );
        validate_dimensions(frame_width, frame_height)?;
        let descriptor_packed = bytes[offset + 8];
        offset += 9;
        if descriptor_packed & 0x80 != 0 {
            offset = offset
                .checked_add(3usize * (1usize << (usize::from(descriptor_packed & 0x07) + 1)))
                .ok_or_else(|| invalid_image("The GIF local colour table is invalid."))?;
        }
        if offset >= bytes.len() {
            return Err(invalid_image("The GIF image descriptor is truncated."));
        }
        offset += 1;
        consume_gif_sub_blocks(bytes, &mut offset)?;
        saw_image = true;
    }
    Err(invalid_image("The GIF is missing its final trailer."))
}

fn read_le_u24(bytes: &[u8], offset: usize) -> Option<u32> {
    let value = bytes.get(offset..offset + 3)?;
    Some(u32::from(value[0]) | (u32::from(value[1]) << 8) | (u32::from(value[2]) << 16))
}

fn inspect_webp(bytes: &[u8]) -> ApiResult<Option<ImageFormat>> {
    if bytes.len() < 26 || bytes.get(..4) != Some(b"RIFF") || bytes.get(8..12) != Some(b"WEBP") {
        return Ok(None);
    }
    let declared_length = usize::try_from(read_le_u32(bytes, 4).unwrap_or_default())
        .map_err(|_| invalid_image("The WebP RIFF length is invalid."))?;
    if declared_length.checked_add(8) != Some(bytes.len()) {
        return Err(invalid_image(
            "The WebP RIFF length does not match the file.",
        ));
    }
    let chunk_length = usize::try_from(read_le_u32(bytes, 16).unwrap_or_default())
        .map_err(|_| invalid_image("The WebP image chunk is invalid."))?;
    let padded_length = chunk_length
        .checked_add(chunk_length & 1)
        .and_then(|value| value.checked_add(20))
        .filter(|end| *end <= bytes.len())
        .ok_or_else(|| invalid_image("The WebP image chunk is truncated."))?;
    let _ = padded_length;

    let (width, height) = match bytes.get(12..16) {
        Some(b"VP8X") => {
            if chunk_length < 10 {
                return Err(invalid_image("The WebP VP8X header is truncated."));
            }
            (
                1 + read_le_u24(bytes, 24)
                    .ok_or_else(|| invalid_image("The WebP VP8X header is truncated."))?,
                1 + read_le_u24(bytes, 27)
                    .ok_or_else(|| invalid_image("The WebP VP8X header is truncated."))?,
            )
        }
        Some(b"VP8L") => {
            if chunk_length < 5 || bytes.get(20) != Some(&0x2f) {
                return Err(invalid_image("The WebP lossless header is invalid."));
            }
            let b1 = u32::from(bytes[21]);
            let b2 = u32::from(bytes[22]);
            let b3 = u32::from(bytes[23]);
            let b4 = u32::from(bytes[24]);
            (
                1 + b1 + ((b2 & 0x3f) << 8),
                1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10),
            )
        }
        Some(b"VP8 ") => {
            if chunk_length < 10 || bytes.get(23..26) != Some(&[0x9d, 0x01, 0x2a]) {
                return Err(invalid_image("The WebP lossy frame header is invalid."));
            }
            (
                u32::from(read_le_u16(bytes, 26).expect("VP8 length checked") & 0x3fff),
                u32::from(read_le_u16(bytes, 28).expect("VP8 length checked") & 0x3fff),
            )
        }
        _ => {
            return Err(invalid_image(
                "The WebP uses an unsupported primary image chunk.",
            ))
        }
    };
    validate_dimensions(width, height)?;
    Ok(Some(ImageFormat {
        extension: "webp",
        media_type: "image/webp",
        width,
        height,
    }))
}

fn inspect_image(bytes: &[u8]) -> ApiResult<ImageFormat> {
    if bytes.is_empty() || bytes.len() > MAX_IMAGE_BYTES {
        return Err(invalid_image(
            "Images must contain data and be no larger than 16 MiB.",
        ));
    }
    if let Some(format) = inspect_png(bytes)? {
        return Ok(format);
    }
    if let Some(format) = inspect_jpeg(bytes)? {
        return Ok(format);
    }
    if let Some(format) = inspect_gif(bytes)? {
        return Ok(format);
    }
    if let Some(format) = inspect_webp(bytes)? {
        return Ok(format);
    }
    Err(invalid_image(
        "Only structurally valid PNG, JPEG, GIF, and WebP images are supported.",
    ))
}

fn validate_original_name(name: &str) -> ApiResult<()> {
    if name.is_empty()
        || name.len() > 255
        || matches!(name, "." | "..")
        || name.starts_with('.')
        || name.ends_with(['.', ' '])
        || name.contains(['/', '\\', '\0'])
        || name
            .chars()
            .any(|character| character.is_control() || "<>:\"|?*".contains(character))
        || is_windows_reserved(name)
    {
        return Err(ContentApiError::new(
            "invalid_path",
            "The original image filename is invalid.",
        ));
    }
    Ok(())
}

fn validate_asset_path(relative_path: &str) -> ApiResult<(&str, &str)> {
    if relative_path.len() > 80 || relative_path.contains(['\\', '\0']) {
        return Err(ContentApiError::new(
            "invalid_path",
            "The image path is invalid.",
        ));
    }
    let filename = relative_path
        .strip_prefix(".assets/")
        .filter(|filename| !filename.contains('/'))
        .ok_or_else(|| ContentApiError::new("invalid_path", "The image path is invalid."))?;
    let (hash, extension) = filename
        .rsplit_once('.')
        .ok_or_else(|| ContentApiError::new("invalid_path", "The image path is invalid."))?;
    if hash.len() != 64
        || !hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
        || !matches!(extension, "png" | "jpg" | "gif" | "webp")
    {
        return Err(ContentApiError::new(
            "invalid_path",
            "The image path is invalid.",
        ));
    }
    Ok((hash, extension))
}

fn hash_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut hash = String::with_capacity(64);
    for byte in digest {
        hash.push_str(&format!("{byte:02x}"));
    }
    hash
}

fn asset_root_for(configured_root: &Path) -> ApiResult<PathBuf> {
    fs::create_dir_all(configured_root).map_err(ContentApiError::io)?;
    let root_metadata = fs::symlink_metadata(configured_root).map_err(ContentApiError::io)?;
    if root_metadata.file_type().is_symlink() || !root_metadata.is_dir() {
        return Err(ContentApiError::new(
            "invalid_path",
            "The content root must be a real directory.",
        ));
    }
    let root = configured_root
        .canonicalize()
        .map_err(ContentApiError::io)?;
    let assets = root.join(ASSET_DIRECTORY_NAME);
    match fs::create_dir(&assets) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(ContentApiError::io(error)),
    }
    let metadata = fs::symlink_metadata(&assets).map_err(ContentApiError::io)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(ContentApiError::new(
            "invalid_path",
            "The image library must be a real directory.",
        ));
    }
    let resolved = assets.canonicalize().map_err(ContentApiError::io)?;
    if resolved.parent() != Some(root.as_path()) {
        return Err(ContentApiError::new(
            "invalid_path",
            "The image library leaves the content directory.",
        ));
    }
    Ok(resolved)
}

fn read_existing(
    assets_root: &Path,
    relative_path: &str,
    expected_hash: &str,
    expected_extension: &str,
    missing_allowed: bool,
) -> ApiResult<Option<DiskImageAsset>> {
    let filename = Path::new(relative_path)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| ContentApiError::new("invalid_path", "The image path is invalid."))?;
    let absolute_path = assets_root.join(filename);
    let metadata = match fs::symlink_metadata(&absolute_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && missing_allowed => {
            return Ok(None)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(ContentApiError::new(
                "not_found",
                "The image does not exist.",
            ))
        }
        Err(error) => return Err(ContentApiError::io(error)),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(ContentApiError::new(
            "invalid_path",
            "Image assets must be ordinary files.",
        ));
    }
    if metadata.len() > MAX_IMAGE_BYTES as u64 {
        return Err(invalid_image("The stored image is larger than 16 MiB."));
    }
    let bytes = fs::read(absolute_path).map_err(ContentApiError::io)?;
    let format = inspect_image(&bytes)?;
    let hash = hash_hex(&bytes);
    if hash != expected_hash || format.extension != expected_extension {
        return Err(ContentApiError::new(
            "conflict",
            "The stored image does not match its canonical path.",
        ));
    }
    Ok(Some(DiskImageAsset {
        path: relative_path.to_string(),
        format,
        sha256: format!("sha256-{hash}"),
        bytes,
    }))
}

fn temporary_path(assets_root: &Path, hash: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let counter = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    assets_root.join(format!(
        ".{hash}.{}.{}.{counter}.tmp",
        std::process::id(),
        nanos
    ))
}

fn store_image_at(
    configured_root: &Path,
    name: &str,
    declared_media_type: Option<&str>,
    bytes: &[u8],
) -> ApiResult<StoredImageAsset> {
    validate_original_name(name)?;
    let format = inspect_image(bytes)?;
    if declared_media_type
        .filter(|media_type| !media_type.is_empty())
        .is_some_and(|media_type| !media_type.eq_ignore_ascii_case(format.media_type))
    {
        return Err(invalid_image(
            "The declared media type does not match the image bytes.",
        ));
    }
    let hash = hash_hex(bytes);
    let relative_path = format!("{ASSET_DIRECTORY_NAME}/{hash}.{}", format.extension);
    let assets_root = asset_root_for(configured_root)?;
    if let Some(existing) =
        read_existing(&assets_root, &relative_path, &hash, format.extension, true)?
    {
        return Ok(StoredImageAsset {
            path: existing.path,
            media_type: existing.format.media_type,
            byte_length: existing.bytes.len(),
            sha256: existing.sha256,
            deduplicated: true,
        });
    }

    let target = assets_root.join(format!("{hash}.{}", format.extension));
    let temporary = temporary_path(&assets_root, &hash);
    let publish = (|| -> ApiResult<bool> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(ContentApiError::io)?;
        file.write_all(bytes).map_err(ContentApiError::io)?;
        file.sync_all().map_err(ContentApiError::io)?;
        drop(file);
        match fs::hard_link(&temporary, &target) {
            Ok(()) => Ok(false),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let existing =
                    read_existing(&assets_root, &relative_path, &hash, format.extension, false)?
                        .expect("missing_allowed is false");
                if existing.bytes != bytes {
                    return Err(ContentApiError::new(
                        "conflict",
                        "The canonical image path is already occupied.",
                    ));
                }
                Ok(true)
            }
            Err(error) => Err(ContentApiError::io(error)),
        }
    })();
    let _ = fs::remove_file(&temporary);
    let deduplicated = publish?;
    Ok(StoredImageAsset {
        path: relative_path,
        media_type: format.media_type,
        byte_length: bytes.len(),
        sha256: format!("sha256-{hash}"),
        deduplicated,
    })
}

fn read_image_at(configured_root: &Path, relative_path: &str) -> ApiResult<DiskImageAsset> {
    let (hash, extension) = validate_asset_path(relative_path)?;
    let assets_root = asset_root_for(configured_root)?;
    read_existing(&assets_root, relative_path, hash, extension, false)?
        .ok_or_else(|| ContentApiError::new("not_found", "The image does not exist."))
}

fn decode_base64(data_base64: &str) -> ApiResult<Vec<u8>> {
    if data_base64.is_empty()
        || data_base64.len() % 4 != 0
        || data_base64.len() > MAX_BASE64_CHARS
        || !data_base64
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'='))
    {
        return Err(invalid_image("The image data is not valid base64."));
    }
    let bytes = BASE64
        .decode(data_base64)
        .map_err(|_| invalid_image("The image data is not valid base64."))?;
    if BASE64.encode(&bytes) != data_base64 {
        return Err(invalid_image("The image data is not canonical base64."));
    }
    Ok(bytes)
}

#[tauri::command(rename_all = "camelCase")]
pub(crate) fn write_content_asset(
    name: String,
    media_type: Option<String>,
    data_base64: String,
) -> ApiResult<StoredImageAsset> {
    let bytes = decode_base64(&data_base64)?;
    store_image_at(&content_root()?, &name, media_type.as_deref(), &bytes)
}

#[tauri::command]
pub(crate) fn read_content_asset(path: String) -> ApiResult<ImageAssetTransfer> {
    let asset = read_image_at(&content_root()?, &path)?;
    Ok(ImageAssetTransfer {
        path: asset.path,
        media_type: asset.format.media_type,
        byte_length: asset.bytes.len(),
        sha256: asset.sha256,
        data_base64: BASE64.encode(asset.bytes),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG_BASE64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const GIF_BASE64: &str = "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

    fn test_root() -> PathBuf {
        let suffix = temporary_path(Path::new(""), "asset-test")
            .file_name()
            .expect("temporary name")
            .to_owned();
        std::env::temp_dir().join(suffix)
    }

    #[test]
    fn validates_structure_and_rejects_active_content() {
        let png = BASE64.decode(PNG_BASE64).expect("valid fixture");
        assert_eq!(
            inspect_image(&png).expect("valid PNG"),
            ImageFormat {
                extension: "png",
                media_type: "image/png",
                width: 1,
                height: 1,
            }
        );
        assert!(inspect_image(b"<svg><script>alert(1)</script></svg>").is_err());
        assert!(inspect_image(&png[..png.len() - 1]).is_err());
        let gif = BASE64.decode(GIF_BASE64).expect("valid fixture");
        assert_eq!(
            inspect_image(&gif).expect("valid GIF"),
            ImageFormat {
                extension: "gif",
                media_type: "image/gif",
                width: 1,
                height: 1,
            }
        );
        assert!(inspect_image(&gif[..gif.len() - 2]).is_err());
    }

    #[test]
    fn stores_deduplicates_and_reads_only_canonical_paths() {
        let root = test_root();
        fs::create_dir(&root).expect("create test root");
        let png = BASE64.decode(PNG_BASE64).expect("valid fixture");
        let first =
            store_image_at(&root, "diagram.png", Some("image/png"), &png).expect("first store");
        let second = store_image_at(&root, "renamed.png", None, &png).expect("deduplicated store");
        assert!(!first.deduplicated);
        assert!(second.deduplicated);
        assert_eq!(first.path, second.path);
        assert_eq!(read_image_at(&root, &first.path).expect("read").bytes, png);
        for path in [
            "../outside.png",
            ".assets/../outside.png",
            ".assets\\bad.png",
            ".assets/not-a-hash.png",
        ] {
            assert!(read_image_at(&root, path).is_err(), "accepted {path}");
        }
        fs::remove_dir_all(root).expect("clean test root");
    }

    #[test]
    fn rejects_mismatched_media_type_and_path_like_name_without_writing() {
        let root = test_root();
        fs::create_dir(&root).expect("create test root");
        let png = BASE64.decode(PNG_BASE64).expect("valid fixture");
        assert!(store_image_at(&root, "diagram.jpg", Some("image/jpeg"), &png).is_err());
        assert!(store_image_at(&root, "../diagram.png", Some("image/png"), &png).is_err());
        assert!(!root.join(ASSET_DIRECTORY_NAME).exists());
        fs::remove_dir_all(root).expect("clean test root");
    }
}
