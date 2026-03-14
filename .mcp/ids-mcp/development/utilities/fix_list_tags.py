#!/usr/bin/env python3
"""
!/usr/bin/env python3

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\utilities\fix_list_tags.py #python #source_code #testing  
**Category:** Source Code  
**Status:** Active
"""









# !/usr/bin/env python3

**Created:** 2024-10-15  
**Updated:** 2025-07-26 10:26:57  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\development\utilities\fix_list_tags.py #python #source_code #testing  
**Category:** Source Code  
**Status:** Active

"""Quick fix for the list_tags function to make it fast."""

def fix_server_list_tags():
    """Fix the list_tags function to be much faster."""
    server_file = "d:/Projects/impressioncore/.mcp/ids-mcp/server.py"
    
    # Read the current server
    with open(server_file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Find and replace the problematic list_tags function
    old_function_start = "async def ids_list_tags(self, arguments: Dict[str, Any]) -> Dict[str, Any]:"
    
    # New fast implementation
    new_function = '''async def ids_list_tags(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """List all available tags in the IDS system - FAST VERSION."""
        category = arguments.get("category", "")
        pattern = arguments.get("pattern", "")
        
        # Use reverse index for fastest lookup
        if self.reverse_index:
            all_tags = list(self.reverse_index.keys())
        else:
            all_tags = []
        
        # Quick filtering
        if category:
            all_tags = [tag for tag in all_tags if category.lower() in tag.lower()]
        if pattern:
            all_tags = [tag for tag in all_tags if pattern.lower() in tag.lower()]
        
        # Sort and limit for speed
        all_tags.sort()
        display_tags = all_tags[:50]  # Show only first 50 for speed
        
        # Simple response
        result_text = f"Found {len(all_tags)} tags"
        if len(all_tags) > 50:
            result_text += f" (showing first 50)"
        result_text += ":\\n\\n"
        
        for i, tag in enumerate(display_tags, 1):
            result_text += f"{i:2d}. {tag}\\n"
        
        return {
            "content": [{
                "type": "text", 
                "text": result_text
            }]
        }'''
    
    # Find the function start
    start_idx = content.find(old_function_start)
    if start_idx == -1:
        print("❌ Could not find function to replace")
        return False
    
    # Find the next function start to determine where this function ends
    next_function_start = content.find("async def ids_", start_idx + 1)
    if next_function_start == -1:
        # This is the last function, find the end of class
        next_function_start = content.find("\\nclass ", start_idx)
        if next_function_start == -1:
            next_function_start = len(content)
    
    # Replace the function
    new_content = content[:start_idx] + new_function + content[next_function_start:]
    
    # Write back
    with open(server_file, 'w', encoding='utf-8') as f:
        f.write(new_content)
    
    print("✅ Fixed list_tags function for better performance")
    return True

if __name__ == "__main__":
    fix_server_list_tags()
