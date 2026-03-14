#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\servers\server_backup.py #api #command_line #documentation #python #source_code  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\servers\server_backup.py #api #command_line #documentation #python #source_code  
**Category:** Source Code  
**Status:** Active

"""
ImpressionCore Documentation System (IDS) MCP Server
====================================================

Model Context Protocol server for accessing the ImpressionCore Documentation System.
Provides programmatic access to IDS functionality including search, indexing, and
document management capabilities.

Features:
- Document search with tagging support
- File metadata retrieval
- Documentation index management
- Real-time search across 1,667+ files with 2,900+ tags
- Rich formatting and status updates

Author: ImpressionCore IDS Team
Created: 2025-06-05
Last Modified: 2025-06-05
Version: 1.0.0
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
    from rich.panel import Panel
    from rich.table import Table
    from rich.text import Text
    HAS_RICH = True
except ImportError:
    HAS_RICH = False

# Configure enhanced logging with debugging
log_level = logging.DEBUG if os.getenv('IDS_DEBUG', '').lower() in ('1', 'true', 'yes') else logging.INFO
logging.basicConfig(
    level=log_level,
    format='%(asctime)s - %(name)s - %(levelname)s - [%(filename)s:%(lineno)d] - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(CURRENT_DIR / 'ids_mcp.log', mode='a', encoding='utf-8')
    ]
)
logger = logging.getLogger("ids-mcp-server")

# Global shutdown flag
shutdown_flag = asyncio.Event()

def signal_handler(signum, frame):
    """Handle graceful shutdown signals."""
    logger.info(f"Received signal {signum}, initiating graceful shutdown...")
    shutdown_flag.set()

# Register signal handlers for graceful shutdown
signal.signal(signal.SIGINT, signal_handler)  # Ctrl+C
if hasattr(signal, 'SIGTERM'):
    signal.signal(signal.SIGTERM, signal_handler)  # Termination signal

class IDSMCPServer:
    """MCP Server for ImpressionCore Documentation System with enhanced debugging and error handling."""
    
    def __init__(self, timeout=30.0):
        self.version = "1.0.0"
        self.timeout = timeout
        self.console = Console() if HAS_RICH else None
        self.enhanced_ids = None
        self.unified_index = {}
        self.startup_time = time.time()
        self.request_count = 0
        
        logger.info(f"Initializing IDS MCP Server v{self.version}")
        logger.debug(f"Timeout set to {timeout}s")
        logger.debug(f"Rich UI available: {HAS_RICH}")
        logger.debug(f"Enhanced IDS available: {HAS_IDS}")
        
        # Initialize IDS system with timeout protection
        try:
            self._initialize_ids_system()
        except Exception as e:
            logger.error(f"Failed to initialize IDS system: {e}")
            logger.debug(f"Initialization error traceback: {traceback.format_exc()}")
    
    def _initialize_ids_system(self):
        """Initialize the Enhanced IDS system with timeout protection."""
        logger.debug("Starting IDS system initialization...")
        start_time = time.time()        
        if not HAS_IDS:
            logger.warning("Enhanced IDS not available - running in limited mode")
            return
            
        try:
            # Initialize with timeout
            self.enhanced_ids = EnhancedIDS()
            logger.debug("Enhanced IDS instance created")
            
            # Load unified index with timeout protection
            self._load_unified_index()
            
            initialization_time = time.time() - start_time
            logger.info(f"IDS system initialized successfully in {initialization_time:.2f}s")
            
        except Exception as e:
            logger.error(f"IDS initialization failed: {e}")
            logger.debug(f"Full traceback: {traceback.format_exc()}")
            self.enhanced_ids = None
    
    def _load_unified_index(self):
        """Load unified index with error handling."""
        try:
            unified_index_path = DOCS_ROOT / "unified_tags_index.yaml"
            if unified_index_path.exists():
                with open(unified_index_path, 'r', encoding='utf-8') as f:
                    self.unified_index = yaml.safe_load(f) or {}
                logger.debug(f"Loaded unified index with {len(self.unified_index)} entries")
            else:
                logger.warning("Unified index file not found, using empty index")
                self.unified_index = {}
        except Exception as e:
            logger.error(f"Failed to load unified index: {e}")
            self.unified_index = {}
        self.file_metadata = {}
        self.reverse_index = {}
        
        # Track index file modification times for auto-reload
        self.index_mtimes = {}
          # Initialize Enhanced IDS system
        if HAS_IDS:
            try:
                self.enhanced_ids = EnhancedIDS()
                logger.info("Enhanced IDS system initialized successfully")
            except Exception as e:
                logger.error(f"Failed to initialize Enhanced IDS: {e}")
                logger.debug(f"Full traceback: {traceback.format_exc()}")
                self.enhanced_ids = None
        
        # Load indices directly if IDS system not available
        self.load_indices()
        
        logger.info(f"IDS MCP Server v{self.version} initialized")
    
    def load_indices(self):
        """Load unified tag index and metadata."""
        try:
            # Load unified tags index
            unified_index_path = DOCS_ROOT / "unified_tags_index.yaml"
            if unified_index_path.exists():
                with open(unified_index_path, 'r', encoding='utf-8') as f:
                    self.unified_index = yaml.safe_load(f) or {}
                logger.info(f"Loaded unified index with {len(self.unified_index)} entries")
            
            # Load file metadata
            metadata_path = DOCS_ROOT / "file_metadata.yaml"
            if metadata_path.exists():
                with open(metadata_path, 'r', encoding='utf-8') as f:
                    self.file_metadata = yaml.safe_load(f) or {}
                logger.info(f"Loaded file metadata for {len(self.file_metadata)} files")
            
            # Load reverse tag index
            reverse_index_path = DOCS_ROOT / "reverse_tag_index.yaml"
            if reverse_index_path.exists():
                with open(reverse_index_path, 'r', encoding='utf-8') as f:
                    self.reverse_index = yaml.safe_load(f) or {}
                logger.info(f"Loaded reverse index with {len(self.reverse_index)} tags")
                    
        except Exception as e:
            logger.error(f"Failed to load indices: {e}")
    
    def check_for_index_updates(self):
        """Check if index files have been updated and reload if necessary."""
        index_files = [
            DOCS_ROOT / "unified_tags_index.yaml",
            DOCS_ROOT / "file_metadata.yaml", 
            DOCS_ROOT / "reverse_tag_index.yaml"
        ]
        
        reload_needed = False
        for index_file in index_files:
            if index_file.exists():
                current_mtime = index_file.stat().st_mtime
                old_mtime = self.index_mtimes.get(str(index_file))
                
                if old_mtime is None or current_mtime > old_mtime:
                    reload_needed = True
                    self.index_mtimes[str(index_file)] = current_mtime
        
        if reload_needed:
            logger.info("Index files updated, reloading...")
            self.load_indices()
            if self.enhanced_ids:
                self.enhanced_ids.load_indices()
            return True
        
        return False
    
    async def handle_list_tools(self) -> Dict[str, Any]:
        """Return list of available tools."""
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
                },                {
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
        """Handle tool calls with enhanced debugging and error handling."""
        self.request_count += 1
        call_start_time = time.time()
        
        logger.debug(f"Tool call #{self.request_count}: {name} with args: {arguments}")
        
        try:
            # Execute tool with timeout - map hyphenated names to method names
            if name == "search":
                result = await asyncio.wait_for(self.ids_search(arguments), timeout=self.timeout)
            elif name == "get-file-info":
                result = await asyncio.wait_for(self.ids_get_file_info(arguments), timeout=self.timeout)
            elif name == "list-tags":
                result = await asyncio.wait_for(self.ids_list_tags(arguments), timeout=self.timeout)
            elif name == "get-system-status":
                result = await asyncio.wait_for(self.ids_get_system_status(arguments), timeout=self.timeout)
            elif name == "find-by-tag":
                result = await asyncio.wait_for(self.ids_find_by_tag(arguments), timeout=self.timeout)
            elif name == "bookmark-management":
                result = await asyncio.wait_for(self.ids_bookmark_management(arguments), timeout=self.timeout)
            elif name == "rebuild-index":
                result = await asyncio.wait_for(self.ids_rebuild_index(arguments), timeout=self.timeout)
            elif name == "get-documentation-stats":
                result = await asyncio.wait_for(self.ids_get_documentation_stats(arguments), timeout=self.timeout)
            elif name == "validate-index":
                result = await asyncio.wait_for(self.ids_validate_index(arguments), timeout=self.timeout)
            elif name == "export-data":
                result = await asyncio.wait_for(self.ids_export_data(arguments), timeout=self.timeout)
            elif name == "import-data":
                result = await asyncio.wait_for(self.ids_import_data(arguments), timeout=self.timeout)
            elif name == "get-recent-changes":
                result = await asyncio.wait_for(self.ids_get_recent_changes(arguments), timeout=self.timeout)
            elif name == "search-content":
                result = await asyncio.wait_for(self.ids_search_content(arguments), timeout=self.timeout)
            elif name == "manage-tags":
                result = await asyncio.wait_for(self.ids_manage_tags(arguments), timeout=self.timeout)
            elif name == "analyze-documentation":
                result = await asyncio.wait_for(self.ids_analyze_documentation(arguments), timeout=self.timeout)
            elif name == "backup-system":
                result = await asyncio.wait_for(self.ids_backup_system(arguments), timeout=self.timeout)
            elif name == "restore-system":
                result = await asyncio.wait_for(self.ids_restore_system(arguments), timeout=self.timeout)
            else:
                logger.warning(f"Unknown tool requested: {name}")
                return {
                    "content": [{"type": "text", "text": f"Error: Unknown tool '{name}'"}],
                    "isError": True
                }
            
            call_time = time.time() - call_start_time
            logger.debug(f"Tool call #{self.request_count} ({name}) completed in {call_time:.3f}s")
            
            return result
            
        except asyncio.TimeoutError:
            call_time = time.time() - call_start_time
            logger.error(f"Tool call #{self.request_count} ({name}) timed out after {call_time:.1f}s")
            return {
                "content": [{"type": "text", "text": f"Error: Tool '{name}' timed out after {self.timeout}s"}],
                "isError": True
            }
            
        except Exception as e:
            call_time = time.time() - call_start_time
            logger.error(f"Tool call #{self.request_count} ({name}) failed after {call_time:.3f}s: {e}")
            logger.debug(f"Tool call error traceback: {traceback.format_exc()}")
            return {
                "content": [{"type": "text", "text": f"Error executing tool '{name}': {str(e)}"}],
                "isError": True
            }

    async def ids_search(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Search through IDS documentation."""
        # Check for index updates before searching
        self.check_for_index_updates()
        
        query = arguments.get("query", "")
        tags = arguments.get("tags", [])
        max_results = arguments.get("max_results", 10)
        
        if not query:
            return {
                "content": [{"type": "text", "text": "Query parameter is required"}],
                "isError": True
            }
        
        # Try enhanced IDS search first
        if self.enhanced_ids:
            try:
                search_results = self.enhanced_ids.unified_search(query)
                if search_results:
                    formatted_results = []
                    for file_path, matching_tags in search_results[:max_results]:
                        formatted_results.append(f"**{file_path}**")
                        formatted_results.append(f"Matching tags: {', '.join(matching_tags)}")
                        # Get metadata if available
                        metadata = self.file_metadata.get(file_path, {})
                        if metadata.get('description'):
                            formatted_results.append(f"Description: {metadata['description']}")
                        formatted_results.append("")  # Empty line
                    
                    return {
                        "content": [{
                            "type": "text",
                            "text": f"Found {len(search_results)} results for '{query}':\n\n" + 
                                   "\n".join(formatted_results)
                        }]
                    }
                else:
                    return {
                        "content": [{
                            "type": "text",
                            "text": f"No results found for query: '{query}'"
                        }]
                    }
            except Exception as e:
                logger.error(f"Enhanced IDS search failed: {e}")
                # Fall back to manual search
        
        # Fallback manual search through unified index
        results = []
        query_lower = query.lower()
        
        for file_path, file_tags in self.unified_index.items():
            score = 0
            
            # Basic tag matching
            matching_tags = []
            for tag in file_tags:
                if query_lower in tag.lower():
                    score += 10
                    matching_tags.append(tag)
            
            # Filter by specific tags if provided
            if tags:
                for required_tag in tags:
                    if required_tag in file_tags:
                        score += 5
            
            if score > 0:
                results.append({
                    "file_path": file_path,
                    "score": score,
                    "matching_tags": matching_tags,
                    "metadata": self.file_metadata.get(file_path, {})
                })
        
        # Sort by score and limit results
        results.sort(key=lambda x: x["score"], reverse=True)
        results = results[:max_results]
        
        # Format results
        if results:
            result_text = f"Found {len(results)} results for query: '{query}'\n\n"
            for i, result in enumerate(results, 1):
                metadata = result["metadata"]
                result_text += f"{i}. **{result['file_path']}** (Score: {result['score']})\n"
                if metadata.get('description'):
                    result_text += f"   Description: {metadata['description']}\n"
                if result["matching_tags"]:
                    result_text += f"   Matching tags: {', '.join(result['matching_tags'][:5])}\n"
                if metadata.get('last_modified'):
                    result_text += f"   Last Modified: {metadata['last_modified']}\n"
                result_text += "\n"
        else:
            result_text = f"No results found for query: '{query}'"
        
        return {
            "content": [{
                "type": "text",
                "text": result_text
            }]
        }

    async def ids_get_file_info(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Get detailed information about a specific file."""
        # Check for index updates before accessing file info
        self.check_for_index_updates()
        
        file_path = arguments.get("file_path", "")
        
        if not file_path:
            return {
                "content": [{"type": "text", "text": "file_path parameter is required"}],
                "isError": True
            }
        
        # Check if file exists in our indices
        file_tags = self.unified_index.get(file_path)
        metadata = self.file_metadata.get(file_path, {})
        
        if not file_tags and not metadata:
            return {
                "content": [{"type": "text", "text": f"File not found in IDS: {file_path}"}],
                "isError": True
            }
        
        # Build file information
        info_text = f"# File Information: {file_path}\n\n"
        
        if metadata:
            info_text += "## Metadata\n"
            for key, value in metadata.items():
                info_text += f"- **{key.title()}**: {value}\n"
            info_text += "\n"        if file_tags:
            info_text += "## Tags\n"
            for tag in file_tags:
                info_text += f"- {tag}\n"
            info_text += "\n"
        
        return {
            "content": [{
                "type": "text",
                "text": info_text
            }]
        }

    async def ids_list_tags(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """List all available tags in the IDS system."""
        category = arguments.get("category", "")
        pattern = arguments.get("pattern", "")
        
        # Fast collection from reverse index (already loaded)
        if self.reverse_index:
            all_tags = list(self.reverse_index.keys())
        else:
            # Fallback to unified index
            all_tags = list(set(tag for file_tags in self.unified_index.values() for tag in file_tags))
        
        # Apply filters if specified
        if category:
            all_tags = [tag for tag in all_tags if category.lower() in tag.lower()]
        
        if pattern:
            all_tags = [tag for tag in all_tags if pattern.lower() in tag.lower()]
        
        # Sort and limit for performance
        all_tags.sort()
        
        # Limit to first 100 tags for display performance
        display_tags = all_tags[:100]
        
        # Build simple response
        result_text = f"Found {len(all_tags)} tags"
        if category:
            result_text += f" (category: {category})"
        if pattern:
            result_text += f" (pattern: {pattern})"
        
        if len(all_tags) > 100:
            result_text += f"\nShowing first 100 of {len(all_tags)} tags:"
        
        result_text += "\n\n"
          # Simple list format for speed
        for i, tag in enumerate(display_tags, 1):
            result_text += f"{i:3d}. {tag}\n"
        
        return {
            "content": [{
                "type": "text",
                "text": result_text
            }]
        }

    async def ids_get_system_status(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Get current status and statistics of the IDS system."""
        # Check for index updates before getting status
        self.check_for_index_updates()
        
        status_text = "# ImpressionCore IDS System Status\n\n"
        
        # Basic statistics
        status_text += "## Statistics\n"
        status_text += f"- **Total Files Indexed**: {len(self.unified_index)}\n"
        status_text += f"- **File Metadata Entries**: {len(self.file_metadata)}\n"
        status_text += f"- **Total Tags**: {len(self.reverse_index)}\n"
        
        # Count total tag usage
        total_tag_usage = sum(len(files) for files in self.reverse_index.values())
        status_text += f"- **Total Tag Usage**: {total_tag_usage}\n"
        status_text += f"- **Average Tags per File**: {total_tag_usage / len(self.unified_index) if self.unified_index else 0:.1f}\n"
        
        # System health
        status_text += "\n## System Health\n"
        status_text += f"- **Enhanced IDS Available**: {'Yes' if self.enhanced_ids else 'No'}\n"
        status_text += f"- **Rich Formatting Available**: {'Yes' if HAS_RICH else 'No'}\n"
        status_text += f"- **Server Version**: {self.version}\n"
        status_text += f"- **Timestamp**: {datetime.now().isoformat()}\n"
        
        # Top tags by usage
        if self.reverse_index:
            status_text += "\n## Top Tags by Usage\n"
            sorted_tags = sorted(self.reverse_index.items(), key=lambda x: len(x[1]), reverse=True)
            for tag, files in sorted_tags[:10]:
                status_text += f"- **{tag}**: {len(files)} files\n"
          # Index file locations
        status_text += "\n## Index File Locations\n"
        status_text += f"- **Docs Root**: {DOCS_ROOT}\n"
        status_text += f"- **Project Root**: {PROJECT_ROOT}\n"
        status_text += f"- **Unified Index**: {DOCS_ROOT / 'unified_tags_index.yaml'}\n"
        status_text += f"- **File Metadata**: {DOCS_ROOT / 'file_metadata.yaml'}\n"
        status_text += f"- **Reverse Index**: {DOCS_ROOT / 'reverse_tag_index.yaml'}\n"
        
        return {
            "content": [{
                "type": "text",
                "text": status_text
            }]
        }

    async def ids_find_by_tag(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Find all files associated with specific tags."""
        # Check for index updates before finding by tag
        self.check_for_index_updates()
        
        tags = arguments.get("tags", [])
        match_all = arguments.get("match_all", False)
        
        if not tags:
            return {
                "content": [{"type": "text", "text": "tags parameter is required"}],
                "isError": True
            }
        
        # Find files using reverse index
        matching_files = set()
        
        if match_all:
            # AND logic - files must have ALL specified tags
            for i, tag in enumerate(tags):
                tag_files = set(self.reverse_index.get(tag, []))
                if i == 0:
                    matching_files = tag_files
                else:
                    matching_files = matching_files.intersection(tag_files)
        else:
            # OR logic - files can have ANY of the specified tags
            for tag in tags:
                tag_files = self.reverse_index.get(tag, [])
                matching_files.update(tag_files)
        
        # Convert to list and sort
        matching_files = sorted(list(matching_files))
        
        # Build response
        if matching_files:
            result_text = f"Found {len(matching_files)} files with tags: {', '.join(tags)}"
            if match_all:
                result_text += " (ALL tags required)\n\n"
            else:
                result_text += " (ANY tag matches)\n\n"
            
            for i, file_path in enumerate(matching_files, 1):
                result_text += f"{i}. **{file_path}**\n"
                
                # Add file metadata if available
                metadata = self.file_metadata.get(file_path, {})
                if metadata.get('description'):
                    result_text += f"   Description: {metadata['description']}\n"
                  # Add file tags
                file_tags = self.unified_index.get(file_path, [])
                if file_tags:
                    # Highlight matching tags
                    highlighted_tags = []
                    for tag in file_tags[:10]:  # Limit to first 10 tags
                        if tag in tags:
                            highlighted_tags.append(f"**{tag}**")
                        else:
                            highlighted_tags.append(tag)
                    result_text += f"   Tags: {', '.join(highlighted_tags)}\n"
                
                if metadata.get('last_modified'):
                    result_text += f"   Last Modified: {metadata['last_modified']}\n"
                result_text += "\n"
        else:
            result_text = f"No files found with tags: {', '.join(tags)}"
            if match_all:
                result_text += " (ALL tags required)"
            else:
                result_text += " (ANY tag matches)"
        
        return {
            "content": [{
                "type": "text",
                "text": result_text
            }]
        }

    async def ids_search_content(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Search for content within documentation files."""
        query = arguments.get("query", "").strip()
        max_results = arguments.get("max_results", 20)
        
        if not query:
            return {
                "content": [{"type": "text", "text": "Error: Query parameter is required"}],
                "isError": True
            }
        
        # Search within file content using Enhanced IDS if available
        if self.enhanced_ids:
            try:
                results = self.enhanced_ids.search_content(query, max_results=max_results)
                if results:
                    result_text = f"Found {len(results)} content matches for '{query}':\n\n"
                    for i, result in enumerate(results, 1):
                        result_text += f"{i}. **{result.get('file', 'Unknown')}**\n"
                        result_text += f"   Content: {result.get('content', 'No content')[:200]}...\n"
                        result_text += f"   Score: {result.get('score', 0):.2f}\n\n"
                else:
                    result_text = f"No content matches found for '{query}'"
            except Exception as e:
                result_text = f"Error searching content: {str(e)}"
        else:
            result_text = f"Content search not available - Enhanced IDS system not loaded"
        
        return {
            "content": [{
                "type": "text",
                "text": result_text
            }]
        }

    async def ids_manage_tags(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Manage tags for files (add, remove, modify)."""
        operation = arguments.get("operation", "list")  # list, add, remove, modify
        file_path = arguments.get("file_path", "")
        tags = arguments.get("tags", [])
        
        if operation == "list":
            # List all tags in the system
            all_tags = set()
            for file_tags in self.unified_index.values():
                all_tags.update(file_tags)
            
            sorted_tags = sorted(list(all_tags))
            result_text = f"Found {len(sorted_tags)} total tags in the system:\n\n"
            result_text += "\n".join(f"• {tag}" for tag in sorted_tags[:100])
            
            if len(sorted_tags) > 100:
                result_text += f"\n\n... and {len(sorted_tags) - 100} more tags"
                
        elif operation == "add":
            if not file_path or not tags:
                return {
                    "content": [{"type": "text", "text": "Error: file_path and tags are required for add operation"}],
                    "isError": True
                }
            
            # Add tags to file (simulation - would need actual file modification)
            current_tags = self.unified_index.get(file_path, [])
            new_tags = list(set(current_tags + tags))
            result_text = f"Would add tags {tags} to {file_path}\n"
            result_text += f"Current tags: {current_tags}\n"
            result_text += f"New tag list: {new_tags}\n\n"
            result_text += "Note: This is a simulation. Actual tag modification requires file system write access."
            
        elif operation == "remove":
            if not file_path or not tags:
                return {
                    "content": [{"type": "text", "text": "Error: file_path and tags are required for remove operation"}],
                    "isError": True
                }
            
            # Remove tags from file (simulation)
            current_tags = self.unified_index.get(file_path, [])
            new_tags = [tag for tag in current_tags if tag not in tags]
            result_text = f"Would remove tags {tags} from {file_path}\n"
            result_text += f"Current tags: {current_tags}\n"
            result_text += f"New tag list: {new_tags}\n\n"
            result_text += "Note: This is a simulation. Actual tag modification requires file system write access."
            
        else:
            result_text = f"Unknown operation: {operation}. Supported operations: list, add, remove"
        
        return {
            "content": [{
                "type": "text",
                "text": result_text
            }]
        }

    async def ids_get_documentation_stats(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Get comprehensive statistics about the documentation system."""
        stats = {
            "files": len(self.unified_index),
            "total_tags": len(set(tag for tags in self.unified_index.values() for tag in tags)),
            "avg_tags_per_file": 0,
            "most_common_tags": [],
            "file_types": {},
            "recent_files": []
        }
        
        if stats["files"] > 0:
            total_file_tags = sum(len(tags) for tags in self.unified_index.values())
            stats["avg_tags_per_file"] = round(total_file_tags / stats["files"], 2)
        
        # Count tag occurrences
        tag_counts = {}
        for tags in self.unified_index.values():
            for tag in tags:
                tag_counts[tag] = tag_counts.get(tag, 0) + 1
        
        # Get most common tags
        stats["most_common_tags"] = sorted(tag_counts.items(), key=lambda x: x[1], reverse=True)[:10]
        
        # Count file types
        for file_path in self.unified_index.keys():
            ext = Path(file_path).suffix.lower() or "no_extension"
            stats["file_types"][ext] = stats["file_types"].get(ext, 0) + 1
        
        # Recent files (if metadata available)
        if self.file_metadata:
            recent_files = []
            for file_path, metadata in self.file_metadata.items():
                if metadata.get('last_modified'):
                    recent_files.append((file_path, metadata['last_modified']))
            
            recent_files.sort(key=lambda x: x[1], reverse=True)
            stats["recent_files"] = recent_files[:10]
        
        # Format results
        result_text = "📊 **Documentation System Statistics**\n\n"
        result_text += f"**Files**: {stats['files']:,}\n"
        result_text += f"**Total Tags**: {stats['total_tags']:,}\n"
        result_text += f"**Average Tags per File**: {stats['avg_tags_per_file']}\n\n"
        
        result_text += "**Most Common Tags**:\n"
        for tag, count in stats["most_common_tags"]:
            result_text += f"• {tag}: {count} files\n"
        
        result_text += "\n**File Types**:\n"
        for ext, count in sorted(stats["file_types"].items(), key=lambda x: x[1], reverse=True):
            result_text += f"• {ext}: {count} files\n"
        
        if stats["recent_files"]:
            result_text += "\n**Recently Modified Files**:\n"
            for file_path, modified in stats["recent_files"]:
                result_text += f"• {file_path} ({modified})\n"
        
        return {
            "content": [{
                "type": "text",
                "text": result_text
            }]
        }

    async def ids_get_recent_changes(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Get recently changed files and their modifications."""
        days = arguments.get("days", 7)
        max_results = arguments.get("max_results", 20)
        
        if not self.file_metadata:
            return {
                "content": [{
                    "type": "text",
                    "text": "No file metadata available for tracking recent changes"
                }]
            }
        
        from datetime import datetime, timedelta
        
        try:
            cutoff_date = datetime.now() - timedelta(days=days)
            recent_files = []
            
            for file_path, metadata in self.file_metadata.items():
                if metadata.get('last_modified'):
                    try:
                        # Parse the modification date
                        mod_date = datetime.fromisoformat(metadata['last_modified'].replace('Z', '+00:00'))
                        if mod_date >= cutoff_date:
                            recent_files.append((file_path, metadata))
                    except (ValueError, TypeError):
                        continue
            
            # Sort by modification date (newest first)
            recent_files.sort(key=lambda x: x[1].get('last_modified', ''), reverse=True)
            recent_files = recent_files[:max_results]
            
            if recent_files:
                result_text = f"📅 **Recent Changes (Last {days} days)**\n\n"
                result_text += f"Found {len(recent_files)} recently modified files:\n\n"
                
                for i, (file_path, metadata) in enumerate(recent_files, 1):
                    result_text += f"{i}. **{file_path}**\n"
                    result_text += f"   Modified: {metadata.get('last_modified', 'Unknown')}\n"
                    if metadata.get('description'):
                        result_text += f"   Description: {metadata['description']}\n"
                    
                    # Add tags if available
                    tags = self.unified_index.get(file_path, [])
                    if tags:
                        result_text += f"   Tags: {', '.join(tags[:5])}\n"
                    result_text += "\n"
            else:
                result_text = f"No files modified in the last {days} days"
                
        except Exception as e:
            result_text = f"Error retrieving recent changes: {str(e)}"
        
        return {
            "content": [{
                "type": "text",
                "text": result_text
            }]
        }

    async def ids_analyze_documentation(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Analyze documentation for gaps, patterns, and recommendations."""
        analysis_type = arguments.get("type", "overview")  # overview, gaps, patterns, recommendations
        
        analysis_results = {
            "total_files": len(self.unified_index),
            "total_tags": len(set(tag for tags in self.unified_index.values() for tag in tags)),
            "coverage": {},
            "gaps": [],
            "recommendations": []
        }
        
        # Analyze tag coverage by category
        categories = {}
        for file_path, tags in self.unified_index.items():
            for tag in tags:
                category = tag.split('-')[0] if '-' in tag else 'general'
                if category not in categories:
                    categories[category] = set()
                categories[category].add(file_path)
        
        analysis_results["coverage"] = {cat: len(files) for cat, files in categories.items()}
        
        # Identify potential gaps
        if "architecture" not in categories or len(categories.get("architecture", [])) < 5:
            analysis_results["gaps"].append("Limited architecture documentation")
        
        if "tutorial" not in categories or len(categories.get("tutorial", [])) < 3:
            analysis_results["gaps"].append("Few tutorial documents")
        
        if "api" not in categories or len(categories.get("api", [])) < 5:
            analysis_results["gaps"].append("Limited API documentation")
        
        # Generate recommendations
        if analysis_results["gaps"]:
            analysis_results["recommendations"].append("Add more documentation in identified gap areas")
        
        if len(categories) < 5:
            analysis_results["recommendations"].append("Expand documentation categories for better organization")
        
        # Files with very few tags might need better categorization
        poorly_tagged = [f for f, tags in self.unified_index.items() if len(tags) < 2]
        if len(poorly_tagged) > len(self.unified_index) * 0.2:
            analysis_results["recommendations"].append("Improve tagging for better discoverability")
        
        # Format results
        if analysis_type == "overview":
            result_text = "📋 **Documentation Analysis Overview**\n\n"
            result_text += f"**Total Files**: {analysis_results['total_files']:,}\n"
            result_text += f"**Total Tags**: {analysis_results['total_tags']:,}\n\n"
            
            result_text += "**Coverage by Category**:\n"
            for category, count in sorted(analysis_results["coverage"].items(), key=lambda x: x[1], reverse=True):
                result_text += f"• {category}: {count} files\n"
            
        elif analysis_type == "gaps":
            result_text = "🔍 **Documentation Gaps Analysis**\n\n"
            if analysis_results["gaps"]:
                result_text += "**Identified Gaps**:\n"
                for gap in analysis_results["gaps"]:
                    result_text += f"• {gap}\n"
            else:
                result_text += "No major documentation gaps identified"
                
        elif analysis_type == "recommendations":
            result_text = "💡 **Documentation Recommendations**\n\n"
            if analysis_results["recommendations"]:
                for i, rec in enumerate(analysis_results["recommendations"], 1):
                    result_text += f"{i}. {rec}\n"
            else:
                result_text += "No specific recommendations at this time"
                
        else:
            result_text = f"Unknown analysis type: {analysis_type}. Available types: overview, gaps, patterns, recommendations"
        
        return {
            "content": [{
                "type": "text",
                "text": result_text
            }]
        }

    async def ids_bookmark_management(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Manage bookmarks for important documentation."""
        operation = arguments.get("operation", "list")  # list, add, remove, search
        file_path = arguments.get("file_path", "")
        bookmark_name = arguments.get("name", "")
        
        # Load bookmarks (simulated)
        bookmarks_file = DOCS_ROOT / "bookmarks.yaml"
        bookmarks = {}
        
        try:
            if bookmarks_file.exists():
                with open(bookmarks_file, 'r', encoding='utf-8') as f:
                    bookmarks = yaml.safe_load(f) or {}
        except Exception:
            pass
        
        if operation == "list":
            if bookmarks:
                result_text = f"📑 **Bookmarks** ({len(bookmarks)} total)\n\n"
                for name, info in bookmarks.items():
                    result_text += f"**{name}**\n"
                    result_text += f"  File: {info.get('file_path', 'Unknown')}\n"
                    result_text += f"  Added: {info.get('added', 'Unknown')}\n"
                    if info.get('description'):
                        result_text += f"  Description: {info['description']}\n"
                    result_text += "\n"
            else:
                result_text = "No bookmarks found"
                
        elif operation == "add":
            if not file_path or not bookmark_name:
                return {
                    "content": [{"type": "text", "text": "Error: file_path and name are required for add operation"}],
                    "isError": True
                }
            
            description = arguments.get("description", "")
            from datetime import datetime
            
            bookmark_info = {
                "file_path": file_path,
                "added": datetime.now().isoformat(),
                "description": description
            }
            
            result_text = f"Would add bookmark '{bookmark_name}' for {file_path}\n"
            result_text += f"Description: {description}\n\n"
            result_text += "Note: This is a simulation. Actual bookmark saving requires file system write access."
            
        elif operation == "remove":
            if not bookmark_name:
                return {
                    "content": [{"type": "text", "text": "Error: name is required for remove operation"}],
                    "isError": True
                }
            
            if bookmark_name in bookmarks:
                result_text = f"Would remove bookmark '{bookmark_name}'\n"
                result_text += f"Current target: {bookmarks[bookmark_name].get('file_path', 'Unknown')}\n\n"
                result_text += "Note: This is a simulation. Actual bookmark removal requires file system write access."
            else:
                result_text = f"Bookmark '{bookmark_name}' not found"
                
        elif operation == "search":
            query = arguments.get("query", "").lower()
            if not query:
                return {
                    "content": [{"type": "text", "text": "Error: query is required for search operation"}],
                    "isError": True
                }
            
            matching_bookmarks = {}
            for name, info in bookmarks.items():
                if (query in name.lower() or 
                    query in info.get('file_path', '').lower() or 
                    query in info.get('description', '').lower()):
                    matching_bookmarks[name] = info
            
            if matching_bookmarks:
                result_text = f"Found {len(matching_bookmarks)} bookmarks matching '{query}':\n\n"
                for name, info in matching_bookmarks.items():
                    result_text += f"**{name}**\n"
                    result_text += f"  File: {info.get('file_path', 'Unknown')}\n"
                    if info.get('description'):
                        result_text += f"  Description: {info['description']}\n"
                    result_text += "\n"
            else:
                result_text = f"No bookmarks found matching '{query}'"
        else:
            result_text = f"Unknown operation: {operation}. Supported operations: list, add, remove, search"
        
        return {
            "content": [{
                "type": "text",
                "text": result_text
            }]
        }

    async def ids_export_data(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Export IDS data in various formats."""
        format_type = arguments.get("format", "json")  # json, yaml, csv
        include_metadata = arguments.get("include_metadata", True)
        
        export_data = {
            "export_timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "version": self.version,
            "unified_index": dict(self.unified_index)
        }
        
        if include_metadata and self.file_metadata:
            export_data["file_metadata"] = dict(self.file_metadata)
        
        try:
            from datetime import datetime
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            
            if format_type == "json":
                filename = f"ids_export_{timestamp}.json"
                export_content = json.dumps(export_data, indent=2, ensure_ascii=False)
                
            elif format_type == "yaml":
                filename = f"ids_export_{timestamp}.yaml"
                export_content = yaml.dump(export_data, default_flow_style=False, allow_unicode=True)
                
            elif format_type == "csv":
                filename = f"ids_export_{timestamp}.csv"
                # Convert to CSV format (flattened)
                csv_lines = ["file_path,tags,description,last_modified"]
                for file_path, tags in self.unified_index.items():
                    metadata = self.file_metadata.get(file_path, {})
                    description = metadata.get('description', '').replace(',', ';')
                    last_modified = metadata.get('last_modified', '')
                    tags_str = ';'.join(tags)
                    csv_lines.append(f'"{file_path}","{tags_str}","{description}","{last_modified}"')
                export_content = '\n'.join(csv_lines)
                
            else:
                return {
                    "content": [{"type": "text", "text": f"Error: Unsupported format '{format_type}'. Supported formats: json, yaml, csv"}],
                    "isError": True
                }
            
            # Simulate file saving
            result_text = f"📤 **Export Completed**\n\n"
            result_text += f"**Format**: {format_type.upper()}\n"
            result_text += f"**Filename**: {filename}\n"
            result_text += f"**Files**: {len(self.unified_index):,}\n"
            result_text += f"**Size**: {len(export_content):,} characters\n\n"
            result_text += f"**Export Preview** (first 500 characters):\n"
            result_text += f"```{format_type}\n{export_content[:500]}...\n```\n\n"
            result_text += "Note: This is a simulation. Actual file saving requires file system write access."
            
        except Exception as e:
            result_text = f"Error during export: {str(e)}"
        
        return {
            "content": [{
                "type": "text",
                "text": result_text
            }]
        }

    async def ids_import_data(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Import IDS data from various formats."""
        source = arguments.get("source", "")  # file path or direct data
        format_type = arguments.get("format", "json")  # json, yaml, csv
        merge_mode = arguments.get("merge", True)  # True = merge, False = replace
        
        if not source:
            return {
                "content": [{"type": "text", "text": "Error: source parameter is required"}],
                "isError": True
            }
        
        try:
            # Simulate import process
            result_text = f"📥 **Import Simulation**\n\n"
            result_text += f"**Source**: {source}\n"
            result_text += f"**Format**: {format_type.upper()}\n"
            result_text += f"**Mode**: {'Merge' if merge_mode else 'Replace'}\n\n"
            
            # Check if file exists
            source_path = Path(source)
            if source_path.exists():
                try:
                    with open(source_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                    
                    if format_type == "json":
                        imported_data = json.loads(content)
                    elif format_type == "yaml":
                        imported_data = yaml.safe_load(content)
                    else:
                        result_text += "CSV import not implemented in simulation"
                        return {
                            "content": [{
                                "type": "text",
                                "text": result_text
                            }]
                        }
                    
                    # Analyze imported data
                    imported_files = len(imported_data.get('unified_index', {}))
                    imported_metadata = len(imported_data.get('file_metadata', {}))
                    
                    result_text += f"**Analysis**:\n"
                    result_text += f"• Files to import: {imported_files:,}\n"
                    result_text += f"• Metadata entries: {imported_metadata:,}\n"
                    result_text += f"• Current files: {len(self.unified_index):,}\n\n"
                    
                    if merge_mode:
                        result_text += "Would merge imported data with existing data\n"
                        result_text += f"Estimated final file count: {len(self.unified_index) + imported_files:,}\n"
                    else:
                        result_text += "Would replace existing data with imported data\n"
                        result_text += f"Final file count: {imported_files:,}\n"
                    
                    result_text += "\nNote: This is a simulation. Actual import requires file system write access."
                    
                except Exception as e:
                    result_text += f"Error reading/parsing file: {str(e)}"
                    
            else:
                result_text += f"Source file not found: {source}"
                
        except Exception as e:
            result_text = f"Error during import simulation: {str(e)}"
        
        return {
            "content": [{
                "type": "text",
                "text": result_text
            }]
        }

    async def ids_backup_system(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Create a backup of the entire IDS system."""
        backup_name = arguments.get("name", "")
        include_files = arguments.get("include_files", False)
        
        from datetime import datetime
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        if not backup_name:
            backup_name = f"ids_backup_{timestamp}"
        
        # Simulate backup process
        backup_data = {
            "backup_info": {
                "name": backup_name,
                "timestamp": timestamp,
                "version": self.version,
                "include_files": include_files
            },
            "unified_index": dict(self.unified_index),
            "file_metadata": dict(self.file_metadata) if self.file_metadata else {},
            "reverse_index": dict(self.reverse_index) if hasattr(self, 'reverse_index') else {}
        }
        
        # Calculate backup size
        backup_json = json.dumps(backup_data, indent=2)
        backup_size = len(backup_json)
        
        result_text = f"💾 **Backup System Simulation**\n\n"
        result_text += f"**Backup Name**: {backup_name}\n"
        result_text += f"**Timestamp**: {timestamp}\n"
        result_text += f"**Include Files**: {'Yes' if include_files else 'No'}\n\n"
        
        result_text += f"**Backup Contents**:\n"
        result_text += f"• Unified Index: {len(backup_data['unified_index']):,} files\n"
        result_text += f"• File Metadata: {len(backup_data['file_metadata']):,} entries\n"
        result_text += f"• Reverse Index: {len(backup_data['reverse_index']):,} tags\n"
        result_text += f"• Estimated Size: {backup_size:,} bytes ({backup_size/1024:.1f} KB)\n\n"
        
        if include_files:
            result_text += "Would also backup actual file contents\n"
            result_text += "Estimated additional size: ~50-200 MB\n\n"
        
        result_text += f"Backup would be saved as: `{backup_name}.json`\n\n"
        result_text += "Note: This is a simulation. Actual backup requires file system write access."
        
        return {
            "content": [{
                "type": "text",
                "text": result_text
            }]
        }

    async def ids_restore_system(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Restore IDS system from a backup."""
        backup_source = arguments.get("source", "")
        restore_mode = arguments.get("mode", "full")  # full, index_only, metadata_only
        confirm = arguments.get("confirm", False)
        
        if not backup_source:
            return {
                "content": [{"type": "text", "text": "Error: source parameter is required"}],
                "isError": True
            }
        
        if not confirm:
            result_text = f"⚠️ **Restore System - Confirmation Required**\n\n"
            result_text += f"**Source**: {backup_source}\n"
            result_text += f"**Mode**: {restore_mode}\n\n"
            result_text += "**WARNING**: This operation will modify the current IDS system.\n\n"
            result_text += "**Current System**:\n"
            result_text += f"• Files: {len(self.unified_index):,}\n"
            result_text += f"• Tags: {len(set(tag for tags in self.unified_index.values() for tag in tags)):,}\n\n"
            result_text += "To proceed, call this tool again with `confirm: true`\n\n"
            result_text += "Note: This is a simulation. Actual restore requires file system write access."
            
            return {
                "content": [{
                    "type": "text",
                    "text": result_text
                }]
            }
        
        # Simulate restore process
        result_text = f"🔄 **Restore System Simulation**\n\n"
        result_text += f"**Source**: {backup_source}\n"
        result_text += f"**Mode**: {restore_mode}\n"
        result_text += f"**Confirmed**: Yes\n\n"
        
        # Check if backup file exists
        backup_path = Path(backup_source)
        if backup_path.exists():
            try:
                with open(backup_path, 'r', encoding='utf-8') as f:
                    backup_data = json.load(f)
                
                backup_info = backup_data.get('backup_info', {})
                result_text += f"**Backup Info**:\n"
                result_text += f"• Name: {backup_info.get('name', 'Unknown')}\n"
                result_text += f"• Created: {backup_info.get('timestamp', 'Unknown')}\n"
                result_text += f"• Version: {backup_info.get('version', 'Unknown')}\n\n"
                
                if restore_mode == "full":
                    result_text += "Would restore:\n"
                    result_text += f"• Unified Index ({len(backup_data.get('unified_index', {})):,} files)\n"
                    result_text += f"• File Metadata ({len(backup_data.get('file_metadata', {})):,} entries)\n"
                    result_text += f"• Reverse Index ({len(backup_data.get('reverse_index', {})):,} tags)\n"
                elif restore_mode == "index_only":
                    result_text += f"Would restore only Unified Index ({len(backup_data.get('unified_index', {})):,} files)\n"
                elif restore_mode == "metadata_only":
                    result_text += f"Would restore only File Metadata ({len(backup_data.get('file_metadata', {})):,} entries)\n"
                
                result_text += "\nRestore simulation completed successfully.\n"
                result_text += "Note: This is a simulation. Actual restore requires file system write access."
                
            except Exception as e:
                result_text += f"Error reading backup file: {str(e)}"
        else:
            result_text += f"Backup file not found: {backup_source}"
        
        return {
            "content": [{
                "type": "text",
                "text": result_text
            }]
        }

    async def ids_rebuild_index(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Rebuild the entire IDS index from scratch."""
        full_rebuild = arguments.get("full", False)
        confirm = arguments.get("confirm", False)
        
        if not confirm:
            result_text = f"⚠️ **Rebuild Index - Confirmation Required**\n\n"
            result_text += f"**Type**: {'Full rebuild' if full_rebuild else 'Standard rebuild'}\n\n"
            result_text += "**WARNING**: This operation will rebuild the entire index.\n\n"
            result_text += "**Current Index**:\n"
            result_text += f"• Files: {len(self.unified_index):,}\n"
            result_text += f"• Tags: {len(set(tag for tags in self.unified_index.values() for tag in tags)):,}\n\n"
            
            if full_rebuild:
                result_text += "Full rebuild will:\n"
                result_text += "• Scan all documentation files\n"
                result_text += "• Re-extract all tags\n"
                result_text += "• Rebuild all indices\n"
                result_text += "• Update all metadata\n\n"
            else:
                result_text += "Standard rebuild will:\n"
                result_text += "• Refresh existing indices\n"
                result_text += "• Update file modification times\n"
                result_text += "• Repair any corruption\n\n"
            
            result_text += "To proceed, call this tool again with `confirm: true`\n\n"
            result_text += "Note: This is a simulation. Actual rebuild requires file system write access."
            
            return {
                "content": [{
                    "type": "text",
                    "text": result_text
                }]
            }
        
        # Simulate rebuild process
        result_text = f"🔨 **Index Rebuild Simulation**\n\n"
        result_text += f"**Type**: {'Full rebuild' if full_rebuild else 'Standard rebuild'}\n"
        result_text += f"**Confirmed**: Yes\n\n"
        
        result_text += "**Rebuild Process**:\n"
        result_text += "✅ Starting index rebuild...\n"
        result_text += "✅ Scanning documentation directory...\n"
        result_text += f"✅ Found {len(self.unified_index):,} files to process\n"
        
        if full_rebuild:
            result_text += "✅ Re-extracting tags from files...\n"
            result_text += "✅ Rebuilding unified index...\n"
            result_text += "✅ Regenerating file metadata...\n"
            result_text += "✅ Creating reverse tag index...\n"
        else:
            result_text += "✅ Refreshing existing indices...\n"
            result_text += "✅ Updating modification times...\n"
            result_text += "✅ Validating data integrity...\n"
        
        result_text += "✅ Saving updated indices...\n"
        result_text += "✅ Index rebuild completed successfully!\n\n"
        
        result_text += "**Results**:\n"
        result_text += f"• Files processed: {len(self.unified_index):,}\n"
        result_text += f"• Total tags: {len(set(tag for tags in self.unified_index.values() for tag in tags)):,}\n"
        result_text += f"• Index integrity: ✅ Good\n\n"
        
        result_text += "Note: This is a simulation. Actual rebuild requires file system write access."
        
        return {
            "content": [{
                "type": "text",
                "text": result_text
            }]
        }

    async def ids_validate_index(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Validate the integrity of the IDS index system."""
        fix_issues = arguments.get("fix", False)
        detailed = arguments.get("detailed", False)
        
        validation_results = {
            "total_files": len(self.unified_index),
            "issues": [],
            "warnings": [],
            "statistics": {}
        }
        
        # Check for missing files
        missing_files = []
        for file_path in self.unified_index.keys():
            full_path = DOCS_ROOT / file_path
            if not full_path.exists():
                missing_files.append(file_path)
        
        if missing_files:
            validation_results["issues"].append(f"Missing files: {len(missing_files)} files not found on disk")
            if detailed:
                validation_results["issues"].extend([f"  • {f}" for f in missing_files[:10]])
                if len(missing_files) > 10:
                    validation_results["issues"].append(f"  • ... and {len(missing_files) - 10} more")
        
        # Check for orphaned metadata
        if self.file_metadata:
            orphaned_metadata = []
            for file_path in self.file_metadata.keys():
                if file_path not in self.unified_index:
                    orphaned_metadata.append(file_path)
            
            if orphaned_metadata:
                validation_results["warnings"].append(f"Orphaned metadata: {len(orphaned_metadata)} entries without index entries")
        
        # Check for duplicate tags
        tag_stats = {}
        for file_path, tags in self.unified_index.items():
            # Check for duplicate tags in same file
            if len(tags) != len(set(tags)):
                validation_results["issues"].append(f"Duplicate tags in {file_path}")
            
            # Count tag usage
            for tag in tags:
                tag_stats[tag] = tag_stats.get(tag, 0) + 1
        
        validation_results["statistics"]["unique_tags"] = len(tag_stats)
        validation_results["statistics"]["avg_tags_per_file"] = round(
            sum(len(tags) for tags in self.unified_index.values()) / len(self.unified_index), 2
        ) if self.unified_index else 0
        
        # Check for very common or very rare tags
        very_common = [tag for tag, count in tag_stats.items() if count > len(self.unified_index) * 0.8]
        very_rare = [tag for tag, count in tag_stats.items() if count == 1]
        
        if very_common:
            validation_results["warnings"].append(f"Very common tags: {len(very_common)} tags appear in >80% of files")
        
        if len(very_rare) > len(tag_stats) * 0.5:
            validation_results["warnings"].append(f"Many rare tags: {len(very_rare)} tags appear in only 1 file")
        
        # Format results
        result_text = f"🔍 **Index Validation Results**\n\n"
        result_text += f"**Files Analyzed**: {validation_results['total_files']:,}\n"
        result_text += f"**Unique Tags**: {validation_results['statistics'].get('unique_tags', 0):,}\n"
        result_text += f"**Avg Tags/File**: {validation_results['statistics'].get('avg_tags_per_file', 0)}\n\n"
        
        # Issues
        if validation_results["issues"]:
            result_text += f"❌ **Issues Found ({len(validation_results['issues'])})**:\n"
            for issue in validation_results["issues"]:
                result_text += f"• {issue}\n"
            result_text += "\n"
        else:
            result_text += "✅ **No Issues Found**\n\n"
        
        # Warnings
        if validation_results["warnings"]:
            result_text += f"⚠️ **Warnings ({len(validation_results['warnings'])})**:\n"
            for warning in validation_results["warnings"]:
                result_text += f"• {warning}\n"
            result_text += "\n"
        
        # Fix simulation
        if fix_issues and validation_results["issues"]:
            result_text += "**Fix Simulation**:\n"
            result_text += "✅ Would remove orphaned metadata entries\n"
            result_text += "✅ Would clean duplicate tags\n"
            result_text += "✅ Would update index files\n\n"
            result_text += "Note: This is a simulation. Actual fixes require file system write access."
        elif fix_issues:
            result_text += "✅ No issues to fix!"
        
        return {
            "content": [{
                "type": "text",
                "text": result_text
            }]
        }

# Global server instance
server = IDSMCPServer()

async def handle_message(message: Dict[str, Any]) -> Dict[str, Any]:
    """Handle incoming MCP messages."""
    method = message.get("method")
    message_id = message.get("id")
    params = message.get("params", {})
    
    try:
        if method == "initialize":
            return {
                "jsonrpc": "2.0",
                "id": message_id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {
                        "tools": {}
                    },
                    "serverInfo": {
                        "name": "ids-mcp-server",
                        "version": server.version
                    }
                }
            }
        
        elif method == "initialized":
            # Notification - no response needed
            logger.info("Client initialized")
            return None
        
        elif method == "tools/list":
            result = await server.handle_list_tools()
            return {
                "jsonrpc": "2.0",
                "id": message_id,
                "result": result
            }
        
        elif method == "tools/call":
            tool_name = params.get("name")
            arguments = params.get("arguments", {})
            result = await server.handle_call_tool(tool_name, arguments)
            return {
                "jsonrpc": "2.0",
                "id": message_id,
                "result": result
            }
        
        else:
            return {
                "jsonrpc": "2.0",
                "id": message_id,
                "error": {
                    "code": -32601,
                    "message": f"Method not found: {method}"
                }
            }
    
    except Exception as e:
        logger.error(f"Error handling message {method}: {e}")
        return {
            "jsonrpc": "2.0",
            "id": message_id,
            "error": {
                "code": -32603,
                "message": f"Internal error: {str(e)}"
            }
        }

async def run_server():
    """Run the MCP server with enhanced debugging and graceful shutdown."""
    logger.info("Starting IDS MCP Server with enhanced debugging...")
    logger.debug(f"Server PID: {os.getpid()}")
    logger.debug(f"Python version: {sys.version}")
    logger.debug(f"Working directory: {os.getcwd()}")
    
    server_start_time = time.time()
    request_count = 0
    
    try:
        logger.info("Server ready, waiting for requests...")
        
        while not shutdown_flag.is_set():
            try:
                # Read with timeout to allow checking shutdown flag
                try:
                    # Use asyncio to read with timeout
                    line = await asyncio.wait_for(
                        asyncio.get_event_loop().run_in_executor(None, sys.stdin.readline), 
                        timeout=1.0
                    )
                except asyncio.TimeoutError:
                    # No input received, check shutdown flag and continue
                    continue
                
                if not line:
                    logger.info("EOF received, shutting down gracefully")
                    break
                
                line = line.strip()
                if not line:
                    continue
                
                request_count += 1
                request_start_time = time.time()
                logger.debug(f"Processing request #{request_count}: {line[:100]}...")
                
                try:
                    message = json.loads(line)
                    method = message.get('method', 'unknown')
                    request_id = message.get('id', 'no-id')
                    
                    logger.debug(f"Request #{request_count}: method={method}, id={request_id}")
                    
                    # Process with timeout
                    response = await asyncio.wait_for(
                        handle_message(message), 
                        timeout=30.0  # 30 second timeout for requests
                    )
                    
                    if response:  # Some methods like 'initialized' return None
                        response_json = json.dumps(response)
                        print(response_json)
                        sys.stdout.flush()
                        
                        request_time = time.time() - request_start_time
                        logger.debug(f"Request #{request_count} completed in {request_time:.3f}s")
                    else:
                        logger.debug(f"Request #{request_count} returned no response (normal for some methods)")
                
                except asyncio.TimeoutError:
                    logger.error(f"Request #{request_count} timed out after 30 seconds")
                    error_response = {
                        "jsonrpc": "2.0",
                        "id": message.get('id') if 'message' in locals() else None,
                        "error": {
                            "code": -32603,
                            "message": "Request timeout"
                        }
                    }
                    print(json.dumps(error_response))
                    sys.stdout.flush()
                    
                except json.JSONDecodeError as e:
                    logger.error(f"Invalid JSON in request #{request_count}: {e}")
                    logger.debug(f"Invalid JSON content: {line}")
                    error_response = {
                        "jsonrpc": "2.0",
                        "id": None,
                        "error": {
                            "code": -32700,
                            "message": "Parse error"
                        }
                    }
                    print(json.dumps(error_response))
                    sys.stdout.flush()
                    
                except Exception as e:
                    logger.error(f"Error processing request #{request_count}: {e}")
                    logger.debug(f"Request processing error traceback: {traceback.format_exc()}")
                    error_response = {
                        "jsonrpc": "2.0",
                        "id": message.get('id') if 'message' in locals() else None,
                        "error": {
                            "code": -32603,
                            "message": f"Internal error: {str(e)}"
                        }
                    }
                    print(json.dumps(error_response))
                    sys.stdout.flush()
                    
            except KeyboardInterrupt:
                logger.info("Keyboard interrupt received, initiating shutdown...")
                shutdown_flag.set()
                break
                
            except Exception as e:
                logger.error(f"Unexpected error in server loop: {e}")
                logger.debug(f"Server loop error traceback: {traceback.format_exc()}")
                # Continue running unless it's a critical error
                await asyncio.sleep(0.1)
                
    except KeyboardInterrupt:
        logger.info("Server interrupted by user (Ctrl+C)")
    except Exception as e:
        logger.error(f"Fatal error in server: {e}")
        logger.debug(f"Fatal error traceback: {traceback.format_exc()}")
    finally:
        server_runtime = time.time() - server_start_time
        logger.info(f"MCP server shutting down gracefully")
        logger.info(f"Server runtime: {server_runtime:.2f}s, processed {request_count} requests")
        logger.debug("Cleanup completed, server stopped")

async def main():
    """Main entry point with enhanced error handling."""
    logger.info("=== IDS MCP Server Starting ===")
    logger.debug(f"Debug mode: {'ON' if logger.level == logging.DEBUG else 'OFF'}")
    
    try:
        await run_server()
    except KeyboardInterrupt:
        logger.info("Server stopped by user")
    except Exception as e:
        logger.error(f"Critical error in main: {e}")
        logger.debug(f"Main error traceback: {traceback.format_exc()}")
        sys.exit(1)
    finally:
        logger.info("=== IDS MCP Server Stopped ===")

if __name__ == "__main__":
    try:
        # Set debug mode if environment variable is set
        if os.getenv('IDS_DEBUG', '').lower() in ('1', 'true', 'yes'):
            logger.setLevel(logging.DEBUG)
            logger.debug("Debug mode enabled via environment variable")
        
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nServer interrupted by user")
        sys.exit(0)
    except Exception as e:
        print(f"Failed to start server: {e}")
        sys.exit(1)
