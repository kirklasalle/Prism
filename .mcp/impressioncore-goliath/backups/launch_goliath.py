#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\impressioncore_goliath\launch_goliath.py #python #source_code  
**Category:** Source Code  
**Status:** Active
"""






import asyncio
import sys
from pathlib import Path

# Add current directory to path
sys.path.insert(0, str(Path(__file__).parent))

try:
    from server import ImpressionCoreGoliathServer
    
    async def main():
        print("🚀 Starting ImpressionCore-Goliath MCP Server...")
        server = ImpressionCoreGoliathServer()
        await server.run_server()
    
    if __name__ == "__main__":
        asyncio.run(main())
        
except Exception as e:
    print(f"💥 Failed to start Goliath: {e}")
    print("Please check the installation and dependencies.")
    sys.exit(1)
