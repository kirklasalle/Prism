@echo off
REM IDS MCP Server Startup Script for Windows
REM Activates environment and starts the server

echo 🚀 Starting IDS MCP Server...
echo ===================================

REM Check if we're in the right directory
if not exist "server.py" (
    echo ❌ Error: server.py not found. Are you in the right directory?
    echo Expected: .mcp\ids-mcp\
    pause
    exit /b 1
)

REM Check if Python environment is available
if exist "..\..\venv310\Scripts\activate.bat" (
    echo 🐍 Activating Python environment...
    call "..\..\venv310\Scripts\activate.bat"
) else (
    echo ⚠️  Warning: Python virtual environment not found at ..\..\venv310
    echo Using system Python...
)

REM Check dependencies
echo 📦 Checking dependencies...
python -c "import yaml, rich" >nul 2>&1
if errorlevel 1 (
    echo ❌ Missing dependencies. Installing...
    pip install -r requirements.txt
)

REM Set up environment
set PYTHONPATH=..\..\;%PYTHONPATH%

echo 🔍 IDS System Check...
python -c "import sys; sys.path.insert(0, '../..'); exec(open('check_system.py').read())" 2>nul || echo ⚠️  System check script not found

echo.
echo 🌟 Starting IDS MCP Server...
echo Server logs will be written to: ids_mcp.log
echo Use Ctrl+C to stop the server
echo.

REM Start the server
python server.py

pause
