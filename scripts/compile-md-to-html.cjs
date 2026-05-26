#!/usr/bin/env node
/**
 * scripts/compile-md-to-html.cjs
 *
 * Compiles markdown documentation into stunning, highly interactive, responsive HTML.
 * Includes a left-navigation Table of Contents (TOC), beautiful styling,
 * GitHub-style alerts, custom code cards, light/dark mode, and live Mermaid.js rendering.
 */

"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Help text
if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("PRISM Markdown to HTML Compiler");
    console.log("Usage: node scripts/compile-md-to-html.cjs <input-file.md> [output-file.html]");
    process.exit(0);
}

const inputFileArg = process.argv[2];
if (!inputFileArg) {
    console.error("Error: Input markdown file required.");
    console.error("Usage: node scripts/compile-md-to-html.cjs <input-file.md> [output-file.html]");
    process.exit(1);
}

const inputPath = path.resolve(inputFileArg);
if (!fs.existsSync(inputPath)) {
    console.error(`Error: File not found: ${inputPath}`);
    process.exit(1);
}

const outputPath = process.argv[3] 
    ? path.resolve(process.argv[3])
    : inputPath.replace(/\.md$/, ".html");

console.log(`[docs:compile] Compiling: ${path.basename(inputPath)} -> ${path.basename(outputPath)}`);

const markdownContent = fs.readFileSync(inputPath, "utf-8");
const compiledHtml = compileMarkdownToStunningHtml(markdownContent, path.basename(inputPath));
fs.writeFileSync(outputPath, compiledHtml, "utf-8");

console.log(`[docs:compile] Success! Compiled file written to: ${outputPath}`);

/**
 * Compiles a markdown string to a fully styled HTML template.
 */
