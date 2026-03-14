#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\examples\integration_test.py #api #documentation #python #security #source_code #testing  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\examples\integration_test.py #api #documentation #python #security #source_code #testing  
**Category:** Source Code  
**Status:** Active

"""
Integration Test for IDS MCP Server
===================================

Comprehensive integration test suite for the IDS MCP server.
Tests all tools and validates responses.

Author: ImpressionCore IDS Team
Created: 2025-06-05
"""

import json
import asyncio
import sys
from pathlib import Path
from typing import Dict, Any, List

# Add server directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

try:
    from server import IDSMCPServer
    HAS_SERVER = True
except ImportError:
    HAS_SERVER = False
    print("❌ Could not import server. Make sure you're in the correct directory.")

class IntegrationTester:
    """Integration test runner for IDS MCP server."""
    
    def __init__(self):
        self.server = None
        self.tests_passed = 0
        self.tests_failed = 0
        self.test_results = []
    
    async def setup(self):
        """Set up the test environment."""
        if not HAS_SERVER:
            print("❌ Server not available for testing")
            return False
        
        try:
            self.server = IDSMCPServer()
            print("✅ Server initialized successfully")
            return True
        except Exception as e:
            print(f"❌ Server initialization failed: {e}")
            return False
    
    async def test_list_tools(self):
        """Test the tools/list functionality."""
        print("\n🧪 Testing: tools/list")
        
        try:
            result = await self.server.handle_list_tools()
            
            # Validate response structure
            assert "tools" in result, "Response missing 'tools' key"
            assert isinstance(result["tools"], list), "Tools should be a list"
            assert len(result["tools"]) > 0, "Should have at least one tool"
            
            # Check for expected tools
            tool_names = [tool["name"] for tool in result["tools"]]
            expected_tools = [
                "ids_search",
                "ids_get_file_info", 
                "ids_list_tags",
                "ids_get_system_status",
                "ids_find_by_tag"
            ]
            
            for expected_tool in expected_tools:
                assert expected_tool in tool_names, f"Missing tool: {expected_tool}"
            
            self.tests_passed += 1
            self.test_results.append(("tools/list", "PASS", "All tools present"))
            print(f"✅ tools/list test passed - found {len(result['tools'])} tools")
            
        except Exception as e:
            self.tests_failed += 1
            self.test_results.append(("tools/list", "FAIL", str(e)))
            print(f"❌ tools/list test failed: {e}")
    
    async def test_ids_search(self):
        """Test the ids_search tool."""
        print("\n🧪 Testing: ids_search")
        
        test_cases = [
            {
                "name": "Basic search",
                "args": {"query": "documentation"},
                "should_pass": True
            },
            {
                "name": "Search with tags",
                "args": {"query": "api", "tags": ["documentation"], "max_results": 5},
                "should_pass": True
            },
            {
                "name": "Empty query",
                "args": {"query": ""},
                "should_pass": False
            }
        ]
        
        for test_case in test_cases:
            try:
                result = await self.server.handle_call_tool("ids_search", test_case["args"])
                
                if test_case["should_pass"]:
                    assert "content" in result, "Response missing 'content'"
                    assert not result.get("isError", False), "Should not be an error"
                    self.test_results.append((f"ids_search - {test_case['name']}", "PASS", "Valid response"))
                    print(f"  ✅ {test_case['name']}: passed")
                else:
                    assert result.get("isError", False), "Should be an error"
                    self.test_results.append((f"ids_search - {test_case['name']}", "PASS", "Error correctly handled"))
                    print(f"  ✅ {test_case['name']}: correctly failed")
                
                self.tests_passed += 1
                
            except Exception as e:
                self.tests_failed += 1
                self.test_results.append((f"ids_search - {test_case['name']}", "FAIL", str(e)))
                print(f"  ❌ {test_case['name']}: {e}")
    
    async def test_ids_get_system_status(self):
        """Test the ids_get_system_status tool."""
        print("\n🧪 Testing: ids_get_system_status")
        
        try:
            result = await self.server.handle_call_tool("ids_get_system_status", {})
            
            assert "content" in result, "Response missing 'content'"
            assert not result.get("isError", False), "Should not be an error"
            
            content = result["content"][0]["text"]
            assert "IDS System Status Report" in content, "Missing status report header"
            assert "System Statistics" in content, "Missing system statistics"
            
            self.tests_passed += 1
            self.test_results.append(("ids_get_system_status", "PASS", "Status report generated"))
            print("✅ ids_get_system_status test passed")
            
        except Exception as e:
            self.tests_failed += 1
            self.test_results.append(("ids_get_system_status", "FAIL", str(e)))
            print(f"❌ ids_get_system_status test failed: {e}")
    
    async def test_ids_list_tags(self):
        """Test the ids_list_tags tool."""
        print("\n🧪 Testing: ids_list_tags")
        
        test_cases = [
            {
                "name": "List all tags",
                "args": {},
                "should_pass": True
            },
            {
                "name": "Filter by category",
                "args": {"category": "security"},
                "should_pass": True
            },
            {
                "name": "Filter by pattern",
                "args": {"pattern": "api"},
                "should_pass": True
            }
        ]
        
        for test_case in test_cases:
            try:
                result = await self.server.handle_call_tool("ids_list_tags", test_case["args"])
                
                assert "content" in result, "Response missing 'content'"
                assert not result.get("isError", False), "Should not be an error"
                
                self.tests_passed += 1
                self.test_results.append((f"ids_list_tags - {test_case['name']}", "PASS", "Tags listed"))
                print(f"  ✅ {test_case['name']}: passed")
                
            except Exception as e:
                self.tests_failed += 1
                self.test_results.append((f"ids_list_tags - {test_case['name']}", "FAIL", str(e)))
                print(f"  ❌ {test_case['name']}: {e}")
    
    async def test_ids_find_by_tag(self):
        """Test the ids_find_by_tag tool."""
        print("\n🧪 Testing: ids_find_by_tag")
        
        test_cases = [
            {
                "name": "Find by single tag",
                "args": {"tags": ["documentation"]},
                "should_pass": True
            },
            {
                "name": "Find by multiple tags (ANY)",
                "args": {"tags": ["api", "security"], "match_all": False},
                "should_pass": True
            },
            {
                "name": "Find by multiple tags (ALL)",
                "args": {"tags": ["core", "security"], "match_all": True},
                "should_pass": True
            },
            {
                "name": "Empty tags",
                "args": {"tags": []},
                "should_pass": False
            }
        ]
        
        for test_case in test_cases:
            try:
                result = await self.server.handle_call_tool("ids_find_by_tag", test_case["args"])
                
                if test_case["should_pass"]:
                    assert "content" in result, "Response missing 'content'"
                    assert not result.get("isError", False), "Should not be an error"
                    self.test_results.append((f"ids_find_by_tag - {test_case['name']}", "PASS", "Files found"))
                    print(f"  ✅ {test_case['name']}: passed")
                else:
                    assert result.get("isError", False), "Should be an error"
                    self.test_results.append((f"ids_find_by_tag - {test_case['name']}", "PASS", "Error correctly handled"))
                    print(f"  ✅ {test_case['name']}: correctly failed")
                
                self.tests_passed += 1
                
            except Exception as e:
                self.tests_failed += 1
                self.test_results.append((f"ids_find_by_tag - {test_case['name']}", "FAIL", str(e)))
                print(f"  ❌ {test_case['name']}: {e}")
    
    async def run_all_tests(self):
        """Run all integration tests."""
        print("🚀 Starting IDS MCP Server Integration Tests")
        print("=" * 60)
        
        # Setup
        if not await self.setup():
            print("❌ Setup failed, aborting tests")
            return False
        
        # Run tests
        await self.test_list_tools()
        await self.test_ids_search()
        await self.test_ids_get_system_status()
        await self.test_ids_list_tags()
        await self.test_ids_find_by_tag()
        
        # Results summary
        print("\n" + "=" * 60)
        print("📊 Test Results Summary")
        print("=" * 60)
        
        total_tests = self.tests_passed + self.tests_failed
        success_rate = (self.tests_passed / total_tests * 100) if total_tests > 0 else 0
        
        print(f"Total Tests: {total_tests}")
        print(f"Passed: {self.tests_passed}")
        print(f"Failed: {self.tests_failed}")
        print(f"Success Rate: {success_rate:.1f}%")
        
        print("\n📋 Detailed Results:")
        for test_name, status, message in self.test_results:
            status_icon = "✅" if status == "PASS" else "❌"
            print(f"  {status_icon} {test_name}: {message}")
        
        if self.tests_failed == 0:
            print("\n🎉 All tests passed! IDS MCP Server is working correctly.")
            return True
        else:
            print(f"\n⚠️  {self.tests_failed} test(s) failed. Check the results above.")
            return False

async def main():
    """Run integration tests."""
    tester = IntegrationTester()
    success = await tester.run_all_tests()
    
    if success:
        print("\n✅ Integration tests completed successfully!")
        sys.exit(0)
    else:
        print("\n❌ Integration tests failed!")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
