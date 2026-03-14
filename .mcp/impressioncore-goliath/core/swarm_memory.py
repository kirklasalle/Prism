#!/usr/bin/env python3
"""
ImpressionCore Swarm Memory System
==================================

Provides a centralized, short-term and persistent knowledge store for all 
MCP servers in the ImpressionCore ecosystem.

Registers 'Digital DNA' lineages, research findings, and curatorial metadata.
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any, Optional

class SwarmMemory:
    def __init__(self, project_root: Path, logger):
        self.project_root = project_root
        self.logger = logger
        self.memory_file = project_root / ".mcp" / "goliath_swarm_memory.json"
        self.context = self._load_memory()

    def _load_memory(self) -> Dict[str, Any]:
        """Load swarm memory from disk."""
        if self.memory_file.exists():
            try:
                with open(self.memory_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                self.logger.error(f"Failed to load swarm memory: {e}")
        
        return {
            "metadata": {
                "created": datetime.now().isoformat(),
                "last_updated": datetime.now().isoformat(),
                "schema_version": "1.0.0"
            },
            "findings": {},
            "digital_dna": {},
            "performance_metrics": {},
            "active_context": []
        }

    def _save_memory(self):
        """Persist swarm memory to disk."""
        try:
            self.context["metadata"]["last_updated"] = datetime.now().isoformat()
            self.memory_file.parent.mkdir(exist_ok=True, parents=True)
            with open(self.memory_file, 'w', encoding='utf-8') as f:
                json.dump(self.context, f, indent=2)
        except Exception as e:
            self.logger.error(f"Failed to save swarm memory: {e}")

    def register_finding(self, source_server: str, key: str, value: Any, dna: Optional[str] = None):
        """Register a research or curatorial finding."""
        entry = {
            "source": source_server,
            "data": value,
            "dna": dna,
            "timestamp": datetime.now().isoformat()
        }
        self.context["findings"][key] = entry
        if dna:
            self.context["digital_dna"][dna] = key
        
        self.logger.info(f"Registered finding in SwarmMemory: {key} (Source: {source_server})")
        self._save_memory()

    def get_finding(self, key: str) -> Optional[Dict[str, Any]]:
        """Retrieve a finding by key."""
        return self.context["findings"].get(key)

    def query_by_dna(self, dna: str) -> Optional[Dict[str, Any]]:
        """Retrieve a finding by its Digital DNA signature."""
        key = self.context["digital_dna"].get(dna)
        if key:
            return self.get_finding(key)
        return None

    def update_context(self, tags: List[str]):
        """Update the active working context tags."""
        self.context["active_context"] = list(set(self.context["active_context"] + tags))
        self._save_memory()

    def get_state(self) -> Dict[str, Any]:
        """Get the full swarm state summary."""
        return {
            "active_context": self.context["active_context"],
            "finding_count": len(self.context["findings"]),
            "dna_count": len(self.context["digital_dna"]),
            "last_updated": self.context["metadata"]["last_updated"]
        }