function compileMarkdownToStunningHtml(md, title) {
    const lines = md.split(/\r?\n/);
    let htmlContent = "";
    
    // Parser state
    let inCodeBlock = false;
    let codeBlockLanguage = "";
    let codeBlockLines = [];
    
    let inTable = false;
    let tableHeaders = [];
    let tableRows = [];
    
    let inList = false;
    let listType = ""; // 'ul' or 'ol'
    
    let inBlockquote = false;
    let blockquoteLines = [];
    
    const tocItems = []; // { id, level, text }
    
    function closeCurrentBlocks() {
        if (inCodeBlock) {
            htmlContent += renderCodeBlock(codeBlockLines, codeBlockLanguage);
            inCodeBlock = false;
            codeBlockLines = [];
            codeBlockLanguage = "";
        }
        if (inTable) {
            htmlContent += renderTable(tableHeaders, tableRows);
            inTable = false;
            tableHeaders = [];
            tableRows = [];
        }
        if (inList) {
            htmlContent += `</${listType}>\n`;
            inList = false;
            listType = "";
        }
        if (inBlockquote) {
            htmlContent += renderBlockquote(blockquoteLines);
            inBlockquote = false;
            blockquoteLines = [];
        }
    }
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();
        
        // --- 1. Code Block Handling ---
        if (trimmedLine.startsWith("```")) {
            if (inCodeBlock) {
                // Close block
                closeCurrentBlocks();
            } else {
                // Open block
                closeCurrentBlocks();
                inCodeBlock = true;
                codeBlockLanguage = trimmedLine.slice(3).trim().toLowerCase();
            }
            continue;
        }
        
        if (inCodeBlock) {
            codeBlockLines.push(line);
            continue;
        }
        
        // --- 2. Blockquote Handling ---
        if (trimmedLine.startsWith(">")) {
            closeCurrentBlocks(); // Close others, blockquotes stand alone or wrap lists
            inBlockquote = true;
            
            // Strip leading '>' and optional space
            let content = line.substring(line.indexOf(">") + 1);
            if (content.startsWith(" ")) {
                content = content.substring(1);
            }
            blockquoteLines.push(content);
            continue;
        } else if (inBlockquote && trimmedLine !== "" && !trimmedLine.startsWith("|") && !trimmedLine.startsWith("-") && !trimmedLine.startsWith("#")) {
            // Continuation of blockquote
            blockquoteLines.push(line);
            continue;
        } else if (inBlockquote) {
            // Close blockquote
            closeCurrentBlocks();
        }
        
        // --- 3. Table Handling ---
        if (trimmedLine.startsWith("|")) {
            if (!inTable) {
                closeCurrentBlocks();
                inTable = true;
            }
            
            // Check if it is a separator line (e.g. |---|---|)
            const isSeparator = /^\|[\s-|-]*\|$/.test(trimmedLine);
            if (isSeparator) {
                // Skip separator rows
                continue;
            }
            
            const cols = parseTableCells(trimmedLine);
            if (tableHeaders.length === 0) {
                tableHeaders = cols;
            } else {
                tableRows.push(cols);
            }
            continue;
        } else if (inTable) {
            closeCurrentBlocks();
        }
        
        // --- 4. Header Handling ---
        if (trimmedLine.startsWith("#")) {
            closeCurrentBlocks();
            const match = trimmedLine.match(/^(#{1,6})\s+(.*)$/);
            if (match) {
                const level = match[1].length;
                const text = parseInlineElements(match[2]);
                const rawText = match[2].replace(/<[^>]*>/g, "").replace(/[^a-zA-Z0-9\s-]/g, "").trim();
                const id = rawText.toLowerCase().replace(/\s+/g, "-");
                
                tocItems.push({ id, level, text: rawText });
                htmlContent += `<h${level} id="${id}">${text}</h${level}>\n`;
                continue;
            }
        }
        
        // --- 5. List Handling ---
        const bulletMatch = line.match(/^(\s*)([-\*])\s+(.*)$/);
        const numberMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
        
        if (bulletMatch) {
            const level = bulletMatch[1].length;
            const content = parseInlineElements(bulletMatch[3]);
            
            if (!inList || listType !== "ul") {
                closeCurrentBlocks();
                inList = true;
                listType = "ul";
                htmlContent += `<ul class="list-level-0">\n`;
            }
            htmlContent += `  <li>${content}</li>\n`;
            continue;
        } else if (numberMatch) {
            const content = parseInlineElements(numberMatch[3]);
            
            if (!inList || listType !== "ol") {
                closeCurrentBlocks();
                inList = true;
                listType = "ol";
                htmlContent += `<ol class="list-level-0">\n`;
            }
            htmlContent += `  <li>${content}</li>\n`;
            continue;
        } else if (inList && trimmedLine === "") {
            // Blank line closes list
            closeCurrentBlocks();
            continue;
        }
        
        // --- 6. Horizontal Rule ---
        if (trimmedLine === "---" || trimmedLine === "***") {
            closeCurrentBlocks();
            htmlContent += "<hr />\n";
            continue;
        }
        
        // --- 7. Paragraph Handling (Default) ---
        if (trimmedLine !== "") {
            closeCurrentBlocks();
            const text = parseInlineElements(line);
            htmlContent += `<p>${text}</p>\n`;
        } else {
            htmlContent += "\n";
        }
    }
    
    // Close any final lingering blocks
    closeCurrentBlocks();
    
    // Build final HTML document
    return buildHtmlTemplate(htmlContent, title, tocItems);
}

/**
 * Parses markdown inline formatting: bold, italic, code, links, images.
 */
function parseInlineElements(text) {
    let result = text;
    
    // Escape HTML tags to protect code content (but keep formatting tags if we inject them later)
    result = result
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
        
    // Images: ![caption](url)
    result = result.replace(/!\[(.*?)\]\((.*?)\)/g, (match, caption, url) => {
        // Resolve absolute files or links cleanly
        let cleanUrl = url;
        if (url.startsWith("file:///")) {
            cleanUrl = url.substring(8);
        }
        return `<figure class="content-image"><img src="${cleanUrl}" alt="${caption}" /><figcaption>${caption}</figcaption></figure>`;
    });
    
    // Links: [text](url)
    result = result.replace(/\[(.*?)\]\((.*?)\)/g, (match, linkText, url) => {
        let cleanUrl = url;
        if (url.endsWith(".md")) {
            cleanUrl = url.replace(/\.md$/, ".html");
        }
        // Preserve clean file URLs if local
        if (url.startsWith("file:///")) {
            cleanUrl = url.replace(/\.md(#.*)?$/, ".html$1");
        }
        return `<a href="${cleanUrl}">${linkText}</a>`;
    });
    
    // Bold & Italic: ***text***
    result = result.replace(/\*\*\*(.*?)\*\*\*/g, "<strong><em>$1</em></strong>");
    
    // Bold: **text**
    result = result.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    
    // Italic: *text* or _text_
    result = result.replace(/\*(.*?)\*/g, "<em>$1</em>");
    result = result.replace(/_(.*?)_/g, "<em>$1</em>");
    
    // Inline code: `code`
    result = result.replace(/`(.*?)`/g, "<code>$1</code>");
    
    return result;
}

/**
 * Helper to parse markdown table cells split by '|' correctly, skipping boundary spaces.
 */
function parseTableCells(line) {
    const rawCells = line.split("|");
    // Remove first and last empty cells
    if (rawCells[0].trim() === "") rawCells.shift();
    if (rawCells[rawCells.length - 1].trim() === "") rawCells.pop();
    
    return rawCells.map(c => parseInlineElements(c.trim()));
}

/**
 * Renders a Markdown code block with nice copying mechanism and language badges.
 */
function renderCodeBlock(lines, lang) {
    const code = lines.join("\n")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
        
    const cleanLang = lang || "text";
    
    if (cleanLang === "mermaid") {
        return `<div class="mermaid">${lines.join("\n")}</div>\n`;
    }
    
    const randomId = "code-" + Math.random().toString(36).substring(2, 9);
    
    return `
<div class="code-card">
  <div class="code-card-header">
    <span class="code-card-lang">${cleanLang.toUpperCase()}</span>
    <button class="copy-btn" onclick="copyCode('${randomId}', this)">
      <svg class="copy-icon" viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
      <span>Copy</span>
    </button>
  </div>
  <pre><code id="${randomId}">${code}</code></pre>
</div>
\n`;
}

/**
 * Renders a standard styled table.
 */
function renderTable(headers, rows) {
    let html = '<div class="table-wrapper"><table>\n<thead>\n<tr>\n';
    headers.forEach(h => {
        html += `  <th>${h}</th>\n`;
    });
    html += "</tr>\n</thead>\n<tbody>\n";
    rows.forEach(row => {
        html += "<tr>\n";
        row.forEach(cell => {
            html += `  <td>${cell}</td>\n`;
        });
        html += "</tr>\n";
    });
    html += "</tbody>\n</table></div>\n";
    return html;
}

/**
 * Renders GitHub-style Alerts or regular blockquotes.
 */
function renderBlockquote(lines) {
    const firstLine = lines[0].trim();
    
    // Check for alerts: > [!NOTE], > [!IMPORTANT], > [!TIP], > [!WARNING], > [!CAUTION]
    const alertMatch = firstLine.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i);
    if (alertMatch) {
        const type = alertMatch[1].toUpperCase();
        const contentLines = lines.slice(1);
        const parsedContent = contentLines.map(l => parseInlineElements(l)).join("<br/>");
        
        let alertClass = "alert-note";
        let iconSvg = "";
        
        switch (type) {
            case "NOTE":
                alertClass = "alert-note";
                iconSvg = `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
                break;
            case "TIP":
                alertClass = "alert-tip";
                iconSvg = `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.5V19a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.5a3.374 3.374 0 0 0-.918-2.316l-.547-.547z"></path></svg>`;
                break;
            case "IMPORTANT":
                alertClass = "alert-important";
                iconSvg = `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
                break;
            case "WARNING":
                alertClass = "alert-warning";
                iconSvg = `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`;
                break;
            case "CAUTION":
                alertClass = "alert-caution";
                iconSvg = `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"></polygon><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;
                break;
        }
        
        return `
<div class="alert-box ${alertClass}">
  <div class="alert-box-header">
    ${iconSvg}
    <span>${type}</span>
  </div>
  <div class="alert-box-content">
    ${parsedContent}
  </div>
</div>
\n`;
    }
    
    // Regular blockquote
    const parsedText = lines.map(l => parseInlineElements(l)).join("<br/>");
    return `<blockquote>${parsedText}</blockquote>\n`;
}

/**
 * Builds the comprehensive HTML output with beautiful CSS, sidebar layout, Mermaid loaded via CDN,
 * and dark/light toggles.
 */
function buildHtmlTemplate(bodyHtml, title, tocItems) {
    const formattedTitle = title.replace(/\.md$/, "").replace(/_/g, " ");
    
    // Generate TOC html
    let tocHtml = `<ul class="toc-list">\n`;
    
    tocItems.forEach(item => {
        const indentClass = `toc-item-level-${item.level}`;
        tocHtml += `  <li class="toc-item ${indentClass}"><a href="#${item.id}">${item.text}</a></li>\n`;
    });
    tocHtml += `</ul>\n`;
    
    return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${formattedTitle} - PRISM Documentation</title>
  
  <!-- Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Outfit:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  
  <!-- Mermaid -->
  <script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
  
  <style>
    :root {
      /* Theme color tokens - Dark (Default) */
      --bg-primary: #0b0f19;
      --bg-secondary: #131a2b;
      --bg-tertiary: #1b263e;
      --border-color: #263554;
      --border-glow: rgba(38, 53, 84, 0.4);
      --text-primary: #f1f5f9;
      --text-secondary: #94a3b8;
      --text-muted: #64748b;
      --accent-primary: #38bdf8;
      --accent-secondary: #0ea5e9;
      --accent-glow: rgba(56, 189, 248, 0.15);
      
      --code-bg: #090d16;
      --code-text: #e2e8f0;
      
      /* Alerts color coding */
      --alert-note-bg: rgba(56, 189, 248, 0.08);
      --alert-note-border: #0ea5e9;
      --alert-tip-bg: rgba(52, 211, 153, 0.08);
      --alert-tip-border: #10b981;
      --alert-important-bg: rgba(99, 102, 241, 0.08);
      --alert-important-border: #6366f1;
      --alert-warning-bg: rgba(251, 191, 36, 0.08);
      --alert-warning-border: #f59e0b;
      --alert-caution-bg: rgba(244, 63, 94, 0.08);
      --alert-caution-border: #f43f5e;
      
      --sidebar-width: 320px;
    }
    
    [data-theme="light"] {
      /* Theme color tokens - Light */
      --bg-primary: #f8fafc;
      --bg-secondary: #ffffff;
      --bg-tertiary: #f1f5f9;
      --border-color: #cbd5e1;
      --border-glow: rgba(203, 213, 225, 0.4);
      --text-primary: #0f172a;
      --text-secondary: #475569;
      --text-muted: #64748b;
      --accent-primary: #0284c7;
      --accent-secondary: #0369a1;
      --accent-glow: rgba(2, 132, 199, 0.1);
      
      --code-bg: #0f172a;
      --code-text: #f8fafc;
      
      --alert-note-bg: rgba(14, 165, 233, 0.05);
      --alert-tip-bg: rgba(16, 185, 129, 0.05);
      --alert-important-bg: rgba(99, 102, 241, 0.05);
      --alert-warning-bg: rgba(245, 158, 11, 0.05);
      --alert-caution-bg: rgba(244, 63, 94, 0.05);
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: var(--bg-primary);
      color: var(--text-primary);
      display: flex;
      min-height: 100vh;
      overflow-x: hidden;
      line-height: 1.6;
      transition: background-color 0.3s, color 0.3s;
    }
    
    /* Layout */
    .sidebar {
      width: var(--sidebar-width);
      height: 100vh;
      position: fixed;
      left: 0;
      top: 0;
      background-color: var(--bg-secondary);
      border-right: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      z-index: 100;
      overflow-y: auto;
      transition: background-color 0.3s, border-color 0.3s;
    }
    
    .main-viewport {
      margin-left: var(--sidebar-width);
      width: calc(100% - var(--sidebar-width));
      min-height: 100vh;
      padding: 3rem 4rem;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    
    .article-container {
      width: 100%;
      max-width: 880px;
    }
    
    /* Sidebar Header & Brand */
    .sidebar-header {
      padding: 1.75rem 1.5rem;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    
    .brand-group {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    
    .brand-logo {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-weight: bold;
      font-family: 'Outfit', sans-serif;
      box-shadow: 0 0 10px rgba(56, 189, 248, 0.4);
    }
    
    .brand-title {
      font-family: 'Outfit', sans-serif;
      font-weight: 700;
      font-size: 1.25rem;
      letter-spacing: 0.5px;
      background: linear-gradient(to right, var(--text-primary), var(--text-secondary));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    
    /* Theme Toggle */
    .theme-toggle-btn {
      background: none;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      width: 34px;
      height: 34px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: var(--text-secondary);
      transition: background-color 0.2s, border-color 0.2s, color 0.2s;
    }
    
    .theme-toggle-btn:hover {
      background-color: var(--bg-tertiary);
      color: var(--accent-primary);
      border-color: var(--accent-primary);
    }
    
    .theme-toggle-btn svg {
      transition: transform 0.3s;
    }
    
    .theme-toggle-btn:hover svg {
      transform: rotate(20deg);
    }
    
    /* Sidebar Navigation Links */
    .sidebar-nav {
      padding: 1.5rem 1rem;
      flex-grow: 1;
    }
    
    .toc-title {
      font-family: 'Outfit', sans-serif;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: var(--text-muted);
      margin-bottom: 1rem;
      padding-left: 0.75rem;
    }
    
    .toc-list {
      list-style: none;
    }
    
    .toc-item {
      margin-bottom: 0.35rem;
    }
    
    .toc-item a {
      display: block;
      padding: 0.4rem 0.75rem;
      border-radius: 6px;
      color: var(--text-secondary);
      text-decoration: none;
      font-size: 0.875rem;
      transition: background-color 0.2s, color 0.2s;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    
    .toc-item a:hover {
      background-color: var(--bg-tertiary);
      color: var(--accent-primary);
    }
    
    .toc-item.active a {
      background-color: var(--accent-glow);
      color: var(--accent-primary);
      font-weight: 500;
      border-left: 2px solid var(--accent-primary);
      border-top-left-radius: 0;
      border-bottom-left-radius: 0;
    }
    
    .toc-item-level-1 { padding-left: 0; }
    .toc-item-level-2 { padding-left: 0.75rem; }
    .toc-item-level-3 { padding-left: 1.5rem; }
    .toc-item-level-4 { padding-left: 2.25rem; }
    
    /* Markdown Article Styles */
    article h1, article h2, article h3, article h4, article h5, article h6 {
      font-family: 'Outfit', sans-serif;
      font-weight: 700;
      color: var(--text-primary);
      margin-top: 2.25rem;
      margin-bottom: 1rem;
      line-height: 1.35;
    }
    
    article h1 {
      font-size: 2.5rem;
      margin-top: 0;
      margin-bottom: 1.5rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid var(--border-color);
      letter-spacing: -0.5px;
    }
    
    article h2 {
      font-size: 1.75rem;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 0.4rem;
      margin-top: 3rem;
    }
    
    article h3 { font-size: 1.35rem; }
    article h4 { font-size: 1.15rem; }
    
    article p {
      margin-bottom: 1.25rem;
      color: var(--text-secondary);
      font-size: 1rem;
    }
    
    article a {
      color: var(--accent-primary);
      text-decoration: none;
      border-bottom: 1px solid transparent;
      transition: border-bottom-color 0.2s;
    }
    
    article a:hover {
      border-bottom-color: var(--accent-primary);
    }
    
    /* Lists */
    article ul, article ol {
      margin-bottom: 1.5rem;
      padding-left: 1.5rem;
    }
    
    article li {
      margin-bottom: 0.5rem;
      color: var(--text-secondary);
    }
    
    article li strong {
      color: var(--text-primary);
    }
    
    /* Inline Code */
    article code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.85em;
      background-color: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      padding: 0.15em 0.4em;
      border-radius: 4px;
      color: var(--accent-primary);
      word-break: break-word;
    }
    
    /* Blockquotes */
    article blockquote {
      border-left: 4px solid var(--border-color);
      padding: 0.75rem 1.25rem;
      background-color: var(--bg-secondary);
      border-radius: 0 8px 8px 0;
      margin-bottom: 1.5rem;
    }
    
    article blockquote p {
      margin-bottom: 0;
      font-style: italic;
    }
    
    /* Horizontal Rule */
    article hr {
      border: 0;
      height: 1px;
      background-color: var(--border-color);
      margin: 3rem 0;
    }
    
    /* Code Cards */
    .code-card {
      background-color: var(--code-bg);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      margin-bottom: 1.75rem;
      overflow: hidden;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }
    
    .code-card-header {
      padding: 0.5rem 1rem;
      background-color: rgba(255, 255, 255, 0.02);
      border-bottom: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    
    .code-card-lang {
      font-family: 'Outfit', sans-serif;
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 1px;
      color: var(--text-muted);
    }
    
    .copy-btn {
      background: none;
      border: 1px solid var(--border-color);
      color: var(--text-muted);
      border-radius: 4px;
      padding: 0.25rem 0.5rem;
      font-size: 0.75rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.35rem;
      transition: background-color 0.2s, border-color 0.2s, color 0.2s;
    }
    
    .copy-btn:hover {
      background-color: var(--bg-tertiary);
      color: var(--accent-primary);
      border-color: var(--accent-primary);
    }
    
    .code-card pre {
      margin: 0;
      padding: 1.25rem;
      overflow-x: auto;
    }
    
    .code-card code {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.9rem;
      background: none;
      border: none;
      padding: 0;
      border-radius: 0;
      color: var(--code-text);
      word-break: normal;
      white-space: pre;
    }
    
    /* Tables */
    .table-wrapper {
      width: 100%;
      overflow-x: auto;
      border-radius: 8px;
      border: 1px solid var(--border-color);
      margin-bottom: 2rem;
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.05);
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.925rem;
      text-align: left;
    }
    
    th {
      font-family: 'Outfit', sans-serif;
      font-weight: 600;
      background-color: var(--bg-secondary);
      color: var(--text-primary);
      padding: 0.85rem 1.25rem;
      border-bottom: 2px solid var(--border-color);
    }
    
    td {
      padding: 0.85rem 1.25rem;
      border-bottom: 1px solid var(--border-color);
      color: var(--text-secondary);
      background-color: var(--bg-secondary);
      transition: background-color 0.2s;
    }
    
    tr:last-child td {
      border-bottom: none;
    }
    
    tr:hover td {
      background-color: var(--bg-tertiary);
    }
    
    /* GitHub Style Alerts */
    .alert-box {
      border-left: 4px solid var(--border-color);
      border-radius: 0 8px 8px 0;
      padding: 1rem 1.25rem;
      margin-bottom: 1.75rem;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
    }
    
    .alert-box-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-family: 'Outfit', sans-serif;
      font-weight: 700;
      font-size: 0.875rem;
      letter-spacing: 0.5px;
      margin-bottom: 0.5rem;
      text-transform: uppercase;
    }
    
    .alert-box-content {
      color: var(--text-secondary);
      font-size: 0.95rem;
      line-height: 1.5;
    }
    
    .alert-box-content a {
      font-weight: 500;
    }
    
    .alert-note {
      background-color: var(--alert-note-bg);
      border-left-color: var(--alert-note-border);
    }
    
    .alert-note .alert-box-header {
      color: var(--alert-note-border);
    }
    
    .alert-tip {
      background-color: var(--alert-tip-bg);
      border-left-color: var(--alert-tip-border);
    }
    
    .alert-tip .alert-box-header {
      color: var(--alert-tip-border);
    }
    
    .alert-important {
      background-color: var(--alert-important-bg);
      border-left-color: var(--alert-important-border);
    }
    
    .alert-important .alert-box-header {
      color: var(--alert-important-border);
    }
    
    .alert-warning {
      background-color: var(--alert-warning-bg);
      border-left-color: var(--alert-warning-border);
    }
    
    .alert-warning .alert-box-header {
      color: var(--alert-warning-border);
    }
    
    .alert-caution {
      background-color: var(--alert-caution-bg);
      border-left-color: var(--alert-caution-border);
    }
    
    .alert-caution .alert-box-header {
      color: var(--alert-caution-border);
    }
    
    /* Mermaid Diagrams Styling */
    .mermaid {
      background-color: var(--bg-secondary) !important;
      border: 1px solid var(--border-color) !important;
      border-radius: 8px;
      padding: 1.5rem;
      margin-bottom: 2rem;
      display: flex;
      justify-content: center;
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.05);
    }
    
    /* Image and Figures */
    .content-image {
      margin: 2rem 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
    }
    
    .content-image img {
      max-width: 100%;
      border-radius: 8px;
      border: 1px solid var(--border-color);
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    
    .content-image figcaption {
      font-size: 0.85rem;
      color: var(--text-muted);
      font-family: 'Outfit', sans-serif;
    }
    
    /* Responsive Design adjustments */
    @media (max-width: 1024px) {
      .sidebar {
        transform: translateX(-100%);
        transition: transform 0.3s ease;
      }
      
      .sidebar.open {
        transform: translateX(0);
      }
      
      .main-viewport {
        margin-left: 0;
        width: 100%;
        padding: 2rem 1.5rem;
      }
      
      /* Toggle Sidebar Menu trigger for mobile */
      .menu-trigger {
        display: flex;
        position: fixed;
        bottom: 1.5rem;
        right: 1.5rem;
        background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
        color: #fff;
        border: none;
        border-radius: 50%;
        width: 56px;
        height: 56px;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 15px rgba(56, 189, 248, 0.4);
        cursor: pointer;
        z-index: 1000;
      }
    }
    
    @media (min-width: 1025px) {
      .menu-trigger {
        display: none;
      }
    }
  </style>
</head>
<body>

  <!-- Menu trigger for small screens -->
  <button class="menu-trigger" onclick="toggleSidebar()">
    <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
  </button>

  <!-- Left Sidebar (TOC) -->
  <aside class="sidebar" id="sidebar">
    <div class="sidebar-header">
      <div class="brand-group">
        <div class="brand-logo">Δ</div>
        <div class="brand-title">PRISM</div>
      </div>
      <button class="theme-toggle-btn" onclick="toggleTheme()" title="Toggle Light/Dark Theme">
        <svg id="theme-icon" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <!-- Sun icon -->
          <circle cx="12" cy="12" r="5"></circle>
          <line x1="12" y1="1" x2="12" y2="3"></line>
          <line x1="12" y1="21" x2="12" y2="23"></line>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
          <line x1="1" y1="12" x2="3" y2="12"></line>
          <line x1="21" y1="12" x2="23" y2="12"></line>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
        </svg>
      </button>
    </div>
    
    <nav class="sidebar-nav">
      <div class="toc-title">Table of Contents</div>
      ${tocHtml}
    </nav>
  </aside>

  <!-- Main Viewport -->
  <main class="main-viewport">
    <div class="article-container">
      <article>
        ${bodyHtml}
      </article>
    </div>
  </main>

  <script>
    // Theme toggle logic
    function toggleTheme() {
      const html = document.documentElement;
      const currentTheme = html.getAttribute('data-theme');
      const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
      
      html.setAttribute('data-theme', newTheme);
      updateThemeIcon(newTheme);
      localStorage.setItem('prism-docs-theme', newTheme);
      
      // Re-initialize mermaid to match the new theme if needed
      if (window.mermaid) {
        mermaid.initialize({ 
          startOnLoad: true, 
          theme: newTheme === 'dark' ? 'dark' : 'default' 
        });
      }
    }
    
    function updateThemeIcon(theme) {
      const icon = document.getElementById('theme-icon');
      if (theme === 'dark') {
        icon.innerHTML = \`<circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>\`;
      } else {
        // Render moon icon
        icon.innerHTML = \`<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>\`;
      }
    }
    
    // Auto-load theme
    const savedTheme = localStorage.getItem('prism-docs-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
    
    // Initialize Mermaid
    mermaid.initialize({ 
      startOnLoad: true, 
      theme: savedTheme === 'dark' ? 'dark' : 'default',
      securityLevel: 'loose'
    });
    
    // Copy code button logic
    function copyCode(codeId, btnElement) {
      const codeElement = document.getElementById(codeId);
      if (!codeElement) return;
      
      const textArea = document.createElement("textarea");
      textArea.value = codeElement.textContent;
      document.body.appendChild(textArea);
      textArea.select();
      
      try {
        document.execCommand("copy");
        // Update button visual state
        const textSpan = btnElement.querySelector('span');
        const origText = textSpan.textContent;
        textSpan.textContent = "Copied!";
        btnElement.style.borderColor = "var(--alert-tip-border)";
        btnElement.style.color = "var(--alert-tip-border)";
        
        setTimeout(() => {
          textSpan.textContent = origText;
          btnElement.style.borderColor = "";
          btnElement.style.color = "";
        }, 2000);
      } catch (err) {
        console.error("Failed to copy code: ", err);
      }
      
      document.body.removeChild(textArea);
    }
    
    // Toggle Mobile Sidebar
    function toggleSidebar() {
      const sidebar = document.getElementById('sidebar');
      sidebar.classList.toggle('open');
    }
    
    // Active heading tracking in TOC on scroll
    window.addEventListener('DOMContentLoaded', () => {
      const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          const id = entry.target.getAttribute('id');
          if (entry.intersectionRatio > 0) {
            document.querySelectorAll('.toc-list li').forEach(li => {
              li.classList.remove('active');
            });
            const activeLi = document.querySelector(\`.toc-list li a[href="#\${id}"]\`);
            if (activeLi) {
              activeLi.parentElement.classList.add('active');
            }
          }
        });
      }, { rootMargin: '0px 0px -60% 0px' });
      
      // Track all headers
      document.querySelectorAll('article h1, article h2, article h3, article h4').forEach(header => {
        observer.observe(header);
      });
    });
  </script>
</body>
</html>
`;
}
