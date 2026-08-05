use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

mod assets;
mod desktop_surface;

const MAX_MARKDOWN_BYTES: usize = 2 * 1024 * 1024;
const MAX_FRONTMATTER_SCAN_BYTES: u64 = 64 * 1024;
const MAX_RELATIVE_PATH_LENGTH: usize = 1_024;
const MAX_ALIAS_LENGTH: usize = 512;
const MAX_ALIASES: usize = 128;
const TRASH_DIRECTORY_NAME: &str = ".trash";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ContentApiError {
    code: &'static str,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    current_revision: Option<String>,
}

type ApiResult<T> = Result<T, ContentApiError>;

impl ContentApiError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            current_revision: None,
        }
    }

    fn conflict(message: impl Into<String>, current_revision: Option<String>) -> Self {
        Self {
            code: "conflict",
            message: message.into(),
            current_revision,
        }
    }

    fn io(error: std::io::Error) -> Self {
        Self::new("io_error", error.to_string())
    }
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum ContentTreeEntry {
    Directory {
        name: String,
        path: String,
        children: Vec<ContentTreeEntry>,
    },
    File {
        name: String,
        path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<String>,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        aliases: Vec<String>,
    },
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ContentDocument {
    path: String,
    markdown: String,
    revision: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    aliases: Vec<String>,
}

#[derive(Clone, Copy, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum ContentEntryKind {
    Directory,
    File,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ContentMutationResult {
    path: String,
    #[serde(rename = "type")]
    kind: ContentEntryKind,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeletedContentReceipt {
    token: String,
    deleted_at: String,
    original_path: String,
    path: String,
    #[serde(rename = "type")]
    kind: ContentEntryKind,
}

struct MarkdownParts<'a> {
    prefix: &'a str,
    body: &'a str,
    line_ending: &'static str,
}

struct DiskContentFile {
    document: ContentDocument,
    prefix: String,
    line_ending: &'static str,
}

#[derive(Default)]
struct FrontmatterMetadata {
    id: Option<String>,
    aliases: Vec<String>,
}

fn invalid_path(message: impl Into<String>) -> ContentApiError {
    ContentApiError::new("invalid_path", message)
}

fn is_windows_reserved(segment: &str) -> bool {
    let stem = segment
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    matches!(stem.as_str(), "con" | "prn" | "aux" | "nul")
        || stem
            .strip_prefix("com")
            .or_else(|| stem.strip_prefix("lpt"))
            .is_some_and(|suffix| suffix.len() == 1 && matches!(suffix.as_bytes()[0], b'1'..=b'9'))
}

fn validate_entry_path(
    relative_path: &str,
    kind: Option<ContentEntryKind>,
) -> ApiResult<Vec<&str>> {
    if relative_path.is_empty()
        || relative_path.len() > MAX_RELATIVE_PATH_LENGTH
        || relative_path.contains('\0')
        || relative_path.contains('\\')
        || relative_path.starts_with('/')
        || relative_path.starts_with("//")
        || relative_path.as_bytes().get(1) == Some(&b':')
        || Path::new(relative_path).is_absolute()
    {
        return Err(invalid_path("The note path is invalid."));
    }

    let segments: Vec<&str> = relative_path.split('/').collect();
    if segments.iter().any(|segment| {
        segment.is_empty()
            || *segment == "."
            || *segment == ".."
            || segment.starts_with('.')
            || segment.ends_with(' ')
            || segment.ends_with('.')
            || is_windows_reserved(segment)
            || segment
                .chars()
                .any(|character| character.is_control() || "<>:\"|?*".contains(character))
    }) {
        return Err(invalid_path("The note path is invalid."));
    }

    let leaf_is_markdown = segments
        .last()
        .is_some_and(|name| name.to_ascii_lowercase().ends_with(".md"));
    if kind == Some(ContentEntryKind::File) && !leaf_is_markdown {
        return Err(invalid_path(
            "Only Markdown files inside the content folder can be edited.",
        ));
    }
    if kind == Some(ContentEntryKind::Directory) && leaf_is_markdown {
        return Err(invalid_path("Folder names cannot end in .md."));
    }
    Ok(segments)
}

#[cfg(test)]
fn validate_content_path(relative_path: &str) -> ApiResult<Vec<&str>> {
    validate_entry_path(relative_path, Some(ContentEntryKind::File))
}

fn content_root() -> ApiResult<PathBuf> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace = manifest_dir
        .parent()
        .ok_or_else(|| invalid_path("The project workspace could not be resolved."))?;
    let configured_root = workspace.join("content");
    fs::create_dir_all(&configured_root).map_err(ContentApiError::io)?;
    let metadata = fs::symlink_metadata(&configured_root).map_err(ContentApiError::io)?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(invalid_path(
            "The configured content root must be a real directory.",
        ));
    }
    configured_root.canonicalize().map_err(ContentApiError::io)
}

