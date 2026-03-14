#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\servers\server_working.py #documentation #python #source_code  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\servers\server_working.py #documentation #python #source_code  
**Category:** Source Code  
**Status:** Active

"""
ImpressionCore Documentation System (IDS) MCP Server - WORKING VERSION
======================================================================

Enhanced Model Context Protocol server for comprehensive IDS functionality.
Uses FastMCP for simpler implementation.

Features:
- Enhanced search capabilities with semantic search and context
- Complete index management (rebuild, incremental updates, validation)
- Bookmark system integration and management
- Documentation analytics and reporting
- Real-time search across 1,667+ files with 2,900+ tags

Author: ImpressionCore IDS Team
Created: 2025-06-05
Enhanced: 2025-01-07
Version: 2.1.0 (FastMCP Working Version)
"""

import json
import sys
import os
import yaml
import asyncio
import logging
import subprocess
import hashlib
from pathlib import Path
from typing import Dict, List, Optional, Any, Union, Tuple
from datetime import datetime

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
        logging.FileHandler(CURRENT_DIR / 'ids_mcp_working.log')
    ]
)
logger = logging.getLogger("ids-mcp-working-server")

# Import FastMCP
try:
    from mcp.server import FastMCP
    HAS_FASTMCP = True
except ImportError:
    logger.error("FastMCP not available. Install with: pip install mcp")
    HAS_FASTMCP = False
    sys.exit(1)

# Initialize FastMCP server
mcp = FastMCP("ImpressionCore IDS")

class IDSServer:
    """IDS Server for FastMCP integration."""
    
    def __init__(self):
        self.version = "2.1.0"
        self.console = Console() if HAS_RICH else None
        self.enhanced_ids = None
        self.unified_index = {}
        self.file_metadata = {}
        self.reverse_index = {}
        self.bookmarks_db = {}
        
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
        
        logger.info("IDS Server initialized with all tools")
    
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
            self.bookmarks_db = {
                "strategic": [],
                "technical": [],
                "process": [],
                "ideas_improvements": [],
                "review_engagement": []
            }

# Initialize global server instance
server = IDSServer()

# MCP Tool Definitions
# ===================

@mcp.tool()
def search(query: str, max_results: int = 10, tags: List[str] = None) -> Dict[str, Any]:
    """Search ImpressionCore documentation with query, tags, and result limits."""
    try:
        if not query.strip():
            return {"error": "Query cannot be empty"}
        
        results = []
        query_lower = query.lower()
        
        # Search through unified index
        for file_path, file_data in server.unified_index.items():
            score = 0
            matched_tags = []
            
            # Search in tags
            file_tags = file_data.get('tags', [])
            for tag in file_tags:
                if query_lower in tag.lower():
                    score += 10
                    matched_tags.append(tag)
            
            # Tag filtering
            if tags:
                tag_match = any(filter_tag.lower() in tag.lower() 
                              for filter_tag in tags for tag in file_tags)
                if not tag_match:
                    continue
            
            # Search in content/description if available
            description = file_data.get('description', '')
            if query_lower in description.lower():
                score += 5
            
            # Search in file path and name
            if query_lower in file_path.lower():
                score += 3
            
            if score > 0:
                result = {
                    "file": file_path,
                    "path": file_path,
                    "score": score,
                    "matched_tags": matched_tags,
                    "tags": file_tags,
                    "description": description
                }
                
                # Add metadata if available
                metadata = server.file_metadata.get(file_path, {})
                result.update(metadata)
                
                results.append(result)
        
        # Sort by score and limit results
        results.sort(key=lambda x: x['score'], reverse=True)
        results = results[:max_results]
        
        return {
            "query": query,
            "total_results": len(results),
            "max_results": max_results,
            "filter_tags": tags or [],
            "results": results
        }
        
    except Exception as e:
        logger.error(f"Search error: {e}")
        return {"error": f"Search failed: {str(e)}"}

@mcp.tool()
def get_system_status() -> Dict[str, Any]:
    """Get current status and statistics of the IDS system."""
    try:
        status = {
            "version": server.version,
            "timestamp": datetime.now().isoformat(),
            "system_health": "healthy",
            "statistics": {
                "total_files": len(server.file_metadata),
                "total_tags": len(server.reverse_index),
                "total_bookmarks": sum(len(cat) for cat in server.bookmarks_db.values()),
                "index_entries": len(server.unified_index)
            },
            "index_status": {},
            "bookmark_categories": list(server.bookmarks_db.keys())
        }
        
        # Check index file status
        index_files = {
            "unified_index": DOCS_ROOT / "unified_tags_index.yaml",
            "file_metadata": DOCS_ROOT / "file_metadata.yaml",
            "reverse_index": DOCS_ROOT / "reverse_tag_index.yaml"
        }
        
        for name, path in index_files.items():
            if path.exists():
                stat = path.stat()
                status["index_status"][name] = {
                    "exists": True,
                    "size_bytes": stat.st_size,
                    "modified": datetime.fromtimestamp(stat.st_mtime).isoformat()
                }
            else:
                status["index_status"][name] = {"exists": False}
                status["system_health"] = "degraded"
        
        return status
        
    except Exception as e:
        logger.error(f"System status error: {e}")
        return {"error": f"Failed to get system status: {str(e)}"}

