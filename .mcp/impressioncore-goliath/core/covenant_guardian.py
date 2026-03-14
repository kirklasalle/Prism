#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** July-26-2025  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\impressioncore_goliath\core\covenant_guardian.py #python #security #source_code  
**Category:** Source Code  
**Status:** Active
"""






import os
import json
import shutil
import hashlib
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
import asyncio

class GoliathCovenantGuardian:
    """
    Sacred Covenant Guardian for ImpressionCore-Goliath.
    
    Provides military-grade file integrity protection, comprehensive
    backup systems, and automatic recovery capabilities.
    """
    
    def __init__(self, project_root: Optional[str] = None):
        self.project_root = Path(project_root) if project_root else Path.cwd()
        self.backup_dir = self.project_root / ".goliath_backups"
        self.integrity_log = self.backup_dir / "integrity.log"
        
        # Ensure backup directory exists
        self.backup_dir.mkdir(exist_ok=True)
        
        # File integrity tracking
        self.file_hashes = {}
        self.protected_paths = set()
        self.backup_history = []
        
        # Initialize covenant protection
        self._initialize_protection()
    
    def _initialize_protection(self):
        """Initialize Sacred Covenant file protection."""
        try:
            # Add critical ImpressionCore paths to protection
            # FAST START: Avoid hashing massive src/docs folders if GOLIATH_FAST_START is set
            if os.environ.get("GOLIATH_FAST_START") == "1":
                critical_paths = [
                    self.project_root / ".mcp",
                    self.project_root / "requirements.txt",
                    self.project_root / "README.md"
                ]
            else:
                critical_paths = [
                    self.project_root / ".mcp",
                    self.project_root / "requirements.txt",
                    self.project_root / "README.md"
                ]
                # Optional: Add src/docs back if specifically requested or in prod
                # self.project_root / "src",
                # self.project_root / "docs",
            
            for path in critical_paths:
                if path.exists():
                    self.add_protected_path(path)
            
            self._log_covenant("✅ Sacred Covenant protection initialized")
            
        except Exception as e:
            self._log_covenant(f"❌ Protection initialization failed: {e}")
    
    def add_protected_path(self, path: Path):
        """Add a path to Sacred Covenant protection."""
        if path.exists():
            self.protected_paths.add(str(path))
            if path.is_file():
                self.file_hashes[str(path)] = self._calculate_file_hash(path)
            elif path.is_dir():
                for file_path in path.rglob("*"):
                    if file_path.is_file():
                        self.file_hashes[str(file_path)] = self._calculate_file_hash(file_path)
    
    def _calculate_file_hash(self, file_path: Path) -> str:
        """Calculate SHA-256 hash of a file."""
        try:
            with open(file_path, 'rb') as f:
                return hashlib.sha256(f.read()).hexdigest()
        except Exception:
            return ""
    
    def _log_covenant(self, message: str):
        """Log Sacred Covenant events."""
        timestamp = datetime.now().isoformat()
        log_entry = f"[{timestamp}] {message}\n"
        
        try:
            with open(self.integrity_log, 'a', encoding='utf-8') as f:
                f.write(log_entry)
        except Exception as e:
            print(f"Covenant logging failed: {e}")
    
    async def create_backup(self, backup_name: str = None) -> str:
        """Create comprehensive backup with unique ID."""
        if not backup_name:
            backup_name = f"auto_backup_{int(time.time())}"
        
        backup_id = f"{backup_name}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        backup_path = self.backup_dir / backup_id
        
        try:
            backup_path.mkdir(exist_ok=True)
            
            # Create backup manifest
            manifest = {
                "backup_id": backup_id,
                "created_at": datetime.now().isoformat(),
                "protected_paths": list(self.protected_paths),
                "file_count": 0,
                "backup_size": 0
            }
            
            # Backup all protected files
            for path_str in self.protected_paths:
                path = Path(path_str)
                if path.exists():
                    if path.is_file():
                        self._backup_file(path, backup_path, manifest)
                    elif path.is_dir():
                        self._backup_directory(path, backup_path, manifest)
            
            # Save manifest
            with open(backup_path / "manifest.json", 'w') as f:
                json.dump(manifest, f, indent=2)
            
            self.backup_history.append(backup_id)
            self._log_covenant(f"✅ Backup created: {backup_id} ({manifest['file_count']} files)")
            
            return backup_id
            
        except Exception as e:
            self._log_covenant(f"❌ Backup creation failed: {e}")
            raise
    
    def _backup_file(self, source: Path, backup_root: Path, manifest: Dict):
        """Backup a single file."""
        try:
            # Preserve relative path structure
            rel_path = source.relative_to(self.project_root)
            dest_path = backup_root / rel_path
            dest_path.parent.mkdir(parents=True, exist_ok=True)
            
            # Copy file with metadata
            shutil.copy2(source, dest_path)
            
            manifest["file_count"] += 1
            manifest["backup_size"] += source.stat().st_size
            
        except Exception as e:
            self._log_covenant(f"⚠️ File backup failed: {source} - {e}")
    
    def _backup_directory(self, source: Path, backup_root: Path, manifest: Dict):
        """Backup a directory recursively."""
        try:
            for file_path in source.rglob("*"):
                if file_path.is_file():
                    self._backup_file(file_path, backup_root, manifest)
        except Exception as e:
            self._log_covenant(f"⚠️ Directory backup failed: {source} - {e}")
    
    async def verify_integrity(self) -> Dict[str, Any]:
        """Verify file integrity against baseline hashes."""
        integrity_report = {
            "timestamp": datetime.now().isoformat(),
            "passed": True,
            "total_files": 0,
            "verified_files": 0,
            "corrupted_files": [],
            "missing_files": [],
            "new_files": []
        }
        
        try:
            current_hashes = {}
            
            # Check all protected paths
            for path_str in self.protected_paths:
                path = Path(path_str)
                if path.exists():
                    if path.is_file():
                        current_hashes[path_str] = self._calculate_file_hash(path)
                    elif path.is_dir():
                        for file_path in path.rglob("*"):
                            if file_path.is_file():
                                current_hashes[str(file_path)] = self._calculate_file_hash(file_path)
            
            # Compare against baseline
            for file_path, baseline_hash in self.file_hashes.items():
                integrity_report["total_files"] += 1
                
                if file_path not in current_hashes:
                    integrity_report["missing_files"].append(file_path)
                    integrity_report["passed"] = False
                elif current_hashes[file_path] != baseline_hash:
                    integrity_report["corrupted_files"].append(file_path)
                    integrity_report["passed"] = False
                else:
                    integrity_report["verified_files"] += 1
            
            # Check for new files
            for file_path in current_hashes:
                if file_path not in self.file_hashes:
                    integrity_report["new_files"].append(file_path)
            
            status = "✅ PASSED" if integrity_report["passed"] else "❌ FAILED"
            self._log_covenant(f"{status} Integrity check: {integrity_report['verified_files']}/{integrity_report['total_files']} files verified")
            
            return integrity_report
            
        except Exception as e:
            self._log_covenant(f"❌ Integrity verification failed: {e}")
            integrity_report["passed"] = False
            integrity_report["error"] = str(e)
            return integrity_report
    
    async def restore_backup(self, backup_id: str) -> bool:
        """Restore from a specific backup."""
        backup_path = self.backup_dir / backup_id
        
        if not backup_path.exists():
            self._log_covenant(f"❌ Backup not found: {backup_id}")
            return False
        
        try:
            # Load manifest
            with open(backup_path / "manifest.json", 'r') as f:
                manifest = json.load(f)
            
            # Restore files
            restored_count = 0
            for file_path in backup_path.rglob("*"):
                if file_path.is_file() and file_path.name != "manifest.json":
                    # Calculate target path
                    rel_path = file_path.relative_to(backup_path)
                    target_path = self.project_root / rel_path
                    
                    # Ensure target directory exists
                    target_path.parent.mkdir(parents=True, exist_ok=True)
                    
                    # Restore file
                    shutil.copy2(file_path, target_path)
                    restored_count += 1
            
            # Update file hashes after restoration
            self._refresh_file_hashes()
            
            self._log_covenant(f"✅ Backup restored: {backup_id} ({restored_count} files)")
            return True
            
        except Exception as e:
            self._log_covenant(f"❌ Backup restoration failed: {e}")
            return False
    
    def _refresh_file_hashes(self):
        """Refresh all file hashes after changes."""
        self.file_hashes.clear()
        for path_str in self.protected_paths:
            path = Path(path_str)
            if path.exists():
                if path.is_file():
                    self.file_hashes[path_str] = self._calculate_file_hash(path)
                elif path.is_dir():
                    for file_path in path.rglob("*"):
                        if file_path.is_file():
                            self.file_hashes[str(file_path)] = self._calculate_file_hash(file_path)
    
    def get_backup_history(self) -> List[Dict[str, Any]]:
        """Get comprehensive backup history."""
        history = []
        
        for backup_id in self.backup_history:
            backup_path = self.backup_dir / backup_id
            manifest_path = backup_path / "manifest.json"
            
            if manifest_path.exists():
                try:
                    with open(manifest_path, 'r') as f:
                        manifest = json.load(f)
                    history.append(manifest)
                except Exception:
                    continue
        
        return sorted(history, key=lambda x: x.get("created_at", ""), reverse=True)
    
    def get_protection_status(self) -> Dict[str, Any]:
        """Get current protection status."""
        return {
            "protected_paths": len(self.protected_paths),
            "monitored_files": len(self.file_hashes),
            "backup_count": len(self.backup_history),
            "backup_directory": str(self.backup_dir),
            "covenant_status": "ACTIVE",
            "last_check": datetime.now().isoformat()
        }
