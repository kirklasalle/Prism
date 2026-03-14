#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\servers\server_v2_fixed.py #documentation #python #source_code  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\servers\server_v2_fixed.py #documentation #python #source_code  
**Category:** Source Code  
**Status:** Active

"""
ImpressionCore Documentation System (IDS) MCP Server - Fixed Version
====================================================================

Model Context Protocol server for accessing the ImpressionCore Documentation System.
This version includes fixes for the search function reliability issue.

FIXES IMPLEMENTED:
- State refresh mechanism to prevent corruption
- Auto-recovery from search failures
- Enhanced error logging and debugging
- Windows file locking workarounds

Author: ImpressionCore IDS Team
Created: 2025-06-10
Version: 1.1.0 (Fixed)
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
        self.enhanced_ids = None
        self.unified_index = {}
        self.file_metadata = {}
        self.reverse_index = {}
        self.last_refresh = 0
        self.refresh_interval = 10  # Minimum seconds between refreshes
        self.error_count = 0
        self.search_count = 0
        
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
            "search_method": "fallback"
        }
    
    def get_tools(self) -> List[Dict[str, Any]]:
        """Return the 5 original tools."""
        return [
            {
                "name": "mcp_impressioncor_mcp_impressioncor_search",
                "description": "Search through ImpressionCore documentation using IDS tagging system",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Search query for documentation"
                        },
                        "max_results": {
                            "type": "integer",
                            "description": "Maximum number of results to return",
                            "default": 10
                        },
                        "tags": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Optional tags to filter search results"
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
            else:
                return {"error": f"Unknown tool: {name}"}
        except Exception as e:
            self._log_error(f"Tool call: {name}", e)
            return {"error": str(e)}
    
    def handle_search(self, query: str, max_results: int = 10, tags: Optional[List[str]] = None) -> Dict[str, Any]:
        """Handle search requests with auto-refresh on failure."""
        self.search_count += 1
        search_id = self.search_count
        
        self._log_info(f"Search #{search_id}: '{query}' (max_results={max_results}, tags={tags})")
        
        try:
            # Try search with Enhanced IDS
            if self.enhanced_ids:
                try:
                    result = self.enhanced_ids.search(query, max_results=max_results, tags=tags or [])
                    
                    # Validate result structure
                    if isinstance(result, dict) and 'results' in result and isinstance(result['results'], list):
                        self._log_info(f"Search #{search_id}: SUCCESS - {len(result['results'])} results")
                        result['search_id'] = search_id
                        result['search_method'] = 'enhanced_ids'
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
                "search_method": "error"
            }
    
    def handle_get_system_status(self) -> Dict[str, Any]:
        """Handle system status requests."""
        return {
            "server_version": "1.1.0-fixed",
            "timestamp": datetime.now().isoformat(),
            "enhanced_ids_available": HAS_IDS and self.enhanced_ids is not None,
            "indices_loaded": {
                "unified_index": len(self.unified_index),
                "file_metadata": len(self.file_metadata),
                "reverse_index": len(self.reverse_index)
            },
            "tools_available": 5,
            "statistics": {
                "search_count": self.search_count,
                "error_count": self.error_count,
                "last_refresh": self.last_refresh,
                "uptime_seconds": time.time() - self.last_refresh
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

# MCP Protocol Implementation
def main():
    """Main MCP protocol loop."""
    server = IDSMCPServerFixed()
    server._log_info("IDS MCP Server Fixed v1.1.0 starting...")
    
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
