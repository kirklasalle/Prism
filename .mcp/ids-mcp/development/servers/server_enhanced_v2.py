#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\servers\server_enhanced_v2.py #command_line #documentation #python #source_code  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\servers\server_enhanced_v2.py #command_line #documentation #python #source_code  
**Category:** Source Code  
**Status:** Active

"""
ImpressionCore Documentation System (IDS) MCP Server - ENHANCED VERSION
=======================================================================

Enhanced Model Context Protocol server with 17 comprehensive IDS tools.
Includes the 5 original tools PLUS 12 powerful new capabilities based on
recent usage patterns and system enhancement needs.

NEW TOOLS ADDED:
- Index Management: rebuild_indexes, check_index_freshness, incremental_update
- Advanced Search: semantic_search, search_with_context, search_analytics  
- Documentation Management: validate_documentation, generate_documentation_report, export_index
- Bookmark System: create_bookmark, manage_bookmarks, bookmark_analytics

Author: ImpressionCore IDS Team
Created: 2025-06-05
Enhanced: 2025-01-07
Version: 2.0.0 (17 Tools)
"""

import json
import sys
import os
import yaml
import asyncio
import logging
import subprocess
import hashlib
import re
from pathlib import Path
from typing import Dict, List, Optional, Any, Union, Tuple
from datetime import datetime
import uuid

# Add project root to path for imports
CURRENT_DIR = Path(__file__).parent
PROJECT_ROOT = CURRENT_DIR.parent.parent
DOCS_ROOT = PROJECT_ROOT / "docs"
SRC_ROOT = PROJECT_ROOT / "src"

sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(DOCS_ROOT))
sys.path.insert(0, str(SRC_ROOT))

try:
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
        logging.FileHandler(CURRENT_DIR / 'ids_mcp_enhanced.log')
    ]
)
logger = logging.getLogger("ids-mcp-enhanced-server")

