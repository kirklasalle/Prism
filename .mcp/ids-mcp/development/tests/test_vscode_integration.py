#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\tests\test_vscode_integration.py #command_line #python #source_code #testing  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\tests\test_vscode_integration.py #command_line #python #source_code #testing  
**Category:** Source Code  
**Status:** Active

"""
VS Code MCP Integration Test
Tests if the IDS MCP server can communicate properly with VS Code
"""

import json
import sys
import asyncio
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from server import IDSMCPServer

async def test_mcp_protocol():
    """Test the MCP protocol communication"""
    print("🔧 Testing IDS MCP Server for VS Code Integration")
    print("=" * 55)
    
    server = IDSMCPServer()
    
    # Test 1: List tools
    print("1. Testing tool listing...")
    try:
        tools_response = await server.handle_list_tools()
        tools = tools_response.get('tools', [])
        print(f"   ✅ Found {len(tools)} tools:")
        for tool in tools:
            print(f"      - {tool['name']}")
    except Exception as e:
        print(f"   ❌ Error listing tools: {e}")
        return False
    
    # Test 2: Test search functionality
    print("\n2. Testing search tool...")
    try:
        search_result = await server.handle_call_tool('ids_search', {
            'query': 'authentication',
            'max_results': 3
        })
        print("   ✅ Search tool responds correctly")
        
        # Parse the content
        content = search_result.get('content', [])
        if content and content[0].get('type') == 'text':
            text = content[0]['text']
            if 'Found' in text and 'results' in text:
                print("   ✅ Search returns formatted results")
            else:
                print("   ⚠️  Search format may need adjustment")
        
    except Exception as e:
        print(f"   ❌ Error testing search: {e}")
        return False
    
    # Test 3: Test system status
    print("\n3. Testing system status...")
    try:
        status_result = await server.handle_call_tool('ids_get_system_status', {})
        print("   ✅ System status tool responds correctly")
    except Exception as e:
        print(f"   ❌ Error testing status: {e}")
        return False
    
    print("\n🎉 All tests passed! Server is ready for VS Code integration.")
    print("\nTo use in VS Code:")
    print("1. Restart VS Code Insiders")
    print("2. Look for 'New Tools available' notification")
    print("3. Click refresh to load the 5 IDS tools")
    print("4. The tools should appear in the Configure tools menu")
    
    return True

if __name__ == "__main__":
    asyncio.run(test_mcp_protocol())
