import {
  ArrowLeftRight,
  BoxSelect,
  Frame,
  Layers3,
  Palette,
  Route,
  Scan,
  Shapes,
  Sigma,
  Trash2,
  Type,
} from "lucide-react";
import { lazy, Suspense } from "react";
import {
  defaultLandmarkShape,
  GROUP_SHAPE_OPTIONS,
  isObjectShape,
  OBJECT_SHAPE_OPTIONS,
  type GroupShape,
  type ObjectShape,
} from "../domain/mapAppearance";
import type { Landmark } from "../domain/types";
import {
  MAX_CONNECTION_LABEL_LENGTH,
  type ConnectionCustomization,
  type ConnectionDirection,
  type ConnectionLineStyle,
  type ConnectionPathStyle,
  type EditableLandmarkKind,
  type GroupBorderStyle,
  type GroupBorderWeight,
  type GroupCustomization,
  type GroupLevel,
  type GroupTitlePosition,
  type LandmarkContentMode,
  type LandmarkCustomization,
} from "../state/mapCustomizationStore";
import {
  LANDMARK_KIND_OPTIONS,
  ShapeGlyph,
  ToolTabs,
} from "./MapToolControls";
import {
  MapMenuBody,
  MapMenuHeader,
  MapMenuTextField,
  MapMenuTitle,
} from "./MapContextMenu";

const LazyColorStudio = lazy(() => import("./ColorStudio").then((module) => ({
  default: module.ColorStudio,
})));
const LazyContentPicker = lazy(() => import("./LandmarkDisplayTools").then((module) => ({
  default: module.ContentPicker,
})));
const LazyLandmarkFormulaPicker = lazy(() => import("./LandmarkFormulaPicker").then((module) => ({
  default: module.LandmarkFormulaPicker,
})));
const LazyLandmarkSizePicker = lazy(() => import("./LandmarkDisplayTools").then((module) => ({
  default: module.LandmarkSizePicker,
})));
const LazyKindPicker = lazy(() => import("./DeferredGeometryTools").then((module) => ({
  default: module.KindPicker,
})));
const LazyTitleAnchorPicker = lazy(() => import("./DeferredGeometryTools").then((module) => ({
  default: module.GroupTitleTools,
})));
const LazyGroupSurfaceTools = lazy(() => import("./DeferredGeometryTools").then((module) => ({
  default: module.GroupSurfaceTools,
})));
const LazyShapePicker = lazy(() => import("./DeferredShapePicker").then((module) => ({
  default: module.ShapePicker,
})));
const LazyCompactPicker = lazy(() => import("./DeferredCompactPicker").then((module) => ({
  default: module.CompactPicker,
})));
const LazyLandmarkCreationForm = lazy(() => import("./DeferredLandmarkCreationForm"));
const LazyCanvasCreationPalette = lazy(() => import("./DeferredLandmarkCreationForm").then((module) => ({
  default: module.CanvasCreationPalette,
})));

export type AtlasContextPanel =
  | "kind"
  | "level"
  | "shape"
  | "content"
  | "size"
  | "anchor"
  | "frame"
  | "direction"
  | "line"
  | "path"
  | "color";

const landmarkToolTabs = [
  { id: "kind", label: "Kind", icon: Sigma },
  { id: "shape", label: "Shape", icon: Shapes },
  { id: "content", label: "Content", icon: Sigma },
  { id: "size", label: "Size", icon: Scan },
  { id: "color", label: "Colour", icon: Palette },
] as const;

const groupToolTabs = [
  { id: "level", label: "Level", icon: Layers3 },
  { id: "shape", label: "Shape", icon: Shapes },
  { id: "anchor", label: "Title", icon: Type },
  { id: "frame", label: "Frame", icon: Frame },
  { id: "color", label: "Colour", icon: Palette },
] as const;

const subjectGroupToolTabs = groupToolTabs.filter(({ id }) => id !== "color" && id !== "shape");

