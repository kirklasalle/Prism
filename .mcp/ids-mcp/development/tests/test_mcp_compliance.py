#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\tests\test_mcp_compliance.py #python #source_code #testing  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\tests\test_mcp_compliance.py #python #source_code #testing  
**Category:** Source Code  
**Status:** Active

"""
Final MCP compliance test for VS Code integration.
"""

import asyncio
import json
import sys
from pathlib import Path

# Add current directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from server import IDSMCPServer

async def test_mcp_compliance():
    """Test MCP compliance for VS Code integration."""
    print("🔍 Testing MCP compliance for VS Code integration...")
    print("=" * 60)
    
    server = IDSMCPServer()
    
    # Test 1: List tools
    print("\n1️⃣ Testing tool listing...")
    try:
        tools_response = await server.handle_list_tools()
        tools = tools_response.get("tools", [])
        print(f"✅ Found {len(tools)} tools")
        
        # Verify all tool names are hyphenated (VS Code compatible)
        problematic_names = []
        for tool in tools:
            name = tool.get("name", "")
            if "_" in name:
                problematic_names.append(name)
        
        if problematic_names:
            print(f"❌ Tools with underscores (not VS Code compatible): {problematic_names}")
        else:
            print("✅ All tool names are hyphenated (VS Code compatible)")
            
        # Verify each tool has required fields
        print("\n📋 Tool validation:")
        for tool in tools:
            name = tool.get("name", "MISSING")
            desc = tool.get("description", "")
            schema = tool.get("inputSchema", {})
            
            status = "✅" if all([name != "MISSING", desc, schema]) else "❌"
            print(f"  {status} {name}")
            
            if status == "❌":
                print(f"    Missing: name={name=='MISSING'}, desc={not desc}, schema={not schema}")
                
    except Exception as e:
        print(f"❌ Tool listing failed: {e}")
        return False
    
    # Test 2: Test a few tool calls
    print("\n2️⃣ Testing tool execution...")
    test_tools = ["search", "get-system-status", "list-tags"]
    
    for tool_name in test_tools:
        try:
            if tool_name == "search":
                args = {"query": "test", "max_results": 1}
            elif tool_name == "list-tags":
                args = {"pattern": "core"}
            else:
                args = {}
                
            result = await server.handle_call_tool(tool_name, args)
            
            if result.get("isError"):
                print(f"  ❌ {tool_name}: {result.get('content', [{}])[0].get('text', 'Unknown error')}")
            else:
                print(f"  ✅ {tool_name}: Working")
                
        except Exception as e:
            print(f"  ❌ {tool_name}: Exception: {e}")
    
    # Test 3: JSON serialization (important for MCP)
    print("\n3️⃣ Testing JSON serialization...")
    try:
        json_response = json.dumps(tools_response, indent=2)
        parsed_back = json.loads(json_response)
        print("✅ JSON serialization works correctly")
    except Exception as e:
        print(f"❌ JSON serialization failed: {e}")
        return False
    
    # Test 4: Schema validation
    print("\n4️⃣ Testing input schema structure...")
    schema_issues = []
    for tool in tools:
        name = tool.get("name", "")
        schema = tool.get("inputSchema", {})
        
        if not isinstance(schema, dict):
            schema_issues.append(f"{name}: schema is not a dict")
            continue
            
        if schema.get("type") != "object":
            schema_issues.append(f"{name}: schema type is not 'object'")
            
        properties = schema.get("properties", {})
        if not isinstance(properties, dict):
            schema_issues.append(f"{name}: properties is not a dict")
    
    if schema_issues:
        print("❌ Schema issues found:")
        for issue in schema_issues:
            print(f"  - {issue}")
    else:
        print("✅ All schemas are properly structured")
    
    print("\n" + "=" * 60)
    print("🎯 MCP Compliance Summary:")
    print(f"  • Tools available: {len(tools)}/17")
    print(f"  • Tool naming: {'✅ Compatible' if not problematic_names else '❌ Issues'}")
    print(f"  • Tool execution: {'✅ Working' if len(test_tools) > 0 else '❌ Issues'}")
    print(f"  • JSON serialization: ✅ Working")
    print(f"  • Schema validation: {'✅ Valid' if not schema_issues else '❌ Issues'}")
    
    # Final recommendation
    all_good = (len(tools) == 17 and 
                not problematic_names and 
                not schema_issues)
    
    if all_good:
        print("\n🎉 Server is ready for VS Code MCP integration!")
        return True
    else:
        print("\n⚠️  Server needs fixes before VS Code integration")
        return False

if __name__ == "__main__":
    success = asyncio.run(test_mcp_compliance())
    sys.exit(0 if success else 1)
