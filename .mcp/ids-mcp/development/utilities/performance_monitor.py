#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\utilities\performance_monitor.py #api #memory_management #python #source_code #testing  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\utilities\performance_monitor.py #api #memory_management #python #source_code #testing  
**Category:** Source Code  
**Status:** Active

"""
IDS MCP Server Performance Monitor
==================================
Monitors server performance, response times, and system health.
"""

import time
import json
import psutil
import logging
import subprocess
from datetime import datetime
from pathlib import Path

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class IDSPerformanceMonitor:
    def __init__(self):
        self.start_time = time.time()
        self.metrics = {
            "server_starts": 0,
            "tool_calls": {},
            "response_times": [],
            "errors": 0,
            "memory_usage": [],
            "uptime": 0
        }
    
    def test_tool_performance(self, tool_name: str, test_data: dict):
        """Test individual tool performance."""
        start_time = time.time()
        
        try:
            # Simulate tool call
            process = subprocess.run(
                ["python", "server.py"],
                input=json.dumps({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {
                        "name": tool_name,
                        "arguments": test_data
                    }
                }),
                capture_output=True,
                text=True,
                timeout=30
            )
            
            response_time = time.time() - start_time
            
            if process.returncode == 0:
                self.metrics["tool_calls"][tool_name] = {
                    "response_time": response_time,
                    "status": "success",
                    "timestamp": datetime.now().isoformat()
                }
                logger.info(f"✅ {tool_name}: {response_time:.3f}s")
            else:
                self.metrics["errors"] += 1
                logger.error(f"❌ {tool_name}: Failed")
                
        except subprocess.TimeoutExpired:
            self.metrics["errors"] += 1
            logger.error(f"⏰ {tool_name}: Timeout")
        except Exception as e:
            self.metrics["errors"] += 1
            logger.error(f"💥 {tool_name}: {str(e)}")
    
    def monitor_system_resources(self):
        """Monitor system resource usage."""
        memory_info = psutil.virtual_memory()
        cpu_percent = psutil.cpu_percent(interval=1)
        
        self.metrics["memory_usage"].append({
            "timestamp": datetime.now().isoformat(),
            "memory_percent": memory_info.percent,
            "memory_used_gb": memory_info.used / (1024**3),
            "cpu_percent": cpu_percent
        })
        
        logger.info(f"💾 Memory: {memory_info.percent:.1f}% | CPU: {cpu_percent:.1f}%")
    
    def run_comprehensive_performance_test(self):
        """Run complete performance analysis."""
        logger.info("🚀 Starting IDS MCP Server Performance Test")
        
        # Test all tools
        test_cases = {
            "mcp_impressioncor_ids_search": {"query": "test", "max_results": 5},
            "mcp_impressioncor_ids_get_file_info": {"file_path": "docs/README.md"},
            "mcp_impressioncor_ids_list_tags": {"pattern": "api"},
            "mcp_impressioncor_ids_get_system_status": {},
            "mcp_impressioncor_ids_find_by_tag": {"tags": ["api"], "match_all": False}
        }
        
        for tool_name, test_data in test_cases.items():
            self.test_tool_performance(tool_name, test_data)
            self.monitor_system_resources()
            time.sleep(1)  # Brief pause between tests
        
        # Calculate summary metrics
        self.metrics["uptime"] = time.time() - self.start_time
        avg_response_time = sum(
            call["response_time"] 
            for call in self.metrics["tool_calls"].values()
            if call["status"] == "success"
        ) / len([c for c in self.metrics["tool_calls"].values() if c["status"] == "success"]) if self.metrics["tool_calls"] else 0
        
        # Generate report
        report = f"""
🎯 IDS MCP Server Performance Report
=====================================
Test Duration: {self.metrics['uptime']:.2f} seconds
Tools Tested: {len(self.metrics['tool_calls'])}
Successful Calls: {len([c for c in self.metrics['tool_calls'].values() if c['status'] == 'success'])}
Errors: {self.metrics['errors']}
Average Response Time: {avg_response_time:.3f} seconds

📊 Individual Tool Performance:
"""
        
        for tool_name, metrics in self.metrics["tool_calls"].items():
            status_emoji = "✅" if metrics["status"] == "success" else "❌"
            response_time = metrics.get("response_time", 0)
            report += f"{status_emoji} {tool_name}: {response_time:.3f}s\n"
        
        if self.metrics["memory_usage"]:
            latest_memory = self.metrics["memory_usage"][-1]
            report += f"""
💾 System Resources:
Memory Usage: {latest_memory['memory_percent']:.1f}%
CPU Usage: {latest_memory['cpu_percent']:.1f}%
"""
        
        logger.info(report)
        
        # Save detailed metrics
        with open("performance_metrics.json", "w") as f:
            json.dump(self.metrics, f, indent=2)
        
        logger.info("📊 Detailed metrics saved to performance_metrics.json")

if __name__ == "__main__":
    monitor = IDSPerformanceMonitor()
    monitor.run_comprehensive_performance_test()
