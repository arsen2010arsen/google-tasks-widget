@echo off
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
echo Starting Google Tasks macOS Widget...
npm run tauri dev
pause
