#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\servers\server_mcp_compliant.py #command_line #documentation #python #source_code  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\servers\server_mcp_compliant.py #command_line #documentation #python #source_code  
**Category:** Source Code  
**Status:** Active

"""
ImpressionCore Documentation System (IDS) MCP Server - Official MCP SDK Implementation
====================================================================================

Fully MCP-compliant SSE server using the official MCP Python SDK.
This server implements all 17 IDS tools while following the exact MCP protocol specification.

Features:
- Full MCP protocol compliance using official SDK
- SSE transport with proper message handling
- All 17 IDS tools available via MCP tool calls
- Proper error handling and timeout management
- Session management and connection handling

Author: ImpressionCore IDS Team
Created: 2025-01-08
Version: 4.0.0 (Official MCP SDK)
"""

import json
import sys
import os
import yaml
import asyncio
import logging
import traceback
from pathlib import Path
from typing import Dict, List, Optional, Any, Union, Sequence
from datetime import datetime, timedelta
import time

# Official MCP SDK imports
from mcp.server.sse import SseServerTransport
from mcp.server import Server
from mcp.types import (
    Tool, 
    TextContent, 
    CallToolRequest, 
    CallToolResult, 
    ListToolsRequest, 
    ListToolsResult
)
import mcp.server.stdio
import mcp.types

# Starlette imports for SSE server
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.routing import Mount, Route
import uvicorn
import click

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

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(CURRENT_DIR / 'ids_mcp_compliant.log')
    ]
)
logger = logging.getLogger("ids-mcp-compliant-server")

