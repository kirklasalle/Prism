import os
import re
from pathlib import Path

target_files = [
    r"d:\Projects\impressioncore\.mcp\ids-mcp\server_ai_enhanced.py",
    r"d:\Projects\impressioncore\.mcp\impressioncore-ipa\server_ultimate.py",
    r"d:\Projects\impressioncore\.mcp\impressioncore-vrgc\server_enhanced.py",
    r"d:\Projects\impressioncore\.mcp\impressioncore-eds\server_enhanced.py",
    r"d:\Projects\impressioncore\.mcp\impressioncore-goliath\server.py",
    r"d:\Projects\impressioncore\.mcp\impressioncore-dpa\server.py",
    r"d:\Projects\impressioncore\.mcp\web-search-mcp\server.py"
]

def fix_header(file_path):
    print(f"Checking {file_path}...")
    if not os.path.exists(file_path):
        print(f"Skipping (not found): {file_path}")
        return

    with open(file_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    modified = False
    in_bad_header = False
    header_indices = []

    for i, line in enumerate(lines):
        # Look for the ungrouped header
        if "**Created:**" in line and (i == 0 or not lines[i-1].strip().startswith('"""')):
            # Check if it's already in a docstring (this is a simple check)
            # Find the start of this header block
            start = i
            while start > 0 and (lines[start-1].strip() or lines[start-1].startswith('#')):
                start -= 1
            
            # Check if there is already a """ nearby
            if start > 0 and '"""' in lines[start-1]:
                continue # Already in some docstring
                
            # It's an un-guarded header. Wrap it.
            print(f"  Fixing un-guarded header at line {i+1}")
            lines.insert(start, 'r"""\n')
            # Look for the end of the header block
            end = i + 1
            while end < len(lines) and (lines[end].strip() or lines[end].startswith('#')):
                end += 1
            lines.insert(end, '"""\n')
            modified = True
            break # Do one at a time for safety
    
    if modified:
        with open(file_path, 'w', encoding='utf-8') as f:
            f.writelines(lines)
        print(f"  Successfully fixed {file_path}")
    else:
        print(f"  No un-guarded header found in {file_path}")

for f in target_files:
    fix_header(f)
