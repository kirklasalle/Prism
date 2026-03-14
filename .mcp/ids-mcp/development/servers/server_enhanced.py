#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\servers\server_enhanced.py #documentation #python #source_code  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\servers\server_enhanced.py #documentation #python #source_code  
**Category:** Source Code  
**Status:** Active

"""
ImpressionCore Documentation System (IDS) MCP Server - ENHANCED VERSION
=======================================================================

Enhanced Model Context Protocol server for comprehensive IDS functionality.
Provides 17 tools for complete documentation system management including
search, indexing, bookmark management, and analytics.

Features:
- Enhanced search capabilities with semantic search and context
- Complete index management (rebuild, incremental updates, validation)
- Bookmark system integration and management
- Documentation analytics and reporting
- Real-time search across 1,667+ files with 2,900+ tags
- Rich formatting and status updates

Author: ImpressionCore IDS Team
Created: 2025-06-05
Enhanced: 2025-01-07
Version: 2.0.0 (Enhanced with 17 tools)
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
        logging.FileHandler(CURRENT_DIR / 'ids_mcp_enhanced.log')
    ]
)
logger = logging.getLogger("ids-mcp-enhanced-server")

class EnhancedIDSMCPServer:
    """Enhanced MCP Server for ImpressionCore Documentation System with 17 tools."""
    
    def __init__(self):
        self.version = "2.0.0"
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
        
        logger.info("Enhanced IDS MCP Server initialized with 17 tools")
    
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

    def check_index_freshness(self) -> Dict[str, Any]:
        """Check if index files need updates based on file modification times."""
        index_files = [
            DOCS_ROOT / "unified_tags_index.yaml",
            DOCS_ROOT / "file_metadata.yaml", 
            DOCS_ROOT / "reverse_tag_index.yaml"
        ]
        
        freshness_report = {
            "status": "fresh",
            "stale_files": [],
            "recommendations": []
        }
        
        for index_file in index_files:
            if index_file.exists():
                current_mtime = index_file.stat().st_mtime
                stored_mtime = self.index_mtimes.get(str(index_file), 0)
                
                if current_mtime > stored_mtime:
                    freshness_report["stale_files"].append(str(index_file))
                    freshness_report["status"] = "stale"
                    
                self.index_mtimes[str(index_file)] = current_mtime
        
        if freshness_report["stale_files"]:
            freshness_report["recommendations"].append("Run incremental index update")
            
        return freshness_report

    # MCP Tool Implementations
    # ========================

    # Original 5 tools (enhanced versions)
    async def search_documents(self, query: str, max_results: int = 10, tags: List[str] = None) -> Dict[str, Any]:
        """Enhanced document search with improved relevance and filtering."""
        try:
            if self.enhanced_ids:
                # Use the unified search from enhanced_ids
                results = self.enhanced_ids.unified_search(query)
                
                # Format results
                formatted_results = []
                for file_path, matched_tags in results[:max_results]:
                    formatted_results.append({
                        "file": file_path,
                        "matched_tags": matched_tags,
                        "relevance": len(matched_tags) / max(len(matched_tags), 1)
                    })
                
                # Filter by tags if provided
                if tags:
                    filtered_results = []
                    for result in formatted_results:
                        result_tags = result.get('matched_tags', [])
                        if any(tag in result_tags for tag in tags):
                            filtered_results.append(result)
                    formatted_results = filtered_results
                
                return {
                    "query": query,
                    "total_results": len(results),
                    "max_results": max_results,
                    "filter_tags": tags,
                    "results": formatted_results
                }
            else:
                # Fallback to basic index search
                results = []
                query_lower = query.lower()
                
                for file_path, file_tags in self.unified_index.items():
                    matched_tags = [tag for tag in file_tags if query_lower in tag.lower()]
                    if matched_tags:
                        results.append({
                            "file": file_path,
                            "matched_tags": matched_tags,
                            "relevance": len(matched_tags) / len(file_tags) if file_tags else 0
                        })
                
                # Sort by relevance and limit results
                results.sort(key=lambda x: x["relevance"], reverse=True)
                results = results[:max_results]
                
                return {
                    "query": query,
                    "total_results": len(results),
                    "max_results": max_results,
                    "filter_tags": tags,
                    "results": results
                }
                
        except Exception as e:
            logger.error(f"Search error: {e}")
            return {"error": f"Search failed: {str(e)}"}

    async def find_by_tag(self, tags: List[str], match_all: bool = False) -> Dict[str, Any]:
        """Find files by tags with AND/OR logic."""
        try:
            if not tags:
                return {"error": "No tags provided"}
            
            matching_files = set()
            
            if match_all:
                # AND logic - file must have ALL tags
                for tag in tags:
                    tag_files = set(self.reverse_index.get(tag, []))
                    if not matching_files:
                        matching_files = tag_files
                    else:
                        matching_files = matching_files.intersection(tag_files)
            else:
                # OR logic - file must have ANY tag
                for tag in tags:
                    tag_files = self.reverse_index.get(tag, [])
                    matching_files.update(tag_files)
            
            # Enrich results with metadata
            results = []
            for file_path in matching_files:
                file_info = self.file_metadata.get(file_path, {})
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

    async def get_file_info(self, file_path: str) -> Dict[str, Any]:
        """Get detailed information about a specific file."""
        try:
            # Try both path formats (forward and backslash)
            normalized_path_forward = file_path.replace('\\', '/')
            normalized_path_back = file_path.replace('/', '\\')
            
            # Get metadata using either format
            metadata = (self.file_metadata.get(normalized_path_forward) or 
                       self.file_metadata.get(normalized_path_back) or
                       self.file_metadata.get(file_path))
            
            if not metadata:
                return {"error": f"File not found in index: {file_path}"}
            
            # Use the actual path that was found
            actual_path = None
            for path_variant in [normalized_path_forward, normalized_path_back, file_path]:
                if path_variant in self.file_metadata:
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

    async def list_tags(self, category: str = None, pattern: str = None) -> Dict[str, Any]:
        """List all available tags with optional filtering."""
        try:
            all_tags = list(self.reverse_index.keys())
            
            # Filter by pattern if provided
            if pattern:
                all_tags = [tag for tag in all_tags if pattern.lower() in tag.lower()]
            
            # Filter by category if provided
            if category:
                all_tags = [tag for tag in all_tags if category.lower() in tag.lower()]
            
            # Sort tags by usage count
            tag_usage = [(tag, len(self.reverse_index[tag])) for tag in all_tags]
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

    async def get_system_status(self) -> Dict[str, Any]:
        """Get current status and statistics of the IDS system."""
        try:
            status = {
                "version": self.version,
                "timestamp": datetime.now().isoformat(),
                "system_health": "healthy",
                "statistics": {
                    "total_files": len(self.file_metadata),
                    "total_tags": len(self.reverse_index),
                    "total_bookmarks": sum(len(cat) for cat in self.bookmarks_db.values()),
                    "index_entries": len(self.unified_index)
                },
                "index_status": {},
                "bookmark_categories": list(self.bookmarks_db.keys())
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

    # Enhanced Search Tools (New)
    async def semantic_search(self, query: str, category: str = None, max_results: int = 10) -> Dict[str, Any]:
        """Perform semantic search across documentation with category filtering."""
        try:
            # Use the basic search with enhanced processing
            search_result = await self.search_documents(query, max_results * 2)  # Get more results for filtering
            
            if "error" in search_result:
                return search_result
            
            results = search_result.get("results", [])
            
            # Category filtering
            if category:
                results = [r for r in results if category.lower() in r.get('file', '').lower()]
            
            # Semantic relevance scoring (enhanced)
            for result in results:
                # Calculate semantic score based on matched tags and query overlap
                matched_tags = result.get('matched_tags', [])
                query_words = set(query.lower().split())
                tag_words = set(' '.join(matched_tags).lower().split())
                
                # Jaccard similarity
                intersection = query_words.intersection(tag_words)
                union = query_words.union(tag_words)
                result['semantic_score'] = len(intersection) / len(union) if union else 0
            
            # Sort by semantic score and limit results
            results.sort(key=lambda x: x.get('semantic_score', 0), reverse=True)
            results = results[:max_results]
                    
            return {
                "query": query,
                "category": category,
                "max_results": max_results,
                "total_results": len(results),
                "results": results,
                "semantic_results": results,
                "algorithm": "jaccard_similarity",
                "search_type": "semantic_search"
            }
            
        except Exception as e:
            logger.error(f"Semantic search error: {e}")
            return {"error": f"Semantic search failed: {str(e)}"}

    async def search_with_context(self, query: str, context_lines: int = 3, max_results: int = 10) -> Dict[str, Any]:
        """Search with extended context around matches."""
        try:
            # Get initial search results
            search_results = await self.search_documents(query, max_results)
            
            if "error" in search_results:
                return search_results
                
            # Enhance results with context
            enhanced_results = []
            for result in search_results.get("results", []):
                try:
                    file_path = PROJECT_ROOT / result["path"]
                    if file_path.exists() and file_path.is_file():
                        with open(file_path, 'r', encoding='utf-8') as f:
                            content = f.read()
                            
                        # Find query matches and add context
                        lines = content.split('\n')
                        matches_with_context = []
                        
                        for i, line in enumerate(lines):
                            if query.lower() in line.lower():
                                start = max(0, i - context_lines)
                                end = min(len(lines), i + context_lines + 1)
                                context_block = {
                                    "line_number": i + 1,
                                    "match_line": line,
                                    "context": lines[start:end]
                                }
                                matches_with_context.append(context_block)
                                
                        result["matches_with_context"] = matches_with_context
                        
                    enhanced_results.append(result)
                    
                except Exception as e:
                    logger.warning(f"Could not add context for {result.get('path', 'unknown')}: {e}")
                    enhanced_results.append(result)
                    
            return {
                "query": query,
                "context_lines": context_lines,
                "total_results": len(enhanced_results),
                "results": enhanced_results,
                "search_type": "contextual_search"
            }
            
        except Exception as e:
            logger.error(f"Contextual search error: {e}")
            return {"error": f"Contextual search failed: {str(e)}"}

    async def get_search_analytics(self, days: int = 30) -> Dict[str, Any]:
        """Get search analytics and usage statistics."""
        try:
            # Read search logs if available
            log_file = CURRENT_DIR / 'ids_mcp_enhanced.log'
            analytics = {
                "period_days": days,
                "total_searches": 0,
                "unique_queries": set(),
                "popular_queries": {},
                "search_types": {},
                "error_rate": 0,
                "avg_results_per_search": 0
            }
            
            if log_file.exists():
                with open(log_file, 'r') as f:
                    lines = f.readlines()
                    
                for line in lines:
                    if "search" in line.lower():
                        analytics["total_searches"] += 1
                        # Extract query patterns and types from logs
                        
            # Add system statistics
            analytics.update({
                "indexed_files": len(self.file_metadata),
                "total_tags": len(self.reverse_index),
                "bookmark_categories": len(self.bookmarks_db),
                "total_bookmarks": sum(len(cat) for cat in self.bookmarks_db.values())
            })
            
            # Convert set to list for JSON serialization
            analytics["unique_queries"] = list(analytics["unique_queries"])
            
            return analytics
            
        except Exception as e:
            logger.error(f"Analytics error: {e}")
            return {"error": f"Analytics generation failed: {str(e)}"}

    # Index Management Tools (New)
    async def rebuild_index(self, incremental: bool = False) -> Dict[str, Any]:
        """Rebuild or incrementally update the IDS index."""
        try:
            if not self.enhanced_ids:
                return {"error": "Enhanced IDS system not available"}
                
            start_time = datetime.now()
            
            if incremental:
                # Perform incremental update
                if hasattr(self.enhanced_ids, 'incremental_update'):
                    result = self.enhanced_ids.incremental_update()
                else:
                    return {"error": "Incremental update not supported"}
            else:
                # Full rebuild
                result = self.enhanced_ids.rebuild_indices()
                
            end_time = datetime.now()
            duration = (end_time - start_time).total_seconds()
            
            # Reload our local indices
            self.load_indices()
            
            # Handle case where result might be None or not a dict
            if not isinstance(result, dict):
                result = {"files_processed": 0, "tags_created": 0}
            
            return {
                "operation": "incremental_update" if incremental else "full_rebuild",
                "duration_seconds": duration,
                "timestamp": end_time.isoformat(),
                "files_processed": result.get("files_processed", 0),
                "tags_created": result.get("tags_created", 0),
                "status": "completed"
            }
            
        except Exception as e:
            logger.error(f"Index rebuild error: {e}")
            return {"error": f"Index rebuild failed: {str(e)}"}

    async def incremental_update(self, file_paths: List[str] = None) -> Dict[str, Any]:
        """Perform incremental index update for specific files or recent changes."""
        try:
            if not self.enhanced_ids:
                return {"error": "Enhanced IDS system not available"}
                
            start_time = datetime.now()
            
            if file_paths:
                # Update specific files
                result = {"files_processed": 0, "tags_created": 0}
                for file_path in file_paths:
                    if hasattr(self.enhanced_ids, 'process_single_file'):
                        file_result = self.enhanced_ids.process_single_file(file_path)
                        result["files_processed"] += 1
                        result["tags_created"] += file_result.get("tags_created", 0)
            else:
                # Auto-detect changed files
                if hasattr(self.enhanced_ids, 'incremental_update'):
                    result = self.enhanced_ids.incremental_update()
                else:
                    result = {"error": "Auto-detection not supported"}
                    
            end_time = datetime.now()
            duration = (end_time - start_time).total_seconds()
            
            # Reload indices
            self.load_indices()
            
            # Handle case where result might be None or not a dict
            if not isinstance(result, dict):
                result = {"files_processed": 0, "tags_created": 0}
            
            return {
                "operation": "incremental_update",
                "duration_seconds": duration,
                "timestamp": end_time.isoformat(),
                "files_processed": result.get("files_processed", 0),
                "tags_created": result.get("tags_created", 0),
                "updated_files": file_paths or [],
                "files_updated": len(file_paths) if file_paths else result.get("files_processed", 0),
                "status": "completed"
            }
            
        except Exception as e:
            logger.error(f"Incremental update error: {e}")
            return {"error": f"Incremental update failed: {str(e)}"}

    async def check_index_freshness_tool(self) -> Dict[str, Any]:
        """Check index freshness and recommend updates."""
        try:
            freshness = self.check_index_freshness()
            
            # Add more detailed analysis
            freshness["index_stats"] = {
                "total_files": len(self.file_metadata),
                "total_tags": len(self.reverse_index),
                "unified_entries": len(self.unified_index)
            }
            
            # Check for missing files
            missing_files = []
            for file_path in self.file_metadata:
                if not (PROJECT_ROOT / file_path).exists():
                    missing_files.append(file_path)
                    
            if missing_files:
                freshness["missing_files"] = missing_files
                freshness["recommendations"].append("Remove missing files from index")
                
            return freshness
            
        except Exception as e:
            logger.error(f"Index freshness check error: {e}")
            return {"error": f"Index freshness check failed: {str(e)}"}

    # Documentation Management Tools (New)
    async def validate_documentation(self, fix_issues: bool = False) -> Dict[str, Any]:
        """Validate documentation structure and content."""
        try:
            validation_report = {
                "status": "valid",
                "issues": [],
                "fixes_applied": [],
                "statistics": {}
            }
            
            # Validate file structure
            required_files = [
                "docs/DOCUMENTATION_INDEX.md",
                "docs/prd.md",
                "docs/user_guide.md"
            ]
            
            for req_file in required_files:
                if not (PROJECT_ROOT / req_file).exists():
                    validation_report["issues"].append(f"Missing required file: {req_file}")
                    
            # Check index consistency
            indexed_files = set(self.file_metadata.keys())
            actual_files = set()
            
            for root, dirs, files in os.walk(PROJECT_ROOT):
                for file in files:
                    if file.endswith(('.md', '.txt', '.py', '.yaml', '.json')):
                        rel_path = os.path.relpath(os.path.join(root, file), PROJECT_ROOT)
                        actual_files.add(rel_path.replace('\\', '/'))
                        
            orphaned_files = actual_files - indexed_files
            if orphaned_files:
                validation_report["issues"].extend([f"Unindexed file: {f}" for f in list(orphaned_files)[:20]])  # Limit output
                
            validation_report["statistics"] = {
                "total_indexed_files": len(indexed_files),
                "total_actual_files": len(actual_files),
                "orphaned_files": len(orphaned_files),
                "missing_files": len(indexed_files - actual_files)
            }
            
            if validation_report["issues"]:
                validation_report["status"] = "issues_found"
                
            return validation_report
            
        except Exception as e:
            logger.error(f"Documentation validation error: {e}")
            return {"error": f"Documentation validation failed: {str(e)}"}

    async def generate_documentation_report(self, format: str = "markdown") -> Dict[str, Any]:
        """Generate comprehensive documentation report."""
        try:
            report_data = {
                "generation_time": datetime.now().isoformat(),
                "system_overview": {
                    "total_files": len(self.file_metadata),
                    "total_tags": len(self.reverse_index),
                    "total_bookmarks": sum(len(cat) for cat in self.bookmarks_db.values())
                },
                "file_distribution": {},
                "tag_analysis": {},
                "bookmark_summary": self.bookmarks_db
            }
            
            # Analyze file distribution by type and directory
            file_types = {}
            directory_counts = {}
            
            for file_path in self.file_metadata:
                # File type analysis
                ext = Path(file_path).suffix.lower()
                file_types[ext] = file_types.get(ext, 0) + 1
                
                # Directory analysis
                dir_path = str(Path(file_path).parent)
                directory_counts[dir_path] = directory_counts.get(dir_path, 0) + 1
                
            report_data["file_distribution"] = {
                "by_type": file_types,
                "by_directory": directory_counts
            }
            
            # Tag analysis
            tag_usage = {}
            for tag, files in self.reverse_index.items():
                tag_usage[tag] = len(files) if isinstance(files, list) else 1
                
            # Sort tags by usage
            sorted_tags = sorted(tag_usage.items(), key=lambda x: x[1], reverse=True)
            report_data["tag_analysis"] = {
                "most_used_tags": sorted_tags[:20],
                "total_unique_tags": len(tag_usage),
                "average_tags_per_file": sum(tag_usage.values()) / len(self.file_metadata) if self.file_metadata else 0
            }
            
            if format == "markdown":
                # Generate markdown report
                report_content = self._generate_markdown_report(report_data)
                report_path = DOCS_ROOT / f"documentation_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
                
                with open(report_path, 'w', encoding='utf-8') as f:
                    f.write(report_content)
                    
                return {
                    "format": format,
                    "report_path": str(report_path),
                    "data": report_data
                }
            else:
                return {
                    "format": format,
                    "data": report_data
                }
                
        except Exception as e:
            logger.error(f"Report generation error: {e}")
            return {"error": f"Report generation failed: {str(e)}"}

    def _generate_markdown_report(self, data: Dict[str, Any]) -> str:
        """Generate markdown format documentation report."""
        report = f"""# ImpressionCore Documentation System Report

