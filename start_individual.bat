@echo off
setlocal

cd /d "%~dp0"

echo ================================================
echo   PRISM Individual Profile
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

REM ── LLM Provider Configuration ─────────────────────────────────────────
REM To allow database-configured providers (e.g. Google Gemini, OpenAI, etc.) 
REM to take effect instead of forcing local Ollama, we do not override them here.
REM If you wish to force local Ollama, uncomment the lines below:
REM if not defined PRISM_LLM_PROVIDER set PRISM_LLM_PROVIDER=ollama
REM if not defined PRISM_LLM_MODEL set PRISM_LLM_MODEL=gemma3:1b
REM if not defined PRISM_OLLAMA_MODELS set PRISM_OLLAMA_MODELS=gemma3:1b,granite3.1-moe:1b,driaforall/tiny-agent-a:1.5b,qwen3-vl:2b

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
if /I "%PRISM_SKIP_LAUNCH%"=="1" (
  echo [INFO] PRISM_SKIP_LAUNCH=1 detected; build completed, launch skipped.
  pause
  goto :eof
)

echo.
echo [PROFILE] PRISM_EXECUTION_PROFILE = individual
echo [PROFILE] PRISM_ENV_PROFILE       = dev
echo [PROFILE] Dashboard port          = %PRISM_DASHBOARD_PORT%
echo.

echo [START] Launching PRISM Individual server...
echo [INFO] Spawning server in a separate window. If it crashes or has errors, that window will stay open to inspect.
start "PRISM Individual Server" cmd /k npm start

echo [WAIT] Waiting for server on port %PRISM_DASHBOARD_PORT%...
REM ── Wait for startup ──────────────────────────────────────────────────
:wait_loop
timeout /t 1 /nobreak >nul
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %PRISM_DASHBOARD_PORT% -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>nul
if %errorlevel% equ 0 goto :server_ready
netstat -ano | find "LISTENING" | find ":%PRISM_DASHBOARD_PORT%" >nul
if %errorlevel% equ 0 goto :server_ready
goto :wait_loop

:server_ready
echo [START] Opening login screen at http://localhost:%PRISM_DASHBOARD_PORT%/login
start "" "http://localhost:%PRISM_DASHBOARD_PORT%/login"

pause
goto :eof

:fail
echo.
echo [ERROR] PRISM Individual startup failed.
pause
exit /b 1
