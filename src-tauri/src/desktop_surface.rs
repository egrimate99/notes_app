use serde::Serialize;
use std::{collections::HashSet, sync::Mutex, time::Duration};
use tauri::{
    Emitter, EventTarget, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

mod anchor;
use anchor::{unique_logical_anchor, AnchorBounds, AnchorMonitor};

const MAIN_WINDOW_LABEL: &str = "main";
const MONITOR_WINDOW_PREFIX: &str = "desktop-monitor-";
const DESKTOP_SURFACE_EVENT: &str = "desktop-surface://changed";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PhysicalBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopMonitor {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub is_primary: bool,
    /// Full monitor rectangle in Windows virtual-screen physical pixels.
    pub bounds: PhysicalBounds,
    /// Taskbar-excluded rectangle in the same physical coordinate space.
    pub work_area: PhysicalBounds,
    pub scale_factor: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopMonitorSurface {
    pub id: String,
    pub window_label: String,
    pub monitor_id: String,
    pub is_primary: bool,
    pub is_controller: bool,
    /// The native window is confined to this exact taskbar-excluded rectangle.
    pub bounds: PhysicalBounds,
    pub monitor_bounds: PhysicalBounds,
    pub scale_factor: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum DesktopSurfaceRole {
    Workspace,
    Monitor,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopSurfaceStatus {
    pub available: bool,
    pub active: bool,
    pub role: DesktopSurfaceRole,
    pub virtual_bounds: PhysicalBounds,
    pub monitors: Vec<DesktopMonitor>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub surface: Option<DesktopMonitorSurface>,
    pub window_scale_factor: f64,
    pub layout_revision: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopSurfaceError {
    code: &'static str,
    message: String,
}

type DesktopResult<T> = Result<T, DesktopSurfaceError>;

impl DesktopSurfaceError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn window(error: tauri::Error) -> Self {
        Self::new("window_error", error.to_string())
    }
}

#[derive(Clone, Debug, PartialEq)]
struct RawMonitor {
    name: Option<String>,
    is_primary: bool,
    bounds: PhysicalBounds,
    work_area: PhysicalBounds,
    scale_factor: f64,
}

#[derive(Clone, Debug, PartialEq)]
struct DesktopLayout {
    virtual_bounds: PhysicalBounds,
    monitors: Vec<DesktopMonitor>,
    surfaces: Vec<DesktopMonitorSurface>,
}

#[derive(Clone, Debug, Default)]
struct DesktopSurfaceSession {
    active: bool,
    virtual_bounds: Option<PhysicalBounds>,
    monitors: Vec<DesktopMonitor>,
    surfaces: Vec<DesktopMonitorSurface>,
    layout_revision: u64,
}

#[derive(Default)]
pub(crate) struct DesktopSurfaceState {
    session: Mutex<DesktopSurfaceSession>,
    /// Window creation is deliberately serialized separately from status reads.
    /// A new WebView can request status while its native builder is returning.
    operation: Mutex<()>,
}

fn lock_session(
    state: &DesktopSurfaceState,
) -> DesktopResult<std::sync::MutexGuard<'_, DesktopSurfaceSession>> {
    state.session.lock().map_err(|_| {
        DesktopSurfaceError::new(
            "state_error",
            "The desktop-canvas window state could not be accessed.",
        )
    })
}

fn lock_operation(state: &DesktopSurfaceState) -> DesktopResult<std::sync::MutexGuard<'_, ()>> {
    state.operation.lock().map_err(|_| {
        DesktopSurfaceError::new(
            "state_error",
            "Another desktop-canvas transition could not be completed.",
        )
    })
}

fn main_window(app: &tauri::AppHandle) -> DesktopResult<WebviewWindow> {
    app.get_webview_window(MAIN_WINDOW_LABEL).ok_or_else(|| {
        DesktopSurfaceError::new(
            "window_error",
            "Math Atlas could not find its workspace window.",
        )
    })
}

fn same_physical_monitor(left: &tauri::Monitor, right: &tauri::Monitor) -> bool {
    left.position() == right.position() && left.size() == right.size()
}

fn virtual_bounds(monitors: &[PhysicalBounds]) -> DesktopResult<PhysicalBounds> {
    let Some(first) = monitors.first() else {
        return Err(DesktopSurfaceError::new(
            "desktop_unavailable",
            "Windows did not report an attached display.",
        ));
    };

    let mut left = i64::from(first.x);
    let mut top = i64::from(first.y);
    let mut right = left + i64::from(first.width);
    let mut bottom = top + i64::from(first.height);
    for monitor in &monitors[1..] {
        let monitor_left = i64::from(monitor.x);
        let monitor_top = i64::from(monitor.y);
        left = left.min(monitor_left);
        top = top.min(monitor_top);
        right = right.max(monitor_left + i64::from(monitor.width));
        bottom = bottom.max(monitor_top + i64::from(monitor.height));
    }

    let width = u32::try_from(right - left).map_err(|_| {
        DesktopSurfaceError::new(
            "desktop_unavailable",
            "The virtual desktop is wider than a window can represent.",
        )
    })?;
    let height = u32::try_from(bottom - top).map_err(|_| {
        DesktopSurfaceError::new(
            "desktop_unavailable",
            "The virtual desktop is taller than a window can represent.",
        )
    })?;
    let x = i32::try_from(left).map_err(|_| {
        DesktopSurfaceError::new(
            "desktop_unavailable",
            "The virtual desktop origin is outside the supported coordinate range.",
        )
    })?;
    let y = i32::try_from(top).map_err(|_| {
        DesktopSurfaceError::new(
            "desktop_unavailable",
            "The virtual desktop origin is outside the supported coordinate range.",
        )
    })?;
    if width == 0 || height == 0 {
        return Err(DesktopSurfaceError::new(
            "desktop_unavailable",
            "The virtual desktop has no usable area.",
        ));
    }
    Ok(PhysicalBounds {
        x,
        y,
        width,
        height,
    })
}

fn plan_layout(mut raw_monitors: Vec<RawMonitor>) -> DesktopResult<DesktopLayout> {
    raw_monitors.sort_by(|left, right| {
        left.bounds
            .x
            .cmp(&right.bounds.x)
            .then_with(|| left.bounds.y.cmp(&right.bounds.y))
            .then_with(|| left.name.cmp(&right.name))
            .then_with(|| left.bounds.width.cmp(&right.bounds.width))
            .then_with(|| left.bounds.height.cmp(&right.bounds.height))
    });
    if raw_monitors.iter().any(|monitor| {
        monitor.bounds.width == 0
            || monitor.bounds.height == 0
            || monitor.work_area.width == 0
            || monitor.work_area.height == 0
            || !monitor.scale_factor.is_finite()
            || monitor.scale_factor <= 0.0
    }) {
        return Err(DesktopSurfaceError::new(
            "desktop_unavailable",
            "Windows reported an invalid monitor or work area.",
        ));
    }

    let bounds = virtual_bounds(
        &raw_monitors
            .iter()
            .map(|monitor| monitor.bounds)
            .collect::<Vec<_>>(),
    )?;
    let monitors = raw_monitors
        .into_iter()
        .enumerate()
        .map(|(index, monitor)| DesktopMonitor {
            id: format!("monitor-{index}"),
            name: monitor.name,
            is_primary: monitor.is_primary,
            bounds: monitor.bounds,
            work_area: monitor.work_area,
            scale_factor: monitor.scale_factor,
        })
        .collect::<Vec<_>>();
    // Monitor enumeration can briefly omit the primary flag during a display
    // topology transition. Keep exactly one native controller so refresh and
    // the in-canvas recovery controls never disappear.
    let controller_index = monitors
        .iter()
        .position(|monitor| monitor.is_primary)
        .unwrap_or(0);
    let surfaces = monitors
        .iter()
        .enumerate()
        .map(|(index, monitor)| DesktopMonitorSurface {
            id: format!("monitor-{index}"),
            window_label: format!("{MONITOR_WINDOW_PREFIX}{index}"),
            monitor_id: monitor.id.clone(),
            is_primary: monitor.is_primary,
            is_controller: index == controller_index,
            bounds: monitor.work_area,
            monitor_bounds: monitor.bounds,
            scale_factor: monitor.scale_factor,
        })
        .collect();
    Ok(DesktopLayout {
        virtual_bounds: bounds,
        monitors,
        surfaces,
    })
}

fn inspect_layout(app: &tauri::AppHandle) -> DesktopResult<DesktopLayout> {
    let workspace = main_window(app)?;
    let primary = workspace
        .primary_monitor()
        .map_err(DesktopSurfaceError::window)?;
    let raw_monitors = workspace
        .available_monitors()
        .map_err(DesktopSurfaceError::window)?
        .iter()
        .map(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            let work_area = monitor.work_area();
            RawMonitor {
                name: monitor.name().cloned(),
                is_primary: primary
                    .as_ref()
                    .is_some_and(|candidate| same_physical_monitor(candidate, monitor)),
                bounds: PhysicalBounds {
                    x: position.x,
                    y: position.y,
                    width: size.width,
                    height: size.height,
                },
                work_area: PhysicalBounds {
                    x: work_area.position.x,
                    y: work_area.position.y,
                    width: work_area.size.width,
                    height: work_area.size.height,
                },
                scale_factor: monitor.scale_factor(),
            }
        })
        .collect();
    plan_layout(raw_monitors)
}

fn session_for_layout(
    previous: &DesktopSurfaceSession,
    layout: &DesktopLayout,
    active: bool,
    increment_revision: bool,
) -> DesktopSurfaceSession {
    DesktopSurfaceSession {
        active,
        virtual_bounds: Some(layout.virtual_bounds),
        monitors: layout.monitors.clone(),
        surfaces: layout.surfaces.clone(),
        layout_revision: if increment_revision {
            previous.layout_revision.wrapping_add(1)
        } else {
            previous.layout_revision
        },
    }
}

fn layout_matches(session: &DesktopSurfaceSession, layout: &DesktopLayout) -> bool {
    session.virtual_bounds == Some(layout.virtual_bounds)
        && session.monitors == layout.monitors
        && session.surfaces == layout.surfaces
}

fn role_for_window(window: &WebviewWindow) -> DesktopSurfaceRole {
    if window.label().starts_with(MONITOR_WINDOW_PREFIX) {
        DesktopSurfaceRole::Monitor
    } else {
        DesktopSurfaceRole::Workspace
    }
}

fn status_for_window(
    window: &WebviewWindow,
    session: &DesktopSurfaceSession,
) -> DesktopResult<DesktopSurfaceStatus> {
    let virtual_bounds = session.virtual_bounds.ok_or_else(|| {
        DesktopSurfaceError::new(
            "desktop_unavailable",
            "Windows did not report an attached display.",
        )
    })?;
    let role = role_for_window(window);
    let surface = (session.active && role == DesktopSurfaceRole::Monitor)
        .then(|| {
            session
                .surfaces
                .iter()
                .find(|surface| surface.window_label == window.label())
                .cloned()
        })
        .flatten();
    let window_scale_factor = window
        .scale_factor()
        .unwrap_or_else(|_| surface.as_ref().map_or(1.0, |surface| surface.scale_factor));
    Ok(DesktopSurfaceStatus {
        available: true,
        active: session.active,
        role,
        virtual_bounds,
        monitors: session.monitors.clone(),
        surface,
        window_scale_factor,
        layout_revision: session.layout_revision,
    })
}

fn emit_session(app: &tauri::AppHandle, session: &DesktopSurfaceSession) {
    for window in app.webview_windows().into_values().filter(|window| {
        window.label() == MAIN_WINDOW_LABEL || window.label().starts_with(MONITOR_WINDOW_PREFIX)
    }) {
        if let Ok(status) = status_for_window(&window, session) {
            // Projection data is recipient-specific. Use an explicit window
            // target so scoped listeners cannot consume another monitor's
            // surface descriptor.
            let _ = app.emit_to(
                EventTarget::webview_window(window.label()),
                DESKTOP_SURFACE_EVENT,
                status,
            );
        }
    }
}

/// Create the hidden WebView on its intended display before applying exact
/// physical work-area geometry. This avoids inheriting the primary monitor's
/// rasterization scale on mixed-DPI desktops.
fn initial_logical_anchor(
    surface: &DesktopMonitorSurface,
    monitors: &[DesktopMonitor],
) -> (f64, f64) {
    let anchor_monitors = monitors
        .iter()
        .map(|monitor| AnchorMonitor {
            id: &monitor.id,
            bounds: AnchorBounds {
                x: monitor.bounds.x,
                y: monitor.bounds.y,
                width: monitor.bounds.width,
                height: monitor.bounds.height,
            },
            scale_factor: monitor.scale_factor,
        })
        .collect::<Vec<_>>();
    unique_logical_anchor(&surface.monitor_id, &anchor_monitors).unwrap_or((
        (f64::from(surface.bounds.x) + f64::from(surface.bounds.width) * 0.5)
            / surface.scale_factor,
        (f64::from(surface.bounds.y) + f64::from(surface.bounds.height) * 0.5)
            / surface.scale_factor,
    ))
}

fn configure_surface_window(
    window: &WebviewWindow,
    surface: &DesktopMonitorSurface,
) -> DesktopResult<()> {
    window
        .set_fullscreen(false)
        .map_err(DesktopSurfaceError::window)?;
    window.unmaximize().map_err(DesktopSurfaceError::window)?;
    window.unminimize().map_err(DesktopSurfaceError::window)?;
    window
        .set_always_on_top(false)
        .map_err(DesktopSurfaceError::window)?;
    window
        .set_decorations(false)
        .map_err(DesktopSurfaceError::window)?;
    window
        .set_shadow(false)
        .map_err(DesktopSurfaceError::window)?;
    window
        .set_resizable(false)
        .map_err(DesktopSurfaceError::window)?;
    window
        .set_maximizable(false)
        .map_err(DesktopSurfaceError::window)?;
    window
        .set_minimizable(false)
        .map_err(DesktopSurfaceError::window)?;
    window
        .set_closable(false)
        .map_err(DesktopSurfaceError::window)?;
    window
        .set_focusable(true)
        .map_err(DesktopSurfaceError::window)?;
    window
        .set_skip_taskbar(true)
        .map_err(DesktopSurfaceError::window)?;
    window
        .set_position(PhysicalPosition::new(surface.bounds.x, surface.bounds.y))
        .map_err(DesktopSurfaceError::window)?;
    window
        .set_size(PhysicalSize::new(
            surface.bounds.width,
            surface.bounds.height,
        ))
        .map_err(DesktopSurfaceError::window)?;
    let title = format!("Study — {}", surface.id);
    window
        .set_title(&title)
        .map_err(DesktopSurfaceError::window)?;
    window.show().map_err(DesktopSurfaceError::window)?;
    // Apply bottom z-order after showing as well: Explorer/taskbar restarts can
    // otherwise leave a previously hidden HWND in a normal z band.
    window
        .set_always_on_bottom(true)
        .map_err(DesktopSurfaceError::window)
}

fn build_surface_window(
    app: &tauri::AppHandle,
    surface: &DesktopMonitorSurface,
    monitors: &[DesktopMonitor],
) -> DesktopResult<WebviewWindow> {
    let url = WebviewUrl::App(format!("index.html?desktopSurface={}", surface.id).into());
    let (initial_x, initial_y) = initial_logical_anchor(surface, monitors);
    let initial_width = f64::from(surface.bounds.width) / surface.scale_factor;
    let initial_height = f64::from(surface.bounds.height) / surface.scale_factor;
    let window = WebviewWindowBuilder::new(app, &surface.window_label, url)
        .title(format!("Study — {}", surface.id))
        // Establish the target monitor before WebView2 initializes. Tauri's
        // builder accepts logical coordinates and dimensions here.
        .position(initial_x, initial_y)
        .inner_size(initial_width, initial_height)
        .visible(false)
        .focused(false)
        .decorations(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .always_on_bottom(true)
        .skip_taskbar(true)
        .shadow(false)
        // WebView2's native file-drop handler consumes the HTML5 drag events
        // used by the explorer. Disabling it is required for in-app file and
        // folder moves on Windows, including the multi-monitor surfaces.
        .disable_drag_drop_handler()
        .build()
        .map_err(DesktopSurfaceError::window)?;
    configure_surface_window(&window, surface)?;
    Ok(window)
}

fn restore_previous_surfaces(app: &tauri::AppHandle, previous: &DesktopSurfaceSession) {
    if !previous.active {
        for window in app
            .webview_windows()
            .into_values()
            .filter(|window| window.label().starts_with(MONITOR_WINDOW_PREFIX))
        {
            let _ = window.hide();
        }
        return;
    }
    for surface in &previous.surfaces {
        if let Some(window) = app.get_webview_window(&surface.window_label) {
            let _ = configure_surface_window(&window, surface);
        }
    }
}

fn materialize_layout(
    app: &tauri::AppHandle,
    layout: &DesktopLayout,
    previous: &DesktopSurfaceSession,
) -> DesktopResult<Vec<String>> {
    let desired = layout
        .surfaces
        .iter()
        .map(|surface| surface.window_label.as_str())
        .collect::<HashSet<_>>();
    let obsolete = app
        .webview_windows()
        .into_keys()
        .filter(|label| {
            label.starts_with(MONITOR_WINDOW_PREFIX) && !desired.contains(label.as_str())
        })
        .collect::<Vec<_>>();
    let mut created = Vec::new();

    for surface in &layout.surfaces {
        let result = if let Some(window) = app.get_webview_window(&surface.window_label) {
            configure_surface_window(&window, surface)
        } else {
            build_surface_window(app, surface, &layout.monitors).map(|_| {
                created.push(surface.window_label.clone());
            })
        };
        if let Err(error) = result {
            for label in created {
                if let Some(window) = app.get_webview_window(&label) {
                    let _ = window.destroy();
                }
            }
            restore_previous_surfaces(app, previous);
            return Err(error);
        }
    }
    Ok(obsolete)
}

fn hide_labels(app: &tauri::AppHandle, labels: &[String]) {
    for label in labels {
        if let Some(window) = app.get_webview_window(label) {
            let _ = window.hide();
        }
    }
}

fn cleanup_windows_later(app: tauri::AppHandle, labels: Vec<String>) {
    if labels.is_empty() {
        return;
    }
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        let state = app.state::<DesktopSurfaceState>();
        let protected = lock_session(&state)
            .map(|session| {
                if session.active {
                    session
                        .surfaces
                        .iter()
                        .map(|surface| surface.window_label.clone())
                        .collect::<HashSet<_>>()
                } else {
                    HashSet::new()
                }
            })
            .unwrap_or_default();
        for label in labels {
            if protected.contains(&label) {
                continue;
            }
            if let Some(window) = app.get_webview_window(&label) {
                let _ = window.destroy();
            }
        }
    });
}

