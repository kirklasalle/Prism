#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\utilities\check_system.py #python #source_code  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\utilities\check_system.py #python #source_code  
**Category:** Source Code  
**Status:** Active

"""
System Check Script for IDS MCP Server
======================================

Verifies that all dependencies and indices are available.
"""

import sys
from pathlib import Path

# Add project paths
sys.path.insert(0, '../..')
sys.path.insert(0, '../../docs')

def check_enhanced_ids():
    """Check if Enhanced IDS is available."""
    try:
        from docs.enhanced_ids import EnhancedIDS
        print('✅ Enhanced IDS available')
        return True
    except ImportError as e:
        print(f'⚠️  Enhanced IDS not available: {e}')
        return False

def check_indices():
    """Check if IDS indices are available."""
    indices = [
        '../../docs/unified_tags_index.yaml',
        '../../docs/file_metadata.yaml',
        '../../docs/reverse_tag_index.yaml'
    ]
    
    available_count = 0
    for index_path in indices:
        if Path(index_path).exists():
            available_count += 1
            print(f'✅ {Path(index_path).name} found')
        else:
            print(f'⚠️  {Path(index_path).name} not found')
    
    return available_count

def check_dependencies():
    """Check if required dependencies are available."""
    deps = ['yaml', 'rich']
    missing = []
    
    for dep in deps:
        try:
            __import__(dep)
            print(f'✅ {dep} available')
        except ImportError:
            print(f'❌ {dep} missing')
            missing.append(dep)
    
    return len(missing) == 0

if __name__ == "__main__":
    print("IDS MCP Server System Check")
    print("=" * 30)
    
    deps_ok = check_dependencies()
    ids_ok = check_enhanced_ids()
    indices_count = check_indices()
    
    print("\n" + "=" * 30)
    if deps_ok and indices_count > 0:
        print("✅ System ready for IDS MCP Server")
    else:
        print("⚠️  System may have issues")
        if not deps_ok:
            print("   • Install missing dependencies: pip install -r requirements.txt")
        if indices_count == 0:
            print("   • Run IDS system to generate indices")
