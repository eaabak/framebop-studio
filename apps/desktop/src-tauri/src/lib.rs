//! The Framebop Studio desktop shell.
//!
//! This crate is intentionally small. It owns the window, starts the
//! production engine as a child process, and relays messages between the
//! engine and the interface. All application logic lives in the TypeScript
//! packages, where it is shared by every platform.

mod engine;

use std::sync::Arc;

use engine::EngineSupervisor;
use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Two instances would run two engines against the same library. Focus
    // the existing window instead of starting a second one.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }

    let app = builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let supervisor = EngineSupervisor::new();
            app.manage(Arc::clone(&supervisor));
            // A failure here is not fatal: the interface starts, shows the
            // reason, and offers to try again.
            if let Err(reason) = supervisor.start(app.handle()) {
                eprintln!("framebop: the engine could not be started: {reason}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            engine::engine_call,
            engine::engine_status,
            engine::engine_restart,
        ])
        .build(tauri::generate_context!())
        .expect("Framebop Studio could not start");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            handle.state::<Arc<EngineSupervisor>>().stop();
        }
    });
}
