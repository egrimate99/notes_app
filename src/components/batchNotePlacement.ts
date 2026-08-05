import type { NoteFileDragItem } from "../domain/noteDrag";
import {
  objectShapeContainsPoint,
  type GroupShape,
} from "../domain/mapAppearance";

export interface BatchNoteSize {
  width: number;
  height: number;
}

export interface CanvasRectangle extends BatchNoteSize {
  x: number;
  y: number;
}

export interface BatchNotePosition {
  x: number;
  y: number;
}

const finitePositive = (value: number, fallback: number) => (
  Number.isFinite(value) && value > 0 ? value : fallback
);

function snapTo(value: number, grid: number) {
  const snapped = Math.round(value / grid) * grid;
  return Object.is(snapped, -0) ? 0 : snapped;
}

function snapUpTo(value: number, grid: number) {
  return Math.ceil(value / grid) * grid;
}

function overlapsWithGap(
  left: CanvasRectangle,
  right: CanvasRectangle,
  gap: number,
) {
  return (
    left.x < right.x + right.width + gap &&
    left.x + left.width + gap > right.x &&
    left.y < right.y + right.height + gap &&
    left.y + left.height + gap > right.y
  );
}

function nearestFreeOffset(
  cluster: CanvasRectangle,
  occupied: readonly CanvasRectangle[],
  grid: number,
) {
  const collides = (x: number, y: number) => occupied.some((rectangle) => (
    overlapsWithGap({ ...cluster, x, y }, rectangle, grid)
  ));
  if (!collides(cluster.x, cluster.y)) return { x: 0, y: 0 };

  // Every occupied edge is a useful escape candidate. Trying these exact,
  // snapped boundaries finds the closest clear horizontal or vertical lane
  // without an unbounded spiral through a dense canvas.
  const candidates = occupied.flatMap((rectangle) => [
    {
      x: snapTo(rectangle.x + rectangle.width + grid - cluster.x, grid),
      y: 0,
    },
    {
      x: snapTo(rectangle.x - grid - (cluster.x + cluster.width), grid),
      y: 0,
    },
    {
      x: 0,
      y: snapTo(rectangle.y + rectangle.height + grid - cluster.y, grid),
    },
    {
      x: 0,
      y: snapTo(rectangle.y - grid - (cluster.y + cluster.height), grid),
    },
  ]);
  const unique = [...new Map(candidates.map((candidate) => (
    [`${candidate.x}:${candidate.y}`, candidate] as const
  ))).values()].sort((left, right) => (
    Math.abs(left.x) + Math.abs(left.y) - Math.abs(right.x) - Math.abs(right.y) ||
    // Prefer keeping the user's vertical reading position when equally close.
    Math.abs(left.y) - Math.abs(right.y) ||
    right.x - left.x ||
    right.y - left.y
  ));
  const free = unique.find((candidate) => (
    !collides(cluster.x + candidate.x, cluster.y + candidate.y)
  ));
  return free ?? { x: 0, y: 0 };
}

/**
 * Lay note copies out in a compact, grid-snapped block. The first note keeps
 * the familiar single-file drop anchor beneath the pointer; following notes
 * fill rightward and then downward. For a real batch, the whole block shifts
 * to the nearest clear lane rather than covering existing landmarks.
 */
export function arrangeBatchNotePositions(
  sizes: readonly BatchNoteSize[],
  dropPoint: { x: number; y: number },
  occupied: readonly CanvasRectangle[],
  grid: number,
): BatchNotePosition[] {
  if (!sizes.length) return [];
  const safeGrid = finitePositive(grid, 1);
  const normalizedSizes = sizes.map(({ width, height }) => ({
    width: finitePositive(width, safeGrid),
    height: finitePositive(height, safeGrid),
  }));
  const columns = Math.ceil(Math.sqrt(normalizedSizes.length));
  const rows = Math.ceil(normalizedSizes.length / columns);
  const columnWidths = Array.from({ length: columns }, () => 0);
  const rowHeights = Array.from({ length: rows }, () => 0);
  normalizedSizes.forEach((size, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    columnWidths[column] = Math.max(columnWidths[column], size.width);
    rowHeights[row] = Math.max(rowHeights[row], size.height);
  });

  const columnOffsets: number[] = [];
  const rowOffsets: number[] = [];
  columnWidths.forEach((_, index) => {
    columnOffsets[index] = index === 0
      ? 0
      : columnOffsets[index - 1] + snapUpTo(columnWidths[index - 1] + safeGrid, safeGrid);
  });
  rowHeights.forEach((_, index) => {
    rowOffsets[index] = index === 0
      ? 0
      : rowOffsets[index - 1] + snapUpTo(rowHeights[index - 1] + safeGrid, safeGrid);
  });

  const first = normalizedSizes[0];
  const anchorX = snapTo(dropPoint.x - first.width / 2, safeGrid);
  const anchorY = snapTo(dropPoint.y - first.height / 2, safeGrid);
  const positions = normalizedSizes.map((_, index) => ({
    x: anchorX + columnOffsets[index % columns],
    y: anchorY + rowOffsets[Math.floor(index / columns)],
  }));
  if (positions.length === 1) return positions;

  const right = Math.max(...positions.map((position, index) => (
    position.x + normalizedSizes[index].width
  )));
  const bottom = Math.max(...positions.map((position, index) => (
    position.y + normalizedSizes[index].height
  )));
  const cluster: CanvasRectangle = {
    x: anchorX,
    y: anchorY,
    width: right - anchorX,
    height: bottom - anchorY,
  };
  const offset = nearestFreeOffset(cluster, occupied, safeGrid);
  return positions.map((position) => ({
    x: position.x + offset.x,
    y: position.y + offset.y,
  }));
}

