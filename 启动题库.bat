@echo off
cd /d "%~dp0"
start "马原记忆舱服务" /min cmd /c "node server.js"
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:4173"
