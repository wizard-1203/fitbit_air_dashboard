@echo off
cd /d "%~dp0"
title Health Dashboard - Optimized

REM Keep all dashboard data and credentials beside this launcher.
set "HEALTH_DATA_DIR=%~dp0"
set "HEALTH_DB=%~dp0health.db"
set "HEALTH_CLIENT_SECRET=%~dp0client_secret.json"
set "HEALTH_TOKEN=%~dp0token.json"
set "PORT=8080"

echo =========================
echo   Health Dashboard 
echo =========================
echo.

REM Check Python is available before doing anything else
where python >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Python is not on PATH. Install Python 3.9+ and try again.
    pause
    exit /b 1
)

REM Verify the required files exist next to this script
if not exist "gh.py" (
    echo [ERROR] gh.py not found in this folder.
    pause
    exit /b 1
)
if not exist "server.py" (
    echo [ERROR] server.py not found in this folder.
    pause
    exit /b 1
)
if not exist "index.html" (
    echo [ERROR] index.html not found in this folder.
    pause
    exit /b 1
)

echo Starting server on http://localhost:8080
echo The dashboard will open in your browser in a moment.
echo The initial Google sync runs in the background - you can start
echo using the dashboard immediately.
echo.
echo Press Ctrl-C in this window to stop the server.
echo.

REM Open the browser after a short delay, in the background, without blocking
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:8080'"

REM Run the server. This blocks until Ctrl-C.
python server.py

echo.
echo Server stopped.
pause
