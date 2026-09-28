@echo off
title CharmHealth - Development Mode (Vite + Flask)
echo ======================================================================
echo   CHARMHEALTH EHR - DUAL DEV SERVER LAUNCHER
echo ======================================================================
echo.

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"
set "PATH=C:\Program Files\nodejs;%PATH%"

echo Starting Backend on port 5000 in background...
start "CharmHealth Backend API" cmd /k "cd /d %SCRIPT_DIR%backend && python run.py"

echo Starting Frontend Vite server on port 5173...
start "CharmHealth Frontend Dev" cmd /k "cd /d %SCRIPT_DIR%frontend && npm run dev"

timeout /t 3 >nul
start "" "http://localhost:5173"

echo Both servers launched!