class ImpressionCoreIDSMCPServer:
    """MCP-compliant server for ImpressionCore Documentation System."""
    
    def __init__(self):
        self.version = "4.0.0"
        self.console = Console() if HAS_RICH else None
        self.enhanced_ids = None
        self.unified_index = {}
        self.file_metadata = {}
        self.reverse_index = {}
        self.bookmarks_db = {}
        
        # Track index file modification times for auto-reload
        self.index_mtimes = {}
        
        # Initialize Enhanced IDS system
        if HAS_IDS:
            try:
                self.enhanced_ids = EnhancedIDS()
                logger.info("Enhanced IDS system initialized successfully")
            except Exception as e:
                logger.error(f"Failed to initialize Enhanced IDS: {e}")
                self.enhanced_ids = None
        
        # Load indices and initialize bookmark system
        self.load_indices()
        self.load_bookmarks()
        
        # Create MCP server
        self.server = Server("impressioncore-ids")
        self.setup_tools()
        
        logger.info("MCP-compliant IDS Server initialized with 17 tools")
    
    def load_indices(self):
        """Load all IDS index files."""
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
    
    def load_bookmarks(self):
        """Load bookmark database."""
        try:
            bookmarks_path = DOCS_ROOT / "bookmarks.yaml"
            if bookmarks_path.exists():
                with open(bookmarks_path, 'r', encoding='utf-8') as f:
                    self.bookmarks_db = yaml.safe_load(f) or {}
            else:
                self.bookmarks_db = {
                    "strategic": [],
                    "technical": [],
                    "process": [],
                    "ideas_improvements": [],
                    "review_engagement": []
                }
            logger.info(f"Loaded {sum(len(cat) for cat in self.bookmarks_db.values())} bookmarks")
        except Exception as e:
            logger.error(f"Failed to load bookmarks: {e}")
    
    def setup_tools(self):
        """Set up all 17 MCP tools."""
        
        # Tool 1: search        @self.server.call_tool()
        async def search(query: str, max_results: int = 10, tags: Optional[List[str]] = None) -> Sequence[TextContent]:
            """Search through ImpressionCore documentation."""
            try:
                logger.info(f"Executing search with query: {query}")
                
                # Force reload of enhanced_ids to pick up code changes
                self.reload_enhanced_ids()
                
                if self.enhanced_ids:
                    results = self.enhanced_ids.search(query, max_results=max_results, tags=tags or [])
                else:
                    # Fallback search implementation
                    results = self._fallback_search(query, max_results, tags or [])
                
                return [TextContent(
                    type="text",
                    text=json.dumps(results, indent=2, ensure_ascii=False)
                )]
            except Exception as e:
                logger.error(f"Search error: {e}")
                return [TextContent(
                    type="text", 
                    text=json.dumps({"error": str(e), "query": query}, indent=2)
                )]
        
        # Tool 2: get-system-status  
        @self.server.call_tool()
        async def get_system_status() -> Sequence[TextContent]:
            """Get current system status and statistics."""
            try:
                logger.info("Getting system status")
                
                status = {
                    "server_version": self.version,
                    "timestamp": datetime.now().isoformat(),
                    "enhanced_ids_available": HAS_IDS,
                    "rich_available": HAS_RICH,
                    "indices_loaded": {
                        "unified_index": len(self.unified_index),
                        "file_metadata": len(self.file_metadata),
                        "reverse_index": len(self.reverse_index)
                    },
                    "bookmarks_count": sum(len(cat) for cat in self.bookmarks_db.values()),
                    "tools_available": 17
                }
                
                return [TextContent(
                    type="text",
                    text=json.dumps(status, indent=2)
                )]
            except Exception as e:
                logger.error(f"System status error: {e}")
                return [TextContent(
                    type="text",
                    text=json.dumps({"error": str(e)}, indent=2)
                )]
        
        # Tool 3: list-tags
        @self.server.call_tool()
        async def list_tags(category: Optional[str] = None, pattern: Optional[str] = None) -> Sequence[TextContent]:
            """List all available tags."""
            try:
                logger.info(f"Listing tags with category: {category}, pattern: {pattern}")
                
                if self.enhanced_ids:
                    tags = self.enhanced_ids.list_tags(category=category, pattern=pattern)
                else:
                    # Fallback using reverse index
                    tags = list(self.reverse_index.keys())
                    if category:
                        tags = [tag for tag in tags if category.lower() in tag.lower()]
                    if pattern:
                        tags = [tag for tag in tags if pattern.lower() in tag.lower()]
                
                return [TextContent(
                    type="text",
                    text=json.dumps({"tags": tags, "count": len(tags)}, indent=2)
                )]
            except Exception as e:
                logger.error(f"List tags error: {e}")
                return [TextContent(
                    type="text",
                    text=json.dumps({"error": str(e)}, indent=2)
                )]
        
        # Add all other tools with similar pattern...
        # For brevity, implementing key tools and showing pattern for others
        
        # Tool 4: find-by-tag
        @self.server.call_tool()
        async def find_by_tag(tags: List[str], match_all: bool = False) -> Sequence[TextContent]:
            """Find files by specific tags."""
            try:
                logger.info(f"Finding files by tags: {tags}, match_all: {match_all}")
                
                if self.enhanced_ids:
                    results = self.enhanced_ids.find_by_tag(tags, match_all=match_all)
                else:
                    # Fallback implementation
                    results = self._fallback_find_by_tag(tags, match_all)
                
                return [TextContent(
                    type="text",
                    text=json.dumps(results, indent=2, ensure_ascii=False)
                )]
            except Exception as e:
                logger.error(f"Find by tag error: {e}")
                return [TextContent(
                    type="text",
                    text=json.dumps({"error": str(e), "tags": tags}, indent=2)
                )]
          # Tool 5: get-file-info
        @self.server.call_tool()
        async def get_file_info(file_path: str) -> Sequence[TextContent]:
            """Get detailed information about a specific file."""
            try:
                logger.info(f"Getting file info for: {file_path}")
                
                if self.enhanced_ids:
                    info = self.enhanced_ids.get_file_info(file_path)
                else:
                    # Fallback implementation
                    info = self._fallback_get_file_info(file_path)
                
                return [TextContent(
                    type="text",
                    text=json.dumps(info, indent=2, ensure_ascii=False)
                )]
            except Exception as e:
                logger.error(f"Get file info error: {e}")
                return [TextContent(
                    type="text",
                    text=json.dumps({"error": str(e), "file_path": file_path}, indent=2)
                )]

        # Tool 6: get-recent-changes
        @self.server.call_tool()
        async def get_recent_changes(days: int = 7) -> Sequence[TextContent]:
            """Get files that have been recently modified."""
            try:
                logger.info(f"Getting recent changes for last {days} days")
                
                if self.enhanced_ids:
                    changes = self.enhanced_ids.get_recent_changes(days=days)
                else:
                    # Fallback implementation
                    changes = self._fallback_get_recent_changes(days)
                
                return [TextContent(
                    type="text",
                    text=json.dumps(changes, indent=2, ensure_ascii=False)
                )]
            except Exception as e:
                logger.error(f"Get recent changes error: {e}")
                return [TextContent(
                    type="text",
                    text=json.dumps({"error": str(e), "days": days}, indent=2)
                )]

        # Tool 7: search-content
        @self.server.call_tool()
        async def search_content(query: str, file_pattern: str = "*", max_results: int = 20) -> Sequence[TextContent]:
            """Search within file contents for specific text."""
            try:
                logger.info(f"Searching content for: {query}")
                
                if self.enhanced_ids:
                    results = self.enhanced_ids.search_content(query, file_pattern=file_pattern, max_results=max_results)
                else:
                    # Fallback implementation
                    results = self._fallback_search_content(query, file_pattern, max_results)
                
                return [TextContent(
                    type="text",
                    text=json.dumps(results, indent=2, ensure_ascii=False)
                )]
            except Exception as e:
                logger.error(f"Search content error: {e}")
                return [TextContent(
                    type="text",
                    text=json.dumps({"error": str(e), "query": query}, indent=2)
                )]

        # Tool 8: manage-tags
        @self.server.call_tool()
        async def manage_tags(action: str, tag_name: Optional[str] = None, file_path: Optional[str] = None, new_tag_name: Optional[str] = None) -> Sequence[TextContent]:
            """Manage tags in the documentation system."""
            try:
                logger.info(f"Managing tags: action={action}, tag={tag_name}")
                
                if self.enhanced_ids:
                    result = self.enhanced_ids.manage_tags(action, tag_name=tag_name, file_path=file_path, new_tag_name=new_tag_name)
                else:
                    # Fallback implementation
                    result = self._fallback_manage_tags(action, tag_name, file_path, new_tag_name)
                
                return [TextContent(
                    type="text",
                    text=json.dumps(result, indent=2)
                )]
            except Exception as e:
                logger.error(f"Manage tags error: {e}")
                return [TextContent(
                    type="text",
                    text=json.dumps({"error": str(e), "action": action}, indent=2)
                )]

        # Tool 9: bookmark-management
        @self.server.call_tool()
        async def bookmark_management(action: str, bookmark_id: Optional[str] = None, title: Optional[str] = None, file_path: Optional[str] = None, description: Optional[str] = None, category: Optional[str] = None) -> Sequence[TextContent]:
            """Manage bookmarks in the documentation system."""
            try:
                logger.info(f"Managing bookmarks: action={action}")
                
                if self.enhanced_ids:
                    result = self.enhanced_ids.bookmark_management(action, bookmark_id=bookmark_id, title=title, file_path=file_path, description=description, category=category)
                else:
                    # Fallback implementation
                    result = self._fallback_bookmark_management(action, bookmark_id, title, file_path, description, category)
                
                return [TextContent(
                    type="text",
                    text=json.dumps(result, indent=2)
                )]
            except Exception as e:
                logger.error(f"Bookmark management error: {e}")
                return [TextContent(
                    type="text",
                    text=json.dumps({"error": str(e), "action": action}, indent=2)
                )]

        # Tool 10: get-documentation-stats
        @self.server.call_tool()
        async def get_documentation_stats() -> Sequence[TextContent]:
            """Get comprehensive documentation statistics."""
            try:
                logger.info("Getting documentation statistics")
                
                if self.enhanced_ids:
                    stats = self.enhanced_ids.get_documentation_stats()
                else:
                    # Fallback implementation
                    stats = self._fallback_get_documentation_stats()
                
                return [TextContent(
                    type="text",
                    text=json.dumps(stats, indent=2)
                )]
            except Exception as e:
                logger.error(f"Get documentation stats error: {e}")
                return [TextContent(
                    type="text",
                    text=json.dumps({"error": str(e)}, indent=2)
                )]

        # Tool 11: export-data
        @self.server.call_tool()
        async def export_data(format: str = "json", include_content: bool = False) -> Sequence[TextContent]:
            """Export documentation data in various formats."""
            try:
                logger.info(f"Exporting data in format: {format}")
                
                if self.enhanced_ids:
                    result = self.enhanced_ids.export_data(format=format, include_content=include_content)
                else:
                    # Fallback implementation
                    result = self._fallback_export_data(format, include_content)
                
                return [TextContent(
                    type="text",
                    text=json.dumps(result, indent=2)
                )]
            except Exception as e:
                logger.error(f"Export data error: {e}")
                return [TextContent(
                    type="text",
                    text=json.dumps({"error": str(e), "format": format}, indent=2)
                )]

        # Tool 12: import-data
        @self.server.call_tool()
        async def import_data(file_path: str, merge_strategy: str = "append") -> Sequence[TextContent]:
            """Import documentation data from file."""
            try:
                logger.info(f"Importing data from: {file_path}")
                
                if self.enhanced_ids:
                    result = self.enhanced_ids.import_data(file_path, merge_strategy=merge_strategy)
                else:
                    # Fallback implementation
                    result = self._fallback_import_data(file_path, merge_strategy)
                
                return [TextContent(
                    type="text",
                    text=json.dumps(result, indent=2)
                )]
            except Exception as e:
                logger.error(f"Import data error: {e}")
                return [TextContent(
                    type="text",
                    text=json.dumps({"error": str(e), "file_path": file_path}, indent=2)
                )]

        # Tool 13: analyze-documentation
        @self.server.call_tool()
        async def analyze_documentation() -> Sequence[TextContent]:
            """Perform comprehensive analysis of documentation quality."""
            try:
                logger.info("Analyzing documentation")
                
                if self.enhanced_ids:
                    analysis = self.enhanced_ids.analyze_documentation()
                else:
                    # Fallback implementation
                    analysis = self._fallback_analyze_documentation()
                
                return [TextContent(
                    type="text",
                    text=json.dumps(analysis, indent=2)
                )]
            except Exception as e:
                logger.error(f"Analyze documentation error: {e}")
                return [TextContent(
                    type="text",
                    text=json.dumps({"error": str(e)}, indent=2)
                )]

        # Tool 14: backup-system
        @self.server.call_tool()
        async def backup_system() -> Sequence[TextContent]:
            """Create a complete backup of the documentation system."""
            try:
                logger.info("Creating system backup")
                
                if self.enhanced_ids:
                    result = self.enhanced_ids.backup_system()
                else:
                    # Fallback implementation
                    result = self._fallback_backup_system()
                
                return [TextContent(
                    type="text",
                    text=json.dumps(result, indent=2)
                )]
            except Exception as e:
                logger.error(f"Backup system error: {e}")
                return [TextContent(
                    type="text",
                    text=json.dumps({"error": str(e)}, indent=2)
                )]

        # Tool 15: restore-system
        @self.server.call_tool()
        async def restore_system(backup_path: str) -> Sequence[TextContent]:
            """Restore documentation system from backup."""
            try:
                logger.info(f"Restoring system from: {backup_path}")
                
                if self.enhanced_ids:
                    result = self.enhanced_ids.restore_system(backup_path)
                else:
                    # Fallback implementation
                    result = self._fallback_restore_system(backup_path)
                
                return [TextContent(
                    type="text",
                    text=json.dumps(result, indent=2)
                )]
            except Exception as e:
                logger.error(f"Restore system error: {e}")
                return [TextContent(
                    type="text",
                    text=json.dumps({"error": str(e), "backup_path": backup_path}, indent=2)
                )]

        # Tool 16: rebuild-index
        @self.server.call_tool()
        async def rebuild_index(target: str = "all") -> Sequence[TextContent]:
            """Rebuild documentation indices."""
            try:
                logger.info(f"Rebuilding index: {target}")
                
                if self.enhanced_ids:
                    result = self.enhanced_ids.rebuild_index(target=target)
                else:
                    # Fallback implementation
                    result = self._fallback_rebuild_index(target)
                
                return [TextContent(
                    type="text",
                    text=json.dumps(result, indent=2)
                )]
            except Exception as e:
                logger.error(f"Rebuild index error: {e}")
                return [TextContent(
                    type="text",
                    text=json.dumps({"error": str(e), "target": target}, indent=2)
                )]

        # Tool 17: validate-index
        @self.server.call_tool()
        async def validate_index() -> Sequence[TextContent]:
            """Validate the integrity of documentation indices."""
            try:
                logger.info("Validating index integrity")
                
                if self.enhanced_ids:
                    result = self.enhanced_ids.validate_index()
                else:
                    # Fallback implementation
                    result = self._fallback_validate_index()
                
                return [TextContent(
                    type="text",
                    text=json.dumps(result, indent=2)
                )]
            except Exception as e:
                logger.error(f"Validate index error: {e}")
                return [TextContent(
                    type="text",
                    text=json.dumps({"error": str(e)}, indent=2)
                )]

        logger.info("All 17 tools registered successfully")
    
    def _fallback_search(self, query: str, max_results: int, tags: List[str]) -> Dict[str, Any]:
        """Fallback search implementation when Enhanced IDS is not available."""
        results = []
        query_lower = query.lower()
        
        # Search in file metadata
        for file_path, metadata in self.file_metadata.items():
            score = 0
            
            # Check file path
            if query_lower in file_path.lower():
                score += 10
            
            # Check metadata fields
            if isinstance(metadata, dict):
                for key, value in metadata.items():
                    if isinstance(value, str) and query_lower in value.lower():
                        score += 5
                    elif isinstance(value, list):
                        for item in value:
                            if isinstance(item, str) and query_lower in item.lower():
                                score += 3
            
            if score > 0:
                results.append({
                    "file_path": file_path,
                    "score": score,
                    "metadata": metadata
                })
        
        # Sort by score and limit results
        results.sort(key=lambda x: x["score"], reverse=True)
        results = results[:max_results]
        
        return {
            "query": query,
            "results": results,
            "total_found": len(results),
            "search_type": "fallback_metadata_search"
        }
    
    def _fallback_find_by_tag(self, tags: List[str], match_all: bool) -> Dict[str, Any]:
        """Fallback implementation for find by tag."""
        results = []
        
        for tag in tags:
            if tag in self.reverse_index:
                files = self.reverse_index[tag]
                for file_path in files:
                    if file_path not in [r["file_path"] for r in results]:
                        results.append({
                            "file_path": file_path,
                            "matching_tags": [tag],
                            "metadata": self.file_metadata.get(file_path, {})
                        })
        
        return {
            "tags": tags,
            "match_all": match_all,
            "results": results,
            "total_found": len(results)
        }
    
    def _fallback_get_file_info(self, file_path: str) -> Dict[str, Any]:
        """Fallback implementation for get file info."""
        info = {
            "file_path": file_path,
            "exists": False,
            "metadata": {},
            "tags": [],
            "last_modified": None
        }
        
        if file_path in self.file_metadata:
            info["exists"] = True
            info["metadata"] = self.file_metadata[file_path]
            
            # Find tags for this file
            for tag, files in self.reverse_index.items():
                if file_path in files:
                    info["tags"].append(tag)
        
        return info
    
    def _fallback_get_recent_changes(self, days: int) -> Dict[str, Any]:
        """Fallback implementation for get recent changes."""
        cutoff_date = datetime.now() - timedelta(days=days)
        recent_files = []
        
        # Since we don't have modification times in fallback, return empty result
        return {
            "days": days,
            "cutoff_date": cutoff_date.isoformat(),
            "recent_files": recent_files,
            "count": 0,
            "note": "Fallback mode: modification times not available"
        }
    
    def _fallback_search_content(self, query: str, file_pattern: str, max_results: int) -> Dict[str, Any]:
        """Fallback implementation for search content."""
        # Limited content search in fallback mode
        return {
            "query": query,
            "file_pattern": file_pattern,
            "results": [],
            "count": 0,
            "note": "Fallback mode: content search not available without Enhanced IDS"
        }
    
    def _fallback_manage_tags(self, action: str, tag_name: Optional[str], file_path: Optional[str], new_tag_name: Optional[str]) -> Dict[str, Any]:
        """Fallback implementation for manage tags."""
        return {
            "action": action,
            "tag_name": tag_name,
            "file_path": file_path,
            "new_tag_name": new_tag_name,
            "success": False,
            "message": "Tag management requires Enhanced IDS system"
        }
    
    def _fallback_bookmark_management(self, action: str, bookmark_id: Optional[str], title: Optional[str], file_path: Optional[str], description: Optional[str], category: Optional[str]) -> Dict[str, Any]:
        """Fallback implementation for bookmark management."""
        if action == "list":
            return {
                "action": action,
                "bookmarks": self.bookmarks_db,
                "total": sum(len(cat) for cat in self.bookmarks_db.values())
            }
        else:
            return {
                "action": action,
                "success": False,
                "message": "Bookmark modification requires Enhanced IDS system"
            }
    
    def _fallback_get_documentation_stats(self) -> Dict[str, Any]:
        """Fallback implementation for documentation stats."""
        return {
            "total_files": len(self.file_metadata),
            "total_tags": len(self.reverse_index),
            "total_bookmarks": sum(len(cat) for cat in self.bookmarks_db.values()),
            "index_files_loaded": 3,
            "enhanced_ids_available": False,
            "fallback_mode": True
        }
    
    def _fallback_export_data(self, format: str, include_content: bool) -> Dict[str, Any]:
        """Fallback implementation for export data."""
        export_data = {
            "export_timestamp": datetime.now().isoformat(),
            "format": format,
            "include_content": include_content,
            "unified_index": self.unified_index,
            "file_metadata": self.file_metadata,
            "reverse_index": self.reverse_index,
            "bookmarks": self.bookmarks_db
        }
        
        export_filename = f"ids_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.{format}"
        export_path = DOCS_ROOT / export_filename
        
        try:
            if format == "json":
                with open(export_path, 'w', encoding='utf-8') as f:
                    json.dump(export_data, f, indent=2, ensure_ascii=False)
            elif format == "yaml":
                with open(export_path, 'w', encoding='utf-8') as f:
                    yaml.dump(export_data, f, default_flow_style=False, allow_unicode=True)
            
            return {
                "success": True,
                "export_path": str(export_path),
                "format": format,
                "size": os.path.getsize(export_path) if export_path.exists() else 0
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "format": format
            }
    
    def _fallback_import_data(self, file_path: str, merge_strategy: str) -> Dict[str, Any]:
        """Fallback implementation for import data."""
        return {
            "success": False,
            "file_path": file_path,
            "merge_strategy": merge_strategy,
            "message": "Data import requires Enhanced IDS system"
        }
    
    def _fallback_analyze_documentation(self) -> Dict[str, Any]:
        """Fallback implementation for analyze documentation."""
        return {
            "analysis_timestamp": datetime.now().isoformat(),
            "total_files": len(self.file_metadata),
            "total_tags": len(self.reverse_index),
            "coverage_stats": {
                "tagged_files": sum(1 for files in self.reverse_index.values() for _ in files),
                "untagged_files": max(0, len(self.file_metadata) - sum(1 for files in self.reverse_index.values() for _ in files))
            },
            "note": "Limited analysis in fallback mode"
        }
    
    def _fallback_backup_system(self) -> Dict[str, Any]:
        """Fallback implementation for backup system."""
        backup_timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_dir = DOCS_ROOT / f"backup_{backup_timestamp}"
        
        try:
            backup_dir.mkdir(exist_ok=True)
            
            # Copy essential files
            files_backed_up = []
            for index_file in ["unified_tags_index.yaml", "file_metadata.yaml", "reverse_tag_index.yaml", "bookmarks.yaml"]:
                source = DOCS_ROOT / index_file
                if source.exists():
                    target = backup_dir / index_file
                    import shutil
                    shutil.copy2(source, target)
                    files_backed_up.append(index_file)
            
            return {
                "success": True,
                "backup_path": str(backup_dir),
                "files_backed_up": files_backed_up,
                "timestamp": backup_timestamp
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "backup_path": str(backup_dir)
            }
    
    def _fallback_restore_system(self, backup_path: str) -> Dict[str, Any]:
        """Fallback implementation for restore system."""
        return {
            "success": False,
            "backup_path": backup_path,
            "message": "System restore requires Enhanced IDS system"
        }
    
    def _fallback_rebuild_index(self, target: str) -> Dict[str, Any]:
        """Fallback implementation for rebuild index."""
        return {
            "success": False,
            "target": target,
            "message": "Index rebuilding requires Enhanced IDS system"
        }
    
    def _fallback_validate_index(self) -> Dict[str, Any]:
        """Fallback implementation for validate index."""
        issues = []
        
        # Basic validation checks
        if not self.unified_index:
            issues.append("Unified index is empty")
        if not self.file_metadata:
            issues.append("File metadata is empty")
        if not self.reverse_index:
            issues.append("Reverse index is empty")
        
        return {
            "validation_timestamp": datetime.now().isoformat(),
            "total_issues": len(issues),
            "issues": issues,
            "status": "valid" if not issues else "issues_found",
            "note": "Basic validation in fallback mode"
        }
    
    def reload_enhanced_ids(self):
        """Force reload of the enhanced_ids module to pick up code changes."""
        try:
            import importlib
            if 'docs.enhanced_ids' in sys.modules:
                logger.info("Reloading enhanced_ids module...")
                importlib.reload(sys.modules['docs.enhanced_ids'])
                from docs.enhanced_ids import EnhancedIDS
                self.enhanced_ids = EnhancedIDS()
                logger.info("Enhanced IDS module reloaded successfully")
                return True
        except Exception as e:
            logger.error(f"Failed to reload enhanced_ids module: {e}")
            return False

