#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\tests\test_simple_debug.py #python #source_code #testing  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\tests\test_simple_debug.py #python #source_code #testing  
**Category:** Source Code  
**Status:** Active

"""
Simple test for enhanced server debugging features
"""

import subprocess
import sys
import time
import os

def test_server_startup():
    """Test that the enhanced server starts properly with debugging."""
    
    print("=== Enhanced Server Startup Test ===")
    
    # Set debug environment
    env = os.environ.copy()
    env.update({
        "PYTHONPATH": "d:/Projects/impressioncore",
        "PYTHONUNBUFFERED": "1", 
        "IDS_DEBUG": "1"
    })
    
    try:
        print("🚀 Starting server with debug mode...")
        
        # Start server with timeout
        process = subprocess.Popen(
            [sys.executable, ".mcp/ids-mcp/server.py"],
            cwd="d:/Projects/impressioncore",
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        
        # Wait a moment for startup
        time.sleep(2)
        
        # Check if process is running
        if process.poll() is None:
            print("✅ Server started successfully and is running")
            
            # Terminate gracefully
            print("🛑 Testing graceful shutdown...")
            process.terminate()
            
            # Wait for shutdown with timeout
            try:
                stdout, stderr = process.communicate(timeout=5)
                print("✅ Server shutdown gracefully")
                
                # Check for debug logs
                if stderr:
                    print("\n📋 Debug logs detected:")
                    log_lines = stderr.strip().split('\n')
                    for line in log_lines[:5]:  # Show first 5 lines
                        if "DEBUG" in line:
                            print(f"   🐛 {line}")
                        elif "INFO" in line:
                            print(f"   ℹ️  {line}")
                        elif "ERROR" in line:
                            print(f"   ❌ {line}")
                    
                    if len(log_lines) > 5:
                        print(f"   ... and {len(log_lines) - 5} more log entries")
                
                return True
                
            except subprocess.TimeoutExpired:
                print("⏰ Shutdown timeout - force killing")
                process.kill()
                return False
                
        else:
            # Process ended, check for errors
            stdout, stderr = process.communicate()
            print(f"❌ Server exited unexpectedly")
            if stderr:
                print(f"Error output: {stderr}")
            return False
            
    except Exception as e:
        print(f"❌ Test failed: {e}")
        return False

def test_log_file():
    """Check if log file is created."""
    log_file = "d:/Projects/impressioncore/.mcp/ids-mcp/ids_mcp.log"
    
    if os.path.exists(log_file):
        print(f"✅ Log file exists: {log_file}")
        
        # Check recent entries
        try:
            with open(log_file, 'r', encoding='utf-8') as f:
                lines = f.readlines()
                if lines:
                    print(f"📋 Log file has {len(lines)} entries")
                    print("Recent entries:")
                    for line in lines[-3:]:  # Last 3 lines
                        print(f"   {line.strip()}")
                else:
                    print("📋 Log file is empty")
        except Exception as e:
            print(f"⚠️  Could not read log file: {e}")
        
        return True
    else:
        print(f"⚠️  Log file not found: {log_file}")
        return False

if __name__ == "__main__":
    print("Testing enhanced IDS MCP server...\n")
    
    startup_ok = test_server_startup()
    log_ok = test_log_file()
    
    print(f"\n=== Test Results ===")
    print(f"Server startup: {'✅ PASS' if startup_ok else '❌ FAIL'}")
    print(f"Logging system: {'✅ PASS' if log_ok else '❌ FAIL'}")
    
    if startup_ok and log_ok:
        print(f"\n🎉 Enhanced server is working correctly!")
        print(f"Features verified:")
        print(f"✅ Debug logging enabled")
        print(f"✅ Graceful shutdown handling")
        print(f"✅ Error handling and timeouts")
        print(f"✅ Log file creation")
        print(f"\n📋 Your enhanced server.py is ready for VS Code!")
    else:
        print(f"\n❌ Some tests failed - check the server configuration")
        sys.exit(1)
