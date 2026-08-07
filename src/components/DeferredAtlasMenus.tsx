import { lazy, Suspense } from "react";
import type { GroupShape } from "../domain/mapAppearance";
import type { Landmark, SubjectId } from "../domain/types";
import type {
  ConnectionCustomization,
  ConnectionDirection,
  ConnectionLineStyle,
  ConnectionPathStyle,
  EditableLandmarkKind,
  GroupBorderStyle,
  GroupBorderWeight,
  GroupCustomization,
  GroupLevel,
  GroupTitlePosition,
  LandmarkCustomization,
} from "../state/mapCustomizationStore";
import type { LandmarkGraphNode } from "./LandmarkNode";
import type {
  AtlasContextPanel,
  DeferredAtlasMenuContentProps,
} from "./DeferredAtlasMenuContent";
export type { AtlasContextPanel } from "./DeferredAtlasMenuContent";

const LazyDeferredAtlasMenuContent = lazy(() => import("./DeferredAtlasMenuContent"));
const LazyMapContextMenu = lazy(() => import("./MapContextMenu").then((module) => ({
  default: module.MapContextMenu,
})));

export type AtlasMenuState =
  | { kind: "canvas"; x: number; y: number; flowX: number; flowY: number; subjectId: SubjectId }
  | { kind: "landmark"; x: number; y: number; landmarkId: string }
  | { kind: "group"; x: number; y: number; regionId: string }
  | { kind: "connection"; x: number; y: number; connectionId: string };

interface MenuGroup {
  region: { id: string; title: string };
  nodeId: string;
  variant: "region" | "subject" | "custom";
  level: GroupLevel;
  color: string;
  shape: GroupShape;
  borderStyle: GroupBorderStyle;
  borderWeight: GroupBorderWeight;
  fillOpacity: number;
  titlePosition: GroupTitlePosition;
  titleFontSize: number;
}

interface MenuConnection {
  id: string;
  label: string;
  direction: ConnectionDirection;
  lineStyle: ConnectionLineStyle;
  pathStyle: ConnectionPathStyle;
  color: string;
}

interface DeferredAtlasMenusProps {
  menu: AtlasMenuState;
  landmarkCreationKind?: EditableLandmarkKind;
  groupCreationLevel?: GroupLevel;
  informalNotePending: boolean;
  informalNoteError?: string;
  contextLandmark?: Landmark;
  contextLandmarkNode?: LandmarkGraphNode;
  contextGroup?: MenuGroup;
  selectedConnection?: MenuConnection;
  copiedColor?: string;
  panel: AtlasContextPanel;
  onPanelChange: (panel: AtlasContextPanel) => void;
  onClose: () => void;
  onBackFromLandmarkCreation: () => void;
  onBackFromGroupCreation: () => void;
  onCreateLandmark: (kind: EditableLandmarkKind, title: string) => void | Promise<void>;
  onCreateGroup: (level: GroupLevel, title: string) => void;
  onBeginLandmarkCreation: (kind: EditableLandmarkKind) => void;
  onBeginGroupCreation: (level: GroupLevel) => void;
  onLandmarkKindChange: (landmarkId: string, kind: EditableLandmarkKind) => void;
  onLandmarkAppearanceChange: (landmarkId: string, patch: LandmarkCustomization) => void;
  onGroupLevelChange: (regionId: string, level: GroupLevel) => void;
  onGroupAppearanceChange: (regionId: string, patch: GroupCustomization) => void;
  onGroupTitleFontSizePreview: (nodeId: string, titleFontSize: number) => void;
  onGroupFillOpacityPreview: (regionId: string, fillOpacity: number) => void;
  onGroupFillOpacityCommit: (regionId: string, fillOpacity: number) => void;
  onCopyColor: (color: string) => void;
  onDeleteSelected: () => boolean;
  onRemoveLandmark?: (landmarkId: string) => void;
  onDeleteCustomGroup: (regionId: string) => void;
  onConnectionChange: (connectionId: string, patch: ConnectionCustomization) => void;
  onDeleteConnection: (connectionId: string) => void;
}

