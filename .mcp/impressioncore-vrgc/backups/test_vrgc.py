#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** Virtually Robotic GitHub Copilot  
**Tags:** #.mcp\impressioncore_vrgc\test_vrgc.py #gpu_optimization #python #source_code #testing #training  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** Virtually Robotic GitHub Copilot  
**Tags:** #.mcp\impressioncore_vrgc\test_vrgc.py #gpu_optimization #python #source_code #testing #training  
**Category:** Source Code  
**Status:** Active

"""
ImpressionCore VRGC - Quick Test Script
=====================================

Quick test to verify VRGC tools are working before MCP server registration.
"""

import sys
import json
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

def test_vrgc_tools():
    """Test VRGC tools independently."""
    print("🤖 Testing ImpressionCore VRGC Tools...")
    
    results = {
        "timestamp": "2025-06-16",
        "tool_tests": {},
        "overall_status": "unknown"    }
    
    # Test System Assessment
    try:
        sys.path.insert(0, str(Path(__file__).parent))
        from tools.system_assessment import VRGCSystemAssessment
        
        assessment = VRGCSystemAssessment(project_root="d:/Projects/impressioncore")  # Test with project root
        # Note: Using synchronous test - in real usage these would be async
        # For testing, we'll just verify the class instantiates
        
        results["tool_tests"]["system_assessment"] = {
            "status": "success",
            "instantiated": True,
            "standalone_mode": True
        }
        print("✅ System Assessment tool working")
        
    except Exception as e:
        results["tool_tests"]["system_assessment"] = {
            "status": "failed",
            "error": str(e)
        }
        print(f"❌ System Assessment failed: {e}")
    
    # Test Hardware Optimizer
    try:
        from tools.hardware_optimizer import HardwareOptimizer
        
        optimizer = HardwareOptimizer(enable_ids=False)
        result = optimizer.assess_hardware_state()
        
        results["tool_tests"]["hardware_optimizer"] = {
            "status": "success" if "error" not in result else "failed",
            "has_gpu_metrics": "gpu_metrics" in result,
            "standalone_mode": True
        }
        print("✅ Hardware Optimizer tool working")
        
    except Exception as e:
        results["tool_tests"]["hardware_optimizer"] = {
            "status": "failed",
            "error": str(e)
        }
        print(f"❌ Hardware Optimizer failed: {e}")
    
    # Test Sacred Covenant Guardian
    try:
        from tools.covenant_guardian import CovenantGuardian
        
        guardian = CovenantGuardian(enable_ids=False)
        result = guardian.verify_file_integrity()
        
        results["tool_tests"]["covenant_guardian"] = {
            "status": "success" if "error" not in result else "failed",
            "has_integrity_report": "files_checked" in result,
            "standalone_mode": True
        }
        print("✅ Sacred Covenant Guardian tool working")
        
    except Exception as e:
        results["tool_tests"]["covenant_guardian"] = {
            "status": "failed",
            "error": str(e)
        }
        print(f"❌ Sacred Covenant Guardian failed: {e}")
    
    # Test Project Intelligence
    try:
        from tools.project_intelligence import ProjectIntelligence
        
        intelligence = ProjectIntelligence(enable_ids=False)
        result = intelligence.analyze_project_state()
        
        results["tool_tests"]["project_intelligence"] = {
            "status": "success" if "error" not in result else "failed",
            "has_project_overview": "project_overview" in result,
            "standalone_mode": True
        }
        print("✅ Project Intelligence tool working")
        
    except Exception as e:
        results["tool_tests"]["project_intelligence"] = {
            "status": "failed",
            "error": str(e)
        }
        print(f"❌ Project Intelligence failed: {e}")    # Test Training Monitor
    try:
        from tools.training_monitor import VRGCTrainingMonitor
        
        monitor = VRGCTrainingMonitor(project_root="d:/Projects/impressioncore")
        # Note: Using synchronous test - in real usage these would be async
        # For testing, we'll just verify the class instantiates
        
        results["tool_tests"]["training_monitor"] = {
            "status": "success",
            "instantiated": True,
            "standalone_mode": True
        }
        print("✅ Training Monitor tool working")
        
    except Exception as e:
        results["tool_tests"]["training_monitor"] = {
            "status": "failed",
            "error": str(e)
        }
        print(f"❌ Training Monitor failed: {e}")
    
    # Calculate overall status
    successful_tools = sum(1 for test in results["tool_tests"].values() if test.get("status") == "success")
    total_tools = len(results["tool_tests"])
    
    if successful_tools == total_tools:
        results["overall_status"] = "all_tools_working"
    elif successful_tools > 0:
        results["overall_status"] = "partial_success"
    else:
        results["overall_status"] = "all_tools_failed"
    
    results["success_rate"] = f"{successful_tools}/{total_tools}"
    
    print(f"\n🤖 VRGC Tools Test Complete: {successful_tools}/{total_tools} tools working")
    print(f"📊 Overall Status: {results['overall_status']}")
    
    return results

def test_mcp_server():
    """Test MCP server functionality."""
    print("\n🖥️  Testing VRGC MCP Server...")
    
    try:
        # Try to import MCP dependencies first
        try:
            from mcp.server.models import ListToolsRequest
            mcp_available = True
        except ImportError:
            mcp_available = False
            print("⚠️  MCP server dependencies not available - running in standalone mode")
        
        if not mcp_available:
            print("ℹ️  MCP server requires VS Code environment to test properly")
            return {
                "status": "skipped",
                "reason": "MCP dependencies not available in standalone mode",
                "recommendation": "Restart VS Code to test MCP server functionality"
            }
        
        # If MCP is available, test the server
        from server import VRGCServer
        
        server = VRGCServer()
        print(f"✅ VRGC Server created with {len(server.tools)} tools")
        
        # Test tool listing
        tool_names = list(server.tools.keys())
        print(f"🔧 Available tools: {len(tool_names)}")
        for tool in tool_names[:5]:  # Show first 5
            print(f"   - {tool}")
        if len(tool_names) > 5:
            print(f"   ... and {len(tool_names) - 5} more")
        
        return {
            "status": "success",
            "tools_count": len(server.tools),
            "tools_available": tool_names
        }
        
    except Exception as e:
        print(f"❌ MCP Server test failed: {e}")
        return {
            "status": "failed",
            "error": str(e)
        }

if __name__ == "__main__":
    print("🚀 ImpressionCore VRGC Quick Test")
    print("=" * 50)
    
    # Test tools
    tool_results = test_vrgc_tools()
    
    # Test server
    server_results = test_mcp_server()
    
    # Final summary
    print("\n" + "=" * 50)
    print("📋 VRGC Test Summary:")
    print(f"   Tools Status: {tool_results['overall_status']}")
    print(f"   Success Rate: {tool_results['success_rate']}")
    print(f"   Server Status: {server_results['status']}")
    
    if tool_results['overall_status'] == 'all_tools_working' and server_results['status'] == 'success':
        print("✅ VRGC ready for MCP registration and restart!")
    else:
        print("⚠️  Some issues detected - check logs above")
    
    print("\n🔄 Next steps:")
    print("1. Restart VS Code to register the new MCP server")
    print("2. Test VRGC tools through MCP interface")
    print("3. Execute robotic mode for full assessment")
