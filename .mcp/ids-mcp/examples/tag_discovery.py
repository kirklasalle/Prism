#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\examples\tag_discovery.py #api #command_line #documentation #python #security #source_code #testing #web_interface  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\examples\tag_discovery.py #api #command_line #documentation #python #security #source_code #testing #web_interface  
**Category:** Source Code  
**Status:** Active

"""
Tag Discovery Example for IDS MCP Server
========================================

This example demonstrates tag discovery and exploration functionality.
Shows how to browse and discover available tags in the IDS system.

Author: ImpressionCore IDS Team
Created: 2025-06-05
"""

import json
import asyncio
from typing import Dict, Any, List

class TagDiscoveryClient:
    """MCP client for exploring IDS tags."""
    
    def __init__(self):
        self.request_id = 0
    
    def create_request(self, method: str, params: Dict[str, Any] = None) -> Dict[str, Any]:
        """Create a properly formatted MCP request."""
        self.request_id += 1
        return {
            "jsonrpc": "2.0",
            "id": self.request_id,
            "method": method,
            "params": params or {}
        }
    
    async def list_all_tags(self):
        """List all available tags in the system."""
        print("\n📋 Listing all available tags...")
        
        request = self.create_request("tools/call", {
            "name": "ids_list_tags",
            "arguments": {}
        })
        
        print(f"📤 Request: {json.dumps(request, indent=2)}")
        
        # Example response
        example_response = {
            "jsonrpc": "2.0",
            "id": request["id"],
            "result": {
                "content": [
                    {
                        "type": "text",
                        "text": "Found 2900+ tags:\n\n**API**: api-authentication, api-documentation, api-endpoints, api-reference\n**ARC**: architecture, architecture-core, architecture-diagram\n**COG**: cognitive, cognitive-architecture, cognitive-simulation\n**COR**: core, core-config, core-security, core-utils\n**DEV**: developer, development, development-guide\n**DOC**: documentation, documentation-index, documentation-system\n**IDS**: ids, ids-enhanced, ids-integration, ids-search\n**SEC**: security, security-authentication, security-encryption\n**UKS**: uks, uks-implementation, uks-interface\n**WEB**: web, web-frontend, web-server, web-templates"
                    }
                ]
            }
        }
        
        print(f"📥 Response: {json.dumps(example_response, indent=2)}")
        return example_response
    
    async def find_tags_by_category(self, category: str):
        """Find tags in a specific category."""
        print(f"\n🔍 Finding tags in category: '{category}'")
        
        request = self.create_request("tools/call", {
            "name": "ids_list_tags",
            "arguments": {
                "category": category
            }
        })
        
        print(f"📤 Request: {json.dumps(request, indent=2)}")
        
        # Example response for security category
        example_response = {
            "jsonrpc": "2.0",
            "id": request["id"],
            "result": {
                "content": [
                    {
                        "type": "text",
                        "text": f"Found 15 tags in category '{category}':\n\n**SEC**: security, security-authentication, security-authorization, security-config, security-encryption, security-framework, security-implementation, security-infrastructure, security-logging, security-monitoring, security-protocols, security-testing, security-tokens, security-validation, security-web"
                    }
                ]
            }
        }
        
        print(f"📥 Response: {json.dumps(example_response, indent=2)}")
        return example_response
    
    async def find_files_by_tags(self, tags: List[str], match_all: bool = False):
        """Find files that have specific tags."""
        match_mode = "ALL" if match_all else "ANY"
        print(f"\n📁 Finding files with {match_mode} tags: {', '.join(tags)}")
        
        request = self.create_request("tools/call", {
            "name": "ids_find_by_tag",
            "arguments": {
                "tags": tags,
                "match_all": match_all
            }
        })
        
        print(f"📤 Request: {json.dumps(request, indent=2)}")
        
        # Example response
        example_response = {
            "jsonrpc": "2.0",
            "id": request["id"],
            "result": {
                "content": [
                    {
                        "type": "text",
                        "text": f"Search for tags: {', '.join(tags)}\nMatch mode: {match_mode} tags\n\nFound 8 matching files:\n\n**docs/api/complete_api_reference_v2.md**\n  Description: Complete API reference documentation\n  Matching tags: api, reference\n\n**src/core/security/authentication.py**\n  Description: Authentication module implementation\n  Matching tags: security, core\n\n**docs/developer/core_architecture_diagram.md**\n  Description: System architecture overview\n  Matching tags: architecture, core\n\n## Individual Tag Results:\n- **api**: 45 files\n- **security**: 23 files\n- **core**: 156 files"
                    }
                ]
            }
        }
        
        print(f"📥 Response: {json.dumps(example_response, indent=2)}")
        return example_response
    
    async def get_system_status(self):
        """Get overall system status and tag statistics."""
        print("\n📊 Getting system status and tag statistics...")
        
        request = self.create_request("tools/call", {
            "name": "ids_get_system_status",
            "arguments": {}
        })
        
        print(f"📤 Request: {json.dumps(request, indent=2)}")
        
        # Example response
        example_response = {
            "jsonrpc": "2.0",
            "id": request["id"],
            "result": {
                "content": [
                    {
                        "type": "text",
                        "text": "# IDS System Status Report\n**Generated**: 2025-06-05 14:30:15\n**Version**: 1.0.0\n\n## System Statistics\n- **Total Indexed Files**: 1667\n- **Files with Metadata**: 1667\n- **Unique Tags**: 2900\n- **Enhanced IDS Available**: Yes\n- **Rich Console Available**: Yes\n\n## File Type Distribution\n- **.py**: 1489 files\n- **.md**: 123 files\n- **.json**: 28 files\n- **.yaml**: 15 files\n- **.txt**: 8 files\n- **.html**: 4 files\n\n## Most Used Tags (Top 10)\n- **core**: 156 files\n- **documentation**: 89 files\n- **api**: 45 files\n- **security**: 23 files\n- **web**: 19 files\n- **development**: 18 files\n- **architecture**: 15 files\n- **ids**: 12 files\n- **reference**: 11 files\n- **utils**: 10 files"
                    }
                ]
            }
        }
        
        print(f"📥 Response: {json.dumps(example_response, indent=2)}")
        return example_response

async def main():
    """Run tag discovery examples."""
    print("=" * 60)
    print("IDS MCP Server - Tag Discovery Examples")
    print("=" * 60)
    
    client = TagDiscoveryClient()
    
    # Example 1: List all tags
    await client.list_all_tags()
    
    print("\n" + "=" * 60)
    
    # Example 2: Find tags by category
    await client.find_tags_by_category("security")
    
    print("\n" + "=" * 60)
    
    # Example 3: Find files with specific tags (ANY match)
    await client.find_files_by_tags(["api", "security", "core"], match_all=False)
    
    print("\n" + "=" * 60)
    
    # Example 4: Find files with specific tags (ALL match)
    await client.find_files_by_tags(["core", "security"], match_all=True)
    
    print("\n" + "=" * 60)
    
    # Example 5: Get system status
    await client.get_system_status()
    
    print("\n" + "=" * 60)
    print("Tag discovery examples completed! 🎉")
    print("\nKey Insights:")
    print("• IDS system indexes 1,667 files with 2,900+ unique tags")
    print("• Tags are organized by categories (api, core, security, etc.)")
    print("• You can search for files using ANY or ALL tag matching")
    print("• System provides real-time statistics and health monitoring")

if __name__ == "__main__":
    asyncio.run(main())
