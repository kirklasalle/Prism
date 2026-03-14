#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\tests\test_vscode_simulation.py #command_line #python #source_code #testing  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\tests\test_vscode_simulation.py #command_line #python #source_code #testing  
**Category:** Source Code  
**Status:** Active

"""
VS Code MCP Integration Simulation
Simulates the exact MCP protocol flow that VS Code uses
"""

import json
import subprocess
import sys
import time
from pathlib import Path

def test_vscode_mcp_flow():
    """Test the complete MCP flow that VS Code would use"""
    
    print("🔄 Testing VS Code MCP Integration Flow")
    print("=" * 50)
    
    # Start the server process
    server_path = Path("d:/Projects/impressioncore/.mcp/ids-mcp/server.py")
    python_path = "G:/Program Files/Python313/python.exe"
    
    print(f"🚀 Starting server: {python_path} {server_path}")
    
    try:
        # Start the server process
        process = subprocess.Popen(
            [python_path, str(server_path)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd="d:/Projects/impressioncore",
            env={
                "PYTHONPATH": "d:/Projects/impressioncore",
                "PYTHONUNBUFFERED": "1"
            }
        )
        
        print("✅ Server process started")
        
        # Step 1: Initialize
        init_request = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {
                    "name": "vscode",
                    "version": "1.0.0"
                }
            }
        }
        
        print("📤 Sending initialize request...")
        process.stdin.write(json.dumps(init_request) + "\\n")
        process.stdin.flush()
        
        # Read response
        response_line = process.stdout.readline()
        if response_line:
            init_response = json.loads(response_line.strip())
            print("📥 Initialize response:", json.dumps(init_response, indent=2))
        else:
            print("❌ No response to initialize")
            return False
        
        # Step 2: List tools
        tools_request = {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list",
            "params": {}
        }
        
        print("\\n📤 Sending tools/list request...")
        process.stdin.write(json.dumps(tools_request) + "\\n")
        process.stdin.flush()
        
        # Read response
        response_line = process.stdout.readline()
        if response_line:
            tools_response = json.loads(response_line.strip())
            print("📥 Tools response:", json.dumps(tools_response, indent=2))
            
            # Check if we got the 5 tools
            tools = tools_response.get("result", {}).get("tools", [])
            print(f"\\n🔧 Found {len(tools)} tools:")
            for tool in tools:
                print(f"   - {tool.get('name')}: {tool.get('description')}")
            
            if len(tools) == 5:
                print("\\n✅ All 5 IDS tools found! VS Code should show them.")
            else:
                print(f"\\n❌ Expected 5 tools, got {len(tools)}")
        else:
            print("❌ No response to tools/list")
            return False
        
        # Step 3: Test a tool call
        search_request = {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "ids_search",
                "arguments": {
                    "query": "authentication",
                    "max_results": 2
                }
            }
        }
        
        print("\\n📤 Testing tool call (ids_search)...")
        process.stdin.write(json.dumps(search_request) + "\\n")
        process.stdin.flush()
        
        # Read response
        response_line = process.stdout.readline()
        if response_line:
            search_response = json.loads(response_line.strip())
            print("📥 Search response received")
            
            content = search_response.get("result", {}).get("content", [])
            if content and content[0].get("type") == "text":
                search_text = content[0]["text"]
                print("🔍 Search results preview:")
                print(search_text[:200] + "..." if len(search_text) > 200 else search_text)
                print("\\n✅ Tool call working correctly!")
            else:
                print("❌ Unexpected search response format")
        else:
            print("❌ No response to tool call")
        
        # Clean shutdown
        process.terminate()
        process.wait(timeout=5)
        
        print("\\n🎉 MCP Integration Test Complete!")
        print("\\nIf VS Code still doesn't show tools:")
        print("1. Restart VS Code Insiders completely")
        print("2. Check VS Code Output > Model Context Protocol for errors")
        print("3. Verify the server path in settings.json")
        
        return True
        
    except Exception as e:
        print(f"❌ Error: {e}")
        if 'process' in locals():
            process.terminate()
        return False

if __name__ == "__main__":
    test_vscode_mcp_flow()
