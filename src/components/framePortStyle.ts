import type { CSSProperties } from "react";
import {
  objectShapePortAnchors,
  type ObjectPortSide,
  type GroupShape,
} from "../domain/mapAppearance";

/** Positions the compact edge anchor on the SVG frame; CSS expands only its hit area. */
export function framePortStyle(
  shape: GroupShape,
  side: ObjectPortSide,
  width: number,
  height: number,
): CSSProperties {
  const anchor = objectShapePortAnchors(shape, width, height)[side];
  const x = `${anchor.x}%`;
  const y = `${anchor.y}%`;

  switch (side) {
    case "top":
      return { left: x, top: y };
    case "right":
      return { right: `${100 - anchor.x}%`, top: y };
    case "bottom":
      return { left: x, bottom: `${100 - anchor.y}%` };
    case "left":
      return { left: x, top: y };
  }
}