fn resolve_content_path(relative_path: &str, leaf_may_be_missing: bool) -> ApiResult<PathBuf> {
    resolve_entry_path(
        relative_path,
        leaf_may_be_missing,
        Some(ContentEntryKind::File),
    )
}

fn resolve_entry_path(
    relative_path: &str,
    leaf_may_be_missing: bool,
    kind: Option<ContentEntryKind>,
) -> ApiResult<PathBuf> {
    let segments = validate_entry_path(relative_path, kind)?;
    let root = content_root()?;
    let mut candidate = root.clone();

    for (index, segment) in segments.iter().enumerate() {
        candidate.push(segment);
        let is_leaf = index == segments.len() - 1;
        match fs::symlink_metadata(&candidate) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() {
                    return Err(invalid_path(
                        "Links and junctions are not allowed inside the content tree.",
                    ));
                }
                if !is_leaf && !metadata.is_dir() {
                    return Err(invalid_path("A parent path is not a directory."));
                }
            }
            Err(error)
                if error.kind() == std::io::ErrorKind::NotFound
                    && is_leaf
                    && leaf_may_be_missing =>
            {
                break
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Err(ContentApiError::new(
                    "not_found",
                    "The note does not exist.",
                ))
            }
            Err(error) => return Err(ContentApiError::io(error)),
        }
    }

    if candidate.strip_prefix(&root).is_err() {
        return Err(invalid_path("The note path leaves the content directory."));
    }
    Ok(candidate)
}

fn revision_for(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut revision = String::with_capacity(7 + digest.len() * 2);
    revision.push_str("sha256-");
    for byte in digest {
        revision.push_str(&format!("{byte:02x}"));
    }
    revision
}

fn line_ending_of(markdown: &str) -> &'static str {
    if markdown.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

fn split_markdown_file(markdown: &str) -> MarkdownParts<'_> {
    let bom_length = if markdown.starts_with('\u{feff}') {
        3
    } else {
        0
    };
    let content = &markdown[bom_length..];
    let line_ending = if content.starts_with("---\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let opening = format!("---{line_ending}");
    if !content.starts_with(&opening) {
        return MarkdownParts {
            prefix: &markdown[..bom_length],
            body: &markdown[bom_length..],
            line_ending: line_ending_of(markdown),
        };
    }

    let mut line_start = bom_length + opening.len();
    while line_start <= markdown.len() {
        let next_newline = markdown[line_start..]
            .find('\n')
            .map(|offset| line_start + offset);
        let line_end = next_newline.unwrap_or(markdown.len());
        let line = markdown[line_start..line_end].trim_end_matches('\r');
        if line == "---" || line == "..." {
            let mut prefix_end = next_newline.map_or(markdown.len(), |index| index + 1);
            while prefix_end < markdown.len() {
                let blank_end = markdown[prefix_end..]
                    .find('\n')
                    .map_or(markdown.len(), |offset| prefix_end + offset);
                let candidate = markdown[prefix_end..blank_end].trim_end_matches('\r');
                if !candidate.trim().is_empty() {
                    break;
                }
                prefix_end = if blank_end == markdown.len() {
                    markdown.len()
                } else {
                    blank_end + 1
                };
            }
            return MarkdownParts {
                prefix: &markdown[..prefix_end],
                body: &markdown[prefix_end..],
                line_ending,
            };
        }
        let Some(index) = next_newline else { break };
        line_start = index + 1;
    }

    MarkdownParts {
        prefix: &markdown[..bom_length],
        body: &markdown[bom_length..],
        line_ending: line_ending_of(markdown),
    }
}

