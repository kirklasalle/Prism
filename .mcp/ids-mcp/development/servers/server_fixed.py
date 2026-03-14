#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\servers\server_fixed.py #command_line #documentation #python #source_code  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\servers\server_fixed.py #command_line #documentation #python #source_code  
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
        logging.FileHandler(CURRENT_DIR / 'ids_mcp.log')
    ]
)
logger = logging.getLogger("ids-mcp-server")

class IDSMCPServer:
    """MCP Server for ImpressionCore Documentation System."""
    
    def __init__(self):
        self.version = "1.0.0"
        self.console = Console() if HAS_RICH else None
        self.enhanced_ids = None
        self.unified_index = {}
        self.file_metadata = {}
        self.reverse_index = {}
        
        # Initialize Enhanced IDS system
        if HAS_IDS:
            try:
                self.enhanced_ids = EnhancedIDS()
                logger.info("Enhanced IDS system initialized successfully")
            except Exception as e:
                logger.error(f"Failed to initialize Enhanced IDS: {e}")
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
    
    async def handle_list_tools(self) -> Dict[str, Any]:
        """Return list of available tools."""
        return {
            "tools": [
                {
                    "name": "ids_search",
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
                    "name": "ids_get_file_info",
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
                    "name": "ids_list_tags",
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
                    "name": "ids_get_system_status",
                    "description": "Get current status and statistics of the IDS system",
                    "inputSchema": {
                        "type": "object",
                        "properties": {}
                    }
                },
                {
                    "name": "ids_find_by_tag",
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
                }
            ]
        }
    
    async def handle_call_tool(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Handle tool calls."""
        try:
            if name == "ids_search":
                return await self.ids_search(arguments)
            elif name == "ids_get_file_info":
                return await self.ids_get_file_info(arguments)
            elif name == "ids_list_tags":
                return await self.ids_list_tags(arguments)
            elif name == "ids_get_system_status":
                return await self.ids_get_system_status(arguments)
            elif name == "ids_find_by_tag":
                return await self.ids_find_by_tag(arguments)
            else:
                return {
                    "content": [
                        {
                            "type": "text",
                            "text": f"Unknown tool: {name}"
                        }
                    ],
                    "isError": True
                }
        except Exception as e:
            logger.error(f"Error in tool {name}: {e}")
            return {
                "content": [
                    {
                        "type": "text",
                        "text": f"Error executing {name}: {str(e)}"
                    }
                ],
                "isError": True
            }
    
    async def ids_search(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Search through IDS documentation."""
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
                search_results = self.enhanced_ids.search(query, max_results=max_results, tags=tags)
                if search_results:
                    formatted_results = []
                    for result in search_results:
                        # Handle different result formats
                        if isinstance(result, dict):
                            formatted_results.append(f"**{result.get('title', result.get('path', 'Untitled'))}**")
                            formatted_results.append(f"Path: {result.get('path', 'Unknown')}")
                            formatted_results.append(f"Score: {result.get('score', 0):.2f}")
                            formatted_results.append(f"Tags: {', '.join(result.get('tags', []))}")
                        elif isinstance(result, (list, tuple)) and len(result) >= 2:
                            # Handle list/tuple format [path, score, ...]
                            path = result[0]
                            score = result[1]
                            formatted_results.append(f"**{path}**")
                            formatted_results.append(f"Score: {score:.2f}")
                        else:
                            # Handle string or other formats
                            formatted_results.append(f"**{str(result)}**")
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
        
        for file_path, file_data in self.unified_index.items():
            score = 0
            
            # Search in file content and tags
            file_tags = file_data.get('tags', [])
            file_content = str(file_data.get('content', ''))
            
            # Basic text matching
            if query_lower in file_content.lower():
                score += 10
            
            # Tag matching
            if tags:
                matching_tags = set(tags) & set(file_tags)
                if matching_tags:
                    score += len(matching_tags) * 5
            
            # Tag content matching
            for tag in file_tags:
                if query_lower in tag.lower():
                    score += 3
            
            if score > 0:
                results.append({
                    "file_path": file_path,
                    "score": score,
                    "tags": file_tags,
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
                if result["tags"]:
                    result_text += f"   Tags: {', '.join(result['tags'][:5])}\n"
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
        file_path = arguments.get("file_path", "")
        
        if not file_path:
            return {
                "content": [{"type": "text", "text": "file_path parameter is required"}],
                "isError": True
            }
        
        # Check if file exists in our indices
        file_data = self.unified_index.get(file_path)
        metadata = self.file_metadata.get(file_path, {})
        
        if not file_data and not metadata:
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
            info_text += "\n"
        
        if file_data:
            tags = file_data.get('tags', [])
            if tags:
                info_text += "## Tags\n"
                for tag in tags:
                    info_text += f"- {tag}\n"
                info_text += "\n"
            
            content = file_data.get('content', '')
            if content:
                # Show first 500 characters of content
                preview = content[:500]
                if len(content) > 500:
                    preview += "..."
                info_text += "## Content Preview\n"
                info_text += f"```\n{preview}\n```\n"
        
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
        
        all_tags = set()
        
        # Collect tags from reverse index
        if self.reverse_index:
            for tag in self.reverse_index.keys():
                all_tags.add(tag)
        
        # Collect tags from unified index
        for file_data in self.unified_index.values():
            file_tags = file_data.get('tags', [])
            all_tags.update(file_tags)
        
        # Filter by category if specified
        if category:
            filtered_tags = [tag for tag in all_tags if category.lower() in tag.lower()]
        else:
            filtered_tags = list(all_tags)
        
        # Filter by pattern if specified
        if pattern:
            filtered_tags = [tag for tag in filtered_tags if pattern.lower() in tag.lower()]
        
        # Sort tags
        filtered_tags.sort()
        
        # Build response
        if filtered_tags:
            result_text = f"Found {len(filtered_tags)} tags"
            if category:
                result_text += f" (category: {category})"
            if pattern:
                result_text += f" (pattern: {pattern})"
            result_text += ":\n\n"
            
            # Group tags by category for better organization
            categorized = {}
            for tag in filtered_tags:
                # Simple categorization based on tag structure
                if '.' in tag:
                    cat = tag.split('.')[0]
                elif '_' in tag:
                    cat = tag.split('_')[0]
                else:
                    cat = 'general'
                
                if cat not in categorized:
                    categorized[cat] = []
                categorized[cat].append(tag)
            
            for cat, tags in sorted(categorized.items()):
                result_text += f"## {cat.title()}\n"
                for tag in tags:
                    # Show file count if available in reverse index
                    file_count = len(self.reverse_index.get(tag, [])) if self.reverse_index.get(tag) else 0
                    result_text += f"- {tag}"
                    if file_count > 0:
                        result_text += f" ({file_count} files)"
                    result_text += "\n"
                result_text += "\n"
        else:
            result_text = "No tags found"
            if category or pattern:
                result_text += " matching the specified criteria"
        
        return {
            "content": [{
                "type": "text",
                "text": result_text
            }]
        }
    
    async def ids_get_system_status(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Get current status and statistics of the IDS system."""
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
                file_data = self.unified_index.get(file_path, {})
                file_tags = file_data.get('tags', [])
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
    """Run the MCP server."""
    logger.info("Starting IDS MCP Server...")
    
    try:
        while True:
            line = sys.stdin.readline()
            if not line:
                logger.info("EOF received, shutting down")
                break
            
            line = line.strip()
            if not line:
                continue
                
            try:
                message = json.loads(line)
                logger.debug(f"Received message: {message.get('method', 'unknown')}")
                response = await handle_message(message)
                if response:  # Some methods like 'initialized' return None
                    print(json.dumps(response))
                    sys.stdout.flush()
                
            except json.JSONDecodeError as e:
                logger.error(f"Invalid JSON received: {e}")
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
                
    except KeyboardInterrupt:
        logger.info("Server interrupted by user")
    except Exception as e:
        logger.error(f"Fatal error in server loop: {e}")
    finally:
        logger.info("MCP server shutting down")

if __name__ == "__main__":
    asyncio.run(run_server())
