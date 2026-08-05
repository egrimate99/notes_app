import { AlignLeft, FileText, Heading, Sigma } from "lucide-react";
import type { ReactElement } from "react";
import type { LandmarkContentMode } from "../state/mapCustomizationStore";

export function ContentPicker({
  value,
  onChange,
}: {
  value: LandmarkContentMode;
  onChange: (value: LandmarkContentMode) => void;
}) {
  const choices: Array<{ id: LandmarkContentMode; label: string; glyph: ReactElement }> = [
    { id: "title", label: "Title only", glyph: <Heading size={17} /> },
    { id: "formula", label: "Formula", glyph: <Sigma size={17} /> },
    { id: "statement", label: "Statement", glyph: <AlignLeft size={17} /> },
    { id: "note", label: "Note preview", glyph: <FileText size={17} /> },
  ];
  return (
    <div className="map-compact-choices">
      {choices.map(({ id, label, glyph }) => (
        <button key={id} type="button" aria-label={label} title={label} aria-pressed={value === id} onClick={() => onChange(id)}>
          {glyph}
        </button>
      ))}
    </div>
  );
}

const sizePresets = [
  { label: "Compact", width: 196, height: 84 },
  { label: "Reading", width: 336, height: 196 },
  { label: "Wide", width: 420, height: 168 },
  { label: "Tall", width: 280, height: 280 },
] as const;

export function LandmarkSizePicker({
  width,
  height,
  onChange,
}: {
  width: number;
  height: number;
  onChange: (size: { width: number; height: number }) => void;
}) {
  return (
    <div className="map-size-studio">
      <div className="map-size-presets" aria-label="Landmark size presets">
        {sizePresets.map((preset) => (
          <button
            key={preset.label}
            type="button"
            aria-label={preset.label}
            title={preset.label}
            aria-pressed={width === preset.width && height === preset.height}
            onClick={() => onChange(preset)}
          >
            <span
              className="map-size-glyph"
              style={{
                width: `${Math.max(18, Math.min(34, preset.width / 12))}px`,
                height: `${Math.max(10, Math.min(24, preset.height / 10))}px`,
              }}
            />
          </button>
        ))}
      </div>
      <div className="map-size-values">
        <label>
          <span>W</span>
          <input type="number" min={112} max={1960} step={28} value={Math.round(width)} aria-label="Landmark width" onChange={(event) => onChange({ width: Math.max(112, Number(event.currentTarget.value) || 112), height })} />
        </label>
        <label>
          <span>H</span>
          <input type="number" min={56} max={1960} step={28} value={Math.round(height)} aria-label="Landmark height" onChange={(event) => onChange({ width, height: Math.max(56, Number(event.currentTarget.value) || 56) })} />
        </label>
      </div>
    </div>
  );
}
