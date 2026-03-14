#!/usr/bin/env python3
"""
ImpressionCore IDS GraphRAG Bridge
Advanced relationship mapping and lineage tracking for documentation intelligence.

This module provides the GraphBridge class which handles:
1. AST-based parsing of Python source code.
2. Building an entity-relationship graph (Files, Classes, Functions, Imports).
3. Lineage tracking (Digital DNA) for code evolution.
4. Relationship queries for the IDS MCP server.

Author: ImpressionCore Team
Date: December 30, 2025
Sacred Covenant Compliance: ACTIVE
1B Parameter Foundation (GTX 1050 Ti) Optimized: YES
"""

import os
import ast
import logging
import pickle
import networkx as nx
from pathlib import Path
from typing import Dict, List, Any, Optional, Set, Tuple

# Setup logging
logger = logging.getLogger("ids-graph-bridge")

class GraphBridge:
    """Advanced GraphRAG bridge for IDS documentation intelligence."""
    
    def __init__(self, root_path: Path, graph_cache_path: Optional[Path] = None):
        self.root_path = root_path
        self.graph = nx.DiGraph()
        self.cache_path = graph_cache_path or root_path / ".mcp" / "ids-mcp" / "ids_knowledge_graph.pkl"
        
        # Ensure parent directory for cache exists
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        
        logger.info(f"🕸️ GraphBridge initialized at {root_path}")
        
    def save_graph(self):
        """Persist the graph to disk."""
        try:
            with open(self.cache_path, 'wb') as f:
                pickle.dump(self.graph, f)
            logger.info(f"💾 Graph persisted to {self.cache_path}")
        except Exception as e:
            logger.error(f"Failed to save graph: {e}")

    def load_graph(self) -> bool:
        """Load the graph from disk if it exists."""
        if self.cache_path.exists():
            try:
                with open(self.cache_path, 'rb') as f:
                    self.graph = pickle.load(f)
                logger.info(f"📂 Graph loaded from {self.cache_path}")
                return True
            except Exception as e:
                logger.error(f"Failed to load graph: {e}")
        return False

    def build_index(self):
        """Build the graph index by scanning the root directory."""
        logger.info("⚡ Building GraphRAG index...")
        self.graph.clear()
        
        # 1. Map Files and Directories
        for file_path in self.root_path.rglob("*.py"):
            # Skip hidden and vendor directories
            if any(part.startswith(".") or part in ["node_modules", "venv", "__pycache__", "backups"] for part in file_path.parts):
                continue
            
            relative_path = str(file_path.relative_to(self.root_path))
            self._parse_python_file(file_path, relative_path)
            
        logger.info(f"✅ Graph built with {len(self.graph.nodes)} nodes and {len(self.graph.edges)} edges.")
        self.save_graph()

    def _parse_python_file(self, file_path: Path, rel_path: str):
        """Parse a Python file using AST to extract entities and relationships."""
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Add file node
            self.graph.add_node(rel_path, type='file', path=str(file_path))
            
            tree = ast.parse(content)
            
            for node in ast.walk(tree):
                if isinstance(node, ast.ClassDef):
                    self._add_class_node(node, rel_path)
                elif isinstance(node, ast.FunctionDef):
                    self._add_function_node(node, rel_path)
                elif isinstance(node, (ast.Import, ast.ImportFrom)):
                    self._add_import_edges(node, rel_path)
                    
        except Exception as e:
            logger.warning(f"Failed to parse {rel_path}: {e}")

    def _add_class_node(self, node: ast.ClassDef, rel_path: str):
        class_name = node.name
        qualified_name = f"{rel_path}:{class_name}"
        
        self.graph.add_node(qualified_name, type='class', name=class_name, docstring=ast.get_docstring(node))
        self.graph.add_edge(rel_path, qualified_name, relation='defines')
        
        # Track inheritance
        for base in node.bases:
            if isinstance(base, ast.Name):
                self.graph.add_edge(qualified_name, base.id, relation='inherits_from')

    def _add_function_node(self, node: ast.FunctionDef, parent_id: str):
        func_name = node.name
        qualified_name = f"{parent_id}.{func_name}"
        
        self.graph.add_node(qualified_name, type='function', name=func_name, docstring=ast.get_docstring(node))
        self.graph.add_edge(parent_id, qualified_name, relation='defines')

    def _add_import_edges(self, node: Any, rel_path: str):
        if isinstance(node, ast.Import):
            for alias in node.names:
                self.graph.add_edge(rel_path, alias.name, relation='imports')
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            for alias in node.names:
                target = f"{module}.{alias.name}" if module else alias.name
                self.graph.add_edge(rel_path, target, relation='imports')

    def query_relationships(self, entity_name: str, depth: int = 1) -> Dict[str, Any]:
        """Find related entities within a certain depth."""
        if entity_name not in self.graph:
            # Try fuzzy match if exact match fails
            matches = [n for n in self.graph.nodes if entity_name in n]
            if not matches:
                return {"error": f"Entity '{entity_name}' not found."}
            entity_name = matches[0]

        # Get subgraph based on depth
        subgraph = nx.ego_graph(self.graph, entity_name, radius=depth, undirected=True)
        
        nodes = []
        for n, d in subgraph.nodes(data=True):
            nodes.append({"id": n, "data": d})
            
        edges = []
        for u, v, d in subgraph.edges(data=True):
            edges.append({"from": u, "to": v, "relation": d.get('relation', 'connected')})
            
        return {
            "root": entity_name,
            "nodes": nodes,
            "edges": edges
        }

    def trace_lineage(self, target_entity: str) -> List[str]:
        """Trace the 'DNA' of an entity (defining file -> classes -> functions)."""
        # This implementation traces the path from the root (system) down to the entity
        # In a real 'Digital DNA' system, this would also include historical metadata
        lineage = []
        
        # Simple implementation: find path from defining file
        # Iterate over predecessors to find defining sources
        visited = set()
        queue = [target_entity]
        
        while queue:
            current = queue.pop(0)
            if current in visited: continue
            visited.add(current)
            
            lineage.append(current)
            preds = list(self.graph.predecessors(current))
            queue.extend(preds)
            
        return lineage[::-1] # Reverse to show top-down

if __name__ == "__main__":
    # Test script
    logging.basicConfig(level=logging.INFO)
    bridge = GraphBridge(Path(os.getcwd()))
    bridge.build_index()
    print(bridge.query_relationships("AIEnhancedIDSCore"))
