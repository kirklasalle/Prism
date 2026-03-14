#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\servers\server_original.py #documentation #python #source_code  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\servers\server_original.py #documentation #python #source_code  
**Category:** Source Code  
**Status:** Active

"""
ImpressionCore Documentation System (IDS) MCP Server - Original Version
========================================================================

Model Context Protocol server for accessing the ImpressionCore Documentation System.
This is the original, simple version with 5 core tools.

Features:
- Document search with tagging support
- System status monitoring  
- Tag management
- File information retrieval
- Documentation statistics

Author: ImpressionCore IDS Team
Created: 2025-06-05
Version: 1.0.0 (Original)
"""

import json
import sys
import os
import yaml
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

class IDSMCPServer:
    """Original MCP Server for ImpressionCore Documentation System."""
    
    def __init__(self):
        self.enhanced_ids = None
        self.unified_index = {}
        self.file_metadata = {}
        self.reverse_index = {}
        
        # Initialize Enhanced IDS if available
        if HAS_IDS:
            try:
                self.enhanced_ids = EnhancedIDS()
            except Exception:
                self.enhanced_ids = None
        
        # Load basic indices
        self.load_indices()
    
    def load_indices(self):
        """Load basic index files."""
        try:
            # Load unified tags index
            unified_index_path = DOCS_ROOT / "unified_tags_index.yaml"
            if unified_index_path.exists():
                with open(unified_index_path, 'r', encoding='utf-8') as f:
                    self.unified_index = yaml.safe_load(f) or {}
            
            # Load file metadata
            metadata_path = DOCS_ROOT / "file_metadata.yaml"
            if metadata_path.exists():
                with open(metadata_path, 'r', encoding='utf-8') as f:
                    self.file_metadata = yaml.safe_load(f) or {}
            
            # Load reverse tag index
            reverse_index_path = DOCS_ROOT / "reverse_tag_index.yaml"
            if reverse_index_path.exists():
                with open(reverse_index_path, 'r', encoding='utf-8') as f:
                    self.reverse_index = yaml.safe_load(f) or {}
        except Exception:
            pass
    
    def get_tools(self) -> List[Dict[str, Any]]:
        """Return the 5 original tools."""
        return [
            {
                "name": "mcp_impressioncor_search",
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
                "name": "mcp_impressioncor_get-system-status",
                "description": "Get current status and statistics of the IDS system",
                "inputSchema": {
                    "type": "object",
                    "properties": {}
                }
            },
            {
                "name": "mcp_impressioncor_list-tags",
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
                "name": "mcp_impressioncor_get-file-info",
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
                "name": "mcp_impressioncor_get-documentation-stats",
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
            if name == "mcp_impressioncor_search":
                return self.handle_search(**arguments)
            elif name == "mcp_impressioncor_get-system-status":
                return self.handle_get_system_status()
            elif name == "mcp_impressioncor_list-tags":
                return self.handle_list_tags(**arguments)
            elif name == "mcp_impressioncor_get-file-info":
                return self.handle_get_file_info(**arguments)
            elif name == "mcp_impressioncor_get-documentation-stats":
                return self.handle_get_documentation_stats()
            else:
                return {"error": f"Unknown tool: {name}"}
        except Exception as e:
            return {"error": str(e)}
    
    def handle_search(self, query: str, max_results: int = 10, tags: Optional[List[str]] = None) -> Dict[str, Any]:
        """Handle search requests."""
        if self.enhanced_ids:
            return self.enhanced_ids.search(query, max_results=max_results, tags=tags or [])
        else:
            # Simple fallback search
            results = []
            query_lower = query.lower()
            
            for file_path, metadata in self.file_metadata.items():
                if query_lower in file_path.lower():
                    results.append({
                        "file_path": file_path,
                        "metadata": metadata
                    })
                    if len(results) >= max_results:
                        break
            
            return {
                "query": query,
                "results": results,
                "total_found": len(results)
            }
    
    def handle_get_system_status(self) -> Dict[str, Any]:
        """Handle system status requests."""
        return {
            "server_version": "1.0.0",
            "timestamp": datetime.now().isoformat(),
            "enhanced_ids_available": HAS_IDS and self.enhanced_ids is not None,
            "indices_loaded": {
                "unified_index": len(self.unified_index),
                "file_metadata": len(self.file_metadata),
                "reverse_index": len(self.reverse_index)
            },
            "tools_available": 5
        }
    
    def handle_list_tags(self, category: Optional[str] = None, pattern: Optional[str] = None) -> Dict[str, Any]:
        """Handle list tags requests."""
        if self.enhanced_ids:
            return {"tags": self.enhanced_ids.list_tags(category=category, pattern=pattern)}
        else:
            tags = list(self.reverse_index.keys())
            if category:
                tags = [tag for tag in tags if category.lower() in tag.lower()]
            if pattern:
                tags = [tag for tag in tags if pattern.lower() in tag.lower()]
            return {"tags": tags, "count": len(tags)}
    
    def handle_get_file_info(self, file_path: str) -> Dict[str, Any]:
        """Handle file info requests."""
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
    
    def handle_get_documentation_stats(self) -> Dict[str, Any]:
        """Handle documentation stats requests."""
        if self.enhanced_ids:
            return self.enhanced_ids.get_documentation_stats()
        else:
            return {
                "total_files": len(self.file_metadata),
                "total_tags": len(self.reverse_index),
                "enhanced_ids_available": False
            }

# MCP Protocol Implementation
def main():
    """Main MCP protocol loop."""
    server = IDSMCPServer()
    
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
                            "name": "impressioncore-ids",
                            "version": "1.0.0"
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
            break
        except Exception as e:
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
