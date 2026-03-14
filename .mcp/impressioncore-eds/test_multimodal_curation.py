import asyncio
import sys
from pathlib import Path

# Add the server directory to sys.path
server_dir = Path(r"d:\Projects\impressioncore\.mcp\impressioncore-eds")
sys.path.append(str(server_dir))

from multimodal_curator import MultimodalCurator

async def test_curation():
    curator = MultimodalCurator(quality_threshold=0.5)
    
    mock_html = """
    <html>
        <body>
            <h1>Quantum Mechanics</h1>
            <p>Quantum mechanics is a fundamental theory in physics that describes the physical properties of nature at the scale of atoms and subatomic particles.</p>
            <figure>
                <img src="https://upload.wikimedia.org/wikipedia/commons/e/ed/Schrodinger_equation.png" alt="Schrödinger equation diagram in quantum mechanics">
                <figcaption>The Schrödinger equation</figcaption>
            </figure>
            <p>Watch this video for more details:</p>
            <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" width="560" height="315"></iframe>
            <table>
                <tr><td>Particle</td><td>Spin</td></tr>
                <tr><td>Electron</td><td>1/2</td></tr>
            </table>
        </body>
    </html>
    """
    
    print("🎨 Running Multimodal Curation Test...")
    assets = curator.extract_assets(mock_html, "https://en.wikipedia.org/wiki/Quantum_mechanics")
    
    print(f"📊 Extracted {len(assets)} assets:")
    for asset in assets:
        print(f"  - [{asset.asset_type.upper()}] {asset.title} (DNA: {asset.asset_id})")
        print(f"    Density Score: {asset.density_score}")
        print(f"    URL: {asset.url}")
        print("-" * 20)
    
    # Test batch curation
    raw_data = [
        {"content_html": mock_html, "source": "Wikipedia"}
    ]
    report = curator.curate_dataset(raw_data, "https://en.wikipedia.org")
    print("\n📈 Curation Report Summary:")
    print(f"  Asset Count: {report['asset_count']}")
    print(f"  Avg Density: {report['average_educational_density']}")
    print(f"  Multimodal Ready: {report['multimodal_ready']}")

if __name__ == "__main__":
    asyncio.run(test_curation())
