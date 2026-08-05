import { ArrowLeft, ArrowLeftRight, ArrowRight, Minus } from "lucide-react";
import type { CSSProperties, ReactElement, SVGProps } from "react";
import type {
  ConnectionDirection,
  ConnectionLineStyle,
  ConnectionPathStyle,
  GroupBorderStyle,
  GroupBorderWeight,
} from "../state/mapCustomizationStore";

function StrokeGlyph({ dash, double, path = "M2 10H30", weight = 1.5, style, ...props }: SVGProps<SVGSVGElement> & { dash?: string; double?: boolean; path?: string; weight?: number }) {
  return (
    <svg className="map-tool-stroke" viewBox="0 0 32 20" aria-hidden="true" style={{ ...style, "--stroke-weight": weight } as CSSProperties} {...props}>
      <path d={path} strokeDasharray={dash} />
      {double && <path d="M2 14H30" />}
    </svg>
  );
}

export type CompactPickerProps =
  | { kind: "frame"; value: GroupBorderStyle; onChange: (value: GroupBorderStyle) => void }
  | { kind: "weight"; value: GroupBorderWeight; onChange: (value: GroupBorderWeight) => void }
  | { kind: "direction"; value: ConnectionDirection; onChange: (value: ConnectionDirection) => void }
  | { kind: "line"; value: ConnectionLineStyle; onChange: (value: ConnectionLineStyle) => void }
  | { kind: "path"; value: ConnectionPathStyle; onChange: (value: ConnectionPathStyle) => void };

export function CompactPicker(props: CompactPickerProps) {
  let choices: Array<{ id: string; label: string; glyph: ReactElement }>;
  if (props.kind === "frame") choices = [
    { id: "solid", label: "Solid frame", glyph: <StrokeGlyph /> },
    { id: "dashed", label: "Dashed frame", glyph: <StrokeGlyph dash="5 3" /> },
    { id: "double", label: "Double frame", glyph: <StrokeGlyph double /> },
  ];
  else if (props.kind === "weight") choices = [
    { id: "hairline", label: "Hairline frame", glyph: <StrokeGlyph weight={.8} /> },
    { id: "regular", label: "Regular frame", glyph: <StrokeGlyph weight={1.6} /> },
    { id: "strong", label: "Strong frame", glyph: <StrokeGlyph weight={2.8} /> },
  ];
  else if (props.kind === "direction") choices = [
    { id: "forward", label: "Forward", glyph: <ArrowRight size={17} /> },
    { id: "reverse", label: "Reverse", glyph: <ArrowLeft size={17} /> },
    { id: "both", label: "Both directions", glyph: <ArrowLeftRight size={17} /> },
    { id: "none", label: "No arrow", glyph: <Minus size={17} /> },
  ];
  else if (props.kind === "line") choices = [
    { id: "solid", label: "Solid line", glyph: <StrokeGlyph /> },
    { id: "dashed", label: "Dashed line", glyph: <StrokeGlyph dash="5 3" /> },
    { id: "dotted", label: "Dotted line", glyph: <StrokeGlyph dash="1 4" /> },
  ];
  else choices = [
    { id: "straight", label: "Straight path", glyph: <StrokeGlyph path="M2 16L30 4" /> },
    { id: "smooth", label: "Stepped path", glyph: <StrokeGlyph path="M2 16H14V4H30" /> },
    { id: "curve", label: "Curved path", glyph: <StrokeGlyph path="M2 16C9 1 23 1 30 16" /> },
  ];
  return (
    <div className="map-compact-choices">
      {choices.map(({ id, label, glyph }) => (
        <button key={id} type="button" aria-label={label} title={label} aria-pressed={props.value === id} onClick={() => props.onChange(id as never)}>{glyph}</button>
      ))}
    </div>
  );
}
