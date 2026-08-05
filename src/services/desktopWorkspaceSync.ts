import type { Viewport } from "@xyflow/react";
import type { Placement } from "../domain/types";
import type { MapCustomizations } from "../state/mapCustomizationStore";
import type { CanonicalDesktopCamera } from "./desktopProjection";
import {
  isDesktopCanvasDragEvent,
  type DesktopCanvasDragEvent,
} from "./desktopCanvasDrag";

export interface DesktopSyncRevision {
  clock: number;
  origin: string;
}

export interface DesktopSelectionSnapshot {
  landmarkId?: string;
  filePath?: string;
}

export interface DesktopAtlasSnapshot {
  placements: Placement[];
  customizations: MapCustomizations;
  /** Companion surfaces ask the primary surface to perform the canonical write. */
  requestCommit: boolean;
}

export interface DesktopNoteSnapshot {
  path: string;
  markdown: string;
}

export interface DesktopWorkspaceBridge {
  publishViewport(viewport: Viewport): void;
  publishSelection(selection: DesktopSelectionSnapshot): void;
  publishAtlas(snapshot: DesktopAtlasSnapshot): void;
  publishAtlasRevision(revision: string): void;
  publishContentChanged(): void;
  publishCanvasDrag(event: DesktopCanvasDragEvent): void;
}

type SyncPayloads = {
  camera: CanonicalDesktopCamera;
  selection: DesktopSelectionSnapshot;
  atlas: DesktopAtlasSnapshot;
  "atlas-revision": { revision: string };
  note: DesktopNoteSnapshot;
  content: { changed: true };
  drag: DesktopCanvasDragEvent;
};

type SyncKind = keyof SyncPayloads;

interface DesktopSyncMessage<K extends SyncKind = SyncKind> {
  version: 1;
  kind: K;
  revision: DesktopSyncRevision;
  payload: SyncPayloads[K];
}

interface MessageEventLike {
  data: unknown;
}

interface ChannelLike {
  postMessage(message: unknown): void;
  close(): void;
  addEventListener(type: "message", listener: (event: MessageEventLike) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEventLike) => void): void;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface StorageEventLike {
  key: string | null;
  newValue: string | null;
}

interface StorageEventTargetLike {
  addEventListener(type: "storage", listener: (event: StorageEventLike) => void): void;
  removeEventListener(type: "storage", listener: (event: StorageEventLike) => void): void;
}

interface DesktopWorkspaceSyncOptions {
  origin?: string;
  channelFactory?: (name: string) => ChannelLike | undefined;
  storage?: StorageLike;
  storageEvents?: StorageEventTargetLike;
}

const CHANNEL_NAME = "math-atlas:desktop-workspace:v1";
const CAMERA_STORAGE_KEY = "math-atlas:desktop-camera:v1";
const BUS_STORAGE_KEY = "math-atlas:desktop-workspace-message:v1";

function makeOrigin() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

function compareRevision(left: DesktopSyncRevision, right: DesktopSyncRevision) {
  return left.clock - right.clock || left.origin.localeCompare(right.origin);
}

function validRevision(value: unknown): value is DesktopSyncRevision {
  if (!value || typeof value !== "object") return false;
  const revision = value as Partial<DesktopSyncRevision>;
  return Number.isSafeInteger(revision.clock) &&
    Number(revision.clock) >= 0 &&
    typeof revision.origin === "string" &&
    revision.origin.length > 0;
}

function validCamera(value: unknown): value is CanonicalDesktopCamera {
  if (!value || typeof value !== "object") return false;
  const camera = value as Partial<CanonicalDesktopCamera>;
  return Number.isFinite(camera.x) && Number.isFinite(camera.y) &&
    Number.isFinite(camera.zoom) && Number(camera.zoom) > 0;
}

function isMessage(value: unknown): value is DesktopSyncMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<DesktopSyncMessage>;
  return message.version === 1 &&
    ["camera", "selection", "atlas", "atlas-revision", "note", "content", "drag"]
      .includes(String(message.kind)) &&
    validRevision(message.revision) &&
    message.payload !== undefined;
}

function defaultChannelFactory(name: string): ChannelLike | undefined {
  try {
    return typeof BroadcastChannel === "function"
      ? new BroadcastChannel(name) as unknown as ChannelLike
      : undefined;
  } catch {
    return undefined;
  }
}

function defaultStorage(): StorageLike | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Cross-WebView event bus with deterministic Lamport ordering. Receivers never
 * emit automatically, so applying a remote snapshot cannot create feedback.
 */
export class DesktopWorkspaceSync {
  readonly origin: string;
  private clock = 0;
  private readonly latest = new Map<SyncKind, DesktopSyncRevision>();
  private readonly listeners = new Map<SyncKind, Set<(payload: never) => void>>();
  private readonly channel?: ChannelLike;
  private readonly storage?: StorageLike;
  private readonly storageEvents?: StorageEventTargetLike;

