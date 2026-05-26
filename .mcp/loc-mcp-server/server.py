#!/usr/bin/env python3
r"""
**Created:** May-19-2026
**Author:** Prism OS Integration Team
**Tags:** #mcp #library_of_congress #loc #research #api #python
**Category:** Server
**Status:** Active

Library of Congress MCP Server for Prism OS.
Exposes robust tools for searching the LoC catalog, Chronicling America newspapers,
legislative records, and extracting structured digital artifact metadata.
"""

import json
import logging
import os
import sys
import time
import urllib.parse
from typing import Dict, List, Optional, Any, Union

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("loc-mcp-server")

try:
    from mcp.server import FastMCP
except ImportError as e:
    logger.error(f"MCP library import failed: {e}. Please install mcp package.")
    sys.exit(1)

try:
    import requests
except ImportError as e:
    logger.error(f"requests library import failed: {e}. Please install requests package.")
    sys.exit(1)

# Initialize FastMCP Server
mcp = FastMCP("Library of Congress MCP Server")

# Rate limiting safeguard
class SimpleRateLimiter:
    def __init__(self, max_calls: int = 15, period: float = 60.0):
        self.calls: List[float] = []
        self.max_calls = max_calls
        self.period = period

    def wait_if_needed(self):
        now = time.time()
        self.calls = [t for t in self.calls if now - t < self.period]
        if len(self.calls) >= self.max_calls:
            sleep_time = self.period - (now - self.calls[0])
            if sleep_time > 0:
                logger.info(f"LoC API rate limit reached. Pausing for {sleep_time:.2f}s...")
                time.sleep(sleep_time)
            self.calls = [t for t in self.calls if time.time() - t < self.period]
        self.calls.append(time.time())

limiter = SimpleRateLimiter()

HEADERS = {
    "User-Agent": "PrismOS-LoCMcpServer/1.0 (https://github.com/kirklasalle/Prism; research-automation)"
}

