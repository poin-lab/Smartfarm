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

echo [START] Starting API and web servers...
echo [INFO] Open http://localhost:5177 in your browser.
echo [INFO] For phones or other laptops on the same Wi-Fi, use start-green-link-lan.cmd.
call npm run dev

echo [STOP] GREEN LINK has stopped.
pause
endlocal
