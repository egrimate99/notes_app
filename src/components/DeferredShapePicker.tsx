import { Check } from "lucide-react";
import {
  OBJECT_SHAPE_OPTIONS,
  type GroupShape,
} from "../domain/mapAppearance";
import { ShapeGlyph } from "./MapToolControls";

export function ShapePicker({
  value,
  onChange,
  options = OBJECT_SHAPE_OPTIONS,
}: {
  value: GroupShape;
  onChange: (shape: GroupShape) => void;
  options?: ReadonlyArray<{ id: GroupShape; label: string }>;
}) {
  return (
    <div className="map-tool-grid map-tool-grid--shapes" aria-label="Shape">
      {options.map(({ id, label }) => (
        <button key={id} type="button" className="map-tool-tile map-tool-tile--icon" aria-label={label} title={label} aria-pressed={value === id} onClick={() => onChange(id)}>
          <ShapeGlyph shape={id} />
          {value === id && <Check className="map-tool-tile__check" size={10} aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}
