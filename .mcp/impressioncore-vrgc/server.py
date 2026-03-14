#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** Virtually Robotic GitHub Copilot  
**Tags:** #.mcp\impressioncore_vrgc\server.py #memory_management #python #pytorch #source_code #training  
**Category:** Source Code  
**Status:** Active
"""








import sys
import json
import os
import asyncio
import traceback
from typing import Dict, List, Any, Optional
from pathlib import Path
from datetime import datetime
from importlib import import_module

# Shared chronology loader (read-only)
try:
    from src.assistant.chronology_loader import load_chronology, query_chronology, load_delta
    HAS_CHRONO = True
except Exception:
    HAS_CHRONO = False

# Add project root to Python path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

# Import VRGC tools - Progressive loading for stability
try:
    sys.path.insert(0, str(Path(__file__).parent))
    
    # Import working tools first
    from tools.system_assessment import VRGCSystemAssessment
    from tools.training_monitor import VRGCTrainingMonitor
    WORKING_TOOLS = ["system_assessment", "training_monitor"]
    
    # Try to import additional tools (may be corrupted)
    try:
        from tools.hardware_optimizer import HardwareOptimizer
        WORKING_TOOLS.append("hardware_optimizer")
    except (ImportError, SyntaxError) as e:
        print(f"WARNING: hardware_optimizer not available: {e}", file=sys.stderr)
    
    try:
        from tools.covenant_guardian import CovenantGuardian
        WORKING_TOOLS.append("covenant_guardian")
    except (ImportError, SyntaxError) as e:
        print(f"WARNING: covenant_guardian not available: {e}", file=sys.stderr)
    
    try:
        from tools.project_intelligence import ProjectIntelligence
        WORKING_TOOLS.append("project_intelligence")
    except (ImportError, SyntaxError) as e:
        print(f"WARNING: project_intelligence not available: {e}", file=sys.stderr)
    
    TOOLS_AVAILABLE = len(WORKING_TOOLS) > 0
    print(f"VRGC: Loaded {len(WORKING_TOOLS)} tools: {WORKING_TOOLS}", file=sys.stderr)
    
except ImportError as e:
    TOOLS_AVAILABLE = False
    WORKING_TOOLS = []
    print(f"ERROR: VRGC core tools not available: {e}", file=sys.stderr)

class VRGCMCPServer:
    """
    Virtually Robotic GitHub Copilot MCP Server.
    
    Implements MCP protocol directly using JSON-RPC over stdio.
    Works independently but can tap into IDS for enhanced context.
    """
    
    def __init__(self):
        self.project_root = str(project_root)
        self.debug = os.getenv('VRGC_DEBUG', '0') == '1'
        
        # Initialize tools conditionally based on what imported successfully
        if TOOLS_AVAILABLE:
            try:
                # Always initialize working tools
                self.system_assessment = VRGCSystemAssessment(project_root=self.project_root)
                self.training_monitor = VRGCTrainingMonitor(project_root=self.project_root)
                
                # Conditionally initialize other tools
                if "hardware_optimizer" in WORKING_TOOLS:
                    self.hardware_optimizer = HardwareOptimizer()
                else:
                    self.hardware_optimizer = None
                    
                if "covenant_guardian" in WORKING_TOOLS:
                    self.covenant_guardian = CovenantGuardian()
                else:
                    self.covenant_guardian = None
                    
                if "project_intelligence" in WORKING_TOOLS:
                    self.project_intelligence = ProjectIntelligence()
                else:
                    self.project_intelligence = None
                    
                self._log_info(f"VRGC: Loaded {len(WORKING_TOOLS)} tools: {WORKING_TOOLS}")
            except Exception as e:
                self._log_error("Tool initialization", e)
                self.system_assessment = None
                self.training_monitor = None
                self.hardware_optimizer = None
                self.covenant_guardian = None
                self.project_intelligence = None
        else:
            self.system_assessment = None
            self.training_monitor = None
            self.hardware_optimizer = None
            self.covenant_guardian = None
            self.project_intelligence = None
    
    def _log_info(self, message: str):
        """Log info message to stderr."""
        if self.debug:
            timestamp = datetime.now().isoformat()
            print(f"[{timestamp}] VRGC INFO: {message}", file=sys.stderr)
            sys.stderr.flush()
    
    def _log_error(self, operation: str, error: Exception):
        """Log error message to stderr."""
        timestamp = datetime.now().isoformat()
        print(f"[{timestamp}] VRGC ERROR in {operation}: {str(error)}", file=sys.stderr)
        if self.debug:
            print(f"[{timestamp}] VRGC TRACEBACK: {traceback.format_exc()}", file=sys.stderr)
        sys.stderr.flush()
    
    def get_tools(self) -> List[Dict[str, Any]]:
        """Get list of available VRGC tools."""
        tools = []
        
        if not TOOLS_AVAILABLE:
            return tools
        
        # System Assessment Tool
        tools.append({
            "name": "vrgc_assess_system",
            "description": "Comprehensive system assessment including hardware, environment, and project state analysis",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "assessment_type": {
                        "type": "string",
                        "enum": ["full", "hardware", "environment", "project"],
                        "description": "Type of assessment to perform",
                        "default": "full"
                    }
                }
            }
        })
        
        # Training Monitor Tool
        tools.append({
            "name": "vrgc_monitor_training",
            "description": "Monitor B3 training progress with focus on 10/10 conversation quality goal",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "check_type": {
                        "type": "string",
                        "enum": ["status", "performance", "metrics", "full"],
                        "description": "Type of training check to perform",
                        "default": "status"
                    }
                }
            }
        })
        
        # Hardware Optimizer Tool
        tools.append({
            "name": "vrgc_optimize_hardware",
            "description": "GTX 1050 Ti hardware optimization and VRAM usage analysis",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "optimization_focus": {
                        "type": "string",
                        "enum": ["memory", "performance", "thermal", "all"],
                        "description": "Focus area for optimization",
                        "default": "all"
                    }
                }
            }
        })
        
        # Sacred Covenant Guardian Tool
        tools.append({
            "name": "vrgc_verify_covenant",
            "description": "Verify Sacred Covenant compliance and file integrity protection",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "verification_scope": {
                        "type": "string",
                        "enum": ["integrity", "backups", "compliance", "all"],
                        "description": "Scope of covenant verification",
                        "default": "all"
                    }
                }
            }
        })
          # Project Intelligence Tool
        tools.append({
            "name": "vrgc_analyze_intelligence",
            "description": "Comprehensive project intelligence analysis including code complexity, architecture insights, and optimization recommendations",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "analysis_type": {
                        "type": "string",
                        "enum": ["project_state", "complexity", "velocity", "optimization"],
                        "description": "Type of intelligence analysis to perform",
                        "default": "project_state"
                    }
                }
            }
        })
        
        # B3 Lifecycle Monitoring Tools
        tools.append({
            "name": "vrgc_start_b3_monitoring",
            "description": "Start comprehensive ImpressionCore-B3 lifecycle monitoring with Sacred Covenant compliance",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        })
        
        tools.append({
            "name": "vrgc_stop_b3_monitoring", 
            "description": "Stop ImpressionCore-B3 lifecycle monitoring and get final statistics",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        })
        
        tools.append({
            "name": "vrgc_get_b3_status",
            "description": "Get current ImpressionCore-B3 monitoring status and Sacred Covenant compliance",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        })
        
        tools.append({
            "name": "vrgc_health_check",
            "description": "Perform comprehensive health check for ImpressionCore-B3 system",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        })

        # Chronology read-only tools (if chronology JSON exists)
        tools.append({
            "name": "vrgc_chronology_snapshot",
            "description": "Chronology snapshot (docs/source/mcp/root/all) from unified timeline (creation ordering)",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": ["all","docs","source","mcp","root"], "default": "all"},
                    "limit": {"type": "integer", "default": 40},
                    "reverse": {"type": "boolean", "default": False}
                }
            }
        })
        tools.append({
            "name": "vrgc_chronology_delta",
            "description": "Chronology delta (added/removed/changed) if diff file present.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "include": {"type": "array", "items": {"type": "string", "enum": ["added","removed","changed"]}},
                    "limit": {"type": "integer", "default": 200}
                }
            }
        })
        tools.append({
            "name": "vrgc_chronology_stats",
            "description": "Chronology statistics (counts per category + delta counts).",
            "inputSchema": {"type": "object", "properties": {}}
        })
        
        return tools

    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Execute a VRGC tool."""
        self._log_info(f"Calling tool: {tool_name} with args: {arguments}")
        
        if not TOOLS_AVAILABLE:
            return {
                "error": "VRGC tools not available",
                "message": "Tool initialization failed - check server logs"
            }
        
        try:
            if tool_name == "vrgc_assess_system":
                return await self._assess_system(arguments)
            elif tool_name == "vrgc_monitor_training":
                return await self._monitor_training(arguments)
            elif tool_name == "vrgc_optimize_hardware":
                return await self._optimize_hardware(arguments)
            elif tool_name == "vrgc_verify_covenant":
                return await self._verify_covenant(arguments)
            elif tool_name == "vrgc_analyze_intelligence":
                return await self._analyze_intelligence(arguments)
            elif tool_name == "vrgc_start_b3_monitoring":
                return await self._start_b3_monitoring(arguments)
            elif tool_name == "vrgc_stop_b3_monitoring":
                return await self._stop_b3_monitoring(arguments)
            elif tool_name == "vrgc_get_b3_status":
                return await self._get_b3_status(arguments)
            elif tool_name == "vrgc_health_check":
                return await self._health_check(arguments)
            elif tool_name == "vrgc_chronology_snapshot":
                return await self._chronology_snapshot(arguments)
            elif tool_name == "vrgc_chronology_delta":
                return await self._chronology_delta(arguments)
            elif tool_name == "vrgc_chronology_stats":
                return await self._chronology_stats(arguments)
            else:
                return {
                    "error": f"Unknown tool: {tool_name}",
                    "available_tools": [tool["name"] for tool in self.get_tools()]
                }
        
        except Exception as e:
            self._log_error(f"Tool execution: {tool_name}", e)
            return {
                "error": f"Tool execution failed: {str(e)}",
                "tool": tool_name,
                "timestamp": datetime.now().isoformat()
            }
    
    async def _assess_system(self, args: Dict[str, Any]) -> Dict[str, Any]:
        """Execute system assessment with correct method calls."""
        if not self.system_assessment:
            return {"error": "System assessment tool not available"}
        
        assessment_type = args.get("assessment_type", "full")
        
        if assessment_type == "hardware":
            return await self.system_assessment.assess_hardware_capabilities()
        elif assessment_type == "environment":
            return await self.system_assessment.assess_pytorch_ecosystem()
        elif assessment_type == "project":
            return await self.system_assessment.assess_project_architecture()
        else:  # full
            return await self.system_assessment.generate_comprehensive_assessment()
    
    async def _monitor_training(self, args: Dict[str, Any]) -> Dict[str, Any]:
        """Execute training monitoring with correct method calls."""
        if not self.training_monitor:
            return {"error": "Training monitor tool not available"}
        
        check_type = args.get("check_type", "status")
        
        if check_type == "performance":
            return await self.training_monitor.monitor_hardware_performance()
        elif check_type == "metrics":
            return await self.training_monitor.assess_b1_model_quality()
        elif check_type == "full":
            return await self.training_monitor.generate_training_report()
        else:  # status
            return await self.training_monitor.monitor_active_training()
    
    async def _optimize_hardware(self, args: Dict[str, Any]) -> Dict[str, Any]:
        """Execute hardware optimization with correct method calls."""
        if not self.hardware_optimizer:
            return {"error": "Hardware optimizer tool not available"}
        
        optimization_focus = args.get("optimization_focus", "all")
        
        if optimization_focus == "memory":
            return self.hardware_optimizer.optimize_for_training()
        elif optimization_focus == "performance":
            return self.hardware_optimizer.assess_hardware_state()
        elif optimization_focus == "thermal":
            return self.hardware_optimizer.monitor_training_performance()
        else:  # all
            return self.hardware_optimizer.assess_hardware_state()
    
    async def _verify_covenant(self, args: Dict[str, Any]) -> Dict[str, Any]:
        """Execute covenant verification with correct method calls."""
        if not self.covenant_guardian:
            return {"error": "Covenant guardian tool not available"}
        
        verification_scope = args.get("verification_scope", "all")
        
        if verification_scope == "integrity":
            return self.covenant_guardian.verify_file_integrity()
        elif verification_scope == "backups":
            return self.covenant_guardian.create_comprehensive_backup()
        elif verification_scope == "compliance":
            return self.covenant_guardian.monitor_covenant_compliance()
        else:  # all
            return self.covenant_guardian.enforce_file_protection()
    
    async def _analyze_intelligence(self, args: Dict[str, Any]) -> Dict[str, Any]:
        """Execute project intelligence analysis with correct method calls."""
        if not self.project_intelligence:
            return {"error": "Project intelligence tool not available"}
        
        analysis_type = args.get("analysis_type", "project_state")
        
        if analysis_type == "complexity":
            return self.project_intelligence.analyze_code_complexity()
        elif analysis_type == "velocity":
            return self.project_intelligence.analyze_development_velocity()
        elif analysis_type == "optimization":
            return self.project_intelligence.identify_optimization_opportunities()
        else:  # project_state
            return self.project_intelligence.analyze_project_state()
    
    # B3 Lifecycle Monitoring Method Implementations
    async def _start_b3_monitoring(self, args: Dict[str, Any]) -> Dict[str, Any]:
        """Start ImpressionCore-B3 lifecycle monitoring."""
        if not self.covenant_guardian:
            return {"error": "Covenant guardian tool not available"}
        
        return self.covenant_guardian.start_b3_lifecycle_monitoring()
    
    async def _stop_b3_monitoring(self, args: Dict[str, Any]) -> Dict[str, Any]:
        """Stop ImpressionCore-B3 lifecycle monitoring."""
        if not self.covenant_guardian:
            return {"error": "Covenant guardian tool not available"}
        
        return self.covenant_guardian.stop_b3_lifecycle_monitoring()
    
    async def _get_b3_status(self, args: Dict[str, Any]) -> Dict[str, Any]:
        """Get ImpressionCore-B3 monitoring status."""
        if not self.covenant_guardian:
            return {"error": "Covenant guardian tool not available"}
        
        return self.covenant_guardian.get_monitoring_status()
    
    async def _health_check(self, args: Dict[str, Any]) -> Dict[str, Any]:
        """Perform comprehensive health check."""
        if not self.covenant_guardian:
            return {"error": "Covenant guardian tool not available"}
        
        return self.covenant_guardian._perform_comprehensive_health_check()

    # -------- Chronology Handlers (Read-Only) -------- #
    async def _chronology_snapshot(self, args: Dict[str, Any]) -> Dict[str, Any]:
        if not HAS_CHRONO:
            return {"error": "chronology_loader_not_available", "hint": "Ensure src/assistant/chronology_loader.py is present."}
        data = load_chronology()
        if not data.get('documents') and not data.get('source'):
            return {"error": "chronology_empty", "hint": "Run IDS chronology refresh generation first."}
        kind = args.get('kind', 'all')
        limit = args.get('limit', 40)
        reverse = args.get('reverse', False)
        items = query_chronology(data, kind=kind, limit=limit, reverse=reverse)
        return {
            'kind': kind,
            'limit': limit,
            'reverse': reverse,
            'count': len(items),
            'items': items,
            'generated': data.get('generated'),
            'ordering': data.get('ordering'),
            'schema_version': data.get('schema_version')
        }

    async def _chronology_delta(self, args: Dict[str, Any]) -> Dict[str, Any]:
        if not HAS_CHRONO:
            return {"error": "chronology_loader_not_available"}
        diff = load_delta()
        if not diff:
            return {"error": "delta_not_available", "hint": "Run chronology generator with --delta flag in IDS."}
        include = args.get('include') or ['added','removed','changed']
        limit = args.get('limit', 200)
        payload = {'generated': diff.get('generated'), 'counts': diff.get('counts', {})}
        for key in ['added','removed','changed']:
            if key in include and key in diff:
                data = diff[key]
                payload[key] = data[:limit] if limit else data
        return payload

    async def _chronology_stats(self, args: Dict[str, Any]) -> Dict[str, Any]:
        if not HAS_CHRONO:
            return {"error": "chronology_loader_not_available"}
        data = load_chronology()
        stats = {
            'documents': len(data.get('documents', [])),
            'source': len(data.get('source', [])),
            'mcp': len(data.get('mcp', [])),
            'root': len(data.get('root', [])),
            'generated': data.get('generated'),
            'ordering': data.get('ordering'),
            'schema_version': data.get('schema_version')
        }
        diff = load_delta()
        if diff and diff.get('counts'):
            stats['delta'] = diff['counts']
        return stats


