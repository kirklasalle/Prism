#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\tests\test_sse_server.py #api #command_line #documentation #python #source_code #testing  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\tests\test_sse_server.py #api #command_line #documentation #python #source_code #testing  
**Category:** Source Code  
**Status:** Active

"""
Test the ImpressionCore IDS MCP SSE Server
=========================================

Test script to verify the SSE server is working correctly and can handle
multiple tool calls in sequence without hanging.
"""

import asyncio
import aiohttp
import json
import time
from datetime import datetime

async def test_sse_server():
    """Test the SSE server endpoints."""
    base_url = "http://127.0.0.1:3002"
    
    print("Testing ImpressionCore IDS MCP SSE Server")
    print("=" * 50)
    
    async with aiohttp.ClientSession() as session:
        # Test 1: Health check
        print("\n1. Testing health endpoint...")
        try:
            async with session.get(f"{base_url}/health") as resp:
                if resp.status == 200:
                    data = await resp.json()
                    print(f"✅ Health check passed: {data['status']}")
                    print(f"   Server version: {data['version']}")
                else:
                    print(f"❌ Health check failed: {resp.status}")
        except Exception as e:
            print(f"❌ Health check error: {e}")
            return
        
        # Test 2: List tools
        print("\n2. Testing list tools endpoint...")
        try:
            async with session.get(f"{base_url}/tools") as resp:
                if resp.status == 200:
                    data = await resp.json()
                    print(f"✅ Tools listed: {data['total_tools']} available")
                    for tool in data['tools']:
                        print(f"   - {tool['name']}: {tool['description']}")
                else:
                    print(f"❌ List tools failed: {resp.status}")
        except Exception as e:
            print(f"❌ List tools error: {e}")
        
        # Test 3: Multiple tool calls in sequence
        print("\n3. Testing multiple tool calls in sequence...")
        
        tools_to_test = [
            {
                "tool": "get-system-status",
                "arguments": {}
            },
            {
                "tool": "list-tags",
                "arguments": {"pattern": "core"}
            },
            {
                "tool": "search",
                "arguments": {"query": "documentation", "max_results": 3}
            },
            {
                "tool": "find-by-tag",
                "arguments": {"tags": ["core", "documentation"]}
            }
        ]
        
        for i, tool_call in enumerate(tools_to_test, 1):
            print(f"\n   Test 3.{i}: Calling {tool_call['tool']}...")
            start_time = time.time()
            
            try:
                async with session.post(
                    f"{base_url}/tools/call",
                    json=tool_call,
                    headers={"Content-Type": "application/json"}
                ) as resp:
                    elapsed = time.time() - start_time
                    
                    if resp.status == 200:
                        data = await resp.json()
                        if data.get('success'):
                            print(f"   ✅ {tool_call['tool']} succeeded in {elapsed:.2f}s")
                            
                            # Show some result details
                            result = data.get('result', {})
                            if 'total_files' in result:
                                print(f"      Files indexed: {result['total_files']}")
                            elif 'total_tags' in result:
                                print(f"      Tags found: {result['total_tags']}")
                            elif 'total_results' in result:
                                print(f"      Search results: {result['total_results']}")
                            elif 'total_matches' in result:
                                print(f"      Tag matches: {result['total_matches']}")
                        else:
                            print(f"   ❌ {tool_call['tool']} failed: {data.get('error', 'Unknown error')}")
                    else:
                        print(f"   ❌ {tool_call['tool']} HTTP error: {resp.status}")
                        
            except Exception as e:
                elapsed = time.time() - start_time
                print(f"   ❌ {tool_call['tool']} exception after {elapsed:.2f}s: {e}")
        
        # Test 4: Rapid succession calls
        print("\n4. Testing rapid succession tool calls...")
        rapid_calls = [
            {"tool": "get-system-status", "arguments": {}},
            {"tool": "get-system-status", "arguments": {}},
            {"tool": "get-system-status", "arguments": {}}
        ]
        
        start_time = time.time()
        
        # Fire all calls rapidly
        tasks = []
        for i, call in enumerate(rapid_calls):
            print(f"   Firing call {i+1}...")
            task = session.post(
                f"{base_url}/tools/call",
                json=call,
                headers={"Content-Type": "application/json"}
            )
            tasks.append(task)
        
        # Wait for all responses
        try:
            responses = await asyncio.gather(*tasks)
            elapsed = time.time() - start_time
            
            success_count = 0
            for i, resp in enumerate(responses):
                if resp.status == 200:
                    data = await resp.json()
                    if data.get('success'):
                        success_count += 1
                        print(f"   ✅ Rapid call {i+1} succeeded")
                    else:
                        print(f"   ❌ Rapid call {i+1} failed: {data.get('error')}")
                else:
                    print(f"   ❌ Rapid call {i+1} HTTP error: {resp.status}")
            
            print(f"   Total time for {len(rapid_calls)} calls: {elapsed:.2f}s")
            print(f"   Success rate: {success_count}/{len(rapid_calls)}")
            
        except Exception as e:
            print(f"   ❌ Rapid calls failed: {e}")
    
    print("\n" + "=" * 50)
    print("SSE Server test completed!")
    print(f"Test time: {datetime.now().isoformat()}")

if __name__ == "__main__":
    asyncio.run(test_sse_server())
