@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

title PrismRefraction Launcher
color 0B

set "PRISM_ROUTE=%~1"
if not "%~1"=="" shift
set "PRISM_ROUTE_ARGS=%*"

call :full_system_check
if errorlevel 1 goto fatal

if /I "%PRISM_ROUTE%"=="individual" goto run_individual
if /I "%PRISM_ROUTE%"=="enterprise" goto run_enterprise
if /I "%PRISM_ROUTE%"=="wizard" goto run_wizard
if /I "%PRISM_ROUTE%"=="tui" goto run_tui
if /I "%PRISM_ROUTE%"=="backend" goto run_backend
if /I "%PRISM_ROUTE%"=="web" goto run_web
if /I "%PRISM_ROUTE%"=="verify" goto run_quick_verify
if /I "%PRISM_ROUTE%"=="advanced" goto advanced_menu
if /I "%PRISM_ROUTE%"=="checks" goto done

:menu
cls
echo.
echo  ===============================================================================
echo    PRISM REFRACTION :: MASTER CONTROL LAUNCHER
echo    Canonical startup with full preflight and advanced operations
echo.
echo  PRISM Refraction Master Launcher
echo  ===============================================================================
echo.
echo    [1] Start Individual Profile (Web + Login)
echo    [2] Start Enterprise/Business Profile
echo    [3] Start Setup Wizard
echo    [4] Start TUI (Terminal UI)
echo    [5] Start Backend Only (Foreground)
echo    [6] Start Web One-Click (Full Preflight)
echo    [7] Open Dev Shell (new terminal)
echo    [8] Open Dashboard URL (port 7070)
echo    [9] Run Quick Verification (build + wizard JS syntax)
echo    [A] Advanced Operations Menu
echo    [R] Re-run Full System Check
echo    [0] Exit
echo.
set /p CHOICE=Select an option ^> 

if "%CHOICE%"=="1" goto run_individual
if "%CHOICE%"=="2" goto run_enterprise
if "%CHOICE%"=="3" goto run_wizard
if "%CHOICE%"=="4" goto run_tui
if "%CHOICE%"=="5" goto run_backend
if "%CHOICE%"=="6" goto run_web
if "%CHOICE%"=="7" goto run_dev_shell
if "%CHOICE%"=="8" goto open_dashboard
if "%CHOICE%"=="9" goto run_quick_verify
if /I "%CHOICE%"=="A" goto advanced_menu
if /I "%CHOICE%"=="R" goto rerun_checks
if "%CHOICE%"=="0" goto done

echo.
echo [WARN] Invalid selection: %CHOICE%
timeout /t 1 /nobreak >nul
goto menu

:run_individual
call "%~dp0start_individual.bat" --legacy-direct %PRISM_ROUTE_ARGS%
goto menu

:run_enterprise
call "%~dp0start_enterprise.bat" --legacy-direct %PRISM_ROUTE_ARGS%
goto menu

:run_wizard
call "%~dp0start_wizard.bat" --legacy-direct %PRISM_ROUTE_ARGS%
goto menu

:run_tui
call "%~dp0start_tui.bat" --legacy-direct %PRISM_ROUTE_ARGS%
goto menu

:run_backend
call "%~dp0start_backend.bat" --legacy-direct %PRISM_ROUTE_ARGS%
goto menu

:run_web
call "%~dp0start_web.bat" --legacy-direct %PRISM_ROUTE_ARGS%
goto menu

:run_dev_shell
echo.
echo [INFO] Opening a PRISM dev shell in a new window...
start "PRISM Dev Shell" cmd /k "cd /d %~dp0 && echo PRISM Dev Shell ready. && echo Suggested commands: npm run build ^| npm test ^| npm run lint"
goto menu

:open_dashboard
echo.
start "" "http://localhost:7070/dashboard"
goto menu

:run_quick_verify
echo.
echo [VERIFY] Running build...
call npm run build
if errorlevel 1 (
  echo [VERIFY][ERROR] Build failed.
  pause
  goto menu
)
echo [VERIFY] Checking wizard scripts syntax...
node --check "%~dp0src\core\operator\public\setup-wizard.js"
if errorlevel 1 (
  echo [VERIFY][ERROR] setup-wizard.js syntax check failed.
  pause
  goto menu
)
node --check "%~dp0src\core\operator\public\setup-wizard-advanced.js"
if errorlevel 1 (
  echo [VERIFY][ERROR] setup-wizard-advanced.js syntax check failed.
  pause
  goto menu
)
echo [VERIFY][OK] Quick verification passed.
pause
goto menu

:rerun_checks
call :full_system_check
if errorlevel 1 goto fatal
goto menu

:advanced_menu
cls
echo.
echo  ===============================================================================
echo    PRISM Refraction Advanced Operations
echo  ===============================================================================
echo.
echo    [1] Run Full Test Suite (npm test)
echo    [2] Run Release Validation
echo    [3] Run Strict Release Validation
echo    [4] Run Lint
echo    [5] Run Coverage Gate
echo    [6] PM2 Start (ecosystem)
echo    [7] PM2 Logs
echo    [8] Docker Compose Up
echo    [9] Docker Compose Down
echo    [B] Back to Main Menu
echo.
set /p ADV_CHOICE=Select an advanced option ^> 

