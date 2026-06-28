@echo off
setlocal

cd /d "%~dp0"

echo ================================================
echo   PRISM Individual Profile (Server Only)
echo   Lightweight governance, fast tier 1/2 paths
echo   Approval required for tier 3 only
echo ================================================
echo.

REM ── Node.js check ──────────────────────────────────────────────────────
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found on PATH.
  echo Install Node.js 22+ and re-run this file.
  pause
  exit /b 1
)

for /f %%i in ('node -p "process.versions.node.split('.')[0]"') do set "PRISM_NODE_MAJOR=%%i"
if not defined PRISM_NODE_MAJOR (
  echo [ERROR] Unable to determine Node.js version.
  pause
  exit /b 1
)
if %PRISM_NODE_MAJOR% LSS 22 (
  echo [ERROR] Node.js 22+ is required. Detected major version %PRISM_NODE_MAJOR%.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found on PATH.
  echo Install Node.js/npm and re-run this file.
  pause
  exit /b 1
)

REM ── Dependencies ───────────────────────────────────────────────────────
if not exist "node_modules" (
  echo [SETUP] Installing dependencies...
  call npm install
  if errorlevel 1 goto :fail
)

REM ── Execution Profile: INDIVIDUAL ─────────────────────────────────────
set PRISM_EXECUTION_PROFILE=individual
set PRISM_ENV_PROFILE=dev
set PRISM_MODE=server

if not defined PRISM_DASHBOARD_PORT set "PRISM_DASHBOARD_PORT=7070"

REM ── Port cleanup ──────────────────────────────────────────────────────
echo [SETUP] Clearing any previous instances on port %PRISM_DASHBOARD_PORT%...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort %PRISM_DASHBOARD_PORT% -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":%PRISM_DASHBOARD_PORT% .*LISTENING"') do taskkill /PID %%p /F >nul 2>nul

REM ── Process cleanup ───────────────────────────────────────────────────
echo [SETUP] Clearing prior PRISM runtime tasks...
taskkill /FI "WINDOWTITLE eq PRISM Individual Server*" /T /F >nul 2>nul
taskkill /FI "WINDOWTITLE eq PRISM Server*" /T /F >nul 2>nul
powershell -NoProfile -Command "$root=(Get-Location).Path; Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine -like ('*' + $root + '*dist\\src\\index.js*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

REM ── Build ─────────────────────────────────────────────────────────────
echo [BUILD] Building PRISM...
call npm run build
if errorlevel 1 goto :fail

REM ── Launch ────────────────────────────────────────────────────────────
echo.
echo [PROFILE] PRISM_EXECUTION_PROFILE = individual
echo [PROFILE] PRISM_ENV_PROFILE       = dev
echo [PROFILE] Dashboard port          = %PRISM_DASHBOARD_PORT%
echo.

echo [START] Starting PRISM server in foreground...
echo [INFO] Press Ctrl+C to stop the server.
echo.
node dist/src/index.js
if errorlevel 1 goto :fail
goto :eof

:fail
echo.
echo [ERROR] PRISM Individual startup failed.
pause
exit /b 1
