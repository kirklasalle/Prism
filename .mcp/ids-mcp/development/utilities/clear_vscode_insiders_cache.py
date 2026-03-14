#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\utilities\clear_vscode_insiders_cache.py #python #source_code  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\utilities\clear_vscode_insiders_cache.py #python #source_code  
**Category:** Source Code  
**Status:** Active

"""Cache cleaner specifically for VS Code Insiders."""

import os
import shutil
import glob
from pathlib import Path

def clear_vscode_insiders_cache():
    """Clear VS Code Insiders MCP-related cache."""
    print("🧹 Clearing VS Code Insiders MCP Cache...")
    print("=" * 50)
    
    # VS Code Insiders cache locations
    cache_locations = [
        # Windows VS Code Insiders locations
        os.path.expanduser("~\\AppData\\Roaming\\Code - Insiders\\User\\globalStorage"),
        os.path.expanduser("~\\AppData\\Roaming\\Code - Insiders\\CachedExtensions"),
        os.path.expanduser("~\\AppData\\Roaming\\Code - Insiders\\logs"),
        os.path.expanduser("~\\AppData\\Local\\Programs\\Microsoft VS Code Insiders\\resources\\app\\extensions"),
        
        # Workspace-specific cache
        os.path.join(os.getcwd(), ".vscode-insiders"),
        
        # Local cache directories
        os.path.expanduser("~\\.vscode-insiders"),
        
        # Extension host cache
        os.path.expanduser("~\\AppData\\Roaming\\Code - Insiders\\User\\workspaceStorage"),
    ]
    
    items_cleared = 0
    
    for location in cache_locations:
        if os.path.exists(location):
            print(f"📁 Checking: {location}")
            
            # Look for MCP-related files
            mcp_patterns = [
                "*mcp*",
                "*MCP*", 
                "*model-context-protocol*",
                "*impressioncore*"
            ]
            
            for pattern in mcp_patterns:
                matches = glob.glob(os.path.join(location, "**", pattern), recursive=True)
                for match in matches:
                    try:
                        if os.path.isfile(match):
                            os.remove(match)
                            print(f"  🗑️ Removed file: {os.path.basename(match)}")
                            items_cleared += 1
                        elif os.path.isdir(match):
                            shutil.rmtree(match)
                            print(f"  🗑️ Removed directory: {os.path.basename(match)}")
                            items_cleared += 1
                    except Exception as e:
                        print(f"  ⚠️ Could not remove {match}: {e}")
        else:
            print(f"📁 Not found: {location}")
    
    # Check for VS Code Insiders MCP extension storage
    insiders_extensions_path = os.path.expanduser("~\\AppData\\Roaming\\Code - Insiders\\User\\globalStorage")
    if os.path.exists(insiders_extensions_path):
        print(f"\n📁 Checking VS Code Insiders extensions storage...")
        for item in os.listdir(insiders_extensions_path):
            if "mcp" in item.lower() or "impressioncore" in item.lower():
                item_path = os.path.join(insiders_extensions_path, item)
                try:
                    if os.path.isdir(item_path):
                        shutil.rmtree(item_path)
                        print(f"  🗑️ Removed extension storage: {item}")
                        items_cleared += 1
                except Exception as e:
                    print(f"  ⚠️ Could not remove {item}: {e}")
    
    print(f"\n🎯 Cache cleaning complete! Cleared {items_cleared} items")
    print("\n📋 Next steps for VS Code Insiders:")
    print("1. Close ALL VS Code Insiders windows")
    print("2. Wait 15 seconds")
    print("3. Restart VS Code Insiders")
    print("4. Open your workspace")
    print("5. Check Command Palette (Ctrl+Shift+P) for MCP commands")
    print("6. Try '@mcp' in Copilot Chat")

if __name__ == "__main__":
    clear_vscode_insiders_cache()
