import { memo } from "react";
import { useStore, ViewportPortal } from "@xyflow/react";
import type { CanvasSnapGuide } from "../domain/canvasMovementSnap";

interface CanvasAlignmentGuidesProps {
  guides: readonly CanvasSnapGuide[];
}

/**
 * Pointer-inert, world-space drafting guides. Strokes remain one screen pixel
 * while their coordinates follow the same viewport transform as map objects.
 */
export const CanvasAlignmentGuides = memo(function CanvasAlignmentGuides({
  guides,
}: CanvasAlignmentGuidesProps) {
  const viewportZoom = useStore((state) => state.transform[2]);
  const zoom = Number.isFinite(viewportZoom) && viewportZoom > 0
    ? viewportZoom
    : 1;
  if (!guides.length) return null;

  return (
    <ViewportPortal>
      <svg
        className="canvas-alignment-guides"
        width="1"
        height="1"
        overflow="visible"
        aria-hidden="true"
        data-testid="canvas-alignment-guides"
      >
        {guides.map((guide) => (
          <g
            key={guide.id}
            className={`canvas-alignment-guide canvas-alignment-guide--${guide.kind}`}
            data-testid={`alignment-guide-${guide.axis}`}
            data-guide-kind={guide.kind}
            data-guide-axis={guide.axis}
            data-guide-targets={guide.targetIds.join(",")}
            data-moving-anchor={guide.movingAnchor}
            data-target-anchor={guide.targetAnchor}
          >
            {guide.lines.map((segment, index) => (
              <g key={`${guide.id}:${index}`}>
                <line
                  x1={segment.x1}
                  y1={segment.y1}
                  x2={segment.x2}
                  y2={segment.y2}
                  vectorEffect="non-scaling-stroke"
                />
                {guide.kind === "connection" && (
                  <>
                    <circle
                      className="canvas-alignment-guide__port"
                      cx={segment.x1}
                      cy={segment.y1}
                      r={2.65 / zoom}
                      vectorEffect="non-scaling-stroke"
                    />
                    <circle
                      className="canvas-alignment-guide__port"
                      cx={segment.x2}
                      cy={segment.y2}
                      r={2.65 / zoom}
                      vectorEffect="non-scaling-stroke"
                    />
                  </>
                )}
              </g>
            ))}
            {guide.label && (
              <g
                className="canvas-alignment-guide__label"
                transform={`translate(${guide.label.x} ${guide.label.y}) scale(${1 / zoom})`}
              >
                <rect x="-16" y="-9" width="32" height="18" />
                <text x="0" y="0">{guide.label.text}</text>
              </g>
            )}
          </g>
        ))}
      </svg>
    </ViewportPortal>
  );
});