@mcp.tool()
def loc_search_catalog(query: str, collection: Optional[str] = None, limit: int = 10) -> str:
    """
    Search the general Library of Congress digital catalog.

    Args:
        query: Search keywords or phrases (e.g., 'Alexander Hamilton', 'civil war maps').
        collection: Optional format filter ('books', 'photos', 'maps', 'audio', 'film-and-videos', 'manuscripts', 'newspapers', 'websites').
        limit: Maximum number of results to return (default: 10, max: 50).

    Returns:
        JSON formatted string containing structured bibliographic records, permalinks, dates, and subjects.
    """
    limiter.wait_if_needed()
    limit = min(limit, 50)
    
    base_url = "https://www.loc.gov"
    if collection and collection.strip().lower() in ["books", "photos", "maps", "audio", "film-and-videos", "manuscripts", "newspapers", "websites"]:
        endpoint = f"{base_url}/{collection.strip().lower()}/"
    else:
        endpoint = f"{base_url}/search/"
        
    params = {
        "q": query,
        "fo": "json",
        "c": limit
    }
    
    try:
        logger.info(f"Querying LoC Catalog: {endpoint} with params {params}")
        resp = requests.get(endpoint, params=params, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        
        results: List[Dict[str, Any]] = []
        raw_items = data.get("results", [])
        
        for item in raw_items:
            # Skip general search interface wrappers
            if item.get("title") == "Search results":
                continue
                
            results.append({
                "title": item.get("title", "Untitled"),
                "date": item.get("date", "Unknown date"),
                "url": item.get("url", item.get("id", "")),
                "format": item.get("original_format", item.get("format", ["Unknown format"])),
                "subjects": item.get("subject", []),
                "contributors": item.get("contributor", []),
                "description": item.get("description", ["No description available"])[0] if item.get("description") else "No description available",
                "online_format": item.get("online_format", [])
            })
            
        return json.dumps({
            "query": query,
            "collection": collection or "all",
            "total_available": data.get("search", {}).get("hits", len(results)),
            "returned_count": len(results),
            "results": results[:limit],
            "status": "success"
        }, indent=2)
        
    except Exception as e:
        logger.error(f"LoC Catalog search failed: {e}")
        return json.dumps({
            "error": f"LoC search failed: {str(e)}",
            "query": query,
            "status": "error"
        }, indent=2)


@mcp.tool()
def loc_search_newspapers(terms: str, state: Optional[str] = None, year_start: Optional[int] = None, year_end: Optional[int] = None, limit: int = 10) -> str:
    """
    Search historic American newspaper pages in Chronicling America (1777-1963).

    Args:
        terms: Search keywords (e.g., 'Wright Brothers flight', 'titanic sinking').
        state: Optional US state filter (e.g., 'New York', 'Ohio', 'California').
        year_start: Optional start year (e.g., 1890).
        year_end: Optional end year (e.g., 1920).
        limit: Maximum number of newspaper snippets to return (default: 10).

    Returns:
        JSON formatted string containing historic newspaper snippets, publication dates, and OCR text links.
    """
    limiter.wait_if_needed()
    limit = min(limit, 50)
    
    endpoint = "https://chroniclingamerica.loc.gov/search/pages/results/"
    params: Dict[str, Any] = {
        "searchType": "basic",
        "terms": terms,
        "fo": "json",
        "rows": limit
    }
    
    if state:
        params["state"] = state
    if year_start:
        params["date1"] = str(year_start)
        params["dateFilterType"] = "yearRange"
    if year_end:
        params["date2"] = str(year_end)
        params["dateFilterType"] = "yearRange"
        
    try:
        logger.info(f"Querying Chronicling America: {endpoint} with params {params}")
        resp = requests.get(endpoint, params=params, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        
        results: List[Dict[str, Any]] = []
        items = data.get("items", [])
        
        for item in items:
            date_raw = item.get("date", "")
            formatted_date = f"{date_raw[:4]}-{date_raw[4:6]}-{date_raw[6:]}" if len(date_raw) == 8 else date_raw
            
            results.append({
                "title": item.get("title", "Unknown Newspaper"),
                "publication_date": formatted_date,
                "state": item.get("state", ["Unknown State"]),
                "city": item.get("city", ["Unknown City"]),
                "snippet": item.get("snippet", "").replace("<em>", "**").replace("</em>", "**"),
                "url": f"https://chroniclingamerica.loc.gov{item.get('url', '')}",
                "ocr_text_url": f"https://chroniclingamerica.loc.gov{item.get('url', '')}ocr/",
                "pdf_url": f"https://chroniclingamerica.loc.gov{item.get('url', '')}pdf/"
            })
            
        return json.dumps({
            "query": terms,
            "total_available": data.get("totalItems", len(results)),
            "returned_count": len(results),
            "results": results[:limit],
            "status": "success"
        }, indent=2)
        
    except Exception as e:
        logger.error(f"Chronicling America search failed: {e}")
        return json.dumps({
            "error": f"Chronicling America search failed: {str(e)}",
            "query": terms,
            "status": "error"
        }, indent=2)


@mcp.tool()
def loc_get_item_metadata(item_url: str) -> str:
    """
    Retrieve full structured digital metadata, high-resolution image manifests, and text for any LoC item URL.

    Args:
        item_url: Full LoC permalink or item URL (e.g., 'https://www.loc.gov/item/2021687214/' or 'https://www.loc.gov/resource/rbpe.16302500/').

    Returns:
        JSON string containing complete item metadata, image URLs, transcripts, and rights information.
    """
    limiter.wait_if_needed()
    
    # Ensure URL is properly formatted for JSON extraction
    parsed = urllib.parse.urlparse(item_url)
    if not parsed.scheme or "loc.gov" not in parsed.netloc:
        return json.dumps({"error": "Invalid URL. Must be a loc.gov item URL.", "status": "error"})
        
    query_param = "&fo=json" if parsed.query else "?fo=json"
    target_url = f"{item_url.rstrip('/')}/{query_param}"
    
    try:
        logger.info(f"Retrieving LoC item metadata: {target_url}")
        resp = requests.get(target_url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        
        item = data.get("item", data)
        resources = data.get("resources", [])
        
        extracted_media: List[Dict[str, Any]] = []
        for r in resources:
            files = r.get("files", [])
            for f_group in files:
                for file_info in f_group:
                    m_url = file_info.get("url", "")
                    if m_url and not m_url.startswith("http"):
                        m_url = f"https:{m_url}" if m_url.startswith("//") else f"https://www.loc.gov{m_url}"
                    extracted_media.append({
                        "mimetype": file_info.get("mimetype", "unknown"),
                        "size": file_info.get("size", 0),
                        "url": m_url
                    })
                    
        return json.dumps({
            "title": item.get("title", "Untitled"),
            "date": item.get("date", "Unknown date"),
            "created_published": item.get("created_published", []),
            "notes": item.get("notes", []),
            "subjects": item.get("subject", []),
            "summary": item.get("summary", "No summary available"),
            "rights_advisory": item.get("rights_advisory", "No rights advisory provided"),
            "digital_id": item.get("digital_id", []),
            "media_assets": extracted_media,
            "source_url": item_url,
            "status": "success"
        }, indent=2)
        
    except Exception as e:
        logger.error(f"LoC item metadata retrieval failed: {e}")
        return json.dumps({
            "error": f"Item metadata retrieval failed: {str(e)}",
            "url": item_url,
            "status": "error"
        }, indent=2)


@mcp.tool()
def loc_search_legislation(query: str, limit: int = 10) -> str:
    """
    Search legislative bills, resolutions, and acts in the Library of Congress catalog.

    Args:
        query: Search keywords (e.g., 'clean air act', 'space exploration').
        limit: Maximum results to return (default: 10).

    Returns:
        JSON string containing legislative bill titles, congress sessions, dates, and permalinks.
    """
    return loc_search_catalog(query=query, collection="legislation", limit=limit)


def main():
    logger.info("🏛️ Starting Library of Congress (LoC) MCP Server...")
    logger.info("Registered tools:")
    logger.info("  - loc_search_catalog: Search books, maps, photos, audio in LoC digital catalog")
    logger.info("  - loc_search_newspapers: Search historic American newspapers in Chronicling America")
    logger.info("  - loc_get_item_metadata: Retrieve full structured metadata & media links for LoC items")
    logger.info("  - loc_search_legislation: Search congressional bills and acts")
    mcp.run()

if __name__ == "__main__":
    main()
