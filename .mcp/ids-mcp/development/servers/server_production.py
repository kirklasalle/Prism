#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\servers\server_production.py #documentation #python #source_code  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\servers\server_production.py #documentation #python #source_code  
**Category:** Source Code  
**Status:** Active

"""
ImpressionCore IDS MCP Server - Production Version
Optimized for VS Code MCP integration with immediate tool registration
"""

import asyncio
import json
import logging
import os
import signal
import sys
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

# Ensure we can import from the project root
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

try:
    import mcp.server.stdio
    import mcp.types as types
    from mcp.server import NotificationOptions, Server
    from pydantic import AnyUrl
except ImportError as e:
    print(f"MCP import error: {e}", file=sys.stderr)
    print("Please install: pip install mcp", file=sys.stderr)
    sys.exit(1)

# Configure logging for production
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - [%(filename)s:%(lineno)d] - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stderr),
        logging.FileHandler(
            project_root / "src" / "memlog" / f"ids_mcp_server_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
        )
    ]
)

logger = logging.getLogger("ids-mcp-server")

class ProductionIDSServer:
    """Production-ready IDS MCP Server with immediate tool registration"""
    
    def __init__(self):
        self.server = Server("impressioncore-ids")
        self.initialized = False
        self.ids_system = None
        self.shutdown_event = asyncio.Event()
        
        # Setup signal handlers for graceful shutdown
        if sys.platform != "win32":
            signal.signal(signal.SIGTERM, self._signal_handler)
            signal.signal(signal.SIGINT, self._signal_handler)
        
        logger.info("Initializing IDS MCP Server v1.0.0 (Production)")
        
        # Register tools immediately for VS Code compatibility
        self._register_all_tools()
        
        # Register handlers
        self.server.request_handlers[types.InitializeRequestSchema] = self.initialize
        self.server.request_handlers[types.ListToolsRequestSchema] = self.list_tools
        self.server.request_handlers[types.CallToolRequestSchema] = self.call_tool
        
    def _signal_handler(self, signum, frame):
        """Handle shutdown signals gracefully"""
        logger.info(f"Received signal {signum}, initiating graceful shutdown...")
        self.shutdown_event.set()
    
    def _register_all_tools(self):
        """Register all 17 tools immediately for VS Code compatibility"""
        tools = [
            types.Tool(
                name="search",
                description="Search through ImpressionCore documentation using IDS tagging system",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query for documentation"},
                        "tags": {"type": "array", "items": {"type": "string"}, "description": "Optional tags to filter search results"},
                        "max_results": {"type": "integer", "default": 10, "description": "Maximum number of results to return"}
                    },
                    "required": ["query"]
                }
            ),
            types.Tool(
                name="get-file-info",
                description="Get detailed information about a specific file",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "file_path": {"type": "string", "description": "Path to the file to get information about"}
                    },
                    "required": ["file_path"]
                }
            ),
            types.Tool(
                name="list-tags",
                description="List all available tags in the IDS system",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "category": {"type": "string", "description": "Optional category to filter tags"},
                        "pattern": {"type": "string", "description": "Optional pattern to match tag names"}
                    }
                }
            ),
            types.Tool(
                name="get-system-status",
                description="Get current status and statistics of the IDS system",
                inputSchema={"type": "object", "properties": {}}
            ),
            types.Tool(
                name="find-by-tag",
                description="Find all files associated with specific tags",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "tags": {"type": "array", "items": {"type": "string"}, "description": "Tags to search for"},
                        "match_all": {"type": "boolean", "default": False, "description": "Whether to match all tags (AND) or any tag (OR)"}
                    },
                    "required": ["tags"]
                }
            ),
            types.Tool(
                name="bookmark-management",
                description="Manage bookmarks within the IDS system",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "action": {"type": "string", "enum": ["add", "remove", "list"], "description": "Action to perform"},
                        "file_path": {"type": "string", "description": "File path for add/remove actions"},
                        "tags": {"type": "array", "items": {"type": "string"}, "description": "Tags for the bookmark"}
                    },
                    "required": ["action"]
                }
            ),
            types.Tool(
                name="rebuild-index",
                description="Rebuild the entire IDS index from scratch",
                inputSchema={"type": "object", "properties": {}}
            ),
            types.Tool(
                name="get-documentation-stats",
                description="Get comprehensive statistics about the documentation system",
                inputSchema={"type": "object", "properties": {}}
            ),
            types.Tool(
                name="validate-index",
                description="Validate the integrity of the IDS index",
                inputSchema={"type": "object", "properties": {}}
            ),
            types.Tool(
                name="export-data",
                description="Export IDS data to a file",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "format": {"type": "string", "enum": ["json", "yaml"], "default": "json"},
                        "include_content": {"type": "boolean", "default": False}
                    }
                }
            ),
            types.Tool(
                name="import-data",
                description="Import IDS data from a file",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "file_path": {"type": "string", "description": "Path to the import file"},
                        "merge": {"type": "boolean", "default": True, "description": "Whether to merge with existing data"}
                    },
                    "required": ["file_path"]
                }
            ),
            types.Tool(
                name="get-recent-changes",
                description="Get recently modified files in the documentation system",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "days": {"type": "integer", "default": 7, "description": "Number of days to look back"},
                        "limit": {"type": "integer", "default": 20, "description": "Maximum number of files to return"}
                    }
                }
            ),
            types.Tool(
                name="search-content",
                description="Search within file contents using full-text search",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query for file contents"},
                        "file_types": {"type": "array", "items": {"type": "string"}, "description": "File extensions to search"},
                        "max_results": {"type": "integer", "default": 10}
                    },
                    "required": ["query"]
                }
            ),
            types.Tool(
                name="manage-tags",
                description="Add, remove, or update tags for files",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "action": {"type": "string", "enum": ["add", "remove", "update"], "description": "Tag management action"},
                        "file_path": {"type": "string", "description": "Target file path"},
                        "tags": {"type": "array", "items": {"type": "string"}, "description": "Tags to add/remove/update"}
                    },
                    "required": ["action", "file_path", "tags"]
                }
            ),
            types.Tool(
                name="analyze-documentation",
                description="Analyze documentation coverage and quality",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "scope": {"type": "string", "enum": ["full", "recent", "specific"], "default": "full"},
                        "target": {"type": "string", "description": "Specific target for analysis if scope is 'specific'"}
                    }
                }
            ),
            types.Tool(
                name="backup-system",
                description="Create a backup of the IDS system",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "include_content": {"type": "boolean", "default": False},
                        "compress": {"type": "boolean", "default": True}
                    }
                }
            ),
            types.Tool(
                name="restore-system",
                description="Restore the IDS system from a backup",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "backup_path": {"type": "string", "description": "Path to the backup file"},
                        "verify": {"type": "boolean", "default": True, "description": "Verify backup integrity before restore"}
                    },
                    "required": ["backup_path"]
                }
            )
        ]
        
        logger.info(f"Registered {len(tools)} tools for immediate VS Code availability")
        return tools
    
    async def initialize(self, request: types.InitializeRequest) -> types.InitializeResult:
        """Initialize the server and return capabilities"""
        try:
            logger.info("MCP Initialize request received")
            
            # Return immediate capabilities without waiting for IDS initialization
            result = types.InitializeResult(
                protocolVersion="2024-11-05",
                capabilities=types.ServerCapabilities(
                    tools=types.ToolsCapability(),
                ),
                serverInfo=types.Implementation(
                    name="impressioncore-ids",
                    version="1.0.0"
                )
            )
            
            # Initialize IDS system in background
            asyncio.create_task(self._initialize_ids_system())
            
            logger.info("MCP Initialize completed successfully")
            return result
            
        except Exception as e:
            logger.error(f"Initialize error: {e}")
            logger.error(traceback.format_exc())
            raise
    
    async def _initialize_ids_system(self):
        """Initialize IDS system in background after MCP handshake"""
        try:
            if self.initialized:
                return
            
            logger.info("Background IDS system initialization starting...")
            
            # Lazy import to avoid blocking startup
            from docs.enhanced_ids import EnhancedIDSCore
            
            # Initialize the IDS system
            self.ids_system = EnhancedIDSCore()
            await asyncio.to_thread(self.ids_system.initialize)
            
            self.initialized = True
            logger.info("Background IDS system initialization completed")
            
        except Exception as e:
            logger.error(f"Background IDS initialization error: {e}")
            logger.error(traceback.format_exc())
    
    async def list_tools(self, request: types.ListToolsRequest) -> types.ListToolsResult:
        """Return the list of available tools"""
        try:
            tools = self._register_all_tools()
            logger.info(f"Listing {len(tools)} tools")
            return types.ListToolsResult(tools=tools)
        except Exception as e:
            logger.error(f"List tools error: {e}")
            raise
    
    async def call_tool(self, request: types.CallToolRequest) -> types.CallToolResult:
        """Handle tool calls"""
        try:
            tool_name = request.params.name
            arguments = request.params.arguments or {}
            
            logger.info(f"Tool call: {tool_name} with args: {arguments}")
            
            # Wait for IDS system if not initialized
            if not self.initialized:
                logger.info("Waiting for IDS system initialization...")
                timeout = 30  # 30 second timeout
                for _ in range(timeout):
                    if self.initialized:
                        break
                    await asyncio.sleep(1)
                else:
                    return types.CallToolResult(
                        content=[types.TextContent(
                            type="text",
                            text="Error: IDS system initialization timeout. Please try again."
                        )]
                    )
            
            # Map hyphenated tool names to method names
            method_map = {
                "search": "handle_search",
                "get-file-info": "handle_get_file_info", 
                "list-tags": "handle_list_tags",
                "get-system-status": "handle_get_system_status",
                "find-by-tag": "handle_find_by_tag",
                "bookmark-management": "handle_bookmark_management",
                "rebuild-index": "handle_rebuild_index",
                "get-documentation-stats": "handle_get_documentation_stats",
                "validate-index": "handle_validate_index",
                "export-data": "handle_export_data",
                "import-data": "handle_import_data",
                "get-recent-changes": "handle_get_recent_changes",
                "search-content": "handle_search_content",
                "manage-tags": "handle_manage_tags",
                "analyze-documentation": "handle_analyze_documentation",
                "backup-system": "handle_backup_system",
                "restore-system": "handle_restore_system"
            }
            
            method_name = method_map.get(tool_name)
            if not method_name:
                raise ValueError(f"Unknown tool: {tool_name}")
            
            method = getattr(self, method_name)
            result = await method(arguments)
            
            if isinstance(result, str):
                return types.CallToolResult(
                    content=[types.TextContent(type="text", text=result)]
                )
            else:
                return types.CallToolResult(
                    content=[types.TextContent(type="text", text=json.dumps(result, indent=2))]
                )
                
        except Exception as e:
            error_msg = f"Tool call error: {e}"
            logger.error(error_msg)
            logger.error(traceback.format_exc())
            return types.CallToolResult(
                content=[types.TextContent(type="text", text=error_msg)]
            )
    
    # Tool handler methods (simplified for production)
    async def handle_search(self, arguments: Dict[str, Any]) -> str:
        """Handle search requests"""
        if not self.ids_system:
            return "IDS system not initialized"
        
        query = arguments.get("query", "")
        tags = arguments.get("tags", [])
        max_results = arguments.get("max_results", 10)
        
        results = await asyncio.to_thread(
            self.ids_system.search, query, tags, max_results
        )
        
        return json.dumps(results, indent=2)
    
    async def handle_get_file_info(self, arguments: Dict[str, Any]) -> str:
        """Handle get file info requests"""
        if not self.ids_system:
            return "IDS system not initialized"
        
        file_path = arguments.get("file_path", "")
        info = await asyncio.to_thread(self.ids_system.get_file_info, file_path)
        
        return json.dumps(info, indent=2)
    
    async def handle_list_tags(self, arguments: Dict[str, Any]) -> str:
        """Handle list tags requests"""
        if not self.ids_system:
            return "IDS system not initialized"
        
        category = arguments.get("category")
        pattern = arguments.get("pattern")
        
        tags = await asyncio.to_thread(self.ids_system.list_tags, category, pattern)
        return json.dumps(tags, indent=2)
    
    async def handle_get_system_status(self, arguments: Dict[str, Any]) -> str:
        """Handle get system status requests"""
        if not self.ids_system:
            return "IDS system not initialized"
        
        status = await asyncio.to_thread(self.ids_system.get_system_status)
        return json.dumps(status, indent=2)
    
    async def handle_find_by_tag(self, arguments: Dict[str, Any]) -> str:
        """Handle find by tag requests"""
        if not self.ids_system:
            return "IDS system not initialized"
        
        tags = arguments.get("tags", [])
        match_all = arguments.get("match_all", False)
        
        results = await asyncio.to_thread(self.ids_system.find_by_tag, tags, match_all)
        return json.dumps(results, indent=2)
    
    # Placeholder handlers for remaining tools
    async def handle_bookmark_management(self, arguments: Dict[str, Any]) -> str:
        return "Bookmark management feature coming soon"
    
    async def handle_rebuild_index(self, arguments: Dict[str, Any]) -> str:
        if not self.ids_system:
            return "IDS system not initialized"
        
        result = await asyncio.to_thread(self.ids_system.rebuild_index)
        return json.dumps(result, indent=2)
    
    async def handle_get_documentation_stats(self, arguments: Dict[str, Any]) -> str:
        if not self.ids_system:
            return "IDS system not initialized"
        
        stats = await asyncio.to_thread(self.ids_system.get_documentation_stats)
        return json.dumps(stats, indent=2)
    
    async def handle_validate_index(self, arguments: Dict[str, Any]) -> str:
        return "Index validation feature coming soon"
    
    async def handle_export_data(self, arguments: Dict[str, Any]) -> str:
        return "Data export feature coming soon"
    
    async def handle_import_data(self, arguments: Dict[str, Any]) -> str:
        return "Data import feature coming soon"
    
    async def handle_get_recent_changes(self, arguments: Dict[str, Any]) -> str:
        return "Recent changes feature coming soon"
    
    async def handle_search_content(self, arguments: Dict[str, Any]) -> str:
        return "Content search feature coming soon"
    
    async def handle_manage_tags(self, arguments: Dict[str, Any]) -> str:
        return "Tag management feature coming soon"
    
    async def handle_analyze_documentation(self, arguments: Dict[str, Any]) -> str:
        return "Documentation analysis feature coming soon"
    
    async def handle_backup_system(self, arguments: Dict[str, Any]) -> str:
        return "System backup feature coming soon"
    
    async def handle_restore_system(self, arguments: Dict[str, Any]) -> str:
        return "System restore feature coming soon"

async def main():
    """Main entry point for the MCP server"""
    try:
        server_instance = ProductionIDSServer()
        
        logger.info("Starting IDS MCP Server (Production)")
        
        # Run with stdio transport
        async with mcp.server.stdio.stdio_server() as (read_stream, write_stream):
            await server_instance.server.run(
                read_stream,
                write_stream,
                NotificationOptions(
                    tools_changed=True,
                    prompts_changed=False,
                    resources_changed=False
                ),
            )
    except KeyboardInterrupt:
        logger.info("Server interrupted by user")
    except Exception as e:
        logger.error(f"Server error: {e}")
        logger.error(traceback.format_exc())
        sys.exit(1)
    finally:
        logger.info("Server shutdown complete")

if __name__ == "__main__":
    asyncio.run(main())
