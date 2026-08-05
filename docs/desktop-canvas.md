# Desktop canvas

Math Atlas has one product and one frontend bundle. Workspace mode runs in the
normal `main` WebView. Desktop mode leaves that window and its geometry intact
but hides it, then opens one companion WebView for each attached monitor. Every
companion loads the same React application, canonical `study/content` files,
and atlas repository; there is no forked desktop implementation.

## Why there is one window per monitor

Windows assigns a single rasterization DPI to a top-level WebView2 window. A
window stretched across monitors with different scaling can therefore change
the apparent size of one landmark at the seam. Math Atlas instead confines each
companion window to exactly one monitor's physical work area. The frontend
projects a shared camera into that window using its monitor scale factor:

```text
local.x    = (global.x - workAreaOffset.x) / monitorScale
local.y    = (global.y - workAreaOffset.y) / monitorScale
local.zoom = global.zoom / monitorScale
```

The inverse transform is used when a user pans or zooms. The global camera is
expressed in physical virtual-desktop coordinates, so a theorem crossing a seam
keeps one continuous physical size even when the monitors have different DPI.
Negative monitor coordinates and staggered display arrangements are preserved.
React Flow renders group titles in a separate toolbar layer that would normally
stay screen-sized. Math Atlas reapplies each surface's local canvas zoom to that
layer. Since `local.zoom * monitorScale = global.zoom`, labels and group frames
retain the same physical ratio at 100%, 125%, 150%, and 200% display scale and
shrink together during ordinary wheel zoom.

Camera state and interactive atlas state are synchronized between the same-
origin companions. Native monitor status is recipient-specific: it identifies
the current window, its monitor, full monitor bounds, taskbar-excluded work
area, scale factor, primary/controller role, and the full virtual-screen union.

Landmark and group drags are transferred as world-space sessions when the
pointer crosses a monitor seam. The receiving WebView continues the live drag
and can finish it; the originating surface remains the single persistence
owner. Move packets are coalesced to animation frames and completed sessions
reject late packets, preventing both seam jitter and the former snap-back to
the source monitor. Because transfer happens in shared world coordinates, it
also remains correct across monitors with different DPI scales and offsets.

## Taskbar and window behavior

Desktop companions are borderless, non-minimizable, omitted from the taskbar,
and kept in the bottom z-order. Their native bounds use `Monitor::work_area()`,
not fullscreen or the monitor's full rectangle. Consequently the Windows
taskbar and its auto-hide activation edge are never covered, even when every
ordinary application is minimized.

The app deliberately avoids exclusive fullscreen and undocumented `WorkerW`
wallpaper hooks. Those approaches either cover shell UI or depend on private
Explorer behavior. The work-area companions remain interactive while ordinary
windows and the taskbar stay above them.

Display refresh compares the complete physical layout. It resizes/repositions
surviving companions, creates or removes companions after monitor hot-plug, and
publishes a new layout revision. Removed windows are hidden immediately and
destroyed after their pending IPC response can finish.

## Launch and recovery

During development:

```powershell
npm run tauri:desktop
```

The Tauri launcher first verifies the application and content API on port 1420.
It reuses a healthy listener and only starts Vite when one is not already
running, preserving hot reload without creating a competing content process.

For an installed build, append `--desktop` to the shortcut target:

```text
"C:\Path\To\Math Atlas.exe" --desktop
```

The system tray remains the native recovery path. **Open workspace** closes the
desktop companions and reveals the untouched main window. **Use as desktop
canvas** recreates the monitor surfaces. The in-canvas capsule offers the same
switch without visiting the tray.

## Frontend integration

`src/services/desktopSurface.ts` exposes the shared desktop facade:

- `isAvailable()` is `false` in a normal browser.
- `getStatus()` returns status for the current workspace or monitor window.
- `enter()` creates/reuses the monitor companions and hides the main window.
- `exit()` restores the main workspace and retires every companion.
- `refresh()` reconciles monitor resolution, DPI, work-area, and arrangement
  changes; only the controller surface needs to poll it.
- `onChange()` receives recipient-specific changes made through UI or tray.

All operations remain harmless browser no-ops. Companion URLs include
`?desktopSurface=monitor-N` so the shared application can suppress workspace
chrome before the first native status response and avoid a startup flash.

## Tradeoffs

Each monitor owns a WebView2 renderer, which costs more baseline memory than a
single giant window. In return, Windows never rasterizes one WebView across two
DPI domains, taskbar exclusion is exact per monitor, and a renderer is never
allocated for physical gaps between displays. Canonical files remain protected
by revision checks, while transient camera/state synchronization stays in
memory for low-latency interaction.