interface PlacedNoteRequest<TSubject extends string> extends NoteFileDragItem {
  kind: "math-atlas-note";
  version: 1;
  subjectId: TSubject;
  regionId: string;
  x: number;
  y: number;
}

interface BatchDropGroup<TSubject extends string> {
  level: string;
  region: { id: string; subjectId: TSubject };
  shape: GroupShape;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BatchDropRegion<TSubject extends string> {
  id: string;
  subjectId: TSubject;
}

interface BatchDropLandmark {
  id: string;
}

/**
 * Complete note-drop placement lives behind one prefetched async boundary so
 * the large steady-state graph pays only for collecting the drop context.
 */
export function placeDroppedNotes<TSubject extends string>(
  notes: readonly NoteFileDragItem[],
  dropPoint: { x: number; y: number },
  subjectId: TSubject,
  groups: readonly BatchDropGroup<TSubject>[],
  regions: readonly BatchDropRegion<TSubject>[],
  landmarks: readonly BatchDropLandmark[],
  placements: ReadonlyMap<string, { x: number; y: number }>,
  dimensions: ReadonlyMap<string, BatchNoteSize>,
  defaults: readonly [grid: number, width: number, height: number, noteHeight: number],
  onBatch: ((requests: readonly PlacedNoteRequest<TSubject>[]) => void | Promise<void>) | undefined,
  onSingle: ((request: PlacedNoteRequest<TSubject>) => void | Promise<void>) | undefined,
) {
  if (!notes.length) return;
  const [grid, width, height, noteHeight] = defaults;
  const containingRegion = groups
    .filter((group) => (
      group.level !== "subject" &&
      group.region.subjectId === subjectId &&
      objectShapeContainsPoint(
        group.shape,
        (dropPoint.x - group.x) / group.width,
        (dropPoint.y - group.y) / group.height,
      )
    ))
    .sort((left, right) => left.width * left.height - right.width * right.height)[0];
  const regionId = containingRegion?.region.id ??
    regions.find((region) => region.subjectId === subjectId)?.id ??
    `subject-zone:${subjectId}`;
  const sizes = notes.map(({ noteId }) => (
    dimensions.get(noteId ?? "") ?? { width, height: noteHeight }
  ));

  if (notes.length === 1) {
    const [size] = sizes;
    const request: PlacedNoteRequest<TSubject> = {
      kind: "math-atlas-note",
      version: 1,
      ...notes[0],
      subjectId,
      regionId,
      x: snapTo(dropPoint.x - size.width / 2, grid),
      y: snapTo(dropPoint.y - size.height / 2, grid),
    };
    if (onBatch) return onBatch([request]);
    return onSingle?.(request);
  }

  const occupied = landmarks.flatMap((landmark) => {
    const placement = placements.get(landmark.id);
    if (!placement) return [];
    return [{
      ...placement,
      ...(dimensions.get(landmark.id) ?? { width, height }),
    }];
  });
  return placeBatchNotes(
    notes,
    sizes,
    dropPoint,
    occupied,
    grid,
    subjectId,
    regionId,
    onBatch,
    onSingle,
  );
}

export function placeBatchNotes<TSubject extends string>(
  notes: readonly NoteFileDragItem[],
  sizes: readonly BatchNoteSize[],
  dropPoint: { x: number; y: number },
  occupied: readonly CanvasRectangle[],
  grid: number,
  subjectId: TSubject,
  regionId: string,
  onBatch: ((requests: readonly PlacedNoteRequest<TSubject>[]) => void | Promise<void>) | undefined,
  onSingle: ((request: PlacedNoteRequest<TSubject>) => void | Promise<void>) | undefined,
) {
  const positions = arrangeBatchNotePositions(sizes, dropPoint, occupied, grid);
  const requests = notes.map((note, index) => ({
    kind: "math-atlas-note" as const,
    version: 1 as const,
    ...note,
    subjectId,
    regionId,
    ...positions[index],
  }));
  if (onBatch) return onBatch(requests);
  requests.forEach((request) => void onSingle?.(request));
}
