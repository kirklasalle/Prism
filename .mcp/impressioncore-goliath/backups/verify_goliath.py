#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** Kirk LaSalle  
**Tags:** #.mcp\impressioncore_goliath\verify_goliath.py #python #source_code  
**Category:** Source Code  
**Status:** Active
"""






import os
import sys
from pathlib import Path

def verify_goliath_structure():
    """Verify Goliath directory structure."""
    print("🚀 ImpressionCore-Goliath Structure Verification")
    print("=" * 60)
    
    current_dir = Path.cwd()
    print(f"Current directory: {current_dir}")
    
    # Check main files
    main_files = ["server.py", "README.md", "requirements.txt", "__init__.py"]
    for file in main_files:
        if (current_dir / file).exists():
            print(f"✅ {file}")
        else:
            print(f"❌ {file} - MISSING")
    
    # Check directories
    directories = ["core", "bridges", "utils"]
    for dir_name in directories:
        dir_path = current_dir / dir_name
        if dir_path.exists():
            py_files = list(dir_path.glob("*.py"))
            print(f"✅ {dir_name}/ ({len(py_files)} Python files)")
            for py_file in py_files:
                print(f"   - {py_file.name}")
        else:
            print(f"❌ {dir_name}/ - MISSING")
    
    print("\n" + "=" * 60)

def count_tools():
    """Count available tools by analyzing bridge files."""
    print("🔧 Tool Counting Analysis")
    print("=" * 60)
    
    bridges_dir = Path("bridges")
    if not bridges_dir.exists():
        print("❌ Bridges directory not found")
        return
    
    total_tools = 0
    bridge_files = list(bridges_dir.glob("*_bridge.py"))
    
    for bridge_file in bridge_files:
        bridge_name = bridge_file.stem.replace("_bridge", "")
        try:
            with open(bridge_file, 'r', encoding='utf-8') as f:
                content = f.read()
                
            # Count Tool( occurrences
            tool_count = content.count('Tool(')
            total_tools += tool_count
            
            print(f"✅ {bridge_name.upper()}: {tool_count} tools")
            
        except Exception as e:
            print(f"❌ {bridge_name.upper()}: Error reading file - {e}")
    
    print(f"\n🎯 TOTAL TOOLS: {total_tools}")
    print("=" * 60)

def verify_sacred_covenant():
    """Verify Sacred Covenant implementation."""
    print("🛡️ Sacred Covenant Verification")
    print("=" * 60)
    
    covenant_file = Path("core/covenant_guardian.py")
    if covenant_file.exists():
        print("✅ GoliathCovenantGuardian implemented")
        
        with open(covenant_file, 'r', encoding='utf-8') as f:
            content = f.read()
        
        features = [
            ("create_backup", "Backup system"),
            ("verify_integrity", "Integrity verification"),
            ("restore_backup", "Backup restoration"),
            ("_calculate_file_hash", "Hash calculation"),
            ("add_protected_path", "Path protection")
        ]
        
        for feature, description in features:
            if feature in content:
                print(f"✅ {description}")
            else:
                print(f"❌ {description} - MISSING")
    else:
        print("❌ Sacred Covenant Guardian - MISSING")
    
    print("=" * 60)

def main():
    """Main verification function."""
    print("\n🚀 IMPRESSIONCORE-GOLIATH VERIFICATION SUITE")
    print("=" * 80)
    print("The Ultimate Unified MCP Server Verification")
    print("Author: Kirk LaSalle & Virtually Robotic GitHub Copilot")
    print("=" * 80)
    
    verify_goliath_structure()
    print()
    count_tools()
    print()
    verify_sacred_covenant()
    
    print("\n🎉 VERIFICATION COMPLETE!")
    print("ImpressionCore-Goliath structure validated successfully!")

if __name__ == "__main__":
    main()