fn enter_internal(app: &tauri::AppHandle) -> DesktopResult<DesktopSurfaceSession> {
    let state = app.state::<DesktopSurfaceState>();
    let _operation = lock_operation(&state)?;
    let previous = lock_session(&state)?.clone();
    let layout = inspect_layout(app)?;
    let changed = !previous.active || !layout_matches(&previous, &layout);
    let obsolete = materialize_layout(app, &layout, &previous)?;
    let workspace = main_window(app)?;
    if let Err(error) = workspace.hide() {
        restore_previous_surfaces(app, &previous);
        return Err(DesktopSurfaceError::window(error));
    }

    let next = session_for_layout(&previous, &layout, true, changed);
    *lock_session(&state)? = next.clone();
    hide_labels(app, &obsolete);
    emit_session(app, &next);
    cleanup_windows_later(app.clone(), obsolete);
    Ok(next)
}

fn show_workspace_window(window: &WebviewWindow) -> DesktopResult<()> {
    window
        .set_always_on_bottom(false)
        .map_err(DesktopSurfaceError::window)?;
    window
        .set_skip_taskbar(false)
        .map_err(DesktopSurfaceError::window)?;
    window.unminimize().map_err(DesktopSurfaceError::window)?;
    window.show().map_err(DesktopSurfaceError::window)?;
    window.set_focus().map_err(DesktopSurfaceError::window)
}