  constructor(options: DesktopWorkspaceSyncOptions = {}) {
    this.origin = options.origin ?? makeOrigin();
    this.storage = options.storage ?? defaultStorage();
    this.storageEvents = options.storageEvents ??
      (typeof window === "undefined" ? undefined : window as unknown as StorageEventTargetLike);
    this.channel = (options.channelFactory ?? defaultChannelFactory)(CHANNEL_NAME);
    this.channel?.addEventListener("message", this.handleChannelMessage);
    this.storageEvents?.addEventListener("storage", this.handleStorageMessage);
  }

  close() {
    this.channel?.removeEventListener("message", this.handleChannelMessage);
    this.channel?.close();
    this.storageEvents?.removeEventListener("storage", this.handleStorageMessage);
    this.listeners.clear();
  }

  storedCamera(): CanonicalDesktopCamera | undefined {
    try {
      const message: unknown = JSON.parse(this.storage?.getItem(CAMERA_STORAGE_KEY) ?? "null");
      if (!isMessage(message) || message.kind !== "camera" || !validCamera(message.payload)) {
        return undefined;
      }
      this.observe(message.revision);
      this.latest.set("camera", message.revision);
      return message.payload;
    } catch {
      return undefined;
    }
  }

  publishCamera(camera: CanonicalDesktopCamera) {
    if (!validCamera(camera)) return;
    this.publish("camera", camera);
  }

  publishSelection(selection: DesktopSelectionSnapshot) {
    this.publish("selection", selection);
  }

  publishAtlas(snapshot: DesktopAtlasSnapshot) {
    this.publish("atlas", snapshot);
  }

  publishAtlasRevision(revision: string) {
    this.publish("atlas-revision", { revision });
  }

  publishNote(note: DesktopNoteSnapshot) {
    this.publish("note", note);
  }

  publishContentChanged() {
    this.publish("content", { changed: true });
  }

  publishCanvasDrag(event: DesktopCanvasDragEvent) {
    if (!isDesktopCanvasDragEvent(event)) return;
    this.publish("drag", event);
  }

  onCamera(listener: (camera: CanonicalDesktopCamera) => void) {
    return this.subscribe("camera", listener);
  }

  onSelection(listener: (selection: DesktopSelectionSnapshot) => void) {
    return this.subscribe("selection", listener);
  }

  onAtlas(listener: (snapshot: DesktopAtlasSnapshot) => void) {
    return this.subscribe("atlas", listener);
  }

  onAtlasRevision(listener: (revision: string) => void) {
    return this.subscribe("atlas-revision", ({ revision }) => listener(revision));
  }

  onNote(listener: (note: DesktopNoteSnapshot) => void) {
    return this.subscribe("note", listener);
  }

  onContentChanged(listener: () => void) {
    return this.subscribe("content", () => listener());
  }

  onCanvasDrag(listener: (event: DesktopCanvasDragEvent) => void) {
    return this.subscribe("drag", listener);
  }

  private subscribe<K extends SyncKind>(
    kind: K,
    listener: (payload: SyncPayloads[K]) => void,
  ) {
    let listeners = this.listeners.get(kind);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(kind, listeners);
    }
    listeners.add(listener as (payload: never) => void);
    return () => listeners?.delete(listener as (payload: never) => void);
  }

  private publish<K extends SyncKind>(kind: K, payload: SyncPayloads[K]) {
    const revision = { clock: this.clock + 1, origin: this.origin };
    this.clock = revision.clock;
    this.latest.set(kind, revision);
    const message: DesktopSyncMessage<K> = { version: 1, kind, revision, payload };
    if (kind === "camera") this.store(CAMERA_STORAGE_KEY, message);
    this.channel?.postMessage(message);
    this.store(BUS_STORAGE_KEY, message);
  }

  private readonly handleChannelMessage = (event: MessageEventLike) => {
    this.receive(event.data);
  };

  private readonly handleStorageMessage = (event: StorageEventLike) => {
    if (event.key !== BUS_STORAGE_KEY || !event.newValue) return;
    try {
      this.receive(JSON.parse(event.newValue));
    } catch {
      // Ignore corrupt or unrelated storage traffic.
    }
  };

  private receive(value: unknown) {
    if (!isMessage(value) || value.revision.origin === this.origin) return;
    if (value.kind === "drag" && !isDesktopCanvasDragEvent(value.payload)) return;
    const current = this.latest.get(value.kind);
    if (current && compareRevision(value.revision, current) <= 0) return;
    this.observe(value.revision);
    this.latest.set(value.kind, value.revision);
    if (value.kind === "camera" && validCamera(value.payload)) {
      this.store(CAMERA_STORAGE_KEY, value);
    }
    this.listeners.get(value.kind)?.forEach((listener) => listener(value.payload as never));
  }

  private observe(revision: DesktopSyncRevision) {
    this.clock = Math.max(this.clock, revision.clock);
  }

  private store(key: string, value: unknown) {
    try {
      this.storage?.setItem(key, JSON.stringify(value));
    } catch {
      // BroadcastChannel remains sufficient if shared storage is unavailable.
    }
  }
}
