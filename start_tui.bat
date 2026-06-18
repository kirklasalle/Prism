@echo off
setlocal enabledelayedexpansion
title PRISM TUI — Terminal Dashboard
color 0F

echo.
echo  ================================================================
echo   PRISM TUI — Terminal User Interface
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
if "%TUI_PORT%"=="" set "TUI_PORT=7070"

:: ---- Check if server is running ----
echo [PRISM TUI] Checking PRISM server on port %TUI_PORT%...
powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:%TUI_PORT%/api/health' -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200) { Write-Host '[OK] Server is running.' } } catch { Write-Host '[WARN] Server not reachable. TUI will retry connection.'; }"

echo.
echo [PRISM TUI] Launching terminal dashboard...
echo   Port: %TUI_PORT%
echo   Press ? for help, q to quit
echo.

:: ---- Launch TUI ----
npx tsx src/tui/app.tsx --port %TUI_PORT%

pause
endlocal