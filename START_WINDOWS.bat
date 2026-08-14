@echo off
chcp 65001 >nul
where node >nul 2>nul
if errorlevel 1 (
  echo Brak Node.js. Zainstaluj Node.js 20 lub nowszy i uruchom plik ponownie.
  pause
  exit /b 1
)
echo Instaluję zależności...
call npm install
if errorlevel 1 (
  echo Instalacja nie powiodła się.
  pause
  exit /b 1
)
echo Uruchamiam Wojne Pastwisk...
call npm start
pause
