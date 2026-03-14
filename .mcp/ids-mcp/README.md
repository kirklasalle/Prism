# ImpressionCore IDS MCP Server

**Created:** October-15-2024  
**Updated:** August-04-2025  
**Author:** ImpressionCore Team  
**Tags:** #.mcp\ids_mcp\readme.md #api #command_line #documentation #memory_management #security #testing  
**Category:** Documentation  
**Status:** Active

Production-ready Model Context Protocol server for accessing ImpressionCore Documentation System.

## Quick Start

### Prerequisites
- Python 3.8+
- VS Code with MCP support

### Installation

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Configure VS Code settings:
```json
{
  "mcp.servers": {
    "impressioncore-ids": {
      "command": "python",
      "args": ["path/to/server.py"],
      "cwd": "/path/to/.mcp/ids-mcp"
    }
  }
}
```

3. Restart VS Code

## Server Files

- `server.py` - Production MCP server (auto-recovery enabled)
- `config.json` - Server configuration
- `requirements.txt` - Python dependencies

## Development

Development files are organized in subdirectories:
- `development/servers/` - Server version archive
- `development/tests/` - Test suite
- `development/utilities/` - Utility scripts
- `logs/` - Server logs and debugging output

## Documentation

Complete documentation has been moved to the main docs directory:
- **User Guide**: `docs/reference/mcp_server/mcp_server_user_guide.md`
- **Developer Guide**: `docs/reference/mcp_server/mcp_server_developer_guide.md`
- **Tool Reference**: `docs/reference/mcp_server/mcp_server_tool_reference.md`

## Features

- 5 core tools for documentation search and management
- Auto-recovery from search failures
- Enhanced error logging and debugging
- Real-time index updates
- VS Code integration ready

## Support

See troubleshooting guide: `docs/reference/mcp_server/mcp_server_troubleshooting.md`
   ```bash
   python -c "import yaml; print('Config OK')"
   ```

## Usage

### Starting the Server

#### Standalone Mode
```bash
python server.py
```

#### MCP Client Integration
The server implements the MCP protocol and can be integrated with any MCP-compatible client:

```json
{
  "mcpServers": {
    "ids-mcp": {
      "command": "python",
      "args": ["D:/Projects/impressioncore/.mcp/ids-mcp/server.py"],
      "cwd": "D:/Projects/impressioncore/.mcp/ids-mcp"
    }
  }
}
```

### Available Tools

#### 1. `ids_search`
Search through ImpressionCore documentation using the IDS tagging system.

**Parameters**:
- `query` (required): Search query string
- `tags` (optional): Array of tags to filter results
- `max_results` (optional): Maximum number of results (default: 10)

**Example**:
```json
{
  "name": "ids_search",
  "arguments": {
    "query": "authentication security",
    "tags": ["security", "api"],
    "max_results": 5
  }
}
```

#### 2. `ids_get_file_info`
Get detailed information about a specific file.

**Parameters**:
- `file_path` (required): Path to the file

**Example**:
```json
{
  "name": "ids_get_file_info",
  "arguments": {
    "file_path": "docs/api/complete_api_reference_v2.md"
  }
}
```

#### 3. `ids_list_tags`
List all available tags in the IDS system.

**Parameters**:
- `category` (optional): Category to filter tags
- `pattern` (optional): Pattern to match tag names

**Example**:
```json
{
  "name": "ids_list_tags",
  "arguments": {
    "category": "security",
    "pattern": "auth"
  }
}
```

#### 4. `ids_get_system_status`
Get current status and statistics of the IDS system.

**Example**:
```json
{
  "name": "ids_get_system_status",
  "arguments": {}
}
```

#### 5. `ids_find_by_tag`
Find all files associated with specific tags.

**Parameters**:
- `tags` (required): Array of tags to search for
- `match_all` (optional): Whether to match all tags (AND) or any tag (OR)

**Example**:
```json
{
  "name": "ids_find_by_tag",
  "arguments": {
    "tags": ["architecture", "core"],
    "match_all": true
  }
}
```

## Configuration

The server uses `config.json` for configuration:

```json
{
  "server": {
    "name": "ids-mcp-server",
    "version": "1.0.0"
  },
  "ids": {
    "project_root": "../..",
    "docs_root": "../../docs"
  },
  "search": {
    "default_max_results": 10,
    "max_max_results": 100
  }
}
```

### Key Configuration Options

- **`ids.project_root`**: Path to ImpressionCore project root
- **`ids.docs_root`**: Path to documentation directory
- **`search.default_max_results`**: Default maximum search results
- **`logging.level`**: Logging verbosity level

## System Integration

### IDS System Dependencies

The MCP server integrates with the main IDS system:

- **Enhanced IDS**: Uses `docs/enhanced_ids.py` when available
- **Unified Index**: Reads from `docs/unified_tags_index.yaml`
- **File Metadata**: Accesses `docs/file_metadata.yaml`
- **Reverse Index**: Utilizes `docs/reverse_tag_index.yaml`

