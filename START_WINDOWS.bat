@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is missing. Install Node.js 20 or newer.
  pause
  exit /b 1
)
echo Installing dependencies...
call npm install
if errorlevel 1 (
  echo Installation failed.
  pause
  exit /b 1
)
echo Starting Wojna Pastwisk...
call npm start
pause
