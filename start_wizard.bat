@echo off
setlocal

cd /d "%~dp0"

echo ================================================
echo PRISM Setup Wizard
echo ================================================

REM ── CLI mode: run readline-based wizard instead of browser ──
if /i "%~1"=="--cli" goto :cli_mode
goto :browser_mode

:cli_mode
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found on PATH.
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo [SETUP] Installing dependencies...
  call npm install
  if errorlevel 1 goto :fail
)
echo [WIZARD] Starting CLI Setup Wizard...
npx tsx src/cli/setup-wizard.ts %2 %3 %4 %5 %6 %7 %8 %9
exit /b %ERRORLEVEL%

:browser_mode
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

if not exist "node_modules" (
  echo [SETUP] Installing dependencies...
  call npm install
  if errorlevel 1 goto :fail
)

if not exist "dist" (
  echo [BUILD] Building PRISM...
  call npm run build
  if errorlevel 1 goto :fail
)

if not defined PRISM_DASHBOARD_PORT set "PRISM_DASHBOARD_PORT=7070"

REM Check if server is already running
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:%PRISM_DASHBOARD_PORT%/api/health' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } } catch { exit 1 }"
if %ERRORLEVEL% equ 0 (
  echo [OK] PRISM server already running on port %PRISM_DASHBOARD_PORT%.
  echo [WIZARD] Launching Setup Wizard...
  start "" "http://localhost:%PRISM_DASHBOARD_PORT%/setup?rerun=true"
  goto :eof
)

echo [START] Starting PRISM server...
set PRISM_MODE=server
set PRISM_ENV_PROFILE=dev
if not defined PRISM_LLM_PROVIDER set PRISM_LLM_PROVIDER=ollama
if not defined PRISM_LLM_MODEL set PRISM_LLM_MODEL=gemma3:1b
start "PRISM Server" npm start

echo [WAIT] Waiting for PRISM server on port %PRISM_DASHBOARD_PORT%...
:wait_loop
timeout /t 1 /nobreak >nul
netstat -ano | find "LISTENING" | find ":%PRISM_DASHBOARD_PORT%" >nul
if errorlevel 1 goto :wait_loop

echo [WIZARD] Launching Setup Wizard at http://localhost:%PRISM_DASHBOARD_PORT%/setup
start "" "http://localhost:%PRISM_DASHBOARD_PORT%/setup?rerun=true"

goto :eof

:fail
echo [ERROR] Startup failed. Review the logs above.
pause
