@echo off
title CharmHealth - Heal Your Heart EHR Template Engine
echo ======================================================================
echo   CHARMHEALTH - CLINICAL TEMPLATE MANAGEMENT SYSTEM
echo   Heal Your Heart - Neelankarai, Chennai, Tamil Nadu
echo ======================================================================
echo.

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

echo [1/3] Setting up environment paths...
set "PATH=C:\Program Files\nodejs;%PATH%"

echo [2/3] Checking Python installation...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in PATH.
    echo Please install Python 3.10+ to run the backend.
    pause
    exit /b 1
)

echo [3/3] Launching CharmHealth Unified Server on http://localhost:5000...
echo.
echo ======================================================================
echo   Application is running!
echo   Direct URL: http://localhost:5000
echo   Demo Login: sanju2kguru@gmail.com / password123
echo ======================================================================
echo.

start "" "http://localhost:5000"
cd backend
python run.py

pause
