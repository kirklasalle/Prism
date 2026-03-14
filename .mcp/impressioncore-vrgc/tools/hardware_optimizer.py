#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** Virtually Robotic GitHub Copilot  
**Tags:** #.mcp\impressioncore_vrgc\tools\hardware_optimizer.py #attention_mechanism #command_line #cuda #gpu_optimization #memory_management #python #pytorch #source_code #testing #training  
**Category:** Source Code  
**Status:** Active
"""






import sys
import os
import json
import time
import psutil
import GPUtil
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Any
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

class HardwareOptimizer:
    """
    Standalone hardware optimization tool for ImpressionCore VRGC.
    
    Features:
    - GTX 1050 Ti performance monitoring and optimization
    - VRAM usage tracking and memory management
    - CPU/RAM optimization for training workflows
    - Hardware configuration recommendations
    - Optional IDS integration for enhanced context
    """
    
    def __init__(self, enable_ids: bool = True):
        """Initialize Hardware Optimizer with optional IDS integration."""
        self.enable_ids = enable_ids and IDS_AVAILABLE
        self.ids = IDSIntegration() if self.enable_ids else None
        self.target_gpu = "GTX 1050 Ti"
        self.target_vram_gb = 4
        self.optimization_history = []
        
    def assess_hardware_state(self) -> Dict[str, Any]:
        """
        Comprehensive hardware state assessment.
        
        Returns:
            Dict containing current hardware metrics and status
        """
        try:
            # Get GPU information
            gpu_info = self._get_gpu_metrics()
            
            # Get CPU/RAM information
            system_info = self._get_system_metrics()
            
            # Get storage information
            storage_info = self._get_storage_metrics()
            
            # Analyze optimization opportunities
            optimization_opportunities = self._analyze_optimization_opportunities(
                gpu_info, system_info, storage_info
            )
              # Enhanced context from IDS if available
            ids_context = None
            if self.ids:
                try:
                    ids_context = self.ids.search("hardware optimization gpu vram")
                except Exception as e:
                    sys.stderr.write(f"[VRGC] IDS tap failed: {e}\n")
                    sys.stderr.flush()
            
            assessment = {
                "timestamp": datetime.now().isoformat(),
                "gpu_metrics": gpu_info,
                "system_metrics": system_info,
                "storage_metrics": storage_info,
                "optimization_opportunities": optimization_opportunities,
                "hardware_score": self._calculate_hardware_score(gpu_info, system_info),
                "ids_context": ids_context,
                "recommendations": self._generate_recommendations(optimization_opportunities)
            }
            
            return assessment
            
        except Exception as e:
            return {
                "error": f"Hardware assessment failed: {str(e)}",
                "timestamp": datetime.now().isoformat(),
                "status": "error"
            }
    
    def optimize_for_training(self) -> Dict[str, Any]:
        """
        Optimize hardware configuration for ImpressionCore-B1 training.
        
        Returns:
            Dict containing optimization results and applied changes
        """
        try:
            # Use ASCII-safe logging to avoid encoding issues
            sys.stderr.write("[VRGC] Optimizing hardware for ImpressionCore-B1 training...\n")
            sys.stderr.flush()
            
            # Pre-optimization assessment
            pre_state = self.assess_hardware_state()
            
            # Apply optimizations
            optimizations_applied = []
            
            # GPU Memory Optimization
            gpu_opts = self._optimize_gpu_memory()
            optimizations_applied.extend(gpu_opts)
            
            # CPU/RAM Optimization
            cpu_opts = self._optimize_cpu_ram()
            optimizations_applied.extend(cpu_opts)
            
            # Storage Optimization
            storage_opts = self._optimize_storage()
            optimizations_applied.extend(storage_opts)
            
            # Post-optimization assessment
            post_state = self.assess_hardware_state()
            
            # Calculate improvement metrics
            improvement_metrics = self._calculate_improvements(pre_state, post_state)
            
            optimization_result = {
                "timestamp": datetime.now().isoformat(),
                "pre_optimization": pre_state,
                "post_optimization": post_state,
                "optimizations_applied": optimizations_applied,
                "improvement_metrics": improvement_metrics,
                "status": "success"
            }
            
            # Store in optimization history
            self.optimization_history.append(optimization_result)
            
            return optimization_result
            
        except Exception as e:
            return {
                "error": f"Hardware optimization failed: {str(e)}",
                "timestamp": datetime.now().isoformat(),
                "status": "error"
            }
    
    def monitor_training_performance(self, duration_minutes: int = 10) -> Dict[str, Any]:
        """
        Monitor hardware performance during training sessions.
        
        Args:
            duration_minutes: How long to monitor (default 10 minutes)
            
        Returns:
            Dict containing performance monitoring results
        """
        try:
            # Use ASCII-safe logging to avoid encoding issues
            sys.stderr.write(f"[VRGC] Monitoring training performance for {duration_minutes} minutes...\n")
            sys.stderr.flush()
            
            monitoring_data = []
            start_time = time.time()
            end_time = start_time + (duration_minutes * 60)
            
            while time.time() < end_time:
                # Collect metrics
                metrics = {
                    "timestamp": datetime.now().isoformat(),
                    "gpu": self._get_gpu_metrics(),
                    "system": self._get_system_metrics(),
                    "elapsed_seconds": time.time() - start_time
                }
                
                monitoring_data.append(metrics)
                
                # Check for performance issues
                issues = self._detect_performance_issues(metrics)
                if issues:
                    sys.stderr.write(f"[VRGC] Performance issues detected: {issues}\n")
                    sys.stderr.flush()
                
                # Wait before next measurement
                time.sleep(30)  # Sample every 30 seconds
            
            # Analyze monitoring results
            analysis = self._analyze_monitoring_data(monitoring_data)
            
            # Get IDS recommendations if available
            ids_recommendations = None
            if self.ids:
                try:
                    ids_recommendations = self.ids.search("training performance optimization")
                except Exception as e:
                    sys.stderr.write(f"[VRGC] IDS tap failed: {e}\n")
                    sys.stderr.flush()
            
            return {
                "timestamp": datetime.now().isoformat(),
                "monitoring_duration_minutes": duration_minutes,
                "sample_count": len(monitoring_data),
                "raw_data": monitoring_data,
                "analysis": analysis,
                "ids_recommendations": ids_recommendations,
                "status": "success"
            }
            
        except Exception as e:
            return {
                "error": f"Performance monitoring failed: {str(e)}",
                "timestamp": datetime.now().isoformat(),
                "status": "error"
            }
    
    def _get_gpu_metrics(self) -> Dict[str, Any]:
        """Get current GPU metrics."""
        try:
            gpus = GPUtil.getGPUs()
            if not gpus:
                return {"error": "No GPUs detected"}
            
            gpu = gpus[0]  # Assume first GPU is target
            
            return {
                "name": gpu.name,
                "driver": gpu.driver,
                "memory_total_mb": gpu.memoryTotal,
                "memory_used_mb": gpu.memoryUsed,
                "memory_free_mb": gpu.memoryFree,
                "memory_util_percent": gpu.memoryUtil * 100,
                "gpu_util_percent": gpu.load * 100,
                "temperature_c": gpu.temperature,
                "is_target_gpu": self.target_gpu.lower() in gpu.name.lower()
            }
        except Exception as e:
            return {"error": f"GPU metrics failed: {str(e)}"}
    
    def _get_system_metrics(self) -> Dict[str, Any]:
        """Get current system metrics."""
        try:
            cpu_percent = psutil.cpu_percent(interval=1)
            memory = psutil.virtual_memory()
            
            return {
                "cpu_percent": cpu_percent,
                "cpu_count": psutil.cpu_count(),
                "cpu_count_logical": psutil.cpu_count(logical=True),
                "memory_total_gb": memory.total / (1024**3),
                "memory_used_gb": memory.used / (1024**3),
                "memory_available_gb": memory.available / (1024**3),
                "memory_percent": memory.percent
            }
        except Exception as e:
            return {"error": f"System metrics failed: {str(e)}"}
    
    def _get_storage_metrics(self) -> Dict[str, Any]:
        """Get storage metrics including F: drive."""
        try:
            storage_info = {}
            
            # Check F: drive specifically
            f_drive_path = "F:\\"
            if os.path.exists(f_drive_path):
                f_usage = psutil.disk_usage(f_drive_path)
                storage_info["f_drive"] = {
                    "total_gb": f_usage.total / (1024**3),
                    "used_gb": f_usage.used / (1024**3),
                    "free_gb": f_usage.free / (1024**3),
                    "percent_used": (f_usage.used / f_usage.total) * 100
                }
            
            # Check project drive
            project_usage = psutil.disk_usage(str(project_root))
            storage_info["project_drive"] = {
                "total_gb": project_usage.total / (1024**3),
                "used_gb": project_usage.used / (1024**3),
                "free_gb": project_usage.free / (1024**3),
                "percent_used": (project_usage.used / project_usage.total) * 100
            }
            
            return storage_info
        except Exception as e:
            return {"error": f"Storage metrics failed: {str(e)}"}
    
    def _analyze_optimization_opportunities(self, gpu_info: Dict, system_info: Dict, storage_info: Dict) -> List[str]:
        """Analyze current metrics to identify optimization opportunities."""
        opportunities = []
        
        # GPU optimization opportunities
        if isinstance(gpu_info.get("memory_util_percent"), (int, float)):
            if gpu_info["memory_util_percent"] > 90:
                opportunities.append("GPU memory usage critical - implement gradient checkpointing")
            elif gpu_info["memory_util_percent"] > 75:
                opportunities.append("GPU memory usage high - consider batch size reduction")
        
        # CPU optimization opportunities
        if isinstance(system_info.get("cpu_percent"), (int, float)):
            if system_info["cpu_percent"] > 80:
                opportunities.append("CPU usage high - optimize data loading pipeline")
        
        # Memory optimization opportunities
        if isinstance(system_info.get("memory_percent"), (int, float)):
            if system_info["memory_percent"] > 85:
                opportunities.append("System memory usage critical - implement memory management")
        
        # Storage optimization opportunities
        if "f_drive" in storage_info and isinstance(storage_info["f_drive"].get("percent_used"), (int, float)):
            if storage_info["f_drive"]["percent_used"] > 90:
                opportunities.append("F: drive storage critical - archive old embeddings")
        
        return opportunities
    
    def _calculate_hardware_score(self, gpu_info: Dict, system_info: Dict) -> float:
        """Calculate overall hardware performance score (0-100)."""
        try:
            score = 100.0
            
            # GPU score factors
            if isinstance(gpu_info.get("memory_util_percent"), (int, float)):
                if gpu_info["memory_util_percent"] > 90:
                    score -= 30
                elif gpu_info["memory_util_percent"] > 75:
                    score -= 15
            
            # CPU score factors
            if isinstance(system_info.get("cpu_percent"), (int, float)):
                if system_info["cpu_percent"] > 80:
                    score -= 20
                elif system_info["cpu_percent"] > 60:
                    score -= 10
            
            # Memory score factors
            if isinstance(system_info.get("memory_percent"), (int, float)):
                if system_info["memory_percent"] > 85:
                    score -= 25
                elif system_info["memory_percent"] > 70:
                    score -= 10
            
            return max(0.0, score)
        except Exception:
            return 50.0  # Default neutral score
    
    def _generate_recommendations(self, opportunities: List[str]) -> List[str]:
        """Generate actionable recommendations based on opportunities."""
        recommendations = []
        
        for opportunity in opportunities:
            if "gradient checkpointing" in opportunity:
                recommendations.append("Enable gradient checkpointing in training config")
            elif "batch size" in opportunity:
                recommendations.append("Reduce batch size to 8 or lower")
            elif "data loading" in opportunity:
                recommendations.append("Increase num_workers in DataLoader")
            elif "memory management" in opportunity:
                recommendations.append("Implement explicit garbage collection")
            elif "archive old embeddings" in opportunity:
                recommendations.append("Move unused embeddings to backup storage")
        
        return recommendations
    
    def _optimize_gpu_memory(self) -> List[str]:
        """Apply GPU memory optimizations."""
        optimizations = []
        
        try:
            # Set PyTorch memory management
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                torch.cuda.set_per_process_memory_fraction(0.9)
                optimizations.append("Applied PyTorch CUDA memory management")
        except ImportError:
            optimizations.append("PyTorch not available - skipped GPU optimizations")
        except Exception as e:
            optimizations.append(f"GPU optimization failed: {str(e)}")
        
        return optimizations
    
    def _optimize_cpu_ram(self) -> List[str]:
        """Apply CPU/RAM optimizations."""
        optimizations = []
        
        try:
            # Set process priority
            p = psutil.Process()
            p.nice(psutil.HIGH_PRIORITY_CLASS if os.name == 'nt' else -10)
            optimizations.append("Set high process priority for training")
        except Exception as e:
            optimizations.append(f"CPU priority optimization failed: {str(e)}")
        
        return optimizations
    
    def _optimize_storage(self) -> List[str]:
        """Apply storage optimizations."""
        optimizations = []
        
        # Check for temp file cleanup opportunities
        temp_dirs = [
            project_root / "temp",
            project_root / "__pycache__",
            project_root / ".pytest_cache"
        ]
        
        for temp_dir in temp_dirs:
            if temp_dir.exists():
                try:
                    import shutil
                    shutil.rmtree(temp_dir)
                    optimizations.append(f"Cleaned up {temp_dir}")
                except Exception as e:
                    optimizations.append(f"Failed to clean {temp_dir}: {str(e)}")
        
        return optimizations
    
    def _calculate_improvements(self, pre_state: Dict, post_state: Dict) -> Dict[str, Any]:
        """Calculate improvement metrics between pre and post optimization states."""
        improvements = {}
        
        try:
            # GPU memory improvement
            pre_gpu_mem = pre_state.get("gpu_metrics", {}).get("memory_util_percent", 0)
            post_gpu_mem = post_state.get("gpu_metrics", {}).get("memory_util_percent", 0)
            if isinstance(pre_gpu_mem, (int, float)) and isinstance(post_gpu_mem, (int, float)):
                improvements["gpu_memory_improvement"] = pre_gpu_mem - post_gpu_mem
            
            # Hardware score improvement
            pre_score = pre_state.get("hardware_score", 0)
            post_score = post_state.get("hardware_score", 0)
            if isinstance(pre_score, (int, float)) and isinstance(post_score, (int, float)):
                improvements["hardware_score_improvement"] = post_score - pre_score
            
        except Exception as e:
            improvements["error"] = f"Improvement calculation failed: {str(e)}"
        
        return improvements
    
    def _detect_performance_issues(self, metrics: Dict) -> List[str]:
        """Detect performance issues from current metrics."""
        issues = []
        
        gpu_util = metrics.get("gpu", {}).get("memory_util_percent", 0)
        if isinstance(gpu_util, (int, float)) and gpu_util > 95:
            issues.append("GPU memory critically high")
        
        cpu_util = metrics.get("system", {}).get("cpu_percent", 0)
        if isinstance(cpu_util, (int, float)) and cpu_util > 90:
            issues.append("CPU usage critically high")
        
        return issues
    
    def _analyze_monitoring_data(self, monitoring_data: List[Dict]) -> Dict[str, Any]:
        """Analyze collected monitoring data for patterns and insights."""
        if not monitoring_data:
            return {"error": "No monitoring data to analyze"}
        
        try:
            # Calculate averages
            gpu_mem_avg = sum(d.get("gpu", {}).get("memory_util_percent", 0) for d in monitoring_data) / len(monitoring_data)
            cpu_avg = sum(d.get("system", {}).get("cpu_percent", 0) for d in monitoring_data) / len(monitoring_data)
            
            # Detect trends
            gpu_trend = "stable"
            cpu_trend = "stable"
            
            if len(monitoring_data) >= 3:
                gpu_vals = [d.get("gpu", {}).get("memory_util_percent", 0) for d in monitoring_data[-3:]]
                if gpu_vals[-1] > gpu_vals[0] + 10:
                    gpu_trend = "increasing"
                elif gpu_vals[-1] < gpu_vals[0] - 10:
                    gpu_trend = "decreasing"
            
            return {
                "sample_count": len(monitoring_data),
                "averages": {
                    "gpu_memory_percent": gpu_mem_avg,
                    "cpu_percent": cpu_avg
                },
                "trends": {
                    "gpu_memory": gpu_trend,
                    "cpu_usage": cpu_trend
                },
                "performance_rating": "good" if gpu_mem_avg < 80 and cpu_avg < 70 else "needs_attention"
            }
        except Exception as e:
            return {"error": f"Analysis failed: {str(e)}"}


def run_hardware_assessment():
    """Standalone function to run hardware assessment."""
    optimizer = HardwareOptimizer()
    return optimizer.assess_hardware_state()

def run_training_optimization():
    """Standalone function to run training optimization."""
    optimizer = HardwareOptimizer()
    return optimizer.optimize_for_training()

def run_performance_monitoring(duration_minutes: int = 5):
    """Standalone function to run performance monitoring."""
    optimizer = HardwareOptimizer()
    return optimizer.monitor_training_performance(duration_minutes)


if __name__ == "__main__":
    # CLI interface for standalone usage
    import argparse
    
    parser = argparse.ArgumentParser(description="ImpressionCore VRGC Hardware Optimizer")
    parser.add_argument("--assess", action="store_true", help="Run hardware assessment")
    parser.add_argument("--optimize", action="store_true", help="Run training optimization")
    parser.add_argument("--monitor", type=int, metavar="MINUTES", help="Monitor performance for N minutes")
    parser.add_argument("--no-ids", action="store_true", help="Disable IDS integration")
    
    args = parser.parse_args()
    
    # Run requested operation
    if args.assess:
        result = run_hardware_assessment()
        print(json.dumps(result, indent=2))
    elif args.optimize:
        result = run_training_optimization()
        print(json.dumps(result, indent=2))
    elif args.monitor:
        result = run_performance_monitoring(args.monitor)
        print(json.dumps(result, indent=2))
    else:
        print("ImpressionCore VRGC Hardware Optimizer")
        print("Use --assess, --optimize, or --monitor <minutes>")
