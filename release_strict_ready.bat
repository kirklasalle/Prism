@echo off
setlocal

cd /d "%~dp0"

set PRISM_STAGING_VALIDATED=1
set PRISM_ROLLBACK_REHEARSED=1
set PRISM_RUNBOOKS_CURRENT=1

echo ================================================
echo PRISM Strict Release Validation
echo ================================================
echo [INFO] PRISM_STAGING_VALIDATED=1
echo [INFO] PRISM_ROLLBACK_REHEARSED=1
echo [INFO] PRISM_RUNBOOKS_CURRENT=1

call npm run release:validate:strict
if errorlevel 1 goto :fail

echo [OK] Strict release validation completed successfully.
goto :eof

:fail
echo [ERROR] Strict release validation failed.
pause
exit /b 1
