#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** Virtually Robotic GitHub Copilot  
**Tags:** #.mcp\impressioncore_vrgc\tools\training_monitor.py #command_line #cuda #documentation #gpu_optimization #inference #memory_management #python #pytorch #source_code #testing #training  
**Category:** Source Code  
**Status:** Active
"""








import asyncio
import json
import os
import sys
import psutil
import torch
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from pathlib import Path
import glob

# Import IDS integration (graceful failure if not available)
try:
    from .ids_integration import tap_ids_if_available, enhance_with_context, get_context_or_fallback
    IDS_INTEGRATION_AVAILABLE = True
except ImportError:
    IDS_INTEGRATION_AVAILABLE = False
    async def tap_ids_if_available(*args, **kwargs): return None
    def enhance_with_context(base_result, ids_context=None): return base_result
    def get_context_or_fallback(context_type, ids_context=None): return {}

class VRGCTrainingMonitor:
    """
    B1 Training monitoring with autonomous oversight capabilities.
    
    Core Capabilities:
    - Monitor training progress and quality metrics
    - Track 10/10 inference quality goal
    - Hardware performance monitoring
    - Resource usage optimization
    - Optional IDS enhancement for training documentation
    """
    
    def __init__(self, project_root: str = "d:/Projects/impressioncore"):
        self.project_root = Path(project_root)
        self.monitor_timestamp = datetime.now()
        self.quality_target = 10.0
        
    async def monitor_active_training(self) -> Dict[str, Any]:
        """
        Monitor any currently active training processes.
        """
        training_status = {
            "monitoring_type": "active_training",
            "timestamp": self.monitor_timestamp.isoformat(),
            "active_processes": [],
            "gpu_utilization": 0.0,
            "memory_usage": {},
            "training_detected": False
        }
        
        # Check for Python training processes
        training_keywords = ["train", "trainer", "training", "pytorch", "torch"]
        
        for proc in psutil.process_iter(['pid', 'name', 'cmdline', 'cpu_percent', 'memory_percent']):
            try:
                proc_info = proc.info
                cmdline = ' '.join(proc_info['cmdline']) if proc_info['cmdline'] else ''
                
                # Check if this looks like a training process
                if any(keyword in cmdline.lower() for keyword in training_keywords):
                    if 'python' in proc_info['name'].lower():
                        training_status["active_processes"].append({
                            "pid": proc_info['pid'],
                            "name": proc_info['name'],
                            "command": cmdline[:100] + "..." if len(cmdline) > 100 else cmdline,
                            "cpu_percent": proc_info['cpu_percent'],
                            "memory_percent": proc_info['memory_percent']
                        })
                        training_status["training_detected"] = True
                        
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        
        # GPU monitoring
        if torch.cuda.is_available():
            try:
                torch.cuda.reset_peak_memory_stats()
                memory_allocated = torch.cuda.memory_allocated() / 1024**3
                memory_reserved = torch.cuda.memory_reserved() / 1024**3
                memory_total = torch.cuda.get_device_properties(0).total_memory / 1024**3
                
                training_status["memory_usage"] = {
                    "allocated_gb": memory_allocated,
                    "reserved_gb": memory_reserved,
                    "total_gb": memory_total,
                    "utilization_percent": (memory_allocated / memory_total) * 100
                }
                
                training_status["gpu_utilization"] = (memory_allocated / memory_total) * 100
                
            except Exception as e:
                training_status["gpu_error"] = str(e)
        
        # Optional IDS enhancement for training documentation
        ids_context = None
        if IDS_INTEGRATION_AVAILABLE:
            ids_context = await tap_ids_if_available("search", query="training monitoring", max_results=3)
        
        return enhance_with_context(training_status, ids_context)
    
    async def assess_b1_model_quality(self) -> Dict[str, Any]:
        """
        Assess current B1 model quality against 10/10 target.
        """
        quality_assessment = {
            "assessment_type": "b1_model_quality",
            "timestamp": self.monitor_timestamp.isoformat(),
            "quality_target": self.quality_target,
            "model_checkpoints": [],
            "latest_quality_score": None,
            "quality_trend": "unknown",
            "target_achieved": False
        }
        
        # Look for model checkpoints and quality metrics
        checkpoint_patterns = [
            "F:/models/*/quality_*.json",
            "F:/models/*/*/quality_*.json",
            str(self.project_root / "models/*/quality_*.json"),
            str(self.project_root / "checkpoints/*/quality_*.json")
        ]
        
        checkpoint_files = []
        for pattern in checkpoint_patterns:
            checkpoint_files.extend(glob.glob(pattern))
        
        # Analyze checkpoint quality scores
        quality_scores = []
        for checkpoint_file in checkpoint_files[-10:]:  # Last 10 checkpoints
            try:
                if os.path.exists(checkpoint_file):
                    # Extract quality score from filename (common pattern)
                    filename = os.path.basename(checkpoint_file)
                    if "quality_" in filename:
                        quality_str = filename.split("quality_")[1].split("_")[0]
                        try:
                            quality_score = float(quality_str)
                            quality_scores.append({
                                "file": checkpoint_file,
                                "score": quality_score,
                                "timestamp": os.path.getmtime(checkpoint_file)
                            })
                        except ValueError:
                            continue
                            
            except Exception as e:
                continue
        
        # Sort by timestamp and analyze trend
        if quality_scores:
            quality_scores.sort(key=lambda x: x["timestamp"])
            quality_assessment["model_checkpoints"] = quality_scores
            quality_assessment["latest_quality_score"] = quality_scores[-1]["score"]
            
            # Analyze quality trend
            if len(quality_scores) >= 2:
                recent_scores = [q["score"] for q in quality_scores[-3:]]
                if len(recent_scores) >= 2:
                    if recent_scores[-1] > recent_scores[0]:
                        quality_assessment["quality_trend"] = "improving"
                    elif recent_scores[-1] < recent_scores[0]:
                        quality_assessment["quality_trend"] = "declining"
                    else:
                        quality_assessment["quality_trend"] = "stable"
            
            # Check if target achieved
            quality_assessment["target_achieved"] = quality_assessment["latest_quality_score"] >= self.quality_target
            quality_assessment["target_progress"] = (quality_assessment["latest_quality_score"] / self.quality_target) * 100
        
        # Optional IDS enhancement for B1 model documentation
        ids_context = None
        if IDS_INTEGRATION_AVAILABLE:
            ids_context = await tap_ids_if_available("search", query="b1 model quality", max_results=5)
        
        return enhance_with_context(quality_assessment, ids_context)
    
    async def monitor_hardware_performance(self) -> Dict[str, Any]:
        """
        Monitor hardware performance during training.
        """
        performance_monitor = {
            "monitoring_type": "hardware_performance",
            "timestamp": self.monitor_timestamp.isoformat(),
            "cpu_usage": psutil.cpu_percent(interval=1),
            "memory_usage": dict(psutil.virtual_memory()._asdict()),
            "disk_usage": {},
            "gpu_performance": {},
            "optimization_recommendations": []
        }
        
        # Memory usage analysis
        memory = psutil.virtual_memory()
        performance_monitor["memory_efficiency"] = {
            "available_gb": memory.available / 1024**3,
            "used_percent": memory.percent,
            "sufficient_for_training": memory.available > 8 * 1024**3  # 8GB minimum
        }
        
        # Disk usage for training drives
        disk_paths = [str(self.project_root), "F:/"]
        for disk_path in disk_paths:
            if os.path.exists(disk_path):
                try:
                    usage = psutil.disk_usage(disk_path)
                    performance_monitor["disk_usage"][disk_path] = {
                        "free_gb": usage.free / 1024**3,
                        "total_gb": usage.total / 1024**3,
                        "percent_used": ((usage.total - usage.free) / usage.total) * 100
                    }
                except Exception as e:
                    performance_monitor["disk_usage"][disk_path] = {"error": str(e)}
        
        # GPU performance monitoring
        if torch.cuda.is_available():
            try:
                gpu_props = torch.cuda.get_device_properties(0)
                performance_monitor["gpu_performance"] = {
                    "device_name": gpu_props.name,
                    "total_memory_gb": gpu_props.total_memory / 1024**3,
                    "memory_allocated_gb": torch.cuda.memory_allocated() / 1024**3,
                    "memory_reserved_gb": torch.cuda.memory_reserved() / 1024**3,
                    "memory_efficiency": (torch.cuda.memory_allocated() / gpu_props.total_memory) * 100,
                    "gtx_1050_ti_optimized": "GTX 1050 Ti" in gpu_props.name
                }
                
                # Optimization recommendations
                memory_efficiency = performance_monitor["gpu_performance"]["memory_efficiency"]
                if memory_efficiency > 90:
                    performance_monitor["optimization_recommendations"].append(
                        "High GPU memory usage detected - consider gradient checkpointing"
                    )
                elif memory_efficiency < 50:
                    performance_monitor["optimization_recommendations"].append(
                        "Low GPU memory usage - potential for larger batch sizes"
                    )
                
            except Exception as e:
                performance_monitor["gpu_performance"]["error"] = str(e)
        
        # CPU optimization recommendations
        if performance_monitor["cpu_usage"] > 90:
            performance_monitor["optimization_recommendations"].append(
                "High CPU usage - consider reducing data loading workers"
            )
        
        # Memory optimization recommendations
        if memory.percent > 85:
            performance_monitor["optimization_recommendations"].append(
                "High memory usage - consider reducing model size or batch size"
            )
        
        # Optional IDS enhancement for hardware optimization documentation
        ids_context = None
        if IDS_INTEGRATION_AVAILABLE:
            ids_context = await tap_ids_if_available("search", query="hardware optimization", max_results=3)
        
        return enhance_with_context(performance_monitor, ids_context)
    
    async def generate_training_report(self) -> Dict[str, Any]:
        """
        Generate comprehensive training monitoring report.
        """
        # Use ASCII-safe logging to avoid encoding issues
        sys.stderr.write("[VRGC] Generating VRGC Training Monitor Report...\n")
        sys.stderr.flush()
        
        # Run all monitoring assessments
        monitoring_results = await asyncio.gather(
            self.monitor_active_training(),
            self.assess_b1_model_quality(),
            self.monitor_hardware_performance()
        )
        
        # Compile comprehensive training report
        training_report = {
            "vrgc_training_monitor": {
                "version": "1.0.0",
                "timestamp": self.monitor_timestamp.isoformat(),
                "monitoring_duration": (datetime.now() - self.monitor_timestamp).total_seconds(),
                "quality_target": self.quality_target,
                "standalone_mode": not IDS_INTEGRATION_AVAILABLE
            },
            "active_training": monitoring_results[0],
            "b1_quality": monitoring_results[1],
            "hardware_performance": monitoring_results[2]
        }
        
        # Generate overall training status
        training_active = monitoring_results[0].get("training_detected", False)
        quality_score = monitoring_results[1].get("latest_quality_score")
        target_achieved = monitoring_results[1].get("target_achieved", False)
        
        if target_achieved:
            training_status = "🏆 TARGET ACHIEVED - 10/10 Quality Goal Reached"
        elif training_active and quality_score:
            training_status = f"🎯 TRAINING ACTIVE - Quality: {quality_score:.1f}/10.0"
        elif quality_score:
            training_status = f"⏸️ TRAINING PAUSED - Last Quality: {quality_score:.1f}/10.0"
        else:
            training_status = "🔄 READY FOR TRAINING - No Recent Quality Data"
        
        training_report["overall_status"] = training_status
        
        # Optimization recommendations
        all_recommendations = []
        for result in monitoring_results:
            if "optimization_recommendations" in result:
                all_recommendations.extend(result["optimization_recommendations"])
        
        training_report["optimization_recommendations"] = all_recommendations
        
        # Optional IDS enhancement for overall training status
        if IDS_INTEGRATION_AVAILABLE:
            training_ids_context = await tap_ids_if_available("search", query="training status b1", max_results=5)
            if training_ids_context:
                training_report["ids_training_context"] = training_ids_context
        
        return training_report

# MCP Tool Function
async def vrgc_monitor_training(params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    MCP tool function for training monitoring.
    Works standalone or enhanced with IDS.
    """
    try:
        project_root = params.get("project_root", "d:/Projects/impressioncore") if params else "d:/Projects/impressioncore"
        quality_target = params.get("quality_target", 10.0) if params else 10.0
        
        monitor = VRGCTrainingMonitor(project_root)
        monitor.quality_target = quality_target
        
        result = await monitor.generate_training_report()
        
        return {
            "success": True,
            "tool": "vrgc_monitor_training",
            "standalone_capable": True,
            "ids_enhanced": IDS_INTEGRATION_AVAILABLE,
            "result": result
        }
        
    except Exception as e:
        return {
            "success": False,
            "tool": "vrgc_monitor_training",
            "error": str(e),
            "standalone_capable": True
        }

# Standalone execution capability
if __name__ == "__main__":
    async def main():
        result = await vrgc_monitor_training()
        print(json.dumps(result, indent=2))
    
    asyncio.run(main())
