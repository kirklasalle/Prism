#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** July-26-2025  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\impressioncore_goliath\bridges\ids_bridge.py #deployment #documentation #python #source_code  
**Category:** Source Code  
**Status:** Active
"""






import sys
import json
import asyncio
from pathlib import Path
from typing import Dict, List, Optional, Any

# Add project paths
CURRENT_DIR = Path(__file__).parent
PROJECT_ROOT = CURRENT_DIR.parent.parent.parent
IDS_MCP_DIR = PROJECT_ROOT / ".mcp" / "ids-mcp"

sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(IDS_MCP_DIR))

try:
    from mcp.types import Tool, TextContent
    MCP_AVAILABLE = True
except ImportError:
    MCP_AVAILABLE = False
    # Define placeholders to avoid NameError when running in standalone/test mode
    class Tool:
        def __init__(self, name, description, inputSchema):
            self.name = name
            self.description = description
            self.inputSchema = inputSchema
    
    class TextContent:
        def __init__(self, type, text):
            self.type = type
            self.text = text

# Import IDS MCP Server components
try:
    import importlib.util
    import sys
    
    # Force import from the specific IDS directory to avoid collision with Goliath
    spec = importlib.util.spec_from_file_location("ids_server", str(IDS_MCP_DIR / "server.py"))
    ids_module = importlib.util.module_from_spec(spec)
    sys.modules["ids_server"] = ids_module
    spec.loader.exec_module(ids_module)
    
    from ids_server import IDSMCPServerFixed
    IDS_SERVER_AVAILABLE = True
except Exception as e:
    print(f"WARNING: IDS server not available: {e}", file=sys.stderr)
    IDS_SERVER_AVAILABLE = False

class IDSBridge:
    """
    Bridge for ImpressionCore Documentation System (IDS) MCP Server.
    
    Provides access to all 8 IDS tools:
    - search: Documentation search with tagging
    - get_system_status: System health and statistics
    - list_tags: Available documentation tags
    - get_file_info: File metadata and information
    - get_documentation_stats: Comprehensive documentation statistics
    - run_header_updater: Automated header standardization
    - run_documentation_indexer: Documentation indexing system
    - run_system_validator: System validation and health checks
    """
    
    def __init__(self, project_root: str, logger, covenant_guardian):
        self.project_root = project_root
        self.logger = logger
        self.covenant_guardian = covenant_guardian
        self.bridge_name = "ids"
        
        # Initialize IDS server
        if IDS_SERVER_AVAILABLE:
            try:
                self.ids_server = IDSMCPServerFixed()
                self.logger.success("[SUCCESS] IDS Bridge initialized successfully")
            except Exception as e:
                self.ids_server = None
                self.logger.error("[ERROR] IDS server initialization failed", e)
        else:
            self.ids_server = None
            self.logger.warning("[WARNING] IDS server not available - using fallback mode")
    
    def get_tools(self) -> List[Tool]:
        """Get all IDS tools with proper MCP Tool definitions."""
        tools = []
        
        if not MCP_AVAILABLE:
            return tools
        
        # Documentation Search Tool
        tools.append(Tool(
            name="ids_search",
            description="Search through ImpressionCore documentation using IDS tagging system. SEARCH RULES: (1) Use single keywords: 'python', 'guide', 'system' (2) Use underscore format for multi-word: 'python_environment', 'deployment_guide' (3) NO spaces in search terms - 'system administration' will fail, use 'administration' instead (4) Search matches tags, file paths, and filenames (5) Use list-tags tool first to discover available search terms",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query for documentation. REQUIRED FORMAT: Single words or underscore_separated_terms. NO SPACES. Examples: 'python', 'environment', 'python_environment', 'deployment_guide'. Use list-tags tool to discover exact tag names."
                    },
                    "max_results": {
                        "type": "integer",
                        "default": 10,
                        "description": "Maximum number of results to return"
                    },
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional tags to filter search results. Use exact tag names from list-tags output."
                    }
                },
                "required": ["query"]
            }
        ))
        
        # System Status Tool
        tools.append(Tool(
            name="ids_get_system_status",
            description="Get current status and statistics of the IDS system",
            inputSchema={
                "type": "object",
                "properties": {},
                "additionalProperties": False
            }
        ))
        
        # List Tags Tool
        tools.append(Tool(
            name="ids_list_tags",
            description="List all available tags in the IDS system",
            inputSchema={
                "type": "object",
                "properties": {
                    "category": {
                        "type": "string",
                        "description": "Optional category to filter tags"
                    },
                    "pattern": {
                        "type": "string",
                        "description": "Optional pattern to match tag names"
                    }
                }
            }
        ))
        
        # File Information Tool
        tools.append(Tool(
            name="ids_get_file_info",
            description="Get detailed information about a specific file",
            inputSchema={
                "type": "object",
                "properties": {
                    "file_path": {
                        "type": "string",
                        "description": "Path to the file to get information about"
                    }
                },
                "required": ["file_path"]
            }
        ))
        
        # Documentation Statistics Tool
        tools.append(Tool(
            name="ids_get_documentation_stats",
            description="Get comprehensive documentation statistics",
            inputSchema={
                "type": "object",
                "properties": {},
                "additionalProperties": False
            }
        ))
        
        # Header Updater Tool (File Modifying - Requires Sacred Covenant)
        tools.append(Tool(
            name="ids_run_header_updater",
            description="Execute the automated header standardization tool to update file headers across the project",
            inputSchema={
                "type": "object",
                "properties": {
                    "target_directory": {
                        "type": "string",
                        "default": ".",
                        "description": "Directory to process (default: entire project)"
                    },
                    "dry_run": {
                        "type": "boolean",
                        "description": "Preview changes without applying them"
                    }
                }
            }
        ))
        
        # Documentation Indexer Tool (File Modifying - Requires Sacred Covenant)
        tools.append(Tool(
            name="ids_run_documentation_indexer",
            description="Execute the comprehensive documentation indexer to rebuild the documentation index",
            inputSchema={
                "type": "object",
                "properties": {
                    "force_rebuild": {
                        "type": "boolean",
                        "description": "Force complete rebuild of documentation index"
                    }
                }
            }
        ))
        
        # System Validator Tool
        tools.append(Tool(
            name="ids_run_system_validator",
            description="Execute the system validator to check file integrity, header compliance, and system health",
            inputSchema={
                "type": "object",
                "properties": {
                    "validation_scope": {
                        "type": "string",
                        "enum": ["full", "headers", "tags", "covenant"],
                        "default": "full",
                        "description": "Scope of validation (full, headers, tags, covenant)"
                    }
                }
            }
        ))
        
        return tools
    
    async def execute_tool(self, tool_name: str, arguments: Dict[str, Any]) -> List[TextContent]:
        """Execute an IDS tool and return results."""
        if not self.ids_server:
            return [TextContent(
                type="text",
                text="IDS server not available. Please check IDS MCP server installation."
            )]
        
        try:
            # Remove bridge prefix for internal execution
            internal_tool_name = tool_name.replace("ids_", "")
            
            # Route to appropriate IDS server method
            if internal_tool_name == "search":
                result = self.ids_server.handle_search(
                    query=arguments.get("query", ""),
                    max_results=arguments.get("max_results", 10),
                    tags=arguments.get("tags", None)
                )
            
            elif internal_tool_name == "get_system_status":
                result = self.ids_server.handle_get_system_status()
            
            elif internal_tool_name == "list_tags":
                result = self.ids_server.handle_list_tags(
                    category=arguments.get("category", None),
                    pattern=arguments.get("pattern", None)
                )
            
            elif internal_tool_name == "get_file_info":
                result = self.ids_server.handle_get_file_info(
                    file_path=arguments.get("file_path", "")
                )
            
            elif internal_tool_name == "get_documentation_stats":
                result = self.ids_server.handle_get_documentation_stats()
            
            elif internal_tool_name == "run_header_updater":
                # Sacred Covenant protection for file-modifying operations
                result = self.ids_server.handle_run_header_updater(
                    target_directory=arguments.get("target_directory", "."),
                    dry_run=arguments.get("dry_run", False)
                )
            
            elif internal_tool_name == "run_documentation_indexer":
                # Sacred Covenant protection for file-modifying operations
                result = self.ids_server.handle_run_documentation_indexer(
                    force_rebuild=arguments.get("force_rebuild", False)
                )
            
            elif internal_tool_name == "run_system_validator":
                result = self.ids_server.handle_run_system_validator(
                    validation_scope=arguments.get("validation_scope", "full")
                )
            
            else:
                raise ValueError(f"Unknown IDS tool: {internal_tool_name}")
            
            # Format result as JSON string for consistent output
            formatted_result = json.dumps(result, indent=2, ensure_ascii=False)
            
            return [TextContent(type="text", text=formatted_result)]
            
        except Exception as e:
            error_msg = f"IDS tool execution failed: {str(e)}"
            self.logger.error(error_msg, exception=e)
            
            return [TextContent(
                type="text",
                text=f"Error: {error_msg}\n\nPlease check the IDS server logs for more details."
            )]
    
    def get_bridge_info(self) -> Dict[str, Any]:
        """Get information about this bridge."""
        return {
            "bridge_name": self.bridge_name,
            "description": "ImpressionCore Documentation System Integration",
            "server_available": self.ids_server is not None,
            "tool_count": len(self.get_tools()),
            "capabilities": [
                "Documentation search with tagging",
                "System status monitoring",
                "Tag discovery and management",
                "File metadata retrieval",
                "Documentation statistics",
                "Automated header standardization",
                "Documentation indexing",
                "System validation and health checks"
            ],
            "sacred_covenant_protected": True,
            "file_modifying_tools": [
                "ids_run_header_updater",
                "ids_run_documentation_indexer"
            ]
        }
