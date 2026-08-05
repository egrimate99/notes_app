import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check } from "lucide-react";
import {
  defaultLandmarkShape,
  objectShapeGlyph,
  type GroupShape,
  type ObjectShape,
} from "../domain/mapAppearance";
import {
  MAX_GROUP_TITLE_FONT_SIZE,
  MAX_GROUP_FILL_OPACITY,
  MIN_GROUP_TITLE_FONT_SIZE,
  MIN_GROUP_FILL_OPACITY,
  clampGroupFillOpacity,
  clampGroupTitleFontSize,
  type EditableLandmarkKind,
  type GroupBorderWeight,
  type GroupTitlePosition,
} from "../state/mapCustomizationStore";
import {
  INFORMAL_NOTE_KIND_OPTION,
  MATHEMATICAL_LANDMARK_KIND_OPTIONS,
  PaperNoteGlyph,
  ShapeGlyph,
} from "./MapToolControls";
import { CompactPicker } from "./DeferredCompactPicker";
import { shapeTitleAnchors } from "./RegionFrameNode";

export function KindPicker({
  value,
  onChange,
}: {
  value: EditableLandmarkKind;
  onChange: (kind: EditableLandmarkKind, shape: ObjectShape) => void;
}) {
  const noteSelected = value === INFORMAL_NOTE_KIND_OPTION.value;
  return (
    <div className="map-kind-picker" aria-label="Landmark kind">
      <section className="map-kind-picker__section map-kind-picker__section--informal" aria-label="Informal note">
        <span className="map-kind-picker__label" aria-hidden="true">Informal</span>
        <button
          type="button"
          className="map-kind-option map-kind-option--note"
          aria-pressed={noteSelected}
          onClick={() => {
            if (!noteSelected) onChange(INFORMAL_NOTE_KIND_OPTION.value, defaultLandmarkShape(INFORMAL_NOTE_KIND_OPTION.value));
          }}
        >
          <PaperNoteGlyph />
          <span>{INFORMAL_NOTE_KIND_OPTION.label}</span>
          {noteSelected && <Check size={13} aria-hidden="true" />}
        </button>
      </section>
      <section className="map-kind-picker__section map-kind-picker__section--mathematics" aria-label="Mathematical objects">
        <span className="map-kind-picker__label" aria-hidden="true">Mathematics</span>
        <div className="map-kind-list">
          {MATHEMATICAL_LANDMARK_KIND_OPTIONS.map((option) => {
            const shape = defaultLandmarkShape(option.value);
            return (
              <button key={option.value} type="button" className="map-kind-option" aria-pressed={value === option.value} onClick={() => {
                if (value !== option.value) onChange(option.value, shape);
              }}>
                <ShapeGlyph shape={shape} />
                <span>{option.label}</span>
                {value === option.value && <Check size={13} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

const titlePositions: readonly GroupTitlePosition[] = [
  "top-left",
  "top-center",
  "top-right",
  "middle-right",
  "bottom-right",
  "bottom-center",
  "bottom-left",
  "middle-left",
];

export function TitleAnchorPicker({
  value,
  shape,
  onChange,
}: {
  value: GroupTitlePosition;
  shape: GroupShape;
  onChange: (position: GroupTitlePosition) => void;
}) {
  const glyph = objectShapeGlyph(shape, 150, 82);
  const anchors = shapeTitleAnchors(shape);
  return (
    <div className="map-anchor-picker" aria-label="Group title position">
      <svg viewBox="0 0 152 84" preserveAspectRatio="none" aria-hidden="true">
        <path d={glyph.framePath} transform="translate(1 1)" vectorEffect="non-scaling-stroke" />
      </svg>
      {titlePositions.map((position, index) => (
        <button
          key={position}
          type="button"
          className={`map-anchor-picker__point map-anchor-picker__point--${index}`}
          aria-label={`Place label ${position}`}
          title={position}
          style={{ left: `${anchors[position].x * 100}%`, top: `${anchors[position].y * 100}%` }}
          aria-pressed={value === position}
          onClick={() => onChange(position)}
        />
      ))}
    </div>
  );
}

const titleSizePresets = [18, 28, 38, 48] as const;

export function GroupTitleTools({
  value,
  shape,
  fontSize,
  onPositionChange,
  onFontSizePreview,
  onFontSizeCommit,
}: {
  value: GroupTitlePosition;
  shape: GroupShape;
  fontSize: number;
  onPositionChange: (position: GroupTitlePosition) => void;
  onFontSizePreview: (fontSize: number) => void;
  onFontSizeCommit: (fontSize: number) => void;
}) {
  const [draftSize, setDraftSize] = useState(fontSize);

  useEffect(() => setDraftSize(fontSize), [fontSize]);

  const preview = (candidate: number) => {
    const next = clampGroupTitleFontSize(candidate);
    setDraftSize(next);
    onFontSizePreview(next);
  };
  const commit = (candidate = draftSize) => {
    const next = clampGroupTitleFontSize(candidate);
    setDraftSize(next);
    onFontSizePreview(next);
    onFontSizeCommit(next);
  };

  return (
    <div className="map-title-tools">
      <TitleAnchorPicker value={value} shape={shape} onChange={onPositionChange} />
      <div className="map-title-size" aria-label="Group title size controls">
        <div className="map-title-size__presets" aria-label="Group title size presets">
          {titleSizePresets.map((size) => (
            <button
              key={size}
              type="button"
              aria-label={`Set group title size to ${size}`}
              title={`${size}px`}
              aria-pressed={draftSize === size}
              onClick={() => commit(size)}
            >
              <span style={{ "--title-size-preview": `${12 + (size - 18) * .25}px` } as CSSProperties}>A</span>
            </button>
          ))}
        </div>
        <div className="map-title-size__fine">
          <input
            type="range"
            min={MIN_GROUP_TITLE_FONT_SIZE}
            max={MAX_GROUP_TITLE_FONT_SIZE}
            step={1}
            value={draftSize}
            aria-label="Group title size"
            aria-valuetext={`${draftSize} pixels`}
            onInput={(event) => preview(Number(event.currentTarget.value))}
            onPointerUp={() => commit()}
            onKeyUp={() => commit()}
            onBlur={() => commit()}
          />
          <output aria-live="polite" aria-label="Current group title size">{draftSize}</output>
        </div>
      </div>
    </div>
  );
}

export const groupFillOpacityPresets = [0, .18, .34, .5] as const;

function OpacityGlyph({ opacity }: { opacity: number }) {
  return (
    <svg className="map-opacity-glyph" viewBox="0 0 28 22" aria-hidden="true">
      <path className="map-opacity-glyph__grid" d="M1 1H27V21H1ZM1 11H27M14 1V21" />
      <path className="map-opacity-glyph__field" d="M4 4H24V18H4Z" fillOpacity={opacity} />
      <path className="map-opacity-glyph__outline" d="M4 4H24V18H4Z" />
    </svg>
  );
}

/** A compact preset-and-slider control suitable for a context-menu panel. */
export function GroupFillOpacityPicker({
  value,
  onPreview,
  onCommit,
}: {
  value: number;
  onPreview: (opacity: number) => void;
  onCommit: (opacity: number) => void;
}) {
  const normalizedValue = clampGroupFillOpacity(value);
  const [draftOpacity, setDraftOpacity] = useState(normalizedValue);
  const draftRef = useRef(normalizedValue);
  const lastCommittedRef = useRef(normalizedValue);

  useEffect(() => {
    const next = clampGroupFillOpacity(value);
    draftRef.current = next;
    lastCommittedRef.current = next;
    setDraftOpacity(next);
  }, [value]);

  const preview = (candidate: number) => {
    const next = clampGroupFillOpacity(candidate);
    draftRef.current = next;
    setDraftOpacity(next);
    onPreview(next);
  };
  const commit = (candidate = draftRef.current) => {
    const next = clampGroupFillOpacity(candidate);
    draftRef.current = next;
    setDraftOpacity(next);
    onPreview(next);
    if (lastCommittedRef.current === next) return;
    lastCommittedRef.current = next;
    onCommit(next);
  };
  const cancelPreview = () => {
    const next = clampGroupFillOpacity(value);
    draftRef.current = next;
    setDraftOpacity(next);
    onPreview(next);
  };

  return (
    <div className="map-opacity-tools" aria-label="Group fill opacity">
      <div className="map-opacity-presets" aria-label="Group fill opacity presets">
        {groupFillOpacityPresets.map((opacity) => (
          <button
            key={opacity}
            type="button"
            aria-label={opacity === 0 ? "Outline only" : `Set fill opacity to ${Math.round(opacity * 100)} percent`}
            title={opacity === 0 ? "Outline only" : `${Math.round(opacity * 100)}% fill`}
            aria-pressed={draftOpacity === opacity}
            onClick={() => commit(opacity)}
          >
            <OpacityGlyph opacity={opacity} />
          </button>
        ))}
      </div>
      <div className="map-opacity-fine">
        <input
          type="range"
          min={MIN_GROUP_FILL_OPACITY}
          max={MAX_GROUP_FILL_OPACITY}
          step={.01}
          value={draftOpacity}
          aria-label="Fine tune group fill opacity"
          aria-valuetext={`${Math.round(draftOpacity * 100)} percent`}
          onInput={(event) => preview(Number(event.currentTarget.value))}
          onPointerUp={() => commit()}
          onPointerCancel={cancelPreview}
          onKeyUp={() => commit()}
          onBlur={() => commit()}
        />
        <output aria-live="polite" aria-label="Current group fill opacity">
          {Math.round(draftOpacity * 100)}
        </output>
      </div>
    </div>
  );
}

/** Complete surface treatment, exported as one lazy-loadable menu primitive. */
export function GroupSurfaceTools({
  fillOpacity,
  borderWeight,
  showFill = true,
  onFillOpacityPreview,
  onFillOpacityCommit,
  onBorderWeightChange,
}: {
  fillOpacity: number;
  borderWeight: GroupBorderWeight;
  showFill?: boolean;
  onFillOpacityPreview: (opacity: number) => void;
  onFillOpacityCommit: (opacity: number) => void;
  onBorderWeightChange: (weight: GroupBorderWeight) => void;
}) {
  return (
    <div className="map-surface-tools">
      {showFill && (
        <GroupFillOpacityPicker
          value={fillOpacity}
          onPreview={onFillOpacityPreview}
          onCommit={onFillOpacityCommit}
        />
      )}
      <CompactPicker kind="weight" value={borderWeight} onChange={onBorderWeightChange} />
    </div>
  );
}
