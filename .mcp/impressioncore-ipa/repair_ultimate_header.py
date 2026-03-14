import sys
from pathlib import Path

file_path = Path(r"d:\Projects\impressioncore\.mcp\impressioncore-ipa\server_ultimate.py")

header = r'''#!/usr/bin/env python3
r"""
**Created:** 2024-10-15  
**Updated:** 2025-08-04 10:26:57  
**Author:** Kirk LaSalle  
**Tags:** #.mcp/impressioncore_ipa/server_ultimate.py #api #command_line #documentation #memory_management #python #source_code #testing #web_interface  
**Category:** Source Code  
**Status:** Active

ImpressionCore-IPA ULTIMATE Edition - The Perfect Fusion of OpenAI Deep Research & Perplexity
===========================================================================================

🚀 THE MOST ADVANCED RESEARCH & DISCOVERY TOOL EVER CREATED 🚀

Combining the ABSOLUTE capabilities of:
- ✅ OpenAI Deep Research: Multi-step reasoning, comprehensive analysis, methodology validation
- ✅ Perplexity AI: Real-time web search, source attribution, conversational discovery
- ✅ ImpressionCore Excellence: Sacred Covenant compliance, GTX 1050 Ti optimization

This is what happens when "Perplexity" and "OpenAI Deep Research" have a baby! 👶

Features:
- 🧠 DEEP RESEARCH METHODOLOGY: Multi-step reasoning chains with validation
- 🌐 REAL-TIME WEB INTELLIGENCE: Live search with instant source verification
- 📚 COMPREHENSIVE SOURCE ATTRIBUTION: Academic-grade citation and provenance
- 🔍 MULTI-ENGINE SEARCH FUSION: Google, DuckDuckGo, Bing, Academic databases
- 🎯 CONVERSATIONAL DISCOVERY: Natural language research with follow-up questions
- 🔬 METHODOLOGY VALIDATION: Research approach verification and optimization
- 📊 LIVE DATA SYNTHESIS: Real-time information aggregation and analysis
- 🏆 QUALITY ASSURANCE: Multi-factor source credibility assessment

Author: Kirk LaSalle + Virtually Robotic GitHub Copilot
Version: 3.0 ULTIMATE Edition - Deep Research + Perplexity Fusion
"""
'''

try:
    with open(file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    # Find where imports start. We look for 'import asyncio' which we know is at the start of the code.
    start_line = 0
    for i, line in enumerate(lines):
        if "import asyncio" in line:
            start_line = i
            break
    
    if start_line == 0:
        # Fallback: if we can't find 'import asyncio', just skip estimated header size or look for other markers
        for i, line in enumerate(lines):
            if i > 50 and "import" in line:
                start_line = i
                break

    if start_line > 0:
        code = "".join(lines[start_line:])
        new_content = header + "\n" + code
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"✅ Successfully repaired header in {file_path}")
    else:
        print(f"❌ Could not find start of code in {file_path}")

except Exception as e:
    print(f"❌ Error: {e}")
