#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\utilities\comprehensive_demo.py #api #attention_mechanism #documentation #python #security #source_code #testing  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\utilities\comprehensive_demo.py #api #attention_mechanism #documentation #python #security #source_code #testing  
**Category:** Source Code  
**Status:** Active

"""
Complete IDS MCP Server Tool Demonstration
==========================================

This script demonstrates all 5 IDS MCP tools with real examples
and provides comprehensive testing for development purposes.

Tools Demonstrated:
1. ids_search - Search documentation with query and tags
2. ids_get_file_info - Get detailed file information
3. ids_list_tags - Browse available tags
4. ids_get_system_status - System health and statistics
5. ids_find_by_tag - Find files by tag combinations

Author: ImpressionCore IDS Team
Date: 2025-06-05
Version: 1.0.0
"""

import json
import sys
import asyncio
from pathlib import Path
from typing import Dict, Any
import subprocess
import time

# Add project root to path
project_root = Path(__file__).parent.parent.parent
sys.path.insert(0, str(project_root))

from server import IDSMCPServer

class IDSToolsDemo:
    """Comprehensive demonstration of all IDS MCP tools"""
    
    def __init__(self):
        self.server = IDSMCPServer()
        self.test_results = {}
        
    async def run_full_demo(self):
        """Run complete demonstration of all tools"""
        
        print("🚀 IDS MCP Server - Complete Tool Demonstration")
        print("=" * 60)
        print(f"Server Version: {self.server.version}")
        print(f"Enhanced IDS Available: {self.server.enhanced_ids is not None}")
        print(f"Files Indexed: {len(self.server.unified_index)}")
        print(f"Metadata Records: {len(self.server.file_metadata)}")
        print(f"Tags Available: {len(self.server.reverse_index)}")
        print()
        
        # Test all 5 tools
        tests = [
            ("Tool 1: IDS Search", self.demo_ids_search),
            ("Tool 2: IDS Get File Info", self.demo_ids_get_file_info),
            ("Tool 3: IDS List Tags", self.demo_ids_list_tags),
            ("Tool 4: IDS System Status", self.demo_ids_get_system_status),
            ("Tool 5: IDS Find by Tag", self.demo_ids_find_by_tag)
        ]
        
        for test_name, test_func in tests:
            print(f"\n🔧 {test_name}")
            print("-" * 50)
            try:
                await test_func()
                self.test_results[test_name] = "✅ PASSED"
            except Exception as e:
                print(f"❌ Error: {e}")
                self.test_results[test_name] = f"❌ FAILED: {e}"
        
        # Summary
        self.print_summary()
        
    async def demo_ids_search(self):
        """Demonstrate the IDS search functionality"""
        
        search_queries = [
            {
                "name": "Basic Documentation Search",
                "query": "authentication security",
                "tags": [],
                "max_results": 5
            },
            {
                "name": "API-Focused Search",
                "query": "API endpoints",
                "tags": ["api"],
                "max_results": 3
            },
            {
                "name": "Architecture Search",
                "query": "system architecture",
                "tags": ["architecture", "core"],
                "max_results": 4
            }
        ]
        
        for i, search_config in enumerate(search_queries, 1):
            print(f"\n📋 Search Example {i}: {search_config['name']}")
            print(f"Query: '{search_config['query']}'")
            if search_config['tags']:
                print(f"Tags: {search_config['tags']}")
            print(f"Max Results: {search_config['max_results']}")
            print()
            
            # Execute search
            result = await self.server.handle_call_tool('ids_search', search_config)
            
            # Display results
            content = result.get('content', [])
            if content and content[0].get('type') == 'text':
                search_text = content[0]['text']
                print("🔍 Search Results:")
                print(search_text)
            else:
                print("❌ Unexpected response format")
                
    async def demo_ids_get_file_info(self):
        """Demonstrate file info retrieval"""
        
        # Get some sample files from the index
        sample_files = list(self.server.file_metadata.keys())[:3]
        
        print("📂 File Information Examples:")
        print()
        
        for i, file_path in enumerate(sample_files, 1):
            print(f"Example {i}: {file_path}")
            
            result = await self.server.handle_call_tool('ids_get_file_info', {
                'file_path': file_path
            })
            
            content = result.get('content', [])
            if content and content[0].get('type') == 'text':
                info_text = content[0]['text']
                print(info_text)
                print()
            else:
                print("❌ Unexpected response format")
                print()
                
    async def demo_ids_list_tags(self):
        """Demonstrate tag listing functionality"""
        
        tag_examples = [
            {
                "name": "All Tags (Limited)",
                "category": None,
                "pattern": None,
                "description": "Show first 20 tags from all categories"
            },
            {
                "name": "API Tags",
                "category": "api",
                "pattern": None,
                "description": "Show tags related to API documentation"
            },
            {
                "name": "Security Pattern",
                "category": None,
                "pattern": "security",
                "description": "Show tags containing 'security'"
            }
        ]
        
        for example in tag_examples:
            print(f"\n🏷️  Tag Listing: {example['name']}")
            print(f"Description: {example['description']}")
            
            params = {}
            if example['category']:
                params['category'] = example['category']
            if example['pattern']:
                params['pattern'] = example['pattern']
            
            result = await self.server.handle_call_tool('ids_list_tags', params)
            
            content = result.get('content', [])
            if content and content[0].get('type') == 'text':
                tags_text = content[0]['text']
                # Show first 500 chars to keep output manageable
                print(tags_text[:500] + ("..." if len(tags_text) > 500 else ""))
                print()
            else:
                print("❌ Unexpected response format")
                print()
                
    async def demo_ids_get_system_status(self):
        """Demonstrate system status retrieval"""
        
        print("📊 IDS System Status and Statistics:")
        print()
        
        result = await self.server.handle_call_tool('ids_get_system_status', {})
        
        content = result.get('content', [])
        if content and content[0].get('type') == 'text':
            status_text = content[0]['text']
            print(status_text)
        else:
            print("❌ Unexpected response format")
            
    async def demo_ids_find_by_tag(self):
        """Demonstrate finding files by tags"""
        
        tag_searches = [
            {
                "name": "Security Documents",
                "tags": ["security"],
                "match_all": False,
                "description": "Find any files tagged with 'security'"
            },
            {
                "name": "API Reference Docs",
                "tags": ["api", "reference"],
                "match_all": True,
                "description": "Find files with both 'api' AND 'reference' tags"
            },
            {
                "name": "Core Architecture",
                "tags": ["core", "architecture", "system"],
                "match_all": False,
                "description": "Find files with any core/architecture/system tags"
            }
        ]
        
        for search in tag_searches:
            print(f"\n🔖 Tag Search: {search['name']}")
            print(f"Description: {search['description']}")
            print(f"Tags: {search['tags']}")
            print(f"Match All: {search['match_all']}")
            print()
            
            result = await self.server.handle_call_tool('ids_find_by_tag', {
                'tags': search['tags'],
                'match_all': search['match_all']
            })
            
            content = result.get('content', [])
            if content and content[0].get('type') == 'text':
                results_text = content[0]['text']
                # Show first 600 chars to keep output manageable
                print(results_text[:600] + ("..." if len(results_text) > 600 else ""))
                print()
            else:
                print("❌ Unexpected response format")
                print()
                
    def print_summary(self):
        """Print test summary"""
        
        print("\n" + "=" * 60)
        print("🎯 IDS MCP Server Tool Demonstration Summary")
        print("=" * 60)
        
        passed = sum(1 for result in self.test_results.values() if "✅ PASSED" in result)
        total = len(self.test_results)
        
        print(f"Tests Completed: {total}")
        print(f"Tests Passed: {passed}")
        print(f"Success Rate: {(passed/total)*100:.1f}%")
        print()
        
        print("📋 Individual Test Results:")
        for test_name, result in self.test_results.items():
            print(f"  {result} {test_name}")
        
        print()
        if passed == total:
            print("🎉 All IDS MCP tools are working perfectly!")
            print("✅ The server is ready for VS Code integration")
        else:
            print("⚠️  Some tools may need attention")
            
        print()
        print("🔗 Integration Information:")
        print("  - Server Name: impressioncore-ids")
        print("  - Protocol: Model Context Protocol (MCP)")
        print("  - Communication: JSON-RPC over stdio")
        print("  - VS Code Extension: Model Context Protocol")
        print()
        print("📚 Documentation: See comprehensive guides in .mcp/ids-mcp/docs/")
        print("🧪 Testing: Run this script for validation")
        print("⚙️  Configuration: Check .vscode/settings.json")

async def main():
    """Main demonstration function"""
    demo = IDSToolsDemo()
    await demo.run_full_demo()

if __name__ == "__main__":
    asyncio.run(main())
