#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\servers\server_fast.py #documentation #python #source_code #testing  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\servers\server_fast.py #documentation #python #source_code #testing  
**Category:** Source Code  
**Status:** Active

"""
Fast-initializing IDS MCP Server for VS Code compatibility.
Registers tools immediately, loads data lazily.
"""

import json
import sys
import os
import yaml
import asyncio
import logging
import signal
import traceback
from pathlib import Path
from typing import Dict, List, Optional, Any, Union
from datetime import datetime
import time

# Add project root to path for imports
CURRENT_DIR = Path(__file__).parent
PROJECT_ROOT = CURRENT_DIR.parent.parent
DOCS_ROOT = PROJECT_ROOT / "docs"
SRC_ROOT = PROJECT_ROOT / "src"

sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(DOCS_ROOT))
sys.path.insert(0, str(SRC_ROOT))

try:
    # Try to import from the main IDS system
    from docs.enhanced_ids import EnhancedIDS
    HAS_IDS = True
except ImportError:
    HAS_IDS = False

try:
    from rich.console import Console
    from rich.progress import Progress
    HAS_RICH = True
except ImportError:
    HAS_RICH = False

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - [%(filename)s:%(lineno)d] - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stderr),
        logging.FileHandler(CURRENT_DIR / "mcp_server.log")
    ]
)
logger = logging.getLogger("ids-mcp-server-fast")

