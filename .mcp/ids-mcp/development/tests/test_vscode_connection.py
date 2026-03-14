#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\tests\test_vscode_connection.py #command_line #python #source_code #testing  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\tests\test_vscode_connection.py #command_line #python #source_code #testing  
**Category:** Source Code  
**Status:** Active

"""
MCP Tools Verification for VS Code
Quick test to see what VS Code should be seeing
"""

import json
import subprocess
import sys

def test_mcp_connection():
    """Test the MCP connection that VS Code would use"""
    
    print("🔍 Testing MCP Connection for VS Code...")
    print("=" * 50)
    
    # Simulate the exact VS Code MCP connection
    server_path = "d:/Projects/impressioncore/.mcp/ids-mcp/server.py"
    python_path = "G:/Program Files/Python313/python.exe"
    
    print(f"Server: {server_path}")
    print(f"Python: {python_path}")
    print()
    
    # Test initialization
    init_message = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "vscode", "version": "1.95.0"}
        }
    }
    
    # Test tools list
    tools_message = {
        "jsonrpc": "2.0", 
        "id": 2,
        "method": "tools/list",
        "params": {}
    }
    
    try:
        # Create input for the server
        input_data = json.dumps(init_message) + "\n" + json.dumps(tools_message) + "\n"
        
        # Run server with input
        process = subprocess.Popen(
            [python_path, server_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            cwd="d:/Projects/impressioncore",
            env={
                "PYTHONPATH": "d:/Projects/impressioncore",
                "PYTHONUNBUFFERED": "1",
                "IDS_DEBUG": "1"
            }
        )
        
        stdout, stderr = process.communicate(input=input_data, timeout=30)
        
        print("📤 VS Code would send:")
        print("1. Initialize request")  
        print("2. Tools list request")
        print()
        
        print("📥 Server responds with:")
        lines = stdout.strip().split('\n')
        for i, line in enumerate(lines, 1):
            if line.strip():
                try:
                    response = json.loads(line)
                    if 'result' in response and 'tools' in response['result']:
                        tools = response['result']['tools']
                        print(f"Response {i}: Tools list with {len(tools)} tools")
                        print("🛠️  Available tools:")
                        for j, tool in enumerate(tools, 1):
                            print(f"  {j:2d}. {tool['name']} - {tool['description'][:60]}...")
                    else:
                        print(f"Response {i}: {response.get('id', 'No ID')} - {list(response.keys())}")
                except json.JSONDecodeError:
                    print(f"Response {i}: Non-JSON response")
        
        print(f"\n✅ Server responded successfully!")
        print(f"🎯 VS Code should see {len(tools)} tools")
        
    except subprocess.TimeoutExpired:
        print("❌ Server timeout - this could be why VS Code isn't seeing tools")
        process.kill()
    except Exception as e:
        print(f"❌ Error: {e}")
        if stderr:
            print(f"Stderr: {stderr}")

if __name__ == "__main__":
    test_mcp_connection()
