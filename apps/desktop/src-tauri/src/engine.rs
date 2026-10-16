//! Supervises the production engine and relays its messages.
//!
//! The engine is a Node.js program (`packages/orchestrator`). It runs as a
//! child process started with the Node.js runtime that ships inside the app,
//! and speaks one JSON object per line on stdin/stdout:
//!
//!   request   {"id": 1, "method": "projects.list", "params": {}}
//!   response  {"id": 1, "ok": true, "result": [...]}
//!             {"id": 1, "ok": false, "error": {"code": "...", "message": "..."}}
//!   event     {"event": {"type": "job.updated", ...}}
//!   control   {"control": "shutdown"}
//!
//! Using a pipe rather than a local web server means the engine opens no
//! network port, so nothing else on the machine can reach it.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::oneshot;

/// Name of the bundled Node.js runtime, as declared under `bundle.externalBin`.
const SIDECAR: &str = "framebop-node";
const EVENT_CHANNEL: &str = "engine:event";
const STATUS_CHANNEL: &str = "engine:status";
/// Engine calls return quickly; long work is reported through job events.
const CALL_TIMEOUT: Duration = Duration::from_secs(60);
/// How long the engine gets to finish writes and exit before it is killed.
const SHUTDOWN_GRACE: Duration = Duration::from_millis(2000);

type Reply = Result<Value, Value>;

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum EngineStatus {
    Starting,
    Running,
    Stopped { reason: String },
}

struct Running {
    child: CommandChild,
    /// Set by the reader task once the process has exited.
    exited: Arc<AtomicBool>,
}

struct Inner {
    running: Option<Running>,
    pending: HashMap<u64, oneshot::Sender<Reply>>,
    status: EngineStatus,
    /// Incremented on every start, so an exit notification from a process
    /// that was already replaced is ignored.
    generation: u64,
}

pub struct EngineSupervisor {
    inner: Mutex<Inner>,
    next_id: AtomicU64,
}

/// Builds an error in the same shape the engine itself reports.
fn unavailable(message: impl Into<String>) -> Value {
    json!({ "code": "UNAVAILABLE", "message": message.into() })
}

