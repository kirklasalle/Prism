#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** July-27-2025  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\impressioncore_goliath\test_tool_registry.py #python #source_code #testing  
**Category:** Source Code  
**Status:** Active
"""





import sys
import os
from pathlib import Path

# Set up paths
current_dir = Path(__file__).parent
project_root = current_dir.parent.parent
sys.path.insert(0, str(current_dir))
sys.path.insert(0, str(project_root))
sys.path.insert(0, str(project_root / "src"))

print("🔍 GOLIATH TOOL REGISTRY DIAGNOSTIC TEST")
print("=" * 50)

def test_imports():
    """Test all core imports."""
    print("\n1. Testing Core Imports...")
    
    try:
        from core.unified_logger import GoliathLogger
        print("✅ GoliathLogger imported successfully")
    except Exception as e:
        print(f"❌ GoliathLogger import failed: {e}")
        return False
    
    try:
        from core.covenant_guardian import GoliathCovenantGuardian
        print("✅ GoliathCovenantGuardian imported successfully")
    except Exception as e:
        print(f"❌ GoliathCovenantGuardian import failed: {e}")
        return False
    
    try:
        from utils.tool_registry import GoliathToolRegistry
        print("✅ GoliathToolRegistry imported successfully")
    except Exception as e:
        print(f"❌ GoliathToolRegistry import failed: {e}")
        return False
    
    try:
        from bridges.ids_bridge import IDSBridge
        print("✅ IDSBridge imported successfully")
    except Exception as e:
        print(f"❌ IDSBridge import failed: {e}")
        return False
    
    return True

def test_initialization():
    """Test component initialization."""
    print("\n2. Testing Component Initialization...")
    
    try:
        from core.unified_logger import GoliathLogger
        from core.covenant_guardian import GoliathCovenantGuardian
        from utils.tool_registry import GoliathToolRegistry
        
        logger = GoliathLogger()
        print("✅ GoliathLogger initialized")
        
        covenant_guardian = GoliathCovenantGuardian(project_root)
        print("✅ GoliathCovenantGuardian initialized")
        
        tool_registry = GoliathToolRegistry()
        print("✅ GoliathToolRegistry initialized")
        
        return logger, covenant_guardian, tool_registry
        
    except Exception as e:
        print(f"❌ Initialization failed: {e}")
        import traceback
        traceback.print_exc()
        return None

def test_bridge_loading():
    """Test bridge loading and tool extraction."""
    print("\n3. Testing Bridge Loading...")
    
    components = test_initialization()
    if not components:
        return
    
    logger, covenant_guardian, tool_registry = components
    
    try:
        from bridges.ids_bridge import IDSBridge
        
        print("Creating IDS Bridge...")
        ids_bridge = IDSBridge(project_root, logger, covenant_guardian)
        print("✅ IDS Bridge created successfully")
        
        print("Getting tools from IDS Bridge...")
        tools = ids_bridge.get_tools()
        print(f"✅ IDS Bridge provided {len(tools)} tools")
        
        if tools:
            print(f"First tool type: {type(tools[0])}")
            if hasattr(tools[0], 'name'):
                print(f"First tool name: {tools[0].name}")
            else:
                print(f"First tool data: {tools[0]}")
                
            # Test tool registration
            print("\nTesting tool registration...")
            success_count = 0
            for i, tool in enumerate(tools):
                try:
                    tool_registry.register_tool(tool, 'ids')
                    success_count += 1
                except Exception as e:
                    print(f"❌ Failed to register tool {i}: {e}")
            
            print(f"✅ Successfully registered {success_count}/{len(tools)} tools")
            print(f"Total tools in registry: {len(tool_registry.get_all_tools())}")
            
            # Show registry contents
            registry_tools = tool_registry.get_all_tools()
            if registry_tools:
                print(f"Registry tool types: {[type(t) for t in registry_tools[:3]]}")
            
        return True
        
    except Exception as e:
        print(f"❌ Bridge loading failed: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    """Run the diagnostic test."""
    print(f"Working directory: {os.getcwd()}")
    print(f"Project root: {project_root}")
    print(f"Python path: {sys.path[:3]}")
    
    # Run tests
    if test_imports():
        print("\n✅ All imports successful!")
        test_bridge_loading()
    else:
        print("\n❌ Import tests failed!")
    
    print("\n" + "=" * 50)
    print("🎯 DIAGNOSTIC TEST COMPLETE")

if __name__ == "__main__":
    main()
