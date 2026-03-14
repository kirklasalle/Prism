#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\tests\test_enhanced_server.py #attention_mechanism #documentation #python #source_code #testing  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\tests\test_enhanced_server.py #attention_mechanism #documentation #python #source_code #testing  
**Category:** Source Code  
**Status:** Active

"""
Test Suite for Enhanced IDS MCP Server v2.0.0
=============================================

Comprehensive test suite for all 17 IDS MCP tools.
Tests both functionality and error handling.

Author: ImpressionCore IDS Team
Created: 2025-01-07
Version: 1.0.0
"""

import asyncio
import json
import sys
import os
from pathlib import Path

# Add project root to path
CURRENT_DIR = Path(__file__).parent
PROJECT_ROOT = CURRENT_DIR.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from server_enhanced_v2 import EnhancedIDSMCPServer

class IDSMCPTester:
    """Test runner for all Enhanced IDS MCP Server tools."""
    
    def __init__(self):
        self.server = EnhancedIDSMCPServer()
        self.test_results = {
            "passed": 0,
            "failed": 0,
            "errors": [],
            "tool_results": {}
        }
        
    async def run_all_tests(self):
        """Run comprehensive tests for all 17 tools."""
        print("🚀 Starting Enhanced IDS MCP Server Test Suite")
        print("=" * 60)
        
        # Test groups
        test_groups = [
            ("Original 5 Tools (Enhanced)", self.test_original_tools),
            ("Index Management Tools", self.test_index_management),
            ("Advanced Search Tools", self.test_advanced_search),
            ("Documentation Management", self.test_documentation_management),
            ("Bookmark System Tools", self.test_bookmark_system)
        ]
        
        for group_name, test_method in test_groups:
            print(f"\n📋 Testing {group_name}")
            print("-" * 40)
            await test_method()
        
        # Print final results
        self.print_final_results()

    async def test_original_tools(self):
        """Test the original 5 IDS tools (enhanced versions)."""
        
        # Test 1: ids_search
        await self.test_tool("ids_search", {
            "query": "market analysis",
            "max_results": 5
        })
        
        # Test 2: ids_get_file_info
        await self.test_tool("ids_get_file_info", {
            "file_path": "docs/DOCUMENTATION_INDEX.md"
        })
        
        # Test 3: ids_list_tags
        await self.test_tool("ids_list_tags", {
            "category": "strategic"
        })
        
        # Test 4: ids_get_system_status
        await self.test_tool("ids_get_system_status", {})
        
        # Test 5: ids_find_by_tag
        await self.test_tool("ids_find_by_tag", {
            "tags": ["bookmark", "strategic"],
            "match_all": False
        })

    async def test_index_management(self):
        """Test index management tools."""
        
        # Test 6: ids_check_index_freshness
        await self.test_tool("ids_check_index_freshness", {})
        
        # Test 7: ids_incremental_update (safe test)
        await self.test_tool("ids_incremental_update", {
            "paths": ["docs/strategic"],
            "recursive": True
        })
        
        # Test 8: ids_rebuild_indexes (skip for safety unless forced)
        print("⚠️  Skipping ids_rebuild_indexes test (would rebuild entire index)")
        self.test_results["tool_results"]["ids_rebuild_indexes"] = "SKIPPED"

    async def test_advanced_search(self):
        """Test advanced search tools."""
        
        # Test 9: ids_semantic_search
        await self.test_tool("ids_semantic_search", {
            "query": "competitive analysis investment",
            "min_relevance": 0.2
        })
        
        # Test 10: ids_search_with_context
        await self.test_tool("ids_search_with_context", {
            "query": "bookmark",
            "context_lines": 2,
            "max_results": 3
        })
        
        # Test 11: ids_search_analytics
        await self.test_tool("ids_search_analytics", {
            "days": 7
        })

    async def test_documentation_management(self):
        """Test documentation management tools."""
        
        # Test 12: ids_validate_documentation
        await self.test_tool("ids_validate_documentation", {
            "check_links": True,
            "check_tags": True,
            "check_orphans": True
        })
        
        # Test 13: ids_generate_documentation_report
        await self.test_tool("ids_generate_documentation_report", {
            "format": "markdown",
            "include_analytics": True
        })
        
        # Test 14: ids_export_index
        await self.test_tool("ids_export_index", {
            "format": "json",
            "include_metadata": True,
            "output_path": "docs/test_export.json"
        })

    async def test_bookmark_system(self):
        """Test bookmark system tools."""
        
        # Test 15: ids_create_bookmark
        test_bookmark_result = await self.test_tool("ids_create_bookmark", {
            "title": "Test Bookmark for MCP Server",
            "description": "Testing bookmark creation via enhanced MCP server",
            "category": "technical",
            "tags": ["testing", "mcp", "ids"],
            "trigger_conditions": "When testing MCP server functionality",
            "priority": "medium"
        })
        
        # Extract bookmark ID for subsequent tests
        bookmark_id = None
        if test_bookmark_result and "bookmark_id" in test_bookmark_result:
            bookmark_id = test_bookmark_result["bookmark_id"]
        
        # Test 16: ids_manage_bookmarks (list)
        await self.test_tool("ids_manage_bookmarks", {
            "action": "list",
            "filter_category": "technical",
            "filter_status": "active"
        })
        
        # Test 16b: ids_manage_bookmarks (update) - if we have a bookmark ID
        if bookmark_id:
            await self.test_tool("ids_manage_bookmarks", {
                "action": "update",
                "bookmark_id": bookmark_id,
                "updates": {
                    "description": "Updated test bookmark description",
                    "priority": "high"
                }
            })
            
            # Test 16c: ids_manage_bookmarks (complete)
            await self.test_tool("ids_manage_bookmarks", {
                "action": "complete",
                "bookmark_id": bookmark_id
            })
        
        # Test 17: ids_bookmark_analytics
        await self.test_tool("ids_bookmark_analytics", {
            "include_trends": True,
            "category_breakdown": True
        })

    async def test_tool(self, tool_name: str, arguments: dict):
        """Test a single tool and record results."""
        print(f"  🔧 Testing {tool_name}...")
        
        try:
            # Call the tool handler directly
            handler_name = f"handle_{tool_name}"
            if hasattr(self.server, handler_name):
                handler = getattr(self.server, handler_name)
                result = await handler(**arguments)
                
                # Check if result contains error
                if isinstance(result, dict) and "error" in result:
                    print(f"    ❌ FAILED: {result['error']}")
                    self.test_results["failed"] += 1
                    self.test_results["errors"].append(f"{tool_name}: {result['error']}")
                    self.test_results["tool_results"][tool_name] = "FAILED"
                    return None
                else:
                    print(f"    ✅ PASSED")
                    self.test_results["passed"] += 1
                    self.test_results["tool_results"][tool_name] = "PASSED"
                    return result
            else:
                print(f"    ❌ FAILED: Handler {handler_name} not found")
                self.test_results["failed"] += 1
                self.test_results["errors"].append(f"{tool_name}: Handler not found")
                self.test_results["tool_results"][tool_name] = "FAILED"
                return None
                
        except Exception as e:
            print(f"    ❌ FAILED: {str(e)}")
            self.test_results["failed"] += 1
            self.test_results["errors"].append(f"{tool_name}: {str(e)}")
            self.test_results["tool_results"][tool_name] = "FAILED"
            return None

    def print_final_results(self):
        """Print comprehensive test results."""
        print("\n" + "=" * 60)
        print("🏁 ENHANCED IDS MCP SERVER TEST RESULTS")
        print("=" * 60)
        
        total_tests = self.test_results["passed"] + self.test_results["failed"]
        pass_rate = (self.test_results["passed"] / max(total_tests, 1)) * 100
        
        print(f"📊 Overall Results:")
        print(f"   Total Tests: {total_tests}")
        print(f"   Passed: {self.test_results['passed']} ✅")
        print(f"   Failed: {self.test_results['failed']} ❌")
        print(f"   Pass Rate: {pass_rate:.1f}%")
        
        if self.test_results["failed"] > 0:
            print(f"\n❌ Failed Tests:")
            for error in self.test_results["errors"]:
                print(f"   - {error}")
        
        print(f"\n🔧 Tool Results Summary:")
        for tool_name, result in self.test_results["tool_results"].items():
            status_emoji = {"PASSED": "✅", "FAILED": "❌", "SKIPPED": "⚠️"}
            emoji = status_emoji.get(result, "❓")
            print(f"   {emoji} {tool_name}: {result}")
        
        print("\n🎯 Test Completion Summary:")
        if pass_rate >= 90:
            print("   🌟 EXCELLENT: Enhanced MCP Server is working excellently!")
        elif pass_rate >= 75:
            print("   👍 GOOD: Enhanced MCP Server is working well with minor issues.")
        elif pass_rate >= 50:
            print("   ⚠️  NEEDS WORK: Enhanced MCP Server has some significant issues.")
        else:
            print("   🚨 CRITICAL: Enhanced MCP Server has major issues requiring attention.")
        
        print("\n📋 Next Steps:")
        if self.test_results["failed"] > 0:
            print("   1. Review and fix failed tool implementations")
            print("   2. Re-run tests to verify fixes")
            print("   3. Consider additional error handling improvements")
        else:
            print("   1. Enhanced MCP Server is ready for integration!")
            print("   2. Consider performance optimization testing")
            print("   3. Deploy to production MCP environment")

async def main():
    """Run the test suite."""
    tester = IDSMCPTester()
    await tester.run_all_tests()

if __name__ == "__main__":
    asyncio.run(main())