fn stable_id_from_prefix(prefix: &str) -> Option<String> {
    let content = prefix.strip_prefix('\u{feff}').unwrap_or(prefix);
    let mut lines = content.lines();
    if lines.next()? != "---" {
        return None;
    }

    for line in lines {
        if line == "---" || line == "..." {
            break;
        }
        let Some(value) = line.strip_prefix("id:") else {
            continue;
        };
        let value = value.trim();
        let unquoted = if value.len() >= 2
            && ((value.starts_with('"') && value.ends_with('"'))
                || (value.starts_with('\'') && value.ends_with('\'')))
        {
            &value[1..value.len() - 1]
        } else {
            value.split(" #").next().unwrap_or(value).trim()
        };
        let valid = unquoted.len() <= 128
            && unquoted
                .chars()
                .next()
                .is_some_and(|character| character.is_ascii_alphanumeric())
            && unquoted
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || "._:-".contains(character));
        return valid.then(|| unquoted.to_string());
    }
    None
}

fn frontmatter_lines(prefix: &str) -> Option<Vec<&str>> {
    let content = prefix.strip_prefix('\u{feff}').unwrap_or(prefix);
    let mut lines = content.lines();
    if lines.next()? != "---" {
        return None;
    }

    let mut yaml = Vec::new();
    for line in lines {
        if line == "---" || line == "..." {
            return Some(yaml);
        }
        yaml.push(line);
    }
    None
}

/// Removes a YAML comment without treating a hash inside quotes as a comment.
fn without_yaml_comment(value: &str) -> &str {
    let mut characters = value.char_indices().peekable();
    let mut quote: Option<char> = None;
    let mut escaped = false;
    let mut previous: Option<char> = None;

    while let Some((index, character)) = characters.next() {
        match quote {
            Some('"') => {
                if escaped {
                    escaped = false;
                } else if character == '\\' {
                    escaped = true;
                } else if character == '"' {
                    quote = None;
                }
            }
            Some('\'') => {
                if character == '\'' {
                    if characters.peek().is_some_and(|(_, next)| *next == '\'') {
                        characters.next();
                    } else {
                        quote = None;
                    }
                }
            }
            Some(_) => unreachable!(),
            None if character == '\'' || character == '"' => quote = Some(character),
            None if character == '#'
                && previous.is_none_or(|value| value == ' ' || value == '\t') =>
            {
                return &value[..index]
            }
            None => {}
        }
        previous = Some(character);
    }
    value
}

fn valid_alias(value: &str) -> bool {
    !value.is_empty()
        && value.chars().count() <= MAX_ALIAS_LENGTH
        && !value.chars().any(char::is_control)
}

fn yaml_alias_scalar(raw_value: &str) -> Option<String> {
    let value = without_yaml_comment(raw_value).trim();
    if value.is_empty() || value == "~" || value.eq_ignore_ascii_case("null") {
        return None;
    }

    let parsed = if value.starts_with('\'') {
        if value.len() < 2 || !value.ends_with('\'') {
            return None;
        }
        value[1..value.len() - 1].replace("''", "'")
    } else if value.starts_with('"') {
        if value.len() < 2 || !value.ends_with('"') {
            return None;
        }
        serde_json::from_str::<String>(value).ok()?
    } else {
        if value.starts_with(['[', '{'])
            || value.ends_with([']', '}'])
            || value == "|"
            || value == ">"
        {
            return None;
        }
        value.to_string()
    };
    let alias = parsed.trim();
    valid_alias(alias).then(|| alias.to_string())
}

