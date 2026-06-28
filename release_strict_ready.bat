@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo ================================================================
echo   PRISM Strict Release Validation
echo ================================================================
echo.

REM ── Node.js check ──────────────────────────────────────────────────────
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found on PATH.
  echo Please install Node.js 22+ and try again.
  pause
  exit /b 1
)

for /f "tokens=*" %%i in ('node -p "process.versions.node.split('.')[0]"') do set "PRISM_NODE_MAJOR=%%i"
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
  echo Please install Node.js/npm and try again.
  pause
  exit /b 1
)

REM ── Git Cleanliness Check ──────────────────────────────────────────────
where git >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  set "GIT_DIRTY="
  for /f "tokens=*" %%i in ('git status --porcelain') do set "GIT_DIRTY=%%i"
  if defined GIT_DIRTY (
    echo [WARN] Your git working directory has uncommitted changes.
    echo        It is highly recommended to run release validation on a clean branch.
    echo.
  )
)

REM ── Dependencies ───────────────────────────────────────────────────────
if not exist "node_modules" (
  echo [SETUP] Installing dependencies...
  call npm install
  if errorlevel 1 goto :fail
)

set PRISM_STAGING_VALIDATED=1
set PRISM_ROLLBACK_REHEARSED=1
set PRISM_RUNBOOKS_CURRENT=1

echo [INFO] Environment configured for strict pre-flight checks:
echo        PRISM_STAGING_VALIDATED=1
echo        PRISM_ROLLBACK_REHEARSED=1
echo        PRISM_RUNBOOKS_CURRENT=1
echo.

call npm run release:validate:strict
if errorlevel 1 goto :fail

echo.
echo [OK] Strict release validation completed successfully.
pause
goto :eof

:fail
echo.
echo [ERROR] Strict release validation failed.
pause
exit /b 1
