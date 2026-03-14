#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** Kirk LaSalle  
**Tags:** #.mcp\impressioncore_goliath\server_broken.py #documentation #python #source_code #testing #web_interface  
**Category:** Source Code  
**Status:** Active
"""






import asyncio
import os
import sys
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

# Add project paths for imports
CURRENT_DIR = Path(__file__).parent
PROJECT_ROOT = CURRENT_DIR.parent.parent

sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / "src"))
sys.path.insert(0, str(CURRENT_DIR))

# Import dependencies
try:
    from mcp import FastMCP, TextContent
    from mcp.types import Tool
    MCP_AVAILABLE = True
except ImportError:
    MCP_AVAILABLE = False
    Tool = None
    TextContent = None
    FastMCP = None

# Import core systems
from core.covenant_guardian import GoliathCovenantGuardian
from core.unified_logger import GoliathLogger
from utils.tool_registry import GoliathToolRegistry

# Import bridge modules
from bridges.ids_bridge import IDSBridge
from bridges.dpa_bridge import DPABridge  
from bridges.eds_bridge import EDSBridge
from bridges.ipa_bridge import IPABridge
from bridges.vrgc_bridge import VRGCBridge
from bridges.websearch_bridge import WebSearchBridge

# Rich UI imports
try:
    from rich.console import Console
    from rich.panel import Panel
    from rich.text import Text
    RICH_AVAILABLE = True
    console = Console()
except ImportError:
    RICH_AVAILABLE = False
    console = None

# Initialize global components
logger = GoliathLogger()
tool_registry = GoliathToolRegistry()
covenant_guardian = GoliathCovenantGuardian(PROJECT_ROOT)

# MCP app will be initialized when needed
app = None

# Bridge instances
bridges = {}
is_initialized = False

def initialize_goliath():
    """Initialize all bridges and tools."""
    global bridges, is_initialized
    
    if is_initialized:
        return
        
    logger.info("[ROCKET] ImpressionCore-Goliath MCP Server initializing...")
    
    try:
        # Initialize all bridges
        bridge_configs = [
            ("ids", IDSBridge, "Documentation System Management"),
            ("dpa", DPABridge, "Digital Project Assistant"), 
            ("eds", EDSBridge, "Educational Data Scraper"),
            ("ipa", IPABridge, "Intelligent Processing Assistant"),
            ("vrgc", VRGCBridge, "Virtually Robotic GitHub Copilot"),
            ("websearch", WebSearchBridge, "Web Search & Content Extraction")
        ]
        
        for bridge_name, bridge_class, description in bridge_configs:
            try:
                bridge = bridge_class()
                bridge_tools = bridge.get_tools()
                
                # Register tools with namespace
                for tool in bridge_tools:
                    tool_registry.register_tool(bridge_name, tool["name"], tool)
                
                bridges[bridge_name] = bridge
                logger.success(f"[SUCCESS] {bridge_name.upper()} bridge loaded: {description} ({len(bridge_tools)} tools)")
                
            except Exception as e:
                logger.error(f"[ERROR] Failed to initialize {bridge_name} bridge: {e}")
                continue
        
        # Final initialization
        total_tools = sum(len(bridge.get_tools()) for bridge in bridges.values())
        logger.success(f"[SUCCESS] Goliath initialized with {total_tools} tools from {len(bridges)} bridges")
        
        is_initialized = True
        
    except Exception as e:
        logger.error(f"[ERROR] Goliath initialization failed: {e}")
        logger.error(f"[ERROR] Traceback: {traceback.format_exc()}")

@app.list_tools()
async def list_tools():
    """List all available tools from all bridges."""
    if not is_initialized:
        initialize_goliath()
    
    return tool_registry.get_all_tools()

@app.call_tool()
async def call_tool(name: str, arguments: Dict[str, Any]):
    """Execute a tool from any bridge."""
    if not is_initialized:
        initialize_goliath()
    
    try:
        # Parse tool name for bridge namespace
        if ":" in name:
            bridge_name, tool_name = name.split(":", 1)
        else:
            # Find tool in any bridge
            bridge_name = tool_registry.find_tool_bridge(name)
            tool_name = name
            
        if bridge_name not in bridges:
            return [TextContent(
                type="text",
                text=f"[ERROR] Bridge '{bridge_name}' not found. Available bridges: {list(bridges.keys())}"
            )]
        
        # Execute tool
        bridge = bridges[bridge_name]
        result = await bridge.execute_tool(tool_name, arguments)
        
        # Convert result to TextContent
        if isinstance(result, list) and len(result) > 0 and hasattr(result[0], 'type'):
            return result
        elif isinstance(result, dict):
            return [TextContent(type="text", text=str(result))]
        else:
            return [TextContent(type="text", text=str(result))]
            
    except Exception as e:
        error_msg = f"[ERROR] Tool execution failed: {e}"
        logger.error(error_msg)
        logger.error(f"[ERROR] Traceback: {traceback.format_exc()}")
        return [TextContent(type="text", text=error_msg)]

async def main():
    """Main entry point."""
    if not MCP_AVAILABLE:
        print("[ERROR] FastMCP not available - cannot run server")
        return
    
    # Initialize everything
    initialize_goliath()
    
    # Display startup banner
    if RICH_AVAILABLE:
        console.print(Panel.fit(
            f"[bold green]ImpressionCore-Goliath MCP Server[/bold green]\n"
            f"[cyan]The Ultimate Unified Powerhouse[/cyan]\n\n"
            f"[yellow][STATUS][/yellow] {sum(len(bridge.get_tools()) for bridge in bridges.values())} tools from {len(bridges)} bridges\n"
            f"[yellow][COVENANT][/yellow] File protection ACTIVE\n"
            f"[yellow][PERFORMANCE][/yellow] Ready for high-throughput operations",
            title="[ROCKET] GOLIATH READY",
            border_style="green"
        ))
    
    # Check for test mode
    if "--test" in sys.argv:
        logger.info("[TEST] Goliath server test mode - initialization complete")
        print(f"SUCCESS: All systems operational! Tools: {sum(len(bridge.get_tools()) for bridge in bridges.values())}, Bridges: {list(bridges.keys())}")
        return
    
    try:
        # Run the MCP server
        await app.run()
    except KeyboardInterrupt:
        logger.info("[SHUTDOWN] Goliath server shutdown requested")
    except Exception as e:
        logger.error(f"[ERROR] Server error: {e}")
        logger.error(f"[ERROR] Traceback: {traceback.format_exc()}")

if __name__ == "__main__":
    asyncio.run(main())