fn split_inline_yaml_list(value: &str) -> Option<Vec<String>> {
    let source = without_yaml_comment(value).trim();
    if !source.starts_with('[') || !source.ends_with(']') {
        return None;
    }
    let body = &source[1..source.len() - 1];
    if body.trim().is_empty() {
        return Some(Vec::new());
    }

    let mut items = Vec::new();
    let mut start = 0;
    let mut quote: Option<char> = None;
    let mut escaped = false;
    let mut characters = body.char_indices().peekable();
    while let Some((index, character)) = characters.next() {
        match quote {
            Some('"') => {
                if escaped {
                    escaped = false;
                } else if character == '\\' {
                    escaped = true;
                } else if character == '"' {
                    quote = None;
                }
            }
            Some('\'') => {
                if character == '\'' {
                    if characters.peek().is_some_and(|(_, next)| *next == '\'') {
                        characters.next();
                    } else {
                        quote = None;
                    }
                }
            }
            Some(_) => unreachable!(),
            None if character == '\'' || character == '"' => quote = Some(character),
            None if character == ',' => {
                items.push(body[start..index].to_string());
                start = index + character.len_utf8();
            }
            None if matches!(character, '[' | ']' | '{') => return None,
            None => {}
        }
    }
    if quote.is_some() {
        return None;
    }
    items.push(body[start..].to_string());
    Some(items)
}

/// Reads top-level Obsidian `alias`/`aliases` scalar, inline-list and block-list
/// forms. Invalid entries are ignored and duplicates are removed in source order.
fn aliases_from_prefix(prefix: &str) -> Vec<String> {
    let Some(lines) = frontmatter_lines(prefix) else {
        return Vec::new();
    };
    let mut aliases = Vec::new();
    let mut seen = HashSet::new();
    let add = |candidate: Option<String>, aliases: &mut Vec<String>, seen: &mut HashSet<String>| {
        let Some(alias) = candidate else { return };
        if aliases.len() >= MAX_ALIASES || !seen.insert(alias.to_lowercase()) {
            return;
        }
        aliases.push(alias);
    };

    let mut index = 0;
    while index < lines.len() {
        let line = lines[index];
        if line.starts_with([' ', '\t']) {
            index += 1;
            continue;
        }
        let Some((raw_key, raw_value)) = line.split_once(':') else {
            index += 1;
            continue;
        };
        let key = raw_key.trim_end();
        if !key.eq_ignore_ascii_case("alias") && !key.eq_ignore_ascii_case("aliases") {
            index += 1;
            continue;
        }

        if !without_yaml_comment(raw_value).trim().is_empty() {
            if let Some(items) = split_inline_yaml_list(raw_value) {
                for item in items {
                    add(yaml_alias_scalar(&item), &mut aliases, &mut seen);
                }
            } else {
                add(yaml_alias_scalar(raw_value), &mut aliases, &mut seen);
            }
            index += 1;
            continue;
        }

        let mut cursor = index + 1;
        while cursor < lines.len() {
            let candidate = lines[cursor];
            if candidate.trim().is_empty() || candidate.trim_start().starts_with('#') {
                cursor += 1;
                continue;
            }
            let trimmed = candidate.trim_start_matches([' ', '\t']);
            if trimmed.len() == candidate.len() {
                break;
            }
            let Some(item) = trimmed.strip_prefix('-') else {
                break;
            };
            if !item.is_empty() && !item.starts_with([' ', '\t']) {
                break;
            }
            add(
                yaml_alias_scalar(item.trim_start()),
                &mut aliases,
                &mut seen,
            );
            index = cursor;
            cursor += 1;
        }
        index += 1;
    }
    aliases
}

fn frontmatter_metadata(prefix: &str) -> FrontmatterMetadata {
    FrontmatterMetadata {
        id: stable_id_from_prefix(prefix),
        aliases: aliases_from_prefix(prefix),
    }
}

fn normalise_line_endings(markdown: &str, line_ending: &str) -> String {
    let normalised = markdown.replace("\r\n", "\n").replace('\r', "\n");
    if line_ending == "\r\n" {
        normalised.replace('\n', "\r\n")
    } else {
        normalised
    }
}

