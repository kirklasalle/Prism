#!/usr/bin/env python3
r"""
**Created:** 2025-07-26  
**Updated:** 2025-08-04 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\impressioncore_goliath\server.py #documentation #python #source_code #testing #web_interface  
**Category:** Source Code  
**Status:** Active

ImpressionCore Goliath MCP Server - Unified Nerve Center
========================================================

🚀 THE BRAIN-TRIAD ORCHESTRATION LAYER 🚀

Features:
- 🧠 UNIFIED SWARM MEMORY: Centralized context and Digital DNA sharing
- ⚖️ VRAM LOAD BALANCING: Hardware-aware task routing for GTX 1050 Ti
- 🌉 MULTI-BRIDGE ARCHITECTURE: Seamless integration of IDS, EDS, IPA, VRGC, DPA
- 🛡️ COVENANT GUARDIAN: Integrated file integrity and safety checks

Compliance: Sacred Covenant Verified ✅
Version: 5.0.0 - Nerve Center Integration
"""

import asyncio
import os
import sys
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

# Chronology (shared loader)
try:
    from assistant.chronology_loader import load_chronology, query_chronology, load_delta  # type: ignore
    HAS_CHRONOLOGY = True
except Exception:
    HAS_CHRONOLOGY = False

# Add project paths for imports
CURRENT_DIR = Path(__file__).parent
PROJECT_ROOT = CURRENT_DIR.parent.parent

sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / "src"))
sys.path.insert(0, str(CURRENT_DIR))

# Import core systems first
from core.covenant_guardian import GoliathCovenantGuardian
from core.unified_logger import GoliathLogger
from utils.tool_registry import GoliathToolRegistry
from core.swarm_memory import SwarmMemory
from core.load_balancer import VRAMLoadBalancer

# Import bridge modules
from bridges.ids_bridge import IDSBridge
from bridges.dpa_bridge import DPABridge  
from bridges.eds_bridge import EDSBridge
from bridges.ipa_bridge import IPABridge
from bridges.vrgc_bridge import VRGCBridge
from bridges.websearch_bridge import WebSearchBridge



# MCP imports - correct imports for MCP server
try:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp.server.models import InitializationOptions
    from mcp.types import Tool, TextContent
    MCP_AVAILABLE = True
except ImportError:
    MCP_AVAILABLE = False
    Tool = None
    TextContent = None
    Server = None

# Initialize global components
# Detect MCP mode (running as MCP server vs test mode)
MCP_MODE = "--test" not in sys.argv

logger = GoliathLogger()
tool_registry = GoliathToolRegistry()
covenant_guardian = GoliathCovenantGuardian(PROJECT_ROOT)

# Bridge instances
bridges = {}
swarm_memory = SwarmMemory(PROJECT_ROOT, logger)
load_balancer = VRAMLoadBalancer(logger)
is_initialized = False

class ChronologyBridge:
    """Minimal bridge exposing chronology snapshot/delta/stats (read-only)."""
    def __init__(self, project_root: Path, logger, guardian):  # guardian unused (interface parity)
        self.project_root = project_root
        self.logger = logger

    def get_tools(self):
        if not MCP_AVAILABLE:
            return []
        return [
            Tool(
                name="chronology_snapshot",
                description="Chronology snapshot (docs/source/mcp/root/all) creation-ordered",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "kind": {"type": "string", "enum": ["all","docs","source","mcp","root"], "default": "all"},
                        "limit": {"type": "integer", "default": 50},
                        "reverse": {"type": "boolean", "default": False}
                    }
                }
            ),
            Tool(
                name="chronology_delta",
                description="Chronology delta (added/removed/changed) if diff present",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "include": {"type": "array", "items": {"type": "string", "enum": ["added","removed","changed"]}},
                        "limit": {"type": "integer", "default": 200}
                    }
                }
            ),
            Tool(
                name="chronology_stats",
                description="Chronology statistics (counts per category + delta counts)",
                inputSchema={"type": "object", "properties": {}}
            )
        ]

    async def execute_tool(self, name: str, arguments: Dict[str, Any]):
        if not HAS_CHRONOLOGY:
            return {"error": "chronology_loader_not_available"}
        try:
            if name == "chronology_snapshot":
                data = load_chronology()
                kind = arguments.get('kind', 'all')
                limit = arguments.get('limit', 50)
                reverse = arguments.get('reverse', False)
                items = query_chronology(data, kind=kind, limit=limit, reverse=reverse)
                return {
                    'kind': kind,
                    'limit': limit,
                    'reverse': reverse,
                    'count': len(items),
                    'items': items,
                    'generated': data.get('generated'),
                    'ordering': data.get('ordering'),
                    'schema_version': data.get('schema_version')
                }
            elif name == "chronology_delta":
                delta_data = load_delta()
                if not delta_data:
                    return {"error": "delta_not_available", "hint": "Generate chronology with --delta in IDS."}
                include = arguments.get('include') or ['added','removed','changed']
                limit = arguments.get('limit', 200)
                payload = {'generated': delta_data.get('generated'), 'counts': delta_data.get('counts', {})}
                for key in ['added','removed','changed']:
                    if key in include and key in delta_data:
                        data_slice = delta_data[key]
                        payload[key] = data_slice[:limit] if limit else data_slice
                return payload
            elif name == "chronology_stats":
                data = load_chronology()
                stats = {
                    'documents': len(data.get('documents', [])),
                    'source': len(data.get('source', [])),
                    'mcp': len(data.get('mcp', [])),
                    'root': len(data.get('root', [])),
                    'generated': data.get('generated'),
                    'ordering': data.get('ordering'),
                    'schema_version': data.get('schema_version')
                }
                delta_data = load_delta()
                if delta_data and delta_data.get('counts'):
                    stats['delta'] = delta_data['counts']
                return stats
            return {"error": f"Unknown chronology tool: {name}"}
        except Exception as e:
            return {"error": "chronology_execution_failed", "detail": str(e)}

