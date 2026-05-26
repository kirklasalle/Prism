// PRISM Operator Dashboard: Wiki Tab Frontend Controller
(function () {
  let documents = []; // Loaded documents registry

  // Expose methods globally for HTML bindings
  window.refreshWikiList = refreshWikiList;
  window.filterWikiDocs = filterWikiDocs;
  window.loadWikiDoc = loadWikiDoc;

  // Initialize on tab click / dashboard bootstrap
  document.addEventListener('DOMContentLoaded', () => {
    // Detect if we load directly into Wiki tab
    const activeTabButton = document.querySelector('.tab-button.active');
    if (activeTabButton && activeTabButton.dataset.tabId === 'wiki') {
      refreshWikiList();
    }
  });

  // Also hook into tab switching in dashboard-app
  const tabSection = document.getElementById('tabs');
  if (tabSection) {
    tabSection.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-button');
      if (btn && btn.dataset.tabId === 'wiki') {
        refreshWikiList();
      }
    });
  }

  /**
   * Fetches the documentation index from backend API
   */
  async function refreshWikiList() {
    const listContainer = document.getElementById('wiki-sidebar-list');
    if (listContainer) {
      listContainer.innerHTML = '<div class="muted" style="font-size: 11px; text-align: center; padding-top: 16px;">🔄 Indexing docs...</div>';
    }

    try {
      const response = await fetch('/api/wiki/docs', {
        headers: { 'Authorization': `Bearer ${getAuthToken()}` }
      });
      if (!response.ok) throw new Error('API failed to return document list');
      
      const data = await response.json();
      documents = data.documents || [];
      renderSidebarList(documents);
    } catch (err) {
      console.error('[WikiTab] Failed to fetch documents list:', err);
      if (listContainer) {
        listContainer.innerHTML = '<div class="muted" style="font-size: 11px; text-align: center; color: var(--red); padding-top: 16px;">❌ Failed to load index.</div>';
      }
    }
  }

  /**
   * Renders the sidebar document buttons
   */
  function renderSidebarList(list) {
    const listContainer = document.getElementById('wiki-sidebar-list');
    if (!listContainer) return;

    if (list.length === 0) {
      listContainer.innerHTML = '<div class="muted" style="font-size: 11px; text-align: center; padding-top: 16px;">No articles found.</div>';
      return;
    }

    listContainer.innerHTML = '';
    list.forEach(doc => {
      const btn = document.createElement('button');
      btn.className = 'tab-button';
      btn.style.width = '100%';
      btn.style.textAlign = 'left';
      btn.style.padding = '8px 10px';
      btn.style.fontSize = '12px';
      btn.style.border = 'none';
      btn.style.background = 'transparent';
      btn.style.borderRadius = '4px';
      btn.style.display = 'flex';
      btn.style.flexDirection = 'column';
      btn.style.gap = '2px';
      btn.style.cursor = 'pointer';
      btn.style.transition = 'background 0.2s';
      
      // Highlight Micro Support Desk files specially
      const isMicroDesk = doc.filename.toLowerCase().includes('micro-support') || doc.filename.toLowerCase().includes('support-desk');
      const emoji = isMicroDesk ? '🎧' : '📄';

      btn.innerHTML = `
        <div style="font-weight:600; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:flex; align-items:center; gap:6px;">
          <span>${emoji}</span> ${doc.title}
        </div>
        <div class="muted" style="font-size:10px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
          ${doc.filename}
        </div>
      `;

      btn.onclick = () => {
        // Toggle active styling
        const activeBtn = listContainer.querySelector('.tab-button-active');
        if (activeBtn) {
          activeBtn.classList.remove('tab-button-active');
          activeBtn.style.background = 'transparent';
        }
        btn.classList.add('tab-button-active');
        btn.style.background = 'rgba(105, 210, 255, 0.1)';

        loadWikiDoc(doc.filename);
      };

      listContainer.appendChild(btn);
    });
  }

  /**
   * Filters the document list on sidebar search
   */
  function filterWikiDocs(searchQuery) {
    const query = searchQuery.toLowerCase().trim();
    if (!query) {
      renderSidebarList(documents);
      return;
    }
    const filtered = documents.filter(doc => 
      doc.title.toLowerCase().includes(query) || 
      doc.filename.toLowerCase().includes(query)
    );
    renderSidebarList(filtered);
  }

  /**
   * Loads raw markdown file from backend, parses, and displays
   */
  async function loadWikiDoc(filename) {
    const viewport = document.getElementById('wiki-viewport');
    const titleHeader = document.getElementById('wiki-title');
    const metaHeader = document.getElementById('wiki-meta');

    if (viewport) {
      viewport.innerHTML = '<div class="stack" style="align-items:center; justify-content:center; padding:64px;"><div class="tab-loading muted">Reading and parsing document...</div></div>';
    }

    try {
      const response = await fetch(`/api/wiki/content?path=${encodeURIComponent(filename)}`, {
        headers: { 'Authorization': `Bearer ${getAuthToken()}` }
      });
      if (!response.ok) throw new Error('Failed to retrieve content');
      const data = await response.json();
      
      if (titleHeader) titleHeader.innerText = data.title;
      if (metaHeader) metaHeader.innerText = `Source File: docs/${data.filename} • Last Modified: ${new Date(data.mtime).toLocaleString()}`;
      
      if (viewport) {
        viewport.innerHTML = renderMarkdown(data.content);
      }
    } catch (err) {
      console.error('[WikiTab] Error loading document:', err);
      if (viewport) {
        viewport.innerHTML = '<div class="muted" style="padding:24px; color:var(--red);">❌ Failed to render document. Ensure the file exists.</div>';
      }
    }
  }

  /**
   * A premium, high-performance Markdown-to-HTML parser designed to preserve raw SVG code blocks.
   * Leverages SVG Tokenization to protect diagrams during parsing.
   */
  function renderMarkdown(md) {
    if (!md) return '';

    // Step 1: Extract and store all SVGs, so regex patterns don't mangle them
    const svgs = [];
    let processed = md.replace(/<svg[\s\S]*?<\/svg>/gi, (match) => {
      svgs.push(match);
      return `___SVG_BLOCK_PLACEHOLDER_${svgs.length - 1}___`;
    });

    const lines = processed.split('\n');
    let html = [];
    let inCodeBlock = false;
    let codeContent = [];
    let codeLanguage = '';
    let inList = false;
    let inBlockquote = false;
    let blockquoteContent = [];

    // Helper to close list block if active
    const closeListIfActive = () => {
      if (inList) {
        html.push('</ul>');
        inList = false;
      }
    };

    // Helper to close blockquote/alert blocks
    const closeBlockquoteIfActive = () => {
      if (inBlockquote) {
        html.push(renderAlertCard(blockquoteContent.join('\n')));
        blockquoteContent = [];
        inBlockquote = false;
      }
    };

    lines.forEach(line => {
      const trimmed = line.trim();

      // 1. Code Block Handler
      if (trimmed.startsWith('```')) {
        closeListIfActive();
        closeBlockquoteIfActive();
        
        if (inCodeBlock) {
          // Close block
          const escapedCode = escapeHtmlTags(codeContent.join('\n'));
          html.push(`<pre><code class="language-${codeLanguage || 'text'}">${escapedCode}</code></pre>`);
          codeContent = [];
          inCodeBlock = false;
        } else {
          // Open block
          codeLanguage = trimmed.substring(3).trim();
          inCodeBlock = true;
        }
        return;
      }

      if (inCodeBlock) {
        codeContent.push(line);
        return;
      }

      // 2. Blockquote / Alert Panel Handler
      if (line.startsWith('>')) {
        closeListIfActive();
        inBlockquote = true;
        blockquoteContent.push(line.replace(/^>\s?/, ''));
        return;
      } else {
        closeBlockquoteIfActive();
      }

      // 3. Headers Handler (# H1 -> ###### H6)
      if (trimmed.startsWith('#')) {
        closeListIfActive();
        const headerLevel = (trimmed.match(/^#+/) || [''])[0].length;
        const text = trimmed.substring(headerLevel).trim();
        const parsedText = parseInlineStyling(text);
        html.push(`<h${headerLevel} style="margin-top:20px; margin-bottom:10px; font-weight:700; color:var(--text);">${parsedText}</h${headerLevel}>`);
        return;
      }

      // 4. Horizontal Rules
      if (trimmed === '---' || trimmed === '***') {
        closeListIfActive();
        html.push('<hr style="border:none; border-top:1px solid var(--border); margin: 20px 0;">');
        return;
      }

      // 5. Unordered List Items (- or *)
      if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
        if (!inList) {
          html.push('<ul style="margin-left: 20px; margin-bottom:12px; display:flex; flex-direction:column; gap:4px;">');
          inList = true;
        }
        const text = trimmed.substring(2);
        html.push(`<li>${parseInlineStyling(text)}</li>`);
        return;
      } else if (inList) {
        closeListIfActive();
      }

      // 6. Blank Lines
      if (!trimmed) {
        html.push('<br>');
        return;
      }

      // 7. Standard Paragraphs
      html.push(`<p style="margin-bottom:12px; line-height:1.6;">${parseInlineStyling(line)}</p>`);
    });

    // Clean up trailing blocks
    closeListIfActive();
    closeBlockquoteIfActive();

    // Reconstruct parsed string
    let finalHtml = html.join('\n');

    // Step 2: Restore shielded inline SVGs perfectly
    svgs.forEach((svgCode, index) => {
      finalHtml = finalHtml.replace(`___SVG_BLOCK_PLACEHOLDER_${index}___`, svgCode);
    });

    return finalHtml;
  }

  /**
   * Helper to escape HTML tags inside code blocks
   */
  function escapeHtmlTags(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /**
   * Parses inline Markdown format variables (bold, italics, code codes)
   */
  function parseInlineStyling(text) {
    let output = text;

    // Bold text (double asterisk)
    output = output.replace(/\*\*([\s\S]*?)\*\*/g, '<strong>$1</strong>');

    // Italic text (single asterisk)
    output = output.replace(/\*([\s\S]*?)\*/g, '<em>$1</em>');

    // Inline monospace code blocks
    output = output.replace(/`([^`]+)`/g, '<code style="font-family:monospace; background:rgba(255,255,255,0.06); padding:2px 5px; border-radius:4px;">$1</code>');

    // Clickable links [name](href)
    output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, href) => {
      // Safely filter absolute visual paths to links
      const targetHref = href.startsWith('file:///') ? href : href;
      return `<a href="${targetHref}" target="_blank" style="color:var(--accent); text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${label}</a>`;
    });

    return output;
  }

  /**
   * Renders a styled alert card out of a blockquote block (supports Note, Important, Warning, etc.)
   */
  function renderAlertCard(content) {
    const trimmed = content.trim();
    let title = 'Reference Note';
    let themeColor = '#3b82f6'; // default blue
    let bg = 'rgba(59, 130, 246, 0.08)';
    let border = 'rgba(59, 130, 246, 0.2)';
    let emoji = 'ℹ️';

    let cleanContent = content;

    // Detect alerts
    if (trimmed.startsWith('[!NOTE]')) {
      title = 'System Note';
      cleanContent = trimmed.substring('[!NOTE]'.length);
      emoji = '💡';
    } else if (trimmed.startsWith('[!IMPORTANT]')) {
      title = 'Important Shield Action';
      themeColor = '#8b5cf6'; // Purple
      bg = 'rgba(139, 92, 246, 0.08)';
      border = 'rgba(139, 92, 246, 0.2)';
      cleanContent = trimmed.substring('[!IMPORTANT]'.length);
      emoji = '🛡️';
    } else if (trimmed.startsWith('[!WARNING]')) {
      title = 'Active Precaution';
      themeColor = '#f59e0b'; // Amber
      bg = 'rgba(245, 158, 11, 0.08)';
      border = 'rgba(245, 158, 11, 0.2)';
      cleanContent = trimmed.substring('[!WARNING]'.length);
      emoji = '⚠️';
    } else if (trimmed.startsWith('[!CAUTION]')) {
      title = 'Security Critical Guard';
      themeColor = '#ef4444'; // Red
      bg = 'rgba(239, 68, 68, 0.08)';
      border = 'rgba(239, 68, 68, 0.2)';
      cleanContent = trimmed.substring('[!CAUTION]'.length);
      emoji = '🚨';
    }

    return `
      <div style="border-left: 4px solid ${themeColor}; background:${bg}; border-top: 1px solid ${border}; border-right: 1px solid ${border}; border-bottom: 1px solid ${border}; border-radius: 6px; padding: 12px 16px; margin: 16px 0; font-size:12.5px; line-height:1.5; color:#e2e8f0;">
        <div style="display:flex; align-items:center; gap:6px; font-weight:700; color:var(--text); margin-bottom:4px; font-size:13px;">
          <span>${emoji}</span> ${title}
        </div>
        <div>${parseInlineStyling(cleanContent)}</div>
      </div>
    `;
  }

  /**
   * Helper to retrieve auth header
   */
  function getAuthToken() {
    const meta = document.querySelector('meta[name="prism-auth-token"]');
    return meta ? meta.getAttribute('content') : '';
  }
})();