### File Structure
```
.mcp/ids-mcp/
├── server.py              # Main MCP server implementation
├── config.json           # Server configuration
├── requirements.txt      # Python dependencies
├── README.md             # This file
├── ids_mcp.log           # Server logs
└── examples/             # Usage examples
    ├── basic_search.py
    ├── tag_discovery.py
    └── integration_test.py
```

## Development

### Project Structure and Development Workflow

The IDS MCP Server follows a modular architecture designed for maintainability and extensibility:

```
.mcp/ids-mcp/
├── server.py                     # Main MCP server (750+ lines)
├── config.json                   # Runtime configuration
├── DEVELOPER_GUIDE.md            # Comprehensive dev documentation
├── examples/                     # Usage examples
├── test_*.py                     # Test suites
└── comprehensive_demo.py         # Complete demonstration
```

### Testing Framework

#### 1. **MCP Protocol Compliance**
```bash
# Test core MCP protocol implementation
python test_mcp_protocol.py
```

**Sample Output**:
```
✅ MCP Protocol Compliance Test Results:
┌─────────────────────────────────────────┬────────┐
│ Test Case                               │ Status │
├─────────────────────────────────────────┼────────┤
│ Initialize handshake                    │ PASS   │
│ Tools list (5 tools returned)          │ PASS   │
│ Tool execution (all 5 tools)           │ PASS   │
│ Error handling                          │ PASS   │
│ Parameter validation                    │ PASS   │
└─────────────────────────────────────────┴────────┘
```

#### 2. **VS Code Integration Testing**
```bash
# Simulate VS Code MCP client behavior
python test_vscode_integration.py
```

**Expected Results**:
```
🔧 VS Code Integration Test Results:
────────────────────────────────────────────

✅ Server startup: SUCCESS
✅ Tool listing: 5 tools available
✅ Search functionality: 15 results returned
✅ File info retrieval: Complete metadata
✅ Tag listing: 2,900+ tags available
✅ System status: All systems operational
✅ Tag-based search: Filtered results
✅ Error handling: Graceful degradation

📊 Performance Metrics:
- Average response time: 45ms
- Memory usage: 52MB
- Index load time: 1.2s
```

#### 3. **Comprehensive Demonstration**
```bash
# Run complete demonstration of all 5 tools
python comprehensive_demo.py
```

This script exercises every tool with real examples and produces detailed output showing:
- Document search with various parameters
- File metadata retrieval
- Tag listing and filtering
- System status monitoring
- Tag-based file discovery

### Development Examples

#### Adding New Tools

1. **Define the tool** in `handle_list_tools()`:
   ```python
   {
       "name": "ids_analyze_content",
       "description": "Analyze content structure and quality",
       "inputSchema": {
           "type": "object",
           "properties": {
               "file_path": {"type": "string"},
               "analysis_type": {"type": "string", "enum": ["structure", "quality", "metrics"]}
           },
           "required": ["file_path"]
       }
   }
   ```

2. **Implement the handler** in `handle_call_tool()`:
   ```python
   elif name == "ids_analyze_content":
       return await self.handle_content_analysis(arguments)
   ```

3. **Create the handler method**:
   ```python
   async def handle_content_analysis(self, arguments: Dict[str, Any]) -> Dict[str, Any]:
       """Analyze content structure and quality metrics"""
       try:
           file_path = arguments.get("file_path")
           analysis_type = arguments.get("analysis_type", "structure")
           
           # Validate file exists and is accessible
           if not self.safe_file_access(file_path):
               raise ValueError(f"File not accessible: {file_path}")
           
           # Perform analysis
           analysis_result = self.analyze_file_content(file_path, analysis_type)
           
           return {
               "content": [{
                   "type": "text",
                   "text": self.format_analysis_result(analysis_result)
               }],
               "isError": False
           }
       except Exception as e:
           logger.error(f"Content analysis error: {e}")
           return self.error_response(f"Analysis failed: {str(e)}")
   ```

#### Testing New Tools

```python
# Add to test suite
async def test_new_tool():
    """Test content analysis tool"""
    server = IDSMCPServer()
    
    # Test valid file analysis
    result = await server.handle_call_tool({
        "name": "ids_analyze_content",
        "arguments": {
            "file_path": "docs/api/complete_api_reference_v2.md",
            "analysis_type": "structure"
        }
    })
    
    assert not result["isError"]
    assert "structure analysis" in result["content"][0]["text"].lower()
    
    # Test error conditions
    error_result = await server.handle_call_tool({
        "name": "ids_analyze_content",
        "arguments": {
            "file_path": "nonexistent/file.md"
        }
    })
    
    assert error_result["isError"]
```

### Debugging and Diagnostics

#### Enable Debug Logging
```bash
# Windows
set LOG_LEVEL=DEBUG
python server.py

# Unix/Linux
export LOG_LEVEL=DEBUG
python server.py
```

#### System Diagnostics
```bash
# Run system check script
python check_system.py
```

