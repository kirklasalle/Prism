#!/usr/bin/env python3
r"""
!/usr/bin/env python3

Created: October 15, 2024  
Updated: August 11, 2025  
Author: Kirk LaSalle  
Tags: #.mcp\\ids_mcp\\server.py #deployment #documentation #python #source_code  
Category: Source Code  
Status: Active
"""






import json
import sys
import os
import yaml
import time
import traceback
import subprocess
from pathlib import Path
from typing import Dict, List, Optional, Any, Union
from datetime import datetime
import threading

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

class IDSMCPServerFixed:
    """Fixed MCP Server for ImpressionCore Documentation System."""
    
    def __init__(self):
        # Core state
        self.enhanced_ids = None
        self.unified_index: Dict[str, Any] = {}
        self.file_metadata: Dict[str, Any] = {}
        self.reverse_index: Dict[str, List[str]] = {}
        self.last_refresh = 0
        self.refresh_interval = 10  # Minimum seconds between refreshes
        self.error_count = 0
        self.search_count = 0

        # Init flags
        self.initializing = True
        self.ready = False

        # Start non-blocking initialization so initialize handshake is fast
        def _background_bootstrap():
            try:
                self._log_info("Starting background IDS initialization...")
                # Initialize Enhanced IDS if available
                if HAS_IDS:
                    try:
                        self.enhanced_ids = EnhancedIDS()
                        self._log_info("Enhanced IDS initialized successfully")
                    except Exception as e:
                        self._log_error("Enhanced IDS initialization", e)
                        self.enhanced_ids = None
                # Load indices (basic and/or via enhanced)
                self.load_indices()
                self.ready = True
                self._log_info("IDS initialization complete. Server is ready.")
            finally:
                self.initializing = False

        threading.Thread(target=_background_bootstrap, daemon=True).start()
    
    def _log_info(self, message: str):
        """Log info message to stderr."""
        timestamp = datetime.now().isoformat()
        print(f"[{timestamp}] INFO: {message}", file=sys.stderr)
        sys.stderr.flush()
    
    def _log_error(self, operation: str, error: Exception):
        """Enhanced error logging for debugging."""
        timestamp = datetime.now().isoformat()
        error_msg = f"[{timestamp}] ERROR: {operation} failed: {error}"
        print(error_msg, file=sys.stderr)
        print(f"[{timestamp}] TRACEBACK: {traceback.format_exc()}", file=sys.stderr)
        sys.stderr.flush()
        self.error_count += 1
    
    def load_indices(self):
        """Load basic index files with error handling and diagnostics."""
        try:
            # Log file paths
            unified_index_path = DOCS_ROOT / "unified_tags_index.yaml"
            metadata_path = DOCS_ROOT / "file_metadata.yaml"
            reverse_index_path = DOCS_ROOT / "reverse_tag_index.yaml"
            self._log_info(f"Looking for indices:\n  unified: {unified_index_path} (exists={unified_index_path.exists()})\n  metadata: {metadata_path} (exists={metadata_path.exists()})\n  reverse: {reverse_index_path} (exists={reverse_index_path.exists()})")

            # Load unified tags index
            if unified_index_path.exists():
                try:
                    with open(unified_index_path, 'r', encoding='utf-8') as f:
                        self.unified_index = yaml.safe_load(f) or {}
                    self._log_info(f"Loaded unified index: {len(self.unified_index)} entries")
                except Exception as e:
                    self._log_error(f"YAML load error: {unified_index_path}", e)
            else:
                self._log_info(f"Unified index file missing: {unified_index_path}")

            # Load file metadata
            if metadata_path.exists():
                try:
                    with open(metadata_path, 'r', encoding='utf-8') as f:
                        self.file_metadata = yaml.safe_load(f) or {}
                    self._log_info(f"Loaded file metadata: {len(self.file_metadata)} entries")
                except Exception as e:
                    self._log_error(f"YAML load error: {metadata_path}", e)
            else:
                self._log_info(f"File metadata file missing: {metadata_path}")

            # Load reverse tag index
            if reverse_index_path.exists():
                try:
                    with open(reverse_index_path, 'r', encoding='utf-8') as f:
                        self.reverse_index = yaml.safe_load(f) or {}
                    self._log_info(f"Loaded reverse index: {len(self.reverse_index)} entries")
                except Exception as e:
                    self._log_error(f"YAML load error: {reverse_index_path}", e)
            else:
                self._log_info(f"Reverse index file missing: {reverse_index_path}")

            self.last_refresh = time.time()

        except Exception as e:
            self._log_error("Loading indices", e)
        finally:
            # If nothing loaded, try to build indices automatically
            try:
                if not self.unified_index and not self.file_metadata and not self.reverse_index:
                    tool_path = PROJECT_ROOT / "src" / "dev_tools" / "documentation_indexer.py"
                    if tool_path.exists():
                        self._log_info("No indices found. Running documentation indexer to build them...")
                        result = subprocess.run([sys.executable, str(tool_path)], capture_output=True, text=True, cwd=str(PROJECT_ROOT))
                        if result.returncode == 0:
                            self._log_info("Documentation indexer completed. Reloading indices...")
                            # Attempt reload after successful build
                            try:
                                # Avoid infinite loop by reading files again directly
                                if unified_index_path.exists():
                                    with open(unified_index_path, 'r', encoding='utf-8') as f:
                                        self.unified_index = yaml.safe_load(f) or {}
                                if metadata_path.exists():
                                    with open(metadata_path, 'r', encoding='utf-8') as f:
                                        self.file_metadata = yaml.safe_load(f) or {}
                                if reverse_index_path.exists():
                                    with open(reverse_index_path, 'r', encoding='utf-8') as f:
                                        self.reverse_index = yaml.safe_load(f) or {}
                                self.last_refresh = time.time()
                                self._log_info("Indices loaded after auto-build")
                            except Exception as re:
                                self._log_error("Reloading indices after auto-build", re)
                        else:
                            self._log_error("Documentation indexer run", Exception(result.stderr.strip()[:500]))
            except Exception as e2:
                self._log_error("Auto-build indices", e2)
    
    def refresh_indices(self, force: bool = False):
        """Force reload of all indices - fixes state corruption."""
        current_time = time.time()
        
        # Rate limiting to prevent excessive refreshes
        if not force and (current_time - self.last_refresh) < self.refresh_interval:
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
    
    def _fallback_search(self, query: str, max_results: int = 10) -> Dict[str, Any]:
        """Simple fallback search when Enhanced IDS fails."""
        results = []
        query_lower = query.lower()
        
        # Search in file paths
        for file_path, metadata in self.file_metadata.items():
            if query_lower in file_path.lower():
                results.append({
                    "file_path": file_path,
                    "metadata": metadata,
                    "match_type": "filename"
                })
                if len(results) >= max_results:
                    break
        
        # Search in tags if still need more results
        if len(results) < max_results:
            for tag, files in self.reverse_index.items():
                if query_lower in tag.lower():
                    for file_path in files[:max_results - len(results)]:
                        if file_path not in [r["file_path"] for r in results]:
                            results.append({
                                "file_path": file_path,
                                "metadata": self.file_metadata.get(file_path, {}),
                                "match_type": "tag",
                                "matching_tag": tag
                            })        
        return {
            "query": query,
            "results": results[:max_results],
            "total_found": len(results),
            "search_method": "fallback",
            "search_rules": {
                "format": "Use single words ('python', 'guide') or underscore_format ('python_environment')",
                "no_spaces": "Spaces will cause 0 results - use 'administration' not 'system administration'",
                "discovery": "Use list-tags tool to find exact searchable terms",
                "examples": ["python", "environment", "python_environment", "deployment_guide", "administration"]
            }
        }
    
    def get_tools(self) -> List[Dict[str, Any]]:
        """Return the 5 original tools."""
        return [            {
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
            # B3 Enhanced Tools
            {
                "name": "mcp_impressioncor_mcp_impressioncor_run-header-updater",
                "description": "Execute the automated header standardization tool to update file headers across the project",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "target_directory": {
                            "type": "string",
                            "description": "Directory to process (default: entire project)",
                            "default": "."
                        },
                        "dry_run": {
                            "type": "boolean",
                            "description": "Preview changes without applying them"
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
                            "description": "Force complete rebuild of documentation index"
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
                        }
                    }
                }
            }
        ]
    
    def call_tool(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Execute a tool and return results."""
        try:
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
            # B3 Enhanced Tools
            elif name == "mcp_impressioncor_mcp_impressioncor_run-header-updater":
                return self.handle_run_header_updater(**arguments)
            elif name == "mcp_impressioncor_mcp_impressioncor_run-documentation-indexer":
                return self.handle_run_documentation_indexer(**arguments)
            elif name == "mcp_impressioncor_mcp_impressioncor_run-system-validator":
                return self.handle_run_system_validator(**arguments)
            else:
                return {"error": f"Unknown tool: {name}"}
        except Exception as e:
            self._log_error(f"Tool call: {name}", e)
            return {"error": str(e)}
    
    def handle_search(self, query: str, max_results: int = 10, tags: Optional[List[str]] = None) -> Dict[str, Any]:
        """Handle search requests with auto-refresh on failure and proper input logging."""
        self.search_count += 1
        search_id = self.search_count
        
        # Ensure query is properly logged and displayed
        query = query.strip() if query else ""
        tags = tags or []
        
        self._log_info(f"Search #{search_id}: INPUT_QUERY='{query}' (max_results={max_results}, tags={tags})")
        
        # Validate input
        if not query:
            return {
                "query": query,
                "results": [],
                "total_found": 0,
                "error": "Empty query provided. Please provide a search term.",
                "search_rules": "Use single words ('python', 'guide') or underscore_format ('python_environment'). NO SPACES.",
                "search_id": search_id,
                "search_method": "validation_error"
            }
        
        try:
            # Try search with Enhanced IDS
            if self.enhanced_ids:
                try:
                    result = self.enhanced_ids.search(query, max_results=max_results, tags=tags or [])                    # Validate result structure
                    if isinstance(result, dict) and 'results' in result and isinstance(result['results'], list):
                        self._log_info(f"Search #{search_id}: SUCCESS - {len(result['results'])} results")
                        result['search_id'] = search_id
                        result['search_method'] = 'enhanced_ids'
                        result['search_rules'] = {
                            "format": "Use single words ('python', 'guide') or underscore_format ('python_environment')",
                            "no_spaces": "Spaces will cause 0 results - use 'administration' not 'system administration'",
                            "discovery": "Use list-tags tool to find exact searchable terms",
                            "examples": ["python", "environment", "python_environment", "deployment_guide", "administration"]
                        }
                        result['input_received'] = f"Query: '{query}'"
                        return result
                    else:
                        # Invalid result structure, try refresh
                        self._log_info(f"Search #{search_id}: Invalid result structure, refreshing...")
                        if self.refresh_indices(force=True):
                            result = self.enhanced_ids.search(query, max_results=max_results, tags=tags or [])
                            if isinstance(result, dict) and 'results' in result:
                                self._log_info(f"Search #{search_id}: RECOVERED - {len(result['results'])} results")
                                result['search_id'] = search_id
                                result['search_method'] = 'enhanced_ids_recovered'
                                return result
                        
                        # Fall back to simple search
                        self._log_info(f"Search #{search_id}: Falling back to simple search")
                        
                except Exception as e:
                    self._log_error(f"Enhanced IDS search #{search_id}", e)
                    
                    # Try to recover by refreshing
                    if self.refresh_indices(force=True):
                        try:
                            result = self.enhanced_ids.search(query, max_results=max_results, tags=tags or [])
                            if isinstance(result, dict) and 'results' in result:
                                self._log_info(f"Search #{search_id}: RECOVERED after error - {len(result['results'])} results")
                                result['search_id'] = search_id
                                result['search_method'] = 'enhanced_ids_error_recovered'
                                return result
                        except Exception as e2:
                            self._log_error(f"Enhanced IDS recovery search #{search_id}", e2)
            
            # Final fallback to simple search
            result = self._fallback_search(query, max_results)
            result['search_id'] = search_id
            self._log_info(f"Search #{search_id}: FALLBACK - {len(result['results'])} results")
            return result
            
        except Exception as e:
            self._log_error(f"Search #{search_id} complete failure", e)
            return {
                "query": query,
                "results": [],
                "total_found": 0,
                "error": str(e),
                "search_id": search_id,
                "search_method": "error",
                "search_rules": {
                    "format": "Use single words ('python', 'guide') or underscore_format ('python_environment')",
                    "no_spaces": "Spaces will cause 0 results - use 'administration' not 'system administration'",
                    "discovery": "Use list-tags tool to find exact searchable terms",
                    "examples": ["python", "environment", "python_environment", "deployment_guide", "administration"]
                }
            }
    
    def handle_get_system_status(self) -> Dict[str, Any]:
        """Handle system status requests."""
        return {
            "server_version": "1.2.0-b3-enhanced",
            "timestamp": datetime.now().isoformat(),
            "enhanced_ids_available": HAS_IDS and self.enhanced_ids is not None,
            "initializing": self.initializing,
            "ready": self.ready,
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
                "uptime_seconds": time.time() - self.last_refresh
            },
            "b3_enhancements": {
                "automation_tools": 3,
                "features": [
                    "Automated header standardization",
                    "Comprehensive documentation indexing", 
                    "Advanced system validation",
                    "Real-time tool execution",
                    "Enhanced error recovery"
                ]
            }
        }
    
    def handle_list_tags(self, category: Optional[str] = None, pattern: Optional[str] = None) -> Dict[str, Any]:
        """Handle list tags requests."""
        try:
            if self.enhanced_ids:
                return {"tags": self.enhanced_ids.list_tags(category=category, pattern=pattern)}
            else:
                tags = list(self.reverse_index.keys())
                if category:
                    tags = [tag for tag in tags if category.lower() in tag.lower()]
                if pattern:
                    tags = [tag for tag in tags if pattern.lower() in tag.lower()]
                return {"tags": tags, "count": len(tags)}
        except Exception as e:
            self._log_error("List tags", e)
            return {"tags": [], "count": 0, "error": str(e)}
    
    def handle_get_file_info(self, file_path: str) -> Dict[str, Any]:
        """Handle file info requests."""
        try:
            if self.enhanced_ids:
                return self.enhanced_ids.get_file_info(file_path)
            else:
                info = {
                    "file_path": file_path,
                    "exists": file_path in self.file_metadata,
                    "metadata": self.file_metadata.get(file_path, {}),
                    "tags": []
                }
                
                # Find tags for this file
                for tag, files in self.reverse_index.items():
                    if file_path in files:
                        info["tags"].append(tag)
                
                return info
        except Exception as e:
            self._log_error("Get file info", e)
            return {"file_path": file_path, "error": str(e)}
    
    def handle_get_documentation_stats(self) -> Dict[str, Any]:
        """Handle documentation stats requests."""
        try:
            if self.enhanced_ids:
                return self.enhanced_ids.get_documentation_stats()
            else:
                return {
                    "total_files": len(self.file_metadata),
                    "total_tags": len(self.reverse_index),
                    "enhanced_ids_available": False,
                    "server_stats": {
                        "search_count": self.search_count,
                        "error_count": self.error_count
                    }
                }
        except Exception as e:
            self._log_error("Get documentation stats", e)
            return {"error": str(e)}

    # B3 Enhanced Tool Handlers
    
    def handle_run_header_updater(self, target_directory: str = ".", dry_run: bool = False) -> Dict[str, Any]:
        """Execute the automated header standardization tool."""
        try:
            tool_path = PROJECT_ROOT / "src" / "dev_tools" / "ids_header_updater.py"
            
            if not tool_path.exists():
                return {"error": f"Header updater tool not found at {tool_path}"}
            
            cmd = [sys.executable, str(tool_path)]
            if dry_run:
                cmd.append("--dry-run")
            
            self._log_info(f"Executing header updater: {' '.join(cmd)}")
            
            result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(PROJECT_ROOT))
            
            return {
                "success": result.returncode == 0,
                "tool": "header_updater",
                "dry_run": dry_run,
                "output": result.stdout,
                "error": result.stderr if result.returncode != 0 else None,
                "execution_time": datetime.now().isoformat()
            }
                
        except Exception as e:
            self._log_error("Header updater execution", e)
            return {"error": str(e)}
    
    def handle_run_documentation_indexer(self, force_rebuild: bool = False) -> Dict[str, Any]:
        """Execute the comprehensive documentation indexer."""
        try:
            tool_path = PROJECT_ROOT / "src" / "dev_tools" / "documentation_indexer.py"
            
            if not tool_path.exists():
                return {"error": f"Documentation indexer tool not found at {tool_path}"}
            
            cmd = [sys.executable, str(tool_path)]
            if force_rebuild:
                cmd.append("--force-rebuild")
            
            self._log_info(f"Executing documentation indexer: {' '.join(cmd)}")
            
            result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(PROJECT_ROOT))
            
            if result.returncode == 0:
                # Refresh our indices after successful rebuild
                self.refresh_indices(force=True)
            
            return {
                "success": result.returncode == 0,
                "tool": "documentation_indexer",
                "force_rebuild": force_rebuild,
                "output": result.stdout,
                "error": result.stderr if result.returncode != 0 else None,
                "execution_time": datetime.now().isoformat()
            }
                
        except Exception as e:
            self._log_error("Documentation indexer execution", e)
            return {"error": str(e)}
    
    def handle_run_system_validator(self, validation_scope: str = "full") -> Dict[str, Any]:
        """Execute the system validator for comprehensive system health check."""
        try:
            tool_path = PROJECT_ROOT / "src" / "dev_tools" / "ids_system_validator.py"
            
            if not tool_path.exists():
                return {"error": f"System validator tool not found at {tool_path}"}
            
            cmd = [sys.executable, str(tool_path)]
            if validation_scope != "full":
                cmd.extend(["--scope", validation_scope])
            
            self._log_info(f"Executing system validator: {' '.join(cmd)}")
            
            result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(PROJECT_ROOT))
            
            return {
                "success": result.returncode == 0,
                "tool": "system_validator",
                "validation_scope": validation_scope,
                "output": result.stdout,
                "error": result.stderr if result.returncode != 0 else None,
                "execution_time": datetime.now().isoformat()
            }
                
        except Exception as e:
            self._log_error("System validator execution", e)
            return {"error": str(e)}

# MCP Protocol Implementation
def main():
    """Main MCP protocol loop."""
    server = IDSMCPServerFixed()
    server._log_info("IDS MCP Server B3 Enhanced v1.2.0 starting with 8 tools...")
    
    while True:
        try:
            line = input()
            request = json.loads(line)
            
            if request.get("method") == "tools/list":
                response = {
                    "jsonrpc": "2.0",
                    "id": request.get("id"),
                    "result": {
                        "tools": server.get_tools()
                    }
                }
            elif request.get("method") == "tools/call":
                params = request.get("params", {})
                tool_name = params.get("name")
                arguments = params.get("arguments", {})
                
                result = server.call_tool(tool_name, arguments)
                
                response = {
                    "jsonrpc": "2.0", 
                    "id": request.get("id"),
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": json.dumps(result, indent=2, ensure_ascii=False)
                            }
                        ]
                    }
                }
            elif request.get("method") == "initialize":
                response = {
                    "jsonrpc": "2.0",
                    "id": request.get("id"),
                    "result": {
                        "serverInfo": {
                            "name": "impressioncore-ids-fixed",
                            "version": "1.1.0"
                        },
                        "capabilities": {
                            "tools": {}
                        }
                    }
                }
            else:
                response = {
                    "jsonrpc": "2.0",
                    "id": request.get("id"),
                    "error": {
                        "code": -32601,
                        "message": f"Method not found: {request.get('method')}"
                    }
                }
            
            print(json.dumps(response))
            sys.stdout.flush()
            
        except EOFError:
            server._log_info("EOF received, shutting down...")
            break
        except Exception as e:
            server._log_error("Main loop", e)
            error_response = {
                "jsonrpc": "2.0",
                "id": request.get("id") if 'request' in locals() else None,
                "error": {
                    "code": -32603,
                    "message": f"Internal error: {str(e)}"
                }
            }
            print(json.dumps(error_response))
            sys.stdout.flush()

if __name__ == "__main__":
    main()