if "%ADV_CHOICE%"=="1" goto adv_test
if "%ADV_CHOICE%"=="2" goto adv_release
if "%ADV_CHOICE%"=="3" goto adv_release_strict
if "%ADV_CHOICE%"=="4" goto adv_lint
if "%ADV_CHOICE%"=="5" goto adv_coverage
if "%ADV_CHOICE%"=="6" goto adv_pm2_start
if "%ADV_CHOICE%"=="7" goto adv_pm2_logs
if "%ADV_CHOICE%"=="8" goto adv_docker_up
if "%ADV_CHOICE%"=="9" goto adv_docker_down
if /I "%ADV_CHOICE%"=="B" goto menu

echo.
echo [WARN] Invalid selection: %ADV_CHOICE%
timeout /t 1 /nobreak >nul
goto advanced_menu

:adv_test
call npm test
pause
goto advanced_menu

:adv_release
call npm run release:validate
pause
goto advanced_menu

:adv_release_strict
call npm run release:validate:strict
pause
goto advanced_menu

:adv_lint
call npm run lint
pause
goto advanced_menu

:adv_coverage
call npm run test:coverage:gate
pause
goto advanced_menu

:adv_pm2_start
where pm2 >nul 2>nul
if errorlevel 1 (
  echo [ERROR] pm2 not found on PATH.
  pause
  goto advanced_menu
)
call pm2 start ecosystem.config.js
pause
goto advanced_menu

:adv_pm2_logs
where pm2 >nul 2>nul
if errorlevel 1 (
  echo [ERROR] pm2 not found on PATH.
  pause
  goto advanced_menu
)
call pm2 logs prism
pause
goto advanced_menu

:adv_docker_up
where docker >nul 2>nul
if errorlevel 1 (
  echo [ERROR] docker not found on PATH.
  pause
  goto advanced_menu
)
call docker compose up -d
pause
goto advanced_menu

:adv_docker_down
where docker >nul 2>nul
if errorlevel 1 (
  echo [ERROR] docker not found on PATH.
  pause
  goto advanced_menu
)
call docker compose down
pause
goto advanced_menu

:full_system_check
cls
echo.
echo [CHECK] PrismRefraction full system and requirement checks
echo.

if not exist "%~dp0package.json" (
  echo [FATAL] package.json not found. Run this launcher from the repository root.
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [FATAL] Node.js was not found on PATH.
  echo         Install Node.js 22+ and retry.
  exit /b 1
)

for /f %%i in ('node -p "process.versions.node.split('.')[0]"') do set "PRISM_NODE_MAJOR=%%i"
if not defined PRISM_NODE_MAJOR (
  echo [FATAL] Unable to determine Node.js version.
  exit /b 1
)
if %PRISM_NODE_MAJOR% LSS 22 (
  echo [FATAL] Node.js 22+ is required. Detected major version %PRISM_NODE_MAJOR%.
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [FATAL] npm was not found on PATH.
  exit /b 1
)

echo [OK] Node.js version: 
node -v
echo [OK] npm version:
call npm -v

if not exist "%~dp0node_modules" (
  echo [SETUP] node_modules missing. Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [FATAL] npm install failed.
    exit /b 1
  )
)

set "NEEDS_BUILD=0"
if "%PRISM_MASTER_FORCE_BUILD%"=="1" set "NEEDS_BUILD=1"
if not exist "%~dp0dist\src\index.js" set "NEEDS_BUILD=1"

if "%NEEDS_BUILD%"=="0" (
  powershell -NoProfile -Command "$dist='dist/src/index.js'; $distTime=(Get-Item $dist).LastWriteTimeUtc; $newer=(Get-ChildItem -Recurse src -File | Where-Object { $_.LastWriteTimeUtc -gt $distTime } | Select-Object -First 1); if ($newer) { exit 3 } else { exit 0 }"
  if errorlevel 3 set "NEEDS_BUILD=1"
)

if "%NEEDS_BUILD%"=="1" (
  echo [BUILD] Building project to ensure dist is current...
  call npm run build
  if errorlevel 1 (
    echo [FATAL] Build failed.
    exit /b 1
  )
) else (
  echo [OK] Build artifacts are up to date.
)

set "MISSING=0"
for %%F in ("start_individual.bat" "start_enterprise.bat" "start_wizard.bat" "start_tui.bat" "start_backend.bat" "start_web.bat") do (
  if not exist "%~dp0%%~F" (
    echo [WARN] Missing launcher file: %%~F
    set "MISSING=1"
  )
)

if "%MISSING%"=="0" (
  echo [OK] Launcher script set is complete.
) else (
  echo [WARN] One or more launcher scripts are missing.
)

set "PRISM_PORT=7070"
if defined PRISM_DASHBOARD_PORT set "PRISM_PORT=%PRISM_DASHBOARD_PORT%"
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:%PRISM_PORT%/api/health' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { Write-Host '[INFO] PRISM server currently reachable on port %PRISM_PORT%.' } else { Write-Host '[INFO] PRISM server not healthy on port %PRISM_PORT%.' } } catch { Write-Host '[INFO] PRISM server not running on port %PRISM_PORT%.' }"

echo.
echo [CHECK][DONE] System checks complete.
timeout /t 1 /nobreak >nul
exit /b 0

:fatal
echo.
echo [ERROR] Full system check failed. Resolve errors and retry.
pause
exit /b 1

:done
echo.
echo [INFO] PrismRefraction launcher closed.
exit /b 0
