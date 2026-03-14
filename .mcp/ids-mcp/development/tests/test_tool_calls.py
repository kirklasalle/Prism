#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\tests\test_tool_calls.py #api #documentation #python #source_code #testing  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\tests\test_tool_calls.py #api #documentation #python #source_code #testing  
**Category:** Source Code  
**Status:** Active

"""
Test tool calls with the new hyphenated names to ensure VS Code compatibility.
"""

import asyncio
import sys
from pathlib import Path

# Add current directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from server import IDSMCPServer

async def test_tool_calls():
    """Test various tool calls with hyphenated names."""
    print("🧪 Testing IDS MCP Server tool calls with hyphenated names...")
    
    server = IDSMCPServer()
    # No separate initialize method needed - happens in __init__
    
    # Test cases with hyphenated names
    test_cases = [
        ("search", {"query": "architecture", "max_results": 3}),
        ("get-system-status", {}),
        ("list-tags", {"pattern": "api"}),
        ("get-file-info", {"file_path": "docs/prd.md"}),
        ("find-by-tag", {"tags": ["documentation"], "match_all": False}),
    ]
    
    print(f"\n📋 Testing {len(test_cases)} tool calls...\n")
    
    for i, (tool_name, args) in enumerate(test_cases, 1):
        print(f"🔄 Test {i}/{len(test_cases)}: {tool_name}")
        
        try:
            result = await server.handle_call_tool(tool_name, args)
            
            if result.get("isError"):
                print(f"❌ Error: {result.get('content', [{}])[0].get('text', 'Unknown error')}")
            else:
                content = result.get("content", [{}])[0].get("text", "")
                preview = content[:150] + "..." if len(content) > 150 else content
                print(f"✅ Success: {preview}")
                
        except Exception as e:
            print(f"❌ Exception: {e}")
        
        print()
    
    print("🎉 Tool call testing completed!")

if __name__ == "__main__":
    asyncio.run(test_tool_calls())
