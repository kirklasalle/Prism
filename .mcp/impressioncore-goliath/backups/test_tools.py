#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\impressioncore_goliath\test_tools.py #documentation #python #source_code #testing #web_interface  
**Category:** Source Code  
**Status:** Active
"""






import sys
import asyncio
from pathlib import Path

# Add project paths
CURRENT_DIR = Path(__file__).parent
PROJECT_ROOT = CURRENT_DIR.parent.parent

sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / "src"))
sys.path.insert(0, str(CURRENT_DIR))

from core.unified_logger import GoliathLogger
from utils.tool_registry import GoliathToolRegistry

def test_tool_discovery():
    """Test tool discovery and registration."""
    logger = GoliathLogger()
    logger.info("[TEST] Starting tool discovery test")
    
    # Import and initialize tool registry
    tool_registry = GoliathToolRegistry()
    
    # Import bridge modules
    try:
        from bridges.ids_bridge import IDSBridge
        from bridges.dpa_bridge import DPABridge  
        from bridges.eds_bridge import EDSBridge
        from bridges.ipa_bridge import IPABridge
        from bridges.vrgc_bridge import VRGCBridge
        from bridges.websearch_bridge import WebSearchBridge
        
        logger.success("[SUCCESS] All bridge modules imported")
        
        # Test each bridge
        bridge_configs = [
            ("ids", IDSBridge, "Documentation System Management"),
            ("dpa", DPABridge, "Digital Project Assistant"),
            ("eds", EDSBridge, "Educational Data Scraper"),
            ("ipa", IPABridge, "Intelligent Processing Assistant"),
            ("vrgc", VRGCBridge, "Virtually Robotic GitHub Copilot"),
            ("websearch", WebSearchBridge, "Web Search & Content Extraction")
        ]
        
        total_tools = 0
        for bridge_name, bridge_class, description in bridge_configs:
            try:
                bridge = bridge_class(PROJECT_ROOT, logger, None)
                bridge_tools = bridge.get_tools()
                
                logger.info(f"[BRIDGE] {bridge_name}: {len(bridge_tools)} tools")
                
                # Register tools in the registry (like the main server does)
                for tool in bridge_tools:
                    if hasattr(tool, 'name'):
                        # Tool is an MCP Tool object
                        tool_registry.register_tool(tool, bridge_name)
                        logger.info(f"  - Registered: {tool.name}")
                    else:
                        logger.info(f"  - Invalid tool format: {tool}")
                
                total_tools += len(bridge_tools)
                
            except Exception as e:
                logger.error(f"[ERROR] Bridge {bridge_name} failed: {e}")
                import traceback
                logger.error(f"[ERROR] Traceback: {traceback.format_exc()}")
        
        logger.success(f"[SUMMARY] Total tools discovered: {total_tools}")
        
        # Test tool registry
        all_tools = tool_registry.get_all_tools()
        logger.info(f"[REGISTRY] Tools in registry: {len(all_tools)}")
        
        # Show tool names
        if len(all_tools) > 0:
            logger.info("[TOOLS] Sample tool names:")
            for tool in all_tools[:10]:  # Show first 10
                logger.info(f"  - {tool.name}")
        
        return True
        
    except Exception as e:
        logger.error(f"[ERROR] Tool discovery failed: {e}")
        import traceback
        logger.error(f"[ERROR] Traceback: {traceback.format_exc()}")
        return False

if __name__ == "__main__":
    success = test_tool_discovery()
    if success:
        print("\n✅ Tool discovery test PASSED")
    else:
        print("\n❌ Tool discovery test FAILED")
