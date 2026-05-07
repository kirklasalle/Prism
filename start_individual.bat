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
if not defined PRISM_LLM_PROVIDER set PRISM_LLM_PROVIDER=ollama
if not defined PRISM_LLM_MODEL set PRISM_LLM_MODEL=gemma3:1b
if not defined PRISM_OLLAMA_MODELS set PRISM_OLLAMA_MODELS=gemma3:1b,granite3.1-moe:1b,driaforall/tiny-agent-a:1.5b,qwen3-vl:2b

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
  goto :eof
)

echo.
echo [PROFILE] PRISM_EXECUTION_PROFILE = individual
echo [PROFILE] PRISM_ENV_PROFILE       = dev
echo [PROFILE] Dashboard port          = %PRISM_DASHBOARD_PORT%
echo.

echo [START] Launching PRISM Individual server...
start "PRISM Individual Server" npm start

echo [WAIT] Waiting for server on port %PRISM_DASHBOARD_PORT%...
:wait_loop
timeout /t 1 /nobreak >nul
netstat -ano | find "LISTENING" | find ":%PRISM_DASHBOARD_PORT%" >nul
if errorlevel 1 goto :wait_loop

REM ── Resolve workspace root for token file ─────────────────────────────
if not defined PRISM_WORKSPACE_ROOT (
  for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "try { $j = Get-Content '%~dp0.prism-preferences.json' -Raw -ErrorAction Stop ^| ConvertFrom-Json; if ($j.workspaceRoot -and (Test-Path $j.workspaceRoot)) { $j.workspaceRoot } } catch {}"`) do (
    if not "%%P"=="" set "PRISM_WORKSPACE_ROOT=%%P"
  )
)
if not defined PRISM_WORKSPACE_ROOT set "PRISM_WORKSPACE_ROOT=%USERPROFILE%\Documents\Prism_Refraction"

REM ── Read admin auth token ──────────────────────────────────────────────
set "PRISM_TOKEN_FILE=%PRISM_WORKSPACE_ROOT%\state\admin-token"
set "PRISM_AUTH_TOKEN="
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
  echo [START] Opening dashboard at http://localhost:%PRISM_DASHBOARD_PORT%/dashboard?token=...
  start "" "http://localhost:%PRISM_DASHBOARD_PORT%/dashboard?token=%PRISM_AUTH_TOKEN%"
) else (
  echo [WARN] Could not read auth token. Dashboard may require manual token entry.
  echo [START] Opening dashboard at http://localhost:%PRISM_DASHBOARD_PORT%
  start "" "http://localhost:%PRISM_DASHBOARD_PORT%"
)

goto :eof

:fail
echo.
echo [ERROR] PRISM Individual startup failed.
pause
exit /b 1
