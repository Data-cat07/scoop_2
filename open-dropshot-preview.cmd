@echo off
set "DROPSHOT_ROOT=%~dp0"
start "Dropshot Preview Server" /min cmd /k "cd /d "%DROPSHOT_ROOT%" && npm.cmd run dev -- --host 127.0.0.1"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:5173/dropshot-preview.html"
