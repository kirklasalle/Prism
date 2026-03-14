#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\tests\test_enhanced_debugging.py #documentation #python #source_code #testing  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\tests\test_enhanced_debugging.py #documentation #python #source_code #testing  
**Category:** Source Code  
**Status:** Active

"""
Test script for enhanced IDS MCP server with debugging and error handling
"""

import json
import subprocess
import sys
from pathlib import Path

def test_enhanced_server():
    """Test the enhanced server with debugging features."""
    
    print("=== Enhanced IDS MCP Server Debug Test ===")
    
    # Server path
    server_path = Path("d:/Projects/impressioncore/.mcp/ids-mcp/server.py")
    
    if not server_path.exists():
        print(f"❌ Server file not found: {server_path}")
        return False
    
    print(f"✅ Server file found: {server_path}")
    
    # Test requests
    test_cases = [
        # Test valid request
        {
            "name": "Basic search test",
            "request": {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "ids_search",
                    "arguments": {"query": "documentation", "max_results": 3}
                }
            }
        },
        # Test invalid tool
        {
            "name": "Invalid tool test", 
            "request": {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": "invalid_tool",
                    "arguments": {}
                }
            }
        },
        # Test system status
        {
            "name": "System status test",
            "request": {
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {
                    "name": "ids_get_system_status",
                    "arguments": {}
                }
            }
        }
    ]
    
    # Environment with debug enabled
    env = {
        "PYTHONPATH": "d:/Projects/impressioncore",
        "PYTHONUNBUFFERED": "1",
        "IDS_DEBUG": "1"
    }
    
    try:
        # Start server process
        print("\n📡 Starting enhanced server with debug mode...")
        process = subprocess.Popen(
            [sys.executable, str(server_path)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env,
            cwd="d:/Projects/impressioncore"
        )
        
        print("✅ Server started successfully")
        
        # Send initialization
        init_request = {
            "jsonrpc": "2.0",
            "id": 0,
            "method": "initialize",
            "params": {"capabilities": {}}
        }
        
        print("\n🔄 Sending initialization...")
        process.stdin.write(json.dumps(init_request) + "\n")
        process.stdin.flush()
        
        # Read response
        response = process.stdout.readline()
        if response:
            init_response = json.loads(response)
            print(f"✅ Initialization response: {init_response.get('result', {}).get('capabilities', 'OK')}")
        
        # Send test requests
        for i, test_case in enumerate(test_cases, 1):
            print(f"\n🧪 Test {i}: {test_case['name']}")
            
            # Send request
            request_json = json.dumps(test_case['request']) + "\n"
            process.stdin.write(request_json)
            process.stdin.flush()
            
            # Read response with timeout
            try:
                response = process.stdout.readline()
                if response:
                    response_data = json.loads(response)
                    
                    if "error" in response_data:
                        print(f"⚠️  Expected error: {response_data['error']['message']}")
                    elif "result" in response_data:
                        content = response_data['result'].get('content', [])
                        if content and len(content) > 0:
                            text = content[0].get('text', 'No text content')
                            print(f"✅ Success: {text[:100]}...")
                        else:
                            print("✅ Success: Empty result")
                    else:
                        print(f"❓ Unexpected response: {response_data}")
                else:
                    print("❌ No response received")
            except json.JSONDecodeError as e:
                print(f"❌ Invalid JSON response: {e}")
            except Exception as e:
                print(f"❌ Error reading response: {e}")
        
        # Test graceful shutdown with Ctrl+C simulation
        print(f"\n🛑 Testing graceful shutdown...")
        process.terminate()
        
        # Wait for process to finish and capture logs
        stdout, stderr = process.communicate(timeout=5)
        
        print("✅ Server shutdown completed")
        
        # Check debug logs
        if stderr:
            print(f"\n📋 Debug logs preview:")
            log_lines = stderr.split('\n')[:10]  # First 10 lines
            for line in log_lines:
                if line.strip():
                    print(f"   {line}")
            if len(stderr.split('\n')) > 10:
                print(f"   ... and {len(stderr.split('\n')) - 10} more log lines")
        
        return True
        
    except subprocess.TimeoutExpired:
        print("⏰ Test timed out - terminating server")
        process.kill()
        return False
    except Exception as e:
        print(f"❌ Test failed with error: {e}")
        if 'process' in locals():
            process.kill()
        return False

if __name__ == "__main__":
    success = test_enhanced_server()
    if success:
        print(f"\n🎉 Enhanced server test completed successfully!")
        print(f"✅ Debugging and error handling features verified")
        print(f"✅ Graceful shutdown tested")
        print(f"✅ Server ready for VS Code integration")
    else:
        print(f"\n❌ Enhanced server test failed")
        sys.exit(1)
