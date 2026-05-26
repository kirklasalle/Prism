@echo off
setlocal

cd /d "%~dp0"

set "PRISM_PREFLIGHT_MODE=%~1"
if "%PRISM_PREFLIGHT_MODE%"=="" set "PRISM_PREFLIGHT_MODE=build"

echo ================================================
echo PRISM One-Click Startup
echo ================================================

REM ── Phase A1: Dev Identity ^& CAC Bootstrap ──────────────────────────────
REM These environment variables configure the development operator identity,
REM CAC mode, tab session initialization, and telemetry piping. All values
REM are mock data for development purposes only.
if not defined PRISM_DEV_IDENTITY set "PRISM_DEV_IDENTITY=prism-dev-operator"
if not defined PRISM_DEV_EMAIL set "PRISM_DEV_EMAIL=prism-dev-operator@localhost"
if not defined PRISM_CAC_MODE set "PRISM_CAC_MODE=development"
if not defined PRISM_TAB_SESSION_INIT set "PRISM_TAB_SESSION_INIT=all"
if not defined PRISM_TELEMETRY_PIPE set "PRISM_TELEMETRY_PIPE=logs"
if not defined PRISM_AUTONOMOUS_ENABLED set "PRISM_AUTONOMOUS_ENABLED=true"
if not defined PRISM_ALLOW_QUERY_TOKEN set "PRISM_ALLOW_QUERY_TOKEN=1"

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

if not defined PRISM_DASHBOARD_PORT set "PRISM_DASHBOARD_PORT=7070"

echo [SETUP] Clearing any previous instances running on port %PRISM_DASHBOARD_PORT%...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort %PRISM_DASHBOARD_PORT% -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":%PRISM_DASHBOARD_PORT% .*LISTENING"') do taskkill /PID %%p /F >nul 2>nul

echo [SETUP] Clearing prior PRISM runtime tasks...
taskkill /FI "WINDOWTITLE eq PRISM Server*" /T /F >nul 2>nul
powershell -NoProfile -Command "$root=(Get-Location).Path; Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine -like ('*' + $root + '*dist\\src\\index.js*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

echo [BUILD] Building PRISM...
call npm run build
if errorlevel 1 goto :fail

