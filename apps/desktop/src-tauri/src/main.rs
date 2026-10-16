// Release builds on Windows would otherwise open a console window next to the app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    framebop_studio_lib::run()
}
