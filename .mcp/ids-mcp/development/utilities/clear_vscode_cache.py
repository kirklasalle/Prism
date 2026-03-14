#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\utilities\clear_vscode_cache.py #python #source_code  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\utilities\clear_vscode_cache.py #python #source_code  
**Category:** Source Code  
**Status:** Active

"""
VS Code MCP Cache Cleaner
Clear VS Code's MCP cache to force fresh tool discovery
"""

import os
import shutil
import sys
from pathlib import Path

def clear_vscode_cache():
    """Clear VS Code caches that might interfere with MCP"""
    
    print("🧹 Clearing VS Code MCP Cache...")
    
    # Common VS Code cache locations on Windows
    cache_locations = [
        Path.home() / "AppData" / "Roaming" / "Code" / "CachedExtensions",
        Path.home() / "AppData" / "Roaming" / "Code" / "logs",
        Path.home() / "AppData" / "Roaming" / "Code" / "User" / "workspaceStorage",
        Path.home() / ".vscode" / "extensions",
    ]
    
    # Project-specific caches
    project_caches = [
        Path("d:/Projects/impressioncore/.vscode/.ropeproject"),
        Path("d:/Projects/impressioncore/.vscode/settings.json.bak"),
    ]
    
    cleared_count = 0
    
    for cache_path in cache_locations + project_caches:
        if cache_path.exists():
            try:
                if cache_path.is_file():
                    cache_path.unlink()
                    print(f"  ✅ Removed file: {cache_path}")
                    cleared_count += 1
                elif cache_path.is_dir():
                    # Only remove if it's clearly a cache directory
                    if any(keyword in str(cache_path).lower() for keyword in ['cache', 'temp', 'log']):
                        shutil.rmtree(cache_path)
                        print(f"  ✅ Removed directory: {cache_path}")
                        cleared_count += 1
            except PermissionError:
                print(f"  ⚠️  Permission denied: {cache_path}")
            except Exception as e:
                print(f"  ❌ Error removing {cache_path}: {e}")
    
    print(f"\n🎯 Cache cleaning complete! Cleared {cleared_count} items")
    print("\n📋 Next steps:")
    print("1. Restart VS Code completely")
    print("2. Wait for MCP to initialize")
    print("3. Check that all 17 tools are now visible")

if __name__ == "__main__":
    clear_vscode_cache()
