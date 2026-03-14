import asyncio
import json
import socket
from pathlib import Path

async def test_vrgc_sapr_intelligence():
    print("🛠️ Testing VRGC SAPR Intelligence (Self-Healing, Sandbox, War-Gaming)...")
    
    # Mocking the MCP message format
    def make_request(method, params):
        return json.dumps({"jsonrpc": "2.0", "method": method, "params": params, "id": 1}) + "\n"

    # We'll run a quick internal check for the new tools
    # Since the server is usually run as a persistent process, we will verify via direct call simulation
    # if it were running on a socket or via local import for verification.
    
    # For this verification, we will create a standalone script that imports the server logic
    # and calls the methods directly to ensure they return the expected SAPR structures.
    
    from server_enhanced import VRGCEnhancedWebMCPServer
    
    async with VRGCEnhancedWebMCPServer() as server:
        # Test 1: Self-Healing
        print("\n[Test 1] Testing vrgc_self_heal_code...")
        # Create a dummy file to analyze
        dummy_file = Path("dummy_bottleneck.py")
        dummy_file.write_text("for i in range(1000):\n    batch = load_giant_dataset()\n    process(batch)")
        
        heal_result = await server.call_tool("vrgc_self_heal_code", {"file_path": str(dummy_file)})
        print(f"Result: {heal_result['status']}")
        assert heal_result["status"] == "healed_draft"
        assert "bottleneck_identified" in heal_result
        
        # Test 2: Sandbox
        print("\n[Test 2] Testing vrgc_sandbox_execute...")
        sandbox_result = await server.call_tool("vrgc_sandbox_execute", {"command": "python --version"})
        print(f"Result: {sandbox_result['status']}")
        assert sandbox_result["status"] == "success"
        assert "metrics" in sandbox_result
        
        # Test 3: War-Gaming
        print("\n[Test 3] Testing vrgc_war_game_refactor...")
        war_result = await server.call_tool("vrgc_war_game_refactor", {"file_path": str(dummy_file)})
        print(f"Result: {war_result['status']}")
        assert war_result["status"] == "victory"
        assert war_result["winner"] == "Refactored_Candidate_B"
        
        # Cleanup
        if dummy_file.exists():
            dummy_file.unlink()
            
    print("\n✅ All VRGC SAPR Intelligence tests passed!")

if __name__ == "__main__":
    import sys
    # Ensure the script can find the server
    sys.path.append(str(Path(__file__).parent))
    asyncio.run(test_vrgc_sapr_intelligence())
