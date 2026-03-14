#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\utilities\show_tools.py #python #source_code #testing  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\utilities\show_tools.py #python #source_code #testing  
**Category:** Source Code  
**Status:** Active

"""
Quick test to show the tool names that VS Code will see.
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from server import IDSMCPServer

async def show_vscode_tools():
    print("Tools that VS Code will see:")
    print("=" * 50)
    
    server = IDSMCPServer()
    tools_response = await server.handle_list_tools()
    tools = tools_response.get("tools", [])
    
    print(f"Total tools: {len(tools)}")
    print("\nTool names (hyphenated for VS Code compatibility):")
    for i, tool in enumerate(tools, 1):
        name = tool.get("name", "")
        desc = tool.get("description", "")
        print(f"{i:2d}. {name:<25} - {desc[:60]}...")

if __name__ == "__main__":
    asyncio.run(show_vscode_tools())