fn read_file_state(
    relative_path: &str,
    missing_allowed: bool,
) -> ApiResult<Option<DiskContentFile>> {
    let absolute_path = resolve_content_path(relative_path, missing_allowed)?;
    let bytes = match fs::read(&absolute_path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && missing_allowed => {
            return Ok(None)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(ContentApiError::new(
                "not_found",
                "The note does not exist.",
            ))
        }
        Err(error) => return Err(ContentApiError::io(error)),
    };
    if bytes.len() > MAX_MARKDOWN_BYTES {
        return Err(ContentApiError::new(
            "invalid_markdown",
            "The Markdown file is larger than 2 MiB.",
        ));
    }
    let markdown = String::from_utf8(bytes.clone()).map_err(|_| {
        ContentApiError::new("invalid_markdown", "The Markdown file is not valid UTF-8.")
    })?;
    if markdown.contains('\0') {
        return Err(ContentApiError::new(
            "invalid_markdown",
            "Markdown cannot contain null characters.",
        ));
    }
    let parts = split_markdown_file(&markdown);
    let frontmatter = frontmatter_metadata(parts.prefix);
    Ok(Some(DiskContentFile {
        document: ContentDocument {
            path: relative_path.to_string(),
            markdown: parts.body.to_string(),
            revision: revision_for(&bytes),
            id: frontmatter.id,
            aliases: frontmatter.aliases,
        },
        prefix: parts.prefix.to_string(),
        line_ending: parts.line_ending,
    }))
}

fn read_frontmatter_metadata(absolute_path: &Path) -> FrontmatterMetadata {
    let mut bytes = Vec::new();
    let Some(file) = File::open(absolute_path).ok() else {
        return FrontmatterMetadata::default();
    };
    if file
        .take(MAX_FRONTMATTER_SCAN_BYTES)
        .read_to_end(&mut bytes)
        .is_err()
    {
        return FrontmatterMetadata::default();
    }
    let markdown = String::from_utf8_lossy(&bytes);
    let parts = split_markdown_file(&markdown);
    frontmatter_metadata(parts.prefix)
}

fn relative_path(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}/{name}")
    }
}

fn list_directory(
    directory: &Path,
    relative_directory: &str,
    depth: usize,
) -> ApiResult<Vec<ContentTreeEntry>> {
    if depth > 64 {
        return Err(invalid_path("The content tree is nested too deeply."));
    }
    let mut entries = fs::read_dir(directory)
        .map_err(ContentApiError::io)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(ContentApiError::io)?;
    entries.sort_by(|left, right| {
        let left_directory = left.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
        let right_directory = right.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
        right_directory.cmp(&left_directory).then_with(|| {
            left.file_name()
                .to_string_lossy()
                .to_ascii_lowercase()
                .cmp(&right.file_name().to_string_lossy().to_ascii_lowercase())
        })
    });

    let mut tree = Vec::new();
    for entry in entries {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let metadata = fs::symlink_metadata(entry.path()).map_err(ContentApiError::io)?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        let entry_relative_path = relative_path(relative_directory, &name);
        if metadata.is_dir() {
            tree.push(ContentTreeEntry::Directory {
                name,
                path: entry_relative_path.clone(),
                children: list_directory(&entry.path(), &entry_relative_path, depth + 1)?,
            });
        } else if metadata.is_file() && name.to_ascii_lowercase().ends_with(".md") {
            let frontmatter = read_frontmatter_metadata(&entry.path());
            tree.push(ContentTreeEntry::File {
                name,
                path: entry_relative_path,
                id: frontmatter.id,
                aliases: frontmatter.aliases,
            });
        }
    }
    Ok(tree)
}

fn assert_expected_revision(
    current_revision: Option<&str>,
    expected_revision: Option<&str>,
) -> ApiResult<()> {
    if current_revision == expected_revision {
        return Ok(());
    }
    Err(ContentApiError::conflict(
        if current_revision.is_some() {
            "The note changed on disk. Reload it before saving your edits."
        } else {
            "The note was removed or moved before it could be saved."
        },
        current_revision.map(str::to_string),
    ))
}

#[cfg(windows)]
fn replace_file_atomically(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::{iter, os::windows::ffi::OsStrExt};
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    let source: Vec<u16> = source
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect();
    let succeeded = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if succeeded == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file_atomically(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination)
}

