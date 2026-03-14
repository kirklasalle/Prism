#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\tests\test_enhanced_ids.py #documentation #python #source_code #testing  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\tests\test_enhanced_ids.py #documentation #python #source_code #testing  
**Category:** Source Code  
**Status:** Active

"""
Enhanced IDS MCP Server Test Script
==================================

Test all 17 tools in the enhanced MCP server to ensure proper functionality.

Usage:
    python test_enhanced_ids.py [--tool TOOL_NAME] [--verbose]

Examples:
    python test_enhanced_ids.py                    # Test all tools
    python test_enhanced_ids.py --tool search      # Test specific tool
    python test_enhanced_ids.py --verbose          # Detailed output
"""

import asyncio
import sys
import json
import argparse
from pathlib import Path
from datetime import datetime

# Add the server to path
CURRENT_DIR = Path(__file__).parent
sys.path.insert(0, str(CURRENT_DIR))

try:
    from server_enhanced import EnhancedIDSMCPServer
    from server_enhanced import (
        handle_search, handle_find_by_tag, handle_get_file_info,
        handle_list_tags, handle_get_system_status, handle_semantic_search,
        handle_search_with_context, handle_get_search_analytics,
        handle_rebuild_index, handle_incremental_update, handle_check_index_freshness,
        handle_validate_documentation, handle_generate_documentation_report,
        handle_export_index_data, handle_create_bookmark, handle_manage_bookmarks,
        handle_get_bookmark_analytics
    )
    SERVER_AVAILABLE = True
except ImportError as e:
    print(f"❌ Failed to import enhanced server: {e}")
    SERVER_AVAILABLE = False

