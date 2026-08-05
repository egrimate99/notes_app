import type { Placement } from "../domain/types";

export const PLACEMENT_OVERRIDES_SCHEMA_VERSION = 1;

const STORAGE_PREFIX = "math-atlas:placement-overrides";

interface StoredPlacementOverrides {
  schemaVersion: typeof PLACEMENT_OVERRIDES_SCHEMA_VERSION;
  snapshotKey: string;
  placements: Placement[];
}

type AllowedLandmarkIds = Iterable<string>;

function storageKey(snapshotKey: string): string | null {
  const normalizedKey = snapshotKey.trim();
  if (!normalizedKey) return null;

  return `${STORAGE_PREFIX}:v${PLACEMENT_OVERRIDES_SCHEMA_VERSION}:${encodeURIComponent(normalizedKey)}`;
}

function browserStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizePlacements(
  placements: unknown,
  allowedLandmarkIds: AllowedLandmarkIds,
): Placement[] {
  if (!Array.isArray(placements)) return [];

  const allowedIds = new Set(allowedLandmarkIds);
  const validPlacements = new Map<string, Placement>();

  for (const candidate of placements) {
    if (!isRecord(candidate)) continue;

    const { landmarkId, x, y } = candidate;
    if (
      typeof landmarkId !== "string" ||
      !allowedIds.has(landmarkId) ||
      typeof x !== "number" ||
      !Number.isFinite(x) ||
      typeof y !== "number" ||
      !Number.isFinite(y)
    ) {
      continue;
    }

    validPlacements.set(landmarkId, { landmarkId, x, y });
  }

  return [...validPlacements.values()];
}

export function loadPlacementOverrides(
  snapshotKey: string,
  allowedLandmarkIds: AllowedLandmarkIds,
): Placement[] {
  const normalizedSnapshotKey = snapshotKey.trim();
  const key = storageKey(normalizedSnapshotKey);
  const storage = browserStorage();
  if (!key || !storage) return [];

  try {
    const serialized = storage.getItem(key);
    if (!serialized) return [];

    const stored: unknown = JSON.parse(serialized);
    if (
      !isRecord(stored) ||
      stored.schemaVersion !== PLACEMENT_OVERRIDES_SCHEMA_VERSION ||
      stored.snapshotKey !== normalizedSnapshotKey
    ) {
      return [];
    }

    return normalizePlacements(stored.placements, allowedLandmarkIds);
  } catch {
    return [];
  }
}

export function savePlacementOverrides(
  snapshotKey: string,
  placements: readonly Placement[],
  allowedLandmarkIds: AllowedLandmarkIds,
): boolean {
  const normalizedSnapshotKey = snapshotKey.trim();
  const key = storageKey(normalizedSnapshotKey);
  const storage = browserStorage();
  if (!key || !storage) return false;

  const payload: StoredPlacementOverrides = {
    schemaVersion: PLACEMENT_OVERRIDES_SCHEMA_VERSION,
    snapshotKey: normalizedSnapshotKey,
    placements: normalizePlacements(placements, allowedLandmarkIds),
  };

  try {
    storage.setItem(key, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

export function clearPlacementOverrides(snapshotKey: string): boolean {
  const key = storageKey(snapshotKey);
  const storage = browserStorage();
  if (!key || !storage) return false;

  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
