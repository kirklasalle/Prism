#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** Virtually Robotic GitHub Copilot  
**Tags:** #.mcp\impressioncore_vrgc\test_server_tools.py #python #source_code #testing #web_interface  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** Virtually Robotic GitHub Copilot  
**Tags:** #.mcp\impressioncore_vrgc\test_server_tools.py #python #source_code #testing #web_interface  
**Category:** Source Code  
**Status:** Active

"""
VRGC Server Testing - Test MCP Protocol and Tool Functionality
"""
import sys
import traceback
import json
import asyncio
from pathlib import Path

# Add server path
sys.path.insert(0, str(Path(__file__).parent))

async def test_server_protocol():
    """Test MCP server protocol and tool functionality"""
    try:
        from server_enhanced import VRGCEnhancedWebMCPServer
        
        async with VRGCEnhancedWebMCPServer() as server:
            print(f"✅ Server initialized successfully")
            
            # Test tool listing
            tools_list = server.get_tools()
            print(f"✅ Tools loaded: {len(tools_list)}")
            
            # Test a few sample tools
            test_tools = [
                ("vrgc_web_fetch", {"url": "https://httpbin.org/get", "method": "GET"}),
                ("vrgc_web_search", {"query": "test query", "engine": "duckduckgo"}),
                ("vrgc_assess_system", {"assessment_type": "hardware"}),
            ]
            
            print("\n🔧 Testing sample tools:")
            successful_tools = 0
            failed_tools = 0
            
            for tool_name, test_args in test_tools:
                try:
                    print(f"  Testing {tool_name}...", end=" ")
                    result = await server.call_tool(tool_name, test_args)
                    
                    if "error" in result:
                        print(f"❌ Error: {result['error']}")
                        failed_tools += 1
                    else:
                        print("✅ OK")
                        successful_tools += 1
                        
                except Exception as e:
                    print(f"❌ Exception: {e}")
                    failed_tools += 1
            
            print(f"\n📊 TOOL TEST SUMMARY:")
            print(f"✅ Successful: {successful_tools}")
            print(f"❌ Failed: {failed_tools}")
            
            # List all available tools
            print(f"\n� AVAILABLE TOOLS ({len(tools_list)}):")
            for i, tool in enumerate(tools_list, 1):
                print(f"  {i:2d}. {tool['name']} - {tool['description'][:80]}...")
            
            return failed_tools == 0
        
    except Exception as e:
        print(f"❌ CRITICAL: Server initialization failed: {e}")
        traceback.print_exc()
        return False

def test_server_tools():
    """Wrapper for async test"""
    return asyncio.run(test_server_protocol())

if __name__ == "__main__":
    success = test_server_tools()
    sys.exit(0 if success else 1)