impl EngineSupervisor {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            inner: Mutex::new(Inner {
                running: None,
                pending: HashMap::new(),
                status: EngineStatus::Starting,
                generation: 0,
            }),
            next_id: AtomicU64::new(1),
        })
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        // A panic while holding the lock must not make every later call panic.
        self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn status(&self) -> EngineStatus {
        self.lock().status.clone()
    }

    /// Starts the engine. On failure the reason is also recorded as the
    /// status, so the interface can show it.
    pub fn start(self: &Arc<Self>, app: &AppHandle) -> Result<(), String> {
        self.spawn(app).inspect_err(|reason| {
            self.lock().status = EngineStatus::Stopped {
                reason: reason.clone(),
            };
            let _ = app.emit(STATUS_CHANNEL, self.status());
        })
    }

    fn spawn(self: &Arc<Self>, app: &AppHandle) -> Result<(), String> {
        let data_dir = data_directory(app)?;
        let media_root = data_dir.join("media");
        std::fs::create_dir_all(&media_root)
            .map_err(|error| format!("Could not create the library folder: {error}"))?;

        // The webview may read media from the library, and finished videos
        // from the library's default export folder, and from nowhere else.
        let exports = data_dir.join("exports");
        std::fs::create_dir_all(&exports)
            .map_err(|error| format!("Could not create the export folder: {error}"))?;
        app.asset_protocol_scope()
            .allow_directory(&media_root, true)
            .map_err(|error| format!("Could not grant access to the library: {error}"))?;
        app.asset_protocol_scope()
            .allow_directory(&exports, true)
            .map_err(|error| format!("Could not grant access to the exports: {error}"))?;

        let (mut events, child) = app
            .shell()
            .sidecar(SIDECAR)
            .map_err(|error| format!("The bundled runtime is missing: {error}"))?
            .args(["--disable-warning=ExperimentalWarning", "--enable-source-maps"])
            .arg(engine_script(app)?)
            .args(["--transport", "stdio", "--data-dir"])
            .arg(&data_dir)
            // Deliver output as raw chunks; frames are split on newlines below.
            .set_raw_out(true)
            .spawn()
            .map_err(|error| format!("The engine process could not be started: {error}"))?;

        let exited = Arc::new(AtomicBool::new(false));
        let generation = {
            let mut inner = self.lock();
            inner.generation += 1;
            inner.running = Some(Running {
                child,
                exited: Arc::clone(&exited),
            });
            inner.status = EngineStatus::Running;
            inner.generation
        };
        let _ = app.emit(STATUS_CHANNEL, EngineStatus::Running);

        let supervisor = Arc::clone(self);
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            // Output arrives in arbitrary chunks; frames are newline-delimited.
            let mut buffer: Vec<u8> = Vec::new();
            while let Some(event) = events.recv().await {
                match event {
                    CommandEvent::Stdout(bytes) => {
                        buffer.extend_from_slice(&bytes);
                        while let Some(end) = buffer.iter().position(|byte| *byte == b'\n') {
                            let line: Vec<u8> = buffer.drain(..=end).collect();
                            supervisor.handle_frame(&app, &line);
                        }
                    }
                    // The engine writes its structured log to stderr. It also
                    // keeps a log file, so this is only echoed while developing.
                    CommandEvent::Stderr(bytes) => {
                        if cfg!(debug_assertions) {
                            eprint!("{}", String::from_utf8_lossy(&bytes));
                        }
                    }
                    CommandEvent::Error(message) => {
                        eprintln!("framebop: engine pipe error: {message}");
                    }
                    CommandEvent::Terminated(payload) => {
                        exited.store(true, Ordering::SeqCst);
                        let reason = match payload.code {
                            Some(0) => "The engine exited.".to_string(),
                            Some(code) => format!("The engine exited with code {code}."),
                            None => "The engine was terminated.".to_string(),
                        };
                        supervisor.handle_exit(&app, generation, reason);
                        break;
                    }
                    _ => {}
                }
            }
        });
        Ok(())
    }

    fn handle_frame(&self, app: &AppHandle, line: &[u8]) {
        let Ok(frame) = serde_json::from_slice::<Value>(line) else {
            return;
        };
        if let Some(event) = frame.get("event") {
            let _ = app.emit(EVENT_CHANNEL, event);
            return;
        }
        let Some(id) = frame.get("id").and_then(Value::as_u64) else {
            return;
        };
        let Some(waiter) = self.lock().pending.remove(&id) else {
            return;
        };
        let reply = if frame.get("ok").and_then(Value::as_bool) == Some(true) {
            Ok(frame.get("result").cloned().unwrap_or(Value::Null))
        } else {
            Err(frame
                .get("error")
                .cloned()
                .unwrap_or_else(|| unavailable("The engine returned a malformed response.")))
        };
        let _ = waiter.send(reply);
    }

    fn handle_exit(&self, app: &AppHandle, generation: u64, reason: String) {
        let waiters: Vec<_> = {
            let mut inner = self.lock();
            if inner.generation != generation {
                return;
            }
            inner.running = None;
            inner.status = EngineStatus::Stopped {
                reason: reason.clone(),
            };
            inner.pending.drain().map(|(_, waiter)| waiter).collect()
        };
        for waiter in waiters {
            let _ = waiter.send(Err(unavailable(
                "The engine stopped before it could answer.",
            )));
        }
        let _ = app.emit(STATUS_CHANNEL, EngineStatus::Stopped { reason });
    }

    /// Sends one request to the engine and waits for its response.
    pub async fn call(&self, method: String, params: Value) -> Reply {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let mut frame = serde_json::to_vec(&json!({ "id": id, "method": method, "params": params }))
            .map_err(|error| unavailable(format!("The request could not be encoded: {error}")))?;
        frame.push(b'\n');

        let (sender, receiver) = oneshot::channel();
        {
            let mut inner = self.lock();
            let Some(running) = inner.running.as_mut() else {
                return Err(unavailable("The production engine is not running."));
            };
            running
                .child
                .write(&frame)
                .map_err(|error| unavailable(format!("The engine is not accepting requests: {error}")))?;
            inner.pending.insert(id, sender);
        }

        match tokio::time::timeout(CALL_TIMEOUT, receiver).await {
            Ok(Ok(reply)) => reply,
            Ok(Err(_)) => Err(unavailable("The engine stopped before it could answer.")),
            Err(_) => {
                self.lock().pending.remove(&id);
                Err(unavailable("The engine did not answer in time."))
            }
        }
    }

    /// Asks the engine to finish and exit, and kills it if it does not.
    ///
    /// Blocks for up to `SHUTDOWN_GRACE`. The engine's database is safe
    /// against a hard kill, but a clean exit lets queued writes complete and
    /// lets running jobs be recorded as interrupted.
    pub fn stop(&self) {
        let running = {
            let mut inner = self.lock();
            // Any exit from here on is expected; do not report it as a crash.
            inner.generation += 1;
            inner.status = EngineStatus::Stopped {
                reason: "The engine was stopped.".to_string(),
            };
            inner.pending.clear();
            inner.running.take()
        };
        let Some(mut running) = running else {
            return;
        };

        let _ = running.child.write(b"{\"control\":\"shutdown\"}\n");
        let deadline = Instant::now() + SHUTDOWN_GRACE;
        while !running.exited.load(Ordering::SeqCst) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(20));
        }
        if !running.exited.load(Ordering::SeqCst) {
            let _ = running.child.kill();
        }
    }
}

