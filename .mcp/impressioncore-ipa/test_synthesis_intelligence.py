import asyncio
import sys
from pathlib import Path

# Add the server directory to sys.path
server_dir = Path(r"d:\Projects\impressioncore\.mcp\impressioncore-ipa")
sys.path.append(str(server_dir))

# Mock IDs path for import
ids_path = Path(r"d:\Projects\impressioncore\.mcp\ids-mcp")
if str(ids_path) not in sys.path:
    sys.path.append(str(ids_path))

from server_ultimate import ImpressionCoreIPAUltimate

async def test_synthesis():
    ipa = ImpressionCoreIPAUltimate()
    
    print("🕸️ Running Synthesis-First Research Test...")
    # Test with a query that should match IDS entries (e.g., 'ImpressionCore')
    result = await ipa.ultimate_research(
        query="ImpressionCore B1 Architecture",
        methodology="synthesis_first",
        depth_level=2
    )
    
    print(f"📊 Methodology: {result['methodology_used']}")
    print(f"🧬 Graph Anchors Found: {len(result['graph_anchors'])}")
    for anchor in result['graph_anchors'][:5]:
        print(f"  - {anchor}")
        
    print("\n🔍 Research Findings with DNA Lineage:")
    findings = result['deep_analysis']['primary_findings']
    for finding in findings[:3]:
        print(f"  - Title: {finding['title']}")
        print(f"    DNA Lineage: {finding.get('dna_lineage', 'N/A')}")
        print("-" * 20)
    
    print(f"\n✅ Processing Time: {result['processing_time_ms']:.2f}ms")

if __name__ == "__main__":
    asyncio.run(test_synthesis())
