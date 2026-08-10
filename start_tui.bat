@echo off
setlocal enabledelayedexpansion

if /i "%~1"=="--legacy-direct" (
    shift
    goto :legacy_entry
)
if not "%~1"=="" goto :legacy_entry

echo [DEPRECATION] start_tui.bat is now a compatibility shim.
echo [DEPRECATION] Forwarding to PrismRefraction.bat tui
call "%~dp0PrismRefraction.bat" tui
exit /b %ERRORLEVEL%

:legacy_entry

mode con: cols=160 lines=50
title PRISM TUI - Terminal Dashboard
color 0F

echo.
echo  ================================================================
echo   PRISM TUI - Terminal User Interface
echo  ================================================================
echo.

:: ---- Node.js check ----
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo   Install from https://nodejs.org/ ^(v22+ recommended^)
    pause
    exit /b 1
)

:: ---- Port configuration ----
set "TUI_PORT=%PRISM_DASHBOARD_PORT%"
if "%TUI_PORT%"=="" (
    powershell -Command "if (Get-NetTCPConnection -LocalPort 7071 -State Listen -ErrorAction SilentlyContinue) { exit 71 } else { exit 70 }"
    if !errorlevel! equ 71 (
        set "TUI_PORT=7071"
        echo [PRISM TUI] Detected active server on port 7071.
    ) else (
        set "TUI_PORT=7070"
        echo [PRISM TUI] No server detected on port 7071, defaulting to port 7070.
    )
)

if not defined PRISM_TUI_AUTOSTART set "PRISM_TUI_AUTOSTART=1"

:: ---- Check if server is running ----
echo [PRISM TUI] Checking PRISM server on port %TUI_PORT%...
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:%TUI_PORT%/api/health' -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200 -or $r.StatusCode -eq 503) { exit 0 } else { exit 1 } } catch { if ($_.Exception.Response -and $_.Exception.Response.StatusCode) { $code = [int]$_.Exception.Response.StatusCode; if ($code -eq 503) { exit 0 } }; exit 1 }" >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [OK] Server is reachable.
    goto :launch_tui
)

echo [WARN] Server not reachable on port %TUI_PORT%.
if /I "%PRISM_TUI_AUTOSTART%"=="0" (
    echo [INFO] Auto-start disabled: PRISM_TUI_AUTOSTART=0. TUI will retry connection.
    goto :launch_tui
)

echo [PRISM TUI] Attempting to auto-start PRISM backend...
where npm >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] npm is not installed or not in PATH.
    pause
    exit /b 1
)

if not exist "dist\src\index.js" (
    echo [PRISM TUI] Build artifacts missing. Running build...
    call npm run build
    if errorlevel 1 (
        echo [ERROR] Build failed. Cannot start backend for TUI.
        pause
        exit /b 1
    )
)

set "PRISM_MODE=server"
if not defined PRISM_ENV_PROFILE set "PRISM_ENV_PROFILE=dev"
if not defined PRISM_DASHBOARD_PORT set "PRISM_DASHBOARD_PORT=%TUI_PORT%"

echo [PRISM TUI] Spawning backend server window...
start "PRISM TUI Backend" cmd /c npm start

echo [PRISM TUI] Waiting for backend health endpoint...
set WAIT_COUNT=0
:wait_backend
set /a WAIT_COUNT+=1
if %WAIT_COUNT% gtr 45 (
    echo [ERROR] Backend did not become healthy within 45 seconds.
    echo [HINT] Check the PRISM TUI Backend window for startup errors.
    pause
    exit /b 1
)
timeout /t 1 /nobreak >nul
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:%TUI_PORT%/api/health' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200 -or $r.StatusCode -eq 503) { exit 0 } else { exit 1 } } catch { if ($_.Exception.Response -and $_.Exception.Response.StatusCode) { $code = [int]$_.Exception.Response.StatusCode; if ($code -eq 503) { exit 0 } }; exit 1 }" >nul 2>nul
if %ERRORLEVEL% neq 0 goto :wait_backend
echo [OK] Backend is reachable.

:launch_tui
echo.
echo [PRISM TUI] Launching terminal dashboard...
echo   Port: %TUI_PORT%
echo   Press ? for help, q to quit
echo.

:: ---- Launch TUI ----
:: Prefer the precompiled bundle (fast, no on-the-fly transpile). Fall back to
:: tsx only when the build artifact is missing.
if exist "dist\src\tui\app.js" (
    node dist\src\tui\app.js --port %TUI_PORT%
) else (
    echo [PRISM TUI] Compiled TUI not found; running via tsx ^(slower^)...
    npx tsx src/tui/app.tsx --port %TUI_PORT%
)

pause
endlocal