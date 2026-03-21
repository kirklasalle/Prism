@echo off
setlocal

cd /d "%~dp0"

echo ================================================
echo   PRISM Enterprise Profile
echo   Strict governance, full audit trail
echo   Rollback plans enforced, no whitelist bypass
echo   All mutations require policy evaluation
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

for /f %%i in ('node -p "process.versions.node.split(''.'')[0]"') do set "PRISM_NODE_MAJOR=%%i"
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

REM ── Execution Profile: BUSINESS (Enterprise) ──────────────────────────
set PRISM_EXECUTION_PROFILE=business
set PRISM_ENV_PROFILE=prod
set PRISM_MODE=server

if not defined PRISM_DASHBOARD_PORT set "PRISM_DASHBOARD_PORT=7071"
if not defined PRISM_LLM_PROVIDER set PRISM_LLM_PROVIDER=ollama
if not defined PRISM_LLM_MODEL set PRISM_LLM_MODEL=gemma3:1b
if not defined PRISM_OLLAMA_MODELS set PRISM_OLLAMA_MODELS=gemma3:1b,granite3.1-moe:1b,driaforall/tiny-agent-a:1.5b,qwen3-vl:2b

REM ── Port cleanup ──────────────────────────────────────────────────────
echo [SETUP] Clearing any previous instances on port %PRISM_DASHBOARD_PORT%...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort %PRISM_DASHBOARD_PORT% -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":%PRISM_DASHBOARD_PORT% .*LISTENING"') do taskkill /PID %%p /F >nul 2>nul

REM ── Process cleanup ───────────────────────────────────────────────────
echo [SETUP] Clearing prior PRISM runtime tasks...
taskkill /FI "WINDOWTITLE eq PRISM Enterprise Server*" /T /F >nul 2>nul
taskkill /FI "WINDOWTITLE eq PRISM Server*" /T /F >nul 2>nul
powershell -NoProfile -Command "$root=(Get-Location).Path; Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine -like ('*' + $root + '*dist\\src\\index.js*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

REM ── Build ─────────────────────────────────────────────────────────────
echo [BUILD] Building PRISM...
call npm run build
if errorlevel 1 goto :fail

REM ── Mandatory test preflight (Enterprise requires verified state) ──────
echo [PREFLIGHT] Running mandatory test suite for Enterprise profile...
echo [PREFLIGHT] Enterprise governance requires verified state before launch.
node dist/tests/index.js
if errorlevel 1 (
  echo [ERROR] Test suite failed. Enterprise launch blocked.
  goto :fail
)
echo [PREFLIGHT] Test suite passed.

REM ── Launch ────────────────────────────────────────────────────────────
if /I "%PRISM_SKIP_LAUNCH%"=="1" (
  echo [INFO] PRISM_SKIP_LAUNCH=1 detected; preflight completed, launch skipped.
  goto :eof
)

echo.
echo ================================================
echo   GOVERNANCE MODE ACTIVE
echo   - All operations fully audited
echo   - Mutations require rollback plans
echo   - Tier 1: Non-mutating only (autonomous)
echo   - Tier 2: Rollback plan required
echo   - Tier 3: Approval required (strict)
echo   - Whitelist bypass: DISABLED
echo ================================================
echo.
echo [PROFILE] PRISM_EXECUTION_PROFILE = business
echo [PROFILE] PRISM_ENV_PROFILE       = prod
echo [PROFILE] Dashboard port          = %PRISM_DASHBOARD_PORT%
echo.

echo [START] Launching PRISM Enterprise server...
start "PRISM Enterprise Server" npm start

echo [WAIT] Waiting for server on port %PRISM_DASHBOARD_PORT%...
:wait_loop
timeout /t 1 /nobreak >nul
netstat -ano | find "LISTENING" | find ":%PRISM_DASHBOARD_PORT%" >nul
if errorlevel 1 goto :wait_loop

echo [START] Opening dashboard at http://localhost:%PRISM_DASHBOARD_PORT%
start "" "http://localhost:%PRISM_DASHBOARD_PORT%"

goto :eof

:fail
echo.
echo [ERROR] PRISM Enterprise startup failed.
pause
exit /b 1