/// Where the library lives. Defaults to the per-user application data
/// directory for this platform; `FRAMEBOP_DATA_DIR` overrides it, which is
/// useful for testing and for keeping a library on another drive.
fn data_directory(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(custom) = std::env::var_os("FRAMEBOP_DATA_DIR") {
        let path = PathBuf::from(custom);
        return if path.is_absolute() {
            Ok(path)
        } else {
            Err("FRAMEBOP_DATA_DIR must be an absolute path.".to_string())
        };
    }
    app.path()
        .app_data_dir()
        .map_err(|error| format!("Could not locate the application data folder: {error}"))
}

/// Locates the engine bundle.
///
/// An installed app carries it as a resource. A development build prefers the
/// copy in the workspace, so rebuilding the engine and restarting it picks up
/// the change without rebuilding the shell.
fn engine_script(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    {
        let workspace_copy = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/orchestrator/dist/worker.mjs");
        if let Ok(path) = workspace_copy.canonicalize() {
            return Ok(path);
        }
    }

    let bundled = app
        .path()
        .resolve("engine/worker.mjs", BaseDirectory::Resource)
        .map_err(|error| format!("Could not locate application resources: {error}"))?;
    if bundled.is_file() {
        Ok(bundled)
    } else {
        Err("The engine is missing from this installation. Reinstall Framebop Studio.".to_string())
    }
}

#[tauri::command]
pub async fn engine_call(
    supervisor: State<'_, Arc<EngineSupervisor>>,
    method: String,
    params: Option<Value>,
) -> Result<Value, Value> {
    supervisor
        .call(method, params.unwrap_or_else(|| json!({})))
        .await
}

#[tauri::command]
pub fn engine_status(supervisor: State<'_, Arc<EngineSupervisor>>) -> EngineStatus {
    supervisor.status()
}

#[tauri::command]
pub async fn engine_restart(
    app: AppHandle,
    supervisor: State<'_, Arc<EngineSupervisor>>,
) -> Result<(), String> {
    let supervisor = Arc::clone(&supervisor);
    // `stop` waits for the old process, so keep it off the async runtime.
    let stopping = Arc::clone(&supervisor);
    tauri::async_runtime::spawn_blocking(move || stopping.stop())
        .await
        .map_err(|error| error.to_string())?;
    supervisor.start(&app)
}