# Create the server application
ids_server = ImpressionCoreIDSMCPServer()

@click.command()
@click.option("--port", default=3001, help="Port to listen on for SSE")
def main(port: int) -> int:
    """Main function for MCP SSE server."""
    try:
        logger.info(f"Starting ImpressionCore IDS MCP Server on port {port}")
        
        # Create SSE transport
        sse = SseServerTransport("/messages/")
        
        async def handle_sse(request: Request):
            """Handle SSE endpoint."""
            async with sse.connect_sse(
                request.scope,
                request.receive,
                request._send,
            ) as (reader, writer):
                await ids_server.server.run(
                    reader,
                    writer,
                    ids_server.server.create_initialization_options(),
                )
        
        # Create Starlette app with required routes
        starlette_app = Starlette(
            debug=True,
            routes=[
                Route("/sse", endpoint=handle_sse),
                Mount("/messages/", app=sse.handle_post_message),
            ],
        )
        
        logger.info(f"Server will be available at: http://127.0.0.1:{port}/sse")
        uvicorn.run(starlette_app, host="127.0.0.1", port=port)
        return 0
        
    except KeyboardInterrupt:
        logger.info("Server shutdown requested")
        return 0
    except Exception as e:
        logger.error(f"Server error: {e}")
        logger.error(traceback.format_exc())
        return 1

if __name__ == "__main__":
    # For direct execution
    main()
