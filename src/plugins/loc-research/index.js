/**
 * Library of Congress (LoC) Research Plugin Adapter for Prism OS.
 *
 * Implements catalog, newspaper (Chronicling America), legislative search,
 * and high-fidelity item metadata extraction.
 */

import https from "node:https";
import urllib from "node:url";

const HEADERS = {
    "User-Agent": "PrismOS-LocResearchPlugin/1.0 (https://github.com/kirklasalle/Prism; research-automation)"
};

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers: HEADERS, timeout: 15000 }, (res) => {
            let data = "";
            res.on("data", chunk => { data += chunk; });
            res.on("end", () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (err) {
                        reject(new Error(`JSON parse error from ${url}: ${err.message}`));
                    }
                } else {
                    reject(new Error(`HTTP status ${res.statusCode} from ${url}`));
                }
            });
        });
        req.on("error", reject);
        req.on("timeout", () => { req.destroy(); reject(new Error(`Timeout fetching ${url}`)); });
    });
}

export async function loc_catalog_search(query, collection = null, limit = 10) {
    const safeLimit = Math.min(limit, 50);
    const base = "https://www.loc.gov";
    const col = collection && collection.trim() ? `/${encodeURIComponent(collection.trim().toLowerCase())}/` : "/search/";
    const targetUrl = `${base}${col}?q=${encodeURIComponent(query)}&fo=json&c=${safeLimit}`;
    
    try {
        const data = await fetchJson(targetUrl);
        const results = (data.results || [])
            .filter(item => item.title !== "Search results")
            .map(item => ({
                title: item.title || "Untitled",
                date: item.date || "Unknown date",
                url: item.url || item.id || "",
                format: item.original_format || item.format || ["Unknown format"],
                subjects: item.subject || [],
                description: item.description ? item.description[0] : "No description available",
                online_format: item.online_format || []
            }));
            
        return {
            query,
            collection: collection || "all",
            total_available: data.search?.hits ?? results.length,
            returned_count: results.length,
            results: results.slice(0, safeLimit),
            status: "success"
        };
    } catch (err) {
        return { error: err.message, query, status: "error" };
    }
}

export async function loc_newspaper_search(terms, state = null, yearStart = null, yearEnd = null, limit = 10) {
    const safeLimit = Math.min(limit, 50);
    let targetUrl = `https://chroniclingamerica.loc.gov/search/pages/results/?searchType=basic&terms=${encodeURIComponent(terms)}&fo=json&rows=${safeLimit}`;
    if (state) targetUrl += `&state=${encodeURIComponent(state)}`;
    if (yearStart) targetUrl += `&date1=${yearStart}&dateFilterType=yearRange`;
    if (yearEnd) targetUrl += `&date2=${yearEnd}&dateFilterType=yearRange`;
    
    try {
        const data = await fetchJson(targetUrl);
        const results = (data.items || []).map(item => {
            const dateRaw = item.date || "";
            const formattedDate = dateRaw.length === 8 ? `${dateRaw.slice(0,4)}-${dateRaw.slice(4,6)}-${dateRaw.slice(6,8)}` : dateRaw;
            return {
                title: item.title || "Unknown Newspaper",
                publication_date: formattedDate,
                state: item.state || ["Unknown State"],
                city: item.city || ["Unknown City"],
                snippet: (item.snippet || "").replace(/<em>/g, "**").replace(/<\/em>/g, "**"),
                url: `https://chroniclingamerica.loc.gov${item.url || ""}`,
                ocr_text_url: `https://chroniclingamerica.loc.gov${item.url || ""}ocr/`,
                pdf_url: `https://chroniclingamerica.loc.gov${item.url || ""}pdf/`
            };
        });
        
        return {
            query: terms,
            total_available: data.totalItems ?? results.length,
            returned_count: results.length,
            results: results.slice(0, safeLimit),
            status: "success"
        };
    } catch (err) {
        return { error: err.message, query: terms, status: "error" };
    }
}

export async function loc_item_metadata(itemUrl) {
    try {
        const parsed = urllib.parse(itemUrl, true);
        if (!parsed.protocol || !parsed.host?.includes("loc.gov")) {
            return { error: "Invalid URL. Must be a loc.gov item URL.", status: "error" };
        }
        delete parsed.search;
        parsed.query.fo = "json";
        const targetUrl = urllib.format(parsed);
        
        const data = await fetchJson(targetUrl);
        const item = data.item || data;
        const resources = data.resources || [];
        
        const mediaAssets = [];
        for (const r of resources) {
            for (const fGroup of r.files || []) {
                for (const fileInfo of fGroup || []) {
                    let mUrl = fileInfo.url || "";
                    if (mUrl && !mUrl.startsWith("http")) {
                        mUrl = mUrl.startsWith("//") ? `https:${mUrl}` : `https://www.loc.gov${mUrl}`;
                    }
                    mediaAssets.push({
                        mimetype: fileInfo.mimetype || "unknown",
                        size: fileInfo.size || 0,
                        url: mUrl
                    });
                }
            }
        }
        
        return {
            title: item.title || "Untitled",
            date: item.date || "Unknown date",
            created_published: item.created_published || [],
            notes: item.notes || [],
            subjects: item.subject || [],
            summary: item.summary || "No summary available",
            rights_advisory: item.rights_advisory || "No rights advisory provided",
            digital_id: item.digital_id || [],
            media_assets: mediaAssets,
            source_url: itemUrl,
            status: "success"
        };
    } catch (err) {
        return { error: err.message, url: itemUrl, status: "error" };
    }
}

export async function loc_legislation_search(query, limit = 10) {
    return loc_catalog_search(query, "legislation", limit);
}

export default {
    loc_catalog_search,
    loc_newspaper_search,
    loc_item_metadata,
    loc_legislation_search
};
