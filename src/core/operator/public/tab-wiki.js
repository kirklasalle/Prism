// PRISM Operator Dashboard: Wiki Tab Frontend Controller
(function () {
  let documents = []; // Loaded documents registry
  let currentSearchQuery = '';
  let collapsedCategories = {};
  try {
    collapsedCategories = JSON.parse(localStorage.getItem('wiki_collapsed_categories') || '{}');
  } catch (e) {
    collapsedCategories = {};
  }

  // Expose methods globally for HTML bindings
  window.refreshWikiList = refreshWikiList;
  window.filterWikiDocs = filterWikiDocs;
  window.handleWikiFilterSortChange = handleWikiFilterSortChange;
  window.loadWikiDoc = loadWikiDoc;
  window.expandAllWikiCategories = expandAllWikiCategories;
  window.collapseAllWikiCategories = collapseAllWikiCategories;
  window.toggleWikiSidebarDrawer = toggleWikiSidebarDrawer;

  // Initialize on tab click / dashboard bootstrap
  document.addEventListener('DOMContentLoaded', () => {
    // Detect if we load directly into Wiki tab
    const activeTabButton = document.querySelector('.tab-button.active');
    if (activeTabButton && activeTabButton.dataset.tabId === 'wiki') {
      refreshWikiList();
    }
    
    // Wire premium draggable divider resizing
    initSidebarResizer();

    // Attach premium keyboard navigation traversal listener
    document.addEventListener('keydown', handleWikiKeyboardNav);
  });

  // Also hook into tab switching in dashboard-app
  const tabSection = document.getElementById('tabs');
  if (tabSection) {
    tabSection.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-button');
      if (btn && btn.dataset.tabId === 'wiki') {
        refreshWikiList();
        setTimeout(initSidebarResizer, 50); // Ensure elements are mounted
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
      applyFiltersAndSort();
    } catch (err) {
      console.error('[WikiTab] Failed to fetch documents list:', err);
      if (listContainer) {
        listContainer.innerHTML = '<div class="muted" style="font-size: 11px; text-align: center; color: var(--red); padding-top: 16px;">❌ Failed to load index.</div>';
      }
    }
  }

  /**
   * Triggers sorting and filtering update when dropdown options change
   */
  function handleWikiFilterSortChange() {
    applyFiltersAndSort();
  }

  /**
   * Updates currentSearchQuery and applies filters
   */
  function filterWikiDocs(searchQuery) {
    currentSearchQuery = searchQuery;
    applyFiltersAndSort();
  }

  /**
   * Applies active search, sorting, and type filters, then categorizes the results
   */
  function applyFiltersAndSort() {
    const sortVal = document.getElementById('wiki-sort')?.value || 'title-asc';
    const filterVal = document.getElementById('wiki-filter-type')?.value || 'all';
    
    // 1. Search query filter
    let filtered = documents;
    if (currentSearchQuery.trim()) {
      const q = currentSearchQuery.toLowerCase().trim();
      filtered = documents.filter(doc => 
        doc.title.toLowerCase().includes(q) || 
        doc.filename.toLowerCase().includes(q)
      );
    }

    // 2. Separate into Guides & FAQ (Pinned) and Remaining
    const pinned = [];
    const remaining = [];

    filtered.forEach(doc => {
      const isGuideOrFaq = doc.filename.toLowerCase().includes('guide') || 
                           doc.filename.toLowerCase() === 'prism_faq.md' ||
                           doc.title.toLowerCase().includes('guide') ||
                           doc.title.toLowerCase().includes('faq');
      if (isGuideOrFaq) {
        pinned.push(doc);
      } else {
        remaining.push(doc);
      }
    });

    // 3. Sort Pinned items by title alphabetically (A-Z)
    pinned.sort((a, b) => a.title.localeCompare(b.title));

    // 4. Sort Remaining items based on user selection
    if (sortVal === 'title-asc') {
      remaining.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortVal === 'title-desc') {
      remaining.sort((a, b) => b.title.localeCompare(a.title));
    } else if (sortVal === 'date-desc') {
      remaining.sort((a, b) => b.mtime - a.mtime);
    } else if (sortVal === 'date-asc') {
      remaining.sort((a, b) => a.mtime - b.mtime);
    }

    // 5. Group Remaining items by Type
    const categorized = {
      runbook: [],
      policy: [],
      spec: [],
      plan: [],
      other: []
    };

    remaining.forEach(doc => {
      const filename = doc.filename.toLowerCase();
      const title = doc.title.toLowerCase();

      if (filename.includes('runbook')) {
        categorized.runbook.push(doc);
      } else if (filename.includes('policy')) {
        categorized.policy.push(doc);
      } else if (filename.includes('spec') || filename.includes('design') || filename.includes('schema')) {
        categorized.spec.push(doc);
      } else if (filename.includes('plan') || filename.includes('manifest') || filename.includes('roadmap')) {
        categorized.plan.push(doc);
      } else {
        categorized.other.push(doc);
      }
    });

    // 6. Render sidebar list container
    const listContainer = document.getElementById('wiki-sidebar-list');
    if (!listContainer) return;

    if (pinned.length === 0 && remaining.length === 0) {
      listContainer.innerHTML = '<div class="muted" style="font-size: 11px; text-align: center; padding-top: 16px;">No articles found.</div>';
      return;
    }

    listContainer.innerHTML = '';

    // Always render Pinned section first if there are matching items
    if (pinned.length > 0) {
      renderCategorySection(listContainer, 'pinned', '⭐ Guides & FAQ', pinned);
    }

    // Render remaining categorized sections (respecting type filters)
    const categoryConfigs = [
      { key: 'runbook', label: '🚨 Runbooks & SRE', data: categorized.runbook },
      { key: 'policy', label: '📋 System Policies', data: categorized.policy },
      { key: 'spec', label: '⚙️ Specs & Designs', data: categorized.spec },
      { key: 'plan', label: '📅 Plans & Roadmaps', data: categorized.plan },
      { key: 'other', label: '📄 Reference & Others', data: categorized.other }
    ];

    categoryConfigs.forEach(cfg => {
      if (filterVal === 'all' || filterVal === cfg.key) {
        if (cfg.data.length > 0) {
          renderCategorySection(listContainer, cfg.key, cfg.label, cfg.data);
        }
      }
    });
  }

  /**
   * Helper to render a collapsible tree section
   */
  function renderCategorySection(container, key, title, items) {
    const sectionWrapper = document.createElement('div');
    sectionWrapper.style.display = 'flex';
    sectionWrapper.style.flexDirection = 'column';
    sectionWrapper.style.marginBottom = '6px';
    sectionWrapper.style.width = '100%';
    sectionWrapper.style.flex = 'none';
    sectionWrapper.style.height = 'auto';

    // Detect search mode auto-expansion (ignore collapse state when searching)
    const isSearching = currentSearchQuery.trim().length > 0;
    const isCollapsed = !isSearching && collapsedCategories[key];
    // Clickable header panel
    const header = document.createElement('div');
    header.className = 'wiki-tree-row';
    header.tabIndex = 0;
    header.dataset.type = 'category';
    header.dataset.key = key;
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'space-between';
    header.style.cursor = 'pointer';
    header.style.padding = '6px 8px';
    header.style.borderRadius = '6px';
    header.style.userSelect = 'none';
    header.style.transition = 'background 0.2s';
    header.style.background = 'transparent';

    header.onmouseenter = () => {
      header.style.background = 'rgba(255, 255, 255, 0.05)';
    };
    header.onmouseleave = () => {
      header.style.background = 'transparent';
    };

    // Label with matching article count
    const labelContainer = document.createElement('div');
    labelContainer.style.display = 'flex';
    labelContainer.style.alignItems = 'center';
    labelContainer.style.gap = '6px';

    const titleEl = document.createElement('span');
    titleEl.style.fontSize = '9.5px';
    titleEl.style.fontWeight = '800';
    titleEl.style.textTransform = 'uppercase';
    titleEl.style.color = 'var(--accent)';
    titleEl.style.letterSpacing = '0.5px';
    titleEl.textContent = title;

    const countEl = document.createElement('span');
    countEl.style.fontSize = '9px';
    countEl.style.color = 'var(--text-muted)';
    countEl.style.opacity = '0.65';
    countEl.textContent = `(${items.length})`;

    labelContainer.appendChild(titleEl);
    labelContainer.appendChild(countEl);

    // Chevron rotation
    const chevron = document.createElement('span');
    chevron.style.fontSize = '8px';
    chevron.style.color = 'var(--text-muted)';
    chevron.style.transition = 'transform 0.2s';
    chevron.textContent = '▼';
    if (isCollapsed) {
      chevron.style.transform = 'rotate(-90deg)';
    }

    header.appendChild(labelContainer);
    header.appendChild(chevron);
    sectionWrapper.appendChild(header);

    // Items wrapper
    const itemsWrapper = document.createElement('div');
    itemsWrapper.style.display = isCollapsed ? 'none' : 'flex';
    itemsWrapper.style.flexDirection = 'column';
    itemsWrapper.style.gap = '2px';
    itemsWrapper.style.paddingLeft = '8px';
    itemsWrapper.style.marginTop = '4px';
    itemsWrapper.style.flex = 'none';
    itemsWrapper.style.height = 'auto';

    // Click handler to toggle section smoothly
    header.onclick = () => {
      if (isSearching) return; // Search forces all open
      const currentlyCollapsed = collapsedCategories[key];
      if (currentlyCollapsed) {
        delete collapsedCategories[key];
        chevron.style.transform = 'rotate(0deg)';
        itemsWrapper.style.display = 'flex';
      } else {
        collapsedCategories[key] = true;
        chevron.style.transform = 'rotate(-90deg)';
        itemsWrapper.style.display = 'none';
      }
      localStorage.setItem('wiki_collapsed_categories', JSON.stringify(collapsedCategories));
    };

    // Render tree node buttons
    items.forEach(doc => {
      const btn = document.createElement('button');
      btn.className = 'tab-button wiki-tree-row';
      btn.tabIndex = 0;
      btn.dataset.type = 'document';
      btn.dataset.filename = doc.filename;
      btn.style.width = '100%';
      btn.style.textAlign = 'left';
      btn.style.alignItems = 'flex-start'; // Perfect left-justification
      btn.style.padding = '6px 8px';
      btn.style.fontSize = '11.5px';
      btn.style.border = 'none';
      btn.style.background = 'transparent';
      btn.style.borderRadius = '4px';
      btn.style.display = 'flex';
      btn.style.flexDirection = 'column';
      btn.style.gap = '1px';
      btn.style.cursor = 'pointer';
      btn.style.transition = 'background 0.2s';
      btn.style.marginBottom = '2px';
      btn.style.flex = 'none';
      btn.style.height = 'auto';
      btn.style.minHeight = 'unset';
      
      const isMicroDesk = doc.filename.toLowerCase().includes('micro-support') || doc.filename.toLowerCase().includes('support-desk');
      const emoji = isMicroDesk ? '🎧' : '📄';

      btn.innerHTML = `
        <div style="font-weight:600; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; display:flex; align-items:center; gap:5px; text-align:left; width:100%;">
          <span>${emoji}</span> ${doc.title}
        </div>
        <div class="muted" style="font-size:9.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; padding-left:16px; text-align:left; width:100%;">
          ${doc.filename}
        </div>
      `;

      btn.onclick = () => {
        const activeBtn = container.querySelector('.tab-button-active');
        if (activeBtn) {
          activeBtn.classList.remove('tab-button-active');
          activeBtn.style.background = 'transparent';
        }
        btn.classList.add('tab-button-active');
        btn.style.background = 'rgba(105, 210, 255, 0.1)';

        loadWikiDoc(doc.filename);
      };

      itemsWrapper.appendChild(btn);
    });

    sectionWrapper.appendChild(itemsWrapper);
    container.appendChild(sectionWrapper);
  }

  /**
   * Expands all collapsible categories
   */
  function expandAllWikiCategories() {
    collapsedCategories = {};
    localStorage.setItem('wiki_collapsed_categories', JSON.stringify(collapsedCategories));
    applyFiltersAndSort();
  }

  /**
   * Collapses all collapsible categories
   */
  function collapseAllWikiCategories() {
    const keys = ['pinned', 'runbook', 'policy', 'spec', 'plan', 'other'];
    keys.forEach(k => {
      collapsedCategories[k] = true;
    });
    localStorage.setItem('wiki_collapsed_categories', JSON.stringify(collapsedCategories));
    applyFiltersAndSort();
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
   * Toggles the overlay sidebar drawer state on mobile viewports
   */
  function toggleWikiSidebarDrawer() {
    const sidebar = document.querySelector('.wiki-sidebar-drawer');
    sidebar?.classList.toggle('drawer-open');
  }

  /**
   * Advanced keyboard navigation listener supporting tree traversal, expanding and collapsing
   */
  function handleWikiKeyboardNav(e) {
    const activeTabButton = document.querySelector('.tab-button.active');
    if (!activeTabButton || activeTabButton.dataset.tabId !== 'wiki') return;

    const isSearchFocused = document.activeElement === document.getElementById('wiki-search');
    
    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key)) {
      // Find all visible and focusable tree rows
      const rows = Array.from(document.querySelectorAll('.wiki-tree-row')).filter(el => {
        // If it's a document inside a collapsed category itemsWrapper, ignore
        const parentItemsWrapper = el.parentElement;
        if (parentItemsWrapper && parentItemsWrapper.style.display === 'none') {
          return false;
        }
        return el.offsetWidth > 0 && el.offsetHeight > 0;
      });

      if (rows.length === 0) return;

      let currentIndex = rows.indexOf(document.activeElement);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % rows.length;
        rows[nextIndex].focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prevIndex = currentIndex <= 0 ? rows.length - 1 : currentIndex - 1;
        rows[prevIndex].focus();
      } else if (e.key === 'ArrowLeft') {
        const activeEl = document.activeElement;
        if (activeEl && activeEl.dataset.type === 'category') {
          e.preventDefault();
          if (!collapsedCategories[activeEl.dataset.key]) {
            activeEl.click();
          }
        }
      } else if (e.key === 'ArrowRight') {
        const activeEl = document.activeElement;
        if (activeEl && activeEl.dataset.type === 'category') {
          e.preventDefault();
          if (collapsedCategories[activeEl.dataset.key]) {
            activeEl.click();
          }
        }
      } else if (e.key === 'Enter') {
        const activeEl = document.activeElement;
        if (activeEl && !isSearchFocused) {
          e.preventDefault();
          activeEl.click();
        }
      }
    }
  }

  // Dismiss overlay drawer when clicking outside it
  document.addEventListener('click', (e) => {
    const sidebar = document.querySelector('.wiki-sidebar-drawer');
    const toggleBtn = document.getElementById('wiki-toggle-sidebar');
    if (sidebar && sidebar.classList.contains('drawer-open')) {
      if (!sidebar.contains(e.target) && (!toggleBtn || !toggleBtn.contains(e.target))) {
        sidebar.classList.remove('drawer-open');
      }
    }
  });

  /**
   * Premium mouse draggable divider logic to resize sidebar
   */
  function initSidebarResizer() {
    const resizer = document.getElementById('wiki-sidebar-resizer');
    const sidebar = document.querySelector('.wiki-sidebar-drawer');
    const container = document.querySelector('.wiki-container');
    if (!resizer || !sidebar || !container) return;

    // Prevent duplicate binding
    if (resizer.dataset.bound === 'true') {
      // Restore layout width if dynamically initialized
      const savedWidth = localStorage.getItem('wiki_sidebar_width');
      if (savedWidth) {
        sidebar.style.width = savedWidth;
        sidebar.style.flexBasis = savedWidth;
      }
      return;
    }
    resizer.dataset.bound = 'true';

    let isResizing = false;

    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isResizing = true;
      resizer.classList.add('resizing');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none'; // prevent text selection
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      
      const containerRect = container.getBoundingClientRect();
      // Calculate mouse position relative to container
      let newWidth = e.clientX - containerRect.left;
      
      // Enforce robust boundaries (200px min, 600px max)
      if (newWidth < 200) newWidth = 200;
      if (newWidth > 600) newWidth = 600;
      
      sidebar.style.width = `${newWidth}px`;
      sidebar.style.flexBasis = `${newWidth}px`;
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        resizer.classList.remove('resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        
        // Save preferred width dynamically
        localStorage.setItem('wiki_sidebar_width', sidebar.style.width);
      }
    });
    
    // Restore preferred width from localStorage
    const savedWidth = localStorage.getItem('wiki_sidebar_width');
    if (savedWidth) {
      sidebar.style.width = savedWidth;
      sidebar.style.flexBasis = savedWidth;
    }
  }

  /**
   * Helper to retrieve auth header
   */
  function getAuthToken() {
    const meta = document.querySelector('meta[name="prism-auth-token"]');
    return meta ? meta.getAttribute('content') : '';
  }
})();
