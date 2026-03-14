#!/usr/bin/env python3
r"""
ImpressionCore Goliath Unified Logger

Created: July 26, 2025
Updated: August 12, 2025
Author: ImpressionCore Team
Tags: #.mcp\impressioncore_goliath\core\unified_logger.py #python #source_code #testing
Category: Source Code
Status: Active
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
    
    def __init__(self, log_dir: Optional[Path] = None, mcp_mode: bool = None):
        # Auto-detect MCP mode if not specified
        if mcp_mode is None:
            # Check if we're running as an MCP server (no --test flag)
            mcp_mode = "--test" not in sys.argv
        
        self.mcp_mode = mcp_mode
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
        
        # Clear existing handlers
        self.logger.handlers.clear()
        
        # File handler for main log
        main_handler = RotatingFileHandler(
            self.main_log,
            maxBytes=10*1024*1024,  # 10MB
            backupCount=5
        )
        main_handler.setLevel(logging.INFO)
        main_handler.setFormatter(detailed_formatter)
        
        # File handler for errors
        error_handler = RotatingFileHandler(
            self.error_log,
            maxBytes=5*1024*1024,   # 5MB
            backupCount=3
        )
        error_handler.setLevel(logging.ERROR)
        error_handler.setFormatter(detailed_formatter)
        
        # Console handler with Rich if available - ONLY if not in MCP mode
        if not self.mcp_mode:
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
            self.logger.addHandler(console_handler)
        
        # Add file handlers (always enabled)
        self.logger.addHandler(main_handler)
        self.logger.addHandler(error_handler)
    
    def info(self, message: str, extra_data: Optional[Dict] = None):
        """Log info message with optional structured data."""
        self.info_count += 1
        
        if extra_data:
            message = f"{message} | Data: {json.dumps(extra_data)}"
        
        self.logger.info(message)
        
        # Only print to console if not in MCP mode
        if not self.mcp_mode and RICH_AVAILABLE:
            console.print(f"[blue][INFO][/blue] {message}")
    
    def success(self, message: str, extra_data: Optional[Dict] = None):
        """Log success message with green styling."""
        if extra_data:
            message = f"{message} | Data: {json.dumps(extra_data)}"
        
        self.logger.info(f"SUCCESS: {message}")
        
        # Only print to console if not in MCP mode
        if not self.mcp_mode:
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
        
        # Only print to console if not in MCP mode
        if not self.mcp_mode:
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
        
        # Only print to console if not in MCP mode
        if not self.mcp_mode:
            if RICH_AVAILABLE:
                console.print(f"[red][ERROR][/red] {message}")
            else:
                print(f"[ERROR] {message}")
    
    def debug(self, message: str, extra_data: Optional[Dict] = None):
        """Log debug message."""
        if extra_data:
            message = f"{message} | Data: {json.dumps(extra_data)}"
        
        self.logger.debug(message)
    
    def log_performance(self, operation: str, duration: float, extra_data: Optional[Dict] = None):
        """Log performance metrics."""
        self.request_times.append(duration)
        
        message = f"[PERFORMANCE] {operation}: {duration:.3f}s"
        if extra_data:
            message = f"{message} | Data: {json.dumps(extra_data)}"
        
        self.logger.info(message)
        
        # Write to performance log
        with open(self.performance_log, 'a', encoding='utf-8') as f:
            f.write(f"{datetime.now().isoformat()} - {message}\n")
    
    def get_stats(self) -> Dict[str, any]:
        """Get logging statistics."""
        uptime = datetime.now() - datetime.fromtimestamp(self.main_log.stat().st_ctime if self.main_log.exists() else 0)
        
        avg_request_time = sum(self.request_times) / len(self.request_times) if self.request_times else 0
        
        return {
            "uptime_seconds": uptime.total_seconds(),
            "info_count": self.info_count,
            "warning_count": self.warning_count,
            "error_count": self.error_count,
            "avg_request_time": avg_request_time,
            "total_requests": len(self.request_times)
        }
    
    def create_status_table(self) -> str:
        """Create a formatted status table."""
        stats = self.get_stats()
        
        if RICH_AVAILABLE:
            table = Table(title="[ROCKET] Goliath Logger Status")
            table.add_column("Metric", style="cyan")
            table.add_column("Value", style="green")
            
            table.add_row("Uptime", f"{stats['uptime_seconds']:.1f}s")
            table.add_row("Info Messages", str(stats['info_count']))
            table.add_row("Warnings", str(stats['warning_count']))
            table.add_row("Errors", str(stats['error_count']))
            table.add_row("Avg Request Time", f"{stats['avg_request_time']:.3f}s")
            table.add_row("Total Requests", str(stats['total_requests']))
            
            with console.capture() as capture:
                console.print(table)
            return capture.get()
        else:
            return f"""
Goliath Logger Status:
- Uptime: {stats['uptime_seconds']:.1f}s
- Info Messages: {stats['info_count']}
- Warnings: {stats['warning_count']}
- Errors: {stats['error_count']}
- Avg Request Time: {stats['avg_request_time']:.3f}s
- Total Requests: {stats['total_requests']}
"""

# Progress tracking for Rich environments
class GoliathProgress:
    """Progress tracking system for Goliath operations."""
    
    def __init__(self):
        if RICH_AVAILABLE:
            self.progress = Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                console=console
            )
        else:
            self.progress = MockProgress()
    
    def __enter__(self):
        if RICH_AVAILABLE:
            return self.progress.__enter__()
        return self.progress
    
    def __exit__(self, *args):
        if RICH_AVAILABLE:
            return self.progress.__exit__(*args)

class MockProgress:
    """Mock progress for environments without Rich."""
    
    def __init__(self):
        self.tasks = {}
        self.task_counter = 0
    
    def add_task(self, desc, total=None):
        self.task_counter += 1
        self.tasks[self.task_counter] = {"desc": desc, "total": total}
        print(f"[TASK] {desc}")
        return self.task_counter
    
    def update(self, task_id, **kwargs):
        # Mock implementation - just track completion
        pass
    
    def start(self):
        pass
    
    def stop(self):
        pass
