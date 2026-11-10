use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, WebviewWindow,
};
use tauri_plugin_opener::OpenerExt;

static OAUTH_CANCEL: AtomicBool = AtomicBool::new(false);

fn urlencoding_decode(s: &str) -> String {
    let mut bytes = Vec::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '%' {
            if let (Some(h1), Some(h2)) = (chars.next(), chars.next()) {
                let hex = format!("{}{}", h1, h2);
                if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                    bytes.push(byte);
                    continue;
                } else {
                    bytes.extend_from_slice(format!("%{}{}", h1, h2).as_bytes());
                    continue;
                }
            } else {
                bytes.push(b'%');
                continue;
            }
        }
        let mut b = [0; 4];
        let str_slice = c.encode_utf8(&mut b);
        bytes.extend_from_slice(str_slice.as_bytes());
    }
    String::from_utf8_lossy(&bytes).to_string()
}

#[tauri::command]
fn cancel_oauth_flow() {
    OAUTH_CANCEL.store(true, Ordering::SeqCst);
}

#[tauri::command]
fn open_browser_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    app.opener().open_url(&url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
async fn wait_for_oauth_code() -> Result<String, String> {
    OAUTH_CANCEL.store(false, Ordering::SeqCst);

    // Try binding to 127.0.0.1:8085; if port is temporarily occupied from previous session, signal cancel and retry
    let listener = match TcpListener::bind("127.0.0.1:8085") {
        Ok(l) => l,
        Err(_) => {
            OAUTH_CANCEL.store(true, Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(300));
            OAUTH_CANCEL.store(false, Ordering::SeqCst);
            TcpListener::bind("127.0.0.1:8085").map_err(|e| {
                format!("Порт 127.0.0.1:8085 зайнятий іншою програмою: {}", e)
            })?
        }
    };

    listener.set_nonblocking(true).map_err(|e| e.to_string())?;

    let start = Instant::now();
    let timeout = Duration::from_secs(120);

    loop {
        if OAUTH_CANCEL.load(Ordering::SeqCst) {
            return Err("Авторизацію скасовано".into());
        }

        if start.elapsed() > timeout {
            return Err("Час очікування авторизації минув (2 хвилини). Спробуйте ще раз.".into());
        }

        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_nonblocking(false);
                let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                let mut buffer = [0; 4096];
                if let Ok(size) = stream.read(&mut buffer) {
                    let req = String::from_utf8_lossy(&buffer[..size]);

                    // Check for OAuth error from Google
                    if let Some(pos) = req.find("error=") {
                        let err_part = &req[pos + 6..];
                        let end_pos = err_part
                            .find(|c| c == '&' || c == ' ' || c == '\r' || c == '\n')
                            .unwrap_or(err_part.len());
                        let err_code = urlencoding_decode(&err_part[..end_pos]);

                        let html = format!(
                            "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Помилка</title></head><body style=\"font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;text-align:center;padding:60px 20px;background:#14161f;color:#fff;\"><h2 style=\"color:#ff453a;margin-bottom:12px;\">Помилка авторизації Google</h2><p style=\"color:rgba(255,255,255,0.7);\">Отримано помилку: {}</p><p style=\"margin-top:20px;color:rgba(255,255,255,0.4);font-size:13px;\">Можете закрити цю вкладку браузера.</p></body></html>",
                            err_code
                        );
                        let response = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
                            html.as_bytes().len(),
                            html
                        );
                        let _ = stream.write_all(response.as_bytes());
                        let _ = stream.flush();
                        return Err(format!("Google OAuth помилка: {}", err_code));
                    }

                    // Check for authorization code
                    if let Some(pos) = req.find("code=") {
                        let code_part = &req[pos + 5..];
                        let end_pos = code_part
                            .find(|c| c == '&' || c == ' ' || c == '\r' || c == '\n')
                            .unwrap_or(code_part.len());
                        let code = urlencoding_decode(&code_part[..end_pos]);

                        let html = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Google Tasks Widget</title></head><body style=\"font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;text-align:center;padding:60px 20px;background:#14161f;color:#fff;\"><div style=\"max-width:440px;margin:0 auto;background:rgba(255,255,255,0.05);padding:30px;border-radius:16px;border:1px solid rgba(255,255,255,0.1);\"><h2 style=\"color:#4285f4;margin-bottom:12px;\">✅ Успішна авторизація!</h2><p style=\"color:rgba(255,255,255,0.85);font-size:15px;line-height:1.5;\">Віджет Google Tasks успішно підключено до вашого облікового запису.</p><p style=\"margin-top:24px;color:rgba(255,255,255,0.4);font-size:13px;\">Тепер можете закрити цю вкладку та повернутися до віджета.</p></div></body></html>";
                        let response = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
                            html.as_bytes().len(),
                            html
                        );
                        let _ = stream.write_all(response.as_bytes());
                        let _ = stream.flush();
                        return Ok(code);
                    }

                    // For favicon or other requests, return 204 No Content
                    let not_found = "HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n";
                    let _ = stream.write_all(not_found.as_bytes());
                    let _ = stream.flush();
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => {
                return Err(format!("Помилка сокета: {}", e));
            }
        }
    }
}

