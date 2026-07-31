@echo off
setlocal

if /i "%~1"=="--legacy-direct" (
  shift
  goto :legacy_entry
)
if not "%~1"=="" goto :legacy_entry

echo [DEPRECATION] start_wizard.bat is now a compatibility shim.
echo [DEPRECATION] Forwarding to PrismRefraction.bat wizard
call "%~dp0PrismRefraction.bat" wizard
exit /b %ERRORLEVEL%

:legacy_entry

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
pause
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

if /I not "%PRISM_WIZARD_SKIP_BUILD%"=="1" (
  echo [BUILD] Building PRISM wizard assets...
  call npm run build
  if errorlevel 1 goto :fail
) else (
  if not exist "dist" (
    echo [BUILD] Building PRISM...
    call npm run build
    if errorlevel 1 goto :fail
  )
)

if not defined PRISM_DASHBOARD_PORT set "PRISM_DASHBOARD_PORT=7070"

if not defined PRISM_ALLOW_QUERY_TOKEN set "PRISM_ALLOW_QUERY_TOKEN=1"

if not defined PRISM_WORKSPACE_ROOT (
  for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "try { $j = Get-Content '%~dp0.prism-preferences.json' -Raw -ErrorAction Stop | ConvertFrom-Json; if ($j.workspaceRoot -and (Test-Path $j.workspaceRoot)) { $j.workspaceRoot } } catch {}"`) do (
    if not "%%P"=="" set "PRISM_WORKSPACE_ROOT=%%P"
  )
)
if not defined PRISM_WORKSPACE_ROOT set "PRISM_WORKSPACE_ROOT=%USERPROFILE%\Documents\Prism_Refraction"

set "PRISM_TOKEN_FILE=%PRISM_WORKSPACE_ROOT%\state\admin-token"
set "PRISM_AUTH_TOKEN="
call :read_token

set "PRISM_SETUP_URL=http://localhost:%PRISM_DASHBOARD_PORT%/setup?rerun=true"
if defined PRISM_AUTH_TOKEN set "PRISM_SETUP_URL=http://localhost:%PRISM_DASHBOARD_PORT%/setup?rerun=true^&token=%PRISM_AUTH_TOKEN%"

REM Check if server is already running
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:%PRISM_DASHBOARD_PORT%/api/health' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } } catch { exit 1 }"
if %ERRORLEVEL% equ 0 (
  echo [OK] PRISM server already running on port %PRISM_DASHBOARD_PORT%.
  call :wizard_selftest
  echo [WIZARD] Launching Setup Wizard...
  start "" "%PRISM_SETUP_URL%"
  pause
  goto :eof
)

echo [START] Starting PRISM server...
set PRISM_MODE=server
set PRISM_ENV_PROFILE=dev

REM ── LLM Provider Configuration ─────────────────────────────────────────
REM To allow database-configured providers (e.g. Google Gemini, OpenAI, etc.) 
REM to take effect instead of forcing local Ollama, we do not override them here.
REM If you wish to force local Ollama, uncomment the lines below:
REM if not defined PRISM_LLM_PROVIDER set PRISM_LLM_PROVIDER=ollama
REM if not defined PRISM_LLM_MODEL set PRISM_LLM_MODEL=gemma3:1b

echo [INFO] Spawning server in a separate window. If it crashes or has errors, that window will close upon exit.
start "PRISM Server" cmd /c npm start

echo [WAIT] Waiting for PRISM server on port %PRISM_DASHBOARD_PORT%...
:wait_loop
timeout /t 1 /nobreak >nul
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %PRISM_DASHBOARD_PORT% -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }" >nul 2>nul
if %errorlevel% equ 0 goto :server_ready
netstat -ano | find "LISTENING" | find ":%PRISM_DASHBOARD_PORT%" >nul
if %errorlevel% equ 0 goto :server_ready
goto :wait_loop

:server_ready

if not defined PRISM_AUTH_TOKEN call :wait_for_token
call :read_token

set "PRISM_SETUP_URL=http://localhost:%PRISM_DASHBOARD_PORT%/setup?rerun=true"
if defined PRISM_AUTH_TOKEN set "PRISM_SETUP_URL=http://localhost:%PRISM_DASHBOARD_PORT%/setup?rerun=true^&token=%PRISM_AUTH_TOKEN%"

call :wizard_selftest

echo [WIZARD] Launching Setup Wizard at http://localhost:%PRISM_DASHBOARD_PORT%/setup
start "" "%PRISM_SETUP_URL%"

echo [MONITOR] PRISM is running. Monitoring for shutdown...
:monitor_loop
timeout /t 2 /nobreak >nul
netstat -ano | find "LISTENING" | find ":%PRISM_DASHBOARD_PORT%" >nul
if %errorlevel% equ 0 goto :monitor_loop

echo [SHUTDOWN] PRISM server has shut down. Exiting launcher.
goto :eof

:read_token
set "PRISM_AUTH_TOKEN="
if exist "%PRISM_TOKEN_FILE%" (
  for /f "usebackq delims=" %%T in ("%PRISM_TOKEN_FILE%") do set "PRISM_AUTH_TOKEN=%%T"
)
exit /b 0

:wait_for_token
set "PRISM_TOKEN_RETRIES=0"
:token_wait_loop
if exist "%PRISM_TOKEN_FILE%" exit /b 0
set /a PRISM_TOKEN_RETRIES+=1
if %PRISM_TOKEN_RETRIES% GEQ 5 exit /b 0
timeout /t 1 /nobreak >nul
goto :token_wait_loop

:wizard_selftest
echo [SELFTEST] Verifying wizard auth/token readiness...
if not defined PRISM_AUTH_TOKEN (
  echo [SELFTEST][WARN] Admin token not found at %PRISM_TOKEN_FILE%.
  echo [SELFTEST][WARN] Wizard will open; login may be required.
  exit /b 0
)
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri '%PRISM_SETUP_URL%' -UseBasicParsing -MaximumRedirection 0 -TimeoutSec 4 -ErrorAction Stop; if ($r.StatusCode -eq 200 -or $r.StatusCode -eq 302) { exit 0 } else { exit 1 } } catch { if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode; if ($code -eq 302) { exit 0 } else { exit 1 } } else { exit 1 } }"
if errorlevel 1 (
  echo [SELFTEST][WARN] Wizard endpoint auth self-test failed.
  echo [SELFTEST][WARN] Opening login page fallback.
  set "PRISM_SETUP_URL=http://localhost:%PRISM_DASHBOARD_PORT%/login"
) else (
  echo [SELFTEST][OK] Wizard endpoint responded successfully.
)
exit /b 0

:fail
echo [ERROR] Startup failed. Review the logs above.
pause