fn exit_internal(app: &tauri::AppHandle) -> DesktopResult<DesktopSurfaceSession> {
    let state = app.state::<DesktopSurfaceState>();
    let _operation = lock_operation(&state)?;
    let previous = lock_session(&state)?.clone();
    let workspace = main_window(app)?;
    show_workspace_window(&workspace)?;

    let layout = inspect_layout(app)?;
    let next = session_for_layout(&previous, &layout, false, previous.active);
    *lock_session(&state)? = next.clone();
    emit_session(app, &next);

    let labels = app
        .webview_windows()
        .into_keys()
        .filter(|label| label.starts_with(MONITOR_WINDOW_PREFIX))
        .collect::<Vec<_>>();
    hide_labels(app, &labels);
    cleanup_windows_later(app.clone(), labels);
    Ok(next)
}

fn refresh_internal(app: &tauri::AppHandle) -> DesktopResult<DesktopSurfaceSession> {
    let state = app.state::<DesktopSurfaceState>();
    let _operation = lock_operation(&state)?;
    let previous = lock_session(&state)?.clone();
    let layout = inspect_layout(app)?;
    if !previous.active {
        return Ok(session_for_layout(&previous, &layout, false, false));
    }

    let changed = !layout_matches(&previous, &layout);
    let obsolete = materialize_layout(app, &layout, &previous)?;
    main_window(app)?
        .hide()
        .map_err(DesktopSurfaceError::window)?;
    let next = session_for_layout(&previous, &layout, true, changed);
    *lock_session(&state)? = next.clone();
    hide_labels(app, &obsolete);
    if changed {
        emit_session(app, &next);
    }
    cleanup_windows_later(app.clone(), obsolete);
    Ok(next)
}

