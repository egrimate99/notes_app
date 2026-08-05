import {
  ATLAS_METADATA_SCHEMA_VERSION,
  emptyAtlasMetadata,
  validateAtlasMetadata,
  type AtlasMetadata,
  type AtlasMapCustomizations,
} from "../domain/atlasMetadata";
import type { Placement } from "../domain/types";
import type { MapCustomizations } from "../state/mapCustomizationStore";

/**
 * Converts the two legacy localStorage payloads into the single canonical file
 * document. Invalid legacy entries are dropped by the shared API validator.
 */
export function migrateLegacyAtlasState(
  customizations: MapCustomizations,
  placements: readonly Placement[],
): AtlasMetadata {
  const snapshotKey = customizations.snapshotKey.trim();
  if (!snapshotKey) return emptyAtlasMetadata();

  // Match the legacy placement store's last-write-wins semantics so a damaged
  // browser payload cannot produce a file that the stricter API rejects.
  const uniquePlacements = new Map<string, Placement>();
  placements.forEach((placement) => {
    uniquePlacements.set(placement.landmarkId, placement);
  });

  const candidate: AtlasMetadata = {
    schemaVersion: ATLAS_METADATA_SCHEMA_VERSION,
    snapshotKey,
    placements: [...uniquePlacements.values()].map(({ landmarkId, x, y }) => ({
      landmarkId,
      x,
      y,
    })),
    customizations: customizations as AtlasMapCustomizations,
  };
  return validateAtlasMetadata(candidate, snapshotKey).value;
}

/** A narrow compatibility adapter for wiring file state into the current UI. */
export function atlasMetadataToLegacyState(metadata: AtlasMetadata): {
  customizations: MapCustomizations;
  placements: Placement[];
} {
  const validated = validateAtlasMetadata(metadata, metadata.snapshotKey).value;
  return {
    customizations: validated.customizations as MapCustomizations,
    placements: validated.placements.map(({ landmarkId, x, y }) => ({ landmarkId, x, y })),
  };
}
