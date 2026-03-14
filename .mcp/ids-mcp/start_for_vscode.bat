@echo off
REM IDS MCP Server Startup Script for VS Code
REM This script ensures the correct Python environment and paths

cd /d "d:\Projects\impressioncore\.mcp\ids-mcp"
set PYTHONPATH=d:\Projects\impressioncore
"G:\Program Files\Python313\python.exe" server.py
