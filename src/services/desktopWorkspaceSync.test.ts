import { describe, expect, it, vi } from "vitest";
import { DesktopWorkspaceSync } from "./desktopWorkspaceSync";

interface Listener {
  (event: { data: unknown }): void;
}

class MemoryHub {
  channels = new Set<MemoryChannel>();
  messages: unknown[] = [];

  open() {
    const channel = new MemoryChannel(this);
    this.channels.add(channel);
    return channel;
  }

  deliver(sender: MemoryChannel, message: unknown) {
    this.messages.push(message);
    this.channels.forEach((channel) => {
      if (channel !== sender) channel.emit(message);
    });
  }
}

class MemoryChannel {
  listeners = new Set<Listener>();
  constructor(private readonly hub: MemoryHub) {}
  postMessage(message: unknown) { this.hub.deliver(this, message); }
  close() { this.hub.channels.delete(this); }
  addEventListener(_type: "message", listener: Listener) { this.listeners.add(listener); }
  removeEventListener(_type: "message", listener: Listener) { this.listeners.delete(listener); }
  emit(data: unknown) { this.listeners.forEach((listener) => listener({ data })); }
}

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const noStorageEvents = {
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
};

describe("DesktopWorkspaceSync", () => {
  it("synchronizes canonical cameras once without echoing to the origin", () => {
    const hub = new MemoryHub();
    const storage = new MemoryStorage();
    const left = new DesktopWorkspaceSync({
      origin: "left",
      channelFactory: () => hub.open(),
      storage,
      storageEvents: noStorageEvents,
    });
    const right = new DesktopWorkspaceSync({
      origin: "right",
      channelFactory: () => hub.open(),
      storage,
      storageEvents: noStorageEvents,
    });
    const onLeft = vi.fn();
    const onRight = vi.fn();
    left.onCamera(onLeft);
    right.onCamera(onRight);

    left.publishCamera({ x: -340, y: 120, zoom: 1.4 });

    expect(onLeft).not.toHaveBeenCalled();
    expect(onRight).toHaveBeenCalledOnce();
    expect(onRight).toHaveBeenCalledWith({ x: -340, y: 120, zoom: 1.4 });

    // Duplicate transport delivery is ignored by its Lamport revision.
    const message = hub.messages[0];
    [...hub.channels][1].emit(message);
    expect(onRight).toHaveBeenCalledOnce();
  });

  it("persists the physical camera for monitor windows that join later", () => {
    const hub = new MemoryHub();
    const storage = new MemoryStorage();
    const first = new DesktopWorkspaceSync({
      origin: "first",
      channelFactory: () => hub.open(),
      storage,
      storageEvents: noStorageEvents,
    });
    first.publishCamera({ x: 810, y: -220, zoom: .84 });

    const late = new DesktopWorkspaceSync({
      origin: "late",
      channelFactory: () => hub.open(),
      storage,
      storageEvents: noStorageEvents,
    });
    expect(late.storedCamera()).toEqual({ x: 810, y: -220, zoom: .84 });
  });

  it("carries optimistic atlas snapshots, coordinator revisions, and selection separately", () => {
    const hub = new MemoryHub();
    const storage = new MemoryStorage();
    const controller = new DesktopWorkspaceSync({
      origin: "controller",
      channelFactory: () => hub.open(),
      storage,
      storageEvents: noStorageEvents,
    });
    const companion = new DesktopWorkspaceSync({
      origin: "companion",
      channelFactory: () => hub.open(),
      storage,
      storageEvents: noStorageEvents,
    });
    const atlas = vi.fn();
    const revision = vi.fn();
    const selection = vi.fn();
    controller.onAtlas(atlas);
    companion.onAtlasRevision(revision);
    companion.onSelection(selection);

    companion.publishAtlas({
      placements: [{ landmarkId: "a", x: 12, y: 34 }],
      customizations: {
        schemaVersion: 1,
        snapshotKey: "test-atlas",
        landmarkKinds: {},
        landmarks: {},
        groups: {},
        customLandmarks: [],
        customGroups: [],
        connectionOverrides: {},
        customConnections: [],
      },
      requestCommit: true,
    });
    controller.publishAtlasRevision("sha256:new");
    controller.publishSelection({ landmarkId: "a", filePath: "Primary Field/A.md" });

    expect(atlas).toHaveBeenCalledWith(expect.objectContaining({ requestCommit: true }));
    expect(revision).toHaveBeenCalledWith("sha256:new");
    expect(selection).toHaveBeenCalledWith({
      landmarkId: "a",
      filePath: "Primary Field/A.md",
    });
  });

  it("hands a complete canvas drag to another monitor without echoing it", () => {
    const hub = new MemoryHub();
    const storage = new MemoryStorage();
    const left = new DesktopWorkspaceSync({
      origin: "left",
      channelFactory: () => hub.open(),
      storage,
      storageEvents: noStorageEvents,
    });
    const right = new DesktopWorkspaceSync({
      origin: "right",
      channelFactory: () => hub.open(),
      storage,
      storageEvents: noStorageEvents,
    });
    const onLeft = vi.fn();
    const onRight = vi.fn();
    left.onCanvasDrag(onLeft);
    right.onCanvasDrag(onRight);
    const drag = {
      gestureId: "monitor-0:one",
      ownerSurfaceId: "monitor-0",
      nodeId: "landmark-a",
      nodeKind: "landmark" as const,
      phase: "move" as const,
      startPointer: { x: -75, y: 220 },
      pointer: { x: 1984, y: 220 },
    };

    left.publishCanvasDrag(drag);

    expect(onLeft).not.toHaveBeenCalled();
    expect(onRight).toHaveBeenCalledOnce();
    expect(onRight).toHaveBeenCalledWith(drag);
  });
});