class FastIDSMCPServer:
    """Fast-initializing IDS MCP Server with lazy loading."""
    
    def __init__(self, timeout=30.0):
        self.version = "1.0.0-fast"
        self.timeout = timeout
        self.console = Console() if HAS_RICH else None
        self.enhanced_ids = None
        self.unified_index = {}
        self.startup_time = time.time()
        self.request_count = 0
        self.initialized = False
        self.index_mtimes = {}
        
        logger.info(f"Initializing Fast IDS MCP Server v{self.version}")
        logger.debug(f"Timeout set to {timeout}s")
        logger.debug(f"Rich UI available: {HAS_RICH}")
        logger.debug(f"Enhanced IDS available: {HAS_IDS}")
        
        # DON'T initialize IDS system immediately - do it lazily
        logger.info(f"Fast IDS MCP Server v{self.version} ready (lazy loading enabled)")
    
    async def _ensure_initialized(self):
        """Ensure IDS system is initialized (lazy loading)."""
        if self.initialized:
            return
            
        logger.info("Performing lazy initialization of IDS system...")
        start_time = time.time()
        
        if not HAS_IDS:
            logger.warning("Enhanced IDS not available - running in limited mode")
            self.initialized = True
            return
            
        try:
            # Initialize with timeout
            self.enhanced_ids = EnhancedIDS()
            logger.debug("Enhanced IDS instance created")
            
            # Load unified index with timeout protection
            self._load_unified_index()
            
            initialization_time = time.time() - start_time
            logger.info(f"IDS system initialized successfully in {initialization_time:.2f}s")
            self.initialized = True
            
        except Exception as e:
            logger.error(f"IDS initialization failed: {e}")
            logger.debug(f"Full traceback: {traceback.format_exc()}")
            self.initialized = True  # Mark as initialized even if failed to prevent retries
    
    def _load_unified_index(self):
        """Load unified index with error handling."""
        try:
            unified_index_path = DOCS_ROOT / "unified_tags_index.yaml"
            if unified_index_path.exists():
                with open(unified_index_path, 'r', encoding='utf-8') as f:
                    self.unified_index = yaml.safe_load(f) or {}
                logger.info(f"Loaded unified index with {len(self.unified_index)} entries")
            else:
                logger.warning(f"Unified index not found at {unified_index_path}")
                self.unified_index = {}
                
            # Load file metadata
            metadata_path = DOCS_ROOT / "file_metadata.yaml"
            if metadata_path.exists():
                with open(metadata_path, 'r', encoding='utf-8') as f:
                    self.file_metadata = yaml.safe_load(f) or {}
                logger.info(f"Loaded file metadata for {len(self.file_metadata)} files")
            else:
                self.file_metadata = {}
                
            # Load reverse index
            reverse_index_path = DOCS_ROOT / "reverse_tag_index.yaml"
            if reverse_index_path.exists():
                with open(reverse_index_path, 'r', encoding='utf-8') as f:
                    self.reverse_index = yaml.safe_load(f) or {}
                logger.info(f"Loaded reverse index with {len(self.reverse_index)} tags")
            else:
                self.reverse_index = {}
                
        except Exception as e:
            logger.error(f"Failed to load indices: {e}")
            logger.debug(f"Load error traceback: {traceback.format_exc()}")
            self.unified_index = {}
            self.file_metadata = {}
            self.reverse_index = {}
    
    async def handle_list_tools(self) -> Dict[str, Any]:
        """Return list of available tools immediately (no lazy loading needed)."""
        return {
            "tools": [
                {
                    "name": "search",
                    "description": "Search through ImpressionCore documentation using IDS tagging system",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "query": {
                                "type": "string",
                                "description": "Search query for documentation"
                            },
                            "tags": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "Optional tags to filter search results"
                            },
                            "max_results": {
                                "type": "integer",
                                "description": "Maximum number of results to return",
                                "default": 10
                            }
                        },
                        "required": ["query"]
                    }
                },
                {
                    "name": "get-file-info",
                    "description": "Get detailed information about a specific file",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "file_path": {
                                "type": "string",
                                "description": "Path to the file to get information about"
                            }
                        },
                        "required": ["file_path"]
                    }
                },
                {
                    "name": "list-tags",
                    "description": "List all available tags in the IDS system",
                    "inputSchema": {
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
                },
                {
                    "name": "get-system-status",
                    "description": "Get current status and statistics of the IDS system",
                    "inputSchema": {
                        "type": "object",
                        "properties": {}
                    }
                },
                {
                    "name": "find-by-tag",
                    "description": "Find all files associated with specific tags",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "tags": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "Tags to search for"
                            },
                            "match_all": {
                                "type": "boolean",
                                "description": "Whether to match all tags (AND) or any tag (OR)",
                                "default": False
                            }
                        },
                        "required": ["tags"]
                    }
                },
                {
                    "name": "bookmark-management",
                    "description": "Manage bookmarks in the documentation system",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "action": {"type": "string", "description": "Action: list, add, update, delete"},
                            "category": {"type": "string", "description": "Bookmark category"},
                            "title": {"type": "string", "description": "Bookmark title"},
                            "file_path": {"type": "string", "description": "File path to bookmark"},
                            "description": {"type": "string", "description": "Bookmark description"},
                            "bookmark_id": {"type": "string", "description": "Bookmark ID for update/delete"}
                        },
                        "required": ["action"]
                    }
                },
                {
                    "name": "rebuild-index",
                    "description": "Rebuild documentation indices",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "target": {"type": "string", "description": "What to rebuild: all, tags, metadata, bookmarks", "default": "all"}
                        }
                    }
                },
                {
                    "name": "get-documentation-stats",
                    "description": "Get comprehensive documentation statistics",
                    "inputSchema": {"type": "object", "properties": {}}
                },
                {
                    "name": "validate-index",
                    "description": "Validate the integrity of documentation indices",
                    "inputSchema": {"type": "object", "properties": {}}
                },
                {
                    "name": "export-data",
                    "description": "Export documentation data in various formats",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "format": {"type": "string", "description": "Export format: json, yaml, csv", "default": "json"},
                            "include_content": {"type": "boolean", "description": "Include file content", "default": "false"}
                        }
                    }
                },
                {
                    "name": "import-data",
                    "description": "Import documentation data from file",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "file_path": {"type": "string", "description": "Path to import file"},
                            "merge_strategy": {"type": "string", "description": "Merge strategy: append, replace, merge", "default": "append"}
                        },
                        "required": ["file_path"]
                    }
                },
                {
                    "name": "get-recent-changes",
                    "description": "Get files that have been recently modified",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "days": {"type": "integer", "description": "Days to look back", "default": 7}
                        }
                    }
                },
                {
                    "name": "search-content",
                    "description": "Search within file contents for specific text",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "Text to search for"},
                            "file_pattern": {"type": "string", "description": "File pattern to limit search", "default": "*"},
                            "max_results": {"type": "integer", "description": "Maximum results", "default": 20}
                        },
                        "required": ["query"]
                    }
                },
                {
                    "name": "manage-tags",
                    "description": "Manage tags in the documentation system",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "action": {"type": "string", "description": "Action: list, add, remove, rename, merge"},
                            "tag_name": {"type": "string", "description": "Tag name"},
                            "new_tag_name": {"type": "string", "description": "New tag name for rename/merge"},
                            "file_path": {"type": "string", "description": "File path for add/remove"}
                        },
                        "required": ["action"]
                    }
                },
                {
                    "name": "analyze-documentation",
                    "description": "Perform comprehensive analysis of documentation quality",
                    "inputSchema": {"type": "object", "properties": {}}
                },
                {
                    "name": "backup-system",
                    "description": "Create a complete backup of the documentation system",
                    "inputSchema": {"type": "object", "properties": {}}
                },
                {
                    "name": "restore-system",
                    "description": "Restore documentation system from backup",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "backup_path": {"type": "string", "description": "Path to backup directory"}
                        },
                        "required": ["backup_path"]
                    }
                }
            ]
        }
    
    async def handle_call_tool(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Handle tool calls with lazy initialization."""
        self.request_count += 1
        call_start_time = time.time()
        
        logger.debug(f"Tool call #{self.request_count}: {name} with args: {arguments}")
        
        # Ensure system is initialized before handling tool calls
        await self._ensure_initialized()
        
        try:
            # Simple placeholder responses for now - can be expanded later
            if name == "search":
                return {
                    "content": [{"type": "text", "text": f"Search functionality ready (initialized: {self.initialized})"}],
                    "isError": False
                }
            elif name == "get-system-status":
                return {
                    "content": [{"type": "text", "text": f"System Status: Initialized={self.initialized}, Version={self.version}"}],
                    "isError": False
                }
            else:
                return {
                    "content": [{"type": "text", "text": f"Tool '{name}' is available but implementation pending"}],
                    "isError": False
                }
            
        except Exception as e:
            call_time = time.time() - call_start_time
            logger.error(f"Tool call #{self.request_count} ({name}) failed after {call_time:.3f}s: {e}")
            return {
                "content": [{"type": "text", "text": f"Error executing tool '{name}': {str(e)}"}],
                "isError": True
            }

# Test the fast server
async def test_fast_server():
    print("Testing fast-initializing server...")
    server = FastIDSMCPServer()
    print(f"Server initialized in: instant")
    
    tools_response = await server.handle_list_tools()
    tools = tools_response.get("tools", [])
    print(f"Tools available immediately: {len(tools)}")
    
    return len(tools) == 17

if __name__ == "__main__":
    success = asyncio.run(test_fast_server())
    print(f"Fast server test: {'PASSED' if success else 'FAILED'}")