fn status_with_current_layout(
    app: &tauri::AppHandle,
    window: &WebviewWindow,
) -> DesktopResult<DesktopSurfaceStatus> {
    let state = app.state::<DesktopSurfaceState>();
    let session = lock_session(&state)?.clone();
    if session.active && session.virtual_bounds.is_some() {
        return status_for_window(window, &session);
    }
    let layout = inspect_layout(app)?;
    let current = session_for_layout(&session, &layout, false, false);
    status_for_window(window, &current)
}

#[tauri::command]
pub(crate) async fn get_desktop_surface_status(
    app: tauri::AppHandle,
    window: WebviewWindow,
) -> DesktopResult<DesktopSurfaceStatus> {
    status_with_current_layout(&app, &window)
}

#[tauri::command]
pub(crate) async fn enter_desktop_surface(
    app: tauri::AppHandle,
    window: WebviewWindow,
) -> DesktopResult<DesktopSurfaceStatus> {
    let session = enter_internal(&app)?;
    status_for_window(&window, &session)
}

#[tauri::command]
pub(crate) async fn exit_desktop_surface(
    app: tauri::AppHandle,
    window: WebviewWindow,
) -> DesktopResult<DesktopSurfaceStatus> {
    let session = exit_internal(&app)?;
    status_for_window(&window, &session)
}

