import { describe, expect, it, vi } from "vitest";
import {
  DESKTOP_SURFACE_EVENT,
  DesktopSurfaceClient,
  DesktopSurfaceError,
  desktopStatusTargetsRecipient,
  sameDesktopStatusDelivery,
  virtualBoundsFor,
  type DesktopSurfaceStatus,
} from "./desktopSurface";

const status: DesktopSurfaceStatus = {
  available: true,
  active: true,
  role: "workspace",
  virtualBounds: { x: -1920, y: -600, width: 8320, height: 2160 },
  monitors: [],
  windowScaleFactor: 1.5,
  layoutRevision: 3,
};

describe("DesktopSurfaceClient", () => {
  it("uses stable commands for status, enter, exit, and display refresh", async () => {
    const commands: string[] = [];
    const invoke = async <T>(command: string): Promise<T> => {
      commands.push(command);
      return status as T;
    };
    const client = new DesktopSurfaceClient(invoke, () => true);

    await expect(client.getStatus()).resolves.toEqual(status);
    await expect(client.enter()).resolves.toEqual(status);
    await expect(client.exit()).resolves.toEqual(status);
    await expect(client.refresh()).resolves.toEqual(status);

    expect(commands).toEqual([
      "get_desktop_surface_status",
      "enter_desktop_surface",
      "exit_desktop_surface",
      "refresh_desktop_surface",
    ]);
  });

  it("is a harmless no-op in the browser", async () => {
    let invoked = false;
    const invoke = async <T>(): Promise<T> => {
      invoked = true;
      throw new Error("Browser fallback called native IPC.");
    };
    const client = new DesktopSurfaceClient(invoke, () => false);

    expect(client.isAvailable()).toBe(false);
    await expect(client.enter()).resolves.toMatchObject({
      available: false,
      active: false,
      monitors: [],
    });
    await expect(client.exit()).resolves.toMatchObject({ active: false });
    expect(invoked).toBe(false);
  });

  it("keeps structured native failures actionable", async () => {
    const client = new DesktopSurfaceClient(
      async <T>(): Promise<T> => {
        throw { code: "desktop_unavailable", message: "No attached display." };
      },
      () => true,
    );

    await expect(client.enter()).rejects.toEqual(
      new DesktopSurfaceError("desktop_unavailable", "No attached display."),
    );
  });

  it("registers native changes on the current WebviewWindow boundary", async () => {
    const stop = () => undefined;
    const listenForCurrentWindow = async (
      event: string,
      listener: (next: DesktopSurfaceStatus) => void,
    ) => {
      expect(event).toBe(DESKTOP_SURFACE_EVENT);
      listener(status);
      return stop;
    };
    const client = new DesktopSurfaceClient(
      async <T>() => status as T,
      () => true,
      listenForCurrentWindow,
    );
    const listener = vi.fn();

    await expect(client.onChange(listener)).resolves.toBe(stop);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(status);
  });
});

describe("recipient-specific desktop status", () => {
  const monitorStatus = (id: string): DesktopSurfaceStatus => ({
    ...status,
    role: "monitor",
    surface: {
      id,
      windowLabel: `desktop-${id}`,
      monitorId: id,
      isPrimary: id === "monitor-0",
      isController: id === "monitor-0",
      bounds: { x: 0, y: 0, width: 1920, height: 1040 },
      monitorBounds: { x: 0, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1,
    },
  });

  it("rejects another monitor's payload and keeps workspace payloads separate", () => {
    expect(desktopStatusTargetsRecipient(monitorStatus("monitor-1"), "monitor-1"))
      .toBe(true);
    expect(desktopStatusTargetsRecipient(monitorStatus("monitor-0"), "monitor-1"))
      .toBe(false);
    expect(desktopStatusTargetsRecipient(status, "monitor-1")).toBe(false);
    expect(desktopStatusTargetsRecipient(status)).toBe(true);
    expect(desktopStatusTargetsRecipient(monitorStatus("monitor-0"))).toBe(false);
  });

  it("does not discard a corrected recipient merely because its layout revision is equal", () => {
    const wrong = monitorStatus("monitor-0");
    const corrected = monitorStatus("monitor-1");
    expect(wrong.layoutRevision).toBe(corrected.layoutRevision);
    expect(sameDesktopStatusDelivery(wrong, corrected)).toBe(false);
    expect(sameDesktopStatusDelivery(corrected, { ...corrected })).toBe(true);
  });
});

describe("virtualBoundsFor", () => {
  it("preserves negative origins and monitor gaps", () => {
    expect(
      virtualBoundsFor([
        { bounds: { x: 0, y: 0, width: 2560, height: 1440 } },
        { bounds: { x: -1920, y: 240, width: 1920, height: 1080 } },
        { bounds: { x: 2560, y: -600, width: 3840, height: 2160 } },
      ]),
    ).toEqual({ x: -1920, y: -600, width: 8320, height: 2160 });
  });

  it("returns undefined without a display", () => {
    expect(virtualBoundsFor([])).toBeUndefined();
  });
});
