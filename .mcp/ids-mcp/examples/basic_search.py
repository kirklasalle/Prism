#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\examples\basic_search.py #api #command_line #documentation #python #security #source_code #testing  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\examples\basic_search.py #api #command_line #documentation #python #security #source_code #testing  
**Category:** Source Code  
**Status:** Active

"""
Basic Search Example for IDS MCP Server
=======================================

This example demonstrates basic search functionality using the IDS MCP server.
Shows how to connect to the server and perform searches.

Author: ImpressionCore IDS Team
Created: 2025-06-05
"""

import json
import asyncio
from typing import Dict, Any

class IDSMCPClient:
    """Simple MCP client for testing IDS server."""
    
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
    
    async def search_documents(self, query: str, tags: list = None, max_results: int = 5):
        """Search for documents using the IDS system."""
        print(f"\n🔍 Searching for: '{query}'")
        if tags:
            print(f"📋 With tags: {', '.join(tags)}")
        
        request = self.create_request("tools/call", {
            "name": "ids_search",
            "arguments": {
                "query": query,
                "tags": tags or [],
                "max_results": max_results
            }
        })
        
        print(f"\n📤 Request: {json.dumps(request, indent=2)}")
        
        # In a real implementation, this would be sent to the server
        # For demonstration, we'll show the expected response format
        print(f"\n📥 Expected Response Format:")
        example_response = {
            "jsonrpc": "2.0",
            "id": request["id"],
            "result": {
                "content": [
                    {
                        "type": "text",
                        "text": f"Found 3 results for query: '{query}'\n\n1. **docs/api/complete_api_reference_v2.md** (Score: 15)\n   Description: Complete API reference documentation\n   Tags: api, reference, documentation\n   Last Modified: 2025-06-05\n\n2. **docs/developer/core_architecture_diagram.md** (Score: 12)\n   Description: System architecture overview\n   Tags: architecture, developer, core\n   Last Modified: 2025-06-04\n\n3. **src/core/security/authentication.py** (Score: 10)\n   Description: Authentication module implementation\n   Tags: security, authentication, core\n   Last Modified: 2025-06-03"
                    }
                ]
            }
        }
        
        print(json.dumps(example_response, indent=2))
        return example_response

async def main():
    """Run basic search examples."""
    print("=" * 60)
    print("IDS MCP Server - Basic Search Examples")
    print("=" * 60)
    
    client = IDSMCPClient()
    
    # Example 1: Basic text search
    await client.search_documents("authentication security")
    
    print("\n" + "=" * 60)
    
    # Example 2: Search with tags
    await client.search_documents(
        query="API documentation",
        tags=["api", "reference"],
        max_results=3
    )
    
    print("\n" + "=" * 60)
    
    # Example 3: Architecture search
    await client.search_documents(
        query="core architecture",
        tags=["architecture", "core"],
        max_results=5
    )
    
    print("\n" + "=" * 60)
    print("Examples completed! 🎉")
    print("\nTo use with real IDS MCP server:")
    print("1. Start the server: python server.py")
    print("2. Connect using MCP protocol")
    print("3. Send requests in the format shown above")

if __name__ == "__main__":
    asyncio.run(main())
