import { Image as ImageIcon } from "lucide-react";
import {
  useEffect,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import { resolveManagedImagePath } from "../domain/assetPaths";
import {
  assetRepository,
  bytesToBase64,
} from "../services/assetRepository";

const imageSourceCache = new Map<string, Promise<string>>();
const MAX_CACHED_IMAGES = 96;

function managedImageSource(path: string) {
  const existing = imageSourceCache.get(path);
  if (existing) {
    imageSourceCache.delete(path);
    imageSourceCache.set(path, existing);
    return existing;
  }
  const request = assetRepository.readImage(path).then(
    ({ bytes, mediaType }) => `data:${mediaType};base64,${bytesToBase64(bytes)}`,
  ).catch((error: unknown) => {
    imageSourceCache.delete(path);
    throw error;
  });
  imageSourceCache.set(path, request);
  if (imageSourceCache.size > MAX_CACHED_IMAGES) {
    const oldest = imageSourceCache.keys().next().value;
    if (oldest) imageSourceCache.delete(oldest);
  }
  return request;
}

interface ManagedMarkdownImageProps extends ComponentPropsWithoutRef<"img"> {
  notePath?: string;
}

export function ManagedMarkdownImage({
  notePath,
  src,
  alt = "",
  ...props
}: ManagedMarkdownImageProps) {
  const managedPath = resolveManagedImagePath(notePath, src);
  const [resolvedSource, setResolvedSource] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setResolvedSource(undefined);
    setFailed(false);
    if (!managedPath) return;
    let live = true;
    void managedImageSource(managedPath).then((source) => {
      if (live) setResolvedSource(source);
    }).catch(() => {
      if (live) setFailed(true);
    });
    return () => { live = false; };
  }, [managedPath]);

  if (!managedPath) {
    return <img {...props} src={src} alt={alt} loading="lazy" decoding="async" />;
  }
  if (!resolvedSource) {
    return (
      <span
        className={`managed-markdown-image__placeholder${failed ? " is-error" : ""}`}
        role="img"
        aria-label={failed ? `${alt || "Image"} could not be opened` : `Loading ${alt || "image"}`}
        title={failed ? `Could not open ${managedPath}` : undefined}
        data-managed-asset={managedPath}
      >
        <ImageIcon size={17} aria-hidden="true" />
        {alt && <span>{alt}</span>}
      </span>
    );
  }
  return (
    <img
      {...props}
      src={resolvedSource}
      alt={alt}
      loading="lazy"
      decoding="async"
      data-managed-asset={managedPath}
    />
  );
}
