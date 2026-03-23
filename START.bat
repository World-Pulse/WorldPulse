@echo off
cd /d "%~dp0"
title WorldPulse - Full Build Running
echo.
echo  ============================================
echo   WorldPulse Full Build - 14 Phases
echo   DO NOT CLOSE THIS WINDOW
echo  ============================================
echo.

powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0RUN_ALL_PHASES.ps1"

echo.
echo  Build session ended. Press any key to close.
pause
