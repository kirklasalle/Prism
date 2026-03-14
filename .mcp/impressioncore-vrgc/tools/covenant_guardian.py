#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** Virtually Robotic GitHub Copilot  
**Tags:** #.mcp\impressioncore_vrgc\tools\covenant_guardian.py #attention_mechanism #command_line #documentation #inference #memory_management #python #source_code #testing #training  
**Category:** Source Code  
**Status:** Active
"""






import sys
import os
import json
import hashlib
import shutil
import time
import threading
import psutil
import schedule
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any, Callable
from pathlib import Path

# Add project root to path for imports
project_root = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(project_root))

try:
    from .ids_integration import IDSIntegration
    IDS_AVAILABLE = True
except ImportError:
    IDS_AVAILABLE = False
    sys.stderr.write("[VRGC] IDS Integration not available - running in standalone mode\n")
    sys.stderr.flush()

class CovenantGuardian:
    """
    Sacred Covenant compliance guardian for ImpressionCore VRGC.
    
    Provides comprehensive oversight including:
    - File integrity protocols
    - Backup requirements and F: drive management
    - Professional standards enforcement
    - Sacred Covenant principles adherence
    - ImpressionCore-B1 lifecycle monitoring
    - Read-only memlog integration for reference
    - Emergency protocol activation
    - Continuous quality assessment
    """
    
    def __init__(self, enable_ids: bool = True):
        """Initialize Covenant Guardian with B3 lifecycle oversight."""
        self.enable_ids = enable_ids and IDS_AVAILABLE
        self.ids = IDSIntegration() if self.enable_ids else None
        
        # B3 Lifecycle monitoring state
        self.model_name = "ImpressionCore-B3"
        self.version = "Enhanced Edition"
        self.sacred_covenant_active = True
        self.monitoring_active = False
        self.monitoring_thread = None
        
        # F: drive and directory configuration (no directory creation)
        self.f_drive_available = os.path.exists("F:/")
        self.f_drive_base = Path("F:/ImpressionCore") if self.f_drive_available else None
        self.local_fallback = Path("d:/Projects/impressioncore")
        # Directory paths are referenced but not created or ensured here.
        if self.f_drive_available:
            self.model_protection_dir = self.f_drive_base / "models" / "protected"
            self.b3_model_backup_dir = self.f_drive_base / "models" / "b3_backups"
            self.checkpoint_backup_dir = self.f_drive_base / "training" / "checkpoints"
            self.embedding_base_dir = self.f_drive_base / "embeddings"
        else:
            self.model_protection_dir = self.local_fallback / "models" / "protected"
            self.b3_model_backup_dir = self.local_fallback / "models" / "b3_backups"
            self.checkpoint_backup_dir = self.local_fallback / "training" / "checkpoints"
            self.embedding_base_dir = self.local_fallback / "embeddings"
        
        # Monitoring configuration
        self.config = {
            "monitoring_interval_seconds": 30,
            "health_check_interval_minutes": 5,
            "checkpoint_backup_interval_minutes": 15,
            "quality_assessment_interval_minutes": 10,
            "f_drive_monitoring_interval_minutes": 2,
            "emergency_threshold_violations": 3,
            "quality_target": 10.0,
            "quality_minimum": 6.0,
            "vram_usage_threshold": 0.8,  # 80% of 4GB
            "disk_space_threshold": 0.1,  # 10% free space minimum
        }
        
        # Monitoring state
        self.monitoring_state = {
            "start_time": None,
            "last_health_check": None,
            "last_checkpoint_backup": None,
            "last_quality_assessment": None,
            "total_training_steps": 0,
            "best_conversation_quality": 0.0,
            "covenant_violations": 0,
            "emergency_protocols_activated": 0
        }
        
        # Callback registry for events
        self.callbacks = {
            "training_milestone": [],
            "quality_improvement": [],
            "checkpoint_created": [],
            "covenant_violation": [],
            "emergency_situation": []
        }
        self.backup_dir = project_root / "backup"
        self.critical_files = [
            "src/core/models/impression_core.py",
            "src/core/training/trainer.py",
            "src/core/brainsim/memory/memory_manager.py",
            "src/main.py",
            "COPILOT_PRIME_DIRECTIVE.md",
            "COPILOT_SACRED_COVENANT.md"        ]
        self.compliance_history = []
        
    def verify_file_integrity(self) -> Dict[str, Any]:
        """
        Verify integrity of all critical project files.
        
        Returns:
            Dict containing file integrity status and any issues found
        """
        try:
            # Use ASCII-safe logging to avoid encoding issues
            sys.stderr.write("[VRGC] Verifying Sacred Covenant file integrity...\n")
            sys.stderr.flush()
            
            integrity_report = {
                "timestamp": datetime.now().isoformat(),
                "files_checked": 0,
                "files_healthy": 0,
                "files_at_risk": 0,
                "critical_issues": [],
                "warnings": [],
                "file_details": {}
            }
            
            # Check critical files
            for file_path in self.critical_files:
                full_path = project_root / file_path
                file_status = self._check_file_integrity(full_path)
                integrity_report["file_details"][file_path] = file_status
                integrity_report["files_checked"] += 1
                
                if file_status["status"] == "healthy":
                    integrity_report["files_healthy"] += 1
                elif file_status["status"] == "at_risk":
                    integrity_report["files_at_risk"] += 1
                    integrity_report["warnings"].append(f"{file_path}: {file_status['issue']}")
                elif file_status["status"] == "critical":
                    integrity_report["files_at_risk"] += 1
                    integrity_report["critical_issues"].append(f"{file_path}: {file_status['issue']}")
            
            # Check source directory structure
            src_structure = self._verify_src_structure()
            integrity_report["src_structure"] = src_structure
            
            # Check backup system
            backup_status = self._verify_backup_system()
            integrity_report["backup_system"] = backup_status
            
            # Get IDS context if available
            if self.ids:
                try:
                    ids_context = self.ids.search("file integrity backup sacred covenant")
                    integrity_report["ids_guidance"] = ids_context
                except Exception as e:
                    integrity_report["ids_warning"] = f"IDS tap failed: {e}"
              # Calculate overall compliance score
            integrity_report["compliance_score"] = self._calculate_compliance_score(integrity_report)
            
            return integrity_report
            
        except Exception as e:
            # Add more detailed error information
            import traceback
            error_details = traceback.format_exc()
            sys.stderr.write(f"[VRGC] Covenant verification error: {error_details}\n")
            sys.stderr.flush()
            
            return {
                "error": f"File integrity verification failed: {str(e)}",
                "error_details": error_details,
                "timestamp": datetime.now().isoformat(),
                "status": "error"
            }
    
    def create_comprehensive_backup(self) -> Dict[str, Any]:
        """
        Create comprehensive backup of all critical project files.
        
        Returns:
            Dict containing backup operation results
        """
        try:
            # Use ASCII-safe logging to avoid encoding issues
            sys.stderr.write("[VRGC] Creating comprehensive Sacred Covenant backup...\n")
            sys.stderr.flush()
            
            backup_timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_name = f"covenant_backup_{backup_timestamp}"
            backup_path = self.backup_dir / backup_name
            
            # Ensure backup directory exists
            backup_path.mkdir(parents=True, exist_ok=True)
            
            backup_result = {
                "timestamp": datetime.now().isoformat(),
                "backup_name": backup_name,
                "backup_path": str(backup_path),
                "files_backed_up": 0,
                "backup_size_mb": 0,
                "backup_details": {},
                "verification_hashes": {}
            }
            
            # Backup critical files
            for file_path in self.critical_files:
                source_path = project_root / file_path
                if source_path.exists():
                    # Calculate file hash before backup
                    file_hash = self._calculate_file_hash(source_path)
                    
                    # Create backup with directory structure
                    backup_file_path = backup_path / file_path
                    backup_file_path.parent.mkdir(parents=True, exist_ok=True)
                    
                    # Copy file
                    shutil.copy2(source_path, backup_file_path)
                    
                    # Verify backup integrity
                    backup_hash = self._calculate_file_hash(backup_file_path)
                    
                    if file_hash == backup_hash:
                        backup_result["files_backed_up"] += 1
                        backup_result["backup_details"][file_path] = {
                            "status": "success",
                            "size_bytes": source_path.stat().st_size,
                            "hash": file_hash
                        }
                        backup_result["verification_hashes"][file_path] = file_hash
                    else:
                        backup_result["backup_details"][file_path] = {
                            "status": "hash_mismatch",
                            "error": "Backup verification failed"
                        }
            
            # Backup entire src directory
            src_backup_path = backup_path / "src_complete"
            if (project_root / "src").exists():
                shutil.copytree(project_root / "src", src_backup_path)
                backup_result["src_backup"] = "complete"
            
            # Calculate total backup size
            backup_result["backup_size_mb"] = self._calculate_directory_size(backup_path) / (1024 * 1024)
            
            # Store backup metadata
            metadata_file = backup_path / "backup_metadata.json"
            with open(metadata_file, 'w') as f:
                json.dump(backup_result, f, indent=2)
            
            # Get IDS backup guidance if available
            if self.ids:
                try:
                    ids_guidance = self.ids.search("backup strategy file integrity")
                    backup_result["ids_guidance"] = ids_guidance
                except Exception as e:
                    backup_result["ids_warning"] = f"IDS tap failed: {e}"
            
            return backup_result
            
        except Exception as e:
            return {
                "error": f"Backup creation failed: {str(e)}",
                "timestamp": datetime.now().isoformat(),
                "status": "error"
            }
    
    def monitor_covenant_compliance(self) -> Dict[str, Any]:
        """
        Monitor ongoing Sacred Covenant compliance.
        
        Returns:
            Dict containing compliance monitoring results
        """
        try:
            print("📋 Monitoring Sacred Covenant compliance...")
            
            compliance_report = {
                "timestamp": datetime.now().isoformat(),
                "overall_status": "compliant",
                "compliance_checks": {},
                "recommendations": [],
                "covenant_score": 100
            }
            
            # File Integrity Check
            integrity_status = self.verify_file_integrity()
            compliance_report["compliance_checks"]["file_integrity"] = {
                "status": "pass" if integrity_status.get("critical_issues", []) == [] else "fail",
                "score": integrity_status.get("compliance_score", 0),
                "details": integrity_status
            }
            
            # Backup System Check
            backup_check = self._check_backup_system_health()
            compliance_report["compliance_checks"]["backup_system"] = backup_check
            
            # Professional Standards Check
            standards_check = self._check_professional_standards()
            compliance_report["compliance_checks"]["professional_standards"] = standards_check
            
            # Project Structure Check
            structure_check = self._check_project_structure()
            compliance_report["compliance_checks"]["project_structure"] = structure_check
            
            # Calculate overall compliance score
            compliance_scores = [
                check.get("score", 0) for check in compliance_report["compliance_checks"].values()
                if isinstance(check.get("score"), (int, float))
            ]
            if compliance_scores:
                compliance_report["covenant_score"] = sum(compliance_scores) / len(compliance_scores)
            
            # Determine overall status
            if compliance_report["covenant_score"] < 70:
                compliance_report["overall_status"] = "non_compliant"
            elif compliance_report["covenant_score"] < 85:
                compliance_report["overall_status"] = "needs_attention"
            
            # Generate recommendations
            compliance_report["recommendations"] = self._generate_compliance_recommendations(compliance_report)
            
            # Get IDS covenant guidance if available
            if self.ids:
                try:
                    ids_guidance = self.ids.search("sacred covenant compliance standards")
                    compliance_report["ids_guidance"] = ids_guidance
                except Exception as e:
                    compliance_report["ids_warning"] = f"IDS tap failed: {e}"
            
            # Store in compliance history
            self.compliance_history.append(compliance_report)
            
            return compliance_report
            
        except Exception as e:
            return {
                "error": f"Covenant compliance monitoring failed: {str(e)}",
                "timestamp": datetime.now().isoformat(),
                "status": "error"
            }
    
    def enforce_file_protection(self) -> Dict[str, Any]:
        """
        Enforce file protection protocols for critical files.
        
        Returns:
            Dict containing protection enforcement results
        """
        try:
            # Use ASCII-safe logging to avoid encoding issues
            sys.stderr.write("[VRGC] Enforcing Sacred Covenant file protection...\n")
            sys.stderr.flush()
            
            protection_result = {
                "timestamp": datetime.now().isoformat(),
                "files_protected": 0,
                "protection_actions": [],
                "warnings": [],
                "status": "success"
            }
            
            for file_path in self.critical_files:
                full_path = project_root / file_path
                if full_path.exists():
                    # Check if file needs protection
                    if self._file_needs_protection(full_path):
                        # Create immediate backup
                        backup_result = self._create_file_emergency_backup(full_path)
                        protection_result["protection_actions"].append(backup_result)
                        
                        # Set file permissions (if possible)
                        try:
                            if os.name == 'nt':  # Windows
                                os.system(f'attrib +R "{full_path}"')
                            else:  # Unix-like
                                os.chmod(full_path, 0o444)
                            protection_result["files_protected"] += 1
                        except Exception as e:
                            protection_result["warnings"].append(f"Failed to set protection on {file_path}: {e}")
                    
            return protection_result
            
        except Exception as e:
            return {
                "error": f"File protection enforcement failed: {str(e)}",
                "timestamp": datetime.now().isoformat(),
                "status": "error"
            }
    
    def start_b3_lifecycle_monitoring(self) -> Dict[str, Any]:
        """
        Start comprehensive ImpressionCore-B3 lifecycle monitoring.
        
        Returns:
            Dict containing startup status and configuration
        """
        try:
            if self.monitoring_active:
                return {
                    "status": "already_active",
                    "message": "🔄 Sacred Covenant: B3 lifecycle monitoring already active",
                    "monitoring_since": self.monitoring_state["start_time"].isoformat() if self.monitoring_state["start_time"] else None
                }
            
            self.monitoring_active = True
            self.monitoring_state["start_time"] = datetime.now()
            
            # Start monitoring thread
            self.monitoring_thread = threading.Thread(
                target=self._continuous_monitoring_loop,
                daemon=True,
                name="B3LifecycleMonitor"
            )
            self.monitoring_thread.start()
            
            # Log activity to memlog (read-only reference)
            self._log_to_memlog("b3_lifecycle_start", {
                "timestamp": self.monitoring_state["start_time"].isoformat(),
                "model": self.model_name,
                "version": self.version,
                "f_drive_available": self.f_drive_available,
                "monitoring_config": self.config
            })
            
            return {
                "status": "started",
                "message": f"🚀 Sacred Covenant: {self.model_name} {self.version} lifecycle monitoring started",
                "start_time": self.monitoring_state["start_time"].isoformat(),
                "f_drive_available": self.f_drive_available,
                "config": self.config
            }
            
        except Exception as e:
            self.monitoring_state["covenant_violations"] += 1
            return {
                "status": "error",
                "message": f"💥 Sacred Covenant VIOLATION: Failed to start lifecycle monitoring: {e}",
                "error": str(e)
            }
    
    def stop_b3_lifecycle_monitoring(self) -> Dict[str, Any]:
        """Stop B3 lifecycle monitoring."""
        try:
            if not self.monitoring_active:
                return {
                    "status": "already_stopped",
                    "message": "⏹️ Sacred Covenant: B3 lifecycle monitoring already stopped"
                }
            
            self.monitoring_active = False
            
            # Wait for monitoring thread to complete
            if self.monitoring_thread and self.monitoring_thread.is_alive():
                self.monitoring_thread.join(timeout=10)
            
            # Log shutdown to memlog
            self._log_to_memlog("b3_lifecycle_stop", {
                "timestamp": datetime.now().isoformat(),
                "monitoring_duration": str(datetime.now() - self.monitoring_state["start_time"]),
                "total_violations": self.monitoring_state["covenant_violations"],
                "emergency_activations": self.monitoring_state["emergency_protocols_activated"]
            })
            
            return {
                "status": "stopped",
                "message": "⏹️ Sacred Covenant: B3 lifecycle monitoring stopped",
                "monitoring_duration": str(datetime.now() - self.monitoring_state["start_time"]),
                "final_stats": {
                    "covenant_violations": self.monitoring_state["covenant_violations"],
                    "emergency_protocols_activated": self.monitoring_state["emergency_protocols_activated"],
                    "best_conversation_quality": self.monitoring_state["best_conversation_quality"]
                }
            }
            
        except Exception as e:
            return {
                "status": "error",
                "message": f"💥 Sacred Covenant VIOLATION: Error stopping monitoring: {e}",
                "error": str(e)
            }
    
    def _continuous_monitoring_loop(self) -> None:
        """Continuous monitoring loop for B3 lifecycle oversight."""
        print(f"🔄 Sacred Covenant: Entering continuous B3 lifecycle monitoring loop")
        
        last_health_check = datetime.min
        last_checkpoint_check = datetime.min
        last_quality_check = datetime.min
        last_f_drive_check = datetime.min
        
        while self.monitoring_active:
            try:
                current_time = datetime.now()
                
                # Health check
                if (current_time - last_health_check).seconds >= (self.config["health_check_interval_minutes"] * 60):
                    self._perform_comprehensive_health_check()
                    last_health_check = current_time
                
                # Checkpoint protection check
                if (current_time - last_checkpoint_check).seconds >= (self.config["checkpoint_backup_interval_minutes"] * 60):
                    self._check_for_new_checkpoints()
                    last_checkpoint_check = current_time
                
                # Quality assessment
                if (current_time - last_quality_check).seconds >= (self.config["quality_assessment_interval_minutes"] * 60):
                    self._assess_conversation_quality()
                    last_quality_check = current_time
                
                # F: drive monitoring
                if (current_time - last_f_drive_check).seconds >= (self.config["f_drive_monitoring_interval_minutes"] * 60):
                    self._monitor_f_drive_status()
                    last_f_drive_check = current_time
                
                # Sleep for monitoring interval
                time.sleep(self.config["monitoring_interval_seconds"])
                
            except Exception as e:
                print(f"💥 Sacred Covenant VIOLATION: Monitoring loop error: {e}")
                self.monitoring_state["covenant_violations"] += 1
                
                # Emergency protocol activation check
                if self.monitoring_state["covenant_violations"] >= self.config["emergency_threshold_violations"]:
                    self._activate_emergency_protocols()
                
                time.sleep(30)  # Extended sleep on error
    
    def _perform_comprehensive_health_check(self) -> Dict[str, Any]:
        """Perform comprehensive health check for B3 system."""
        try:
            health_status = {
                "timestamp": datetime.now().isoformat(),
                "system_health": "CHECKING",
                "checks": {}
            }
            
            # Check disk space
            health_status["checks"]["disk_space"] = self._check_disk_space()
            
            # Check memory usage
            health_status["checks"]["memory"] = self._check_memory_usage()
            
            # Check F: drive availability
            health_status["checks"]["f_drive"] = {
                "available": self.f_drive_available,
                "status": "HEALTHY" if self.f_drive_available else "WARNING",
                "base_path": str(self.f_drive_base) if self.f_drive_available else None
            }
            
            # Check directory integrity
            health_status["checks"]["directories"] = self._check_directory_integrity()
            
            # Check for training processes
            health_status["checks"]["training_processes"] = self._check_training_processes()
            
            # Check embedding integration
            health_status["checks"]["embeddings"] = self._check_embedding_status()
            
            # Determine overall health
            critical_issues = sum(1 for check in health_status["checks"].values() 
                                if isinstance(check, dict) and check.get("status") == "CRITICAL")
            
            if critical_issues == 0:
                health_status["system_health"] = "HEALTHY"
            elif critical_issues <= 1:
                health_status["system_health"] = "WARNING"
            else:
                health_status["system_health"] = "CRITICAL"
                self._activate_emergency_protocols()
            
            self.monitoring_state["last_health_check"] = datetime.now()
            
            # Log to memlog (read-only reference)
            self._log_to_memlog("health_check", health_status)
            
            if health_status["system_health"] != "HEALTHY":
                print(f"⚠️ Sacred Covenant: System health status: {health_status['system_health']}")
            
            return health_status
            
        except Exception as e:
            print(f"💥 Sacred Covenant VIOLATION: Health check failed: {e}")
            self.monitoring_state["covenant_violations"] += 1
            return {
                "timestamp": datetime.now().isoformat(),
                "system_health": "ERROR",
                "error": str(e)
            }
    
    def _check_disk_space(self) -> Dict[str, Any]:
        """Check disk space on critical drives."""
        try:
            drives = ["C:", "D:"]
            if self.f_drive_available:
                drives.append("F:")
            
            disk_status = {"overall_status": "HEALTHY", "drives": {}}
            
            for drive in drives:
                if os.path.exists(drive):
                    total, used, free = shutil.disk_usage(drive)
                    free_percent = free / total
                    
                    drive_status = {
                        "total_gb": round(total / (1024**3), 2),
                        "used_gb": round(used / (1024**3), 2),
                        "free_gb": round(free / (1024**3), 2),
                        "free_percent": round(free_percent * 100, 2),
                        "status": "HEALTHY"
                    }
                    
                    if free_percent < self.config["disk_space_threshold"]:
                        drive_status["status"] = "CRITICAL"
                        disk_status["overall_status"] = "CRITICAL"
                    elif free_percent < (self.config["disk_space_threshold"] * 2):
                        drive_status["status"] = "WARNING"
                        if disk_status["overall_status"] == "HEALTHY":
                            disk_status["overall_status"] = "WARNING"
                    
                    disk_status["drives"][drive] = drive_status
            
            return disk_status
            
        except Exception as e:
            return {
                "overall_status": "ERROR",
                "error": str(e)
            }
    
    def _check_memory_usage(self) -> Dict[str, Any]:
        """Check system memory usage."""
        try:
            memory = psutil.virtual_memory()
            
            memory_status = {
                "total_gb": round(memory.total / (1024**3), 2),
                "available_gb": round(memory.available / (1024**3), 2),
                "used_percent": memory.percent,
                "status": "HEALTHY"
            }
            
            if memory.percent > 90:
                memory_status["status"] = "CRITICAL"
            elif memory.percent > 80:
                memory_status["status"] = "WARNING"
            
            return memory_status
            
        except Exception as e:
            return {
                "status": "ERROR",
                "error": str(e)
            }
    
    def _check_directory_integrity(self) -> Dict[str, Any]:
        """Check integrity of critical directories."""
        try:
            critical_dirs = [
                self.model_protection_dir,
                self.b3_model_backup_dir,
                self.checkpoint_backup_dir,
                self.embedding_base_dir
            ]
            
            directory_status = {"overall_status": "HEALTHY", "directories": {}}
            
            for directory in critical_dirs:
                dir_name = directory.name
                if directory.exists():
                    directory_status["directories"][dir_name] = {
                        "exists": True,
                        "writable": os.access(directory, os.W_OK),
                        "path": str(directory),
                        "status": "HEALTHY"
                    }
                else:
                    directory_status["directories"][dir_name] = {
                        "exists": False,
                        "path": str(directory),
                        "status": "CRITICAL"
                    }
                    directory_status["overall_status"] = "CRITICAL"
                    
                    # Attempt to create missing directory
                    try:
                        directory.mkdir(parents=True, exist_ok=True)
                        directory_status["directories"][dir_name]["recovery_attempted"] = True
                    except Exception as create_error:
                        directory_status["directories"][dir_name]["recovery_error"] = str(create_error)
            
            return directory_status
            
        except Exception as e:
            return {
                "overall_status": "ERROR",
                "error": str(e)
            }
    
    def _check_training_processes(self) -> Dict[str, Any]:
        """Check for active training processes."""
        try:
            training_processes = []
            
            for proc in psutil.process_iter(['pid', 'name', 'cmdline', 'memory_info']):
                try:
                    cmdline = proc.info['cmdline']
                    if cmdline and any('train' in arg.lower() or 'impression' in arg.lower() for arg in cmdline):
                        training_processes.append({
                            "pid": proc.info['pid'],
                            "name": proc.info['name'],
                            "memory_mb": round(proc.info['memory_info'].rss / (1024*1024), 2),
                            "cmdline": ' '.join(cmdline[:5])  # First 5 args only
                        })
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue
            
            return {
                "active_processes": len(training_processes),
                "processes": training_processes,
                "status": "ACTIVE" if training_processes else "IDLE"
            }
            
        except Exception as e:
            return {
                "status": "ERROR",
                "error": str(e)
            }
    
    def _check_embedding_status(self) -> Dict[str, Any]:
        """Check status of F: drive embeddings."""
        try:
            if not self.f_drive_available:
                return {
                    "status": "F_DRIVE_UNAVAILABLE",
                    "embedding_count": 0,
                    "message": "F: drive not available for embedding storage"
                }
            
            # Check embedding directories
            embedding_dirs = list(self.embedding_base_dir.glob("*")) if self.embedding_base_dir.exists() else []
            
            total_files = 0
            total_size_gb = 0
            
            for embed_dir in embedding_dirs:
                if embed_dir.is_dir():
                    files = list(embed_dir.glob("**/*"))
                    total_files += len([f for f in files if f.is_file()])
                    total_size_gb += sum(f.stat().st_size for f in files if f.is_file()) / (1024**3)
            
            return {
                "status": "HEALTHY",
                "embedding_directories": len(embedding_dirs),
                "total_files": total_files,
                "total_size_gb": round(total_size_gb, 2),
                "base_path": str(self.embedding_base_dir)
            }
            
        except Exception as e:
            return {
                "status": "ERROR",
                "error": str(e)
            }
    
    def _log_to_memlog(self, activity_type: str, data: Dict[str, Any]) -> None:
        """
        Log activity to memlog system (read-only reference).
        
        This method provides a reference point to memlog without modifying it.
        The actual logging is handled by the memlog system itself.
        """
        try:
            # Reference memlog structure for read-only access
            memlog_dir = self.local_fallback / "src" / "memlog"
            
            # Create a reference log entry (not modifying memlog directly)
            log_entry = {
                "timestamp": datetime.now().isoformat(),
                "source": "covenant_guardian",
                "activity_type": activity_type,
                "data": data,
                "sacred_covenant": "ACTIVE"
            }
            
            # Store in VRGC's own data directory for reference
            vrgc_log_dir = Path(__file__).parent.parent / "data" / "covenant_logs"
            vrgc_log_dir.mkdir(parents=True, exist_ok=True)
            
            log_file = vrgc_log_dir / f"b1_lifecycle_{datetime.now().strftime('%Y%m%d')}.json"
            
            # Append to daily log file
            logs = []
            if log_file.exists():
                try:
                    with open(log_file, 'r') as f:
                        logs = json.load(f)
                except json.JSONDecodeError:
                    logs = []
            
            logs.append(log_entry)
            
            with open(log_file, 'w') as f:
                json.dump(logs, f, indent=2)
                
        except Exception as e:
            print(f"⚠️ Sacred Covenant: Failed to log activity: {e}")
    
    def _monitor_f_drive_status(self) -> Dict[str, Any]:
        """Monitor F: drive status and availability."""
        try:
            current_f_drive_status = os.path.exists("F:/")
            
            status_change = self.f_drive_available != current_f_drive_status
            self.f_drive_available = current_f_drive_status
            
            f_drive_status = {
                "available": self.f_drive_available,
                "status_changed": status_change,
                "timestamp": datetime.now().isoformat()
            }
            
            if self.f_drive_available:
                # Check F: drive space
                try:
                    total, used, free = shutil.disk_usage("F:")
                    f_drive_status.update({
                        "total_gb": round(total / (1024**3), 2),
                        "used_gb": round(used / (1024**3), 2),
                        "free_gb": round(free / (1024**3), 2),
                        "free_percent": round(free / total * 100, 2)
                    })
                except Exception as space_error:
                    f_drive_status["space_check_error"] = str(space_error)
            
            if status_change:
                status_msg = "F: drive became available" if self.f_drive_available else "F: drive became unavailable"
                print(f"🔄 Sacred Covenant: {status_msg}")
                self._log_to_memlog("f_drive_status_change", f_drive_status)
            
            return f_drive_status
            
        except Exception as e:
            return {
                "status": "ERROR",
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }
    
    def _check_file_integrity(self, file_path: Path) -> Dict[str, Any]:
        """Check integrity of a single file."""
        try:
            if not file_path.exists():
                return {
                    "status": "critical",
                    "issue": "File does not exist",
                    "size_bytes": 0,
                    "last_modified": None
                }
            
            file_stat = file_path.stat()
            file_size = file_stat.st_size
            
            # Check for empty files
            if file_size == 0:
                return {
                    "status": "critical",
                    "issue": "File is empty",
                    "size_bytes": 0,
                    "last_modified": datetime.fromtimestamp(file_stat.st_mtime).isoformat()
                }
            
            # Check for suspiciously small files
            if file_size < 100:  # Less than 100 bytes
                return {
                    "status": "at_risk",
                    "issue": "File is suspiciously small",
                    "size_bytes": file_size,
                    "last_modified": datetime.fromtimestamp(file_stat.st_mtime).isoformat()
                }
            
            # File appears healthy
            return {
                "status": "healthy",
                "issue": None,
                "size_bytes": file_size,
                "last_modified": datetime.fromtimestamp(file_stat.st_mtime).isoformat(),
                "hash": self._calculate_file_hash(file_path)
            }
            
        except Exception as e:
            return {
                "status": "critical",
                "issue": f"Cannot access file: {str(e)}",
                "size_bytes": 0,
                "last_modified": None
            }
    
    def _calculate_file_hash(self, file_path: Path) -> str:
        """Calculate SHA-256 hash of a file."""
        try:
            hash_sha256 = hashlib.sha256()
            with open(file_path, "rb") as f:
                for chunk in iter(lambda: f.read(4096), b""):
                    hash_sha256.update(chunk)
            return hash_sha256.hexdigest()
        except Exception:
            return "hash_calculation_failed"
    
    def _verify_src_structure(self) -> Dict[str, Any]:
        """Verify src directory structure integrity."""
        expected_dirs = [
            "src/core",
            "src/core/kernel",
            "src/core/liaison",
            "src/core/brainsim",
            "src/core/utils",
            "src/memlog",
            "src/training"
        ]
        
        structure_status = {
            "directories_expected": len(expected_dirs),
            "directories_found": 0,
            "missing_directories": [],
            "status": "healthy"
        }
        
        for dir_path in expected_dirs:
            full_path = project_root / dir_path
            if full_path.exists() and full_path.is_dir():
                structure_status["directories_found"] += 1
            else:
                structure_status["missing_directories"].append(dir_path)
        
        if structure_status["missing_directories"]:
            structure_status["status"] = "needs_attention"
        
        return structure_status
    
    def _verify_backup_system(self) -> Dict[str, Any]:
        """Verify backup system health."""
        backup_status = {
            "backup_directory_exists": self.backup_dir.exists(),
            "recent_backups": 0,
            "total_backups": 0,
            "total_backup_size_mb": 0,
            "status": "healthy"
        }
        
        if self.backup_dir.exists():
            # Count backups
            backup_dirs = [d for d in self.backup_dir.iterdir() if d.is_dir()]
            backup_status["total_backups"] = len(backup_dirs)
            
            # Check for recent backups (within 24 hours)
            recent_threshold = time.time() - (24 * 3600)
            for backup_dir in backup_dirs:
                if backup_dir.stat().st_mtime > recent_threshold:
                    backup_status["recent_backups"] += 1
            
            # Calculate total backup size
            backup_status["total_backup_size_mb"] = self._calculate_directory_size(self.backup_dir) / (1024 * 1024)
        else:
            backup_status["status"] = "needs_attention"
        
        return backup_status
    
    def _calculate_directory_size(self, directory: Path) -> int:
        """Calculate total size of directory in bytes."""
        total_size = 0
        try:
            for dirpath, dirnames, filenames in os.walk(directory):
                for filename in filenames:
                    filepath = os.path.join(dirpath, filename)
                    if os.path.exists(filepath):
                        total_size += os.path.getsize(filepath)
        except Exception:
            pass
        return total_size
    
    def _calculate_compliance_score(self, integrity_report: Dict) -> float:
        """Calculate overall compliance score."""
        try:
            total_files = integrity_report.get("files_checked", 0)
            healthy_files = integrity_report.get("files_healthy", 0)
            critical_issues = len(integrity_report.get("critical_issues", []))
            
            if total_files == 0:
                return 0.0
            
            base_score = (healthy_files / total_files) * 100
            penalty = critical_issues * 25  # 25 points per critical issue
            
            return max(0.0, base_score - penalty)
        except Exception:
            return 50.0  # Default neutral score
    
    def _check_backup_system_health(self) -> Dict[str, Any]:
        """Check backup system health for compliance."""
        backup_health = self._verify_backup_system()
        
        score = 100
        if not backup_health["backup_directory_exists"]:
            score -= 50
        if backup_health["recent_backups"] == 0:
            score -= 30
        if backup_health["total_backups"] < 3:
            score -= 20
        
        return {
            "status": "pass" if score >= 70 else "fail",
            "score": max(0, score),
            "details": backup_health
        }
    
    def _check_professional_standards(self) -> Dict[str, Any]:
        """Check adherence to professional standards."""
        standards_check = {
            "documentation_exists": (project_root / "docs").exists(),
            "readme_exists": (project_root / "README.md").exists(),
            "requirements_exists": (project_root / "requirements.txt").exists(),
            "covenant_files_exist": all([
                (project_root / "COPILOT_PRIME_DIRECTIVE.md").exists(),
                (project_root / "COPILOT_SACRED_COVENANT.md").exists()
            ])
        }
        
        score = sum(standards_check.values()) * 25  # 25 points each
        
        return {
            "status": "pass" if score >= 75 else "fail",
            "score": score,
            "details": standards_check
        }
    
    def _check_project_structure(self) -> Dict[str, Any]:
        """Check project structure compliance."""
        structure_check = self._verify_src_structure()
        
        score = 100
        if structure_check["missing_directories"]:
            score -= len(structure_check["missing_directories"]) * 15
        
        return {
            "status": "pass" if score >= 80 else "fail",
            "score": max(0, score),
            "details": structure_check
        }
    
    def _generate_compliance_recommendations(self, compliance_report: Dict) -> List[str]:
        """Generate actionable compliance recommendations."""
        recommendations = []
        
        # File integrity recommendations
        file_integrity = compliance_report["compliance_checks"].get("file_integrity", {})
        if file_integrity.get("status") == "fail":
            recommendations.append("CRITICAL: Restore corrupted files from backup immediately")
        
        # Backup system recommendations
        backup_system = compliance_report["compliance_checks"].get("backup_system", {})
        if backup_system.get("status") == "fail":
            recommendations.append("Create comprehensive backup system for file protection")
        
        # Professional standards recommendations
        standards = compliance_report["compliance_checks"].get("professional_standards", {})
        if standards.get("status") == "fail":
            recommendations.append("Update project documentation and covenant files")
        
        # Overall score recommendations
        if compliance_report.get("covenant_score", 100) < 85:
            recommendations.append("Schedule immediate compliance review and remediation")
        
        return recommendations
    
    def _file_needs_protection(self, file_path: Path) -> bool:
        """Check if file needs immediate protection."""
        try:
            file_stat = file_path.stat()
            
            # Check if file was modified recently (within 1 hour)
            recent_threshold = time.time() - 3600
            if file_stat.st_mtime > recent_threshold:
                return True
            
            # Check if file is critical and unprotected
            if file_path.suffix in ['.py', '.md', '.json', '.yaml']:
                return True
            
            return False
        except Exception:
            return True  # Err on side of caution
    
    def _create_file_emergency_backup(self, file_path: Path) -> Dict[str, Any]:
        """Create emergency backup of a file."""
        try:
            backup_timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            emergency_backup_dir = self.backup_dir / "emergency_backups"
            emergency_backup_dir.mkdir(parents=True, exist_ok=True)
            
            backup_filename = f"{file_path.stem}_{backup_timestamp}{file_path.suffix}"
            backup_path = emergency_backup_dir / backup_filename
            
            shutil.copy2(file_path, backup_path)
            
            return {
                "action": "emergency_backup_created",
                "original_file": str(file_path),
                "backup_path": str(backup_path),
                "timestamp": datetime.now().isoformat(),
                "status": "success"
            }
        except Exception as e:
            return {
                "action": "emergency_backup_failed",
                "original_file": str(file_path),
                "error": str(e),
                "timestamp": datetime.now().isoformat(),
                "status": "error"
            }
    
    def _check_for_new_checkpoints(self) -> Dict[str, Any]:
        """Check for new model checkpoints and protect them."""
        try:
            checkpoint_status = {
                "timestamp": datetime.now().isoformat(),
                "new_checkpoints": [],
                "protected_checkpoints": 0,
                "status": "HEALTHY"
            }
            
            # Check local training directory for checkpoints
            local_checkpoint_dir = self.local_fallback / "models" / "checkpoints"
            if local_checkpoint_dir.exists():
                for checkpoint_file in local_checkpoint_dir.glob("*.pt"):
                    # Check if this checkpoint is newer than last backup
                    checkpoint_time = datetime.fromtimestamp(checkpoint_file.stat().st_mtime)
                    
                    if (self.monitoring_state.get("last_checkpoint_backup") is None or 
                        checkpoint_time > self.monitoring_state["last_checkpoint_backup"]):
                        
                        # Protect this checkpoint
                        protection_result = self._protect_checkpoint(checkpoint_file)
                        
                        if protection_result["success"]:
                            checkpoint_status["new_checkpoints"].append({
                                "file": checkpoint_file.name,
                                "timestamp": checkpoint_time.isoformat(),
                                "size_mb": round(checkpoint_file.stat().st_size / (1024*1024), 2),
                                "protected": True,
                                "backup_path": protection_result["backup_path"]
                            })
                            checkpoint_status["protected_checkpoints"] += 1
                        else:
                            checkpoint_status["new_checkpoints"].append({
                                "file": checkpoint_file.name,
                                "timestamp": checkpoint_time.isoformat(),
                                "protected": False,
                                "error": protection_result["error"]
                            })
                            checkpoint_status["status"] = "WARNING"
            
            self.monitoring_state["last_checkpoint_backup"] = datetime.now()
            
            if checkpoint_status["new_checkpoints"]:
                self._log_to_memlog("checkpoint_protection", checkpoint_status)
                print(f"🛡️ Sacred Covenant: Protected {checkpoint_status['protected_checkpoints']} new checkpoints")
            
            return checkpoint_status
            
        except Exception as e:
            print(f"💥 Sacred Covenant VIOLATION: Checkpoint check failed: {e}")
            return {
                "timestamp": datetime.now().isoformat(),
                "status": "ERROR",
                "error": str(e)
            }
    
    def _protect_checkpoint(self, checkpoint_file: Path) -> Dict[str, Any]:
        """Protect a specific checkpoint by backing it up."""
        try:
            # Create timestamped backup filename  
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_filename = f"{checkpoint_file.stem}_{timestamp}.pt"
            backup_path = self.checkpoint_backup_dir / backup_filename
            
            # Copy checkpoint to backup location
            shutil.copy2(checkpoint_file, backup_path)
            
            # Verify backup integrity
            original_hash = self._calculate_file_hash(checkpoint_file)
            backup_hash = self._calculate_file_hash(backup_path)
            
            if original_hash == backup_hash:
                return {
                    "success": True,
                    "backup_path": str(backup_path),
                    "integrity_verified": True
                }
            else:
                return {
                    "success": False,
                    "error": "Backup integrity verification failed"
                }
                
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    def _assess_conversation_quality(self) -> Dict[str, Any]:
        """Assess current conversation quality towards 10/10 goal."""
        try:
            quality_assessment = {
                "timestamp": datetime.now().isoformat(),
                "target_quality": self.config["quality_target"],
                "minimum_quality": self.config["quality_minimum"],
                "current_assessment": "MONITORING",
                "status": "ACTIVE"
            }
            
            # Check for recent model outputs or inference logs
            # This would normally connect to actual model evaluation
            # For now, we monitor for training progress indicators
            
            training_logs = self._check_training_logs_for_quality_metrics()
            
            if training_logs:
                quality_assessment["training_metrics"] = training_logs
                
                # Extract quality indicators if available
                if "loss" in training_logs:
                    # Lower loss generally indicates better quality
                    estimated_quality = max(1.0, 10.0 - (training_logs["loss"] * 2))
                    quality_assessment["estimated_quality"] = round(estimated_quality, 2)
                    
                    # Update best quality if improved
                    if estimated_quality > self.monitoring_state["best_conversation_quality"]:
                        self.monitoring_state["best_conversation_quality"] = estimated_quality
                        quality_assessment["quality_improved"] = True
                        print(f"🎯 Sacred Covenant: Quality improvement detected: {estimated_quality:.2f}/10.0")
            
            self.monitoring_state["last_quality_assessment"] = datetime.now()
            self._log_to_memlog("quality_assessment", quality_assessment)
            
            return quality_assessment
            
        except Exception as e:
            print(f"💥 Sacred Covenant VIOLATION: Quality assessment failed: {e}")
            return {
                "timestamp": datetime.now().isoformat(),
                "status": "ERROR",
                "error": str(e)
            }
    
    def _check_training_logs_for_quality_metrics(self) -> Dict[str, Any]:
        """Check training logs for quality metrics."""
        try:
            # Look for recent training logs
            log_dir = self.local_fallback / "src" / "memlog"
            
            if not log_dir.exists():
                return {}
            
            # Find most recent training logs
            log_files = list(log_dir.glob("training_*.json"))
            if not log_files:
                return {}
            
            # Get most recent log file
            latest_log = max(log_files, key=lambda f: f.stat().st_mtime)
            
            # Read and parse log for metrics
            with open(latest_log, 'r') as f:
                log_data = json.load(f)
            
            # Extract relevant metrics
            metrics = {}
            if isinstance(log_data, list) and log_data:
                recent_entry = log_data[-1]
                if "loss" in str(recent_entry).lower():
                    # Extract loss value if present
                    for key, value in recent_entry.items():
                        if "loss" in key.lower() and isinstance(value, (int, float)):
                            metrics["loss"] = value
                        elif "accuracy" in key.lower() and isinstance(value, (int, float)):
                            metrics["accuracy"] = value
                        elif "step" in key.lower() and isinstance(value, (int, float)):
                            metrics["training_step"] = value
            
            return metrics
            
        except Exception as e:
            return {"error": str(e)}
    
    def _activate_emergency_protocols(self) -> Dict[str, Any]:
        """Activate emergency protocols for Sacred Covenant violations."""
        try:
            self.monitoring_state["emergency_protocols_activated"] += 1
            
            emergency_status = {
                "timestamp": datetime.now().isoformat(),
                "activation_count": self.monitoring_state["emergency_protocols_activated"],
                "violation_count": self.monitoring_state["covenant_violations"],
                "protocols_activated": []
            }
            
            print(f"🚨 SACRED COVENANT EMERGENCY PROTOCOL ACTIVATION #{self.monitoring_state['emergency_protocols_activated']}")
            
            # Protocol 1: Create emergency backup
            try:
                backup_result = self._create_emergency_backup()
                emergency_status["protocols_activated"].append({
                    "protocol": "emergency_backup",
                    "success": backup_result["success"],
                    "details": backup_result
                })
            except Exception as backup_error:
                emergency_status["protocols_activated"].append({
                    "protocol": "emergency_backup",
                    "success": False,
                    "error": str(backup_error)
                })
            
            # Protocol 2: Verify file integrity
            try:
                integrity_result = self.verify_file_integrity()
                emergency_status["protocols_activated"].append({
                    "protocol": "file_integrity_check",
                    "success": integrity_result.get("status") == "verified",
                    "details": integrity_result
                })
            except Exception as integrity_error:
                emergency_status["protocols_activated"].append({
                    "protocol": "file_integrity_check",
                    "success": False,
                    "error": str(integrity_error)
                })
            
            # Protocol 3: Alert and documentation
            emergency_status["protocols_activated"].append({
                "protocol": "emergency_documentation",
                "success": True,
                "message": "Emergency documented in covenant logs"
            })
            
            # Log emergency to memlog
            self._log_to_memlog("emergency_protocol_activation", emergency_status)
            
            print(f"🛡️ Sacred Covenant: Emergency protocols completed. Check logs for details.")
            
            return emergency_status
            
        except Exception as e:
            print(f"💥 CRITICAL: Emergency protocol activation failed: {e}")
            return {
                "timestamp": datetime.now().isoformat(),
                "status": "CRITICAL_ERROR",
                "error": str(e)
            }
    
    def _create_emergency_backup(self) -> Dict[str, Any]:
        """Create emergency backup of critical files."""
        try:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            emergency_backup_dir = self.local_fallback / "backup" / f"emergency_covenant_protection_{timestamp}"
            emergency_backup_dir.mkdir(parents=True, exist_ok=True)
            
            backed_up_files = []
            failed_files = []
            
            # Backup critical project files
            critical_paths = [
                "src/core",
                "src/main.py",
                "COPILOT_PRIME_DIRECTIVE.md",
                "COPILOT_SACRED_COVENANT.md",
                "requirements.txt"
            ]
            
            for path_str in critical_paths:
                source_path = self.local_fallback / path_str
                if source_path.exists():
                    try:
                        if source_path.is_file():
                            dest_path = emergency_backup_dir / path_str
                            dest_path.parent.mkdir(parents=True, exist_ok=True)
                            shutil.copy2(source_path, dest_path)
                            backed_up_files.append(path_str)
                        elif source_path.is_dir():
                            dest_path = emergency_backup_dir / path_str
                            shutil.copytree(source_path, dest_path, dirs_exist_ok=True)
                            backed_up_files.append(path_str)
                    except Exception as file_error:
                        failed_files.append({"path": path_str, "error": str(file_error)})
            
            return {
                "success": len(failed_files) == 0,
                "backup_directory": str(emergency_backup_dir),
                "backed_up_files": backed_up_files,
                "failed_files": failed_files,
                "total_files": len(backed_up_files) + len(failed_files)
            }
            
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    def get_monitoring_status(self) -> Dict[str, Any]:
        """Get current B1 lifecycle monitoring status."""
        return {
            "monitoring_active": self.monitoring_active,
            "model_name": self.model_name,
            "version": self.version,
            "sacred_covenant_active": self.sacred_covenant_active,
            "f_drive_available": self.f_drive_available,
            "monitoring_state": self.monitoring_state.copy(),
            "config": self.config.copy(),
            "directories": {
                "model_protection": str(self.model_protection_dir),
                "b1_backups": str(self.b1_model_backup_dir),
                "checkpoint_backups": str(self.checkpoint_backup_dir),
                "embedding_base": str(self.embedding_base_dir)
            }
        }
    
    def _calculate_file_hash(self, file_path: Path) -> str:
        """Calculate SHA256 hash of a file."""
        hash_sha256 = hashlib.sha256()
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(4096), b""):
                hash_sha256.update(chunk)
        return hash_sha256.hexdigest()


def run_integrity_verification():
    """Standalone function to run file integrity verification."""
    guardian = CovenantGuardian()
    return guardian.verify_file_integrity()

def run_comprehensive_backup():
    """Standalone function to create comprehensive backup."""
    guardian = CovenantGuardian()
    return guardian.create_comprehensive_backup()

def monitor_compliance():
    """Standalone function to monitor covenant compliance."""
    guardian = CovenantGuardian()
    return guardian.monitor_covenant_compliance()


if __name__ == "__main__":
    # CLI interface for standalone usage
    import argparse
    
    parser = argparse.ArgumentParser(description="ImpressionCore VRGC Sacred Covenant Guardian")
    parser.add_argument("--verify", action="store_true", help="Verify file integrity")
    parser.add_argument("--backup", action="store_true", help="Create comprehensive backup")
    parser.add_argument("--monitor", action="store_true", help="Monitor covenant compliance")
    parser.add_argument("--protect", action="store_true", help="Enforce file protection")
    parser.add_argument("--no-ids", action="store_true", help="Disable IDS integration")
    
    args = parser.parse_args()
    
    # Initialize guardian
    guardian = CovenantGuardian(enable_ids=not args.no_ids)
    
    # Run requested operation
    if args.verify:
        result = guardian.verify_file_integrity()
        print(json.dumps(result, indent=2))
    elif args.backup:
        result = guardian.create_comprehensive_backup()
        print(json.dumps(result, indent=2))
    elif args.monitor:
        result = guardian.monitor_covenant_compliance()
        print(json.dumps(result, indent=2))
    elif args.protect:
        result = guardian.enforce_file_protection()
        print(json.dumps(result, indent=2))
    else:
        print("ImpressionCore VRGC Sacred Covenant Guardian")
        print("Use --verify, --backup, --monitor, or --protect")
