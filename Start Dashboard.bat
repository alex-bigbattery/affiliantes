@echo off
title BigBattery Affiliate Dashboard
cd /d "E:\commission-automation\affiliate-dashboard"

echo ===================================================
echo   BigBattery Affiliate Dashboard
echo ---------------------------------------------------
echo   Backend  (API): http://localhost:3001
echo   Frontend (web): http://localhost:5174   ^<-- OPEN THIS
echo ---------------------------------------------------
echo   Close this window or press Ctrl+C to stop.
echo ===================================================
echo.

REM Open the browser a few seconds after the servers boot
start "" cmd /c "timeout /t 6 >nul & start http://localhost:5174"

REM Start backend + frontend together
call npm run dev