#[tauri::command]
pub(crate) async fn refresh_desktop_surface(
    app: tauri::AppHandle,
    window: WebviewWindow,
) -> DesktopResult<DesktopSurfaceStatus> {
    let session = refresh_internal(&app)?;
    status_for_window(&window, &session)
}

pub(crate) fn install_desktop_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::{
        menu::{Menu, MenuItem, PredefinedMenuItem},
        tray::TrayIconBuilder,
    };

    let open_workspace = MenuItem::with_id(
        app,
        "desktop-open-workspace",
        "Open workspace",
        true,
        None::<&str>,
    )?;
    let use_as_desktop = MenuItem::with_id(
        app,
        "desktop-enter",
        "Use as desktop canvas",
        true,
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "desktop-quit", "Quit Math Atlas", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_workspace, &use_as_desktop, &separator, &quit])?;

    let mut tray = TrayIconBuilder::with_id("math-atlas-tray")
        .tooltip("Math Atlas")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "desktop-open-workspace" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = exit_internal(&app) {
                        eprintln!(
                            "Math Atlas could not restore its workspace: {}",
                            error.message
                        );
                    }
                });
            }
            "desktop-enter" => {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = enter_internal(&app) {
                        eprintln!("Math Atlas could not enter desktop mode: {}", error.message);
                    }
                });
            }
            "desktop-quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