class EnhancedIDSTestSuite:
    """Test suite for Enhanced IDS MCP Server."""
    
    def __init__(self, verbose: bool = False):
        self.verbose = verbose
        self.server = None
        self.test_results = {}
        self.start_time = datetime.now()
        
    async def setup(self):
        """Initialize the test environment."""
        if not SERVER_AVAILABLE:
            raise RuntimeError("Enhanced server not available for testing")
            
        try:
            self.server = EnhancedIDSMCPServer()
            print("✅ Enhanced IDS MCP Server initialized for testing")
            return True
        except Exception as e:
            print(f"❌ Failed to initialize server: {e}")
            return False
    
    def log(self, message: str, level: str = "INFO"):
        """Log a message with timestamp."""
        timestamp = datetime.now().strftime("%H:%M:%S")
        if level == "ERROR":
            print(f"🔴 [{timestamp}] {message}")
        elif level == "SUCCESS":
            print(f"🟢 [{timestamp}] {message}")
        elif level == "WARNING":
            print(f"🟡 [{timestamp}] {message}")
        else:
            if self.verbose:
                print(f"ℹ️  [{timestamp}] {message}")
    
    async def test_tool(self, tool_name: str, handler_func, test_args: dict, expected_keys: list = None):
        """Test a specific tool and validate results."""
        self.log(f"Testing {tool_name}...", "INFO")
        
        try:
            # Execute the tool
            result = await handler_func(test_args)
            
            # Basic validation
            if isinstance(result, dict):
                # Check for errors
                if "error" in result:
                    self.log(f"{tool_name} returned error: {result['error']}", "WARNING")
                    self.test_results[tool_name] = {"status": "error", "error": result["error"]}
                    return False
                
                # Check expected keys
                if expected_keys:
                    missing_keys = [key for key in expected_keys if key not in result]
                    if missing_keys:
                        self.log(f"{tool_name} missing keys: {missing_keys}", "WARNING")
                
                # Log result summary
                if self.verbose:
                    self.log(f"{tool_name} result keys: {list(result.keys())}")
                
                self.test_results[tool_name] = {"status": "success", "result_keys": list(result.keys())}
                self.log(f"{tool_name} completed successfully", "SUCCESS")
                return True
            else:
                self.log(f"{tool_name} returned invalid result type: {type(result)}", "ERROR")
                self.test_results[tool_name] = {"status": "error", "error": "Invalid result type"}
                return False
                
        except Exception as e:
            self.log(f"{tool_name} failed with exception: {e}", "ERROR")
            self.test_results[tool_name] = {"status": "exception", "error": str(e)}
            return False
    
    async def test_all_tools(self):
        """Test all 17 tools in the enhanced server."""
        test_cases = [
            # Original 5 tools (enhanced)
            {
                "name": "search_documents",
                "handler": handle_search,
                "args": {"query": "bookmark", "max_results": 5},
                "expected_keys": ["query", "total_results", "results"]
            },
            {
                "name": "find_by_tag", 
                "handler": handle_find_by_tag,
                "args": {"tags": ["documentation", "system"], "match_all": False},
                "expected_keys": ["tags", "total_results", "results"]
            },
            {
                "name": "get_file_info",
                "handler": handle_get_file_info,
                "args": {"file_path": "docs/DOCUMENTATION_INDEX.md"},
                "expected_keys": ["path", "metadata"]
            },
            {
                "name": "list_tags",
                "handler": handle_list_tags,
                "args": {"pattern": "doc"},
                "expected_keys": ["total_tags", "tags"]
            },
            {
                "name": "get_system_status",
                "handler": handle_get_system_status,
                "args": {},
                "expected_keys": ["version", "statistics", "system_health"]
            },
            
            # Enhanced Search Tools
            {
                "name": "semantic_search",
                "handler": handle_semantic_search,
                "args": {"query": "documentation system", "max_results": 5},
                "expected_keys": ["query", "search_type", "results"]
            },
            {
                "name": "search_with_context",
                "handler": handle_search_with_context,
                "args": {"query": "bookmark", "context_lines": 2, "max_results": 3},
                "expected_keys": ["query", "search_type", "results"]
            },
            {
                "name": "get_search_analytics",
                "handler": handle_get_search_analytics,
                "args": {"days": 7},
                "expected_keys": ["period_days", "indexed_files"]
            },
              # Index Management Tools
            {
                "name": "rebuild_index",
                "handler": handle_rebuild_index,
                "args": {"incremental": False},
                "expected_keys": ["status", "files_processed"]
            },
            {
                "name": "incremental_update",
                "handler": handle_incremental_update,
                "args": {"file_paths": ["docs/DOCUMENTATION_INDEX.md"]},
                "expected_keys": ["status", "files_updated"]
            },
            {
                "name": "check_index_freshness",
                "handler": handle_check_index_freshness,
                "args": {},
                "expected_keys": ["status", "index_stats"]
            },
            {
                "name": "validate_documentation",
                "handler": handle_validate_documentation,
                "args": {"fix_issues": False},
                "expected_keys": ["status", "statistics"]
            },
            {
                "name": "generate_documentation_report",
                "handler": handle_generate_documentation_report,
                "args": {"format": "json"},
                "expected_keys": ["format", "data"]
            },
            {
                "name": "export_index_data",
                "handler": handle_export_index_data,
                "args": {"format": "json", "include_content": False},
                "expected_keys": ["format", "export_path"]
            },
            
            # Bookmark Management Tools
            {
                "name": "create_bookmark",
                "handler": handle_create_bookmark,
                "args": {
                    "title": "Test Bookmark",
                    "file_path": "docs/test_bookmark.md",
                    "category": "technical",
                    "description": "Test bookmark for validation",
                    "tags": ["test", "validation"]
                },
                "expected_keys": ["status", "bookmark", "category"]
            },
            {
                "name": "manage_bookmarks_list",
                "handler": handle_manage_bookmarks,
                "args": {"action": "list"},
                "expected_keys": ["all_bookmarks"]
            },
            {
                "name": "get_bookmark_analytics",
                "handler": handle_get_bookmark_analytics,
                "args": {},
                "expected_keys": ["total_bookmarks", "categories"]
            }        ]
        
        # Skip intensive operations by default (can be overridden with --intensive flag)
        skip_intensive = [
            "rebuild_index",
            "incremental_update"
        ] if not getattr(self, 'test_intensive', False) else []
        
        print(f"\n🧪 Running Enhanced IDS MCP Server Test Suite")
        print(f"📊 Testing {len(test_cases) - len(skip_intensive)} of {len(test_cases)} tools...")
        print("=" * 60)
        
        success_count = 0
        total_tested = 0
        
        for test_case in test_cases:
            if test_case["name"] in skip_intensive:
                self.log(f"⏭️  Skipping intensive operation: {test_case['name']}", "WARNING")
                continue
                
            total_tested += 1
            success = await self.test_tool(
                test_case["name"],
                test_case["handler"],
                test_case["args"],
                test_case.get("expected_keys", [])
            )
            
            if success:
                success_count += 1
        
        print("=" * 60)
        print(f"🎯 Test Results: {success_count}/{total_tested} tools passed")
        
        return success_count, total_tested
    
    async def test_specific_tool(self, tool_name: str):
        """Test a specific tool by name."""
        tool_map = {
            "search": (handle_search, {"query": "documentation", "max_results": 5}),
            "find_by_tag": (handle_find_by_tag, {"tags": ["system"], "match_all": False}),
            "get_file_info": (handle_get_file_info, {"file_path": "docs/DOCUMENTATION_INDEX.md"}),
            "list_tags": (handle_list_tags, {"pattern": "doc"}),
            "get_system_status": (handle_get_system_status, {}),
            "semantic_search": (handle_semantic_search, {"query": "system", "max_results": 5}),
            "search_with_context": (handle_search_with_context, {"query": "bookmark", "context_lines": 2}),
            "get_search_analytics": (handle_get_search_analytics, {"days": 7}),
            "check_index_freshness": (handle_check_index_freshness, {}),
            "validate_documentation": (handle_validate_documentation, {"fix_issues": False}),
            "generate_documentation_report": (handle_generate_documentation_report, {"format": "json"}),
            "export_index_data": (handle_export_index_data, {"format": "json"}),
            "create_bookmark": (handle_create_bookmark, {
                "title": "Test Bookmark",
                "file_path": "docs/test.md",
                "category": "technical"
            }),
            "manage_bookmarks": (handle_manage_bookmarks, {"action": "list"}),
            "get_bookmark_analytics": (handle_get_bookmark_analytics, {})
        }
        
        if tool_name not in tool_map:
            print(f"❌ Unknown tool: {tool_name}")
            print(f"Available tools: {', '.join(tool_map.keys())}")
            return False
        
        handler, args = tool_map[tool_name]
        print(f"\n🧪 Testing specific tool: {tool_name}")
        print("=" * 40)
        
        success = await self.test_tool(tool_name, handler, args)
        
        if success:
            print(f"✅ {tool_name} test passed")
        else:
            print(f"❌ {tool_name} test failed")
            
        return success
    
    def generate_report(self):
        """Generate a detailed test report."""
        end_time = datetime.now()
        duration = (end_time - self.start_time).total_seconds()
        
        report = {
            "test_session": {
                "start_time": self.start_time.isoformat(),
                "end_time": end_time.isoformat(),
                "duration_seconds": duration
            },
            "summary": {
                "total_tests": len(self.test_results),
                "passed": len([r for r in self.test_results.values() if r["status"] == "success"]),
                "failed": len([r for r in self.test_results.values() if r["status"] != "success"])
            },
            "results": self.test_results
        }
        
        # Save report
        report_path = CURRENT_DIR / f"test_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(report_path, 'w') as f:
            json.dump(report, f, indent=2)
        
        print(f"\n📊 Test report saved to: {report_path}")
        return report