function groupLevelLabel(level: GroupLevel) {
  if (level === "subject") return "Subject";
  return level === "subgroup" ? "Subgroup" : "Group";
}

function landmarkKindLabel(kind: EditableLandmarkKind) {
  return kind === "concept"
    ? "Note"
    : `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
}

function panelForLandmark(panel: AtlasContextPanel) {
  return panel === "kind" || panel === "shape" || panel === "content" || panel === "size" || panel === "color"
    ? panel
    : "kind";
}

function panelForGroup(panel: AtlasContextPanel) {
  return panel === "level" || panel === "shape" || panel === "anchor" || panel === "frame" || panel === "color"
    ? panel
    : "level";
}

function panelForConnection(panel: AtlasContextPanel) {
  return panel === "direction" || panel === "line" || panel === "path" || panel === "color"
    ? panel
    : "direction";
}

function DeferredContextMenu({
  x,
  y,
  label,
  onClose,
  content,
}: {
  x: number;
  y: number;
  label: string;
  onClose: () => void;
  content: DeferredAtlasMenuContentProps;
}) {
  return (
    <LazyMapContextMenu x={x} y={y} label={label} onClose={onClose}>
      <Suspense fallback={<div className={content.kind === "canvas" ? "map-tool-panel map-tool-loading" : "map-tool-loading"} />}>
        <LazyDeferredAtlasMenuContent {...content} />
      </Suspense>
    </LazyMapContextMenu>
  );
}

/** Menu-only orchestration kept out of the map's steady-state interaction chunk. */
export default function DeferredAtlasMenus({
  menu,
  landmarkCreationKind,
  groupCreationLevel,
  informalNotePending,
  informalNoteError,
  contextLandmark,
  contextLandmarkNode,
  contextGroup,
  selectedConnection,
  copiedColor,
  panel,
  onPanelChange,
  onClose,
  onBackFromLandmarkCreation,
  onBackFromGroupCreation,
  onCreateLandmark,
  onCreateGroup,
  onBeginLandmarkCreation,
  onBeginGroupCreation,
  onLandmarkKindChange,
  onLandmarkAppearanceChange,
  onGroupLevelChange,
  onGroupAppearanceChange,
  onGroupTitleFontSizePreview,
  onGroupFillOpacityPreview,
  onGroupFillOpacityCommit,
  onCopyColor,
  onDeleteSelected,
  onRemoveLandmark,
  onDeleteCustomGroup,
  onConnectionChange,
  onDeleteConnection,
}: DeferredAtlasMenusProps) {
  if (menu.kind === "canvas") {
    return (
      <DeferredContextMenu
        key={landmarkCreationKind ? `name:${landmarkCreationKind}` : groupCreationLevel ? `name:${groupCreationLevel}` : "objects"}
        x={menu.x}
        y={menu.y}
        label={landmarkCreationKind
          ? `Name ${landmarkKindLabel(landmarkCreationKind)}`
          : groupCreationLevel
            ? `Name ${groupLevelLabel(groupCreationLevel)}`
            : "Create map object"}
        onClose={onClose}
        content={{
          kind: "canvas",
          landmarkCreationKind,
          groupCreationLevel,
          informalNotePending,
          informalNoteError,
          onCreateLandmark,
          onCreateGroup,
          onBeginLandmarkCreation,
          onBeginGroupCreation,
          onBackFromLandmarkCreation,
          onBackFromGroupCreation,
          onCancel: onClose,
        }}
      />
    );
  }

  if (menu.kind === "landmark" && contextLandmark && contextLandmarkNode) {
    const width = contextLandmarkNode.width ?? 224;
    const height = contextLandmarkNode.height ?? 112;
    return (
      <DeferredContextMenu
        x={menu.x}
        y={menu.y}
        label={`Edit ${contextLandmark.title}`}
        onClose={onClose}
        content={{
          kind: "landmark",
          landmark: contextLandmark,
          shape: contextLandmarkNode.data.shape,
          contentMode: contextLandmarkNode.data.contentMode,
          formulaIndex: contextLandmarkNode.data.formulaIndex,
          formulaMarkdown: contextLandmarkNode.data.previewMarkdown ?? contextLandmark.markdown,
          width,
          height,
          color: contextLandmarkNode.data.color,
          copiedColor,
          panel: panelForLandmark(panel),
          onPanelChange,
          onKindChange: (kind, shape) => {
            onLandmarkKindChange(contextLandmark.id, kind);
            onLandmarkAppearanceChange(contextLandmark.id, { shape });
          },
          onAppearanceChange: (patch) => onLandmarkAppearanceChange(contextLandmark.id, patch),
          onContentModeChange: (contentMode) => {
            const compact = width <= 224 && height <= 112;
            onLandmarkAppearanceChange(contextLandmark.id, {
              contentMode,
              ...(contentMode !== "title" && compact ? { width: 336, height: 196 } : {}),
            });
          },
          onSizeChange: (size) => onLandmarkAppearanceChange(contextLandmark.id, {
            width: Math.max(112, Math.round(size.width / 28) * 28),
            height: Math.max(56, Math.round(size.height / 28) * 28),
          }),
          onCopyColor: () => onCopyColor(contextLandmarkNode.data.color),
          onRemove: onRemoveLandmark ? () => {
            if (!onDeleteSelected()) onRemoveLandmark(contextLandmark.id);
          } : undefined,
        }}
      />
    );
  }

  if (menu.kind === "group" && contextGroup) {
    return (
      <DeferredContextMenu
        x={menu.x}
        y={menu.y}
        label={`Edit ${contextGroup.region.title}`}
        onClose={onClose}
        content={{
          kind: "group",
          group: {
            title: contextGroup.region.title,
            variant: contextGroup.variant,
            level: contextGroup.level,
            shape: contextGroup.shape,
            titlePosition: contextGroup.titlePosition,
            titleFontSize: contextGroup.titleFontSize,
            borderStyle: contextGroup.borderStyle,
            fillOpacity: contextGroup.fillOpacity,
            borderWeight: contextGroup.borderWeight,
            color: contextGroup.color,
          },
          copiedColor,
          panel: panelForGroup(panel),
          onPanelChange,
          onTitleCommit: (title) => onGroupAppearanceChange(contextGroup.region.id, {
            title: title.trim() || `Untitled ${contextGroup.level}`,
          }),
          onLevelChange: (level) => onGroupLevelChange(contextGroup.region.id, level),
          onAppearanceChange: (patch) => onGroupAppearanceChange(contextGroup.region.id, patch),
          onTitleFontSizePreview: (fontSize) => onGroupTitleFontSizePreview(contextGroup.nodeId, fontSize),
          onFillOpacityPreview: (fillOpacity) => onGroupFillOpacityPreview(contextGroup.region.id, fillOpacity),
          onFillOpacityCommit: (fillOpacity) => onGroupFillOpacityCommit(contextGroup.region.id, fillOpacity),
          onCopyColor: () => onCopyColor(contextGroup.color),
          onDelete: contextGroup.variant === "custom" ? () => {
            if (!onDeleteSelected()) onDeleteCustomGroup(contextGroup.region.id);
          } : undefined,
        }}
      />
    );
  }

  if (menu.kind === "connection" && selectedConnection) {
    return (
      <DeferredContextMenu
        x={menu.x}
        y={menu.y}
        label="Edit connection"
        onClose={onClose}
        content={{
          kind: "connection",
          connection: selectedConnection,
          copiedColor,
          panel: panelForConnection(panel),
          onPanelChange,
          onChange: (patch) => onConnectionChange(selectedConnection.id, patch),
          onCopyColor: () => onCopyColor(selectedConnection.color),
          onDelete: () => {
            if (!onDeleteSelected()) onDeleteConnection(selectedConnection.id);
          },
        }}
      />
    );
  }

  return null;
}
