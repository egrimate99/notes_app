import {
  type ComponentType,
} from "react";
import {
  objectShapeGlyph,
  type GroupShape,
} from "../domain/mapAppearance";
import type { EditableLandmarkKind } from "../state/mapCustomizationStore";
import "./MapToolControls.css";

export interface ToolTab<T extends string> {
  id: T;
  label: string;
  icon: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
}

export function ToolTabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly ToolTab<T>[];
  active: T;
  onChange: (tab: T) => void;
}) {
  return (
    <div className="map-tool-tabs" role="tablist" aria-label="Object tools">
      {tabs.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={active === id}
          aria-label={label}
          title={label}
          onClick={() => onChange(id)}
        >
          <Icon size={16} aria-hidden={true} />
        </button>
      ))}
    </div>
  );
}

export function ShapeGlyph({ shape }: { shape: GroupShape }) {
  const glyph = objectShapeGlyph(shape, 26, 19);
  return (
    <svg className="map-tool-shape" viewBox={glyph.viewBox} preserveAspectRatio="none" aria-hidden="true">
      <path d={glyph.framePath} />
    </svg>
  );
}

/**
 * A deliberately non-geometric glyph for informal notes. The folded lower
 * corner makes it read as a loose piece of paper rather than another member
 * of the mathematical shape language.
 */
export function PaperNoteGlyph() {
  return <span className="map-paper-note-glyph" aria-hidden="true" />;
}

export const LANDMARK_KIND_OPTIONS = [
  { value: "concept", label: "Note" },
  { value: "definition", label: "Definition" },
  { value: "theorem", label: "Theorem" },
  { value: "proposition", label: "Proposition" },
  { value: "lemma", label: "Lemma" },
  { value: "corollary", label: "Corollary" },
  { value: "method", label: "Method" },
  { value: "example", label: "Example" },
] as const satisfies ReadonlyArray<{ value: EditableLandmarkKind; label: string }>;

export const INFORMAL_NOTE_KIND_OPTION = LANDMARK_KIND_OPTIONS[0];
export const MATHEMATICAL_LANDMARK_KIND_OPTIONS = LANDMARK_KIND_OPTIONS.slice(1);
