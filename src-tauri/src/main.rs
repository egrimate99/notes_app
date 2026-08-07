// The desktop canvas is a GUI process in development as well as release.
// Keeping the debug binary in the Windows GUI subsystem prevents terminal
// close/control events from terminating a separately launched surface.
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

fn main() {
    math_atlas_lib::run()
}