**Diagnostic Output**:
```
🔍 IDS MCP Server System Check
════════════════════════════════

✅ Python version: 3.10.12 (compatible)
✅ Dependencies: All packages installed
✅ Config files: Valid configuration
✅ IDS indices: 1,667 files indexed
✅ Permissions: Read/write access OK
✅ Memory: 52MB available

🚀 System ready for operation
```

#### Performance Monitoring
```python
# Built-in performance metrics
import time
import psutil

class PerformanceMonitor:
    def __init__(self):
        self.request_times = []
        self.memory_usage = []
        
    def log_request(self, start_time, end_time):
        duration = end_time - start_time
        self.request_times.append(duration)
        
        memory = psutil.virtual_memory().used / 1024 / 1024  # MB
        self.memory_usage.append(memory)
        
    def get_stats(self):
        if not self.request_times:
            return "No requests processed"
            
        avg_time = sum(self.request_times) / len(self.request_times)
        avg_memory = sum(self.memory_usage) / len(self.memory_usage)
        
        return f"Avg response: {avg_time:.2f}s, Avg memory: {avg_memory:.1f}MB"
```

### Integration Testing

#### VS Code Simulation
```python
# test_vscode_simulation.py - Complete VS Code workflow test
async def test_complete_vscode_workflow():
    """Simulate complete VS Code user session"""
    
    # 1. User opens VS Code with MCP extension
    server = await initialize_server()
    
    # 2. User searches for documentation
    search_result = await simulate_search("authentication security")
    assert len(search_result["matches"]) > 0
    
    # 3. User explores a specific file
    file_info = await simulate_file_info(search_result["matches"][0]["path"])
    assert file_info["tags"] is not None
    
    # 4. User discovers related content via tags
    related_files = await simulate_tag_search(file_info["tags"][:2])
    assert len(related_files) > 0
    
    # 5. User checks system status
    status = await simulate_status_check()
    assert status["health_status"] == "OPERATIONAL"
    
    print("✅ Complete VS Code workflow simulation passed")
```

## Performance

### Current Metrics
- **Index Size**: 1,667 files indexed
- **Tag Count**: 2,900+ unique tags
- **Search Speed**: < 100ms for typical queries
- **Memory Usage**: ~50MB base memory footprint

### Optimization Tips
- Use specific tags to filter large result sets
- Limit `max_results` for faster responses
- Cache frequently accessed file metadata

## Troubleshooting

### Common Issues

#### 1. "Enhanced IDS not available"
- Ensure `docs/enhanced_ids.py` exists and is importable
- Check Python path includes project root
- Verify all dependencies are installed

#### 2. "Index files not found"
- Confirm IDS indices exist in `docs/` directory
- Run IDS system to regenerate indices if needed
- Check file permissions

#### 3. "Import errors"
- Verify virtual environment is activated
- Install missing dependencies: `pip install -r requirements.txt`
- Check Python version compatibility (3.8+)

### Log Analysis

Check `ids_mcp.log` for detailed error information:
```bash
tail -f ids_mcp.log
```

## API Reference

### Response Format

All tools return responses in MCP format:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Response content here"
    }
  ],
  "isError": false
}
```

### Error Handling

Errors are returned with `isError: true`:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Error description"
    }
  ],
  "isError": true
}
```

## License

This MCP server is part of the ImpressionCore project and follows the same licensing terms.

## Changelog

### v1.0.0 (2025-06-05)
- Initial release
- Full IDS integration
- Five core tools implemented
- MCP protocol compliance
- Rich console support
- Comprehensive documentation

---

**Generated**: 2025-06-05  
**Version**: 1.0.0  
**Author**: ImpressionCore IDS Team

## 🚀 Quick Start

### One-Command Setup
```bash
# Unix/Linux/Mac
./quick_start.sh

# Windows
quick_start.bat
```

### Essential Commands
```bash
# Health check
python health_check.py

# Performance monitoring
python performance_monitor.py

# Complete demonstration
python comprehensive_demo.py

# VS Code integration test
python test_vscode_integration.py
```

## 🔧 Maintenance and Monitoring

### Health Monitoring
- **Health Check**: `health_check.py` - Validates server and tool functionality
- **Performance Monitor**: `performance_monitor.py` - Tracks response times and resource usage
- **System Status**: Built-in tool provides real-time statistics

### Log Files
- **Server Logs**: Check terminal output during operation
- **Performance Metrics**: `performance_metrics.json`
- **Health Reports**: `health_report.json`

### Troubleshooting Quick Reference
1. **Server won't start**: Run `python check_system.py`
2. **Tools not working**: Run `python test_mcp_protocol.py`
3. **VS Code integration issues**: See `vscode_troubleshooting.md`
4. **Performance problems**: Run `python performance_monitor.py`

## 📊 System Statistics (Live)
- **Files Indexed**: 1,667
- **Metadata Records**: 1,690
- **Tags Available**: 2,462
- **Success Rate**: 100% (All tools working)
- **Last Verified**: 2025-06-05

---
