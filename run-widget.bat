@echo off
cd /d "%~dp0"
taskkill /f /im "tauri-app.exe" >nul 2>&1
taskkill /f /im "google-tasks-widget.exe" >nul 2>&1
ping 127.0.0.1 -n 2 >nul
start "" "%~dp0google-tasks-widget.exe"
exit /b 0