Generated: {data['generation_time']}

## System Overview

- **Total Files**: {data['system_overview']['total_files']:,}
- **Total Tags**: {data['system_overview']['total_tags']:,}
- **Total Bookmarks**: {data['system_overview']['total_bookmarks']:,}

## File Distribution

### By File Type
"""
        
        for ext, count in sorted(data['file_distribution']['by_type'].items()):
            report += f"- **{ext or 'no extension'}**: {count:,} files\n"
            
        report += "\n### By Directory\n"
        for dir_path, count in sorted(data['file_distribution']['by_directory'].items()):
            report += f"- **{dir_path}**: {count:,} files\n"
            
        report += "\n## Tag Analysis\n\n### Most Used Tags\n"
        for tag, usage in data['tag_analysis']['most_used_tags']:
            report += f"- **{tag}**: {usage:,} files\n"
            
        report += f"\n### Statistics\n"
        report += f"- **Total Unique Tags**: {data['tag_analysis']['total_unique_tags']:,}\n"
        report += f"- **Average Tags per File**: {data['tag_analysis']['average_tags_per_file']:.2f}\n"
        
        report += "\n## Bookmark Summary\n"
        for category, bookmarks in data['bookmark_summary'].items():
            report += f"- **{category.replace('_', ' ').title()}**: {len(bookmarks)} items\n"
            
        return report

    async def export_index_data(self, format: str = "json", include_content: bool = False) -> Dict[str, Any]:
        """Export index data in various formats."""
        try:
            export_data = {
                "metadata": {
                    "export_time": datetime.now().isoformat(),
                    "version": self.version,
                    "total_files": len(self.file_metadata),
                    "total_tags": len(self.reverse_index)
                },
                "file_metadata": self.file_metadata,
                "unified_index": self.unified_index,
                "reverse_index": self.reverse_index,
                "bookmarks": self.bookmarks_db
            }
            
            if include_content:
                # Add file content for supported formats (limit to avoid huge exports)
                content_data = {}
                for file_path in list(self.file_metadata.keys())[:100]:  # Limit to 100 files
                    try:
                        full_path = PROJECT_ROOT / file_path
                        if full_path.exists() and full_path.stat().st_size < 1024 * 1024:  # < 1MB
                            with open(full_path, 'r', encoding='utf-8') as f:
                                content_data[file_path] = f.read()
                    except Exception as e:
                        logger.warning(f"Could not read content for {file_path}: {e}")
                        
                export_data["file_content"] = content_data
                
            # Save export file
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            
            if format == "json":
                export_path = DOCS_ROOT / f"ids_export_{timestamp}.json"
                with open(export_path, 'w', encoding='utf-8') as f:
                    json.dump(export_data, f, indent=2, ensure_ascii=False)
            elif format == "yaml":
                export_path = DOCS_ROOT / f"ids_export_{timestamp}.yaml"
                with open(export_path, 'w', encoding='utf-8') as f:
                    yaml.dump(export_data, f, default_flow_style=False, allow_unicode=True)
            else:
                return {"error": f"Unsupported export format: {format}"}
                
            return {
                "format": format,
                "export_path": str(export_path),
                "file_size": export_path.stat().st_size,
                "included_content": include_content,
                "files_exported": len(export_data.get("file_content", {})) if include_content else 0
            }
            
        except Exception as e:
            logger.error(f"Export error: {e}")
            return {"error": f"Export failed: {str(e)}"}

    # Bookmark Management Tools (New)
    async def create_bookmark(self, title: str, file_path: str, category: str = "review_engagement",
                            description: str = "", tags: List[str] = None) -> Dict[str, Any]:
        """Create a new bookmark in the specified category."""
        try:
            bookmark = {
                "title": title,
                "file_path": file_path,
                "description": description,
                "tags": tags or [],
                "created_at": datetime.now().isoformat(),
                "id": hashlib.md5(f"{title}{file_path}{datetime.now()}".encode()).hexdigest()[:8]
            }
            
            if category not in self.bookmarks_db:
                self.bookmarks_db[category] = []
                
            self.bookmarks_db[category].append(bookmark)
            
            # Save bookmarks
            await self._save_bookmarks()
            
            return {
                "status": "created",
                "bookmark": bookmark,
                "category": category
            }
            
        except Exception as e:
            logger.error(f"Bookmark creation error: {e}")
            return {"error": f"Bookmark creation failed: {str(e)}"}

    async def manage_bookmarks(self, action: str, bookmark_id: str = None, 
                             category: str = None, **kwargs) -> Dict[str, Any]:
        """Manage bookmarks (list, delete, update, move)."""
        try:
            if action == "list":
                if category:
                    return {"category": category, "bookmarks": self.bookmarks_db.get(category, [])}
                else:
                    return {"all_bookmarks": self.bookmarks_db}
                    
            elif action == "delete":
                if not bookmark_id:
                    return {"error": "bookmark_id required for delete action"}
                    
                deleted = False
                for cat_name, bookmarks in self.bookmarks_db.items():
                    for i, bookmark in enumerate(bookmarks):
                        if bookmark.get("id") == bookmark_id:
                            deleted_bookmark = bookmarks.pop(i)
                            deleted = True
                            break
                    if deleted:
                        break
                        
                if deleted:
                    await self._save_bookmarks()
                    return {"status": "deleted", "bookmark_id": bookmark_id}
                else:
                    return {"error": f"Bookmark {bookmark_id} not found"}
                    
            elif action == "update":
                if not bookmark_id:
                    return {"error": "bookmark_id required for update action"}
                    
                # Find and update bookmark
                for cat_name, bookmarks in self.bookmarks_db.items():
                    for bookmark in bookmarks:
                        if bookmark.get("id") == bookmark_id:
                            for key, value in kwargs.items():
                                if key in ["title", "description", "tags", "file_path"]:
                                    bookmark[key] = value
                            bookmark["updated_at"] = datetime.now().isoformat()
                            await self._save_bookmarks()
                            return {"status": "updated", "bookmark": bookmark}
                            
                return {"error": f"Bookmark {bookmark_id} not found"}
                
            elif action == "move":
                if not bookmark_id or not category:
                    return {"error": "bookmark_id and category required for move action"}
                    
                # Find bookmark and move to new category
                bookmark_to_move = None
                source_category = None
                
                for cat_name, bookmarks in self.bookmarks_db.items():
                    for i, bookmark in enumerate(bookmarks):
                        if bookmark.get("id") == bookmark_id:
                            bookmark_to_move = bookmarks.pop(i)
                            source_category = cat_name
                            break
                    if bookmark_to_move:
                        break
                        
                if bookmark_to_move:
                    if category not in self.bookmarks_db:
                        self.bookmarks_db[category] = []
                    self.bookmarks_db[category].append(bookmark_to_move)
                    await self._save_bookmarks()
                    return {
                        "status": "moved",
                        "bookmark_id": bookmark_id,
                        "from_category": source_category,
                        "to_category": category
                    }
                else:
                    return {"error": f"Bookmark {bookmark_id} not found"}
                    
            else:
                return {"error": f"Unsupported action: {action}"}
                
        except Exception as e:
            logger.error(f"Bookmark management error: {e}")
            return {"error": f"Bookmark management failed: {str(e)}"}

    async def get_bookmark_analytics(self) -> Dict[str, Any]:
        """Get bookmark usage analytics and statistics."""
        try:
            analytics = {
                "total_bookmarks": sum(len(cat) for cat in self.bookmarks_db.values()),
                "categories": {}
            }
            
            for category, bookmarks in self.bookmarks_db.items():
                category_stats = {
                    "count": len(bookmarks),
                    "recent_bookmarks": len([
                        b for b in bookmarks 
                        if datetime.fromisoformat(b.get("created_at", "2000-01-01T00:00:00")) > 
                           datetime.now().replace(day=1)  # This month
                    ]),
                    "top_tags": {}
                }
                
                # Analyze tags
                tag_counts = {}
                for bookmark in bookmarks:
                    for tag in bookmark.get("tags", []):
                        tag_counts[tag] = tag_counts.get(tag, 0) + 1
                        
                category_stats["top_tags"] = dict(sorted(tag_counts.items(), 
                                                       key=lambda x: x[1], reverse=True)[:10])
                                                       
                analytics["categories"][category] = category_stats
                
            return analytics
            
        except Exception as e:
            logger.error(f"Bookmark analytics error: {e}")
            return {"error": f"Bookmark analytics failed: {str(e)}"}

    async def _save_bookmarks(self):
        """Save bookmarks to file."""
        try:
            bookmarks_path = DOCS_ROOT / "bookmarks.yaml"
            with open(bookmarks_path, 'w', encoding='utf-8') as f:
                yaml.dump(self.bookmarks_db, f, default_flow_style=False, allow_unicode=True)
        except Exception as e:
            logger.error(f"Failed to save bookmarks: {e}")


# Global server instance for handler functions
server = None

def get_server():
    """Get or create the global server instance."""
    global server
    if server is None:
        server = EnhancedIDSMCPServer()
    return server

# MCP Tool Handler Functions
# ==========================

async def handle_search(arguments: Dict[str, Any]) -> Dict[str, Any]:
    """Handle document search requests."""
    query = arguments.get("query", "")
    max_results = arguments.get("max_results", 10)
    tags = arguments.get("tags", [])
    
    return await get_server().search_documents(query, max_results, tags)

async def handle_find_by_tag(arguments: Dict[str, Any]) -> Dict[str, Any]:
    """Handle tag-based file search requests."""
    tags = arguments.get("tags", [])
    match_all = arguments.get("match_all", False)
    
    return await get_server().find_by_tag(tags, match_all)

async def handle_get_file_info(arguments: Dict[str, Any]) -> Dict[str, Any]:
    """Handle file information requests."""
    file_path = arguments.get("file_path", "")
    
    return await get_server().get_file_info(file_path)

async def handle_list_tags(arguments: Dict[str, Any]) -> Dict[str, Any]:
    """Handle tag listing requests."""
    category = arguments.get("category")
    pattern = arguments.get("pattern")
    
    return await get_server().list_tags(category, pattern)

async def handle_get_system_status(arguments: Dict[str, Any]) -> Dict[str, Any]:
    """Handle system status requests."""
    return await get_server().get_system_status()

# Enhanced Tool Handlers
async def handle_semantic_search(arguments: Dict[str, Any]) -> Dict[str, Any]:
    """Handle semantic search requests."""
    query = arguments.get("query", "")
    category = arguments.get("category")
    max_results = arguments.get("max_results", 10)
    
    return await get_server().semantic_search(query, category, max_results)

async def handle_search_with_context(arguments: Dict[str, Any]) -> Dict[str, Any]:
    """Handle contextual search requests."""
    query = arguments.get("query", "")
    context_lines = arguments.get("context_lines", 3)
    max_results = arguments.get("max_results", 10)
    
    return await get_server().search_with_context(query, context_lines, max_results)

async def handle_get_search_analytics(arguments: Dict[str, Any]) -> Dict[str, Any]:
    """Handle search analytics requests."""
    days = arguments.get("days", 30)
    
    return await get_server().get_search_analytics(days)

async def handle_rebuild_index(arguments: Dict[str, Any]) -> Dict[str, Any]:
    """Handle index rebuild requests."""
    incremental = arguments.get("incremental", False)
    
    return await get_server().rebuild_index(incremental)

async def handle_incremental_update(arguments: Dict[str, Any]) -> Dict[str, Any]:
    """Handle incremental update requests."""
    file_paths = arguments.get("file_paths")
    
    return await get_server().incremental_update(file_paths)

async def handle_check_index_freshness(arguments: Dict[str, Any]) -> Dict[str, Any]:
    """Handle index freshness check requests."""
    return await get_server().check_index_freshness_tool()

async def handle_validate_documentation(arguments: Dict[str, Any]) -> Dict[str, Any]:
    """Handle documentation validation requests."""
    fix_issues = arguments.get("fix_issues", False)
    
    return await get_server().validate_documentation(fix_issues)

async def handle_generate_documentation_report(arguments: Dict[str, Any]) -> Dict[str, Any]:
    """Handle documentation report generation requests."""
    format = arguments.get("format", "markdown")
    
    return await get_server().generate_documentation_report(format)

async def handle_export_index_data(arguments: Dict[str, Any]) -> Dict[str, Any]:
    """Handle index data export requests."""
    format = arguments.get("format", "json")
    include_content = arguments.get("include_content", False)
    
    return await get_server().export_index_data(format, include_content)

async def handle_create_bookmark(arguments: Dict[str, Any]) -> Dict[str, Any]:
    """Handle bookmark creation requests."""
    title = arguments.get("title", "")
    file_path = arguments.get("file_path", "")
    category = arguments.get("category", "review_engagement")
    description = arguments.get("description", "")
    tags = arguments.get("tags", [])
    
    return await get_server().create_bookmark(title, file_path, category, description, tags)

async def handle_manage_bookmarks(arguments: Dict[str, Any]) -> Dict[str, Any]:
    """Handle bookmark management requests."""
    action = arguments.get("action", "list")
    bookmark_id = arguments.get("bookmark_id")
    category = arguments.get("category")
    
    # Pass all other arguments as kwargs for updates
    kwargs = {k: v for k, v in arguments.items() if k not in ["action", "bookmark_id", "category"]}
    
    return await get_server().manage_bookmarks(action, bookmark_id, category, **kwargs)

async def handle_get_bookmark_analytics(arguments: Dict[str, Any]) -> Dict[str, Any]:
    """Handle bookmark analytics requests."""
    return await get_server().get_bookmark_analytics()


# MCP Server Implementation
# ========================

async def serve():
    """Main MCP server implementation using mcp library."""
    try:
        from mcp.server import Server
        from mcp.server.stdio import stdio_server
        from mcp.types import (
            Tool, 
            TextContent, 
            CallToolResult,
            ListToolsResult
        )
    except ImportError:
        logger.error("MCP library not found. Install with: pip install mcp")
        return

    # Initialize our IDS server
    ids_server = EnhancedIDSMCPServer()
    
    # Create MCP server
    mcp_server = Server("impressioncore-ids")
    
    # Define tool handlers mapping
    tool_handlers = {
        "search": handle_search,
        "find_by_tag": handle_find_by_tag,
        "get_file_info": handle_get_file_info,
        "list_tags": handle_list_tags,
        "get_system_status": handle_get_system_status,
        "semantic_search": handle_semantic_search,
        "search_with_context": handle_search_with_context,
        "get_search_analytics": handle_get_search_analytics,
        "rebuild_index": handle_rebuild_index,
        "incremental_update": handle_incremental_update,
        "check_index_freshness": handle_check_index_freshness,
        "validate_documentation": handle_validate_documentation,
        "generate_documentation_report": handle_generate_documentation_report,
        "export_index_data": handle_export_index_data,
        "create_bookmark": handle_create_bookmark,
        "manage_bookmarks": handle_manage_bookmarks,
        "get_bookmark_analytics": handle_get_bookmark_analytics
    }
    
    @mcp_server.list_tools()
    async def list_tools() -> ListToolsResult:
        """List all available IDS tools."""
        tools = [
            # Core Search Tools
            Tool(
                name="search",
                description="Search ImpressionCore documentation with query, tags, and result limits",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query"},
                        "max_results": {"type": "integer", "description": "Maximum results to return", "default": 10},
                        "tags": {"type": "array", "items": {"type": "string"}, "description": "Filter by tags"}
                    },
                    "required": ["query"]
                }
            ),
            Tool(
                name="find_by_tag",
                description="Find files by tags with AND/OR logic",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "tags": {"type": "array", "items": {"type": "string"}, "description": "Tags to search for"},
                        "match_all": {"type": "boolean", "description": "Require all tags (AND) vs any tag (OR)", "default": False}
                    },
                    "required": ["tags"]
                }
            ),
            Tool(
                name="get_file_info",
                description="Get detailed information about a specific file",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "file_path": {"type": "string", "description": "Path to the file"}
                    },
                    "required": ["file_path"]
                }
            ),
            Tool(
                name="list_tags",
                description="List all available tags with optional filtering",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "category": {"type": "string", "description": "Filter by category"},
                        "pattern": {"type": "string", "description": "Filter by pattern"}
                    }
                }
            ),
            Tool(
                name="get_system_status",
                description="Get current status and statistics of the IDS system",
                inputSchema={"type": "object", "properties": {}}
            ),
            
            # Enhanced Search Tools
            Tool(
                name="semantic_search",
                description="Perform semantic search with enhanced relevance scoring",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query"},
                        "category": {"type": "string", "description": "Filter by category"},
                        "max_results": {"type": "integer", "description": "Maximum results", "default": 10}
                    },
                    "required": ["query"]
                }
            ),
            Tool(
                name="search_with_context",
                description="Search with extended context around matches",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Search query"},
                        "context_lines": {"type": "integer", "description": "Lines of context", "default": 3},
                        "max_results": {"type": "integer", "description": "Maximum results", "default": 10}
                    },
                    "required": ["query"]
                }
            ),
            Tool(
                name="get_search_analytics",
                description="Get search analytics and usage statistics",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "days": {"type": "integer", "description": "Analysis period in days", "default": 30}
                    }
                }
            ),
            
            # Index Management Tools
            Tool(
                name="rebuild_index",
                description="Rebuild or incrementally update the IDS index",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "incremental": {"type": "boolean", "description": "Perform incremental update", "default": False}
                    }
                }
            ),
            Tool(
                name="incremental_update",
                description="Perform incremental index update for specific files",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "file_paths": {"type": "array", "items": {"type": "string"}, "description": "Specific files to update"}
                    }
                }
            ),
            Tool(
                name="check_index_freshness",
                description="Check index freshness and recommend updates",
                inputSchema={"type": "object", "properties": {}}
            ),
            
            # Documentation Management Tools
            Tool(
                name="validate_documentation",
                description="Validate documentation structure and content",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "fix_issues": {"type": "boolean", "description": "Attempt to fix found issues", "default": False}
                    }
                }
            ),
            Tool(
                name="generate_documentation_report",
                description="Generate comprehensive documentation report",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "format": {"type": "string", "description": "Report format (markdown/json)", "default": "markdown"}
                    }
                }
            ),
            Tool(
                name="export_index_data",
                description="Export index data in various formats",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "format": {"type": "string", "description": "Export format (json/yaml)", "default": "json"},
                        "include_content": {"type": "boolean", "description": "Include file content", "default": False}
                    }
                }
            ),
            
            # Bookmark Management Tools
            Tool(
                name="create_bookmark",
                description="Create a new bookmark in the specified category",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "description": "Bookmark title"},
                        "file_path": {"type": "string", "description": "Path to the file"},
                        "category": {"type": "string", "description": "Bookmark category", "default": "review_engagement"},
                        "description": {"type": "string", "description": "Bookmark description"},
                        "tags": {"type": "array", "items": {"type": "string"}, "description": "Bookmark tags"}
                    },
                    "required": ["title", "file_path"]
                }
            ),
            Tool(
                name="manage_bookmarks",
                description="Manage bookmarks (list, delete, update, move)",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "action": {"type": "string", "description": "Action to perform", "enum": ["list", "delete", "update", "move"]},
                        "bookmark_id": {"type": "string", "description": "Bookmark ID for operations"},
                        "category": {"type": "string", "description": "Category for list/move operations"},
                        "title": {"type": "string", "description": "New title for update"},
                        "description": {"type": "string", "description": "New description for update"},
                        "tags": {"type": "array", "items": {"type": "string"}, "description": "New tags for update"}
                    },
                    "required": ["action"]
                }
            ),
            Tool(
                name="get_bookmark_analytics",
                description="Get bookmark usage analytics and statistics",
                inputSchema={"type": "object", "properties": {}}
            )
        ]
        
        return ListToolsResult(tools=tools)
    
    @mcp_server.call_tool()
    async def call_tool(name: str, arguments: dict) -> CallToolResult:
        """Handle tool calls."""
        try:
            if name in tool_handlers:
                result = await tool_handlers[name](arguments)
                
                # Format result as text content
                if isinstance(result, dict):
                    formatted_result = json.dumps(result, indent=2, ensure_ascii=False)
                else:
                    formatted_result = str(result)
                
                return CallToolResult(
                    content=[TextContent(
                        type="text",
                        text=formatted_result
                    )]
                )
            else:
                return CallToolResult(
                    content=[TextContent(
                        type="text", 
                        text=json.dumps({"error": f"Unknown tool: {name}"}, indent=2)
                    )]
                )
        except Exception as e:
            logger.error(f"Tool call error for {name}: {e}")
            return CallToolResult(
                content=[TextContent(
                    type="text",
                    text=json.dumps({"error": f"Tool execution failed: {str(e)}"}, indent=2)
                )]
            )
    
    # Run the server using context manager
    logger.info("Starting Enhanced IDS MCP Server...")
    async with stdio_server() as streams:
        await mcp_server.run(
            streams[0], streams[1], mcp_server.create_initialization_options()
        )

if __name__ == "__main__":
    asyncio.run(serve())