async def main():
    """Main test execution function."""
    parser = argparse.ArgumentParser(description="Test Enhanced IDS MCP Server")
    parser.add_argument("--tool", help="Test specific tool only")
    parser.add_argument("--verbose", action="store_true", help="Verbose output")
    parser.add_argument("--report", action="store_true", help="Generate detailed report")
    parser.add_argument("--intensive", action="store_true", help="Include intensive operations (rebuild_index, incremental_update)")
    
    args = parser.parse_args()
      # Initialize test suite
    test_suite = EnhancedIDSTestSuite(verbose=args.verbose)
    test_suite.test_intensive = args.intensive
    
    # Setup
    if not await test_suite.setup():
        print("❌ Failed to setup test environment")
        return 1
    
    try:
        if args.tool:
            # Test specific tool
            success = await test_suite.test_specific_tool(args.tool)
            result_code = 0 if success else 1
        else:
            # Test all tools
            success_count, total_count = await test_suite.test_all_tools()
            result_code = 0 if success_count == total_count else 1
        
        # Generate report if requested
        if args.report:
            test_suite.generate_report()
        
        return result_code
        
    except KeyboardInterrupt:
        print("\n⚠️  Test interrupted by user")
        return 1
    except Exception as e:
        print(f"❌ Test suite failed: {e}")
        return 1


if __name__ == "__main__":
    if not SERVER_AVAILABLE:
        print("❌ Enhanced IDS MCP Server not available")
        print("Please ensure server_enhanced_clean.py is in the same directory")
        sys.exit(1)
    
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
