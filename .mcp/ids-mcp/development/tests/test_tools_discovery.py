#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\tests\test_tools_discovery.py #documentation #python #source_code #testing  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\tests\test_tools_discovery.py #documentation #python #source_code #testing  
**Category:** Source Code  
**Status:** Active

"""
Test script to verify all 17 tools are discoverable from the MCP server.
"""

import json
import subprocess
import sys
import time

def test_tools_discovery():
    """Test that all expected tools are discoverable."""
      # Expected tools (17 total) with their actual method names
    expected_tools = [
        ("search", "ids_search"),
        ("search_content", "ids_search_content"), 
        ("get_file_info", "ids_get_file_info"),
        ("find_by_tag", "ids_find_by_tag"),
        ("list_tags", "ids_list_tags"),
        ("manage_tags", "ids_manage_tags"),
        ("get_system_status", "ids_get_system_status"),
        ("get_documentation_stats", "ids_get_documentation_stats"),
        ("get_recent_changes", "ids_get_recent_changes"),
        ("analyze_documentation", "ids_analyze_documentation"),
        ("bookmark_management", "ids_bookmark_management"),
        ("export_data", "ids_export_data"),
        ("import_data", "ids_import_data"),
        ("backup_system", "ids_backup_system"),
        ("restore_system", "ids_restore_system"),
        ("rebuild_index", "ids_rebuild_index"),
        ("validate_index", "ids_validate_index")
    ]
    
    print("🔍 Testing IDS MCP Server tool discovery...")
    print(f"📋 Expected {len(expected_tools)} tools")
    print("\n" + "="*60)
    
    try:
        # Start server in background for testing
        print("🚀 Starting server...")
        
        # Use a simple test that imports the server module
        import server
        ids_server = server.IDSMCPServer()
        
        print("✅ Server initialized successfully")
          # Test tool availability by checking if methods exist
        available_tools = []
        missing_tools = []
        
        for tool_name, method_name in expected_tools:
            if hasattr(ids_server, method_name):
                available_tools.append(tool_name)
                print(f"✅ {tool_name} ({method_name})")
            else:
                missing_tools.append(tool_name)
                print(f"❌ {tool_name} - method {method_name} not found")
        
        print("\n" + "="*60)
        print(f"📊 Results:")
        print(f"✅ Available tools: {len(available_tools)}/{len(expected_tools)}")
        print(f"❌ Missing tools: {len(missing_tools)}")
        
        if missing_tools:
            print(f"\n🚨 Missing tools: {', '.join(missing_tools)}")
            return False
        else:
            print(f"\n🎉 All {len(expected_tools)} tools are available!")
            return True
            
    except Exception as e:
        print(f"❌ Error testing server: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = test_tools_discovery()
    sys.exit(0 if success else 1)
