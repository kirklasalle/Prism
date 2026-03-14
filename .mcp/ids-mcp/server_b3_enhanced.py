#!/usr/bin/env python3
"""ImpressionCore Documentation System (IDS) MCP Server - B3 Enhanced Version

Created: October 15, 2024
Updated: August 15, 2025
Author: ImpressionCore IDS Team (Kirk LaSalle & GitHub Copilot)
Tags: #mcp_server #ids_system #b3_enhancement #automation #documentation_tools #source_code
Category: Infrastructure
Status: Active

Description:
    Model Context Protocol server for accessing the ImpressionCore Documentation System.
    Includes automated header standardization, documentation indexing, system validation,
    enhanced error handling, and intelligent tag generation.

Version: 1.2.0 (B3 Enhanced)
"""

import json
import sys
import os
import yaml
import time
import traceback
from pathlib import Path
from typing import Dict, List, Optional, Any, Union
from datetime import datetime
import subprocess
import re

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

class IDSMCPServerB3Enhanced:
    """B3 Enhanced MCP Server for ImpressionCore Documentation System."""
    
    def __init__(self):
        self.enhanced_ids = None
        self.unified_index = {}
        self.file_metadata = {}
        self.reverse_index = {}
        self.last_refresh = 0
        self.refresh_interval = 10  # Minimum seconds between refreshes
        self.error_count = 0
        self.search_count = 0
        self.tool_execution_count = 0
        
        # B3 Enhancement: Track tool usage and performance
        self.tool_stats = {
            'header_updater_runs': 0,
            'documentation_indexer_runs': 0,
            'system_validator_runs': 0,
            'total_files_processed': 0,
            'last_maintenance': None
        }
        
        # Initialize Enhanced IDS if available
        if HAS_IDS:
            try:
                self.enhanced_ids = EnhancedIDS()
                self._log_info("Enhanced IDS initialized successfully")
            except Exception as e:
                self._log_error("Enhanced IDS initialization", e)
                self.enhanced_ids = None
        
        # Load basic indices
        self.load_indices()
        self._log_info("B3 Enhanced IDS MCP Server initialized with automation tools")
        # Chronology cache setup
        self._chronology_cache = None
        self._chronology_path = DOCS_ROOT / 'timelines' / 'chronology_index.json'
        self._date_fmt = '%B %d, %Y'

    # ---------------- Chronology Support ---------------- #
    def _load_chronology(self, force: bool = False):
        """Load chronology JSON produced by generate_chronological_index (cached)."""
        if self._chronology_cache is not None and not force:
            return self._chronology_cache
        try:
            if self._chronology_path.exists():
                self._chronology_cache = json.loads(self._chronology_path.read_text(encoding='utf-8'))
            else:
                self._chronology_cache = {"documents": [], "source": []}
        except Exception as e:
            self._log_error("chronology load", e)
            self._chronology_cache = {"documents": [], "source": []}
        return self._chronology_cache

    def query_chronology(self, kind: str = 'all', limit: int = 50, reverse: bool = False):
        """Query merged chronological items.

    kind: all|docs|source|mcp|root
        limit: max items
        reverse: newest first if True
        """
        data = self._load_chronology()
        items = []
        if kind in ('all', 'docs'):
            items.extend(data.get('documents', []))
        if kind in ('all', 'source'):
            items.extend(data.get('source', []))
        if kind in ('all', 'mcp'):
            items.extend(data.get('mcp', []))
        if kind in ('all', 'root'):
            items.extend(data.get('root', []))
        def parse_created(it):
            try:
                return datetime.strptime(it.get('created',''), '%B %d, %Y')
            except Exception:
                return datetime.max
        items.sort(key=parse_created, reverse=reverse)
        if limit:
            items = items[:limit]
        return items

    def chronology_stats(self):
        """Return basic statistics for chronology dataset."""
        d = self._load_chronology()
        stats = {
            'documents': len(d.get('documents', [])),
            'source': len(d.get('source', [])),
            'mcp': len(d.get('mcp', [])),
            'root': len(d.get('root', [])),
            'generated': d.get('generated'),
            'ordering': d.get('ordering'),
            'schema_version': d.get('schema_version')
        }
        # Optionally include delta counts if diff file present
        diff_path = self._chronology_path.parent / 'chronology_index_diff.json'
        if diff_path.exists():
            try:
                diff_data = json.loads(diff_path.read_text(encoding='utf-8'))
                stats['delta'] = {
                    'added': diff_data.get('counts', {}).get('added', 0),
                    'removed': diff_data.get('counts', {}).get('removed', 0),
                    'changed': diff_data.get('counts', {}).get('changed', 0)
                }
            except Exception:
                pass
        return stats

    def handle_chronology_delta(self, include: Optional[List[str]] = None, limit: int = 200):
        """Return chronology diff (added/removed/changed) if available.

        include: subset of ['added','removed','changed'] else all
        """
        diff_path = self._chronology_path.parent / 'chronology_index_diff.json'
        if not diff_path.exists():
            return {'error': 'delta_not_available', 'hint': 'Run chronology-refresh with generator --delta enabled first.'}
        try:
            diff = json.loads(diff_path.read_text(encoding='utf-8'))
        except Exception as e:
            return {'error': 'delta_read_failed', 'detail': str(e)}
        include = include or ['added','removed','changed']
        response = {
            'generated': diff.get('generated'),
            'counts': diff.get('counts', {}),
            'schema_version': diff.get('schema_version') or self._load_chronology().get('schema_version')
        }
        for key in ['added','removed','changed']:
            if key in include:
                data = diff.get(key, [])
                response[key] = data[:limit] if limit else data
        return response

    def handle_chronology_range(self, kind: str = 'all', start_date: str = None, end_date: str = None, limit: int = 100, reverse: bool = False):
        """Filter chronology items by inclusive date range using project date format."""
        if not start_date or not end_date:
            return {"error": "start_date and end_date required"}
        try:
            start_dt = datetime.strptime(start_date, self._date_fmt)
            end_dt = datetime.strptime(end_date, self._date_fmt)
        except Exception as e:
            return {"error": f"Date parse failed: {e}"}
        if end_dt < start_dt:
            start_dt, end_dt = end_dt, start_dt
        data = self._load_chronology()
        pool = []
        if kind in ('all', 'docs'):
            pool.extend(data.get('documents', []))
        if kind in ('all', 'source'):
            pool.extend(data.get('source', []))
        matched = []
        for it in pool:
            created = it.get('created') or ''
            try:
                cdt = datetime.strptime(created, self._date_fmt)
            except Exception:
                continue
            if start_dt <= cdt <= end_dt:
                matched.append(it)
        matched.sort(key=lambda x: datetime.strptime(x['created'], self._date_fmt), reverse=reverse)
        if limit:
            matched = matched[:limit]
        return {
            'kind': kind,
            'start_date': start_date,
            'end_date': end_date,
            'count': len(matched),
            'limit': limit,
            'reverse': reverse,
            'items': matched,
            'schema_version': self._load_chronology().get('schema_version')
        }

    def handle_chronology_refresh(self):
        """Regenerate chronology index by invoking generator then reload cache."""
        generator = PROJECT_ROOT / 'src' / 'dev_tools' / 'docs' / 'generate_chronological_index.py'
        before = self.chronology_stats()
        if not generator.exists():
            return {"error": f"Generator script not found at {generator}"}
        # Baseline generation (docs + source are default; no extended domains)
        cmd = [sys.executable, str(generator), '--json-out']
        try:
            started = time.time()
            proc = subprocess.run(cmd, capture_output=True, text=True, cwd=str(PROJECT_ROOT))
            dur = round(time.time() - started, 3)
            if proc.returncode != 0:
                return {"error": "generation_failed", "rc": proc.returncode, "stderr": proc.stderr}
            self._load_chronology(force=True)
            after = self.chronology_stats()
            return {
                'success': True,
                'duration_sec': dur,
                'stdout_tail': proc.stdout.splitlines()[-8:],
                'before': before,
                'after': after
            }
        except Exception as e:
            self._log_error('chronology refresh', e)
            return {"error": str(e)}

    def load_indices(self):
        """Load basic index files with error handling."""
        try:
            # Load unified tags index
            unified_index_path = DOCS_ROOT / "unified_tags_index.yaml"
            if unified_index_path.exists():
                with open(unified_index_path, 'r', encoding='utf-8') as f:
                    self.unified_index = yaml.safe_load(f) or {}
                self._log_info(f"Loaded unified index: {len(self.unified_index)} entries")
            
            # Load file metadata
            metadata_path = DOCS_ROOT / "file_metadata.yaml"
            if metadata_path.exists():
                with open(metadata_path, 'r', encoding='utf-8') as f:
                    self.file_metadata = yaml.safe_load(f) or {}
                self._log_info(f"Loaded file metadata: {len(self.file_metadata)} entries")
            
            # Load reverse tag index
            reverse_index_path = DOCS_ROOT / "reverse_tag_index.yaml"
            if reverse_index_path.exists():
                with open(reverse_index_path, 'r', encoding='utf-8') as f:
                    self.reverse_index = yaml.safe_load(f) or {}
                self._log_info(f"Loaded reverse index: {len(self.reverse_index)} entries")
                
            self.last_refresh = time.time()
            
        except Exception as e:
            self._log_error("Loading indices", e)
            return False
        
        try:
            self._log_info("Refreshing indices...")
            
            # Clear current state
            self.unified_index.clear()
            self.file_metadata.clear()
            self.reverse_index.clear()
            
            # Refresh Enhanced IDS if available
            if self.enhanced_ids:
                try:
                    self.enhanced_ids.load_indices()
                    self._log_info("Enhanced IDS indices refreshed")
                except Exception as e:
                    self._log_error("Enhanced IDS refresh", e)
            
            # Reload basic indices
            self.load_indices()
            
            self._log_info("Indices refresh completed successfully")
            return True
            
        except Exception as e:
            self._log_error("Refreshing indices", e)
            return False

    def get_tools(self) -> List[Dict[str, Any]]:
        """Return the enhanced B3 tool set with automation capabilities."""
        return [
            # Original 5 tools
            {
                "name": "mcp_impressioncor_mcp_impressioncor_search",
                "description": "Search through ImpressionCore documentation using IDS tagging system. SEARCH RULES: (1) Use single keywords: 'python', 'guide', 'system' (2) Use underscore format for multi-word: 'python_environment', 'deployment_guide' (3) NO spaces in search terms - 'system administration' will fail, use 'administration' instead (4) Search matches tags, file paths, and filenames (5) Use list-tags tool first to discover available search terms",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Search query for documentation. REQUIRED FORMAT: Single words or underscore_separated_terms. NO SPACES. Examples: 'python', 'environment', 'python_environment', 'deployment_guide'. Use list-tags tool to discover exact tag names."
                        },
                        "max_results": {
                            "type": "integer",
                            "description": "Maximum number of results to return",
                            "default": 10
                        },
                        "tags": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Optional tags to filter search results. Use exact tag names from list-tags output."
                        }
                    },
                    "required": ["query"]
                }
            },
            {
                "name": "mcp_impressioncor_mcp_impressioncor_chronology-recent",
                "description": "List recent chronological items (documents, source, mcp, root, or all)",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "kind": {"type": "string", "enum": ["all", "docs", "source", "mcp", "root"], "default": "all"},
                        "limit": {"type": "integer", "default": 25},
                        "reverse": {"type": "boolean", "default": False}
                    }
                }
            },
            {
                "name": "mcp_impressioncor_mcp_impressioncor_chronology-stats",
                "description": "Chronology dataset statistics (counts, generated timestamp)",
                "inputSchema": {"type": "object", "properties": {}}
            },
            {
                "name": "mcp_impressioncor_mcp_impressioncor_chronology-range",
                "description": "Filter chronology items by date range (inclusive). Dates must use 'Month Day, Year'.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "kind": {"type": "string", "enum": ["all", "docs", "source", "mcp", "root"], "default": "all"},
                        "start_date": {"type": "string", "description": "Inclusive start date e.g. 'August 1, 2025'"},
                        "end_date": {"type": "string", "description": "Inclusive end date e.g. 'August 15, 2025'"},
                        "limit": {"type": "integer", "default": 100},
                        "reverse": {"type": "boolean", "default": False}
                    },
                    "required": ["start_date", "end_date"]
                }
            },
            {
                "name": "mcp_impressioncor_mcp_impressioncor_chronology-refresh",
                "description": "Regenerate chronology index (runs generator) then reload cache.",
                "inputSchema": {"type": "object", "properties": {"force": {"type": "boolean", "default": True}}}
            },
            {
                "name": "mcp_impressioncor_mcp_impressioncor_chronology-delta",
                "description": "Return chronology delta (added/removed/changed) if diff JSON present.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "include": {"type": "array", "items": {"type": "string", "enum": ["added","removed","changed"]}},
                        "limit": {"type": "integer", "default": 200}
                    }
                }
            },
            {
                "name": "mcp_impressioncor_mcp_impressioncor_get-system-status",
                "description": "Get current status and statistics of the IDS system",
                "inputSchema": {
                    "type": "object",
                    "properties": {}
                }
            },
            {
                "name": "mcp_impressioncor_mcp_impressioncor_list-tags",
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
                "name": "mcp_impressioncor_mcp_impressioncor_get-file-info",
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
                "name": "mcp_impressioncor_mcp_impressioncor_get-documentation-stats",
                "description": "Get comprehensive documentation statistics",
                "inputSchema": {
                    "type": "object",
                    "properties": {}
                }
            },
            # NEW B3 ENHANCED TOOLS
            {
                "name": "mcp_impressioncor_mcp_impressioncor_run-header-updater",
                "description": "Execute the automated header standardization tool to update file headers across the project",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "file_extensions": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "File extensions to process (default: .md, .py, .txt)",
                            "default": [".md", ".py", ".txt"]
                        },
                        "dry_run": {
                            "type": "boolean",
                            "description": "Preview changes without applying them",
                            "default": False
                        }
                    }
                }
            },
            {
                "name": "mcp_impressioncor_mcp_impressioncor_run-documentation-indexer",
                "description": "Execute the comprehensive documentation indexer to rebuild the documentation index",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "force_rebuild": {
                            "type": "boolean",
                            "description": "Force complete rebuild of documentation index",
                            "default": False
                        },
                        "include_metadata": {
                            "type": "boolean",
                            "description": "Include detailed metadata in index",
                            "default": True
                        }
                    }
                }
            },
            {
                "name": "mcp_impressioncor_mcp_impressioncor_run-system-validator",
                "description": "Execute the system validator to check file integrity, header compliance, and system health",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "validation_scope": {
                            "type": "string",
                            "description": "Scope of validation (full, headers, tags, covenant)",
                            "enum": ["full", "headers", "tags", "covenant"],
                            "default": "full"
                        },
                        "generate_report": {
                            "type": "boolean",
                            "description": "Generate detailed validation report",
                            "default": True
                        }
                    }
                }
            }
        ]
    
    def call_tool(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Execute a tool and return results."""
        self.tool_execution_count += 1
        
        try:
            # Original tools
            if name == "mcp_impressioncor_mcp_impressioncor_search":
                return self.handle_search(**arguments)
            elif name == "mcp_impressioncor_mcp_impressioncor_get-system-status":
                return self.handle_get_system_status()
            elif name == "mcp_impressioncor_mcp_impressioncor_list-tags":
                return self.handle_list_tags(**arguments)
            elif name == "mcp_impressioncor_mcp_impressioncor_get-file-info":
                return self.handle_get_file_info(**arguments)
            elif name == "mcp_impressioncor_mcp_impressioncor_get-documentation-stats":
                return self.handle_get_documentation_stats()
            # New B3 Enhanced Tools
            elif name == "mcp_impressioncor_mcp_impressioncor_run-header-updater":
                return self.handle_run_header_updater(**arguments)
            elif name == "mcp_impressioncor_mcp_impressioncor_run-documentation-indexer":
                return self.handle_run_documentation_indexer(**arguments)
            elif name == "mcp_impressioncor_mcp_impressioncor_run-system-validator":
                return self.handle_run_system_validator(**arguments)
            elif name == "mcp_impressioncor_mcp_impressioncor_chronology-recent":
                items = self.query_chronology(**arguments)
                return {"items": items, "schema_version": self._load_chronology().get('schema_version')}
            elif name == "mcp_impressioncor_mcp_impressioncor_chronology-stats":
                return self.chronology_stats()
            elif name == "mcp_impressioncor_mcp_impressioncor_chronology-range":
                return self.handle_chronology_range(**arguments)
            elif name == "mcp_impressioncor_mcp_impressioncor_chronology-refresh":
                return self.handle_chronology_refresh(**arguments)
            elif name == "mcp_impressioncor_mcp_impressioncor_chronology-delta":
                return self.handle_chronology_delta(**arguments)
            else:
                return {"error": f"Unknown tool: {name}"}
        except Exception as e:
            self._log_error(f"Tool call: {name}", e)
            return {"error": str(e)}
    
    _SR_FORMAT = "Use single words ('python', 'guide') or underscore_format ('python_environment')"
    _SR_NOSPACES = "Spaces will cause 0 results - use 'administration' not 'system administration'"
    _SR_DISCOVERY = "Use list-tags tool to find exact searchable terms"
    _SR_EXAMPLES = ["python", "environment", "python_environment", "deployment_guide", "administration"]

    def handle_search(self, query: str, max_results: int = 10, tags: Optional[List[str]] = None) -> Dict[str, Any]:
        """Public search entrypoint (low complexity wrapper)."""
        self.search_count += 1
        search_id = self.search_count
        query = (query or "").strip()
        tags = tags or []
        self._log_info(f"Search #{search_id}: INPUT_QUERY='{query}' (max_results={max_results}, tags={tags})")
        return self._perform_search(query, max_results, tags, search_id)

    def _perform_search(self, query: str, max_results: int, tags: List[str], search_id: int) -> Dict[str, Any]:
        for attempt in (0, 1):
            enhanced_response = self._try_enhanced(query, max_results, tags, search_id, attempt)
            if enhanced_response == '_retry':
                continue
            if isinstance(enhanced_response, dict):  # success path
                return enhanced_response
            try:
                return self._basic_search(query, max_results, tags, search_id)
            except Exception as e:
                self._log_error(f"Basic search failure attempt {attempt+1}", e)
                if attempt == 0:
                    self.refresh_indices(force=True)
                    continue
                return {
                    "error": f"Search failed after retry: {e}",
                    "query": query,
                    "search_id": search_id,
                    "fallback_suggestion": "Use list-tags to discover valid terms"
                }
        return {"error": "Unreachable search state", "query": query, "search_id": search_id}

    def _try_enhanced(self, query: str, max_results: int, tags: List[str], search_id: int, attempt: int) -> Optional[Union[str, Dict[str, Any]]]:
        if not self.enhanced_ids:
            return None
        try:
            results = self.enhanced_ids.search(query, max_results=max_results)
            if results:
                self._log_info(f"Search #{search_id}: Enhanced IDS returned {len(results)} results")
                formatted = [{
                    'file_path': r.get('file_path', ''),
                    'matching_tags': r.get('matching_tags', []),
                    'metadata': r.get('metadata', {})
                } for r in results[:max_results]]
                return self._build_search_response(query, formatted, len(results), tags, search_id, method="enhanced_ids")
            return None
        except Exception as e:
            self._log_error(f"Enhanced IDS attempt {attempt+1}", e)
            if attempt == 0:
                self.refresh_indices(force=True)
                return '_retry'
            return None

    def _build_search_response(self, query: str, results: List[Dict[str, Any]], total: int, tags: List[str], search_id: int, method: str) -> Dict[str, Any]:
        return {
            "query": query,
            "results": results,
            "total_found": total,
            "requested_tags": tags,
            "search_rules": {
                "format": self._SR_FORMAT,
                "no_spaces": self._SR_NOSPACES,
                "discovery": self._SR_DISCOVERY,
                "examples": self._SR_EXAMPLES
            },
            "input_received": f"Query: '{query}'",
            "search_id": search_id,
            "search_method": method
        }
    
    def _basic_search(self, query: str, max_results: int, tags: List[str], search_id: int) -> Dict[str, Any]:
        """Basic fallback search implementation."""
        self._log_info(f"Search #{search_id}: Using basic fallback search")
        
        results = []
        query_lower = query.lower()
        
        # Search in unified index
        for file_path, file_tags in self.unified_index.items():
            if not isinstance(file_tags, list):
                continue
            
            # Check if query matches any tags
            for tag in file_tags:
                if query_lower in tag.lower():
                    results.append({
                        'file_path': file_path,
                        'matching_tags': ['path_match'],
                        'metadata': self.file_metadata.get(file_path, {})
                    })
                    break
        return self._build_search_response(query, results[:max_results], len(results), tags, search_id, method="basic_fallback")
    
    def handle_get_system_status(self) -> Dict[str, Any]:
        """Get system status including B3 enhancement statistics."""
        return {
            "server_version": "1.2.0-b3-enhanced",
            "timestamp": datetime.now().isoformat(),
            "enhanced_ids_available": HAS_IDS and self.enhanced_ids is not None,
            "indices_loaded": {
                "unified_index": len(self.unified_index),
                "file_metadata": len(self.file_metadata),
                "reverse_index": len(self.reverse_index)
            },
            "tools_available": len(self.get_tools()),
            "statistics": {
                "search_count": self.search_count,
                "error_count": self.error_count,
                "last_refresh": self.last_refresh,
                "tool_execution_count": self.tool_execution_count,
                "uptime_seconds": time.time() - self.last_refresh
            },
            "b3_enhancements": {
                "automation_tools": 3,
                "tool_stats": self.tool_stats,
                "features": [
                    "Automated header standardization",
                    "Comprehensive documentation indexing", 
                    "Advanced system validation",
                    "Intelligent tag generation",
                    "Enhanced error recovery"
                ]
            }
        }
    
    def handle_list_tags(self, category: Optional[str] = None, pattern: Optional[str] = None) -> Dict[str, Any]:
        """List available tags with optional filtering (reduced complexity)."""
        cat = (category or '').lower().strip()
        pat = (pattern or '').lower().strip()
        # gather once
        candidate = set(self.reverse_index.keys())
        for v in self.unified_index.values():
            if isinstance(v, list):
                candidate.update(v)
        if cat or pat:
            filtered = [t for t in candidate if (not cat or cat in t.lower()) and (not pat or pat in t.lower())]
        else:
            filtered = list(candidate)
        filtered.sort()
        return {
            "tags": filtered,
            "total_count": len(filtered),
            "filters_applied": {"category": category, "pattern": pattern},
            "usage_note": "Use exact tag names. Prefer single words or underscore_separated_terms."
        }
    
    def handle_get_file_info(self, file_path: str) -> Dict[str, Any]:
        """Get detailed information about a specific file."""
        try:
            full_path = PROJECT_ROOT / file_path
            
            if not full_path.exists():
                return {"error": f"File not found: {file_path}"}
            
            # Get file stats
            stat = full_path.stat()
            
            # Get metadata if available
            metadata = self.file_metadata.get(file_path, {})
            
            # Get tags if available
            tags = self.unified_index.get(file_path, [])
            
            return {
                "file_path": file_path,
                "exists": True,
                "size_bytes": stat.st_size,
                "modified_time": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                "metadata": metadata,
                "tags": tags,
                "file_type": full_path.suffix
            }
            
        except Exception as e:
            self._log_error("Get file info", e)
            return {"error": str(e)}
    
    def handle_get_documentation_stats(self) -> Dict[str, Any]:
        """Get comprehensive documentation statistics."""
        try:
            stats = {
                "total_files": len(self.unified_index),
                "total_tags": len(self.reverse_index),
                "file_types": {},
                "tag_categories": {},
                "largest_files": [],
                "most_tagged_files": []
            }
            
            # Count file types
            for file_path in self.unified_index.keys():
                ext = Path(file_path).suffix.lower()
                stats["file_types"][ext] = stats["file_types"].get(ext, 0) + 1
            
            # Tag categories analysis
            for tag in self.reverse_index.keys():
                if '_' in tag:
                    category = tag.split('_')[0]
                    stats["tag_categories"][category] = stats["tag_categories"].get(category, 0) + 1
            
            return stats
            
        except Exception as e:
            self._log_error("Get documentation stats", e)
            return {"error": str(e)}
    
    # NEW B3 ENHANCED TOOL HANDLERS
    
    def handle_run_header_updater(self, file_extensions: List[str] = None, dry_run: bool = False) -> Dict[str, Any]:
        """Execute the automated header standardization tool."""
        self.tool_stats['header_updater_runs'] += 1
        
        try:
            if file_extensions is None:
                file_extensions = [".md", ".py", ".txt"]
            
            # Path to the header updater tool
            tool_path = PROJECT_ROOT / "src" / "dev_tools" / "ids_header_updater.py"
            
            if not tool_path.exists():
                return {"error": f"Header updater tool not found at {tool_path}"}
            
            # Build command
            cmd = [sys.executable, str(tool_path)]
            if dry_run:
                cmd.append("--dry-run")
            
            self._log_info(f"Executing header updater: {' '.join(cmd)}")
            
            # Execute the tool
            result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(PROJECT_ROOT))
            
            if result.returncode == 0:
                self.tool_stats['last_maintenance'] = datetime.now().isoformat()
                return {
                    "success": True,
                    "tool": "header_updater",
                    "dry_run": dry_run,
                    "output": result.stdout,
                    "files_processed": self._extract_files_processed(result.stdout),
                    "execution_time": datetime.now().isoformat()
                }
            else:
                return {
                    "success": False,
                    "tool": "header_updater", 
                    "error": result.stderr,
                    "output": result.stdout
                }
                
        except Exception as e:
            self._log_error("Header updater execution", e)
            return {"error": str(e)}
    
    def handle_run_documentation_indexer(self, force_rebuild: bool = False, include_metadata: bool = True) -> Dict[str, Any]:
        """Execute the comprehensive documentation indexer."""
        self.tool_stats['documentation_indexer_runs'] += 1
        
        try:
            # Path to the documentation indexer tool
            tool_path = PROJECT_ROOT / "src" / "dev_tools" / "documentation_indexer.py"
            
            if not tool_path.exists():
                return {"error": f"Documentation indexer tool not found at {tool_path}"}
            
            # Build command
            cmd = [sys.executable, str(tool_path)]
            if force_rebuild:
                cmd.append("--force-rebuild")
            if not include_metadata:
                cmd.append("--no-metadata")
            
            self._log_info(f"Executing documentation indexer: {' '.join(cmd)}")
            
            # Execute the tool
            result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(PROJECT_ROOT))
            
            if result.returncode == 0:
                self.tool_stats['last_maintenance'] = datetime.now().isoformat()
                # Refresh our indices after successful rebuild
                self.refresh_indices(force=True)
                
                return {
                    "success": True,
                    "tool": "documentation_indexer",
                    "force_rebuild": force_rebuild,
                    "include_metadata": include_metadata,
                    "output": result.stdout,
                    "files_indexed": self._extract_files_indexed(result.stdout),
                    "execution_time": datetime.now().isoformat()
                }
            else:
                return {
                    "success": False,
                    "tool": "documentation_indexer",
                    "error": result.stderr,
                    "output": result.stdout
                }
                
        except Exception as e:
            self._log_error("Documentation indexer execution", e)
            return {"error": str(e)}
    
    def handle_run_system_validator(self, validation_scope: str = "full", generate_report: bool = True) -> Dict[str, Any]:
        """Execute the system validator for comprehensive system health check."""
        self.tool_stats['system_validator_runs'] += 1
        
        try:
            # Path to the system validator tool
            tool_path = PROJECT_ROOT / "src" / "dev_tools" / "ids_system_validator.py"
            
            if not tool_path.exists():
                return {"error": f"System validator tool not found at {tool_path}"}
            
            # Build command
            cmd = [sys.executable, str(tool_path)]
            cmd.extend(["--scope", validation_scope])
            if not generate_report:
                cmd.append("--no-report")
            
            self._log_info(f"Executing system validator: {' '.join(cmd)}")
            
            # Execute the tool
            result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(PROJECT_ROOT))
            
            if result.returncode == 0:
                self.tool_stats['last_maintenance'] = datetime.now().isoformat()
                
                return {
                    "success": True,
                    "tool": "system_validator",
                    "validation_scope": validation_scope,
                    "generate_report": generate_report,
                    "output": result.stdout,
                    "validation_results": self._extract_validation_results(result.stdout),
                    "execution_time": datetime.now().isoformat()
                }
            else:
                return {
                    "success": False,
                    "tool": "system_validator",
                    "error": result.stderr,
                    "output": result.stdout
                }
                
        except Exception as e:
            self._log_error("System validator execution", e)
            return {"error": str(e)}
    
    # Helper methods for parsing tool outputs
    
    def _extract_files_processed(self, output: str) -> int:
        """Extract number of files processed from header updater output."""
        match = re.search(r'successfully updated (\d+) files', output)
        return int(match.group(1)) if match else 0
    
    def _extract_files_indexed(self, output: str) -> int:
        """Extract number of files indexed from documentation indexer output."""
        match = re.search(r'Total files indexed: (\d+)', output)
        return int(match.group(1)) if match else 0
    
    def _extract_validation_results(self, output: str) -> Dict[str, Any]:
        """Extract validation results from system validator output."""
        results = {}
        
        # Extract key metrics from output
        header_match = re.search(r'Header compliance: ([\d.]+)%', output)
        if header_match:
            results['header_compliance'] = float(header_match.group(1))
        
        covenant_match = re.search(r'Sacred Covenant: (\w+)', output)
        if covenant_match:
            results['sacred_covenant'] = covenant_match.group(1)
        
        files_match = re.search(r'Total files validated: (\d+)', output)
        if files_match:
            results['files_validated'] = int(files_match.group(1))
        
        return results

def main():
    """Main entry point for the MCP server."""
    server = IDSMCPServerB3Enhanced()
    
    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break
            
            request = json.loads(line.strip())
            
            if request.get("method") == "tools/list":
                response = {
                    "jsonrpc": "2.0",
                    "id": request.get("id"),
                    "result": {"tools": server.get_tools()}
                }
            elif request.get("method") == "tools/call":
                tool_name = request["params"]["name"]
                arguments = request["params"].get("arguments", {})
                result = server.call_tool(tool_name, arguments)
                response = {
                    "jsonrpc": "2.0", 
                    "id": request.get("id"),
                    "result": {"content": [{"type": "text", "text": json.dumps(result, indent=2)}]}
                }
            else:
                response = {
                    "jsonrpc": "2.0",
                    "id": request.get("id"),
                    "error": {"code": -32601, "message": "Method not found"}
                }
            
            print(json.dumps(response))
            sys.stdout.flush()
            
        except Exception as e:
            error_response = {
                "jsonrpc": "2.0",
                "id": request.get("id") if 'request' in locals() else None,
                "error": {"code": -32603, "message": str(e)}
            }
            print(json.dumps(error_response))
            sys.stdout.flush()

if __name__ == "__main__":
    main()