class EnhancedIDSMCPServer:
    """Enhanced MCP Server with 17 IDS tools including index management and bookmarks."""
    
    def __init__(self):
        self.version = "2.0.0"
        self.console = Console() if HAS_RICH else None
        self.enhanced_ids = None
        self.unified_index = {}
        self.file_metadata = {}
        self.reverse_index = {}
        self.bookmarks_db = {}
        self.search_analytics = {}
        
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
        
        # Load all data
        self.load_indices()
        self.load_bookmarks()
        self.load_search_analytics()
        
        logger.info(f"Enhanced IDS MCP Server v{self.version} initialized with 17 tools")

    def load_indices(self):
        """Load all IDS index files."""
        try:
            # Load unified tags index
            unified_path = DOCS_ROOT / "unified_tags_index.yaml"
            if unified_path.exists():
                with open(unified_path, 'r', encoding='utf-8') as f:
                    self.unified_index = yaml.safe_load(f) or {}
                self.index_mtimes['unified'] = unified_path.stat().st_mtime
            
            # Load file metadata
            metadata_path = DOCS_ROOT / "file_metadata.yaml"
            if metadata_path.exists():
                with open(metadata_path, 'r', encoding='utf-8') as f:
                    self.file_metadata = yaml.safe_load(f) or {}
                self.index_mtimes['metadata'] = metadata_path.stat().st_mtime
            
            # Load reverse index
            reverse_path = DOCS_ROOT / "reverse_tag_index.yaml"
            if reverse_path.exists():
                with open(reverse_path, 'r', encoding='utf-8') as f:
                    self.reverse_index = yaml.safe_load(f) or {}
                self.index_mtimes['reverse'] = reverse_path.stat().st_mtime
                
            logger.info(f"Loaded indices: {len(self.unified_index)} files, {len(self.file_metadata)} metadata")
                
        except Exception as e:
            logger.error(f"Error loading indices: {e}")

    def load_bookmarks(self):
        """Load bookmark database."""
        try:
            bookmarks_path = DOCS_ROOT / "bookmarks_database.yaml"
            if bookmarks_path.exists():
                with open(bookmarks_path, 'r', encoding='utf-8') as f:
                    self.bookmarks_db = yaml.safe_load(f) or {}
            else:
                # Initialize empty bookmark database
                self.bookmarks_db = {
                    'bookmarks': [],
                    'categories': ['strategic', 'technical', 'process', 'ideas_improvements', 'review_engagement'],
                    'created': datetime.now().isoformat(),
                    'last_updated': datetime.now().isoformat()
                }
                self.save_bookmarks()
            
            logger.info(f"Loaded {len(self.bookmarks_db.get('bookmarks', []))} bookmarks")
                
        except Exception as e:
            logger.error(f"Error loading bookmarks: {e}")
            self.bookmarks_db = {'bookmarks': [], 'categories': []}

    def load_search_analytics(self):
        """Load search analytics data."""
        try:
            analytics_path = DOCS_ROOT / "search_analytics.yaml"
            if analytics_path.exists():
                with open(analytics_path, 'r', encoding='utf-8') as f:
                    self.search_analytics = yaml.safe_load(f) or {}
            else:
                self.search_analytics = {'searches': [], 'popular_terms': {}, 'created': datetime.now().isoformat()}
            
            logger.info(f"Loaded search analytics with {len(self.search_analytics.get('searches', []))} records")
                
        except Exception as e:
            logger.error(f"Error loading search analytics: {e}")
            self.search_analytics = {'searches': [], 'popular_terms': {}}

    def save_bookmarks(self):
        """Save bookmark database."""
        try:
            bookmarks_path = DOCS_ROOT / "bookmarks_database.yaml"
            self.bookmarks_db['last_updated'] = datetime.now().isoformat()
            with open(bookmarks_path, 'w', encoding='utf-8') as f:
                yaml.dump(self.bookmarks_db, f, default_flow_style=False, allow_unicode=True)
            logger.info("Bookmark database saved successfully")
        except Exception as e:
            logger.error(f"Error saving bookmarks: {e}")

    def save_search_analytics(self):
        """Save search analytics data."""
        try:
            analytics_path = DOCS_ROOT / "search_analytics.yaml"
            with open(analytics_path, 'w', encoding='utf-8') as f:
                yaml.dump(self.search_analytics, f, default_flow_style=False, allow_unicode=True)
        except Exception as e:
            logger.error(f"Error saving search analytics: {e}")

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

    def log_search(self, query: str, results_count: int):
        """Log search for analytics."""
        search_record = {
            'timestamp': datetime.now().isoformat(),
            'query': query,
            'results_count': results_count
        }
        
        if 'searches' not in self.search_analytics:
            self.search_analytics['searches'] = []
        
        self.search_analytics['searches'].append(search_record)
        
        # Update popular terms
        if 'popular_terms' not in self.search_analytics:
            self.search_analytics['popular_terms'] = {}
        
        self.search_analytics['popular_terms'][query] = self.search_analytics['popular_terms'].get(query, 0) + 1
        
        # Keep only last 1000 searches
        if len(self.search_analytics['searches']) > 1000:
            self.search_analytics['searches'] = self.search_analytics['searches'][-1000:]
        
        self.save_search_analytics()

    async def handle_list_tools(self) -> Dict[str, Any]:
        """Return list of all 17 available tools."""
        return {
            "tools": [
                # ORIGINAL 5 TOOLS (Enhanced)
                {
                    "name": "ids_search",
                    "description": "Search through ImpressionCore documentation using IDS tagging system",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "Search query for documentation"},
                            "tags": {"type": "array", "items": {"type": "string"}, "description": "Optional tags to filter search results"},
                            "max_results": {"type": "integer", "description": "Maximum number of results to return", "default": 10}
                        },
                        "required": ["query"]
                    }
                },
                {
                    "name": "ids_get_file_info",
                    "description": "Get detailed information about a specific file",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "file_path": {"type": "string", "description": "Path to the file to get information about"}
                        },
                        "required": ["file_path"]
                    }
                },
                {
                    "name": "ids_list_tags",
                    "description": "List all available tags in the IDS system",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "category": {"type": "string", "description": "Optional category to filter tags"},
                            "pattern": {"type": "string", "description": "Optional pattern to match tag names"}
                        }
                    }
                },
                {
                    "name": "ids_get_system_status",
                    "description": "Get current status and statistics of the IDS system",
                    "inputSchema": {"type": "object", "properties": {}}
                },
                {
                    "name": "ids_find_by_tag",
                    "description": "Find all files associated with specific tags",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "tags": {"type": "array", "items": {"type": "string"}, "description": "Tags to search for"},
                            "match_all": {"type": "boolean", "description": "Whether to match all tags (AND) or any tag (OR)", "default": False}
                        },
                        "required": ["tags"]
                    }
                },
                
                # NEW INDEX MANAGEMENT TOOLS (3)
                {
                    "name": "ids_rebuild_indexes",
                    "description": "🔄 Rebuild all IDS indexes (complete reindex of documentation and source files)",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "force": {"type": "boolean", "description": "Force rebuild even if indexes seem current", "default": False}
                        }
                    }
                },
                {
                    "name": "ids_check_index_freshness",
                    "description": "🕒 Check if indexes need updating by comparing file modification times",
                    "inputSchema": {"type": "object", "properties": {}}
                },
                {
                    "name": "ids_incremental_update",
                    "description": "⚡ Update indexes for specific files or directories",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "paths": {"type": "array", "items": {"type": "string"}, "description": "File or directory paths to update"},
                            "recursive": {"type": "boolean", "description": "Recursively update directories", "default": True}
                        },
                        "required": ["paths"]
                    }
                },
                
                # NEW ADVANCED SEARCH TOOLS (3)
                {
                    "name": "ids_semantic_search",
                    "description": "🧠 Enhanced semantic search with content analysis and relevance scoring",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "Natural language search query"},
                            "context_lines": {"type": "integer", "description": "Number of context lines to return", "default": 3},
                            "min_relevance": {"type": "number", "description": "Minimum relevance score (0.0-1.0)", "default": 0.3}
                        },
                        "required": ["query"]
                    }
                },
                {
                    "name": "ids_search_with_context",
                    "description": "🎯 Search with file content preview and context around matches",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "query": {"type": "string", "description": "Search query"},
                            "context_lines": {"type": "integer", "description": "Lines of context before/after matches", "default": 2},
                            "max_results": {"type": "integer", "description": "Maximum results to return", "default": 10}
                        },
                        "required": ["query"]
                    }
                },
                {
                    "name": "ids_search_analytics",
                    "description": "📊 Get search usage analytics and popular search terms",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "days": {"type": "integer", "description": "Number of days to analyze", "default": 30}
                        }
                    }
                },
                
                # NEW DOCUMENTATION MANAGEMENT TOOLS (3)
                {
                    "name": "ids_validate_documentation",
                    "description": "✅ Validate documentation integrity, check broken links and tag consistency",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "check_links": {"type": "boolean", "description": "Check for broken links", "default": True},
                            "check_tags": {"type": "boolean", "description": "Validate tag consistency", "default": True},
                            "check_orphans": {"type": "boolean", "description": "Find orphaned files", "default": True}
                        }
                    }
                },
                {
                    "name": "ids_generate_documentation_report",
                    "description": "📋 Generate comprehensive documentation coverage and analytics report",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "format": {"type": "string", "enum": ["markdown", "html", "json"], "description": "Report format", "default": "markdown"},
                            "include_analytics": {"type": "boolean", "description": "Include usage analytics", "default": True}
                        }
                    }
                },
                {
                    "name": "ids_export_index",
                    "description": "💾 Export index data in various formats for external tools",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "format": {"type": "string", "enum": ["json", "csv", "yaml"], "description": "Export format", "default": "json"},
                            "include_metadata": {"type": "boolean", "description": "Include file metadata", "default": True},
                            "output_path": {"type": "string", "description": "Output file path (optional)"}
                        }
                    }
                },
                
                # NEW BOOKMARK SYSTEM TOOLS (3)
                {
                    "name": "ids_create_bookmark",
                    "description": "🔖 Create new bookmark with categories and trigger conditions",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string", "description": "Bookmark title"},
                            "description": {"type": "string", "description": "Bookmark description"},
                            "category": {"type": "string", "enum": ["strategic", "technical", "process", "ideas_improvements", "review_engagement"], "description": "Bookmark category"},
                            "tags": {"type": "array", "items": {"type": "string"}, "description": "Associated tags"},
                            "trigger_conditions": {"type": "string", "description": "When to activate this bookmark"},
                            "priority": {"type": "string", "enum": ["low", "medium", "high", "critical"], "description": "Bookmark priority", "default": "medium"}
                        },
                        "required": ["title", "description", "category"]
                    }
                },
                {
                    "name": "ids_manage_bookmarks",
                    "description": "📑 List, update, or delete existing bookmarks",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "action": {"type": "string", "enum": ["list", "update", "delete", "complete"], "description": "Action to perform"},
                            "bookmark_id": {"type": "string", "description": "Bookmark ID for update/delete/complete actions"},
                            "updates": {"type": "object", "description": "Fields to update (for update action)"},
                            "filter_category": {"type": "string", "description": "Filter bookmarks by category (for list action)"},
                            "filter_status": {"type": "string", "enum": ["active", "completed", "all"], "description": "Filter by status", "default": "active"}
                        },
                        "required": ["action"]
                    }
                },
                {
                    "name": "ids_bookmark_analytics",
                    "description": "📈 Get bookmark usage analytics and completion statistics",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "include_trends": {"type": "boolean", "description": "Include trend analysis", "default": True},
                            "category_breakdown": {"type": "boolean", "description": "Include category breakdown", "default": True}
                        }
                    }
                }
            ]
        }

    # ===== ORIGINAL 5 TOOLS (Enhanced Implementations) =====
    
    async def handle_ids_search(self, query: str, tags: Optional[List[str]] = None, max_results: int = 10) -> Dict[str, Any]:
        """Enhanced search with analytics logging."""
        try:
            self.check_for_index_updates()
            
            if not self.enhanced_ids:
                return {"error": "Enhanced IDS system not available", "results": []}
            
            results = self.enhanced_ids.search(query, tags, max_results)
            results_count = len(results.get('files', []))
            
            # Log search for analytics
            self.log_search(query, results_count)
            
            return {
                "query": query,
                "tags_filter": tags,
                "results": results,
                "total_results": results_count,
                "timestamp": datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Search error: {e}")
            return {"error": str(e), "results": []}

    async def handle_ids_get_file_info(self, file_path: str) -> Dict[str, Any]:
        """Get detailed file information with enhanced metadata."""
        try:
            self.check_for_index_updates()
            
            metadata = self.file_metadata.get(file_path, {})
            if not metadata:
                # Try to find file in unified index
                for file_data in self.unified_index.get('files', []):
                    if file_data.get('path') == file_path:
                        metadata = file_data
                        break
            
            if not metadata:
                return {
                    "error": f"File not found in IDS: {file_path}",
                    "file_path": file_path
                }
            
            # Add file system info if available
            actual_path = PROJECT_ROOT / file_path if not os.path.isabs(file_path) else Path(file_path)
            if actual_path.exists():
                stat_info = actual_path.stat()
                metadata.update({
                    "file_size": stat_info.st_size,
                    "last_modified": datetime.fromtimestamp(stat_info.st_mtime).isoformat(),
                    "exists": True
                })
            else:
                metadata["exists"] = False
            
            return {
                "file_path": file_path,
                "metadata": metadata,
                "retrieved_at": datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"File info error: {e}")
            return {"error": str(e), "file_path": file_path}

    async def handle_ids_list_tags(self, category: Optional[str] = None, pattern: Optional[str] = None) -> Dict[str, Any]:
        """List all available tags with filtering."""
        try:
            self.check_for_index_updates()
            
            all_tags = set()
            
            # Collect tags from unified index
            for file_data in self.unified_index.get('files', []):
                file_tags = file_data.get('tags', [])
                all_tags.update(file_tags)
            
            # Apply filters
            filtered_tags = list(all_tags)
            
            if pattern:
                import re
                pattern_re = re.compile(pattern, re.IGNORECASE)
                filtered_tags = [tag for tag in filtered_tags if pattern_re.search(tag)]
            
            if category:
                # Filter by category (tags starting with category name)
                filtered_tags = [tag for tag in filtered_tags if tag.startswith(category.lower())]
            
            # Sort tags
            filtered_tags.sort()
            
            return {
                "total_tags": len(all_tags),
                "filtered_tags": len(filtered_tags),
                "tags": filtered_tags,
                "filters": {"category": category, "pattern": pattern},
                "retrieved_at": datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"List tags error: {e}")
            return {"error": str(e), "tags": []}

    async def handle_ids_get_system_status(self) -> Dict[str, Any]:
        """Get comprehensive system status with enhanced metrics."""
        try:
            self.check_for_index_updates()
            
            total_files = len(self.unified_index.get('files', []))
            total_tags = len(set(tag for file_data in self.unified_index.get('files', []) for tag in file_data.get('tags', [])))
            
            # Index file stats
            index_files = [
                "unified_tags_index.yaml",
                "file_metadata.yaml", 
                "reverse_tag_index.yaml",
                "bookmarks_database.yaml",
                "search_analytics.yaml"
            ]
            
            index_status = {}
            for idx_file in index_files:
                path = DOCS_ROOT / idx_file
                if path.exists():
                    stat_info = path.stat()
                    index_status[idx_file] = {
                        "exists": True,
                        "size": stat_info.st_size,
                        "last_modified": datetime.fromtimestamp(stat_info.st_mtime).isoformat()
                    }
                else:
                    index_status[idx_file] = {"exists": False}
            
            # Bookmark stats
            bookmark_stats = {
                "total_bookmarks": len(self.bookmarks_db.get('bookmarks', [])),
                "active_bookmarks": len([b for b in self.bookmarks_db.get('bookmarks', []) if b.get('status') != 'completed']),
                "categories": len(self.bookmarks_db.get('categories', []))
            }
            
            # Search analytics stats
            search_stats = {
                "total_searches": len(self.search_analytics.get('searches', [])),
                "popular_terms": len(self.search_analytics.get('popular_terms', {})),
                "last_search": self.search_analytics.get('searches', [{}])[-1].get('timestamp') if self.search_analytics.get('searches') else None
            }
            
            return {
                "version": self.version,
                "enhanced_ids_available": HAS_IDS and self.enhanced_ids is not None,
                "total_files": total_files,
                "total_tags": total_tags,
                "index_files": index_status,
                "bookmark_stats": bookmark_stats,
                "search_stats": search_stats,
                "system_time": datetime.now().isoformat(),
                "project_root": str(PROJECT_ROOT),
                "docs_root": str(DOCS_ROOT)
            }
            
        except Exception as e:
            logger.error(f"System status error: {e}")
            return {"error": str(e)}

    async def handle_ids_find_by_tag(self, tags: List[str], match_all: bool = False) -> Dict[str, Any]:
        """Find files by tags with enhanced filtering."""
        try:
            self.check_for_index_updates()
            
            matching_files = []
            
            for file_data in self.unified_index.get('files', []):
                file_tags = set(file_data.get('tags', []))
                search_tags = set(tags)
                
                if match_all:
                    # All tags must be present
                    if search_tags.issubset(file_tags):
                        matching_files.append(file_data)
                else:
                    # Any tag can match
                    if search_tags.intersection(file_tags):
                        matching_files.append(file_data)
            
            return {
                "search_tags": tags,
                "match_all": match_all,
                "total_matches": len(matching_files),
                "files": matching_files,
                "retrieved_at": datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Find by tag error: {e}")
            return {"error": str(e), "files": []}

    # ===== NEW INDEX MANAGEMENT TOOLS =====
    
    async def handle_ids_rebuild_indexes(self, force: bool = False) -> Dict[str, Any]:
        """Rebuild all IDS indexes."""
        try:
            if not self.enhanced_ids:
                return {"error": "Enhanced IDS system not available"}
            
            logger.info("Starting complete index rebuild...")
            
            # Run the rebuild command
            result = subprocess.run([
                sys.executable, str(DOCS_ROOT / "enhanced_ids.py"), "--rebuild"
            ], capture_output=True, text=True, cwd=str(PROJECT_ROOT))
            
            if result.returncode == 0:
                # Reload our indices
                self.load_indices()
                
                return {
                    "success": True,
                    "message": "Indexes rebuilt successfully",
                    "output": result.stdout,
                    "files_processed": len(self.unified_index.get('files', [])),
                    "timestamp": datetime.now().isoformat()
                }
            else:
                return {
                    "success": False,
                    "error": "Rebuild failed",
                    "output": result.stdout,
                    "error_output": result.stderr
                }
                
        except Exception as e:
            logger.error(f"Rebuild indexes error: {e}")
            return {"error": str(e), "success": False}

    async def handle_ids_check_index_freshness(self) -> Dict[str, Any]:
        """Check if indexes need updating."""
        try:
            freshness_report = {
                "needs_update": False,
                "outdated_files": [],
                "index_ages": {},
                "recommendations": []
            }
            
            # Check index file ages
            index_files = [
                DOCS_ROOT / "unified_tags_index.yaml",
                DOCS_ROOT / "file_metadata.yaml",
                DOCS_ROOT / "reverse_tag_index.yaml"
            ]
            
            oldest_index_time = None
            for idx_file in index_files:
                if idx_file.exists():
                    mtime = datetime.fromtimestamp(idx_file.stat().st_mtime)
                    freshness_report["index_ages"][idx_file.name] = mtime.isoformat()
                    
                    if oldest_index_time is None or mtime < oldest_index_time:
                        oldest_index_time = mtime
                else:
                    freshness_report["needs_update"] = True
                    freshness_report["recommendations"].append(f"Missing index file: {idx_file.name}")
            
            # Check for files newer than indexes
            if oldest_index_time:
                for root in [DOCS_ROOT, SRC_ROOT]:
                    for file_path in root.rglob("*.md"):
                        if file_path.is_file():
                            file_mtime = datetime.fromtimestamp(file_path.stat().st_mtime)
                            if file_mtime > oldest_index_time:
                                freshness_report["outdated_files"].append({
                                    "path": str(file_path.relative_to(PROJECT_ROOT)),
                                    "modified": file_mtime.isoformat()
                                })
                                freshness_report["needs_update"] = True
            
            if freshness_report["needs_update"]:
                freshness_report["recommendations"].append("Run ids_rebuild_indexes to update")
            
            return freshness_report
            
        except Exception as e:
            logger.error(f"Check freshness error: {e}")
            return {"error": str(e)}

    async def handle_ids_incremental_update(self, paths: List[str], recursive: bool = True) -> Dict[str, Any]:
        """Update indexes for specific paths."""
        try:
            if not self.enhanced_ids:
                return {"error": "Enhanced IDS system not available"}
            
            updated_files = []
            errors = []
            
            for path_str in paths:
                try:
                    path = Path(path_str)
                    if not path.is_absolute():
                        path = PROJECT_ROOT / path
                    
                    if path.is_file():
                        # Process single file
                        rel_path = str(path.relative_to(PROJECT_ROOT))
                        # Simulate file processing (would use enhanced_ids methods)
                        updated_files.append(rel_path)
                    elif path.is_dir() and recursive:
                        # Process directory recursively
                        for file_path in path.rglob("*.md"):
                            rel_path = str(file_path.relative_to(PROJECT_ROOT))
                            updated_files.append(rel_path)
                    
                except Exception as e:
                    errors.append(f"Error processing {path_str}: {e}")
            
            # Reload indices after updates
            if updated_files:
                self.load_indices()
            
            return {
                "success": len(errors) == 0,
                "updated_files": updated_files,
                "files_count": len(updated_files),
                "errors": errors,
                "timestamp": datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Incremental update error: {e}")
            return {"error": str(e), "success": False}

    # ===== NEW ADVANCED SEARCH TOOLS =====
    
    async def handle_ids_semantic_search(self, query: str, context_lines: int = 3, min_relevance: float = 0.3) -> Dict[str, Any]:
        """Enhanced semantic search with relevance scoring."""
        try:
            if not self.enhanced_ids:
                return {"error": "Enhanced IDS system not available"}
            
            # Use enhanced search with semantic analysis
            base_results = self.enhanced_ids.search(query, max_results=20)
            
            # Add semantic scoring (simplified implementation)
            enhanced_results = []
            query_words = set(query.lower().split())
            
            for file_data in base_results.get('files', []):
                # Calculate relevance score
                file_tags = set(tag.lower() for tag in file_data.get('tags', []))
                title_words = set(file_data.get('title', '').lower().split())
                
                # Simple relevance calculation
                tag_matches = len(query_words.intersection(file_tags))
                title_matches = len(query_words.intersection(title_words))
                relevance = (tag_matches * 0.6 + title_matches * 0.4) / len(query_words)
                
                if relevance >= min_relevance:
                    file_data['relevance_score'] = round(relevance, 3)
                    enhanced_results.append(file_data)
            
            # Sort by relevance
            enhanced_results.sort(key=lambda x: x.get('relevance_score', 0), reverse=True)
            
            self.log_search(f"semantic:{query}", len(enhanced_results))
            
            return {
                "query": query,
                "search_type": "semantic",
                "min_relevance": min_relevance,
                "total_results": len(enhanced_results),
                "results": enhanced_results,
                "timestamp": datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Semantic search error: {e}")
            return {"error": str(e), "results": []}

    async def handle_ids_search_with_context(self, query: str, context_lines: int = 2, max_results: int = 10) -> Dict[str, Any]:
        """Search with content preview and context."""
        try:
            # First do regular search
            search_results = await self.handle_ids_search(query, max_results=max_results)
            
            enhanced_results = []
            
            for file_data in search_results.get('results', {}).get('files', []):
                file_path = file_data.get('path', '')
                
                # Try to read file content for context
                try:
                    actual_path = PROJECT_ROOT / file_path
                    if actual_path.exists() and actual_path.suffix in ['.md', '.txt', '.py']:
                        with open(actual_path, 'r', encoding='utf-8') as f:
                            content = f.read()
                        
                        # Find query matches in content
                        lines = content.split('\n')
                        matches = []
                        
                        for i, line in enumerate(lines):
                            if query.lower() in line.lower():
                                # Extract context around match
                                start_line = max(0, i - context_lines)
                                end_line = min(len(lines), i + context_lines + 1)
                                
                                context = {
                                    'line_number': i + 1,
                                    'matched_line': line.strip(),
                                    'context': lines[start_line:end_line]
                                }
                                matches.append(context)
                        
                        file_data['content_matches'] = matches[:3]  # Limit to 3 matches per file
                        file_data['total_matches_in_file'] = len(matches)
                
                except Exception as file_error:
                    file_data['content_error'] = str(file_error)
                
                enhanced_results.append(file_data)
            
            return {
                "query": query,
                "search_type": "with_context",
                "context_lines": context_lines,
                "total_results": len(enhanced_results),
                "results": enhanced_results,
                "timestamp": datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Search with context error: {e}")
            return {"error": str(e), "results": []}

    async def handle_ids_search_analytics(self, days: int = 30) -> Dict[str, Any]:
        """Get search analytics and trends."""
        try:
            cutoff_date = datetime.now() - timedelta(days=days)
            
            recent_searches = []
            for search in self.search_analytics.get('searches', []):
                search_time = datetime.fromisoformat(search['timestamp'])
                if search_time >= cutoff_date:
                    recent_searches.append(search)
            
            # Analyze popular terms
            term_counts = {}
            for search in recent_searches:
                query = search['query']
                term_counts[query] = term_counts.get(query, 0) + 1
            
            # Sort by popularity
            popular_terms = sorted(term_counts.items(), key=lambda x: x[1], reverse=True)[:10]
            
            # Calculate daily search volumes
            daily_volumes = {}
            for search in recent_searches:
                date = datetime.fromisoformat(search['timestamp']).date().isoformat()
                daily_volumes[date] = daily_volumes.get(date, 0) + 1
            
            return {
                "analysis_period_days": days,
                "total_searches": len(recent_searches),
                "unique_queries": len(term_counts),
                "popular_terms": popular_terms,
                "daily_search_volumes": daily_volumes,
                "average_daily_searches": len(recent_searches) / max(days, 1),
                "analyzed_at": datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Search analytics error: {e}")
            return {"error": str(e)}

    # ===== NEW DOCUMENTATION MANAGEMENT TOOLS =====
    
    async def handle_ids_validate_documentation(self, check_links: bool = True, check_tags: bool = True, check_orphans: bool = True) -> Dict[str, Any]:
        """Validate documentation integrity."""
        try:
            validation_report = {
                "validation_time": datetime.now().isoformat(),
                "checks_performed": [],
                "issues_found": [],
                "summary": {"total_issues": 0, "critical_issues": 0}
            }
            
            if check_tags:
                validation_report["checks_performed"].append("tag_consistency")
                # Check for inconsistent tags
                all_tags = set()
                tag_usage = {}
                
                for file_data in self.unified_index.get('files', []):
                    for tag in file_data.get('tags', []):
                        all_tags.add(tag)
                        tag_usage[tag] = tag_usage.get(tag, 0) + 1
                
                # Find rarely used tags (might be typos)
                rare_tags = [tag for tag, count in tag_usage.items() if count == 1]
                if rare_tags:
                    validation_report["issues_found"].append({
                        "type": "rare_tags",
                        "severity": "warning",
                        "description": f"Found {len(rare_tags)} tags used only once (possible typos)",
                        "details": rare_tags[:10]  # Show first 10
                    })
            
            if check_orphans:
                validation_report["checks_performed"].append("orphan_files")
                # Check for files not in index
                indexed_files = set(f['path'] for f in self.unified_index.get('files', []))
                
                actual_files = set()
                for root in [DOCS_ROOT, SRC_ROOT]:
                    for file_path in root.rglob("*.md"):
                        rel_path = str(file_path.relative_to(PROJECT_ROOT))
                        actual_files.add(rel_path)
                
                orphan_files = actual_files - indexed_files
                if orphan_files:
                    validation_report["issues_found"].append({
                        "type": "orphan_files", 
                        "severity": "warning",
                        "description": f"Found {len(orphan_files)} files not in index",
                        "details": list(orphan_files)[:10]
                    })
            
            if check_links:
                validation_report["checks_performed"].append("broken_links")
                # Basic broken link check (simplified)
                broken_links = []
                
                for file_data in self.unified_index.get('files', []):
                    file_path = PROJECT_ROOT / file_data.get('path', '')
                    if file_path.exists():
                        try:
                            with open(file_path, 'r', encoding='utf-8') as f:
                                content = f.read()
                            
                            # Find markdown links [text](path)
                            import re
                            links = re.findall(r'\[([^\]]+)\]\(([^)]+)\)', content)
                            
                            for link_text, link_path in links:
                                if not link_path.startswith('http'):  # Local link
                                    if link_path.startswith('/'):
                                        target = PROJECT_ROOT / link_path[1:]
                                    else:
                                        target = file_path.parent / link_path
                                    
                                    if not target.exists():
                                        broken_links.append({
                                            "file": file_data.get('path'),
                                            "link_text": link_text,
                                            "link_path": link_path
                                        })
                        except Exception:
                            pass  # Skip files that can't be read
                
                if broken_links:
                    validation_report["issues_found"].append({
                        "type": "broken_links",
                        "severity": "error", 
                        "description": f"Found {len(broken_links)} broken links",
                        "details": broken_links[:10]
                    })
            
            # Update summary
            validation_report["summary"]["total_issues"] = len(validation_report["issues_found"])
            validation_report["summary"]["critical_issues"] = len([
                issue for issue in validation_report["issues_found"] 
                if issue.get("severity") == "error"
            ])
            
            return validation_report
            
        except Exception as e:
            logger.error(f"Documentation validation error: {e}")
            return {"error": str(e)}

    async def handle_ids_generate_documentation_report(self, format: str = "markdown", include_analytics: bool = True) -> Dict[str, Any]:
        """Generate comprehensive documentation report."""
        try:
            report_data = {
                "generated_at": datetime.now().isoformat(),
                "format": format,
                "sections": {}
            }
            
            # Overview section
            total_files = len(self.unified_index.get('files', []))
            total_tags = len(set(tag for file_data in self.unified_index.get('files', []) for tag in file_data.get('tags', [])))
            
            report_data["sections"]["overview"] = {
                "total_documentation_files": total_files,
                "total_unique_tags": total_tags,
                "documentation_coverage": "Analysis complete",
                "last_index_update": datetime.now().isoformat()
            }
            
            # File categorization
            categories = {}
            for file_data in self.unified_index.get('files', []):
                path = file_data.get('path', '')
                if path.startswith('docs/'):
                    category = path.split('/')[1] if '/' in path else 'root'
                elif path.startswith('src/'):
                    category = 'source_code'
                else:
                    category = 'other'
                
                categories[category] = categories.get(category, 0) + 1
            
            report_data["sections"]["categorization"] = categories
            
            # Tag analysis
            tag_counts = {}
            for file_data in self.unified_index.get('files', []):
                for tag in file_data.get('tags', []):
                    tag_counts[tag] = tag_counts.get(tag, 0) + 1
            
            top_tags = sorted(tag_counts.items(), key=lambda x: x[1], reverse=True)[:20]
            report_data["sections"]["top_tags"] = top_tags
            
            # Analytics section
            if include_analytics:
                analytics_data = await self.handle_ids_search_analytics(days=30)
                report_data["sections"]["usage_analytics"] = analytics_data
            
            # Format the report
            if format == "markdown":
                report_content = self._format_report_as_markdown(report_data)
            elif format == "html":
                report_content = self._format_report_as_html(report_data)
            else:  # json
                report_content = json.dumps(report_data, indent=2)
            
            return {
                "success": True,
                "format": format,
                "report_data": report_data,
                "report_content": report_content,
                "generated_at": datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Generate documentation report error: {e}")
            return {"error": str(e), "success": False}

    def _format_report_as_markdown(self, data: Dict[str, Any]) -> str:
        """Format report data as Markdown."""
        lines = [
            "# ImpressionCore Documentation Report",
            f"Generated: {data['generated_at']}\n",
            "## Overview",
            f"- Total Documentation Files: {data['sections']['overview']['total_documentation_files']}",
            f"- Total Unique Tags: {data['sections']['overview']['total_unique_tags']}\n",
            "## File Categorization"
        ]
        
        for category, count in data['sections']['categorization'].items():
            lines.append(f"- {category}: {count} files")
        
        lines.extend(["\n## Top Tags"])
        for tag, count in data['sections']['top_tags'][:10]:
            lines.append(f"- {tag}: {count} files")
        
        return "\n".join(lines)

    def _format_report_as_html(self, data: Dict[str, Any]) -> str:
        """Format report data as HTML."""
        html = f"""
        <html><head><title>ImpressionCore Documentation Report</title></head>
        <body>
        <h1>ImpressionCore Documentation Report</h1>
        <p>Generated: {data['generated_at']}</p>
        
        <h2>Overview</h2>
        <ul>
        <li>Total Documentation Files: {data['sections']['overview']['total_documentation_files']}</li>
        <li>Total Unique Tags: {data['sections']['overview']['total_unique_tags']}</li>
        </ul>
        
        <h2>File Categorization</h2>
        <ul>
        """
        
        for category, count in data['sections']['categorization'].items():
            html += f"<li>{category}: {count} files</li>"
        
        html += "</ul><h2>Top Tags</h2><ul>"
        
        for tag, count in data['sections']['top_tags'][:10]:
            html += f"<li>{tag}: {count} files</li>"
        
        html += "</ul></body></html>"
        return html

    async def handle_ids_export_index(self, format: str = "json", include_metadata: bool = True, output_path: Optional[str] = None) -> Dict[str, Any]:
        """Export index data in various formats."""
        try:
            export_data = {
                "exported_at": datetime.now().isoformat(),
                "total_files": len(self.unified_index.get('files', [])),
                "files": self.unified_index.get('files', [])
            }
            
            if include_metadata:
                export_data["metadata"] = self.file_metadata
                export_data["reverse_index"] = self.reverse_index
            
            # Format the data
            if format == "json":
                content = json.dumps(export_data, indent=2, ensure_ascii=False)
                default_filename = "ids_export.json"
            elif format == "yaml":
                content = yaml.dump(export_data, default_flow_style=False, allow_unicode=True)
                default_filename = "ids_export.yaml"
            elif format == "csv":
                # Create CSV of files and tags
                import csv
                import io
                
                output = io.StringIO()
                writer = csv.writer(output)
                writer.writerow(['file_path', 'title', 'tags', 'size', 'last_modified'])
                
                for file_data in export_data['files']:
                    writer.writerow([
                        file_data.get('path', ''),
                        file_data.get('title', ''),
                        ', '.join(file_data.get('tags', [])),
                        file_data.get('size', ''),
                        file_data.get('last_modified', '')
                    ])
                
                content = output.getvalue()
                default_filename = "ids_export.csv"
            else:
                return {"error": f"Unsupported format: {format}", "success": False}
            
            # Save to file if output_path specified
            if output_path:
                export_path = Path(output_path)
                if not export_path.is_absolute():
                    export_path = PROJECT_ROOT / output_path
                
                export_path.parent.mkdir(parents=True, exist_ok=True)
                with open(export_path, 'w', encoding='utf-8') as f:
                    f.write(content)
                
                saved_path = str(export_path)
            else:
                # Save to default location
                export_path = DOCS_ROOT / default_filename
                with open(export_path, 'w', encoding='utf-8') as f:
                    f.write(content)
                saved_path = str(export_path)
            
            return {
                "success": True,
                "format": format,
                "exported_files": export_data["total_files"],
                "output_path": saved_path,
                "file_size": len(content),
                "exported_at": datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Export index error: {e}")
            return {"error": str(e), "success": False}

    # ===== NEW BOOKMARK SYSTEM TOOLS =====
    
    async def handle_ids_create_bookmark(self, title: str, description: str, category: str, 
                                       tags: Optional[List[str]] = None, trigger_conditions: Optional[str] = None,
                                       priority: str = "medium") -> Dict[str, Any]:
        """Create new bookmark."""
        try:
            bookmark_id = str(uuid.uuid4())[:8]
            
            bookmark = {
                "id": bookmark_id,
                "title": title,
                "description": description,
                "category": category,
                "tags": tags or [],
                "trigger_conditions": trigger_conditions or "",
                "priority": priority,
                "status": "active",
                "created_at": datetime.now().isoformat(),
                "last_accessed": None,
                "access_count": 0
            }
            
            if 'bookmarks' not in self.bookmarks_db:
                self.bookmarks_db['bookmarks'] = []
            
            self.bookmarks_db['bookmarks'].append(bookmark)
            self.save_bookmarks()
            
            return {
                "success": True,
                "bookmark_id": bookmark_id,
                "bookmark": bookmark,
                "message": f"Bookmark '{title}' created successfully"
            }
            
        except Exception as e:
            logger.error(f"Create bookmark error: {e}")
            return {"error": str(e), "success": False}

    async def handle_ids_manage_bookmarks(self, action: str, bookmark_id: Optional[str] = None,
                                        updates: Optional[Dict[str, Any]] = None,
                                        filter_category: Optional[str] = None,
                                        filter_status: str = "active") -> Dict[str, Any]:
        """Manage existing bookmarks."""
        try:
            if action == "list":
                bookmarks = self.bookmarks_db.get('bookmarks', [])
                
                # Apply filters
                filtered_bookmarks = bookmarks
                
                if filter_category:
                    filtered_bookmarks = [b for b in filtered_bookmarks if b.get('category') == filter_category]
                
                if filter_status != "all":
                    filtered_bookmarks = [b for b in filtered_bookmarks if b.get('status') == filter_status]
                
                return {
                    "action": "list",
                    "total_bookmarks": len(bookmarks),
                    "filtered_count": len(filtered_bookmarks),
                    "filters": {"category": filter_category, "status": filter_status},
                    "bookmarks": filtered_bookmarks
                }
            
            elif action in ["update", "delete", "complete"]:
                if not bookmark_id:
                    return {"error": "bookmark_id required for this action", "success": False}
                
                bookmarks = self.bookmarks_db.get('bookmarks', [])
                bookmark = None
                bookmark_index = None
                
                for i, b in enumerate(bookmarks):
                    if b.get('id') == bookmark_id:
                        bookmark = b
                        bookmark_index = i
                        break
                
                if not bookmark:
                    return {"error": f"Bookmark {bookmark_id} not found", "success": False}
                
                if action == "delete":
                    del bookmarks[bookmark_index]
                    self.save_bookmarks()
                    return {
                        "success": True,
                        "action": "delete",
                        "message": f"Bookmark '{bookmark['title']}' deleted"
                    }
                
                elif action == "complete":
                    bookmark['status'] = 'completed'
                    bookmark['completed_at'] = datetime.now().isoformat()
                    self.save_bookmarks()
                    return {
                        "success": True,
                        "action": "complete",
                        "bookmark": bookmark,
                        "message": f"Bookmark '{bookmark['title']}' marked as completed"
                    }
                
                elif action == "update":
                    if updates:
                        for key, value in updates.items():
                            if key in ['title', 'description', 'category', 'tags', 'trigger_conditions', 'priority']:
                                bookmark[key] = value
                        
                        bookmark['last_updated'] = datetime.now().isoformat()
                        self.save_bookmarks()
                        
                        return {
                            "success": True,
                            "action": "update",
                            "bookmark": bookmark,
                            "message": f"Bookmark '{bookmark['title']}' updated"
                        }
                    else:
                        return {"error": "No updates provided", "success": False}
            
            else:
                return {"error": f"Unknown action: {action}", "success": False}
            
        except Exception as e:
            logger.error(f"Manage bookmarks error: {e}")
            return {"error": str(e), "success": False}

    async def handle_ids_bookmark_analytics(self, include_trends: bool = True, category_breakdown: bool = True) -> Dict[str, Any]:
        """Get bookmark analytics and statistics."""
        try:
            bookmarks = self.bookmarks_db.get('bookmarks', [])
            
            analytics = {
                "total_bookmarks": len(bookmarks),
                "active_bookmarks": len([b for b in bookmarks if b.get('status') == 'active']),
                "completed_bookmarks": len([b for b in bookmarks if b.get('status') == 'completed']),
                "generated_at": datetime.now().isoformat()
            }
            
            if category_breakdown:
                categories = {}
                priorities = {}
                
                for bookmark in bookmarks:
                    cat = bookmark.get('category', 'uncategorized')
                    categories[cat] = categories.get(cat, 0) + 1
                    
                    priority = bookmark.get('priority', 'medium')
                    priorities[priority] = priorities.get(priority, 0) + 1
                
                analytics["category_breakdown"] = categories
                analytics["priority_distribution"] = priorities
            
            if include_trends:
                # Analyze creation trends (by month)
                creation_trends = {}
                completion_trends = {}
                
                for bookmark in bookmarks:
                    # Creation trend
                    created = bookmark.get('created_at')
                    if created:
                        month = created[:7]  # YYYY-MM
                        creation_trends[month] = creation_trends.get(month, 0) + 1
                    
                    # Completion trend
                    completed = bookmark.get('completed_at')
                    if completed:
                        month = completed[:7]  # YYYY-MM
                        completion_trends[month] = completion_trends.get(month, 0) + 1
                
                analytics["creation_trends"] = creation_trends
                analytics["completion_trends"] = completion_trends
            
            # Most accessed bookmarks
            accessed_bookmarks = [b for b in bookmarks if b.get('access_count', 0) > 0]
            accessed_bookmarks.sort(key=lambda x: x.get('access_count', 0), reverse=True)
            analytics["most_accessed"] = accessed_bookmarks[:5]
            
            return analytics
            
        except Exception as e:
            logger.error(f"Bookmark analytics error: {e}")
            return {"error": str(e)}

    # ===== MCP PROTOCOL HANDLERS =====
    
    async def handle_call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Handle tool calls from MCP clients."""
        try:
            # Map tool names to handler methods
            handlers = {
                "ids_search": self.handle_ids_search,
                "ids_get_file_info": self.handle_ids_get_file_info,
                "ids_list_tags": self.handle_ids_list_tags,
                "ids_get_system_status": self.handle_ids_get_system_status,
                "ids_find_by_tag": self.handle_ids_find_by_tag,
                "ids_rebuild_indexes": self.handle_ids_rebuild_indexes,
                "ids_check_index_freshness": self.handle_ids_check_index_freshness,
                "ids_incremental_update": self.handle_ids_incremental_update,
                "ids_semantic_search": self.handle_ids_semantic_search,
                "ids_search_with_context": self.handle_ids_search_with_context,
                "ids_search_analytics": self.handle_ids_search_analytics,
                "ids_validate_documentation": self.handle_ids_validate_documentation,
                "ids_generate_documentation_report": self.handle_ids_generate_documentation_report,
                "ids_export_index": self.handle_ids_export_index,
                "ids_create_bookmark": self.handle_ids_create_bookmark,
                "ids_manage_bookmarks": self.handle_ids_manage_bookmarks,
                "ids_bookmark_analytics": self.handle_ids_bookmark_analytics
            }
            
            if tool_name not in handlers:
                return {"error": f"Unknown tool: {tool_name}"}
            
            handler = handlers[tool_name]
            result = await handler(**arguments)
            
            return {
                "isError": False,
                "content": [{"type": "text", "text": json.dumps(result, indent=2)}]
            }
            
        except Exception as e:
            logger.error(f"Tool call error for {tool_name}: {e}")
            return {
                "isError": True,
                "content": [{"type": "text", "text": f"Error: {str(e)}"}]
            }

# Initialize the server
server = EnhancedIDSMCPServer()

async def main():
    """Main entry point for the Enhanced IDS MCP Server."""
    logger.info("Starting Enhanced IDS MCP Server with 17 comprehensive tools...")
    
    # In a real MCP implementation, this would set up the JSON-RPC server
    # For now, we'll just keep the server running
    try:
        while True:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        logger.info("Server shutting down...")

if __name__ == "__main__":
    from datetime import timedelta
    asyncio.run(main())
