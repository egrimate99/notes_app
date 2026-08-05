#[derive(Clone, Copy)]
pub(super) struct AnchorBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Copy)]
pub(super) struct AnchorMonitor<'a> {
    pub id: &'a str,
    pub bounds: AnchorBounds,
    pub scale_factor: f64,
}

pub(super) fn logical_anchor_is_on_monitor(x: f64, y: f64, monitor: AnchorMonitor<'_>) -> bool {
    let physical_x = x * monitor.scale_factor;
    let physical_y = y * monitor.scale_factor;
    let right = f64::from(monitor.bounds.x) + f64::from(monitor.bounds.width);
    let bottom = f64::from(monitor.bounds.y) + f64::from(monitor.bounds.height);
    physical_x >= f64::from(monitor.bounds.x)
        && physical_x < right
        && physical_y >= f64::from(monitor.bounds.y)
        && physical_y < bottom
}

/// Tao selects the initial Windows monitor by converting a requested logical
/// position with each monitor's DPI. Search interior points whose logical
/// preimage belongs only to the intended monitor.
pub(super) fn unique_logical_anchor(
    target_id: &str,
    monitors: &[AnchorMonitor<'_>],
) -> Option<(f64, f64)> {
    let target = monitors.iter().find(|monitor| monitor.id == target_id)?;
    const FRACTIONS: [f64; 7] = [0.5, 0.125, 0.875, 0.25, 0.75, 0.375, 0.625];
    for y_fraction in FRACTIONS {
        for x_fraction in FRACTIONS {
            let physical_x =
                f64::from(target.bounds.x) + f64::from(target.bounds.width) * x_fraction;
            let physical_y =
                f64::from(target.bounds.y) + f64::from(target.bounds.height) * y_fraction;
            let x = physical_x / target.scale_factor;
            let y = physical_y / target.scale_factor;
            if monitors.iter().all(|monitor| {
                monitor.id == target.id || !logical_anchor_is_on_monitor(x, y, *monitor)
            }) {
                return Some((x, y));
            }
        }
    }
    None
}
