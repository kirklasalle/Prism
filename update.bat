@echo off
setlocal

cd /d "%~dp0"

echo ================================================
echo PRISM One-Click Update Utility
echo ================================================

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found on PATH.
  echo Install Node.js 22+ to run updates.
  pause
  exit /b 1
)

echo [START] Running Prism update orchestrator...
node scripts/prism-update.cjs %*

if errorlevel 1 (
  echo [ERROR] Prism update failed. Review logs above.
  pause
  exit /b 1
)

echo [SUCCESS] Prism update completed successfully.
pause
exit /b 0
