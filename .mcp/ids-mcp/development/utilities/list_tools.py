#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\utilities\list_tools.py #python #source_code  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\utilities\list_tools.py #python #source_code  
**Category:** Source Code  
**Status:** Active

"""Simple tool listing from the MCP server."""

import json
import re

def extract_tools_from_server():
    """Extract tool definitions from server.py."""
    try:
        with open("d:/Projects/impressioncore/.mcp/ids-mcp/server.py", "r", encoding="utf-8") as f:
            content = f.read()
        
        # Find the tools list in handle_list_tools method
        start_marker = '"tools": ['
        end_marker = ']'
        
        start_idx = content.find(start_marker)
        if start_idx == -1:
            print("❌ Could not find tools list in server.py")
            return []
        
        # Find the matching closing bracket
        bracket_count = 0
        idx = start_idx + len(start_marker) - 1  # Position at the opening bracket
        
        while idx < len(content):
            char = content[idx]
            if char == '[':
                bracket_count += 1
            elif char == ']':
                bracket_count -= 1
                if bracket_count == 0:
                    end_idx = idx + 1
                    break
            idx += 1
        else:
            print("❌ Could not find end of tools list")
            return []
        
        # Extract the tools JSON
        tools_json = content[start_idx+len(start_marker)-1:end_idx]
        
        # Parse the tools
        try:
            tools = json.loads(tools_json)
            return tools
        except json.JSONDecodeError as e:
            print(f"❌ JSON parsing error: {e}")
            # Try to extract tool names manually
            tool_names = re.findall(r'"name":\s*"([^"]+)"', tools_json)
            return [{"name": name} for name in tool_names]
            
    except Exception as e:
        print(f"❌ Error reading server file: {e}")
        return []

def main():
    print("🔍 ImpressionCore IDS MCP Server Tool Listing")
    print("=" * 55)
    
    tools = extract_tools_from_server()
    
    if tools:
        print(f"📊 Found {len(tools)} tools:")
        print()
        for i, tool in enumerate(tools, 1):
            name = tool.get("name", "unknown")
            desc = tool.get("description", "No description")
            print(f"  {i:2d}. {name}")
            if len(desc) < 80:
                print(f"      {desc}")
            else:
                print(f"      {desc[:77]}...")
        
        print()
        if len(tools) == 17:
            print("✅ All 17 tools are correctly registered!")
        else:
            print(f"⚠️  Expected 17 tools, found {len(tools)}")
            
        # List just the names for easy checking
        print("\n🛠️ Tool names:")
        for tool in tools:
            print(f"   • {tool.get('name', 'unknown')}")
            
    else:
        print("❌ No tools found!")

if __name__ == "__main__":
    main()
