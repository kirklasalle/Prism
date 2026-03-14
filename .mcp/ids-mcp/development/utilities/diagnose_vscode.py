#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\utilities\diagnose_vscode.py #python #source_code #testing  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\utilities\diagnose_vscode.py #python #source_code #testing  
**Category:** Source Code  
**Status:** Active

"""
Diagnostic script to simulate VS Code MCP connection and identify issues.
"""

import asyncio
import json
import sys
import traceback
from pathlib import Path

# Add current directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

try:
    from server import IDSMCPServer
except ImportError as e:
    print(f"IMPORT ERROR: {e}")
    sys.exit(1)

async def diagnose_vscode_connection():
    """Simulate exactly what VS Code does when connecting to MCP server."""
    print("VS Code MCP Connection Diagnostic")
    print("=" * 50)
    
    try:
        # Step 1: Initialize server (what VS Code does first)
        print("Step 1: Initializing server...")
        server = IDSMCPServer()
        print("✅ Server initialized")
        
        # Step 2: List tools (what VS Code does to populate tool list)
        print("\nStep 2: Requesting tool list...")
        tools_response = await server.handle_list_tools()
        
        # Step 3: Analyze response
        print(f"✅ Tool list response received")
        print(f"Response type: {type(tools_response)}")
        
        if isinstance(tools_response, dict):
            tools = tools_response.get("tools", [])
            print(f"Tools found: {len(tools)}")
            
            if len(tools) < 17:
                print(f"❌ ISSUE: Expected 17 tools, got {len(tools)}")
                print("This explains why VS Code only shows 5 tools!")
            else:
                print(f"✅ All {len(tools)} tools found")
            
            # Step 4: Validate each tool structure
            print(f"\nStep 4: Validating tool structures...")
            for i, tool in enumerate(tools):
                name = tool.get("name", "MISSING")
                desc = tool.get("description", "")
                schema = tool.get("inputSchema", {})
                
                issues = []
                if not name or name == "MISSING":
                    issues.append("missing name")
                if not desc:
                    issues.append("missing description")
                if not schema:
                    issues.append("missing schema")
                
                status = "❌" if issues else "✅"
                issue_text = f" ({', '.join(issues)})" if issues else ""
                print(f"  {status} Tool {i+1}: {name}{issue_text}")
        else:
            print(f"❌ ISSUE: Expected dict response, got {type(tools_response)}")
            print(f"Response: {tools_response}")
        
        # Step 5: Test JSON serialization (what MCP protocol requires)
        print(f"\nStep 5: Testing JSON serialization...")
        try:
            json_str = json.dumps(tools_response, indent=2)
            print("✅ JSON serialization successful")
            
            # Check for any potential encoding issues
            if len(json_str) > 1000:
                print(f"Response size: {len(json_str)} characters")
        except Exception as e:
            print(f"❌ JSON serialization failed: {e}")
            return False
        
        # Step 6: Test a simple tool call
        print(f"\nStep 6: Testing a simple tool call...")
        try:
            if len(tools) > 0:
                test_tool = tools[0].get("name", "")
                if test_tool == "search":
                    result = await server.handle_call_tool(test_tool, {"query": "test", "max_results": 1})
                    if result.get("isError"):
                        print(f"❌ Tool call failed: {result}")
                    else:
                        print(f"✅ Tool call successful")
                else:
                    print(f"Skipping tool test - first tool is '{test_tool}' not 'search'")
        except Exception as e:
            print(f"❌ Tool call failed: {e}")
        
        return True
        
    except Exception as e:
        print(f"❌ CRITICAL ERROR: {e}")
        print(f"Traceback: {traceback.format_exc()}")
        return False

if __name__ == "__main__":
    success = asyncio.run(diagnose_vscode_connection())
    if success:
        print(f"\n🎯 DIAGNOSIS COMPLETE")
        print(f"If issues were found above, they explain why VS Code shows fewer tools.")
    else:
        print(f"\n💥 DIAGNOSIS FAILED")
        print(f"Server has critical issues preventing proper operation.")
    
    sys.exit(0 if success else 1)