echo [WORKSPACE] Verifying Prism_Refraction workspace...
if not defined PRISM_WORKSPACE_ROOT (
  REM Check persisted preferences first
  for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "try { $j = Get-Content '%~dp0.prism-preferences.json' -Raw -ErrorAction Stop | ConvertFrom-Json; if ($j.workspaceRoot -and (Test-Path $j.workspaceRoot)) { $j.workspaceRoot } } catch {}"`) do (
    if not "%%P"=="" set "PRISM_WORKSPACE_ROOT=%%P"
  )
)
if not defined PRISM_WORKSPACE_ROOT (
  set "PRISM_WORKSPACE_ROOT=%USERPROFILE%\Documents\Prism_Refraction"
)
if not exist "%PRISM_WORKSPACE_ROOT%" (
  echo [WORKSPACE] Creating workspace at %PRISM_WORKSPACE_ROOT%
  mkdir "%PRISM_WORKSPACE_ROOT%"
)
echo [WORKSPACE] %PRISM_WORKSPACE_ROOT%

if /I "%PRISM_PREFLIGHT_MODE%"=="build" goto :post_preflight
if /I "%PRISM_PREFLIGHT_MODE%"=="test" goto :preflight_test
if /I "%PRISM_PREFLIGHT_MODE%"=="release" goto :preflight_release
if /I "%PRISM_PREFLIGHT_MODE%"=="strict" goto :preflight_strict

echo [ERROR] Unknown preflight mode: %PRISM_PREFLIGHT_MODE%
echo Usage: start_web.bat [build^|test^|release^|strict]
echo   build   - build only (default)
echo   test    - full npm test before launch
echo   release - run npm run release:validate before launch
echo   strict  - run npm run release:validate:strict before launch
pause
exit /b 1

:preflight_test
echo [PREFLIGHT] Running full test suite...
call npm test
if errorlevel 1 goto :fail
goto :post_preflight

:preflight_release
echo [PREFLIGHT] Running release validation...
call npm run release:validate
if errorlevel 1 goto :fail
goto :post_preflight

:preflight_strict
echo [PREFLIGHT] Running strict release validation...
call npm run release:validate:strict
if errorlevel 1 goto :fail
goto :post_preflight

:post_preflight
if /I "%PRISM_SKIP_LAUNCH%"=="1" (
  echo [INFO] PRISM_SKIP_LAUNCH=1 detected; startup checks completed, launch skipped.
  goto :eof
)

REM Configuration: execution profile determines policy governance tier availability.
REM   Default (inferred from environment): dev -> INDIVIDUAL_PROFILE, prod -> BUSINESS_PROFILE
REM   To override:
REM     set PRISM_EXECUTION_PROFILE=business   (or 'individual')
REM     set PRISM_EXECUTION_SEGMENT=business   (or 'individual')
REM   Examples:
REM     For production with strict governance (default):   (no override needed, inferred from prod)
REM     For development with fast defaults (default):      (no override needed, inferred from dev)
REM     For dev/staging with business rules:               set PRISM_EXECUTION_PROFILE=business
REM     For production with individual profile (not recommended):  set PRISM_EXECUTION_PROFILE=individual

set PRISM_MODE=server
set PRISM_ENV_PROFILE=dev
if not defined PRISM_DASHBOARD_PORT set "PRISM_DASHBOARD_PORT=7070"

if not defined PRISM_LLM_PROVIDER set PRISM_LLM_PROVIDER=google
if not defined PRISM_LLM_MODEL set PRISM_LLM_MODEL=gemini-3.0-flash
if not defined PRISM_OLLAMA_MODELS set PRISM_OLLAMA_MODELS=gemma3:1b,granite3.1-moe:1b,driaforall/tiny-agent-a:1.5b,qwen3-vl:2b

echo [START] Running PRISM server mode...

REM Check if PM2 is available and user wants managed mode
where pm2 >nul 2>nul
if errorlevel 1 goto :start_direct
if /I "%PRISM_USE_PM2%"=="0" goto :start_direct
echo [PM2] PM2 detected. Starting with process management...
echo [PM2] To disable: set PRISM_USE_PM2=0
if not exist "logs" mkdir logs
pm2 start ecosystem.config.js
echo [PM2] PRISM launched via PM2. Use 'pm2 logs prism' or 'npm run pm2:monit' to monitor.
goto :wait_loop

:start_direct
echo [INFO] Spawning server in a separate window. If it crashes or has errors, that window will stay open to inspect.
start "PRISM Server" cmd /k npm start

echo [WAIT] Waiting for PRISM server to be ready on port %PRISM_DASHBOARD_PORT%...
:wait_loop
timeout /t 1 /nobreak >nul
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %PRISM_DASHBOARD_PORT% -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>nul
if %errorlevel% equ 0 goto :server_ready
netstat -ano | find "LISTENING" | find ":%PRISM_DASHBOARD_PORT%" >nul
if %errorlevel% equ 0 goto :server_ready
goto :wait_loop

:server_ready

REM Read admin auth token from workspace state (written by server on startup)
set "PRISM_TOKEN_FILE=%PRISM_WORKSPACE_ROOT%\state\admin-token"
set "PRISM_AUTH_TOKEN="
REM Brief wait for token file (server writes it shortly after binding port)
set "PRISM_TOKEN_RETRIES=0"
:token_wait
if exist "%PRISM_TOKEN_FILE%" goto :token_read
set /a PRISM_TOKEN_RETRIES+=1
if %PRISM_TOKEN_RETRIES% GEQ 5 goto :token_read
timeout /t 1 /nobreak >nul
goto :token_wait
:token_read
if exist "%PRISM_TOKEN_FILE%" (
  for /f "usebackq delims=" %%T in ("%PRISM_TOKEN_FILE%") do set "PRISM_AUTH_TOKEN=%%T"
)

if defined PRISM_AUTH_TOKEN (
  echo [START] Launching dashboard at http://localhost:%PRISM_DASHBOARD_PORT%/dashboard?token=...
  start "" "http://localhost:%PRISM_DASHBOARD_PORT%/dashboard?token=%PRISM_AUTH_TOKEN%"
) else (
  echo [WARN] Could not read auth token. Dashboard may require manual token entry.
  echo [START] Launching dashboard at http://localhost:%PRISM_DASHBOARD_PORT%
  start "" "http://localhost:%PRISM_DASHBOARD_PORT%"
)

goto :eof

:fail
echo [ERROR] Startup failed. Review the logs above.
pause
exit /b 1