fn content_entry_kind(path: &Path) -> ApiResult<ContentEntryKind> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            ContentApiError::new("not_found", "The item does not exist.")
        } else {
            ContentApiError::io(error)
        }
    })?;
    if metadata.file_type().is_symlink() {
        return Err(invalid_path(
            "Links and junctions are not allowed inside the content tree.",
        ));
    }
    if metadata.is_dir() {
        Ok(ContentEntryKind::Directory)
    } else if metadata.is_file() {
        Ok(ContentEntryKind::File)
    } else {
        Err(invalid_path("Only notes and folders can be changed."))
    }
}

fn content_path_exists(path: &Path) -> ApiResult<bool> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(ContentApiError::io(error)),
    }
}

fn content_trash_root() -> ApiResult<PathBuf> {
    let trash = content_root()?.join(TRASH_DIRECTORY_NAME);
    match fs::symlink_metadata(&trash) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            Err(invalid_path("The content trash must be a real directory."))
        }
        Ok(_) => Ok(trash),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(&trash).map_err(ContentApiError::io)?;
            Ok(trash)
        }
        Err(error) => Err(ContentApiError::io(error)),
    }
}

fn new_trash_token() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{:x}-{nanos:x}", std::process::id())
}

fn valid_trash_token(token: &str) -> bool {
    !token.is_empty()
        && token.len() <= 96
        && token
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
}

#[tauri::command]
fn list_content_tree() -> ApiResult<Vec<ContentTreeEntry>> {
    let root = content_root()?;
    list_directory(&root, "", 0)
}

#[tauri::command]
fn read_content_file(path: String) -> ApiResult<ContentDocument> {
    read_file_state(&path, false)?
        .ok_or_else(|| ContentApiError::new("not_found", "The note does not exist."))
        .map(|file| file.document)
}

#[tauri::command(rename_all = "camelCase")]
fn write_content_file(
    path: String,
    markdown: String,
    expected_revision: Option<String>,
) -> ApiResult<ContentDocument> {
    if markdown.contains('\0') || markdown.len() > MAX_MARKDOWN_BYTES {
        return Err(ContentApiError::new(
            "invalid_markdown",
            "Markdown must be UTF-8 text smaller than 2 MiB without null characters.",
        ));
    }
    let absolute_path = resolve_content_path(&path, true)?;
    let current = read_file_state(&path, true)?;
    assert_expected_revision(
        current.as_ref().map(|file| file.document.revision.as_str()),
        expected_revision.as_deref(),
    )?;

    let saved_body = current
        .as_ref()
        .map(|file| normalise_line_endings(&markdown, file.line_ending))
        .unwrap_or(markdown);
    let saved_markdown = format!(
        "{}{}",
        current
            .as_ref()
            .map(|file| file.prefix.as_str())
            .unwrap_or(""),
        saved_body
    );
    if saved_markdown.len() > MAX_MARKDOWN_BYTES {
        return Err(ContentApiError::new(
            "invalid_markdown",
            "The complete Markdown file cannot be larger than 2 MiB.",
        ));
    }

    let file_name = absolute_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| invalid_path("The note filename is invalid."))?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary_path =
        absolute_path.with_file_name(format!(".{file_name}.{}.{}.tmp", std::process::id(), nonce));

    let save_result = (|| -> ApiResult<()> {
        let mut temporary_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)
            .map_err(ContentApiError::io)?;
        temporary_file
            .write_all(saved_markdown.as_bytes())
            .map_err(ContentApiError::io)?;
        temporary_file.sync_all().map_err(ContentApiError::io)?;
        drop(temporary_file);

        let latest = read_file_state(&path, true)?;
        assert_expected_revision(
            latest.as_ref().map(|file| file.document.revision.as_str()),
            expected_revision.as_deref(),
        )?;
        replace_file_atomically(&temporary_path, &absolute_path).map_err(ContentApiError::io)
    })();
    let _ = fs::remove_file(&temporary_path);
    save_result?;

    Ok(ContentDocument {
        path,
        markdown: saved_body,
        revision: revision_for(saved_markdown.as_bytes()),
        id: current.as_ref().and_then(|file| file.document.id.clone()),
        aliases: current
            .as_ref()
            .map(|file| file.document.aliases.clone())
            .unwrap_or_default(),
    })
}

