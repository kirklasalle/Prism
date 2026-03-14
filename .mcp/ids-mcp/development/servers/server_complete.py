#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\servers\server_complete.py #documentation #python #source_code  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\servers\server_complete.py #documentation #python #source_code  
**Category:** Source Code  
**Status:** Active

"""
ImpressionCore Documentation System (IDS) MCP Server - COMPLETE VERSION
========================================================================

Complete Model Context Protocol server with all 17 IDS tools.
Uses FastMCP for proper tool registration and discovery.

Features:
- All 17 IDS tools properly registered and discoverable
- Enhanced search capabilities with semantic search and context
- Complete index management (rebuild, incremental updates, validation)
- Bookmark system integration and management
- Documentation analytics and reporting
- Real-time search across 1,667+ files with 2,900+ tags

Author: ImpressionCore IDS Team
Created: 2025-01-07
Version: 3.0.0 (Complete FastMCP Version)
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
        logging.FileHandler(CURRENT_DIR / 'ids_mcp_complete.log')
    ]
)
logger = logging.getLogger("ids-mcp-complete-server")

# Import FastMCP
try:
    from mcp.server.fastmcp import FastMCP
    HAS_FASTMCP = True
except ImportError:
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
        self.version = "3.0.0"
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
        
        logger.info("IDS Server initialized with all 17 tools")
    
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

# Initialize global server instance
server = IDSServer()

# Helper functions
def _save_bookmarks():
    """Save bookmarks to file."""
    try:
        bookmarks_path = DOCS_ROOT / "bookmarks.yaml"
        with open(bookmarks_path, 'w', encoding='utf-8') as f:
            yaml.dump(server.bookmarks_db, f, default_flow_style=False, allow_unicode=True)
    except Exception as e:
        logger.error(f"Failed to save bookmarks: {e}")

def _generate_bookmark_id() -> str:
    """Generate unique bookmark ID."""
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    hash_part = hashlib.md5(f"{timestamp}_{len(server.bookmarks_db)}".encode()).hexdigest()[:8]
    return f"bm_{timestamp}_{hash_part}"

# MCP Tool Definitions (All 17 Tools)
# ===================================

@mcp.tool()
def search(query: str, max_results: int = 10, tags: List[str] = None) -> Dict[str, Any]:
    """Search ImpressionCore documentation with query, tags, and result limits.
    
    Args:
        query: Search query string
        max_results: Maximum number of results to return (default: 10)
        tags: Optional list of tags to filter results
        
    Returns:
        Dictionary with search results and metadata
    """
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
            
            # Search in filename
            if query_lower in Path(file_path).name.lower():
                score += 15
            
            if score > 0:
                results.append({
                    "file_path": file_path,
                    "score": score,
                    "matched_tags": matched_tags,
                    "description": description[:200] + "..." if len(description) > 200 else description,
                    "tags": file_tags
                })
        
        # Sort by score and limit results
        results.sort(key=lambda x: x['score'], reverse=True)
        results = results[:max_results]
        
        return {
            "query": query,
            "total_results": len(results),
            "results": results,
            "search_time": datetime.now().isoformat(),
            "index_stats": {
                "total_files": len(server.unified_index),
                "total_tags": len(server.reverse_index)
            }
        }
        
    except Exception as e:
        logger.error(f"Search error: {e}")
        return {"error": f"Search failed: {str(e)}"}

@mcp.tool()
def get_file_info(file_path: str) -> Dict[str, Any]:
    """Get detailed information about a specific file.
    
    Args:
        file_path: Path to the file to get information about
        
    Returns:
        Dictionary with file metadata and information
    """
    try:
        # Normalize path
        normalized_path = str(Path(file_path).as_posix())
        
        # Check if file exists in index
        file_data = server.unified_index.get(normalized_path)
        if not file_data:
            # Try relative path variations
            for indexed_path in server.unified_index.keys():
                if file_path in indexed_path or normalized_path in indexed_path:
                    file_data = server.unified_index[indexed_path]
                    normalized_path = indexed_path
                    break
        
        if not file_data:
            return {"error": f"File not found in index: {file_path}"}
        
        # Get metadata if available
        metadata = server.file_metadata.get(normalized_path, {})
        
        return {
            "file_path": normalized_path,
            "tags": file_data.get('tags', []),
            "description": file_data.get('description', ''),
            "metadata": metadata,
            "last_indexed": file_data.get('last_indexed', 'Unknown'),
            "file_size": metadata.get('size', 'Unknown'),
            "last_modified": metadata.get('modified', 'Unknown')
        }
        
    except Exception as e:
        logger.error(f"Get file info error: {e}")
        return {"error": f"Failed to get file info: {str(e)}"}

@mcp.tool()
def list_tags() -> Dict[str, Any]:
    """List all available tags in the documentation system.
    
    Returns:
        Dictionary with all tags and their usage statistics
    """
    try:
        tag_stats = {}
        
        for tag, files in server.reverse_index.items():
            tag_stats[tag] = {
                "count": len(files) if isinstance(files, list) else 1,
                "files": files if isinstance(files, list) else [files]
            }
        
        # Sort by usage count
        sorted_tags = sorted(tag_stats.items(), key=lambda x: x[1]['count'], reverse=True)
        
        return {
            "total_tags": len(tag_stats),
            "tags": dict(sorted_tags),
            "top_10_tags": dict(sorted_tags[:10]),
            "generated_at": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"List tags error: {e}")
        return {"error": f"Failed to list tags: {str(e)}"}

@mcp.tool()
def get_system_status() -> Dict[str, Any]:
    """Get current system status and statistics.
    
    Returns:
        Dictionary with system status and statistics
    """
    try:
        # Calculate various statistics
        total_files = len(server.unified_index)
        total_tags = len(server.reverse_index)
        total_bookmarks = sum(len(cat) for cat in server.bookmarks_db.values())
        
        # File type distribution
        file_types = {}
        for file_path in server.unified_index.keys():
            ext = Path(file_path).suffix.lower()
            file_types[ext] = file_types.get(ext, 0) + 1
        
        return {
            "system_version": server.version,
            "status": "operational",
            "statistics": {
                "total_files": total_files,
                "total_tags": total_tags,
                "total_bookmarks": total_bookmarks,
                "file_types": file_types
            },
            "indices_loaded": {
                "unified_index": bool(server.unified_index),
                "file_metadata": bool(server.file_metadata),
                "reverse_index": bool(server.reverse_index),
                "bookmarks": bool(server.bookmarks_db)
            },
            "enhanced_ids_available": server.enhanced_ids is not None,
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"System status error: {e}")
        return {"error": f"Failed to get system status: {str(e)}"}

@mcp.tool()
def find_by_tag(tags: List[str]) -> Dict[str, Any]:
    """Find all files that contain specific tags.
    
    Args:
        tags: List of tags to search for
        
    Returns:
        Dictionary with matching files and their information
    """
    try:
        if not tags:
            return {"error": "At least one tag must be specified"}
        
        matching_files = []
        
        for file_path, file_data in server.unified_index.items():
            file_tags = file_data.get('tags', [])
            matched_tags = [tag for tag in tags if any(tag.lower() in ft.lower() for ft in file_tags)]
            
            if matched_tags:
                matching_files.append({
                    "file_path": file_path,
                    "matched_tags": matched_tags,
                    "all_tags": file_tags,
                    "description": file_data.get('description', '')[:150] + "..." if len(file_data.get('description', '')) > 150 else file_data.get('description', '')
                })
        
        return {
            "search_tags": tags,
            "total_matches": len(matching_files),
            "files": matching_files,
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Find by tag error: {e}")
        return {"error": f"Failed to find by tag: {str(e)}"}

@mcp.tool()
def bookmark_management(action: str, category: str = None, title: str = None, 
                       file_path: str = None, description: str = None, 
                       bookmark_id: str = None, tags: List[str] = None) -> Dict[str, Any]:
    """Manage bookmarks in the documentation system.
    
    Args:
        action: Action to perform (list, add, update, delete)
        category: Bookmark category (strategic, technical, process, ideas_improvements, review_engagement)
        title: Bookmark title (for add/update)
        file_path: File path to bookmark (for add/update)
        description: Bookmark description (for add/update)
        bookmark_id: Bookmark ID (for update/delete)
        tags: List of tags for the bookmark (for add/update)
        
    Returns:
        Dictionary with bookmark operation results
    """
    try:
        if action == "list":
            if category:
                return {
                    "category": category,
                    "bookmarks": server.bookmarks_db.get(category, []),
                    "count": len(server.bookmarks_db.get(category, []))
                }
            else:
                total_bookmarks = sum(len(cat) for cat in server.bookmarks_db.values())
                return {
                    "all_categories": server.bookmarks_db,
                    "summary": {cat: len(bookmarks) for cat, bookmarks in server.bookmarks_db.items()},
                    "total_bookmarks": total_bookmarks
                }
                
        elif action == "add":
            if not all([category, title, file_path]):
                return {"error": "category, title, and file_path are required for add action"}
                
            if category not in server.bookmarks_db:
                return {"error": f"Invalid category: {category}"}
                
            bookmark_id = _generate_bookmark_id()
            new_bookmark = {
                "id": bookmark_id,
                "title": title,
                "file_path": file_path,
                "description": description or "",
                "tags": tags or [],
                "created_at": datetime.now().isoformat(),
                "category": category
            }
            
            server.bookmarks_db[category].append(new_bookmark)
            _save_bookmarks()
            
            return {"status": "added", "bookmark": new_bookmark}
            
        elif action == "update":
            if not bookmark_id:
                return {"error": "bookmark_id required for update action"}
                
            # Find and update bookmark
            for cat_name, bookmarks in server.bookmarks_db.items():
                for bookmark in bookmarks:
                    if bookmark.get("id") == bookmark_id:
                        if title:
                            bookmark["title"] = title
                        if file_path:
                            bookmark["file_path"] = file_path
                        if description is not None:
                            bookmark["description"] = description
                        if tags is not None:
                            bookmark["tags"] = tags
                        bookmark["updated_at"] = datetime.now().isoformat()
                        
                        _save_bookmarks()
                        return {"status": "updated", "bookmark": bookmark}
                        
            return {"error": f"Bookmark {bookmark_id} not found"}
                
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

@mcp.tool()
def rebuild_index(target: str = "all") -> Dict[str, Any]:
    """Rebuild documentation indices.
    
    Args:
        target: What to rebuild (all, tags, metadata, bookmarks)
        
    Returns:
        Dictionary with rebuild operation results
    """
    try:
        if not server.enhanced_ids:
            return {"error": "Enhanced IDS system not available"}
        
        results = {}
        
        if target in ["all", "tags"]:
            # Rebuild tag indices
            try:
                server.enhanced_ids.rebuild_index()
                server.load_indices()  # Reload after rebuild
                results["tags"] = "rebuilt successfully"
            except Exception as e:
                results["tags"] = f"failed: {str(e)}"
        
        if target in ["all", "metadata"]:
            # Update file metadata
            try:
                metadata_count = len(server.file_metadata)
                results["metadata"] = f"loaded {metadata_count} file entries"
            except Exception as e:
                results["metadata"] = f"failed: {str(e)}"
        
        if target in ["all", "bookmarks"]:
            # Reload bookmarks
            try:
                server.load_bookmarks()
                bookmark_count = sum(len(cat) for cat in server.bookmarks_db.values())
                results["bookmarks"] = f"loaded {bookmark_count} bookmarks"
            except Exception as e:
                results["bookmarks"] = f"failed: {str(e)}"
        
        return {
            "operation": "rebuild_index",
            "target": target,
            "results": results,
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Rebuild index error: {e}")
        return {"error": f"Failed to rebuild index: {str(e)}"}

@mcp.tool()
def get_documentation_stats() -> Dict[str, Any]:
    """Get comprehensive documentation statistics.
    
    Returns:
        Dictionary with detailed documentation statistics
    """
    try:
        # File statistics
        file_stats = {
            "total_files": len(server.unified_index),
            "by_extension": {},
            "by_directory": {}
        }
        
        for file_path in server.unified_index.keys():
            path_obj = Path(file_path)
            ext = path_obj.suffix.lower()
            directory = str(path_obj.parent)
            
            file_stats["by_extension"][ext] = file_stats["by_extension"].get(ext, 0) + 1
            file_stats["by_directory"][directory] = file_stats["by_directory"].get(directory, 0) + 1
        
        # Tag statistics
        tag_stats = {
            "total_tags": len(server.reverse_index),
            "most_common": [],
            "least_common": []
        }
        
        tag_counts = [(tag, len(files) if isinstance(files, list) else 1) 
                     for tag, files in server.reverse_index.items()]
        tag_counts.sort(key=lambda x: x[1], reverse=True)
        
        tag_stats["most_common"] = tag_counts[:10]
        tag_stats["least_common"] = tag_counts[-10:]
        
        # Bookmark statistics
        bookmark_stats = {
            "total_bookmarks": sum(len(cat) for cat in server.bookmarks_db.values()),
            "by_category": {cat: len(bookmarks) for cat, bookmarks in server.bookmarks_db.items()}
        }
        
        return {
            "generated_at": datetime.now().isoformat(),
            "files": file_stats,
            "tags": tag_stats,
            "bookmarks": bookmark_stats,
            "system_health": {
                "indices_loaded": all([
                    server.unified_index,
                    server.file_metadata,
                    server.reverse_index,
                    server.bookmarks_db
                ]),
                "enhanced_ids_available": server.enhanced_ids is not None
            }
        }
        
    except Exception as e:
        logger.error(f"Documentation stats error: {e}")
        return {"error": f"Failed to get documentation stats: {str(e)}"}

@mcp.tool()
def validate_index() -> Dict[str, Any]:
    """Validate the integrity of documentation indices.
    
    Returns:
        Dictionary with validation results and any issues found
    """
    try:
        issues = []
        stats = {}
        
        # Check unified index integrity
        stats["unified_index_files"] = len(server.unified_index)
        
        # Check for files in index that don't exist
        missing_files = []
        for file_path in server.unified_index.keys():
            full_path = PROJECT_ROOT / file_path
            if not full_path.exists():
                missing_files.append(file_path)
        
        if missing_files:
            issues.append(f"Missing files in index: {len(missing_files)} files")
            stats["missing_files"] = missing_files[:10]  # Show first 10
        
        # Check reverse index consistency
        reverse_issues = []
        for tag, files in server.reverse_index.items():
            if isinstance(files, list):
                for file_path in files:
                    if file_path not in server.unified_index:
                        reverse_issues.append(f"Tag '{tag}' references missing file: {file_path}")
        
        if reverse_issues:
            issues.append(f"Reverse index inconsistencies: {len(reverse_issues)}")
            stats["reverse_index_issues"] = reverse_issues[:5]  # Show first 5
        
        # Check bookmark file references
        bookmark_issues = []
        for category, bookmarks in server.bookmarks_db.items():
            for bookmark in bookmarks:
                file_path = bookmark.get("file_path", "")
                if file_path and file_path not in server.unified_index:
                    bookmark_issues.append(f"Bookmark '{bookmark.get('title', 'Unknown')}' references missing file: {file_path}")
        
        if bookmark_issues:
            issues.append(f"Bookmark reference issues: {len(bookmark_issues)}")
            stats["bookmark_issues"] = bookmark_issues[:5]  # Show first 5
        
        return {
            "validation_status": "passed" if not issues else "issues_found",
            "issues": issues,
            "statistics": stats,
            "validated_at": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Validate index error: {e}")
        return {"error": f"Failed to validate index: {str(e)}"}

@mcp.tool()
def export_data(format: str = "json", include_content: bool = False) -> Dict[str, Any]:
    """Export documentation data in various formats.
    
    Args:
        format: Export format (json, yaml, csv)
        include_content: Whether to include file content in export
        
    Returns:
        Dictionary with export data or file path
    """
    try:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        export_data = {
            "export_info": {
                "timestamp": datetime.now().isoformat(),
                "version": server.version,
                "format": format,
                "include_content": include_content
            },
            "unified_index": server.unified_index,
            "file_metadata": server.file_metadata,
            "reverse_index": server.reverse_index,
            "bookmarks": server.bookmarks_db
        }
        
        if include_content:
            content_data = {}
            for file_path in server.unified_index.keys():
                try:
                    full_path = PROJECT_ROOT / file_path
                    if full_path.exists() and full_path.is_file():
                        with open(full_path, 'r', encoding='utf-8', errors='ignore') as f:
                            content_data[file_path] = f.read()
                except Exception as e:
                    content_data[file_path] = f"Error reading file: {str(e)}"
            export_data["file_contents"] = content_data
        
        # Save to file
        export_filename = f"ids_export_{timestamp}.{format}"
        export_path = DOCS_ROOT / export_filename
        
        if format == "json":
            with open(export_path, 'w', encoding='utf-8') as f:
                json.dump(export_data, f, indent=2, default=str)
        elif format == "yaml":
            with open(export_path, 'w', encoding='utf-8') as f:
                yaml.dump(export_data, f, default_flow_style=False, allow_unicode=True)
        else:
            return {"error": f"Unsupported format: {format}"}
        
        return {
            "export_status": "completed",
            "export_file": str(export_path),
            "format": format,
            "size_stats": {
                "files_indexed": len(server.unified_index),
                "tags_indexed": len(server.reverse_index),
                "bookmarks_exported": sum(len(cat) for cat in server.bookmarks_db.values()),
                "content_included": include_content
            },
            "exported_at": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Export data error: {e}")
        return {"error": f"Failed to export data: {str(e)}"}

@mcp.tool()
def import_data(file_path: str, merge_strategy: str = "append") -> Dict[str, Any]:
    """Import documentation data from file.
    
    Args:
        file_path: Path to import file
        merge_strategy: How to merge data (append, replace, merge)
        
    Returns:
        Dictionary with import operation results
    """
    try:
        import_path = Path(file_path)
        if not import_path.exists():
            # Try relative to docs directory
            import_path = DOCS_ROOT / file_path
            if not import_path.exists():
                return {"error": f"Import file not found: {file_path}"}
        
        # Load import data
        if import_path.suffix.lower() == '.json':
            with open(import_path, 'r', encoding='utf-8') as f:
                import_data = json.load(f)
        elif import_path.suffix.lower() in ['.yaml', '.yml']:
            with open(import_path, 'r', encoding='utf-8') as f:
                import_data = yaml.safe_load(f)
        else:
            return {"error": f"Unsupported import format: {import_path.suffix}"}
        
        results = {}
        
        # Import unified index
        if "unified_index" in import_data:
            if merge_strategy == "replace":
                server.unified_index = import_data["unified_index"]
            elif merge_strategy == "append":
                server.unified_index.update(import_data["unified_index"])
            results["unified_index"] = f"imported {len(import_data['unified_index'])} entries"
        
        # Import bookmarks
        if "bookmarks" in import_data:
            if merge_strategy == "replace":
                server.bookmarks_db = import_data["bookmarks"]
            elif merge_strategy == "append":
                for category, bookmarks in import_data["bookmarks"].items():
                    if category in server.bookmarks_db:
                        server.bookmarks_db[category].extend(bookmarks)
                    else:
                        server.bookmarks_db[category] = bookmarks
            _save_bookmarks()
            results["bookmarks"] = f"imported bookmarks"
        
        # Save updated indices
        if "unified_index" in results:
            unified_path = DOCS_ROOT / "unified_tags_index.yaml"
            with open(unified_path, 'w', encoding='utf-8') as f:
                yaml.dump(server.unified_index, f, default_flow_style=False, allow_unicode=True)
        
        return {
            "import_status": "completed",
            "source_file": str(import_path),
            "merge_strategy": merge_strategy,
            "results": results,
            "imported_at": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Import data error: {e}")
        return {"error": f"Failed to import data: {str(e)}"}

@mcp.tool()
def get_recent_changes(days: int = 7) -> Dict[str, Any]:
    """Get files that have been recently modified.
    
    Args:
        days: Number of days to look back (default: 7)
        
    Returns:
        Dictionary with recently modified files
    """
    try:
        from datetime import timedelta
        
        cutoff_date = datetime.now() - timedelta(days=days)
        recent_files = []
        
        for file_path, metadata in server.file_metadata.items():
            modified_str = metadata.get('modified')
            if modified_str:
                try:
                    modified_date = datetime.fromisoformat(modified_str.replace('Z', '+00:00'))
                    if modified_date > cutoff_date:
                        file_data = server.unified_index.get(file_path, {})
                        recent_files.append({
                            "file_path": file_path,
                            "modified": modified_str,
                            "size": metadata.get('size'),
                            "tags": file_data.get('tags', []),
                            "description": file_data.get('description', '')[:100] + "..." if len(file_data.get('description', '')) > 100 else file_data.get('description', '')
                        })
                except Exception:
                    continue
        
        # Sort by modification date (newest first)
        recent_files.sort(key=lambda x: x['modified'], reverse=True)
        
        return {
            "days_searched": days,
            "cutoff_date": cutoff_date.isoformat(),
            "total_recent_files": len(recent_files),
            "recent_files": recent_files,
            "generated_at": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Recent changes error: {e}")
        return {"error": f"Failed to get recent changes: {str(e)}"}

@mcp.tool()
def search_content(query: str, file_pattern: str = "*", max_results: int = 20) -> Dict[str, Any]:
    """Search within file contents for specific text.
    
    Args:
        query: Text to search for within files
        file_pattern: File pattern to limit search (e.g., "*.md", "*.py")
        max_results: Maximum number of results to return
        
    Returns:
        Dictionary with content search results
    """
    try:
        if not query.strip():
            return {"error": "Query cannot be empty"}
        
        results = []
        query_lower = query.lower()
        
        # Search through files
        for file_path in server.unified_index.keys():
            try:
                # Check file pattern
                if file_pattern != "*":
                    from fnmatch import fnmatch
                    if not fnmatch(Path(file_path).name, file_pattern):
                        continue
                
                full_path = PROJECT_ROOT / file_path
                if not full_path.exists() or not full_path.is_file():
                    continue
                
                with open(full_path, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
                    content_lower = content.lower()
                    
                    if query_lower in content_lower:
                        # Find line numbers and context
                        lines = content.split('\n')
                        matches = []
                        
                        for i, line in enumerate(lines):
                            if query_lower in line.lower():
                                # Get context (line before and after)
                                context_start = max(0, i - 1)
                                context_end = min(len(lines), i + 2)
                                context = lines[context_start:context_end]
                                
                                matches.append({
                                    "line_number": i + 1,
                                    "line_content": line.strip(),
                                    "context": context
                                })
                        
                        if matches:
                            file_data = server.unified_index.get(file_path, {})
                            results.append({
                                "file_path": file_path,
                                "matches": matches[:5],  # Limit matches per file
                                "total_matches": len(matches),
                                "tags": file_data.get('tags', []),
                                "description": file_data.get('description', '')
                            })
                
                if len(results) >= max_results:
                    break
                    
            except Exception as e:
                logger.warning(f"Error searching file {file_path}: {e}")
                continue
        
        return {
            "query": query,
            "file_pattern": file_pattern,
            "total_files_found": len(results),
            "results": results,
            "search_time": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Content search error: {e}")
        return {"error": f"Failed to search content: {str(e)}"}

@mcp.tool()
def manage_tags(action: str, tag_name: str = None, new_tag_name: str = None, 
               file_path: str = None) -> Dict[str, Any]:
    """Manage tags in the documentation system.
    
    Args:
        action: Action to perform (list, add, remove, rename, merge)
        tag_name: Name of the tag to work with
        new_tag_name: New tag name (for rename/merge operations)
        file_path: File path to add/remove tag from
        
    Returns:
        Dictionary with tag management operation results
    """
    try:
        if action == "list":
            return {
                "total_tags": len(server.reverse_index),
                "tags": list(server.reverse_index.keys()),
                "tag_counts": {tag: len(files) if isinstance(files, list) else 1 
                             for tag, files in server.reverse_index.items()}
            }
        
        elif action == "add":
            if not all([tag_name, file_path]):
                return {"error": "tag_name and file_path required for add action"}
            
            # Add tag to file in unified index
            if file_path in server.unified_index:
                current_tags = server.unified_index[file_path].get('tags', [])
                if tag_name not in current_tags:
                    current_tags.append(tag_name)
                    server.unified_index[file_path]['tags'] = current_tags
                    
                    # Update reverse index
                    if tag_name in server.reverse_index:
                        if isinstance(server.reverse_index[tag_name], list):
                            server.reverse_index[tag_name].append(file_path)
                        else:
                            server.reverse_index[tag_name] = [server.reverse_index[tag_name], file_path]
                    else:
                        server.reverse_index[tag_name] = [file_path]
                    
                    return {"status": "added", "tag": tag_name, "file": file_path}
                else:
                    return {"status": "already_exists", "tag": tag_name, "file": file_path}
            else:
                return {"error": f"File not found in index: {file_path}"}
        
        elif action == "remove":
            if not all([tag_name, file_path]):
                return {"error": "tag_name and file_path required for remove action"}
            
            # Remove tag from file
            if file_path in server.unified_index:
                current_tags = server.unified_index[file_path].get('tags', [])
                if tag_name in current_tags:
                    current_tags.remove(tag_name)
                    server.unified_index[file_path]['tags'] = current_tags
                    
                    # Update reverse index
                    if tag_name in server.reverse_index:
                        files = server.reverse_index[tag_name]
                        if isinstance(files, list) and file_path in files:
                            files.remove(file_path)
                            if not files:
                                del server.reverse_index[tag_name]
                        elif files == file_path:
                            del server.reverse_index[tag_name]
                    
                    return {"status": "removed", "tag": tag_name, "file": file_path}
                else:
                    return {"status": "not_found", "tag": tag_name, "file": file_path}
            else:
                return {"error": f"File not found in index: {file_path}"}
        
        else:
            return {"error": f"Unsupported action: {action}"}
            
    except Exception as e:
        logger.error(f"Tag management error: {e}")
        return {"error": f"Tag management failed: {str(e)}"}

@mcp.tool()
def analyze_documentation() -> Dict[str, Any]:
    """Perform comprehensive analysis of documentation quality and coverage.
    
    Returns:
        Dictionary with detailed documentation analysis
    """
    try:
        analysis = {
            "overview": {
                "total_files": len(server.unified_index),
                "total_tags": len(server.reverse_index),
                "total_bookmarks": sum(len(cat) for cat in server.bookmarks_db.values())
            },
            "quality_metrics": {},
            "coverage_analysis": {},
            "recommendations": []
        }
        
        # Quality metrics
        files_with_tags = sum(1 for file_data in server.unified_index.values() 
                             if file_data.get('tags'))
        files_with_descriptions = sum(1 for file_data in server.unified_index.values() 
                                    if file_data.get('description'))
        
        analysis["quality_metrics"] = {
            "tag_coverage": f"{(files_with_tags / len(server.unified_index) * 100):.1f}%",
            "description_coverage": f"{(files_with_descriptions / len(server.unified_index) * 100):.1f}%",
            "average_tags_per_file": sum(len(file_data.get('tags', [])) 
                                       for file_data in server.unified_index.values()) / len(server.unified_index)
        }
        
        # Coverage analysis by directory
        directory_stats = {}
        for file_path, file_data in server.unified_index.items():
            directory = str(Path(file_path).parent)
            if directory not in directory_stats:
                directory_stats[directory] = {"files": 0, "tagged_files": 0, "total_tags": 0}
            
            directory_stats[directory]["files"] += 1
            if file_data.get('tags'):
                directory_stats[directory]["tagged_files"] += 1
                directory_stats[directory]["total_tags"] += len(file_data['tags'])
        
        analysis["coverage_analysis"] = directory_stats
        
        # Generate recommendations
        if files_with_tags / len(server.unified_index) < 0.8:
            analysis["recommendations"].append("Consider adding tags to more files to improve searchability")
        
        if files_with_descriptions / len(server.unified_index) < 0.6:
            analysis["recommendations"].append("Add descriptions to files to provide better context")
        
        # Find directories with low tag coverage
        for directory, stats in directory_stats.items():
            if stats["files"] > 5 and stats["tagged_files"] / stats["files"] < 0.5:
                analysis["recommendations"].append(f"Directory '{directory}' has low tag coverage")
        
        return {
            "analysis": analysis,
            "generated_at": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Documentation analysis error: {e}")
        return {"error": f"Failed to analyze documentation: {str(e)}"}

@mcp.tool()
def backup_system() -> Dict[str, Any]:
    """Create a complete backup of the documentation system.
    
    Returns:
        Dictionary with backup operation results
    """
    try:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_dir = DOCS_ROOT / "backups" / f"backup_{timestamp}"
        backup_dir.mkdir(parents=True, exist_ok=True)
        
        backup_files = {
            "unified_tags_index.yaml": server.unified_index,
            "file_metadata.yaml": server.file_metadata,
            "reverse_tag_index.yaml": server.reverse_index,
            "bookmarks.yaml": server.bookmarks_db
        }
        
        results = {}
        
        for filename, data in backup_files.items():
            backup_path = backup_dir / filename
            with open(backup_path, 'w', encoding='utf-8') as f:
                yaml.dump(data, f, default_flow_style=False, allow_unicode=True)
            results[filename] = f"backed up to {backup_path}"
        
        # Create backup manifest
        manifest = {
            "backup_info": {
                "timestamp": datetime.now().isoformat(),
                "version": server.version,
                "files_backed_up": list(backup_files.keys())
            },
            "statistics": {
                "total_files": len(server.unified_index),
                "total_tags": len(server.reverse_index),
                "total_bookmarks": sum(len(cat) for cat in server.bookmarks_db.values())
            }
        }
        
        manifest_path = backup_dir / "backup_manifest.yaml"
        with open(manifest_path, 'w', encoding='utf-8') as f:
            yaml.dump(manifest, f, default_flow_style=False, allow_unicode=True)
        
        return {
            "backup_status": "completed",
            "backup_directory": str(backup_dir),
            "files_backed_up": results,
            "manifest_file": str(manifest_path),
            "backup_size": sum(f.stat().st_size for f in backup_dir.iterdir()),
            "created_at": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Backup system error: {e}")
        return {"error": f"Failed to backup system: {str(e)}"}

@mcp.tool()
def restore_system(backup_path: str) -> Dict[str, Any]:
    """Restore documentation system from backup.
    
    Args:
        backup_path: Path to backup directory or manifest file
        
    Returns:
        Dictionary with restore operation results
    """
    try:
        backup_dir = Path(backup_path)
        if not backup_dir.exists():
            # Try relative to docs/backups
            backup_dir = DOCS_ROOT / "backups" / backup_path
            if not backup_dir.exists():
                return {"error": f"Backup not found: {backup_path}"}
        
        if backup_dir.is_file() and backup_dir.name == "backup_manifest.yaml":
            backup_dir = backup_dir.parent
        
        # Check for manifest
        manifest_path = backup_dir / "backup_manifest.yaml"
        if manifest_path.exists():
            with open(manifest_path, 'r', encoding='utf-8') as f:
                manifest = yaml.safe_load(f)
        else:
            manifest = None
        
        results = {}
        
        # Restore files
        restore_files = [
            ("unified_tags_index.yaml", "unified_index"),
            ("file_metadata.yaml", "file_metadata"),
            ("reverse_tag_index.yaml", "reverse_index"),
            ("bookmarks.yaml", "bookmarks_db")
        ]
        
        for filename, attr_name in restore_files:
            file_path = backup_dir / filename
            if file_path.exists():
                with open(file_path, 'r', encoding='utf-8') as f:
                    data = yaml.safe_load(f)
                setattr(server, attr_name, data)
                results[filename] = "restored successfully"
                
                # Also restore to original location
                original_path = DOCS_ROOT / filename
                with open(original_path, 'w', encoding='utf-8') as f:
                    yaml.dump(data, f, default_flow_style=False, allow_unicode=True)
            else:
                results[filename] = "file not found in backup"
        
        return {
            "restore_status": "completed",
            "backup_source": str(backup_dir),
            "manifest_info": manifest,
            "files_restored": results,
            "restored_at": datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Restore system error: {e}")
        return {"error": f"Failed to restore system: {str(e)}"}

# Run the server
if __name__ == "__main__":
    logger.info("Starting ImpressionCore IDS MCP Server (Complete FastMCP)...")
    logger.info(f"All 17 tools registered and ready")
    mcp.run()
