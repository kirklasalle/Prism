#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** July-26-2025  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\impressioncore_goliath\core\unified_logger_broken.py #python #source_code #testing  
**Category:** Source Code  
**Status:** Active
"""






import sys
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any

"""

import json
import logging
import os
import sys
from datetime import datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Dict, Optional

# Rich imports with fallback
try:
    from rich.console import Console
    from rich.logging import RichHandler
    from rich.progress import Progress, SpinnerColumn, TextColumn
    from rich.panel import Panel
    from rich.table import Table
    console = Console()
    RICH_AVAILABLE = True
except ImportError:
    RICH_AVAILABLE = False
    class BasicConsole:
        def print(self, *args, **kwargs):
            print(*args)
    console = BasicConsole()

class GoliathLogger:
    """
    Professional logging system for ImpressionCore-Goliath.
    
    Provides structured logging with Rich UI enhancements,
    performance tracking, and comprehensive error reporting.
    """
    
    def __init__(self, log_dir: Optional[Path] = None):
        self.log_dir = log_dir or Path.cwd() / ".goliath_logs"
        self.log_dir.mkdir(exist_ok=True)
        
        # Log files
        self.main_log = self.log_dir / "goliath.log"
        self.error_log = self.log_dir / "errors.log"
        self.performance_log = self.log_dir / "performance.log"
        
        # Performance tracking
        self.request_times = []
        self.error_count = 0
        self.warning_count = 0
        self.info_count = 0
        
        # Setup logging
        self._setup_logging()
        
        self.info("[ROCKET] Goliath Logger initialized")
    
    def _setup_logging(self):
        """Setup comprehensive logging configuration."""
        # Create formatters
        detailed_formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(funcName)s:%(lineno)d - %(message)s'
        )
        
        simple_formatter = logging.Formatter(
            '%(asctime)s - %(levelname)s - %(message)s'
        )
        
        # Setup main logger
        self.logger = logging.getLogger("goliath")
        self.logger.setLevel(logging.DEBUG)
        
        # File handlers
        main_handler = logging.FileHandler(self.main_log, encoding='utf-8')
        main_handler.setLevel(logging.INFO)
        main_handler.setFormatter(detailed_formatter)
        
        error_handler = logging.FileHandler(self.error_log, encoding='utf-8')
        error_handler.setLevel(logging.ERROR)
        error_handler.setFormatter(detailed_formatter)
        
        # Console handler with Rich if available
        if RICH_AVAILABLE:
            console_handler = RichHandler(
                console=console,
                show_time=True,
                show_path=True,
                enable_link_path=True
            )
        else:
            console_handler = logging.StreamHandler(sys.stdout)
        
        console_handler.setLevel(logging.INFO)
        console_handler.setFormatter(simple_formatter)
        
        # Add handlers
        self.logger.addHandler(main_handler)
        self.logger.addHandler(error_handler)
        self.logger.addHandler(console_handler)
    
    def info(self, message: str, extra_data: Optional[Dict] = None):
        """Log info message with optional structured data."""
        self.info_count += 1
        
        if extra_data:
            message = f"{message} | Data: {json.dumps(extra_data)}"
        
        self.logger.info(message)
        
        if RICH_AVAILABLE:
            console.print(f"[blue][INFO][/blue] {message}")
    
    def success(self, message: str, extra_data: Optional[Dict] = None):
        """Log success message with green styling."""
        if extra_data:
            message = f"{message} | Data: {json.dumps(extra_data)}"
        
        self.logger.info(f"SUCCESS: {message}")
        
        if RICH_AVAILABLE:
            console.print(f"[green][SUCCESS][/green] {message}")
        else:
            print(f"[SUCCESS] {message}")
    
    def warning(self, message: str, extra_data: Optional[Dict] = None):
        """Log warning message."""
        self.warning_count += 1
        
        if extra_data:
            message = f"{message} | Data: {json.dumps(extra_data)}"
        
        self.logger.warning(message)
        
        if RICH_AVAILABLE:
            console.print(f"[yellow][WARNING][/yellow] {message}")
        else:
            print(f"[WARNING] {message}")
    
    def error(self, message: str, exception: Optional[Exception] = None, extra_data: Optional[Dict] = None):
        """Log error message with optional exception details."""
        self.error_count += 1
        
        if exception:
            message = f"{message} | Exception: {str(exception)}"
        
        if extra_data:
            message = f"{message} | Data: {json.dumps(extra_data)}"
        
        self.logger.error(message)
        
        if RICH_AVAILABLE:
            console.print(f"[red][ERROR][/red] {message}")
        else:
            print(f"[ERROR] {message}")
    
    def debug(self, message: str, extra_data: Optional[Dict] = None):
        """Log debug message."""
        if extra_data:
            message = f"{message} | Data: {json.dumps(extra_data)}"
        
        self.logger.debug(message)
    
    def log_performance(self, operation: str, duration: float, details: Optional[Dict] = None):
        """Log performance metrics."""
        self.request_times.append(duration)
        
        perf_data = {
            "timestamp": datetime.now().isoformat(),
            "operation": operation,
            "duration_seconds": duration,
            "details": details or {}
        }
        
        # Log to performance file
        with open(self.performance_log, 'a', encoding='utf-8') as f:
            f.write(json.dumps(perf_data) + '\n')
        
        if duration > 5.0:  # Log slow operations
            self.warning(f"Slow operation: {operation} took {duration:.2f}s")
        else:
            self.debug(f"Performance: {operation} completed in {duration:.2f}s")
    
    def log_tool_execution(self, tool_name: str, duration: float, success: bool, details: Optional[Dict] = None):
        """Log tool execution metrics."""
        status = "SUCCESS" if success else "FAILED"
        
        tool_data = {
            "timestamp": datetime.now().isoformat(),
            "tool_name": tool_name,
            "duration_seconds": duration,
            "status": status,
            "details": details or {}
        }
        
        # Log to main log
        message = f"Tool {tool_name} {status} in {duration:.2f}s"
        if success:
            self.info(message)
        else:
            self.error(message)
        
        # Log to performance file
        with open(self.performance_log, 'a', encoding='utf-8') as f:
            f.write(json.dumps(tool_data) + '\n')
    
    def display_startup_banner(self, server_info: Dict[str, Any]):
        """Display professional startup banner."""
        if RICH_AVAILABLE:
            # Create startup table
            table = Table(title="[ROCKET] ImpressionCore-Goliath MCP Server")
            table.add_column("Component", style="cyan")
            table.add_column("Status", style="green")
            table.add_column("Details", style="white")
            
            table.add_row("Server", "ACTIVE", f"Version {server_info.get('version', 'Unknown')}")
            table.add_row("Tools", "LOADED", f"{server_info.get('total_tools', 0)} unified tools")
            table.add_row("Bridges", "CONNECTED", f"{server_info.get('active_bridges', 0)} server bridges")
            table.add_row("Sacred Covenant", "PROTECTED", "File integrity monitoring active")
            table.add_row("Performance", "OPTIMIZED", "High-throughput operations ready")
            
            console.print(table)
            
            # Display bridge status
            if server_info.get('bridge_names'):
                bridge_panel = Panel(
                    "\n".join([f"[SUCCESS] {bridge.upper()}" for bridge in server_info['bridge_names']]),
                    title="🌉 Active Bridges",
                    border_style="blue"
                )
                console.print(bridge_panel)
        else:
            print("[ROCKET] ImpressionCore-Goliath MCP Server")
            print("=" * 50)
            print(f"Version: {server_info.get('version', 'Unknown')}")
            print(f"Tools: {server_info.get('total_tools', 0)}")
            print(f"Bridges: {server_info.get('active_bridges', 0)}")
            print("Sacred Covenant: ACTIVE")
            print("=" * 50)
    
    def get_statistics(self) -> Dict[str, Any]:
        """Get comprehensive logging statistics."""
        avg_request_time = sum(self.request_times) / len(self.request_times) if self.request_times else 0
        
        return {
            "log_counts": {
                "info": self.info_count,
                "warnings": self.warning_count,
                "errors": self.error_count
            },
            "performance": {
                "total_requests": len(self.request_times),
                "average_request_time": avg_request_time,
                "fastest_request": min(self.request_times) if self.request_times else 0,
                "slowest_request": max(self.request_times) if self.request_times else 0
            },
            "log_files": {
                "main_log": str(self.main_log),
                "error_log": str(self.error_log),
                "performance_log": str(self.performance_log)
            }
        }
    
    def create_progress_context(self, description: str):
        """Create a Rich progress context for long operations."""
        if RICH_AVAILABLE:
            return Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                console=console
            )
        else:
            class BasicProgress:
                def __enter__(self):
                    print(f"🔄 {description}")
                    return self
                def __exit__(self, *args):
                    print("[SUCCESS] Complete")
                def add_task(self, desc, total=None):
                    return 0
                def update(self, task_id, **kwargs):
                    pass
            return BasicProgress()