#[tauri::command]
fn create_content_folder(path: String) -> ApiResult<ContentMutationResult> {
    let destination = resolve_entry_path(&path, true, Some(ContentEntryKind::Directory))?;
    if content_path_exists(&destination)? {
        return Err(ContentApiError::new(
            "conflict",
            "A note or folder with that name already exists.",
        ));
    }
    fs::create_dir(destination).map_err(ContentApiError::io)?;
    Ok(ContentMutationResult {
        path,
        kind: ContentEntryKind::Directory,
    })
}

#[tauri::command(rename_all = "camelCase")]
fn move_content_entry(path: String, destination_path: String) -> ApiResult<ContentMutationResult> {
    let source = resolve_entry_path(&path, false, None)?;
    let kind = content_entry_kind(&source)?;
    validate_entry_path(&path, Some(kind))?;
    if path == destination_path {
        return Ok(ContentMutationResult {
            path: destination_path,
            kind,
        });
    }
    let destination = resolve_entry_path(&destination_path, true, Some(kind))?;
    if kind == ContentEntryKind::Directory && destination.starts_with(&source) {
        return Err(invalid_path("A folder cannot be moved inside itself."));
    }

    #[cfg(windows)]
    let same_case_insensitive_path = source
        .to_string_lossy()
        .eq_ignore_ascii_case(&destination.to_string_lossy());
    #[cfg(not(windows))]
    let same_case_insensitive_path = false;

    if !same_case_insensitive_path && content_path_exists(&destination)? {
        return Err(ContentApiError::new(
            "conflict",
            "A note or folder with that name already exists.",
        ));
    }

    if same_case_insensitive_path {
        let temporary = source.with_file_name(format!(".rename-{}.tmp", new_trash_token()));
        fs::rename(&source, &temporary).map_err(ContentApiError::io)?;
        if let Err(error) = fs::rename(&temporary, &destination) {
            let _ = fs::rename(&temporary, &source);
            return Err(ContentApiError::io(error));
        }
    } else {
        fs::rename(&source, &destination).map_err(ContentApiError::io)?;
    }
    Ok(ContentMutationResult {
        path: destination_path,
        kind,
    })
}

#[tauri::command]
fn trash_content_entry(path: String) -> ApiResult<DeletedContentReceipt> {
    let source = resolve_entry_path(&path, false, None)?;
    let kind = content_entry_kind(&source)?;
    validate_entry_path(&path, Some(kind))?;
    let token = new_trash_token();
    let deleted_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string();
    let receipt = DeletedContentReceipt {
        token: token.clone(),
        deleted_at,
        original_path: path.clone(),
        path,
        kind,
    };
    let container = content_trash_root()?.join(&token);
    let trashed_entry = container.join("entry");
    let metadata_path = container.join("receipt.json");
    fs::create_dir(&container).map_err(ContentApiError::io)?;
    let operation = (|| -> ApiResult<()> {
        let mut metadata = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(metadata_path)
            .map_err(ContentApiError::io)?;
        serde_json::to_writer(&mut metadata, &receipt)
            .map_err(|error| ContentApiError::new("io_error", error.to_string()))?;
        metadata.sync_all().map_err(ContentApiError::io)?;
        drop(metadata);
        fs::rename(source, trashed_entry).map_err(ContentApiError::io)
    })();
    if operation.is_err() {
        let _ = fs::remove_dir_all(&container);
    }
    operation?;
    Ok(receipt)
}

