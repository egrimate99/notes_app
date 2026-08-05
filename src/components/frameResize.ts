import type { PointerEvent as ReactPointerEvent } from "react";
import type { ResizeParams } from "@xyflow/react";

export type ResizeAxis = -1 | 0 | 1;
export interface ResizeDirection { x: ResizeAxis; y: ResizeAxis }
export interface FrameResizeGesture {
  startClientX: number;
  startClientY: number;
  start: ResizeParams;
  direction: ResizeDirection;
}

function snapCoordinate(value: number, grid: number) {
  if (!Number.isFinite(grid) || grid <= 0) return value;
  const snapped = Math.round(value / grid) * grid;
  return Object.is(snapped, -0) ? 0 : snapped;
}

/**
 * Snap a completed resize while leaving the opposite edge perfectly still.
 * Call this once at commit: live resize samples deliberately remain continuous
 * so a pointer never has to cross half a grid cell before the frame responds.
 */
export function snappedFrameDimensions(
  dimensions: ResizeParams,
  start: ResizeParams,
  direction: ResizeDirection,
  grid: number,
  minWidth: number,
  minHeight: number,
): ResizeParams {
  const fixedLeft = start.x;
  const fixedTop = start.y;
  const fixedRight = start.x + start.width;
  const fixedBottom = start.y + start.height;

  let left = direction.x < 0 ? snapCoordinate(dimensions.x, grid) : fixedLeft;
  let right = direction.x > 0
    ? snapCoordinate(dimensions.x + dimensions.width, grid)
    : fixedRight;
  let top = direction.y < 0 ? snapCoordinate(dimensions.y, grid) : fixedTop;
  let bottom = direction.y > 0
    ? snapCoordinate(dimensions.y + dimensions.height, grid)
    : fixedBottom;

  if (direction.x < 0) left = Math.min(left, right - minWidth);
  if (direction.x > 0) right = Math.max(right, left + minWidth);
  if (direction.y < 0) top = Math.min(top, bottom - minHeight);
  if (direction.y > 0) bottom = Math.max(bottom, top + minHeight);

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

export function frameResizeDirection(x: number, y: number): ResizeDirection {
  const horizontal = x - .5;
  const vertical = y - .5;
  const absX = Math.abs(horizontal);
  const absY = Math.abs(vertical);
  const xDirection: ResizeAxis = horizontal < 0 ? -1 : 1;
  const yDirection: ResizeAxis = vertical < 0 ? -1 : 1;
  if (absX > absY * 1.65) return { x: xDirection, y: 0 };
  if (absY > absX * 1.65) return { x: 0, y: yDirection };
  return { x: xDirection, y: yDirection };
}

export function frameResizeCursor({ x, y }: ResizeDirection) {
  if (x === 0) return "ns-resize";
  if (y === 0) return "ew-resize";
  return x === y ? "nwse-resize" : "nesw-resize";
}

export function pointWithinFrame(event: ReactPointerEvent<SVGPathElement>) {
  const bounds = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
  if (!bounds?.width || !bounds.height) return { x: .5, y: .5 };
  return {
    x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
  };
}

export function resizedFrameDimensions(
  gesture: FrameResizeGesture,
  clientX: number,
  clientY: number,
  zoom: number,
  minWidth: number,
  minHeight: number,
): ResizeParams {
  // Desktop monitor projections can legitimately use canvas zooms below .04
  // after native scale-factor normalization. Clamping to the browser minimum
  // makes the object trail behind the pointer on a high-DPI monitor.
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const dx = (clientX - gesture.startClientX) / scale;
  const dy = (clientY - gesture.startClientY) / scale;
  let { x, y, width, height } = gesture.start;
  if (gesture.direction.x > 0) width = Math.max(minWidth, width + dx);
  if (gesture.direction.x < 0) {
    width = Math.max(minWidth, width - dx);
    x = gesture.start.x + gesture.start.width - width;
  }
  if (gesture.direction.y > 0) height = Math.max(minHeight, height + dy);
  if (gesture.direction.y < 0) {
    height = Math.max(minHeight, height - dy);
    y = gesture.start.y + gesture.start.height - height;
  }
  return { x, y, width, height };
}
