#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\tests\test_minimal_server.py #python #source_code #testing  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\tests\test_minimal_server.py #python #source_code #testing  
**Category:** Source Code  
**Status:** Active

"""
Minimal MCP server to test VS Code compatibility with 17 tools.
"""

import asyncio
import json
import sys
from pathlib import Path

class MinimalMCPServer:
    """Minimal MCP server for testing."""
    
    def __init__(self):
        self.version = "1.0.0"
    
    async def handle_list_tools(self):
        """Return minimal tool list for testing."""
        return {
            "tools": [
                {"name": "test-tool-1", "description": "Test tool 1", "inputSchema": {"type": "object", "properties": {}}},
                {"name": "test-tool-2", "description": "Test tool 2", "inputSchema": {"type": "object", "properties": {}}},
                {"name": "test-tool-3", "description": "Test tool 3", "inputSchema": {"type": "object", "properties": {}}},
                {"name": "test-tool-4", "description": "Test tool 4", "inputSchema": {"type": "object", "properties": {}}},
                {"name": "test-tool-5", "description": "Test tool 5", "inputSchema": {"type": "object", "properties": {}}},
                {"name": "test-tool-6", "description": "Test tool 6", "inputSchema": {"type": "object", "properties": {}}},
                {"name": "test-tool-7", "description": "Test tool 7", "inputSchema": {"type": "object", "properties": {}}},
                {"name": "test-tool-8", "description": "Test tool 8", "inputSchema": {"type": "object", "properties": {}}},
                {"name": "test-tool-9", "description": "Test tool 9", "inputSchema": {"type": "object", "properties": {}}},
                {"name": "test-tool-10", "description": "Test tool 10", "inputSchema": {"type": "object", "properties": {}}},
                {"name": "test-tool-11", "description": "Test tool 11", "inputSchema": {"type": "object", "properties": {}}},
                {"name": "test-tool-12", "description": "Test tool 12", "inputSchema": {"type": "object", "properties": {}}},
                {"name": "test-tool-13", "description": "Test tool 13", "inputSchema": {"type": "object", "properties": {}}},
                {"name": "test-tool-14", "description": "Test tool 14", "inputSchema": {"type": "object", "properties": {}}},
                {"name": "test-tool-15", "description": "Test tool 15", "inputSchema": {"type": "object", "properties": {}}},
                {"name": "test-tool-16", "description": "Test tool 16", "inputSchema": {"type": "object", "properties": {}}},
                {"name": "test-tool-17", "description": "Test tool 17", "inputSchema": {"type": "object", "properties": {}}},
            ]
        }
    
    async def handle_call_tool(self, name: str, arguments: dict):
        """Handle tool calls."""
        return {
            "content": [{"type": "text", "text": f"Tool {name} called successfully"}],
            "isError": False
        }

# Test the minimal server
async def test_minimal():
    server = MinimalMCPServer()
    response = await server.handle_list_tools()
    tools = response.get("tools", [])
    print(f"Minimal server provides {len(tools)} tools:")
    for i, tool in enumerate(tools, 1):
        print(f"  {i}. {tool['name']}")

if __name__ == "__main__":
    print("Testing minimal MCP server with 17 tools...")
    asyncio.run(test_minimal())
