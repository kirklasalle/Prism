@echo off
setlocal

cd /d "%~dp0"

set "PRISM_PREFLIGHT_MODE=%~1"
if "%PRISM_PREFLIGHT_MODE%"=="" set "PRISM_PREFLIGHT_MODE=build"

echo ================================================
echo PRISM One-Click Startup
echo ================================================

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

echo [BUILD] Building PRISM...
call npm run build
if errorlevel 1 goto :fail

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

set PRISM_MODE=server
set PRISM_ENV_PROFILE=dev
if not defined PRISM_DASHBOARD_PORT set "PRISM_DASHBOARD_PORT=7070"

if not defined PRISM_LLM_PROVIDER set PRISM_LLM_PROVIDER=ollama
if not defined PRISM_LLM_MODEL set PRISM_LLM_MODEL=gemma3:1b
if not defined PRISM_OLLAMA_MODELS set PRISM_OLLAMA_MODELS=gemma3:1b,granite3.1-moe:1b,driaforall/tiny-agent-a:1.5b,qwen3-vl:2b

echo [START] Running PRISM server mode...
start "PRISM Server" npm start

echo [WAIT] Waiting for PRISM server to be ready on port %PRISM_DASHBOARD_PORT%...
:wait_loop
timeout /t 1 /nobreak >nul
netstat -ano | find "LISTENING" | find ":%PRISM_DASHBOARD_PORT%" >nul
if errorlevel 1 goto :wait_loop

echo [START] Launching dashboard at http://localhost:%PRISM_DASHBOARD_PORT%
start "" "http://localhost:%PRISM_DASHBOARD_PORT%"

goto :eof

:fail
echo [ERROR] Startup failed. Review the logs above.
pause
exit /b 1