const groupLevelOptions = [
  { value: "subject", label: "Subject", icon: Scan },
  { value: "group", label: "Group", icon: Frame },
  { value: "subgroup", label: "Subgroup", icon: BoxSelect },
] as const satisfies ReadonlyArray<{
  value: GroupLevel;
  label: string;
  icon: typeof Scan;
}>;

const connectionToolTabs = [
  { id: "direction", label: "Direction", icon: ArrowLeftRight },
  { id: "line", label: "Line", icon: BoxSelect },
  { id: "path", label: "Path", icon: Route },
  { id: "color", label: "Colour", icon: Palette },
] as const;

function groupLevelLabel(level: GroupLevel) {
  return groupLevelOptions.find(({ value }) => value === level)?.label ?? "Group";
}

function landmarkKindLabel(kind: EditableLandmarkKind) {
  return LANDMARK_KIND_OPTIONS.find(({ value }) => value === kind)?.label ?? "Note";
}

function editableKindFor(kind: Landmark["kind"]): EditableLandmarkKind {
  if (kind === "result") return "theorem";
  const option = LANDMARK_KIND_OPTIONS.find(({ value }) => value === kind);
  return option?.value ?? "concept";
}

function ColorStudio(props: {
  color: string;
  copiedColor?: string;
  onChange: (color: string) => void;
  onCopy: () => void;
}) {
  return (
    <Suspense fallback={<div className="map-tool-loading" aria-label="Loading colour tools" />}>
      <LazyColorStudio {...props} />
    </Suspense>
  );
}

function ContentPicker(props: {
  value: LandmarkContentMode;
  onChange: (value: LandmarkContentMode) => void;
}) {
  return <Suspense fallback={<div className="map-tool-loading" />}><LazyContentPicker {...props} /></Suspense>;
}

function FormulaPicker(props: {
  markdown: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Suspense fallback={<div className="map-tool-loading" aria-label="Loading formulae" />}>
      <LazyLandmarkFormulaPicker {...props} />
    </Suspense>
  );
}

function LandmarkSizePicker(props: {
  width: number;
  height: number;
  onChange: (size: { width: number; height: number }) => void;
}) {
  return <Suspense fallback={<div className="map-tool-loading" />}><LazyLandmarkSizePicker {...props} /></Suspense>;
}

function KindPicker(props: {
  value: EditableLandmarkKind;
  onChange: (kind: EditableLandmarkKind, shape: ObjectShape) => void;
}) {
  return <Suspense fallback={<div className="map-tool-loading" />}><LazyKindPicker {...props} /></Suspense>;
}

function GroupTitleTools(props: {
  value: GroupTitlePosition;
  shape: GroupShape;
  fontSize: number;
  onPositionChange: (position: GroupTitlePosition) => void;
  onFontSizePreview: (fontSize: number) => void;
  onFontSizeCommit: (fontSize: number) => void;
}) {
  return <Suspense fallback={<div className="map-tool-loading" />}><LazyTitleAnchorPicker {...props} /></Suspense>;
}

function GroupSurfaceTools(props: {
  fillOpacity: number;
  borderWeight: GroupBorderWeight;
  showFill?: boolean;
  onFillOpacityPreview: (opacity: number) => void;
  onFillOpacityCommit: (opacity: number) => void;
  onBorderWeightChange: (weight: GroupBorderWeight) => void;
}) {
  return <Suspense fallback={<div className="map-tool-loading" />}><LazyGroupSurfaceTools {...props} /></Suspense>;
}

function LandmarkShapePicker(props: {
  value: ObjectShape;
  onChange: (shape: ObjectShape) => void;
}) {
  return (
    <Suspense fallback={<div className="map-tool-loading" />}>
      <LazyShapePicker
        value={props.value}
        options={OBJECT_SHAPE_OPTIONS}
        onChange={(shape) => {
          if (isObjectShape(shape)) props.onChange(shape);
        }}
      />
    </Suspense>
  );
}

function GroupShapePicker(props: {
  value: GroupShape;
  onChange: (shape: GroupShape) => void;
}) {
  return (
    <Suspense fallback={<div className="map-tool-loading" />}>
      <LazyShapePicker {...props} options={GROUP_SHAPE_OPTIONS} />
    </Suspense>
  );
}

