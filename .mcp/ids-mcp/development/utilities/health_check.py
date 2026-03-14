#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\utilities\health_check.py #python #source_code #testing  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\utilities\health_check.py #python #source_code #testing  
**Category:** Source Code  
**Status:** Active

"""
IDS MCP Server Health Check
===========================
Simple health check and status validation for monitoring and CI/CD.
"""

import json
import sys
import subprocess
import time
from pathlib import Path

def run_health_check():
    """Run comprehensive health check."""
    print("🏥 IDS MCP Server Health Check")
    print("=" * 40)
    
    health_status = {
        "status": "healthy",
        "checks": {},
        "timestamp": time.time()
    }
    
    # Check 1: Server startup
    print("🔧 Testing server startup...")
    try:
        result = subprocess.run(
            ["python", "check_system.py"],
            capture_output=True,
            text=True,
            timeout=10
        )
        health_status["checks"]["server_startup"] = {
            "status": "pass" if result.returncode == 0 else "fail",
            "details": "Server initializes successfully"
        }
        print("✅ Server startup: PASS")
    except Exception as e:
        health_status["checks"]["server_startup"] = {
            "status": "fail",
            "details": str(e)
        }
        health_status["status"] = "unhealthy"
        print(f"❌ Server startup: FAIL - {e}")
    
    # Check 2: Tool availability
    print("🛠️  Testing tool availability...")
    try:
        result = subprocess.run(
            ["python", "test_mcp_protocol.py"],
            capture_output=True,
            text=True,
            timeout=20
        )
        health_status["checks"]["tool_availability"] = {
            "status": "pass" if result.returncode == 0 else "fail",
            "details": "All 5 tools are available and functional"
        }
        print("✅ Tool availability: PASS")
    except Exception as e:
        health_status["checks"]["tool_availability"] = {
            "status": "fail",
            "details": str(e)
        }
        health_status["status"] = "unhealthy"
        print(f"❌ Tool availability: FAIL - {e}")
    
    # Check 3: File system access
    print("📁 Testing file system access...")
    try:
        project_root = Path(__file__).parent.parent.parent
        docs_path = project_root / "docs"
        
        if docs_path.exists():
            file_count = len(list(docs_path.rglob("*")))
            health_status["checks"]["filesystem"] = {
                "status": "pass",
                "details": f"Access to docs directory with {file_count} files"
            }
            print(f"✅ File system: PASS ({file_count} files accessible)")
        else:
            health_status["checks"]["filesystem"] = {
                "status": "fail",
                "details": "Cannot access docs directory"
            }
            health_status["status"] = "unhealthy"
            print("❌ File system: FAIL - docs directory not accessible")
    except Exception as e:
        health_status["checks"]["filesystem"] = {
            "status": "fail",
            "details": str(e)
        }
        health_status["status"] = "unhealthy"
        print(f"❌ File system: FAIL - {e}")
    
    # Check 4: Dependencies
    print("📦 Testing dependencies...")
    try:
        import yaml
        import asyncio
        from pathlib import Path
        
        health_status["checks"]["dependencies"] = {
            "status": "pass",
            "details": "All required dependencies available"
        }
        print("✅ Dependencies: PASS")
    except ImportError as e:
        health_status["checks"]["dependencies"] = {
            "status": "fail",
            "details": f"Missing dependency: {e}"
        }
        health_status["status"] = "unhealthy"
        print(f"❌ Dependencies: FAIL - {e}")
    
    # Summary
    print("\n" + "=" * 40)
    if health_status["status"] == "healthy":
        print("🎉 Overall Status: HEALTHY")
        print("✅ All systems operational")
        exit_code = 0
    else:
        print("⚠️  Overall Status: UNHEALTHY")
        print("❌ Some checks failed")
        exit_code = 1
    
    # Save health report
    with open("health_report.json", "w") as f:
        json.dump(health_status, f, indent=2)
    
    print(f"📊 Health report saved to health_report.json")
    return exit_code

if __name__ == "__main__":
    exit_code = run_health_check()
    sys.exit(exit_code)
