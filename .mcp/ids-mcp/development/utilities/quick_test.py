#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\utilities\quick_test.py #python #source_code #testing  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\utilities\quick_test.py #python #source_code #testing  
**Category:** Source Code  
**Status:** Active

"""Quick test to verify MCP server tool registration without networking."""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Import our tool definitions
from server import app

def test_tools():
    """Test that all tools are registered."""
    print("🔍 Testing tool registration...")
    print("=" * 50)
    
    # Get registered tools from the MCP app
    tools = []
    
    # Check if the app has the list_tools handler
    if hasattr(app, '_handlers'):
        handlers = app._handlers
        print(f"Available handlers: {list(handlers.keys())}")
        
        # Look for tools/list handler
        if 'tools/list' in handlers:
            print("✅ tools/list handler found")
        else:
            print("❌ tools/list handler not found")
    
    # Try to get tools directly from our tool definitions
    try:
        from server import TOOL_DEFINITIONS
        tools = list(TOOL_DEFINITIONS.keys())
        print(f"\n📊 Tool count: {len(tools)}")
        print("🛠️ Available tools:")
        for i, tool in enumerate(tools, 1):
            print(f"  {i:2d}. {tool}")
        
        if len(tools) == 17:
            print("\n✅ All 17 tools are registered!")
        else:
            print(f"\n❌ Expected 17 tools, found {len(tools)}")
            
    except ImportError as e:
        print(f"❌ Error importing tool definitions: {e}")
    
    return tools

if __name__ == "__main__":
    tools = test_tools()
