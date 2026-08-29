@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js 22.5 or newer is required.
  echo Install Node.js and run this file again.
  pause
  exit /b 1
)

if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  if errorlevel 1 (
    echo [ERROR] Failed to create .env.
    pause
    exit /b 1
  )
  echo [SETUP] Created .env from .env.example.
)

if not exist "node_modules" (
  echo [SETUP] Installing dependencies...
  call npm ci
  if errorlevel 1 (
    echo [ERROR] Dependency installation failed.
    pause
    exit /b 1
  )
)

echo [SETUP] Creating or migrating the SQLite database...
call npm run db:init
if errorlevel 1 (
  echo [ERROR] Database initialization failed.
  pause
  exit /b 1
)

echo [BUILD] Building the web app for single-port LAN serving...
call npm run build
if errorlevel 1 (
  echo [ERROR] Build failed.
  pause
  exit /b 1
)

echo [START] Starting GREEN LINK for the local network.
echo [INFO] Keep this window open while other devices are using the app.
echo [INFO] Use one of the LAN URLs printed below on phones or laptops.
echo [INFO] For different Wi-Fi or mobile data, use start-green-link-public.cmd instead.
set "HOST=0.0.0.0"
if not defined PORT set "PORT=4100"
call npm run start:lan

echo [STOP] GREEN LINK LAN server has stopped.
pause
endlocal