function GroupLevelPicker({
  value,
  onChange,
}: {
  value: GroupLevel;
  onChange: (level: GroupLevel) => void;
}) {
  return (
    <div className="map-group-level-picker" aria-label="Canvas group level">
      {groupLevelOptions.map(({ value: option, label, icon: Icon }) => (
        <button
          key={option}
          type="button"
          data-group-level={option}
          aria-pressed={value === option}
          title={label}
          onClick={() => onChange(option)}
        >
          <Icon size={17} aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

interface CanvasMenuContentProps {
  kind: "canvas";
  landmarkCreationKind?: EditableLandmarkKind;
  groupCreationLevel?: GroupLevel;
  informalNotePending: boolean;
  informalNoteError?: string;
  onCreateLandmark: (kind: EditableLandmarkKind, title: string) => void | Promise<void>;
  onCreateGroup: (level: GroupLevel, title: string) => void;
  onBeginLandmarkCreation: (kind: EditableLandmarkKind) => void;
  onBeginGroupCreation: (level: GroupLevel) => void;
  onBackFromLandmarkCreation: () => void;
  onBackFromGroupCreation: () => void;
  onCancel: () => void;
}

interface LandmarkMenuContentProps {
  kind: "landmark";
  landmark: Pick<Landmark, "id" | "title" | "kind">;
  shape: ObjectShape;
  contentMode: LandmarkContentMode;
  formulaIndex: number;
  formulaMarkdown: string;
  width: number;
  height: number;
  color: string;
  copiedColor?: string;
  panel: "kind" | "shape" | "content" | "size" | "color";
  onPanelChange: (panel: AtlasContextPanel) => void;
  onKindChange: (kind: EditableLandmarkKind, shape: ObjectShape) => void;
  onAppearanceChange: (patch: LandmarkCustomization) => void;
  onContentModeChange: (contentMode: LandmarkContentMode) => void;
  onSizeChange: (size: { width: number; height: number }) => void;
  onCopyColor: () => void;
  onRemove?: () => void;
}

interface GroupMenuContentProps {
  kind: "group";
  group: {
    title: string;
    variant: "subject" | "region" | "custom";
    level: GroupLevel;
    shape: GroupShape;
    titlePosition: GroupTitlePosition;
    titleFontSize: number;
    borderStyle: GroupBorderStyle;
    fillOpacity: number;
    borderWeight: GroupBorderWeight;
    color: string;
  };
  copiedColor?: string;
  panel: "level" | "shape" | "anchor" | "frame" | "color";
  onPanelChange: (panel: AtlasContextPanel) => void;
  onTitleCommit: (title: string) => void;
  onLevelChange: (level: GroupLevel) => void;
  onAppearanceChange: (patch: GroupCustomization) => void;
  onTitleFontSizePreview: (titleFontSize: number) => void;
  onFillOpacityPreview: (fillOpacity: number) => void;
  onFillOpacityCommit: (fillOpacity: number) => void;
  onCopyColor: () => void;
  onDelete?: () => void;
}

interface ConnectionMenuContentProps {
  kind: "connection";
  connection: {
    label: string;
    direction: ConnectionDirection;
    lineStyle: ConnectionLineStyle;
    pathStyle: ConnectionPathStyle;
    color: string;
  };
  copiedColor?: string;
  panel: "direction" | "line" | "path" | "color";
  onPanelChange: (panel: AtlasContextPanel) => void;
  onChange: (patch: ConnectionCustomization) => void;
  onCopyColor: () => void;
  onDelete: () => void;
}

export type DeferredAtlasMenuContentProps =
  | CanvasMenuContentProps
  | LandmarkMenuContentProps
  | GroupMenuContentProps
  | ConnectionMenuContentProps;

export default function DeferredAtlasMenuContent(props: DeferredAtlasMenuContentProps) {
  if (props.kind === "canvas") {
    const creationOption = props.groupCreationLevel
      ? groupLevelOptions.find(({ value }) => value === props.groupCreationLevel)
      : undefined;
    const GroupCreationIcon = creationOption?.icon;
    if (props.landmarkCreationKind) {
      const creationKind = props.landmarkCreationKind;
      return (
        <Suspense fallback={<div className="map-tool-panel map-create-name map-tool-loading" />}>
          <LazyLandmarkCreationForm
            icon={<ShapeGlyph shape={defaultLandmarkShape(creationKind)} />}
            kindLabel={landmarkKindLabel(creationKind)}
            onCreate={(title) => props.onCreateLandmark(creationKind, title)}
            onBack={props.onBackFromLandmarkCreation}
            onCancel={props.onCancel}
          />
        </Suspense>
      );
    }
    if (props.groupCreationLevel && GroupCreationIcon) {
      const creationLevel = props.groupCreationLevel;
      return (
        <Suspense fallback={<div className="map-tool-panel map-create-name map-tool-loading" />}>
          <LazyLandmarkCreationForm
            icon={<GroupCreationIcon size={18} aria-hidden="true" />}
            kindLabel={groupLevelLabel(creationLevel)}
            fileName={false}
            onCreate={(title) => props.onCreateGroup(creationLevel, title)}
            onBack={props.onBackFromGroupCreation}
            onCancel={props.onCancel}
          />
        </Suspense>
      );
    }
    return (
      <Suspense fallback={<div className="map-tool-panel map-create-menu map-tool-loading" />}>
        <LazyCanvasCreationPalette
          groupOptions={groupLevelOptions}
          onCreateGroup={props.onBeginGroupCreation}
          onCreateLandmark={props.onBeginLandmarkCreation}
          informalNotePending={props.informalNotePending}
          informalNoteError={props.informalNoteError}
        />
      </Suspense>
    );
  }

  if (props.kind === "landmark") {
    return (
      <>
        <MapMenuHeader>
          <MapMenuTitle>{props.landmark.title}</MapMenuTitle>
          {props.onRemove && (
            <button
              type="button"
              className="map-menu-delete"
              aria-label="Remove from canvas"
              title="Remove from canvas"
              onClick={props.onRemove}
            >
              <Trash2 size={15} aria-hidden="true" />
            </button>
          )}
        </MapMenuHeader>
        <ToolTabs tabs={landmarkToolTabs} active={props.panel} onChange={props.onPanelChange} />
        <MapMenuBody>
          {props.panel === "kind" && (
            <KindPicker value={editableKindFor(props.landmark.kind)} onChange={props.onKindChange} />
          )}
          {props.panel === "shape" && (
            <LandmarkShapePicker value={props.shape} onChange={(shape) => props.onAppearanceChange({ shape })} />
          )}
          {props.panel === "content" && (
            <>
              <ContentPicker value={props.contentMode} onChange={props.onContentModeChange} />
              {props.contentMode === "formula" && (
                <FormulaPicker
                  markdown={props.formulaMarkdown}
                  value={props.formulaIndex}
                  onChange={(formulaIndex) => props.onAppearanceChange({ formulaIndex })}
                />
              )}
            </>
          )}
          {props.panel === "size" && (
            <LandmarkSizePicker width={props.width} height={props.height} onChange={props.onSizeChange} />
          )}
          {props.panel === "color" && (
            <ColorStudio
              color={props.color}
              copiedColor={props.copiedColor}
              onCopy={props.onCopyColor}
              onChange={(color) => props.onAppearanceChange({ color })}
            />
          )}
        </MapMenuBody>
      </>
    );
  }

  if (props.kind === "group") {
    const panel = props.group.level === "subject" && (props.panel === "color" || props.panel === "shape")
      ? "level"
      : props.panel;
    return (
      <>
        <MapMenuHeader>
          <MapMenuTextField
            type="text"
            aria-label="Group name"
            value={props.group.title}
            maxLength={160}
            spellCheck={false}
            onCommit={props.onTitleCommit}
          />
          {props.onDelete && (
            <button type="button" className="map-menu-delete" aria-label="Delete group" title="Delete group" onClick={props.onDelete}>
              <Trash2 size={15} aria-hidden="true" />
            </button>
          )}
        </MapMenuHeader>
        <ToolTabs
          tabs={props.group.level === "subject" ? subjectGroupToolTabs : groupToolTabs}
          active={panel}
          onChange={props.onPanelChange}
        />
        <MapMenuBody>
          {panel === "level" && (
            <GroupLevelPicker value={props.group.level} onChange={props.onLevelChange} />
          )}
          {panel === "shape" && (
            <GroupShapePicker value={props.group.shape} onChange={(shape) => props.onAppearanceChange({ shape })} />
          )}
          {panel === "anchor" && (
            <GroupTitleTools
              shape={props.group.shape}
              value={props.group.titlePosition}
              fontSize={props.group.titleFontSize}
              onPositionChange={(titlePosition) => props.onAppearanceChange({ titlePosition })}
              onFontSizePreview={props.onTitleFontSizePreview}
              onFontSizeCommit={(titleFontSize) => props.onAppearanceChange({ titleFontSize })}
            />
          )}
          {panel === "frame" && (
            <div className="map-frame-tools">
              <Suspense fallback={<div className="map-tool-loading" />}>
                <LazyCompactPicker
                  kind="frame"
                  value={props.group.borderStyle}
                  onChange={(borderStyle) => props.onAppearanceChange({ borderStyle })}
                />
              </Suspense>
              <GroupSurfaceTools
                fillOpacity={props.group.fillOpacity}
                borderWeight={props.group.borderWeight}
                showFill={props.group.level !== "subject"}
                onFillOpacityPreview={props.onFillOpacityPreview}
                onFillOpacityCommit={props.onFillOpacityCommit}
                onBorderWeightChange={(borderWeight) => props.onAppearanceChange({ borderWeight })}
              />
            </div>
          )}
          {panel === "color" && props.group.level !== "subject" && (
            <ColorStudio
              color={props.group.color}
              copiedColor={props.copiedColor}
              onCopy={props.onCopyColor}
              onChange={(color) => props.onAppearanceChange({ color })}
            />
          )}
        </MapMenuBody>
      </>
    );
  }

  return (
    <>
      <MapMenuHeader>
        <MapMenuTextField
          type="text"
          aria-label="Connection label"
          value={props.connection.label}
          maxLength={MAX_CONNECTION_LABEL_LENGTH}
          onCommit={(label) => props.onChange({ label: label.trim() })}
        />
        <button type="button" className="map-menu-delete" aria-label="Delete connection" title="Delete connection" onClick={props.onDelete}>
          <Trash2 size={15} aria-hidden="true" />
        </button>
      </MapMenuHeader>
      <ToolTabs tabs={connectionToolTabs} active={props.panel} onChange={props.onPanelChange} />
      <MapMenuBody>
        {props.panel === "direction" && (
          <Suspense fallback={<div className="map-tool-loading" />}>
            <LazyCompactPicker kind="direction" value={props.connection.direction} onChange={(direction) => props.onChange({ direction })} />
          </Suspense>
        )}
        {props.panel === "line" && (
          <Suspense fallback={<div className="map-tool-loading" />}>
            <LazyCompactPicker kind="line" value={props.connection.lineStyle} onChange={(lineStyle) => props.onChange({ lineStyle })} />
          </Suspense>
        )}
        {props.panel === "path" && (
          <Suspense fallback={<div className="map-tool-loading" />}>
            <LazyCompactPicker kind="path" value={props.connection.pathStyle} onChange={(pathStyle) => props.onChange({ pathStyle })} />
          </Suspense>
        )}
        {props.panel === "color" && (
          <ColorStudio
            color={props.connection.color}
            copiedColor={props.copiedColor}
            onCopy={props.onCopyColor}
            onChange={(color) => props.onChange({ color })}
          />
        )}
      </MapMenuBody>
    </>
  );
}
