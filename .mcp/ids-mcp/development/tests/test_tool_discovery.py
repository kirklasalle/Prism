#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\tests\test_tool_discovery.py #documentation #python #source_code #testing  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\tests\test_tool_discovery.py #documentation #python #source_code #testing  
**Category:** Source Code  
**Status:** Active

"""
Test MCP Tool Discovery
======================

Simple test to verify that all 17 MCP tools are discoverable and properly registered.
"""

import sys
import asyncio
import inspect
from pathlib import Path

# Add the server path
sys.path.insert(0, str(Path(__file__).parent))

async def test_tool_discovery():
    """Test that all tools are properly registered in the MCP server."""
    print("Testing MCP Tool Discovery...")
    print("=" * 50)
    
    try:
        # Import the server module
        import server_complete
        
        # Get the mcp instance and list tools
        mcp_instance = server_complete.mcp
        tools = await mcp_instance.list_tools()
        
        tool_names = [tool.name for tool in tools]
        
        print(f"Found {len(tool_names)} registered tools:")
        for i, tool in enumerate(tools, 1):
            print(f"  {i:2d}. {tool.name}: {tool.description}")
        
        # Expected tools
        expected_tools = [
            'search',
            'get_file_info', 
            'list_tags',
            'get_system_status',
            'find_by_tag',
            'bookmark_management',
            'rebuild_index',
            'get_documentation_stats',
            'validate_index',
            'export_data',
            'import_data',
            'get_recent_changes',
            'search_content',
            'manage_tags',
            'analyze_documentation',
            'backup_system',
            'restore_system'
        ]
        
        print(f"\nExpected {len(expected_tools)} tools:")
        missing_tools = []
        for tool in expected_tools:
            if tool in tool_names:
                print(f"  ✓ {tool}")
            else:
                print(f"  ✗ {tool} (MISSING)")
                missing_tools.append(tool)
        
        if missing_tools:
            print(f"\nMISSING TOOLS: {missing_tools}")
            return False
        else:
            print(f"\n✓ All {len(expected_tools)} tools are properly registered!")
            return True
            
    except Exception as e:
        print(f"Error testing tool discovery: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_server_initialization():
    """Test that the server initializes properly."""
    print("\nTesting Server Initialization...")
    print("=" * 50)
    
    try:
        import server_complete
        
        # Check that the server instance was created
        if hasattr(server_complete, 'server'):
            server = server_complete.server
            print(f"✓ Server instance created successfully")
            print(f"  Version: {server.version}")
            print(f"  Unified index entries: {len(server.unified_index)}")
            print(f"  File metadata entries: {len(server.file_metadata)}")
            print(f"  Reverse index tags: {len(server.reverse_index)}")
            print(f"  Bookmark categories: {len(server.bookmarks_db)}")
            return True
        else:
            print("✗ Server instance not found")
            return False
            
    except Exception as e:
        print(f"Error testing server initialization: {e}")
        import traceback
        traceback.print_exc()
        return False

async def test_mcp_instance():
    """Test that the FastMCP instance is properly configured."""
    print("\nTesting FastMCP Instance...")
    print("=" * 50)
    
    try:
        import server_complete
        
        # Check that the mcp instance exists
        if hasattr(server_complete, 'mcp'):
            mcp_instance = server_complete.mcp
            print(f"✓ FastMCP instance created successfully")
            print(f"  Server name: {mcp_instance.name}")
            
            # Check if tools are registered
            tools = await mcp_instance.list_tools()
            print(f"  Registered tools: {len(tools)}")
            for tool in tools:
                print(f"    - {tool.name}")
                
            return True
        else:
            print("✗ FastMCP instance not found")
            return False
            
    except Exception as e:
        print(f"Error testing FastMCP instance: {e}")
        import traceback
        traceback.print_exc()
        return False

async def main():
    print("ImpressionCore IDS MCP Server Tool Discovery Test")
    print("=" * 60)
    
    success = True
    
    # Run all tests
    success &= await test_tool_discovery()
    success &= test_server_initialization()
    success &= await test_mcp_instance()
    
    print("\n" + "=" * 60)
    if success:
        print("🎉 ALL TESTS PASSED! MCP server is ready for VS Code integration.")
    else:
        print("❌ Some tests failed. Check the output above for details.")
    print("=" * 60)

if __name__ == "__main__":
    asyncio.run(main())