#[tauri::command]
fn start_dragging(window: WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
fn reset_window_position(window: WebviewWindow) -> Result<(), String> {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.center();
    let _ = window.set_focus();
    Ok(())
}

#[tauri::command]
fn set_always_on_top(window: WebviewWindow, always_on_top: bool) -> Result<(), String> {
    window.set_always_on_top(always_on_top).map_err(|e| e.to_string())
}

#[tauri::command]
fn minimize_window(window: WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn hide_window(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

#[tauri::command]
fn close_window(window: WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn set_window_size(window: WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_window_resizable(window: WebviewWindow, resizable: bool) -> Result<(), String> {
    window.set_resizable(resizable).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_window_position(window: WebviewWindow, mut x: i32, mut y: i32) -> Result<(i32, i32), String> {
    // Ensure coordinates stay within the visible screen area without artificial padding
    if let Ok(Some(monitor)) = window.current_monitor().or_else(|_| window.primary_monitor()) {
        let mon_pos = monitor.position();
        let mon_size = monitor.size();
        let scale = window.scale_factor().unwrap_or(1.0);
        let win_size = window.outer_size().unwrap_or(tauri::PhysicalSize::new(
            (300.0 * scale) as u32,
            (390.0 * scale) as u32,
        ));

        let min_x = mon_pos.x;
        let min_y = mon_pos.y;
        let max_x = mon_pos.x + (mon_size.width as i32) - (win_size.width as i32);
        let max_y = mon_pos.y + (mon_size.height as i32) - (win_size.height as i32);

        if max_x >= min_x {
            x = x.clamp(min_x, max_x);
        }
        if max_y >= min_y {
            y = y.clamp(min_y, max_y);
        }
    }

    // Set position in physical pixels matching outer_position!
    window
        .set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;

    let _ = window.unminimize();
    let _ = window.show();
    Ok((x, y))
}

#[tauri::command]
fn set_window_corner(window: WebviewWindow, corner: String) -> Result<(i32, i32), String> {
    let (x, y) = if let Ok(Some(monitor)) = window.current_monitor().or_else(|_| window.primary_monitor()) {
        let mon_pos = monitor.position();
        let mon_size = monitor.size();
        let scale = window.scale_factor().unwrap_or(1.0);
        let win_size = window.outer_size().unwrap_or(tauri::PhysicalSize::new(
            (300.0 * scale) as u32,
            (390.0 * scale) as u32,
        ));
        let padding = (20.0 * scale) as i32;

        match corner.as_str() {
            "top-left" => (mon_pos.x + padding, mon_pos.y + padding),
            "top-right" => (
                mon_pos.x + (mon_size.width as i32) - (win_size.width as i32) - padding,
                mon_pos.y + padding,
            ),
            "bottom-left" => (
                mon_pos.x + padding,
                mon_pos.y + (mon_size.height as i32) - (win_size.height as i32) - padding,
            ),
            "bottom-right" => (
                mon_pos.x + (mon_size.width as i32) - (win_size.width as i32) - padding,
                mon_pos.y + (mon_size.height as i32) - (win_size.height as i32) - padding,
            ),
            _ => {
                let _ = window.center();
                let p = window.outer_position().unwrap_or(tauri::PhysicalPosition::new(100, 100));
                (p.x, p.y)
            }
        }
    } else {
        (20, 20)
    };

    window
        .set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    let _ = window.unminimize();
    let _ = window.show();
    Ok((x, y))
}

#[tauri::command]
fn get_window_position(window: WebviewWindow) -> Result<(i32, i32), String> {
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    Ok((pos.x, pos.y))
}

#[tauri::command]
fn set_autostart(enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (key, _) = hkcu
            .create_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Run")
            .map_err(|e| e.to_string())?;

        if enabled {
            let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
            let exe_str = format!("\"{}\"", exe_path.to_string_lossy());
            key.set_value("GoogleTasksWidget", &exe_str)
                .map_err(|e| e.to_string())?;
        } else {
            let _ = key.delete_value("GoogleTasksWidget");
        }
    }
    Ok(())
}

#[tauri::command]
fn get_autostart() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(key) = hkcu.open_subkey_with_flags(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Run",
            KEY_READ,
        ) {
            let val: Result<String, _> = key.get_value("GoogleTasksWidget");
            return Ok(val.is_ok());
        }
    }
    #[allow(unreachable_code)]
    Ok(false)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Build System Tray Menu
            let toggle_item = MenuItem::with_id(app, "toggle", "Показати / Сховати віджет", true, None::<&str>)?;
            let center_item = MenuItem::with_id(app, "center", "Перемістити в центр екрана", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Повністю закрити програму", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle_item, &center_item, &quit_item])?;

            if let Some(icon) = app.default_window_icon() {
                let _ = TrayIconBuilder::new()
                    .icon(icon.clone())
                    .menu(&menu)
                    .tooltip("Google Tasks Widget (клікніть, щоб сховати/показати)")
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "toggle" => {
                            if let Some(w) = app.get_webview_window("main") {
                                if let Ok(is_visible) = w.is_visible() {
                                    if is_visible {
                                        let _ = w.hide();
                                    } else {
                                        let _ = w.unminimize();
                                        let _ = w.show();
                                        let _ = w.set_focus();
                                    }
                                } else {
                                    let _ = w.unminimize();
                                    let _ = w.show();
                                    let _ = w.set_focus();
                                }
                            }
                        }
                        "center" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.unminimize();
                                let _ = w.show();
                                let _ = w.center();
                                let _ = w.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let tauri::tray::TrayIconEvent::Click {
                            button: tauri::tray::MouseButton::Left,
                            button_state: tauri::tray::MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(w) = app.get_webview_window("main") {
                                if let Ok(is_visible) = w.is_visible() {
                                    if is_visible {
                                        let _ = w.hide();
                                    } else {
                                        let _ = w.unminimize();
                                        let _ = w.show();
                                        let _ = w.set_focus();
                                    }
                                } else {
                                    let _ = w.unminimize();
                                    let _ = w.show();
                                    let _ = w.set_focus();
                                }
                            }
                        }
                    })
                    .build(app);
            }

            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_dragging,
            reset_window_position,
            set_always_on_top,
            minimize_window,
            hide_window,
            close_window,
            exit_app,
            set_window_size,
            set_window_resizable,
            set_window_position,
            get_window_position,
            set_window_corner,
            set_autostart,
            get_autostart,
            wait_for_oauth_code,
            cancel_oauth_flow,
            open_browser_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
