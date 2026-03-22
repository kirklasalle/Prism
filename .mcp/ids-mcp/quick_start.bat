@echo off
REM ImpressionCore IDS MCP Server - Quick Start and Validation (Windows)
REM Usage: quick_start.bat

echo 🚀 ImpressionCore IDS MCP Server - Quick Start
echo ==============================================

REM Check Python environment
echo 🔍 Checking Python environment...
python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Python not found. Please activate your environment.
    pause
    exit /b 1
)
echo ✅ Python found

REM Install dependencies
echo 📦 Installing dependencies...
pip install -r requirements.txt --quiet

REM Run system check
echo 🔧 Running system verification...
python check_system.py

REM Test MCP protocol compliance
echo 🧪 Testing MCP protocol compliance...
python test_mcp_protocol.py

REM Run comprehensive demo
echo 🎯 Running comprehensive tool demonstration...
python comprehensive_demo.py

echo.
echo 🎉 Quick Start Complete!
echo 📚 Next Steps:
echo   1. Open VS Code Insiders
echo   2. Install MCP extension
echo   3. The server is configured in .vscode/settings.json
echo   4. Start using IDS tools in your AI conversations!
echo.
echo 📖 Documentation:
echo   - User Guide: docs/USER_GUIDE.md
echo   - Developer Guide: docs/DEVELOPER_GUIDE.md
echo   - VS Code Setup: vscode_integration_guide.md
pause
