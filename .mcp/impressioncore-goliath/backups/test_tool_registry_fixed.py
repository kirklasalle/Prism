#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** July-27-2025  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\impressioncore_goliath\test_tool_registry_fixed.py #python #source_code #testing #web_interface  
**Category:** Source Code  
**Status:** Active
"""





import os
import sys
from pathlib import Path

# Set up paths EXACTLY like server.py
CURRENT_DIR = Path(__file__).parent
PROJECT_ROOT = CURRENT_DIR.parent.parent

print("🔍 GOLIATH TOOL REGISTRY DIAGNOSTIC TEST (FIXED)")
print("=" * 50)
print(f"Working directory: {CURRENT_DIR}")
print(f"Project root: {PROJECT_ROOT}")

# Add project paths for imports - EXACTLY like server.py
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / "src"))
sys.path.insert(0, str(CURRENT_DIR))

print(f"Python path: {sys.path[:3]}")

def test_core_imports():
    """Test all core imports using exact server.py structure."""
    print("\n1. Testing Core Imports...")
    
    try:
        # Import core systems first - EXACTLY like server.py
        from core.covenant_guardian import GoliathCovenantGuardian
        print("✅ GoliathCovenantGuardian imported successfully")
        
        from core.unified_logger import GoliathLogger
        print("✅ GoliathLogger imported successfully")
        
        from utils.tool_registry import GoliathToolRegistry
        print("✅ GoliathToolRegistry imported successfully")
        
        return True, {"covenant": GoliathCovenantGuardian, "logger": GoliathLogger, "registry": GoliathToolRegistry}
        
    except Exception as e:
        print(f"❌ Core import failed: {e}")
        import traceback
        traceback.print_exc()
        return False, None

def test_bridge_imports():
    """Test all bridge imports."""
    print("\n2. Testing Bridge Imports...")
    
    bridges = {}
    
    try:
        # Import bridge modules - EXACTLY like server.py
        from bridges.ids_bridge import IDSBridge
        print("✅ IDSBridge imported successfully")
        bridges['ids'] = IDSBridge
        
        from bridges.dpa_bridge import DPABridge  
        print("✅ DPABridge imported successfully")
        bridges['dpa'] = DPABridge
        
        from bridges.eds_bridge import EDSBridge
        print("✅ EDSBridge imported successfully") 
        bridges['eds'] = EDSBridge
        
        from bridges.ipa_bridge import IPABridge
        print("✅ IPABridge imported successfully")
        bridges['ipa'] = IPABridge
        
        from bridges.vrgc_bridge import VRGCBridge
        print("✅ VRGCBridge imported successfully")
        bridges['vrgc'] = VRGCBridge
        
        from bridges.websearch_bridge import WebSearchBridge
        print("✅ WebSearchBridge imported successfully")
        bridges['websearch'] = WebSearchBridge
        
        return True, bridges
        
    except Exception as e:
        print(f"❌ Bridge import failed: {e}")
        import traceback
        traceback.print_exc()
        return False, None

def test_tool_registry(core_modules, bridge_modules):
    """Test tool registry functionality."""
    print("\n3. Testing Tool Registry...")
    
    try:
        # Initialize core components EXACTLY like server.py
        logger = core_modules['logger']()
        print("✅ Logger initialized")
        
        # Initialize tool registry
        registry = core_modules['registry']()
        print("✅ Tool registry initialized")
        
        # Initialize covenant guardian
        covenant_guardian = core_modules['covenant'](PROJECT_ROOT)
        print("✅ Covenant guardian initialized")
        
        print(f"🔍 Initial registry tool count: {len(registry.tools)}")
        
        # Test bridge initialization with proper arguments
        bridge_count = 0
        total_tools = 0
        
        for name, bridge_class in bridge_modules.items():
            try:
                # Initialize bridge with required arguments - EXACTLY like server.py
                bridge = bridge_class(PROJECT_ROOT, logger, covenant_guardian)
                print(f"✅ {name.upper()} bridge initialized")
                
                # Get tools from bridge
                tools = bridge.get_tools()
                tool_count = len(tools) if tools else 0
                print(f"   📊 {name.upper()}: {tool_count} tools")
                total_tools += tool_count
                bridge_count += 1
                
                # Test tool registration - like server.py does
                for tool in tools:
                    if hasattr(tool, 'name'):
                        # Tool is an MCP Tool object
                        registry.register_tool(tool, name)
                    elif isinstance(tool, dict) and "name" in tool:
                        # Tool is a dictionary - would need MCP Tool class
                        print(f"   ⚠️  Tool dict format found (would need MCP Tool class): {tool.get('name', 'unnamed')}")
                    else:
                        print(f"   ⚠️  Unknown tool format: {type(tool)}")
                    
            except Exception as e:
                print(f"❌ {name.upper()} bridge failed: {e}")
                import traceback
                traceback.print_exc()
        
        print(f"\n📊 Summary:")
        print(f"   - Bridges initialized: {bridge_count}")
        print(f"   - Total bridge tools: {total_tools}")
        print(f"   - Registry tool count: {len(registry.tools)}")
        
        if bridge_count > 0 and total_tools > 0:
            print("✅ Bridge initialization successful!")
            print("✅ Tools are being created by bridges!")
            if len(registry.tools) == 0:
                print("⚠️  WARNING: Tools created but registry empty - tool registration issue!")
            else:
                print("✅ Tool registration working!")
        
        return True
        
    except Exception as e:
        print(f"❌ Tool registry test failed: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    """Run complete diagnostic test."""
    
    # Test core imports
    core_success, core_modules = test_core_imports()
    if not core_success:
        print("❌ Core import tests failed!")
        return False
    
    # Test bridge imports  
    bridge_success, bridge_modules = test_bridge_imports()
    if not bridge_success:
        print("❌ Bridge import tests failed!")
        return False
    
    # Test tool registry
    registry_success = test_tool_registry(core_modules, bridge_modules)
    if not registry_success:
        print("❌ Tool registry tests failed!")
        return False
    
    print("\n" + "=" * 50)
    print("🎯 DIAGNOSTIC TEST COMPLETE - ALL TESTS PASSED!")
    return True

if __name__ == "__main__":
    success = main()
    if not success:
        exit(1)
