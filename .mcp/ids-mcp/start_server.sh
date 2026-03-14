#!/bin/bash
# IDS MCP Server Startup Script
# Activates environment and starts the server

echo "🚀 Starting IDS MCP Server..."
echo "=" * 50

# Check if we're in the right directory
if [ ! -f "server.py" ]; then
    echo "❌ Error: server.py not found. Are you in the right directory?"
    echo "Expected: .mcp/ids-mcp/"
    exit 1
fi

# Check if Python environment is available
if [ -d "../../.venv310" ]; then
    echo "🐍 Activating Python environment..."
    source ../../.venv310/bin/activate
else
    echo "⚠️  Warning: Python virtual environment not found at ../../.venv310"
    echo "Using system Python..."
fi

# Check dependencies
echo "📦 Checking dependencies..."
python -c "import yaml, rich" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "❌ Missing dependencies. Installing..."
    pip install -r requirements.txt
fi

# Set up environment
export PYTHONPATH="../../:$PYTHONPATH"

echo "🔍 IDS System Check..."
python -c "
import sys
sys.path.insert(0, '../..')
try:
    from docs.enhanced_ids import EnhancedIDS
    print('✅ Enhanced IDS available')
except ImportError as e:
    print(f'⚠️  Enhanced IDS not available: {e}')

try:
    import yaml
    with open('../../docs/unified_tags_index.yaml', 'r') as f:
        data = yaml.safe_load(f)
    print(f'✅ Index loaded: {len(data)} files')
except Exception as e:
    print(f'⚠️  Index issue: {e}')
"

echo ""
echo "🌟 Starting IDS MCP Server..."
echo "Server logs will be written to: ids_mcp.log"
echo "Use Ctrl+C to stop the server"
echo ""

# Start the server
python server.py