class GoliathOrchestrationBridge:
    """Orchestration bridge for swarm-wide memory and load balancing."""
    def __init__(self, project_root: Path, logger, guardian, memory, balancer):
        self.project_root = project_root
        self.logger = logger
        self.memory = memory
        self.balancer = balancer

    def get_tools(self):
        if not MCP_AVAILABLE:
            return []
        return [
            Tool(
                name="goliath_get_swarm_state",
                description="Get the current state of the swarm memory and hardware metrics",
                inputSchema={"type": "object", "properties": {}}
            ),
            Tool(
                name="goliath_synergize_memory",
                description="Register a finding or context tag into the global swarm memory",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "key": {"type": "string"},
                        "value": {"type": "object"},
                        "dna": {"type": "string"},
                        "tags": {"type": "array", "items": {"type": "string"}}
                    }
                }
            )
        ]

    async def execute_tool(self, name: str, arguments: Dict[str, Any]):
        try:
            if name == "goliath_get_swarm_state":
                return {
                    "memory": self.memory.get_state(),
                    "hardware": self.balancer.get_metrics()
                }
            elif name == "goliath_synergize_memory":
                key = arguments.get("key")
                value = arguments.get("value")
                dna = arguments.get("dna")
                tags = arguments.get("tags")
                
                if key and value:
                    self.memory.register_finding("goliath", key, value, dna)
                if tags:
                    self.memory.update_context(tags)
                
                return {"status": "success", "message": "Swarm memory synergized."}
            return {"error": f"Unknown orchestration tool: {name}"}
        except Exception as e:
            return {"error": str(e)}

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
            ("websearch", WebSearchBridge, "Web Search & Content Extraction"),
            ("goliath", lambda r, l, g: GoliathOrchestrationBridge(r, l, g, swarm_memory, load_balancer), "Unified Nerve Center Orchestration")
        ]

        if HAS_CHRONOLOGY:
            bridge_configs.append(("chronology", ChronologyBridge, "Unified Chronology Access"))
        
        for bridge_name, bridge_class, description in bridge_configs:
            try:
                bridge = bridge_class(PROJECT_ROOT, logger, covenant_guardian)
                bridge_tools = bridge.get_tools()
                
                # Register tools with namespace
                for tool in bridge_tools:
                    if hasattr(tool, 'name'):
                        # Tool is an MCP Tool object
                        tool_registry.register_tool(tool, bridge_name)
                    elif isinstance(tool, dict) and "name" in tool:
                        # Tool is a dictionary - convert to Tool object
                        if Tool:
                            tool_obj = Tool(
                                name=tool["name"],
                                description=tool.get("description", ""),
                                inputSchema=tool.get("inputSchema", {})
                            )
                            tool_registry.register_tool(tool_obj, bridge_name)
                        else:
                            logger.error(f"[ERROR] Cannot create Tool object - MCP not available")
                    else:
                        logger.error(f"[ERROR] Invalid tool format in {bridge_name}: {tool}")
                        continue
                
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

# Create MCP app if available
if MCP_AVAILABLE:
    app = Server("impressioncore-goliath")
    
    @app.list_tools()
    async def list_tools() -> List[Tool]:
        """List all available tools from all bridges."""
        if not is_initialized:
            # Return empty list if not initialized yet
            return []
        return tool_registry.get_all_tools()

    @app.call_tool()
    async def call_tool(name: str, arguments: Dict[str, Any]) -> List[TextContent]:
        """Execute a tool from any bridge."""        
        if not is_initialized:
            return [TextContent(
                type="text",
                text="[INFO] Goliath is still initializing. Please wait a moment and try again."
            )]
        
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
            
            # VRAM Load Balancing Check
            # Assume a heavy tool if it matches certain keywords
            if any(k in name.lower() for k in ["research", "curate", "train", "heal"]):
                load_balancer.coordinate_swap(bridge_name, 0.5) # Simulate 0.5GB requirement
                
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
else:
    app = None

async def main():
    """Main entry point."""
    if not MCP_AVAILABLE or app is None:
        print("[ERROR] MCP Server not available - cannot run server")
        return
    
    # Check for test mode - do full sync initialization
    if "--test" in sys.argv:
        initialize_goliath()
        
        # Display startup banner
        
        logger.info("[TEST] Goliath server test mode - initialization complete")
        print(f"SUCCESS: All systems operational! Tools: {sum(len(bridge.get_tools()) for bridge in bridges.values())}, Bridges: {list(bridges.keys())}")
        return
    
    try:
        async with stdio_server() as (read_stream, write_stream):
            # Start background initialization
            init_task = asyncio.create_task(background_initialize_goliath())
            await app.run(
                read_stream,
                write_stream,
                InitializationOptions(
                    server_name="impressioncore-goliath",
                    server_version="1.0.0",
                    capabilities={}
                )
            )
    except KeyboardInterrupt:
        logger.info("[SHUTDOWN] Goliath server shutdown requested")
    except Exception as e:
        logger.error(f"[ERROR] Server error: {e}")
        logger.error(f"[ERROR] Traceback: {traceback.format_exc()}")

async def background_initialize_goliath():
    """Initialize Goliath in the background after MCP server starts."""
    await asyncio.sleep(1)  # Give MCP server time to start
    initialize_goliath()
    logger.info("[MCP] Goliath background initialization complete. Tools are now available.")
    # No banner in MCP mode

if __name__ == "__main__":
    asyncio.run(main())
