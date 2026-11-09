use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, WebviewWindow,
};

#[tauri::command]
fn start_dragging(window: WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
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
fn close_window(window: WebviewWindow) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_window_size(window: WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    window
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    {
        apply_round_corners(&window);
    }

    Ok(())
}

#[cfg(target_os = "windows")]
unsafe extern "system" {
    fn CreateRoundRectRgn(x1: i32, y1: i32, x2: i32, y2: i32, w: i32, h: i32) -> isize;
    fn SetWindowRgn(hWnd: isize, hRgn: isize, bRedraw: i32) -> i32;
    fn DwmSetWindowAttribute(
        hwnd: isize,
        dwAttribute: u32,
        pvAttribute: *const std::ffi::c_void,
        cbAttribute: u32,
    ) -> i32;
}

#[cfg(target_os = "windows")]
fn apply_round_corners(window: &WebviewWindow) {
    if let Ok(hwnd) = window.hwnd() {
        let hwnd_raw = hwnd.0 as isize;
        unsafe {
            // Windows 11 DWM rounded corners preference (DWMWA_WINDOW_CORNER_PREFERENCE = 33, DWMWCP_ROUND = 2)
            let preference: u32 = 2;
            let _ = DwmSetWindowAttribute(
                hwnd_raw,
                33,
                &preference as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<u32>() as u32,
            );

            // GDI RoundRect Region clip to guarantee NO square corners are ever rendered
            if let Ok(size) = window.outer_size() {
                let rgn = CreateRoundRectRgn(0, 0, size.width as i32, size.height as i32, 40, 40);
                if rgn != 0 {
                    let _ = SetWindowRgn(hwnd_raw, rgn, 1);
                }
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Build System Tray
            let show_item = MenuItem::with_id(app, "show", "Показати віджет", true, None::<&str>)?;
            let hide_item = MenuItem::with_id(app, "hide", "Сховати віджет", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Вийти з віджета", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &hide_item, &quit_item])?;

            if let Some(icon) = app.default_window_icon() {
                let _ = TrayIconBuilder::new()
                    .icon(icon.clone())
                    .menu(&menu)
                    .tooltip("Google Tasks Widget")
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        "hide" => {
                            if let Some(w) = app.get_webview_window("main") {
                                let _ = w.hide();
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
                                if w.is_visible().unwrap_or(false) {
                                    let _ = w.hide();
                                } else {
                                    let _ = w.show();
                                    let _ = w.set_focus();
                                }
                            }
                        }
                    })
                    .build(app);
            }

            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "windows")]
                {
                    // Apply native acrylic vibrancy on Windows
                    let _ = window_vibrancy::apply_acrylic(&window, Some((18, 20, 28, 120)));
                    apply_round_corners(&window);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_dragging,
            set_always_on_top,
            minimize_window,
            close_window,
            set_window_size
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
