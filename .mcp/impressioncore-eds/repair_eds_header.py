import sys
from pathlib import Path

file_path = Path(r"d:\Projects\impressioncore\.mcp\impressioncore-eds\server_enhanced.py")

header = r'''#!/usr/bin/env python3
r"""
**Created:** 2025-07-26  
**Updated:** 2025-08-04 10:20:00  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\impressioncore_eds\server_enhanced.py #documentation #python #source_code #testing #web_interface  
**Category:** Source Code  
**Status:** Active

ImpressionCore Educational Data Scraper (EDS) - Enhanced
========================================================

Upgrade 2025: Multimodal Intelligence Curator
- 🖼️ MULTIMODAL CURATION: Deep analysis of YouTube and Web metadata
- 📈 EDUCATIONAL DENSITY SCORING: Algorithmic assessment of asset value
- 🧬 DIGITAL DNA: Integrated lineage tracing for curated assets
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
        print(f"✅ Successfully repaired EDS header in {file_path}")
    else:
        print(f"❌ Could not find start of code in {file_path}")

except Exception as e:
    print(f"❌ Error: {e}")
