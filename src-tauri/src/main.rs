#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

struct Backend {
    child: Mutex<Option<Child>>,
    job: Mutex<Option<usize>>,
}
impl Backend {
    fn stop(&self) {
        #[cfg(windows)]
        if let Some(handle) = self.job.lock().ok().and_then(|mut job| job.take()) {
            // Closing this job terminates every descendant, including a running target JVM.
            unsafe {
                windows_sys::Win32::Foundation::CloseHandle(handle as _);
            }
        }
        if let Some(mut child) = self.child.lock().ok().and_then(|mut child| child.take()) {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
impl Drop for Backend {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(windows)]
fn attach_job(child: &Child) -> std::io::Result<usize> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::{Foundation::CloseHandle, System::JobObjects::*};
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return Err(std::io::Error::last_os_error());
        }
        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as _,
            std::mem::size_of_val(&info) as u32,
        ) == 0
            || AssignProcessToJobObject(job, child.as_raw_handle() as _) == 0
        {
            let error = std::io::Error::last_os_error();
            CloseHandle(job);
            return Err(error);
        }
        Ok(job as usize)
    }
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") { let _ = window.unminimize(); let _ = window.show(); let _ = window.set_focus(); }
        }))
        .setup(|app| {
            let data = std::env::var_os("CODEVIZ_DESKTOP_DATA_DIR").map(PathBuf::from).unwrap_or(app.path().app_local_data_dir()?);
            let data = dunce::simplified(&data).to_path_buf();
            fs::create_dir_all(data.join("webview"))?;
            let origin = Arc::new(Mutex::new(None::<String>));
            let navigation_origin = origin.clone();
            let navigation_log = if std::env::var("CODEVIZ_DESKTOP_TEST").as_deref() == Ok("1") { Some(data.join("navigation.log")) } else { None };
            let test_exports = if std::env::var("CODEVIZ_DESKTOP_TEST").as_deref() == Ok("1") { Some(data.join("exports")) } else { None };
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Code Visualizer").inner_size(1600.0, 1050.0).min_inner_size(900.0, 650.0).center()
                .theme(Some(tauri::Theme::Dark)).background_color(tauri::window::Color(24,24,24,255))
                .data_directory(data.join("webview"))
                .visible(std::env::var("CODEVIZ_DESKTOP_TEST_HIDE").as_deref() != Ok("1"))
                .on_navigation(move |url| {
                    let expected = navigation_origin.lock().ok().and_then(|o| o.clone());
                    let target = url.origin().ascii_serialization();
                    let allowed = url.scheme() == "tauri" || (url.host_str() == Some("tauri.localhost")) || expected.as_deref() == Some(target.as_str());
                    if let Some(log) = &navigation_log { if let Ok(mut log) = fs::OpenOptions::new().create(true).append(true).open(log) { let _ = writeln!(log, "allowed={allowed} target={target} path={} expected={expected:?}", url.path()); } }
                    allowed
                })
                .on_download(move |_, event| {
                    if let (Some(directory), tauri::webview::DownloadEvent::Requested { destination, .. }) = (&test_exports, event) {
                        let _ = fs::create_dir_all(directory);
                        *destination = directory.join(destination.file_name().unwrap_or_else(|| std::ffi::OsStr::new("trace.json")));
                    }
                    true
                })
                .build()?;
            let resource = app.path().resource_dir()?.join("payload");
            // Cargo run/dev uses the same prepared resources without an installer.
            let resource = if !resource.join("bootstrap.cjs").exists() && cfg!(debug_assertions) { PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/payload") } else { resource };
            // Node's module loader cannot resolve Rust's Windows verbatim paths.
            let resource = dunce::simplified(&resource).to_path_buf();
            let node = resource.join(if cfg!(windows) { "node/node.exe" } else { "node/node" });
            let backend = Arc::new(Backend { child: Mutex::new(None), job: Mutex::new(None) });
            app.manage(backend.clone());
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let launch = || -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
                    let log = fs::OpenOptions::new().create(true).append(true).open(data.join("desktop.log"))?;
                    let mut command = Command::new(&node);
                    command.arg(resource.join("bootstrap.cjs")).arg(&data).current_dir(&data)
                        .env_remove("NODE_OPTIONS").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::from(log));
                    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
                    let mut child = command.spawn()?;
                    #[cfg(windows)] match attach_job(&child) {
                        Ok(job) => *backend.job.lock().unwrap() = Some(job),
                        Err(error) => { let _ = child.kill(); return Err(error.into()); }
                    }
                    let output = child.stdout.take().ok_or("Backend output is unavailable")?;
                    // No descendant can launch until its parent has entered the Windows job.
                    child.stdin.as_mut().ok_or("Backend input is unavailable")?.write_all(b"START\n")?;
                    *backend.child.lock().unwrap() = Some(child);
                    let (send, receive) = std::sync::mpsc::channel();
                    std::thread::spawn(move || {
                        for line in BufReader::new(output).lines().map_while(Result::ok) {
                            if let Some(url) = line.strip_prefix("CODEVIZ_READY ") { let _ = send.send(url.to_owned()); return; }
                        }
                    });
                    let value = receive.recv_timeout(Duration::from_secs(90))?;
                    let url: tauri::Url = value.parse()?;
                    if url.scheme() != "http" || url.host_str() != Some("127.0.0.1") { return Err("Invalid local workspace address".into()); }
                    *origin.lock().unwrap() = Some(url.origin().ascii_serialization());
                    if let Some(window) = handle.get_webview_window("main") { window.navigate(url)?; }
                    Ok(())
                };
                if let Err(error) = launch() {
                    backend.stop();
                    let message = format!("The local workspace could not start: {error}. Details: {}", data.join("desktop.log").display());
                    if let Some(window) = handle.get_webview_window("main") {
                        let text = serde_json::to_string(&message).unwrap_or_default();
                        let _ = window.eval(&format!("document.getElementById('status').textContent='Unable to start';document.getElementById('detail').textContent={text};"));
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!()).expect("Unable to initialize Code Visualizer");
    app.run(|app, event| {
        if matches!(
            event,
            tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
        ) {
            if let Some(backend) = app.try_state::<Arc<Backend>>() {
                backend.stop();
            }
        }
    });
}
