#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** Virtually Robotic GitHub Copilot  
**Tags:** #.mcp\impressioncore_vrgc\tools\project_intelligence.py #command_line #cuda #memory_management #multimodal #performance #python #source_code #testing #training  
**Category:** Source Code  
**Status:** Active
"""






import sys
import os
import json
import ast
import re
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
from pathlib import Path
from collections import defaultdict

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

class ProjectIntelligence:
    """
    Project intelligence and state analysis tool for ImpressionCore VRGC.
    
    Features:
    - Code complexity analysis
    - Development progress tracking
    - Architecture insights
    - Dependency analysis
    - Performance bottleneck identification
    - Optional IDS integration for enhanced context
    """
    
    def __init__(self, enable_ids: bool = True):
        """Initialize Project Intelligence with optional IDS integration."""
        self.enable_ids = enable_ids and IDS_AVAILABLE
        self.ids = IDSIntegration() if self.enable_ids else None
        self.src_dir = project_root / "src"
        self.analysis_cache = {}
        
    def analyze_project_state(self) -> Dict[str, Any]:
        """
        Comprehensive project state analysis.
        
        Returns:
            Dict containing project intelligence insights
        """
        try:
            # Use ASCII-safe logging to avoid encoding issues
            sys.stderr.write("[VRGC] Analyzing ImpressionCore project intelligence...\n")
            sys.stderr.flush()
            
            analysis = {
                "timestamp": datetime.now().isoformat(),
                "project_overview": self._get_project_overview(),
                "code_metrics": self._analyze_code_metrics(),
                "architecture_analysis": self._analyze_architecture(),
                "development_progress": self._analyze_development_progress(),
                "dependency_analysis": self._analyze_dependencies(),
                "performance_insights": self._analyze_performance_characteristics(),
                "recommendations": []
            }
            
            # Enhanced insights from IDS if available
            if self.ids:
                try:
                    ids_insights = self.ids.search("project development architecture progress")
                    analysis["ids_insights"] = ids_insights
                except Exception as e:
                    analysis["ids_warning"] = f"IDS tap failed: {e}"
            
            # Generate intelligent recommendations
            analysis["recommendations"] = self._generate_intelligent_recommendations(analysis)
            
            # Calculate project health score
            analysis["project_health_score"] = self._calculate_project_health_score(analysis)
            
            return analysis
            
        except Exception as e:
            return {
                "error": f"Project intelligence analysis failed: {str(e)}",
                "timestamp": datetime.now().isoformat(),
                "status": "error"
            }
    
    def analyze_code_complexity(self) -> Dict[str, Any]:
        """
        Analyze code complexity across the project.
        
        Returns:
            Dict containing code complexity metrics and insights
        """
        try:
            # Use ASCII-safe logging to avoid encoding issues
            sys.stderr.write("[VRGC] Analyzing code complexity...\n")
            sys.stderr.flush()
            
            complexity_analysis = {
                "timestamp": datetime.now().isoformat(),
                "files_analyzed": 0,
                "total_lines": 0,
                "complexity_metrics": {},
                "high_complexity_files": [],
                "refactoring_candidates": []
            }
            
            # Analyze Python files
            for python_file in self.src_dir.rglob("*.py"):
                if python_file.is_file():
                    file_metrics = self._analyze_file_complexity(python_file)
                    complexity_analysis["files_analyzed"] += 1
                    complexity_analysis["total_lines"] += file_metrics.get("lines_of_code", 0)
                    
                    relative_path = str(python_file.relative_to(project_root))
                    complexity_analysis["complexity_metrics"][relative_path] = file_metrics
                    
                    # Identify high complexity files
                    if file_metrics.get("complexity_score", 0) > 80:
                        complexity_analysis["high_complexity_files"].append({
                            "file": relative_path,
                            "score": file_metrics["complexity_score"],
                            "issues": file_metrics.get("complexity_issues", [])
                        })
                    
                    # Identify refactoring candidates
                    if file_metrics.get("lines_of_code", 0) > 500 or file_metrics.get("complexity_score", 0) > 60:
                        complexity_analysis["refactoring_candidates"].append({
                            "file": relative_path,
                            "reason": "High complexity or length",
                            "metrics": file_metrics
                        })
            
            # Get IDS guidance on complexity management
            if self.ids:
                try:
                    ids_guidance = self.ids.search("code complexity refactoring best practices")
                    complexity_analysis["ids_guidance"] = ids_guidance
                except Exception as e:
                    complexity_analysis["ids_warning"] = f"IDS tap failed: {e}"
            
            return complexity_analysis
            
        except Exception as e:
            return {
                "error": f"Code complexity analysis failed: {str(e)}",
                "timestamp": datetime.now().isoformat(),
                "status": "error"
            }
    
    def analyze_development_velocity(self) -> Dict[str, Any]:
        """
        Analyze development velocity and progress patterns.
        
        Returns:
            Dict containing development velocity insights
        """
        try:
            # Use ASCII-safe logging to avoid encoding issues
            sys.stderr.write("[VRGC] Analyzing development velocity...\n")
            sys.stderr.flush()
            
            velocity_analysis = {
                "timestamp": datetime.now().isoformat(),
                "recent_activity": self._analyze_recent_activity(),
                "development_patterns": self._analyze_development_patterns(),
                "productivity_metrics": self._calculate_productivity_metrics(),
                "milestone_progress": self._analyze_milestone_progress()
            }
            
            # Get IDS insights on development velocity
            if self.ids:
                try:
                    ids_insights = self.ids.search("development velocity productivity milestones")
                    velocity_analysis["ids_insights"] = ids_insights
                except Exception as e:
                    velocity_analysis["ids_warning"] = f"IDS tap failed: {e}"
            
            return velocity_analysis
            
        except Exception as e:
            return {
                "error": f"Development velocity analysis failed: {str(e)}",
                "timestamp": datetime.now().isoformat(),
                "status": "error"
            }
    
    def identify_optimization_opportunities(self) -> Dict[str, Any]:
        """
        Identify optimization opportunities across the project.
        
        Returns:
            Dict containing optimization recommendations
        """
        try:
            # Use ASCII-safe logging to avoid encoding issues
            sys.stderr.write("[VRGC] Identifying optimization opportunities...\n")
            sys.stderr.flush()
            
            optimization_analysis = {
                "timestamp": datetime.now().isoformat(),
                "performance_opportunities": [],
                "memory_optimizations": [],
                "code_quality_improvements": [],
                "architecture_enhancements": []
            }
            
            # Analyze performance opportunities
            optimization_analysis["performance_opportunities"] = self._identify_performance_opportunities()
            
            # Analyze memory optimization opportunities
            optimization_analysis["memory_optimizations"] = self._identify_memory_optimizations()
            
            # Analyze code quality improvements
            optimization_analysis["code_quality_improvements"] = self._identify_code_quality_improvements()
            
            # Analyze architecture enhancements
            optimization_analysis["architecture_enhancements"] = self._identify_architecture_enhancements()
            
            # Get IDS optimization guidance
            if self.ids:
                try:
                    ids_guidance = self.ids.search("optimization performance memory architecture")
                    optimization_analysis["ids_guidance"] = ids_guidance
                except Exception as e:
                    optimization_analysis["ids_warning"] = f"IDS tap failed: {e}"
            
            return optimization_analysis
            
        except Exception as e:
            return {
                "error": f"Optimization analysis failed: {str(e)}",
                "timestamp": datetime.now().isoformat(),
                "status": "error"
            }
    
    def _get_project_overview(self) -> Dict[str, Any]:
        """Get high-level project overview."""
        overview = {
            "project_name": "ImpressionCore",
            "project_type": "Multimodal AI Framework",
            "primary_language": "Python",
            "target_hardware": "GTX 1050 Ti (4GB VRAM)"
        }
        
        # Count files by type
        file_counts = defaultdict(int)
        total_size = 0
        
        for file_path in self.src_dir.rglob("*"):
            if file_path.is_file():
                file_counts[file_path.suffix] += 1
                try:
                    total_size += file_path.stat().st_size
                except Exception:
                    pass
        
        overview["file_statistics"] = dict(file_counts)
        overview["total_project_size_mb"] = total_size / (1024 * 1024)
        
        return overview
    
    def _analyze_code_metrics(self) -> Dict[str, Any]:
        """Analyze code metrics across the project."""
        metrics = {
            "total_python_files": 0,
            "total_lines_of_code": 0,
            "average_file_size": 0,
            "function_count": 0,
            "class_count": 0,
            "complexity_distribution": {"low": 0, "medium": 0, "high": 0}
        }
        
        total_complexity = 0
        file_sizes = []
        
        for python_file in self.src_dir.rglob("*.py"):
            if python_file.is_file():
                file_metrics = self._analyze_file_complexity(python_file)
                metrics["total_python_files"] += 1
                metrics["total_lines_of_code"] += file_metrics.get("lines_of_code", 0)
                metrics["function_count"] += file_metrics.get("function_count", 0)
                metrics["class_count"] += file_metrics.get("class_count", 0)
                
                file_sizes.append(file_metrics.get("lines_of_code", 0))
                total_complexity += file_metrics.get("complexity_score", 0)
                
                # Complexity distribution
                complexity_score = file_metrics.get("complexity_score", 0)
                if complexity_score < 30:
                    metrics["complexity_distribution"]["low"] += 1
                elif complexity_score < 70:
                    metrics["complexity_distribution"]["medium"] += 1
                else:
                    metrics["complexity_distribution"]["high"] += 1
        
        if file_sizes:
            metrics["average_file_size"] = sum(file_sizes) / len(file_sizes)
        
        if metrics["total_python_files"] > 0:
            metrics["average_complexity"] = total_complexity / metrics["total_python_files"]
        
        return metrics
    
    def _analyze_architecture(self) -> Dict[str, Any]:
        """Analyze project architecture."""
        architecture = {
            "core_modules": [],
            "module_dependencies": {},
            "architectural_patterns": [],
            "design_quality_score": 0
        }
        
        # Identify core modules
        core_dir = self.src_dir / "core"
        if core_dir.exists():
            for module_dir in core_dir.iterdir():
                if module_dir.is_dir() and not module_dir.name.startswith("__"):
                    architecture["core_modules"].append(module_dir.name)
        
        # Analyze module dependencies
        for python_file in self.src_dir.rglob("*.py"):
            if python_file.is_file():
                deps = self._extract_dependencies(python_file)
                relative_path = str(python_file.relative_to(self.src_dir))
                architecture["module_dependencies"][relative_path] = deps
        
        # Identify architectural patterns
        architecture["architectural_patterns"] = self._identify_architectural_patterns()
        
        # Calculate design quality score
        architecture["design_quality_score"] = self._calculate_design_quality_score(architecture)
        
        return architecture
    
    def _analyze_development_progress(self) -> Dict[str, Any]:
        """Analyze development progress."""
        progress = {
            "completion_estimate": 0,
            "active_development_areas": [],
            "completed_features": [],
            "pending_features": []
        }
        
        # Analyze TODO comments
        todo_analysis = self._analyze_todo_comments()
        progress["todo_analysis"] = todo_analysis
        
        # Estimate completion based on code coverage and TODOs
        progress["completion_estimate"] = self._estimate_project_completion()
        
        # Identify active development areas
        progress["active_development_areas"] = self._identify_active_development_areas()
        
        return progress
    
    def _analyze_dependencies(self) -> Dict[str, Any]:
        """Analyze project dependencies."""
        dependencies = {
            "external_libraries": [],
            "internal_modules": [],
            "dependency_health": "unknown"
        }
        
        # Analyze requirements.txt
        requirements_file = project_root / "requirements.txt"
        if requirements_file.exists():
            try:
                with open(requirements_file, 'r') as f:
                    dependencies["external_libraries"] = [
                        line.strip() for line in f.readlines() 
                        if line.strip() and not line.startswith("#")
                    ]
            except Exception:
                pass
        
        # Analyze internal module usage
        dependencies["internal_modules"] = self._analyze_internal_modules()
        
        return dependencies
    
    def _analyze_performance_characteristics(self) -> Dict[str, Any]:
        """Analyze performance characteristics."""
        performance = {
            "memory_usage_patterns": [],
            "computational_complexity": {},
            "io_operations": [],
            "optimization_opportunities": []
        }
        
        # Analyze memory usage patterns
        performance["memory_usage_patterns"] = self._analyze_memory_patterns()
        
        # Analyze computational complexity
        performance["computational_complexity"] = self._analyze_computational_complexity()
        
        return performance
    
    def _analyze_file_complexity(self, file_path: Path) -> Dict[str, Any]:
        """Analyze complexity of a single Python file."""
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Parse AST
            tree = ast.parse(content)
            
            # Count elements
            function_count = sum(1 for node in ast.walk(tree) if isinstance(node, ast.FunctionDef))
            class_count = sum(1 for node in ast.walk(tree) if isinstance(node, ast.ClassDef))
            lines_of_code = len([line for line in content.split('\n') if line.strip() and not line.strip().startswith('#')])
            
            # Calculate complexity score
            complexity_score = self._calculate_file_complexity_score(tree, lines_of_code)
            
            return {
                "lines_of_code": lines_of_code,
                "function_count": function_count,
                "class_count": class_count,
                "complexity_score": complexity_score,
                "complexity_issues": self._identify_complexity_issues(tree, lines_of_code)
            }
            
        except Exception as e:
            return {
                "error": f"File analysis failed: {str(e)}",
                "lines_of_code": 0,
                "function_count": 0,
                "class_count": 0,
                "complexity_score": 0
            }
    
    def _calculate_file_complexity_score(self, tree: ast.AST, lines_of_code: int) -> float:
        """Calculate complexity score for a file."""
        score = 0
        
        # Base score from lines of code
        if lines_of_code > 1000:
            score += 40
        elif lines_of_code > 500:
            score += 25
        elif lines_of_code > 200:
            score += 10
        
        # Add score for nested structures
        for node in ast.walk(tree):
            if isinstance(node, (ast.For, ast.While)):
                score += 5
            elif isinstance(node, ast.If):
                score += 3
            elif isinstance(node, (ast.Try, ast.With)):
                score += 4
            elif isinstance(node, ast.FunctionDef) and len(node.args.args) > 8:
                score += 10  # Functions with too many parameters
        
        return min(100, score)
    
    def _identify_complexity_issues(self, tree: ast.AST, lines_of_code: int) -> List[str]:
        """Identify specific complexity issues in code."""
        issues = []
        
        if lines_of_code > 1000:
            issues.append("File is very large (>1000 lines)")
        
        # Check for deeply nested structures
        max_depth = self._calculate_nesting_depth(tree)
        if max_depth > 5:
            issues.append(f"Deep nesting detected (depth: {max_depth})")
        
        # Check for functions with too many parameters
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and len(node.args.args) > 8:
                issues.append(f"Function '{node.name}' has too many parameters")
        
        return issues
    
    def _calculate_nesting_depth(self, node: ast.AST, current_depth: int = 0) -> int:
        """Calculate maximum nesting depth in AST."""
        max_depth = current_depth
        
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.For, ast.While, ast.If, ast.With, ast.Try)):
                child_depth = self._calculate_nesting_depth(child, current_depth + 1)
                max_depth = max(max_depth, child_depth)
            else:
                child_depth = self._calculate_nesting_depth(child, current_depth)
                max_depth = max(max_depth, child_depth)
        
        return max_depth
    
    def _extract_dependencies(self, file_path: Path) -> List[str]:
        """Extract dependencies from a Python file."""
        dependencies = []
        
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Find import statements
            import_pattern = r'^\s*(?:from\s+(\S+)\s+import|import\s+(\S+))'
            matches = re.findall(import_pattern, content, re.MULTILINE)
            
            for match in matches:
                dep = match[0] if match[0] else match[1]
                if dep and not dep.startswith('.'):
                    dependencies.append(dep.split('.')[0])
            
        except Exception:
            pass
        
        return list(set(dependencies))
    
    def _identify_architectural_patterns(self) -> List[str]:
        """Identify architectural patterns in the project."""
        patterns = []
        
        # Check for common patterns
        if (self.src_dir / "core").exists():
            patterns.append("Layered Architecture")
        
        if any(self.src_dir.rglob("*factory*.py")):
            patterns.append("Factory Pattern")
        
        if any(self.src_dir.rglob("*adapter*.py")):
            patterns.append("Adapter Pattern")
        
        if any(self.src_dir.rglob("*observer*.py")):
            patterns.append("Observer Pattern")
        
        if (self.src_dir / "interfaces").exists():
            patterns.append("Interface Segregation")
        
        return patterns
    
    def _calculate_design_quality_score(self, architecture: Dict) -> float:
        """Calculate overall design quality score."""
        score = 50  # Base score
        
        # Bonus for good architecture
        if len(architecture["core_modules"]) >= 4:
            score += 20
        
        if len(architecture["architectural_patterns"]) >= 3:
            score += 15
        
        # Penalty for high coupling
        avg_dependencies = sum(len(deps) for deps in architecture["module_dependencies"].values())
        if len(architecture["module_dependencies"]) > 0:
            avg_dependencies /= len(architecture["module_dependencies"])
            if avg_dependencies > 10:
                score -= 15
        
        return min(100, max(0, score))
    
    def _analyze_todo_comments(self) -> Dict[str, Any]:
        """Analyze TODO comments in the codebase."""
        todos = {"total": 0, "by_priority": {"high": 0, "medium": 0, "low": 0}, "details": []}
        
        for file_path in self.src_dir.rglob("*.py"):
            if file_path.is_file():
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        for line_num, line in enumerate(f, 1):
                            if 'TODO' in line.upper():
                                todos["total"] += 1
                                priority = "medium"  # Default priority
                                
                                if any(word in line.upper() for word in ['CRITICAL', 'URGENT', 'IMPORTANT']):
                                    priority = "high"
                                elif any(word in line.upper() for word in ['MINOR', 'LATER', 'OPTIONAL']):
                                    priority = "low"
                                
                                todos["by_priority"][priority] += 1
                                todos["details"].append({
                                    "file": str(file_path.relative_to(project_root)),
                                    "line": line_num,
                                    "text": line.strip(),
                                    "priority": priority
                                })
                except Exception:
                    pass
        
        return todos
    
    def _estimate_project_completion(self) -> float:
        """Estimate project completion percentage."""
        # This is a heuristic based on code structure and TODOs
        completion = 60  # Base completion estimate
        
        # Check for key components
        key_files = [
            "src/main.py",
            "src/core/models/impression_core.py",
            "src/core/training/trainer.py"
        ]
        
        existing_key_files = sum(1 for f in key_files if (project_root / f).exists())
        completion += (existing_key_files / len(key_files)) * 20
        
        # Adjust based on TODO count
        todo_analysis = self._analyze_todo_comments()
        if todo_analysis["total"] > 50:
            completion -= 15
        elif todo_analysis["total"] > 20:
            completion -= 8
        
        return min(100, max(0, completion))
    
    def _identify_active_development_areas(self) -> List[str]:
        """Identify areas of active development."""
        areas = []
        
        # Check for recent modifications (placeholder - would need git integration)
        if (self.src_dir / "training").exists():
            areas.append("Training Pipeline")
        
        if (self.src_dir / "core" / "models").exists():
            areas.append("Core Models")
        
        if (self.src_dir / "core" / "brainsim").exists():
            areas.append("Brain Simulation")
        
        return areas
    
    def _analyze_internal_modules(self) -> List[str]:
        """Analyze internal module structure."""
        modules = []
        
        for module_dir in self.src_dir.iterdir():
            if module_dir.is_dir() and not module_dir.name.startswith("__"):
                modules.append(module_dir.name)
        
        return modules
    
    def _analyze_memory_patterns(self) -> List[str]:
        """Analyze memory usage patterns in code."""
        patterns = []
        
        # Look for memory-intensive operations
        for python_file in self.src_dir.rglob("*.py"):
            if python_file.is_file():
                try:
                    with open(python_file, 'r', encoding='utf-8') as f:
                        content = f.read()
                        
                        if 'torch.cuda.empty_cache()' in content:
                            patterns.append("CUDA memory management detected")
                        
                        if 'del ' in content:
                            patterns.append("Explicit memory cleanup detected")
                        
                        if 'gradient_checkpointing' in content:
                            patterns.append("Gradient checkpointing optimization detected")
                            
                except Exception:
                    pass
        
        return list(set(patterns))
    
    def _analyze_computational_complexity(self) -> Dict[str, Any]:
        """Analyze computational complexity patterns."""
        complexity = {"loops": 0, "nested_loops": 0, "recursive_functions": 0}
        
        for python_file in self.src_dir.rglob("*.py"):
            if python_file.is_file():
                try:
                    with open(python_file, 'r', encoding='utf-8') as f:
                        content = f.read()
                    
                    tree = ast.parse(content)
                    
                    for node in ast.walk(tree):
                        if isinstance(node, (ast.For, ast.While)):
                            complexity["loops"] += 1
                            
                            # Check for nested loops
                            for child in ast.walk(node):
                                if isinstance(child, (ast.For, ast.While)) and child != node:
                                    complexity["nested_loops"] += 1
                                    break
                        
                        elif isinstance(node, ast.FunctionDef):
                            # Check for recursion (simplified check)
                            func_name = node.name
                            for child in ast.walk(node):
                                if isinstance(child, ast.Call) and hasattr(child.func, 'id') and child.func.id == func_name:
                                    complexity["recursive_functions"] += 1
                                    break
                
                except Exception:
                    pass
        
        return complexity
    
    def _identify_performance_opportunities(self) -> List[str]:
        """Identify performance optimization opportunities."""
        opportunities = []
        
        # Check for common performance issues
        for python_file in self.src_dir.rglob("*.py"):
            if python_file.is_file():
                try:
                    with open(python_file, 'r', encoding='utf-8') as f:
                        content = f.read()
                    
                    if 'for ' in content and 'append(' in content:
                        opportunities.append("List comprehension opportunities detected")
                    
                    if 'pandas' in content and 'iterrows()' in content:
                        opportunities.append("Pandas vectorization opportunities detected")
                    
                    if 'numpy' in content and 'for ' in content:
                        opportunities.append("NumPy vectorization opportunities detected")
                    
                except Exception:
                    pass
        
        return list(set(opportunities))
    
    def _identify_memory_optimizations(self) -> List[str]:
        """Identify memory optimization opportunities."""
        optimizations = []
        
        # Check for memory optimization patterns
        for python_file in self.src_dir.rglob("*.py"):
            if python_file.is_file():
                try:
                    with open(python_file, 'r', encoding='utf-8') as f:
                        content = f.read()
                    
                    if 'torch.tensor' in content and 'device=' not in content:
                        optimizations.append("CUDA device specification opportunities detected")
                    
                    if 'DataLoader' in content and 'pin_memory=False' in content:
                        optimizations.append("DataLoader pin_memory optimization available")
                    
                    if 'torch.no_grad()' not in content and 'eval()' in content:
                        optimizations.append("torch.no_grad() context manager opportunities")
                    
                except Exception:
                    pass
        
        return list(set(optimizations))
    
    def _identify_code_quality_improvements(self) -> List[str]:
        """Identify code quality improvement opportunities."""
        improvements = []
        
        # Check for code quality issues
        for python_file in self.src_dir.rglob("*.py"):
            if python_file.is_file():
                try:
                    with open(python_file, 'r', encoding='utf-8') as f:
                        content = f.read()
                    
                    if 'print(' in content and 'debug' not in python_file.name.lower():
                        improvements.append("Replace print statements with proper logging")
                    
                    if 'except:' in content:
                        improvements.append("Replace bare except clauses with specific exceptions")
                    
                    lines = content.split('\n')
                    long_lines = [i for i, line in enumerate(lines) if len(line) > 120]
                    if long_lines:
                        improvements.append(f"Line length improvements needed in {len(long_lines)} lines")
                    
                except Exception:
                    pass
        
        return list(set(improvements))
    
    def _identify_architecture_enhancements(self) -> List[str]:
        """Identify architecture enhancement opportunities."""
        enhancements = []
        
        # Check for architectural improvements
        if not (self.src_dir / "interfaces").exists():
            enhancements.append("Consider adding interfaces/abstractions layer")
        
        if not (self.src_dir / "tests").exists():
            enhancements.append("Add comprehensive testing infrastructure")
        
        if not (self.src_dir / "benchmarks").exists():
            enhancements.append("Add performance benchmarking infrastructure")
        
        config_files = list(self.src_dir.rglob("*config*.py"))
        if len(config_files) < 2:
            enhancements.append("Consider centralized configuration management")
        
        return enhancements
    
    def _generate_intelligent_recommendations(self, analysis: Dict) -> List[str]:
        """Generate intelligent recommendations based on analysis."""
        recommendations = []
        
        # Based on code metrics
        code_metrics = analysis.get("code_metrics", {})
        if code_metrics.get("average_complexity", 0) > 60:
            recommendations.append("Consider refactoring high-complexity modules for better maintainability")
        
        # Based on architecture analysis
        architecture = analysis.get("architecture_analysis", {})
        if architecture.get("design_quality_score", 0) < 70:
            recommendations.append("Improve architectural design patterns and module separation")
        
        # Based on development progress
        progress = analysis.get("development_progress", {})
        if progress.get("completion_estimate", 0) < 70:
            recommendations.append("Focus on completing core functionality before adding new features")
        
        # Based on performance insights
        performance = analysis.get("performance_insights", {})
        if performance.get("optimization_opportunities"):
            recommendations.append("Implement identified performance optimizations for better efficiency")
        
        return recommendations
    
    def _calculate_project_health_score(self, analysis: Dict) -> float:
        """Calculate overall project health score."""
        score = 0
        factors = 0
        
        # Code quality factor
        code_metrics = analysis.get("code_metrics", {})
        if "average_complexity" in code_metrics:
            complexity_score = max(0, 100 - code_metrics["average_complexity"])
            score += complexity_score
            factors += 1
        
        # Architecture quality factor
        architecture = analysis.get("architecture_analysis", {})
        if "design_quality_score" in architecture:
            score += architecture["design_quality_score"]
            factors += 1
        
        # Development progress factor
        progress = analysis.get("development_progress", {})
        if "completion_estimate" in progress:
            score += progress["completion_estimate"]
            factors += 1
        
        return score / factors if factors > 0 else 50


def run_project_analysis():
    """Standalone function to run project analysis."""
    intelligence = ProjectIntelligence()
    return intelligence.analyze_project_state()

def run_complexity_analysis():
    """Standalone function to run complexity analysis."""
    intelligence = ProjectIntelligence()
    return intelligence.analyze_code_complexity()

def run_velocity_analysis():
    """Standalone function to run development velocity analysis."""
    intelligence = ProjectIntelligence()
    return intelligence.analyze_development_velocity()

def run_optimization_analysis():
    """Standalone function to run optimization analysis."""
    intelligence = ProjectIntelligence()
    return intelligence.identify_optimization_opportunities()


if __name__ == "__main__":
    # CLI interface for standalone usage
    import argparse
    
    parser = argparse.ArgumentParser(description="ImpressionCore VRGC Project Intelligence")
    parser.add_argument("--analyze", action="store_true", help="Run comprehensive project analysis")
    parser.add_argument("--complexity", action="store_true", help="Analyze code complexity")
    parser.add_argument("--velocity", action="store_true", help="Analyze development velocity")
    parser.add_argument("--optimize", action="store_true", help="Identify optimization opportunities")
    parser.add_argument("--no-ids", action="store_true", help="Disable IDS integration")
    
    args = parser.parse_args()
    
    # Initialize intelligence
    intelligence = ProjectIntelligence(enable_ids=not args.no_ids)
    
    # Run requested operation
    if args.analyze:
        result = intelligence.analyze_project_state()
        print(json.dumps(result, indent=2))
    elif args.complexity:
        result = intelligence.analyze_code_complexity()
        print(json.dumps(result, indent=2))
    elif args.velocity:
        result = intelligence.analyze_development_velocity()
        print(json.dumps(result, indent=2))
    elif args.optimize:
        result = intelligence.identify_optimization_opportunities()
        print(json.dumps(result, indent=2))
    else:
        print("ImpressionCore VRGC Project Intelligence")
        print("Use --analyze, --complexity, --velocity, or --optimize")