def main():
    """Main entry point for the VRGC MCP server."""
    server = VRGCMCPServer()
    server._log_info("VRGC MCP Server starting up...")
    
    while True:
        try:
            line = input()
            if not line.strip():
                continue
            
            request = json.loads(line)
            server._log_info(f"Received request: {request.get('method', 'unknown')}")
            
            response = {
                "jsonrpc": "2.0",
                "id": request.get("id")
            }
            
            if request.get("method") == "initialize":
                response["result"] = {
                    "capabilities": {
                        "tools": {}
                    }
                }
            
            elif request.get("method") == "tools/list":
                response["result"] = {
                    "tools": server.get_tools()
                }
            
            elif request.get("method") == "tools/call":
                params = request.get("params", {})
                tool_name = params.get("name")
                arguments = params.get("arguments", {})
                
                if tool_name:
                    result = asyncio.run(server.call_tool(tool_name, arguments))
                    response["result"] = result
                else:
                    response["error"] = {
                        "code": -32602,
                        "message": "Invalid params: missing tool name"
                    }
            
            else:
                response["error"] = {
                    "code": -32601,
                    "message": f"Method not found: {request.get('method')}"
                }
            
            print(json.dumps(response))
            sys.stdout.flush()
            
        except EOFError:
            server._log_info("EOF received, shutting down...")
            break
        except Exception as e:
            server._log_error("Main loop", e)
            error_response = {
                "jsonrpc": "2.0",
                "id": request.get("id") if 'request' in locals() else None,
                "error": {
                    "code": -32603,
                    "message": f"Internal error: {str(e)}"
                }
            }
            print(json.dumps(error_response))
            sys.stdout.flush()


if __name__ == "__main__":
    main()
