import asyncio
import json
import sys
from pathlib import Path

# Add project path for imports
PROJECT_ROOT = Path("d:/Projects/impressioncore")
sys.path.append(str(PROJECT_ROOT / ".mcp" / "impressioncore-goliath"))

async def test_goliath_nerve_center():
    print("🧠 Testing Goliath Nerve Center (Swarm Memory & Load Balancing)...")
    
    # Import server
    from server import initialize_goliath, bridges, swarm_memory, load_balancer
    
    # Initialize
    initialize_goliath()
    
    # Test 1: Swarm Memory Synergization
    print("\n[Test 1] Testing goliath_synergize_memory...")
    goliath_bridge = bridges.get("goliath")
    
    # Simulate an IPA research finding being passed to Goliath
    finding_data = {
        "key": "thermal_bottleneck_v3",
        "value": {"threshold": 85, "unit": "Celsius", "impact": "throttling"},
        "dna": "thermal-dna-alpha-9",
        "tags": ["hardware", "stability", "1050ti"]
    }
    
    result = await goliath_bridge.execute_tool("goliath_synergize_memory", finding_data)
    print(f"Result: {result['status']}")
    assert result["status"] == "success"
    
    # Verify memory state
    state = await goliath_bridge.execute_tool("goliath_get_swarm_state", {})
    print(f"Context Tags: {state['memory']['active_context']}")
    assert "hardware" in state["memory"]["active_context"]
    assert state["memory"]["finding_count"] >= 1
    
    # Test 2: VRAM Load Balancing
    print("\n[Test 2] Testing VRAM Load Balancer...")
    metrics = state["hardware"]
    print(f"Current VRAM Usage: {metrics['vram_usage_gb']}GB")
    print(f"Status: {metrics['status']}")
    assert "vram_usage_gb" in metrics
    
    # Test 3: DNA Retrieval
    print("\n[Test 3] Testing DNA Retrieval via Swarm Memory...")
    retrieved = swarm_memory.query_by_dna("thermal-dna-alpha-9")
    print(f"Retrieved Finding: {retrieved['data'] if retrieved else 'None'}")
    assert retrieved is not None
    assert retrieved["data"]["threshold"] == 85

    print("\n✅ Goliath Nerve Center verification complete!")

if __name__ == "__main__":
    asyncio.run(test_goliath_nerve_center())