@mcp.tool()
def find_by_tag(tags: List[str], match_all: bool = False) -> Dict[str, Any]:
    """Find files by tags with AND/OR logic."""
    try:
        if not tags:
            return {"error": "No tags provided"}
        
        matching_files = set()
        
        if match_all:
            # AND logic - file must have ALL tags
            for tag in tags:
                tag_files = set(server.reverse_index.get(tag, []))
                if not matching_files:
                    matching_files = tag_files
                else:
                    matching_files = matching_files.intersection(tag_files)
        else:
            # OR logic - file must have ANY tag
            for tag in tags:
                tag_files = server.reverse_index.get(tag, [])
                matching_files.update(tag_files)
        
        # Enrich results with metadata
        results = []
        for file_path in matching_files:
            file_info = server.file_metadata.get(file_path, {})
            file_info["path"] = file_path
            results.append(file_info)
        
        return {
            "tags": tags,
            "match_all": match_all,
            "total_results": len(results),
            "results": results
        }
        
    except Exception as e:
        logger.error(f"Tag search error: {e}")
        return {"error": f"Tag search failed: {str(e)}"}

@mcp.tool()
def list_tags(category: str = None, pattern: str = None) -> Dict[str, Any]:
    """List all available tags with optional filtering."""
    try:
        all_tags = list(server.reverse_index.keys())
        
        # Filter by pattern if provided
        if pattern:
            all_tags = [tag for tag in all_tags if pattern.lower() in tag.lower()]
        
        # Filter by category if provided
        if category:
            all_tags = [tag for tag in all_tags if category.lower() in tag.lower()]
        
        # Sort tags by usage count
        tag_usage = [(tag, len(server.reverse_index[tag])) for tag in all_tags]
        tag_usage.sort(key=lambda x: x[1], reverse=True)
        
        return {
            "total_tags": len(tag_usage),
            "category_filter": category,
            "pattern_filter": pattern,
            "tags": [{"tag": tag, "file_count": count} for tag, count in tag_usage]
        }
        
    except Exception as e:
        logger.error(f"List tags error: {e}")
        return {"error": f"Failed to list tags: {str(e)}"}

@mcp.tool()
def get_file_info(file_path: str) -> Dict[str, Any]:
    """Get detailed information about a specific file."""
    try:
        # Try both path formats (forward and backslash)
        normalized_path_forward = file_path.replace('\\', '/')
        normalized_path_back = file_path.replace('/', '\\')
        
        # Get metadata using either format
        metadata = (server.file_metadata.get(normalized_path_forward) or 
                   server.file_metadata.get(normalized_path_back) or
                   server.file_metadata.get(file_path))
        
        if not metadata:
            return {"error": f"File not found in index: {file_path}"}
        
        # Use the actual path that was found
        actual_path = None
        for path_variant in [normalized_path_forward, normalized_path_back, file_path]:
            if path_variant in server.file_metadata:
                actual_path = path_variant
                break
        
        # Add full path info
        full_path = PROJECT_ROOT / actual_path.replace('\\', '/')
        file_info = {
            "path": actual_path,
            "full_path": str(full_path),
            "exists": full_path.exists(),
            "metadata": metadata
        }
        
        # Add file system info if file exists
        if full_path.exists():
            stat = full_path.stat()
            file_info.update({
                "size_bytes": stat.st_size,
                "modified_time": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                "created_time": datetime.fromtimestamp(stat.st_ctime).isoformat()
            })
        
        return file_info
        
    except Exception as e:
        logger.error(f"File info error: {e}")
        return {"error": f"Failed to get file info: {str(e)}"}

@mcp.tool()
def manage_bookmarks(action: str, bookmark_id: str = None, category: str = None, 
                    title: str = None, file_path: str = None, description: str = None,
                    tags: List[str] = None) -> Dict[str, Any]:
    """Manage bookmarks (list, delete, update, move, create)."""
    try:
        if action == "list":
            if category:
                return {"category": category, "bookmarks": server.bookmarks_db.get(category, [])}
            else:
                return {"all_bookmarks": server.bookmarks_db}
                
        elif action == "create":
            if not title or not file_path:
                return {"error": "title and file_path required for create action"}
                
            if not category:
                category = "review_engagement"
                
            bookmark = {
                "title": title,
                "file_path": file_path,
                "description": description or "",
                "tags": tags or [],
                "created_at": datetime.now().isoformat(),
                "id": hashlib.md5(f"{title}{file_path}{datetime.now()}".encode()).hexdigest()[:8]
            }
            
            if category not in server.bookmarks_db:
                server.bookmarks_db[category] = []
                
            server.bookmarks_db[category].append(bookmark)
            
            # Save bookmarks
            _save_bookmarks()
            
            return {
                "status": "created",
                "bookmark": bookmark,
                "category": category
            }
                
        elif action == "delete":
            if not bookmark_id:
                return {"error": "bookmark_id required for delete action"}
                
            deleted = False
            for cat_name, bookmarks in server.bookmarks_db.items():
                for i, bookmark in enumerate(bookmarks):
                    if bookmark.get("id") == bookmark_id:
                        deleted_bookmark = bookmarks.pop(i)
                        deleted = True
                        break
                if deleted:
                    break
                    
            if deleted:
                _save_bookmarks()
                return {"status": "deleted", "bookmark_id": bookmark_id}
            else:
                return {"error": f"Bookmark {bookmark_id} not found"}
                
        else:
            return {"error": f"Unsupported action: {action}"}
            
    except Exception as e:
        logger.error(f"Bookmark management error: {e}")
        return {"error": f"Bookmark management failed: {str(e)}"}

def _save_bookmarks():
    """Save bookmarks to file."""
    try:
        bookmarks_path = DOCS_ROOT / "bookmarks.yaml"
        with open(bookmarks_path, 'w', encoding='utf-8') as f:
            yaml.dump(server.bookmarks_db, f, default_flow_style=False, allow_unicode=True)
    except Exception as e:
        logger.error(f"Failed to save bookmarks: {e}")

# Run the server
if __name__ == "__main__":
    logger.info("Starting ImpressionCore IDS MCP Server (FastMCP)...")
    mcp.run()
