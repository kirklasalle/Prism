#!/usr/bin/env python3
r"""
Goliath Tool Registry

Created: July 26, 2025
Updated: August 12, 2025
Author: ImpressionCore Team
Tags: #.mcp\impressioncore_goliath\utils\tool_registry.py #documentation #python #source_code #training #web_interface
Category: Source Code
Status: Active
"""






import json
from typing import Dict, List, Optional, Any, Set
from dataclasses import dataclass
from datetime import datetime

try:
    from mcp.types import Tool
    MCP_AVAILABLE = True
except ImportError:
    MCP_AVAILABLE = False
    # Fallback Tool class
    @dataclass
    class Tool:
        name: str
        description: str
        inputSchema: Dict[str, Any]

@dataclass
class ToolMetadata:
    """Metadata for registered tools."""
    name: str
    bridge_name: str
    description: str
    category: str
    is_file_modifying: bool
    execution_count: int = 0
    last_executed: Optional[str] = None
    average_duration: float = 0.0

class GoliathToolRegistry:
    """
    Unified tool registry for ImpressionCore-Goliath.
    
    Manages all tools from the 6 integrated MCP servers with
    namespace organization, metadata tracking, and performance monitoring.
    """
    
    def __init__(self):
        self.tools: Dict[str, Tool] = {}
        self.metadata: Dict[str, ToolMetadata] = {}
        self.bridge_tools: Dict[str, List[str]] = {}
        self.categories: Dict[str, List[str]] = {}
        
        # File-modifying tools that require Sacred Covenant protection
        self.file_modifying_tools: Set[str] = {
            "ids_run_header_updater",
            "ids_run_documentation_indexer",
            "eds_create_training_dataset",
            "dpa_shutdown"
        }
        
        self._initialize_categories()
    
    def _initialize_categories(self):
        """Initialize tool categories for organization."""
        self.categories = {
            "documentation": [],
            "search": [],
            "educational": [],
            "system": [],
            "web": [],
            "analysis": [],
            "accessibility": [],
            "training": [],
            "performance": []
        }
    
    def register_tool(self, tool: Tool, bridge_name: str):
        """Register a tool from a specific bridge."""
        # Ensure tool name has bridge prefix for namespace separation
        if not tool.name.startswith(f"{bridge_name}_"):
            tool.name = f"{bridge_name}_{tool.name}"
        
        # Register tool
        self.tools[tool.name] = tool
        
        # Create metadata
        category = self._determine_category(tool.name, tool.description)
        metadata = ToolMetadata(
            name=tool.name,
            bridge_name=bridge_name,
            description=tool.description,
            category=category,
            is_file_modifying=tool.name in self.file_modifying_tools
        )
        self.metadata[tool.name] = metadata
        
        # Update bridge tools mapping
        if bridge_name not in self.bridge_tools:
            self.bridge_tools[bridge_name] = []
        self.bridge_tools[bridge_name].append(tool.name)
        
        # Update category mapping
        self.categories[category].append(tool.name)
    
    def _determine_category(self, tool_name: str, description: str) -> str:
        """Determine the category for a tool based on name and description."""
        name_lower = tool_name.lower()
        desc_lower = description.lower()
        
        # IDS tools
        if "ids_" in name_lower:
            if "search" in name_lower or "search" in desc_lower:
                return "search"
            elif "documentation" in desc_lower or "index" in desc_lower:
                return "documentation"
            else:
                return "system"
        
        # DPA tools
        elif "dpa_" in name_lower:
            if "accessibility" in desc_lower:
                return "accessibility"
            elif "analyze" in desc_lower or "intent" in desc_lower:
                return "analysis"
            else:
                return "system"
        
        # EDS tools
        elif "eds_" in name_lower:
            if "training" in desc_lower or "dataset" in desc_lower:
                return "training"
            else:
                return "educational"
        
        # IPA tools
        elif "ipa_" in name_lower:
            if "search" in name_lower or "search" in desc_lower:
                return "search"
            else:
                return "analysis"
        
        # VRGC tools
        elif "vrgc_" in name_lower:
            if "monitor" in desc_lower or "performance" in desc_lower:
                return "performance"
            elif "training" in desc_lower:
                return "training"
            else:
                return "system"
        
        # Web tools
        elif "web_" in name_lower:
            return "web"
        
        # Default
        else:
            return "system"
    
    def get_tool(self, tool_name: str) -> Optional[Tool]:
        """Get a specific tool by name."""
        return self.tools.get(tool_name)
    
    def get_tool_metadata(self, tool_name: str) -> Optional[ToolMetadata]:
        """Get metadata for a specific tool."""
        return self.metadata.get(tool_name)
    
    def get_all_tools(self) -> List[Tool]:
        """Get all registered tools."""
        return list(self.tools.values())
    
    def get_tools_by_bridge(self, bridge_name: str) -> List[Tool]:
        """Get all tools from a specific bridge."""
        tool_names = self.bridge_tools.get(bridge_name, [])
        return [self.tools[name] for name in tool_names if name in self.tools]
    
    def get_tools_by_category(self, category: str) -> List[Tool]:
        """Get all tools in a specific category."""
        tool_names = self.categories.get(category, [])
        return [self.tools[name] for name in tool_names if name in self.tools]
    
    def get_tool_bridge(self, tool_name: str) -> Optional[str]:
        """Get the bridge name for a specific tool."""
        metadata = self.metadata.get(tool_name)
        return metadata.bridge_name if metadata else None
    
    def is_file_modifying_tool(self, tool_name: str) -> bool:
        """Check if a tool modifies files (requires Sacred Covenant protection)."""
        metadata = self.metadata.get(tool_name)
        return metadata.is_file_modifying if metadata else False
    
    def update_tool_stats(self, tool_name: str, execution_time: float):
        """Update execution statistics for a tool."""
        metadata = self.metadata.get(tool_name)
        if metadata:
            metadata.execution_count += 1
            metadata.last_executed = datetime.now().isoformat()
            
            # Update average duration
            if metadata.average_duration == 0.0:
                metadata.average_duration = execution_time
            else:
                # Running average calculation
                total_time = metadata.average_duration * (metadata.execution_count - 1)
                metadata.average_duration = (total_time + execution_time) / metadata.execution_count
    
    def get_registry_stats(self) -> Dict[str, Any]:
        """Get comprehensive registry statistics."""
        stats = {
            "total_tools": len(self.tools),
            "bridges": {},
            "categories": {},
            "execution_stats": {
                "most_used_tools": [],
                "file_modifying_tools": len(self.file_modifying_tools),
                "total_executions": 0
            }
        }
        
        # Bridge statistics
        for bridge_name, tool_names in self.bridge_tools.items():
            stats["bridges"][bridge_name] = {
                "tool_count": len(tool_names),
                "tools": tool_names
            }
        
        # Category statistics
        for category, tool_names in self.categories.items():
            if tool_names:  # Only include categories with tools
                stats["categories"][category] = {
                    "tool_count": len(tool_names),
                    "tools": tool_names
                }
        
        # Execution statistics
        tool_usage = []
        for tool_name, metadata in self.metadata.items():
            if metadata.execution_count > 0:
                tool_usage.append({
                    "name": tool_name,
                    "executions": metadata.execution_count,
                    "average_duration": metadata.average_duration,
                    "last_executed": metadata.last_executed
                })
                stats["execution_stats"]["total_executions"] += metadata.execution_count
        
        # Sort by usage and take top 10
        tool_usage.sort(key=lambda x: x["executions"], reverse=True)
        stats["execution_stats"]["most_used_tools"] = tool_usage[:10]
        
        return stats
    
    def search_tools(self, query: str, category: Optional[str] = None) -> List[Dict[str, Any]]:
        """Search tools by name or description."""
        query_lower = query.lower()
        results = []
        
        for tool_name, tool in self.tools.items():
            metadata = self.metadata[tool_name]
            
            # Category filter
            if category and metadata.category != category:
                continue
            
            # Search in name and description
            if (query_lower in tool_name.lower() or 
                query_lower in tool.description.lower()):
                
                results.append({
                    "name": tool_name,
                    "description": tool.description,
                    "category": metadata.category,
                    "bridge": metadata.bridge_name,
                    "executions": metadata.execution_count,
                    "is_file_modifying": metadata.is_file_modifying
                })
        
        # Sort by relevance (exact name match first, then by usage)
        results.sort(key=lambda x: (
            not x["name"].lower().startswith(query_lower),
            -x["executions"]
        ))
        
        return results
    
    def export_registry(self) -> Dict[str, Any]:
        """Export complete registry data for backup/debugging."""
        return {
            "timestamp": datetime.now().isoformat(),
            "total_tools": len(self.tools),
            "tools": {
                name: {
                    "name": tool.name,
                    "description": tool.description,
                    "inputSchema": tool.inputSchema
                }
                for name, tool in self.tools.items()
            },
            "metadata": {
                name: {
                    "name": meta.name,
                    "bridge_name": meta.bridge_name,
                    "description": meta.description,
                    "category": meta.category,
                    "is_file_modifying": meta.is_file_modifying,
                    "execution_count": meta.execution_count,
                    "last_executed": meta.last_executed,
                    "average_duration": meta.average_duration
                }
                for name, meta in self.metadata.items()
            },
            "bridge_tools": self.bridge_tools,
            "categories": self.categories
        }
