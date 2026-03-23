@echo off
title WorldPulse Brain Agent — Autopilot
color 0B

echo.
echo ============================================================
echo   WORLDPULSE BRAIN AGENT — AUTOPILOT MODE
echo ============================================================
echo   Continuously monitors competition and improves the project
echo   Press CTRL+C or create .brain_kill to stop
echo ============================================================
echo.

cd /d "%~dp0"

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Install Python 3.10+ and try again.
    pause
    exit /b 1
)

:: Install dependencies if needed
echo [INFO] Checking dependencies...
pip install anthropic rich --break-system-packages --quiet 2>nul

echo [START] Launching Brain Agent in autopilot loop...
echo.

python brain_agent.py --loop

echo.
echo [STOPPED] Brain Agent stopped.
pause
