#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\tests\test_mcp_protocol.py #command_line #python #source_code #testing  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\tests\test_mcp_protocol.py #command_line #python #source_code #testing  
**Category:** Source Code  
**Status:** Active

"""
Simple MCP Protocol Test for VS Code Integration
"""

import json
import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

def test_mcp_stdio():
    """Test MCP via stdio like VS Code would"""
    
    # Simulate VS Code sending an initialization request
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
    
    # Simulate listing tools request
    list_tools_request = {
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/list",
        "params": {}
    }
    
    # Simulate tool call request
    tool_call_request = {
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": {
            "name": "ids_search",
            "arguments": {
                "query": "authentication",
                "max_results": 3
            }
        }
    }
    
    print("🧪 MCP Protocol Test for VS Code")
    print("=" * 40)
    print()
    
    print("1. Initialize Request:")
    print(json.dumps(init_request, indent=2))
    print()
    
    print("2. List Tools Request:")
    print(json.dumps(list_tools_request, indent=2))
    print()
    
    print("3. Tool Call Request:")
    print(json.dumps(tool_call_request, indent=2))
    print()
    
    print("Expected VS Code Integration:")
    print("- Server should handle these JSON-RPC messages")
    print("- VS Code should see 5 available tools")
    print("- Tools should appear in Configure tools menu")
    print()
    print("If VS Code isn't detecting the server:")
    print("1. Check the Output panel for MCP logs")
    print("2. Verify the Python path in settings.json")
    print("3. Restart VS Code Insiders completely")
    print("4. Try the troubleshooting guide")

if __name__ == "__main__":
    test_mcp_stdio()
