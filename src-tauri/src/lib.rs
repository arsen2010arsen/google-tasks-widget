use std::io::{Read, Write};
use std::net::TcpListener;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, WebviewWindow,
};

fn urlencoding_decode(s: &str) -> String {
    let mut result = String::new();
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '%' {
            let h1 = chars.next().unwrap_or('0');
            let h2 = chars.next().unwrap_or('0');
            let hex = format!("{}{}", h1, h2);
            if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                result.push(byte as char);
                continue;
            }
        }
        result.push(c);
    }
    result
}

#[tauri::command]
async fn wait_for_oauth_code() -> Result<String, String> {
    let listener = TcpListener::bind("127.0.0.1:8085").map_err(|e| format!("Port 8085 busy: {}", e))?;

    for stream in listener.incoming() {
        if let Ok(mut stream) = stream {
            let mut buffer = [0; 2048];
            if let Ok(size) = stream.read(&mut buffer) {
                let req = String::from_utf8_lossy(&buffer[..size]);
                if let Some(pos) = req.find("code=") {
                    let code_part = &req[pos + 5..];
                    let end_pos = code_part
                        .find('&')
                        .or_else(|| code_part.find(' '))
                        .unwrap_or(code_part.len());
                    let code = urlencoding_decode(&code_part[..end_pos]);

                    let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\n\r\n<!DOCTYPE html><html><body style=\"font-family: -apple-system, sans-serif; text-align: center; padding: 60px 20px; background: #14161f; color: #fff;\"><h2 style=\"color: #4285f4; margin-bottom: 12px;\">Успішна авторизація Google Tasks!</h2><p style=\"color: rgba(255,255,255,0.7);\">Віджет успішно підключено до вашого облікового запису. Можете закрити цю вкладку браузера.</p></body></html>";
                    let _ = stream.write_all(response.as_bytes());
                    let _ = stream.flush();
                    return Ok(code);
                }
            }
        }
    }
    Err("OAuth listener closed without code".into())
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
fn set_window_position(window: WebviewWindow, x: f64, y: f64) -> Result<(), String> {
    // Ensure coordinates are valid positive screen coordinates
    if x >= 0.0 && y >= 0.0 {
        window
            .set_position(tauri::LogicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
    } else {
        let _ = window.center();
    }
    let _ = window.unminimize();
    let _ = window.show();
    Ok(())
}

#[tauri::command]
fn get_window_position(window: WebviewWindow) -> Result<(i32, i32), String> {
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    if pos.x < 0 || pos.y < 0 {
        return Err("Window coordinates are negative (minimized)".to_string());
    }
    Ok((pos.x, pos.y))
}

#[tauri::command]
fn set_autostart(enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
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
            let show_item = MenuItem::with_id(app, "show", "Показати віджет на екрані", true, None::<&str>)?;
            let center_item = MenuItem::with_id(app, "center", "Перемістити в центр екрана", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Вийти з віджета", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &center_item, &quit_item])?;

            if let Some(icon) = app.default_window_icon() {
                let _ = TrayIconBuilder::new()
                    .icon(icon.clone())
                    .menu(&menu)
                    .tooltip("Google Tasks Widget")
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.unminimize();
                                let _ = w.show();
                                let _ = w.set_focus();
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
                                let _ = w.unminimize();
                                let _ = w.show();
                                let _ = w.set_focus();
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
            set_window_position,
            get_window_position,
            set_autostart,
            get_autostart,
            wait_for_oauth_code
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
