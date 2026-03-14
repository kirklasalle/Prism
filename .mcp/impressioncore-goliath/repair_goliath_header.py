import sys
from pathlib import Path

file_path = Path(r"d:\Projects\impressioncore\.mcp\impressioncore-goliath\server.py")

header = r'''#!/usr/bin/env python3
r"""
**Created:** 2025-07-26  
**Updated:** 2025-08-04 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\impressioncore_goliath\server.py #documentation #python #source_code #testing #web_interface  
**Category:** Source Code  
**Status:** Active

ImpressionCore Goliath MCP Server - Unified Nerve Center
========================================================

🚀 THE BRAIN-TRIAD ORCHESTRATION LAYER 🚀

Features:
- 🧠 UNIFIED SWARM MEMORY: Centralized context and Digital DNA sharing
- ⚖️ VRAM LOAD BALANCING: Hardware-aware task routing for GTX 1050 Ti
- 🌉 MULTI-BRIDGE ARCHITECTURE: Seamless integration of IDS, EDS, IPA, VRGC, DPA
- 🛡️ COVENANT GUARDIAN: Integrated file integrity and safety checks

Compliance: Sacred Covenant Verified ✅
Version: 5.0.0 - Nerve Center Integration
"""
'''

try:
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Find where actual Python imports start
    import_start = content.find("import asyncio\n")
        
    if import_start != -1:
        code = content[import_start:]
        new_content = header + "\n" + code
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"✅ Successfully repaired Goliath header in {file_path}")
    else:
        print(f"❌ Could not find start of code in {file_path}")

except Exception as e:
    print(f"❌ Error: {e}")
