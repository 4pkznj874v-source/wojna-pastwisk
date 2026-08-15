@echo off
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required.
  pause
  exit /b 1
)
echo Installing dependencies...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo Installation failed.
  pause
  exit /b 1
)
echo Starting Wojna Pastwisk...
call npm start
pause