pub(crate) fn requested_at_launch() -> bool {
    std::env::args_os().any(|argument| argument == "--desktop")
}

pub(crate) fn enter_at_launch(app: &tauri::App) {
    if !requested_at_launch() {
        return;
    }
    if let Err(error) = enter_internal(app.handle()) {
        eprintln!(
            "Math Atlas could not enter desktop-canvas mode: {}",
            error.message
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn monitor(
        name: &str,
        is_primary: bool,
        bounds: PhysicalBounds,
        work_area: PhysicalBounds,
        scale_factor: f64,
    ) -> RawMonitor {
        RawMonitor {
            name: Some(name.to_string()),
            is_primary,
            bounds,
            work_area,
            scale_factor,
        }
    }

    #[test]
    fn virtual_bounds_include_negative_and_staggered_monitors() {
        let bounds = virtual_bounds(&[
            PhysicalBounds {
                x: 0,
                y: 0,
                width: 2560,
                height: 1440,
            },
            PhysicalBounds {
                x: -1920,
                y: 240,
                width: 1920,
                height: 1080,
            },
            PhysicalBounds {
                x: 2560,
                y: -600,
                width: 3840,
                height: 2160,
            },
        ])
        .expect("a valid virtual desktop");
        assert_eq!(
            bounds,
            PhysicalBounds {
                x: -1920,
                y: -600,
                width: 8320,
                height: 2160,
            }
        );
    }

    #[test]
    fn monitor_surfaces_use_work_areas_and_keep_individual_dpi_scales() {
        let layout = plan_layout(vec![
            monitor(
                "right-high-dpi",
                true,
                PhysicalBounds {
                    x: 1920,
                    y: -371,
                    width: 2560,
                    height: 1440,
                },
                PhysicalBounds {
                    x: 1920,
                    y: -371,
                    width: 2560,
                    height: 1400,
                },
                1.5,
            ),
            monitor(
                "left",
                false,
                PhysicalBounds {
                    x: 0,
                    y: 0,
                    width: 1920,
                    height: 1080,
                },
                PhysicalBounds {
                    x: 48,
                    y: 0,
                    width: 1872,
                    height: 1080,
                },
                1.0,
            ),
        ])
        .expect("valid mixed-DPI layout");

        assert_eq!(layout.surfaces[0].window_label, "desktop-monitor-0");
        assert_eq!(layout.surfaces[0].bounds.x, 48);
        assert_eq!(layout.surfaces[0].bounds.width, 1872);
        assert_eq!(layout.surfaces[0].scale_factor, 1.0);
        assert_eq!(layout.surfaces[1].bounds.height, 1400);
        assert_eq!(layout.surfaces[1].scale_factor, 1.5);
        assert!(layout.surfaces[1].is_controller);
        assert_eq!(
            layout.virtual_bounds,
            PhysicalBounds {
                x: 0,
                y: -371,
                width: 4480,
                height: 1451,
            }
        );
    }

    #[test]
    fn monitor_order_and_labels_are_stable_by_physical_position() {
        let left = monitor(
            "z-name",
            false,
            PhysicalBounds {
                x: -1920,
                y: 0,
                width: 1920,
                height: 1080,
            },
            PhysicalBounds {
                x: -1920,
                y: 0,
                width: 1920,
                height: 1040,
            },
            1.0,
        );
        let right = monitor(
            "a-name",
            true,
            PhysicalBounds {
                x: 0,
                y: 0,
                width: 2560,
                height: 1440,
            },
            PhysicalBounds {
                x: 0,
                y: 0,
                width: 2560,
                height: 1400,
            },
            1.25,
        );
        let first = plan_layout(vec![right.clone(), left.clone()]).unwrap();
        let second = plan_layout(vec![left, right]).unwrap();
        assert_eq!(first, second);
        assert_eq!(first.monitors[0].name.as_deref(), Some("z-name"));
        assert_eq!(first.surfaces[1].id, "monitor-1");
    }

    #[test]
    fn invalid_empty_or_zero_area_layouts_are_rejected() {
        assert_eq!(
            plan_layout(Vec::new()).unwrap_err().code,
            "desktop_unavailable"
        );
        let invalid = monitor(
            "invalid",
            true,
            PhysicalBounds {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
            },
            PhysicalBounds {
                x: 0,
                y: 0,
                width: 1920,
                height: 0,
            },
            1.0,
        );
        assert_eq!(
            plan_layout(vec![invalid]).unwrap_err().code,
            "desktop_unavailable"
        );
    }

    #[test]
    fn first_surface_controls_refresh_when_windows_omits_primary_monitor() {
        let layout = plan_layout(vec![monitor(
            "only",
            false,
            PhysicalBounds {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
            },
            PhysicalBounds {
                x: 0,
                y: 0,
                width: 1920,
                height: 1040,
            },
            1.0,
        )])
        .unwrap();
        assert!(!layout.surfaces[0].is_primary);
        assert!(layout.surfaces[0].is_controller);
    }

    #[test]
    fn dimensions_larger_than_physical_size_are_rejected() {
        assert_eq!(
            virtual_bounds(&[
                PhysicalBounds {
                    x: i32::MIN,
                    y: 0,
                    width: 1,
                    height: 1080,
                },
                PhysicalBounds {
                    x: i32::MAX,
                    y: 0,
                    width: u32::MAX,
                    height: 1080,
                },
            ])
            .unwrap_err()
            .code,
            "desktop_unavailable"
        );
    }
}
