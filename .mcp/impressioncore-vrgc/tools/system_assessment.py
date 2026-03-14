#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** Virtually Robotic GitHub Copilot  
**Tags:** #.mcp\impressioncore_vrgc\tools\system_assessment.py #cuda #documentation #gpu_optimization #memory_management #python #pytorch #source_code #training  
**Category:** Source Code  
**Status:** Active
"""






import asyncio
import json
import psutil
import torch
import os
import sys
from datetime import datetime
from typing import Dict, List, Optional, Any
from pathlib import Path

# Import IDS integration (graceful failure if not available)
try:
    from .ids_integration import tap_ids_if_available, enhance_with_context, get_context_or_fallback
    IDS_INTEGRATION_AVAILABLE = True
except ImportError:
    IDS_INTEGRATION_AVAILABLE = False
    # Provide fallback functions
    async def tap_ids_if_available(*args, **kwargs): return None
    def enhance_with_context(base_result, ids_context=None): return base_result
    def get_context_or_fallback(context_type, ids_context=None): return {}

class VRGCSystemAssessment:
    """
    Comprehensive system assessment with optional IDS enhancement.
    
    Core Philosophy:
    - Works completely standalone
    - Enhanced with IDS context when available
    - No dependencies on IDS for core functionality
    """
    
    def __init__(self, project_root: str = "d:/Projects/impressioncore"):
        self.project_root = Path(project_root)
        self.assessment_timestamp = datetime.now()
    
    async def assess_hardware_capabilities(self) -> Dict[str, Any]:
        """
        Standalone hardware assessment with optional IDS enhancement.
        """
        # Core standalone assessment
        hardware_info = {
            "assessment_type": "hardware_capabilities",
            "timestamp": self.assessment_timestamp.isoformat(),
            "gpu_available": torch.cuda.is_available(),
            "cpu_cores": psutil.cpu_count(),
            "ram_total_gb": psutil.virtual_memory().total / 1024**3,
            "ram_available_gb": psutil.virtual_memory().available / 1024**3,
        }
        
        # GPU-specific information
        if torch.cuda.is_available():
            hardware_info.update({
                "gpu_name": torch.cuda.get_device_name(0),
                "gpu_memory_gb": torch.cuda.get_device_properties(0).total_memory / 1024**3,
                "cuda_version": torch.version.cuda,
                "gpu_optimization_ready": True
            })
        else:
            hardware_info["gpu_optimization_ready"] = False
        
        # Attempt to enhance with IDS context
        ids_context = None
        if IDS_INTEGRATION_AVAILABLE:
            ids_context = await tap_ids_if_available("search", query="hardware", max_results=5)
        
        # Return enhanced result
        return enhance_with_context(hardware_info, ids_context)
    
    async def assess_pytorch_ecosystem(self) -> Dict[str, Any]:
        """
        Standalone PyTorch ecosystem assessment.
        """
        ecosystem_info = {
            "assessment_type": "pytorch_ecosystem",
            "timestamp": self.assessment_timestamp.isoformat(),
            "pytorch_version": torch.__version__,
            "cuda_available": torch.cuda.is_available(),
            "cudnn_enabled": torch.backends.cudnn.enabled if torch.cuda.is_available() else False,
            "mixed_precision": hasattr(torch.cuda.amp, 'autocast'),
            "distributed_available": hasattr(torch.distributed, 'is_available') and torch.distributed.is_available(),
        }
        
        # Capability scoring
        capabilities_score = sum([
            ecosystem_info["cuda_available"] * 30,
            ecosystem_info["cudnn_enabled"] * 20,
            ecosystem_info["mixed_precision"] * 25,
            ecosystem_info["distributed_available"] * 25
        ])
        
        ecosystem_info["capabilities_score"] = capabilities_score
        ecosystem_info["optimization_ready"] = capabilities_score >= 75
        
        # Optional IDS enhancement
        ids_context = None
        if IDS_INTEGRATION_AVAILABLE:
            ids_context = await tap_ids_if_available("search", query="pytorch training", max_results=3)
        
        return enhance_with_context(ecosystem_info, ids_context)
    
    async def assess_project_architecture(self) -> Dict[str, Any]:
        """
        Standalone project architecture assessment.
        """
        src_path = self.project_root / "src"
        architecture_info = {
            "assessment_type": "project_architecture",
            "timestamp": self.assessment_timestamp.isoformat(),
            "src_exists": src_path.exists(),
            "python_modules": 0,
            "core_modules": 0,
            "training_modules": 0,
            "interface_modules": 0,
            "directories": []
        }
        
        # Analyze project structure
        if src_path.exists():
            for root, dirs, files in os.walk(src_path):
                python_files = [f for f in files if f.endswith('.py')]
                if python_files:
                    architecture_info["python_modules"] += len(python_files)
                    architecture_info["directories"].append(str(root))
                    
                    # Categorize modules
                    if "core" in root:
                        architecture_info["core_modules"] += len(python_files)
                    elif "training" in root:
                        architecture_info["training_modules"] += len(python_files)
                    elif "interface" in root:
                        architecture_info["interface_modules"] += len(python_files)
        
        # Architecture health score
        module_count = architecture_info["python_modules"]
        architecture_info["architecture_health"] = min(module_count / 10, 10.0)  # Scale to 10
        architecture_info["development_ready"] = module_count > 50
        
        # Optional IDS enhancement for project status
        ids_context = None
        if IDS_INTEGRATION_AVAILABLE:
            ids_context = await tap_ids_if_available("search", query="project status", max_results=5)
        
        return enhance_with_context(architecture_info, ids_context)
    
    async def assess_training_infrastructure(self) -> Dict[str, Any]:
        """
        Standalone training infrastructure assessment.
        """
        infrastructure_info = {
            "assessment_type": "training_infrastructure",
            "timestamp": self.assessment_timestamp.isoformat(),
            "f_drive_available": False,
            "f_drive_space_gb": 0,
            "f_drive_total_gb": 0,
            "local_storage_gb": 0,
        }
        
        # Check F: drive
        if os.path.exists("F:/"):
            try:
                usage = psutil.disk_usage("F:/")
                infrastructure_info.update({
                    "f_drive_available": True,
                    "f_drive_space_gb": usage.free / 1024**3,
                    "f_drive_total_gb": usage.total / 1024**3,
                })
            except Exception as e:
                infrastructure_info["f_drive_error"] = str(e)
        
        # Check local storage
        try:
            local_usage = psutil.disk_usage(str(self.project_root))
            infrastructure_info["local_storage_gb"] = local_usage.free / 1024**3
        except Exception as e:
            infrastructure_info["local_storage_error"] = str(e)
        
        # Infrastructure readiness score
        f_drive_score = 50 if infrastructure_info["f_drive_available"] else 0
        local_storage_score = min(infrastructure_info["local_storage_gb"] * 2, 50)
        infrastructure_info["infrastructure_score"] = f_drive_score + local_storage_score
        infrastructure_info["training_ready"] = infrastructure_info["infrastructure_score"] >= 75
        
        # Optional IDS enhancement for storage information
        ids_context = None
        if IDS_INTEGRATION_AVAILABLE:
            ids_context = await tap_ids_if_available("search", query="storage training", max_results=3)
        
        return enhance_with_context(infrastructure_info, ids_context)
    
    async def assess_sacred_covenant_compliance(self) -> Dict[str, Any]:
        """
        Standalone Sacred Covenant compliance assessment.
        """
        covenant_info = {
            "assessment_type": "sacred_covenant_compliance",
            "timestamp": self.assessment_timestamp.isoformat(),
            "file_integrity_systems": [],
            "backup_systems": [],
            "compliance_score": 0
        }
        
        # Check for backup systems
        backup_dirs = ["backup/", "backups/", ".backup/"]
        for backup_dir in backup_dirs:
            backup_path = self.project_root / backup_dir
            if backup_path.exists():
                covenant_info["backup_systems"].append(str(backup_path))
        
        # Check for file integrity tools
        integrity_files = ["backup_model_loading_fix_files.py", "enhanced_backup_monitor.py"]
        for integrity_file in integrity_files:
            integrity_path = self.project_root / integrity_file
            if integrity_path.exists():
                covenant_info["file_integrity_systems"].append(str(integrity_path))
        
        # Calculate compliance score
        backup_score = len(covenant_info["backup_systems"]) * 25
        integrity_score = len(covenant_info["file_integrity_systems"]) * 25
        covenant_info["compliance_score"] = min(backup_score + integrity_score, 100)
        covenant_info["covenant_compliant"] = covenant_info["compliance_score"] >= 50
        
        # Optional IDS enhancement for covenant documentation
        ids_context = None
        if IDS_INTEGRATION_AVAILABLE:
            ids_context = await tap_ids_if_available("search", query="covenant directive", max_results=5)
        
        return enhance_with_context(covenant_info, ids_context)
    
    async def generate_comprehensive_assessment(self) -> Dict[str, Any]:
        """
        Generate complete system assessment with optional IDS enhancement.
        """
        sys.stderr.write("VRGC: Generating comprehensive system assessment...\n")
        sys.stderr.flush()
        
        # Run all assessments
        assessments = await asyncio.gather(
            self.assess_hardware_capabilities(),
            self.assess_pytorch_ecosystem(),
            self.assess_project_architecture(),
            self.assess_training_infrastructure(),
            self.assess_sacred_covenant_compliance()
        )
        
        # Compile comprehensive report
        comprehensive_report = {
            "vrgc_assessment": {
                "version": "1.0.0",
                "timestamp": self.assessment_timestamp.isoformat(),
                "assessment_duration": (datetime.now() - self.assessment_timestamp).total_seconds(),
                "standalone_mode": not IDS_INTEGRATION_AVAILABLE
            },
            "hardware": assessments[0],
            "pytorch_ecosystem": assessments[1],
            "project_architecture": assessments[2],
            "training_infrastructure": assessments[3],
            "sacred_covenant": assessments[4]
        }
        
        # Calculate overall readiness score
        individual_scores = [
            assessments[1].get("capabilities_score", 0),  # PyTorch
            assessments[2].get("architecture_health", 0) * 10,  # Architecture
            assessments[3].get("infrastructure_score", 0),  # Infrastructure
            assessments[4].get("compliance_score", 0)  # Covenant
        ]
        
        overall_score = sum(individual_scores) / len(individual_scores)
        comprehensive_report["overall_readiness_score"] = overall_score
        
        # Determine readiness level
        if overall_score >= 90:
            readiness_level = "EXCEPTIONAL - World-Class Ready"
        elif overall_score >= 80:
            readiness_level = "EXCELLENT - Production Ready"
        elif overall_score >= 70:
            readiness_level = "GOOD - Development Ready"
        else:
            readiness_level = "NEEDS IMPROVEMENT - Basic Setup"
        
        comprehensive_report["readiness_level"] = readiness_level
        
        # Optional IDS enhancement for overall project status
        if IDS_INTEGRATION_AVAILABLE:
            overall_ids_context = await tap_ids_if_available("system_status")
            if overall_ids_context:
                comprehensive_report["ids_system_integration"] = overall_ids_context
        
        return comprehensive_report

# MCP Tool Function
async def vrgc_assess_system(params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    MCP tool function for comprehensive system assessment.
    Works standalone or enhanced with IDS.
    """
    try:
        project_root = params.get("project_root", "d:/Projects/impressioncore") if params else "d:/Projects/impressioncore"
        
        assessor = VRGCSystemAssessment(project_root)
        result = await assessor.generate_comprehensive_assessment()
        
        return {
            "success": True,
            "tool": "vrgc_assess_system",
            "standalone_capable": True,
            "ids_enhanced": IDS_INTEGRATION_AVAILABLE,
            "result": result
        }
        
    except Exception as e:
        return {
            "success": False,
            "tool": "vrgc_assess_system",
            "error": str(e),
            "standalone_capable": True
        }

# Standalone execution capability
if __name__ == "__main__":
    async def main():
        result = await vrgc_assess_system()
        print(json.dumps(result, indent=2))
    
    asyncio.run(main())