#[tauri::command]
fn restore_content_entry(token: String) -> ApiResult<ContentMutationResult> {
    if !valid_trash_token(&token) {
        return Err(invalid_path("The restore token is invalid."));
    }
    let container = content_trash_root()?.join(&token);
    let receipt: DeletedContentReceipt =
        serde_json::from_reader(File::open(container.join("receipt.json")).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                ContentApiError::new("not_found", "The deleted item is no longer available.")
            } else {
                ContentApiError::io(error)
            }
        })?)
        .map_err(|_| invalid_path("The deleted item metadata is invalid."))?;
    if receipt.token != token {
        return Err(invalid_path("The deleted item metadata is invalid."));
    }
    let destination = resolve_entry_path(&receipt.original_path, true, Some(receipt.kind))?;
    if content_path_exists(&destination)? {
        return Err(ContentApiError::new(
            "conflict",
            "That path is in use. Rename the current item before restoring.",
        ));
    }
    let trashed_entry = container.join("entry");
    if content_entry_kind(&trashed_entry)? != receipt.kind {
        return Err(invalid_path(
            "The deleted item no longer matches its metadata.",
        ));
    }
    fs::rename(trashed_entry, destination).map_err(ContentApiError::io)?;
    // The restore has committed once the entry is live. Failing the command
    // because receipt cleanup was blocked would make retrying the consumed
    // token unsafe and leave the client history out of sync with the disk.
    let _ = fs::remove_dir_all(container);
    Ok(ContentMutationResult {
        path: receipt.original_path,
        kind: receipt.kind,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(desktop_surface::DesktopSurfaceState::default())
        .setup(|app| {
            match desktop_surface::install_desktop_tray(app) {
                Ok(()) => desktop_surface::enter_at_launch(app),
                Err(error) => eprintln!(
                    "Math Atlas could not create its recovery tray icon; starting in workspace mode: {error}"
                ),
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_content_tree,
            read_content_file,
            write_content_file,
            create_content_folder,
            move_content_entry,
            trash_content_entry,
            restore_content_entry,
            assets::write_content_asset,
            assets::read_content_asset,
            desktop_surface::get_desktop_surface_status,
            desktop_surface::enter_desktop_surface,
            desktop_surface::exit_desktop_surface,
            desktop_surface::refresh_desktop_surface
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_paths_outside_content() {
        for path in [
            "../outside.md",
            "Synthetic Field/../outside.md",
            "C:/outside.md",
            "Synthetic Field\\Margin.md",
            ".hidden/Note.md",
            "NUL.md",
            "note.txt",
        ] {
            assert!(validate_content_path(path).is_err(), "accepted {path}");
        }
    }

    #[test]
    fn splits_frontmatter_without_rewriting_it() {
        let raw = "\u{feff}---\r\nid: fixture.margin\r\ntags: [definition]\r\n---\r\n\r\nBody\r\n";
        let parts = split_markdown_file(raw);
        assert_eq!(parts.body, "Body\r\n");
        assert_eq!(parts.line_ending, "\r\n");
        assert_eq!(
            stable_id_from_prefix(parts.prefix).as_deref(),
            Some("fixture.margin")
        );
        assert_eq!(format!("{}{}", parts.prefix, parts.body), raw);
    }

    #[test]
    fn reads_scalar_inline_and_block_obsidian_aliases() {
        let prefix = [
            "---",
            "id: fixture.continuous",
            "alias: Scalar name # comment",
            "aliases: [First, \"Second, form\", 'O''Brien', first] # duplicate",
            "metadata:",
            "  aliases:",
            "    - nested alias",
            "aliases: # block-form aliases",
            "  # a comment inside the block list",
            "  - continuous",
            "  - \"hash # alias\" # trailing comment",
            "  - null",
            "---",
            "",
        ]
        .join("\n");

        let metadata = frontmatter_metadata(&prefix);
        assert_eq!(metadata.id.as_deref(), Some("fixture.continuous"));
        assert_eq!(
            metadata.aliases,
            vec![
                "Scalar name",
                "First",
                "Second, form",
                "O'Brien",
                "continuous",
                "hash # alias",
            ]
        );
    }

    #[test]
    fn ignores_aliases_outside_complete_frontmatter_and_bad_collections() {
        assert!(aliases_from_prefix("aliases: body text\n").is_empty());
        assert!(aliases_from_prefix("---\naliases: [unfinished\n---\n").is_empty());
        assert!(aliases_from_prefix("---\naliases:\n  - one\nbody").is_empty());
    }
}
