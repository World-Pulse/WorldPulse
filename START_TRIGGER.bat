@echo off
title WorldPulse Remote Trigger
cd /d "%~dp0"
echo.
echo  Starting WorldPulse Remote Trigger Listener...
echo  Keep this window open. Send a message from your phone to start a build.
echo.
python "%~dp0worldpulse_trigger.py"
echo.
echo  Listener stopped. Press any key to close.
pause >nul
