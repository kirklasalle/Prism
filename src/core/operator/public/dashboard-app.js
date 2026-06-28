// Dashboard App — entry point, imports all modules, wires window.*
import { loadTabHtml, prefetchTabHtml } from './tab-loader.js';
import { state, tabs, request, escapeHtml, renderMarkdown, formatRelativeTime, safeIso, statusBadge, metricRow, healthDot, timeAgo, renderStars, approvalBadge, formatUptime, togglePanelCollapse, safeRenderStep, dashboardLog, renderLogsPanel, filterLogs, clearLogs, getToolState, getPluginState, getUtilityState, getReview, setItemRating, setItemApproval, saveItemNotes, toggleItemExpand, toggleItemEnabled, toCsvValue, authHeaders, wsUrl, createReconnector, trimAgenticEvent, withButtonFeedback, showAnchoredToast } from './dashboard-core.js';
import { reconcileExpandedSessionPackages, loadSessionPackages, loadSessionPackageHistory, mutateSessionPackage, getPackagedSessionIdSet, buildSessionTimeline, exportSession, importSession, packageSessions, toggleSessionPackage, getSessionsForPackage, runPackageWorkflow, setPackageStatus, cyclePackageStatus, exportPackageTrace, unpackageSessionPackage, getLocalLlmSelection, setLocalLlmSelection, clearLocalLlmSelection, loadSessions, createSession, openNewSessionModal, loadMessages, refreshChrome, renderSessions, renderOnboarding, renderToolBlocks, renderMessages, renderOverview, renderBrandPanel, selectSession, deleteSession, renameSession, copySession, handleFileSelect, pasteFromClipboard, removeAttachment, renderAttachmentPreview, uploadAttachments, sendMessage, runAction, quickApplyLlm, refreshOllamaModels, rollbackLlmConfig, approve, deny, connectAgenticStream, showThinkingTraceModal } from './tab-chat.js';
import { renderRoutingStrategyControls, renderLlm, onHeaderProviderChanged, onHeaderModelChanged, renderHeader, fetchReadinessAndRefresh, toggleCapabilityMatrix, setMatrixSort, setMatrixFilter, setMatrixDraftField, clearMatrixDraft, startMatrixEdit, saveMatrixEntry, deleteMatrixEntry, updateModelMatrix, renderCapabilityMatrix, guessTier, resolveMatrixEntry, sortArrow, getModelProficiencyBadges, getModelModalityBadges, fetchModelProfiles, fetchRoutingState, saveRoutingConfig, suggestOptimalRouting, setRoutingStrategy, setSessionRoutingStrategy, onModalitySelected, onModalityFilterToggle, setModalityOverride, getModelsForModalityFilter, setRoleOverride, renderModelRouting, setAgentOverride, onLlmProviderChanged, onLlmModelChanged, renderProviderCards, toggleProviderCard, toggleApiKeyVisibility, saveProviderCardSettings, saveProviderCardApiKey, removeProviderCardApiKey, testProviderConnection, discoverModels, renderLlmAudit, exportLlmAuditJson, copyLlmAuditJson, buildLlmAuditPayload, exportLlmAuditCsv, renderSettingsPanel, sec, readonlyRow, badgeRow, numberRow, selectRow, toggleSettingsSection, markSettingDirty, saveSettings, recheckReadiness, toggleReadinessCat, toggleReadinessCheck, fixReadinessCheck, resolveReadinessCheck, toggleOnboardingExpand, initSettingsTab, toggleSRPanel, onSRLeftProviderChanged, onSRRightProviderChanged, onSRModelChanged, saveSRConfig, toggleSRActivation, onSRPresetSelected, promptSaveSRPreset, cancelSaveSRPreset, confirmSaveSRPreset, deleteSRPreset, suggestSRModels, refreshOAuthStatus, oauthConnect, oauthDisconnect, refreshCacChain, exportCacAuditJson as exportCacAuditJsonHandler, toggleSshpPreference, savePowerModePreference, updatePowerTelemetry, refreshLlreTelemetry } from './tab-settings.js';
import { testTool, checkPluginHealth, updateToolsFilter, renderToolsOverviewBar, renderToolsPanel, renderSkillsPanel, showRegisterToolForm, cancelRegisterTool, submitRegisterTool, renderPluginsPanel, showInstallPluginForm, cancelInstallPlugin, submitInstallPlugin, renderUtilitiesPanel, computePanelSummary, renderPanelSummaries, switchToolsSubTab, setToolsSort, setPluginsSort, setUtilitiesSort, refreshAllToolStatus, renderDiagnosticsPanel, runBrowserDiagnostics, loadDiagnosticsReport, computeDiagnosticsSummary, handleDiagnosticsWsMessage, toggleDiagnosticSuite, computeAgentDiagnosticsSummary, loadAgentDiagnosticsReport, runAgentDiagnostics, handleAgentDiagnosticsWsMessage, toggleAgentDiagnosticSuite, renderAgentDiagnosticsPanel, computeComputerDiagnosticsSummary, loadComputerDiagnosticsReport, runComputerDiagnostics, handleComputerDiagnosticsWsMessage, toggleComputerDiagnosticSuite, renderComputerDiagnosticsPanel, computeKnowledgeGraphDiagnosticsSummary, loadKnowledgeGraphDiagnosticsReport, runKnowledgeGraphDiagnostics, handleKnowledgeGraphDiagnosticsWsMessage, toggleKnowledgeGraphDiagnosticSuite, renderKnowledgeGraphDiagnosticsPanel, computeWorkspaceDiagnosticsSummary, loadWorkspaceDiagnosticsReport, runWorkspaceDiagnostics, handleWorkspaceDiagnosticsWsMessage, toggleWorkspaceDiagnosticSuite, renderWorkspaceDiagnosticsPanel, computeNetworkDiagnosticsSummary, loadNetworkDiagnosticsReport, runNetworkDiagnostics, handleNetworkDiagnosticsWsMessage, toggleNetworkDiagnosticSuite, renderNetworkDiagnosticsPanel, computeTelemetryDiagnosticsSummary, loadTelemetryDiagnosticsReport, runTelemetryDiagnostics, handleTelemetryDiagnosticsWsMessage, toggleTelemetryDiagnosticSuite, renderTelemetryDiagnosticsPanel, computeLogsDiagnosticsSummary, loadLogsDiagnosticsReport, runLogsDiagnostics, handleLogsDiagnosticsWsMessage, toggleLogsDiagnosticSuite, renderLogsDiagnosticsPanel, computeSchedulerDiagnosticsSummary, loadSchedulerDiagnosticsReport, runSchedulerDiagnostics, handleSchedulerDiagnosticsWsMessage, toggleSchedulerDiagnosticSuite, renderSchedulerDiagnosticsPanel, computeDemoDiagnosticsSummary, loadDemoDiagnosticsReport, runDemoDiagnostics, handleDemoDiagnosticsWsMessage, toggleDemoDiagnosticSuite, renderDemoDiagnosticsPanel, pollPluginHealth, startPluginHealthPolling, stopPluginHealthPolling } from './tab-tools.js';
import { renderGuardianPanel, refreshGuardianStatus, startGuardian, stopGuardian, configureGuardian, refreshLocalModels, updateGuardianModel, onGuardianModelSelectChange, deleteLocalModel, addToRecommended, removeFromRecommended, loadCustomRecommendedModels, downloadRecommendedModels, startModelDownload, refreshGuardianTasks, runGuardianTask, toggleGuardianTask, runAllGuardianTasks, renderAgentList, renderSubAgentTree, renderSwarmTopology, renderAgentTelemetry, refreshAgentList, launchNewAgent, stopAgent, promoteAgent, demoteAgent, createSwarm, refreshSwarmStatus, initAgenticTab, autoStartGuardianIfConfigured, refreshCshHandoffs, takeCshControl, resumeCshAgent, refreshAABLedger, refreshAutonomousGoals, viewAutonomousGoalTrace } from './tab-agentic.js';
import { renderLocalSystemInfo, renderUsageMetrics, drawSparkline, runLocalCommand, refreshEnvVars, renderEnvVarsList, openPolicyEditor, refreshPolicyStatus, refreshDeviceManager, renderDeviceTree, openSystemDeviceManager, toggleDeviceProperties, filterDeviceTree, generateDeviceReport, captureScreengrab, burstCapture, showCaptureDiagnostics, runFramebufferDiagnostics, refreshFramebufferViewer, clearFramebufferPreviewVideo, setFramebufferPreviewSource, setFramebufferPreviewVideoSource, detectBurstVideoMimeType, loadFramebufferImage, buildBurstVideoPreview, formatFramebufferTimestamp, formatBurstTimestamp, summarizeFramebufferSelection, previewSelectedFramebufferItem, refreshFramebufferGallery, selectFramebufferFile, openFramebufferFile, revealFramebufferFile, openFramebufferFolder, toggleFramebufferAutoRefresh, toggleBurstPlayPause, stopBurstFromUI, setBurstSpeed, initComputerTab, pollUsage, updateBurstMediaBar, stopBurstFrameAnimation, startBurstFrameAnimation, submitAutonomousGoal, pauseAutonomousGoal, resumeAutonomousGoal, terminateAutonomousGoal, pollAutonomousStatus } from './tab-computer.js';
import { getCurrentBrowserView, launchBrowserPreview, openBrowserDevTools, refreshBrowserInfo, setBrowserView, toggleBrowserDevTools, browserRefreshStorage, setStorageSubView, renderStorageContent, browserRefreshProfiles, renderBrowserProfiles, browserRefreshLaunchProfiles, browserCreateProfile, browserDeleteProfile, browserLaunchSession, browserCloseSession, browserNavigate, browserTakeScreenshot, browserClickElement, browserTypeText, browserEvaluate, browserRefreshNetwork, browserRefreshConsole, browserRefreshDom, browserRunDiagnostics, browserSessionChanged, populateBrowserSessionDropdowns, renderBrowserSessions, browserLogAction, initBrowserTab, refreshSessionsList, submitBrowserAutopilot, stopBrowserAutopilot, resumeActiveCsh, updateSshpShieldIndicator } from './tab-browser.js';
import { renderSelfReview, renderRetrievalObservability, setTelemetryWindow, renderRuntimeExcellence, renderReleaseReadiness, renderWhatChanged, deltaLabel, pct, renderPackageHistory, renderChatTelemetry, renderUsagePanel, refreshUsagePanel, setUsageSort, saveUsageCaps, clearUsageCaps, refreshSloGauges, startSloAutoRefresh, stopSloAutoRefresh } from './tab-telemetry.js';
import { renderEvents, renderTraceView, loadTrace, renderActions, renderApprovals, renderActionHistory, renderToolCallLog, captureIncidentBundle, clearUnifiedTelemetry, hydrateUnifiedTelemetry, handleTelemetryWsMessage, refreshIdentityPanel, refreshTabSessions, initializeSupportDesk, filterSupportCatalog, triggerSelfHealingSweep, toggleSupportItem, initLogsTab, reconnectMcpServer, toggleLiveConsolePause, clearLiveConsole, copyLiveConsole, copyActivityLogs, copyUnifiedTelemetry, toggleCreateTicketForm, submitSupportTicket, investigateSupportTicket, selfHealSupportTicket, resolveSupportTicketPrompt, deleteSupportTicket } from './tab-logs.js';
import { initSchedulerTab, refreshSchedulerData, switchSchedulerView, renderSchedulerPanel, setCalMode, schedCalNav, daysInMonth, eventsForDate, formatDateStr, isToday, renderSchedulerCalendar, mondayOfWeek, renderMiniMonth, renderFullMonth, renderWeekView, renderDayView, renderSchedulerProjects, openProjectDetail, renderSchedulerBoard, initBoardDragDrop, renderSchedulerGantt, openSchedulerModal, closeSchedulerModal, saveSchedulerModal } from './tab-scheduler.js';
import { refreshWorkspaceInfo, refreshGitStatus, refreshWorkspaceFiles, renderWorkspaceFileTree, formatFileSize, filterWorkspaceFiles, openWorkspaceInExplorer, changeWorkspaceLocation, showImportStatus, triggerWorkspaceImport, triggerGeneralImport, triggerRegisteredImport, triggerFolderImport, readFileAsBase64, refreshImportHistory, renderImportHistory, initWorkspaceTab } from './tab-workspace.js';
import { clearCharacterPanelStatus, renderCharacterSummary, renderCharacterDefinitionPreview, filterCharacterAssignments, toggleCharacterAssignmentDetails, renderCharacterRoster, renderCharacterAuditLog, renderCharacterAssignmentForm, loadAvailableCharacters, loadWorkspaceHub, refreshCharacterAssignments, refreshCharacterAuditLog, refreshCharacterPanel, submitCharacterAssignment, dispatchCharacterAssignment, suspendCharacterAssignment, resumeCharacterAssignment, revokeCharacterAssignment, onCharacterDefinitionChanged, onProfileChanged, onWorkspaceHubBlur, initCharacterPanel, onCharacterChipClick, showCustomCharacterModal, closeCustomCharacterModal, onCustomCharProfileChange, submitCustomCharacter } from './tab-characters.js';
import { renderNetworkToolsPanel, renderNetworkSettingsPanel, renderNetworkTelemetryPanel, renderNetworkConsolePanel, runNetworkCommand, refreshNetworkInterfaces, refreshNetworkTelemetry, renderNetworkIntelligencePanel, checkVrgcStatus, runVrgcResearch, runVrgcSecurityScan, runVrgcPerformanceTest, runVrgcFtpBrowse } from './tab-network.js';
import { initHardwareTab, refreshHardwareSwarm, loadModelToSlot, unloadModelSlot } from './tab-hardware.js';
import { initPrismTooltips, pushGuardianTip } from './prism-tooltips.js';
import { registerShellTooltips } from './shell-tooltips.js';
import { registerChatTooltips } from './tab-chat-tooltips.js';
import { registerTabTooltipCatalog } from './tab-tips-catalog.js';
import './phase-e3-panels.js';

window.refreshHardwareSwarm = refreshHardwareSwarm;
window.loadModelToSlot = loadModelToSlot;
window.unloadModelSlot = unloadModelSlot;

// Route all frontend console logs back into the "Logs & Debug" tab.
const origLog = console.log;
const origWarn = console.warn;
const origError = console.error;

console.log = function (...args) {
  origLog.apply(console, args);
  // Avoid recursive loops if dashboardLog itself throws or logs
  if (args[0] && typeof args[0] === 'string' && args[0].startsWith('[dashboard-render]')) return;
  dashboardLog(state.activeTab, 'console.log', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
};
console.warn = function (...args) {
  origWarn.apply(console, args);
  dashboardLog(state.activeTab, 'console.warn', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
};
console.error = function (...args) {
  origError.apply(console, args);
  dashboardLog(state.activeTab, 'console.error', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
};
// Quiet noisy extension messages that target runtime.sendMessage without a receiver.
window.addEventListener('unhandledrejection', function (ev) {
  try {
    var reason = ev && ev.reason;
    var msg = reason && (reason.message || String(reason)) || '';
    if (typeof msg === 'string' && msg.indexOf('Could not establish connection. Receiving end does not exist.') !== -1) {
      ev.preventDefault && ev.preventDefault();
      console.debug('[unhandledrejection] suppressed extension noise');
      return;
    }
  } catch (e) { /* noop */ }
});
// Suppress repetitive browser validation warning about password fields outside forms.
window.addEventListener('error', function (ev) {
  try {
    var message = ev && ev.message || '';
    if (typeof message === 'string' && message.indexOf('Password field is not contained in a form') !== -1) {
      ev.preventDefault && ev.preventDefault();
      console.debug('[window.error] suppressed password-field form warning');
      return;
    }
  } catch (e) { /* noop */ }
});
async function bootstrap() {
  try {
    try {
      const me = await request('/api/iam/me');
      state.principal = me.principal;
    } catch (e) {
      console.warn('Failed to fetch IAM principal during bootstrap', e);
    }

    initPrismTooltips();
    registerShellTooltips();
    registerChatTooltips();
    registerTabTooltipCatalog();
    await loadTabHtml('chat');
    wireComposer();
    await loadSessions();
    if (state.sessions.length === 0) {
      try {
        await createSession({ silent: true });
      } catch (_) {
        // Session creation failed — still load non-session data so tabs render.
        await refreshChrome().catch(() => null);
      }
    } else {
      await Promise.all([refreshChrome(), loadMessages()]);
    }
    // Load model profiles and routing config in background
    fetchModelProfiles();
    fetchRoutingState();

    // Connect to streams for real-time progress and UI actions
    connectAgenticStream();
    connectWebSocket();

    // v0.20.5 — Auto-start the Guardian Agent on client load (when a local
    // model is configured). Fire-and-forget; runs at most once per page session
    // and respects the `prism.guardian.autostart=false` localStorage opt-out.
    autoStartGuardianIfConfigured().catch(function (e) { console.error('[bootstrap] guardian autostart:', e); });
  } catch (error) {
    state.notice = String(error);
  } finally {
    render();
    // Warm the fragment cache for the most-likely-next tabs during idle time so first-click feels instant.
    const prefetchNext = () => {
      prefetchTabHtml('settings');
      prefetchTabHtml('tools');
      prefetchTabHtml('agentic');
    };
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(prefetchNext, { timeout: 2000 });
    } else {
      setTimeout(prefetchNext, 1500);
    }
  }

  // Auto-wrap inline onclick handlers on primary/secondary buttons to provide feedback
  function autoWrapInlineButtons() {
    try {
      const buttons = Array.from(document.querySelectorAll('button.primary-button, button.secondary-button'));
      buttons.forEach(btn => {
        try {
          if (btn.dataset && btn.dataset.autowrap === 'false') return;
          const onclick = btn.getAttribute('onclick');
          if (!onclick) return;
          // Build a handler that executes original onclick code and returns its result
          const originalCode = onclick;
          btn.removeAttribute('onclick');
          btn.addEventListener('click', function (ev) {
            ev.preventDefault();
            const fn = new Function(originalCode);
            const exec = () => Promise.resolve().then(() => fn.call(btn));
            if (typeof withButtonFeedback === 'function') {
              withButtonFeedback(btn, exec, { pending: btn.getAttribute('data-pending') || 'Processing…', success: btn.getAttribute('data-success') || 'Done', error: btn.getAttribute('data-error') || 'Failed' }).catch(() => { });
            } else {
              exec().catch(() => { });
            }
          }, { passive: false });
        } catch (_) { }
      });
    } catch (_) { }
  }
  try { autoWrapInlineButtons(); } catch (_) { }
}


function render() {
  safeRenderStep('brandPanel', renderBrandPanel);
  safeRenderStep('tabs', renderTabs);
  safeRenderStep('sessions', renderSessions);
  safeRenderStep('header', renderHeader);
  safeRenderStep('onboarding', renderOnboarding);
  safeRenderStep('messages', renderMessages);
  safeRenderStep('overview', renderOverview);
  safeRenderStep('runtimeExcellence', renderRuntimeExcellence);
  safeRenderStep('releaseReadiness', renderReleaseReadiness);
  safeRenderStep('packageHistory', renderPackageHistory);
  safeRenderStep('whatChanged', renderWhatChanged);
  safeRenderStep('llm', renderLlm);
  safeRenderStep('capabilityMatrix', renderCapabilityMatrix);
  safeRenderStep('modelRouting', renderModelRouting);
  safeRenderStep('providerCards', renderProviderCards);
  safeRenderStep('llmAudit', renderLlmAudit);
  safeRenderStep('settingsPanel', renderSettingsPanel);
  safeRenderStep('toolsOverviewBar', renderToolsOverviewBar);
  safeRenderStep('skillsPanel', renderSkillsPanel);
  safeRenderStep('toolsPanel', renderToolsPanel);
  safeRenderStep('pluginsPanel', renderPluginsPanel);
  safeRenderStep('utilitiesPanel', renderUtilitiesPanel);
  safeRenderStep('diagnosticsPanel', renderDiagnosticsPanel);
  safeRenderStep('guardianPanel', renderGuardianPanel);
  safeRenderStep('networkDiagnosticsPanel', renderNetworkDiagnosticsPanel);
  safeRenderStep('telemetryDiagnosticsPanel', renderTelemetryDiagnosticsPanel);
  safeRenderStep('logsDiagnosticsPanel', renderLogsDiagnosticsPanel);
  safeRenderStep('agentList', renderAgentList);
  safeRenderStep('subAgentTree', renderSubAgentTree);
  safeRenderStep('swarmTopology', renderSwarmTopology);
  safeRenderStep('agentTelemetry', renderAgentTelemetry);
  safeRenderStep('localSystemInfo', renderLocalSystemInfo);
  safeRenderStep('envVarsList', renderEnvVarsList);
  safeRenderStep('deviceTree', renderDeviceTree);
  safeRenderStep('importHistory', renderImportHistory);
  safeRenderStep('networkToolsPanel', renderNetworkToolsPanel);
  safeRenderStep('networkSettingsPanel', renderNetworkSettingsPanel);
  safeRenderStep('networkTelemetryPanel', renderNetworkTelemetryPanel);
  safeRenderStep('networkConsolePanel', renderNetworkConsolePanel);
  safeRenderStep('networkIntelligencePanel', renderNetworkIntelligencePanel);
  safeRenderStep('actions', renderActions);
  safeRenderStep('approvals', renderApprovals);
  safeRenderStep('actionHistory', renderActionHistory);
  safeRenderStep('chatTelemetry', renderChatTelemetry);
  safeRenderStep('usagePanel', renderUsagePanel);
  safeRenderStep('traceView', renderTraceView);
  safeRenderStep('selfReview', renderSelfReview);
  safeRenderStep('retrievalObservability', renderRetrievalObservability);
  safeRenderStep('schedulerPanel', renderSchedulerPanel);
  safeRenderStep('events', renderEvents);
  safeRenderStep('logsPanel', renderLogsPanel);
  const sendButton = document.getElementById('send-button');
  if (sendButton) {
    sendButton.disabled = state.busy;
  }
}

// Listen for core state changes invoked by helpers (showTransientNotice)
document.addEventListener('prism:state-changed', function () {
  try { render(); } catch (_) { /* best-effort */ }
});

// PRISM in-app deep-link plumbing: scroll to a panel anchor and pulse it briefly so
// the operator's eye lands on the right card after a tab switch (used by both the
// click delegate for `prism://tab/<id>#<anchor>` chat links and by server-driven
// UI tour broadcasts via `{type:'ui_action', action:'switch_tab', anchor, ...}`).
function scrollAndFlashAnchor(anchor) {
  if (!anchor) return;
  // Defer one frame so the lazy-loaded tab panel has been rendered into the DOM.
  requestAnimationFrame(function () {
    setTimeout(function () {
      try {
        var el = document.getElementById(anchor);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.classList.add('prism-flash');
        setTimeout(function () { el.classList.remove('prism-flash'); }, 1400);
      } catch (_e) { /* defensive: never crash UI on flash */ }
    }, 30);
  });
}

// Global click delegate for in-chat `prism://tab/<id>#<anchor>` links rendered by
// renderMarkdown() in dashboard-core.js. Attached once at module load; idempotent.
if (typeof window !== 'undefined' && !window.__prismDeepLinkDelegate) {
  window.__prismDeepLinkDelegate = true;
  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest && ev.target.closest('a[data-prism-tab]');
    if (!a) return;
    ev.preventDefault();
    var tabId = a.getAttribute('data-prism-tab');
    var anchor = a.getAttribute('data-prism-anchor') || '';
    if (!tabId) return;
    Promise.resolve(setActiveTab(tabId)).then(function () {
      if (anchor) scrollAndFlashAnchor(anchor);
    });
  }, false);
}

async function setActiveTab(tabId) {
  if (!tabs.some(tab => tab.id === tabId)) {
    return;
  }
  dashboardLog(tabId, 'tab.switch', 'Switched to ' + tabId + ' tab');
  // Stop any tab-specific auto-refresh timers before switching
  stopSloAutoRefresh();
  stopPluginHealthPolling();
  if (state.computerPollInterval && tabId !== 'computer') {
    clearInterval(state.computerPollInterval);
    state.computerPollInterval = null;
  }
  if (state.framebufferPollInterval && tabId !== 'computer') {
    clearInterval(state.framebufferPollInterval);
    state.framebufferPollInterval = null;
  }
  if (state.settingsPollInterval && tabId !== 'settings') {
    clearInterval(state.settingsPollInterval);
    state.settingsPollInterval = null;
  }

  // Load the tab HTML dynamically if not loaded
  try {
    await loadTabHtml(tabId);
  } catch (err) {
    console.error("Failed to load tab HTML", err);
  }

  state.activeTab = tabId;
  // Track tab visit counts for shell tooltip telemetry providers (no-op if state already has it).
  if (!state.tabActivity) state.tabActivity = {};
  state.tabActivity[tabId] = (state.tabActivity[tabId] || 0) + 1;
  render(); // make the panel visible immediately while data loads
  if (tabId === 'chat') {
    wireComposer();
  }
  if (tabId === 'settings') {
    // Re-fetch model profiles and routing state on every settings visit so
    // the matrix and routing panels reflect any background changes.
    fetchModelProfiles().catch(function () { }).then(function () {
      safeRenderStep('capabilityMatrix', renderCapabilityMatrix);
      safeRenderStep('modelRouting', renderModelRouting);
    });
    fetchRoutingState().catch(function () { }).then(function () {
      safeRenderStep('modelRouting', renderModelRouting);
    });
    refreshChrome().then(function () { render(); });
    refreshOAuthStatus().then(function () { render(); });
    initSettingsTab();

    if (!state.settingsPollInterval) {
      state.settingsPollInterval = setInterval(function () {
        if (window.updatePowerTelemetry) window.updatePowerTelemetry();
      }, 3000);
    }
  }
  if (tabId === 'agentic') {
    try { await initAgenticTab(); } catch (e) { console.error('[tab] agentic init:', e); }
    try { await refreshGuardianStatus(); } catch (e) { console.error('[tab] guardian:', e); }
    try { await initHardwareTab(); } catch (e) { console.error('[tab] hardware init:', e); }
    try { await initCharacterPanel(); } catch (e) { console.error('[tab] character panel:', e); }
  }
  if (tabId === 'workspace') {
    try { await initWorkspaceTab(); } catch (e) { console.error('[tab] workspace init:', e); }
  }
  if (tabId === 'computer') {
    try { await initComputerTab(); } catch (e) { console.error('[tab] computer init:', e); }
  }
  if (tabId === 'browser') {
    try { await initBrowserTab(); } catch (e) { console.error('[tab] browser init:', e); }
  }
  if (tabId === 'tools') {
    // Lazy-load diagnostics report on first visit
    if (!state.diagnosticsReport) {
      loadDiagnosticsReport().then(function () {
        safeRenderStep('diagnosticsPanel', renderDiagnosticsPanel);
        safeRenderStep('panelSummaries', renderPanelSummaries);
      }).catch(function () { /* best-effort */ });
    }
    if (!state.agentDiagnosticsReport) {
      loadAgentDiagnosticsReport().then(function () {
        safeRenderStep('agentDiagnosticsPanel', renderAgentDiagnosticsPanel);
        safeRenderStep('panelSummaries', renderPanelSummaries);
      }).catch(function () { /* best-effort */ });
    }
    if (!state.computerDiagnosticsReport) {
      loadComputerDiagnosticsReport().then(function () {
        safeRenderStep('computerDiagnosticsPanel', renderComputerDiagnosticsPanel);
        safeRenderStep('panelSummaries', renderPanelSummaries);
      }).catch(function () { /* best-effort */ });
    }
    if (!state.knowledgeGraphDiagnosticsReport) {
      loadKnowledgeGraphDiagnosticsReport().then(function () {
        safeRenderStep('knowledgeGraphDiagnosticsPanel', renderKnowledgeGraphDiagnosticsPanel);
        safeRenderStep('panelSummaries', renderPanelSummaries);
      }).catch(function () { /* best-effort */ });
    }
    if (!state.workspaceDiagnosticsReport) {
      loadWorkspaceDiagnosticsReport().then(function () {
        safeRenderStep('workspaceDiagnosticsPanel', renderWorkspaceDiagnosticsPanel);
        safeRenderStep('panelSummaries', renderPanelSummaries);
      }).catch(function () { /* best-effort */ });
    }
    if (!state.networkDiagnosticsReport) {
      loadNetworkDiagnosticsReport().then(function () {
        safeRenderStep('networkDiagnosticsPanel', renderNetworkDiagnosticsPanel);
        safeRenderStep('panelSummaries', renderPanelSummaries);
      }).catch(function () { /* best-effort */ });
    }
    if (!state.telemetryDiagnosticsReport) {
      loadTelemetryDiagnosticsReport().then(function () {
        safeRenderStep('telemetryDiagnosticsPanel', renderTelemetryDiagnosticsPanel);
        safeRenderStep('panelSummaries', renderPanelSummaries);
      }).catch(function () { /* best-effort */ });
    }
    if (!state.logsDiagnosticsReport) {
      loadLogsDiagnosticsReport().then(function () {
        safeRenderStep('logsDiagnosticsPanel', renderLogsDiagnosticsPanel);
        safeRenderStep('panelSummaries', renderPanelSummaries);
      }).catch(function () { /* best-effort */ });
    }
    if (!state.schedulerDiagnosticsReport) {
      loadSchedulerDiagnosticsReport().then(function () {
        safeRenderStep('schedulerDiagnosticsPanel', renderSchedulerDiagnosticsPanel);
        safeRenderStep('panelSummaries', renderPanelSummaries);
      }).catch(function () { /* best-effort */ });
    }
    if (!state.demoDiagnosticsReport) {
      loadDemoDiagnosticsReport().then(function () {
        safeRenderStep('demoDiagnosticsPanel', renderDemoDiagnosticsPanel);
        safeRenderStep('panelSummaries', renderPanelSummaries);
      }).catch(function () { /* best-effort */ });
    }
    startPluginHealthPolling();
  }
  if (tabId === 'network') {
    refreshNetworkInterfaces();
    refreshNetworkTelemetry();
    checkVrgcStatus();
  }
  if (tabId === 'logs') {
    /* Seed log panel from server if empty */
    if (state.logEntries.length === 0) {
      request('/api/logs?limit=500').then(function (data) {
        if (Array.isArray(data)) {
          state.logEntries = data;
          safeRenderStep('logsPanel', renderLogsPanel);
        }
      }).catch(function () { /* best-effort */ });
    }
    // Phase A3B: Hydrate unified telemetry + identity on Logs tab activation
    hydrateUnifiedTelemetry().catch(function (e) { console.error('[logs] telemetry hydrate:', e); });
    refreshIdentityPanel().catch(function (e) { console.error('[logs] identity load:', e); });
    refreshTabSessions().catch(function (e) { console.error('[logs] tab sessions load:', e); });
    try { initializeSupportDesk(); } catch (e) { console.error('[logs] support desk init:', e); }
    try { initLogsTab(); } catch (e) { console.error('[logs] initLogsTab init:', e); }
  }
  if (tabId === 'scheduler') {
    try { await initSchedulerTab(); } catch (e) { console.error('[tab] scheduler init:', e); }
  }
  if (tabId === 'telemetry') {
    setTelemetryWindow(state.telemetryWindow);
    refreshUsagePanel().catch(() => null);
    startSloAutoRefresh();
    return; // setTelemetryWindow calls render() — skip double render
  }
  render();
}

/**
 * Connect to the specialized WebSocket for real-time UI actions and system events.
 */
var _summaryDebounceTimer = null;
function debouncedPanelSummaryRefresh() {
  if (_summaryDebounceTimer) clearTimeout(_summaryDebounceTimer);
  _summaryDebounceTimer = setTimeout(function () {
    safeRenderStep('panelSummaries', renderPanelSummaries);
    safeRenderStep('toolsOverviewBar', renderToolsOverviewBar);
  }, 100);
}

async function syncActiveAutonomousGoal() {
  try {
    const data = await request('/api/autonomous/goals');
    const goals = data.goals || [];
    const active = goals.find(function (g) { return g.status === 'executing' || g.status === 'planning'; });
    if (active && active.steps && active.steps.length > 0) {
      console.log('[ws] syncing active autonomous goal steps:', active.goalId, active.steps.length);
      const events = active.steps.map(s => {
        const eventsForStep = [];
        eventsForStep.push({
          type: 'tool_call',
          toolCall: { name: s.tool, arguments: s.arguments || {} },
          iteration: s.iteration || 0,
          text: '',
          timestamp: s.startedAt || new Date().toISOString()
        });
        if (s.status === 'succeeded' || s.status === 'failed') {
          eventsForStep.push({
            type: 'tool_result',
            toolResult: { name: s.tool, ok: s.status === 'succeeded', output: typeof s.output === 'string' ? s.output : JSON.stringify(s.output) },
            iteration: s.iteration || 0,
            text: '',
            timestamp: s.completedAt || new Date().toISOString()
          });
        }
        return eventsForStep;
      }).flat();
      state.agenticStream = events.slice(-500);
      safeRenderStep('messages', renderMessages);
    }
  } catch (err) {
    console.warn('[ws] syncActiveAutonomousGoal failed:', err);
  }
}

var _wsReconnector = createReconnector(connectWebSocket, { label: 'ws', baseDelay: 1000, maxDelay: 30000, maxRetries: 50 });

function connectWebSocket() {
  const ws = new WebSocket(wsUrl('/ws'));

  ws.onopen = () => {
    console.log('[ws] connected');
    _wsReconnector.reset();
    // Update connection indicator
    var dot = document.getElementById('prism-ws-status');
    if (dot) { dot.style.background = '#22c55e'; dot.title = 'WebSocket connected'; }
    var txt = document.getElementById('prism-ws-status-text');
    if (txt) { txt.textContent = 'CONNECTED (LIVE)'; txt.style.color = '#34d399'; }
    syncActiveAutonomousGoal();
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (window._onDashboardWsMessage) {
        try { window._onDashboardWsMessage(data); } catch (e) { console.error('[ws] hook error:', e); }
      }
      if (data.type === 'demo_step' || data.type === 'demo_section' || data.type === 'telemetry' || data.operation === 'browser_control' || (data.details && data.details.source === 'browser-session-manager')) {
        const action = String(data.action ?? data.operation ?? '');
        const detail = String(data.detail ?? (data.details ? JSON.stringify(data.details) : ''));
        const nar = String(data.narration ?? '');

        const isBrowserEvent = action.includes('browser') || detail.includes('browser') || nar.includes('browser') || nar.includes('Browser') || action.includes('click') || action.includes('navigate') || action.includes('type') || action.includes('scroll') || action.includes('hover') || action.includes('cookie') || action.includes('storage') || action.includes('screenshot');

        if (isBrowserEvent) {
          // Identify browser event kind and log it to the Browser Action Log
          let actionKind = 'agent';
          let logMsg = nar || detail || action;

          if (action.includes('click') || detail.includes('click') || nar.includes('click')) {
            actionKind = 'click';
            logMsg = `Agent clicked element: ${detail || action}`;
          } else if (action.includes('type') || detail.includes('type') || nar.includes('type') || action.includes('fill') || detail.includes('fill')) {
            actionKind = 'type';
            logMsg = `Agent typed input: ${detail || action}`;
          } else if (action.includes('navigate') || detail.includes('navigate') || nar.includes('navigate') || action.includes('goto')) {
            actionKind = 'navigate';
            logMsg = `Agent navigated to: ${detail || action}`;
          } else if (action.includes('screenshot') || detail.includes('screenshot') || nar.includes('screenshot')) {
            actionKind = 'screenshot';
            logMsg = `Agent captured screenshot`;
          } else if (action.includes('scroll') || detail.includes('scroll') || nar.includes('scroll')) {
            actionKind = 'scroll';
            logMsg = `Agent scrolled viewport`;
          } else if (action.includes('hover') || detail.includes('hover') || nar.includes('hover')) {
            actionKind = 'hover';
            logMsg = `Agent hovered element`;
          }

          browserLogAction(actionKind, logMsg);

          // Update active session dropdown and live sub-view content
          refreshSessionsList().then(() => {
            const activeId = state.activeBrowserSessionId;
            if (activeId) {
              const currentView = getCurrentBrowserView();
              if (currentView === 'viewport') {
                browserTakeScreenshot().catch(e => { });
              } else if (currentView === 'network') {
                browserRefreshNetwork().catch(e => { });
              } else if (currentView === 'console') {
                browserRefreshConsole().catch(e => { });
              } else if (currentView === 'dom') {
                browserRefreshDom().catch(e => { });
              } else if (currentView === 'storage') {
                browserRefreshStorage().catch(e => { });
              }
            }
          }).catch(e => { });
        }

        if (action.includes('file') || detail.includes('file') || nar.includes('file') || nar.includes('Workspace') || nar.includes('Workspace Files')) {
          refreshWorkspaceFiles().catch(e => { });
        }
      }
      if (data.type === 'ui_action' && data.action === 'switch_tab' && data.tabId) {
        setActiveTab(data.tabId);
        // Optional: scroll to + flash a panel anchor; surface an optional toast message.
        if (data.anchor) { scrollAndFlashAnchor(data.anchor); }
        if (data.message) { dashboardLog(data.tabId, 'tour.step', String(data.message)); }
      }
      if (data.type === 'guardian_event') {
        dashboardLog('agentic', 'guardian.event', data.detail || data.operation);
        if (state.activeTab === 'agentic') {
          refreshGuardianStatus();
          refreshGuardianTasks();
        }
      }
      // Guardian-curated tooltip insights → Prism Tooltips dynamic line.
      if (data.type === 'guardian_tip' && data.tipId) {
        pushGuardianTip({
          tipId: data.tipId,
          kind: data.kind || 'guardian',
          message: data.message || data.detail || '',
        });
      }
      // Debounced refresh of panel summaries on any tool/plugin state update
      if (data.type === 'tool_state' || data.type === 'plugin_state' || data.type === 'utility_state') {
        if (data.states) {
          if (data.type === 'tool_state') Object.assign(state.toolStates, data.states);
          if (data.type === 'plugin_state') Object.assign(state.pluginStates, data.states);
          if (data.type === 'utility_state') Object.assign(state.utilityStates, data.states);
        }
        debouncedPanelSummaryRefresh();
      }
      // Diagnostics progress/completion/logs from test runner
      if (data.type === 'diagnostics_progress' || data.type === 'diagnostics_complete' || data.type === 'diagnostics_log') {
        handleDiagnosticsWsMessage(data);
      }
      // Agent diagnostics progress/completion/logs from test runner
      if (data.type === 'agent_diagnostics_progress' || data.type === 'agent_diagnostics_complete' || data.type === 'agent_diagnostics_log') {
        handleAgentDiagnosticsWsMessage(data);
      }
      // Computer diagnostics progress/completion/logs from test runner
      if (data.type === 'computer_diagnostics_progress' || data.type === 'computer_diagnostics_complete' || data.type === 'computer_diagnostics_log') {
        handleComputerDiagnosticsWsMessage(data);
      }
      // Knowledge Graph diagnostics progress/completion/logs from test runner
      if (data.type === 'knowledge_graph_diagnostics_progress' || data.type === 'knowledge_graph_diagnostics_complete' || data.type === 'knowledge_graph_diagnostics_log') {
        handleKnowledgeGraphDiagnosticsWsMessage(data);
      }
      // Workspace diagnostics progress/completion/logs from test runner
      if (data.type === 'workspace_diagnostics_progress' || data.type === 'workspace_diagnostics_complete' || data.type === 'workspace_diagnostics_log') {
        handleWorkspaceDiagnosticsWsMessage(data);
      }
      // Network diagnostics progress/completion/logs from test runner
      if (data.type === 'network_diagnostics_progress' || data.type === 'network_diagnostics_complete' || data.type === 'network_diagnostics_log') {
        handleNetworkDiagnosticsWsMessage(data);
      }
      // Telemetry diagnostics progress/completion/logs from test runner
      if (data.type === 'telemetry_diagnostics_progress' || data.type === 'telemetry_diagnostics_complete' || data.type === 'telemetry_diagnostics_log') {
        handleTelemetryDiagnosticsWsMessage(data);
      }
      // Logs diagnostics progress/completion/logs from test runner
      if (data.type === 'logs_diagnostics_progress' || data.type === 'logs_diagnostics_complete' || data.type === 'logs_diagnostics_log') {
        handleLogsDiagnosticsWsMessage(data);
      }
      // Scheduler diagnostics progress/completion/logs from test runner
      if (data.type === 'scheduler_diagnostics_progress' || data.type === 'scheduler_diagnostics_complete' || data.type === 'scheduler_diagnostics_log') {
        handleSchedulerDiagnosticsWsMessage(data);
      }
      // Demo diagnostics progress/completion/logs from test runner
      if (data.type === 'demo_diagnostics_progress' || data.type === 'demo_diagnostics_complete' || data.type === 'demo_diagnostics_log') {
        handleDemoDiagnosticsWsMessage(data);
      }
      // Phase A3B: Unified telemetry real-time stream from server
      if (data.type === 'telemetry') {
        handleTelemetryWsMessage(data);
      }

      // Real-time autonomous step events broadcast from server
      if (data.type === 'autonomous_step') {
        try {
          dashboardLog('agentic', 'autonomous.step', `Step: ${data.goalId || ''} ${data.tool || ''} #${data.iteration || ''}`);
        } catch (_) { }
        try {
          // Normalize into the same stream shape that SSE uses
          const evRaw = {
            type: data.type === 'autonomous_step' ? (data.tool ? 'tool_call' : 'text') : 'text',
            toolCall: data.tool ? { name: data.tool, arguments: data.arguments || {} } : undefined,
            iteration: data.iteration || 0,
            text: data.summary || data.text || '',
            timestamp: data.timestamp || new Date().toISOString(),
          };
          const ev = typeof trimAgenticEvent === 'function' ? trimAgenticEvent(evRaw) : evRaw;
          state.agenticStream.push(ev);
          if (state.agenticStream.length > 500) state.agenticStream = state.agenticStream.slice(-500);
          safeRenderStep('messages', renderMessages);
        } catch (e) { console.error('[ws] autonomous_step handle error', e); }
        try { refreshAutonomousGoals(); refreshAABLedger(); } catch (_) { }
      }

      if (data.type === 'autonomous_goal_complete' || data.type === 'autonomous_goal_complete') {
        try { dashboardLog('agentic', 'autonomous.goal_complete', `Goal ${data.goalId || ''} ${data.status || ''}`); } catch (_) { }
        try {
          const ev = { type: 'done', goalId: data.goalId || '', status: data.status || 'completed', summary: data.summary || '', timestamp: data.timestamp || new Date().toISOString() };
          // preserve final trace for inspection (trimmed)
          state.lastThinkingTrace = (state.agenticStream && state.agenticStream.length) ? state.agenticStream.slice(-500).map(function (x) { return typeof trimAgenticEvent === 'function' ? trimAgenticEvent(x) : x; }) : [];
          if (state.lastThinkingTrace.length > 500) state.lastThinkingTrace = state.lastThinkingTrace.slice(-500);
          // push a done sentinel so renderMessages can show completion context
          state.agenticStream.push(ev);
          if (state.agenticStream.length > 500) state.agenticStream = state.agenticStream.slice(-500);
          
          // Reload chat messages and refresh UI in case the goal was triggered from chat
          loadMessages().then(function() {
            safeRenderStep('messages', renderMessages);
          }).catch(function() {});
          refreshChrome().catch(function() {});
        } catch (e) { console.error('[ws] autonomous_goal_complete handle error', e); }
        try { refreshAutonomousGoals(); refreshAABLedger(); } catch (_) { }
      }
    } catch (e) {
      console.error('[ws] message error:', e);
    }
  };

  ws.onclose = () => {
    console.log('[ws] disconnected');
    var dot = document.getElementById('prism-ws-status');
    if (dot) { dot.style.background = '#ef4444'; dot.title = 'WebSocket disconnected — reconnecting…'; }
    var txt = document.getElementById('prism-ws-status-text');
    if (txt) { txt.textContent = 'DISCONNECTED'; txt.style.color = '#ef4444'; }
    _wsReconnector.schedule();
  };

  ws.onerror = (err) => {
    console.warn('[ws] error:', err);
  };
}


function renderTabs() {
  const tabsContainer = document.getElementById('tabs');
  if (!tabsContainer) {
    return;
  }

  const buttons = Array.from(tabsContainer.querySelectorAll('[data-tab-id]'));
  if (buttons.length !== tabs.length) {
    console.error('[dashboard-render] tabs', 'expected ' + tabs.length + ' buttons, found ' + buttons.length);
    state.notice = state.notice || 'Dashboard navigation is incomplete. Refresh the page or restart Prism.';
    return;
  }

  const missingPanels = [];
  tabs.forEach(tab => {
    if (!document.getElementById('tab-' + tab.id)) {
      missingPanels.push(tab.id);
    }
  });
  if (missingPanels.length > 0) {
    console.error('[dashboard-render] tabs', 'missing panels', missingPanels.join(','));
    state.notice = state.notice || 'Dashboard content panels failed to initialize. Refresh the page or restart Prism.';
    return;
  }

  buttons.forEach(button => {
    const tabId = button.dataset.tabId;
    const isActive = state.activeTab === tabId;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    button.setAttribute('tabindex', isActive ? '0' : '-1');
  });

  tabs.forEach(tab => {
    const panel = document.getElementById('tab-' + tab.id);
    if (!panel) {
      return;
    }
    const isActive = state.activeTab === tab.id;
    panel.classList.toggle('active', isActive);
    panel.setAttribute('aria-hidden', isActive ? 'false' : 'true');
  });

  if (document.body) {
    document.body.classList.add('js-ready');
  }
}

// Keyboard shortcut: Enter sends message.
// NOTE: #composer lives inside tab-chat.html (async-loaded); we must wire it
// AFTER the chat fragment has been injected into the DOM. bootstrap() calls
// wireComposer() once loadTabHtml('chat') resolves. We also guard with a
// module-level flag so repeated tab switches don't double-bind listeners.
let _composerWired = false;
function wireComposer() {
  if (_composerWired) return;
  const comp = document.getElementById('composer');
  if (!comp) return;
  comp.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  });
  comp.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = this.scrollHeight + 'px';
  });
  _composerWired = true;
}

bootstrap();

// Telemetry auto-refresh (30s interval)
setInterval(async function () {
  try {
    if (document.activeElement && document.activeElement.tagName === 'SELECT') return;
    const [telemetrySummaryData, runtimeExcellenceData] = await Promise.all([
      request('/api/telemetry/summary?window=' + state.telemetryWindow).catch(() => null),
      request('/api/runtime/excellence?window=' + state.telemetryWindow).catch(() => null)
    ]);
    if (document.activeElement && document.activeElement.tagName === 'SELECT') return;
    state.telemetrySummary = telemetrySummaryData || null;
    state.runtimeExcellence = runtimeExcellenceData || null;
    safeRenderStep('runtimeExcellence', renderRuntimeExcellence);
    // Refresh usage panel in background
    refreshUsagePanel().catch(() => null);
  } catch (_) { /* silent — telemetry is best-effort */ }
}, 30000);

// Wire all functions to window for inline onclick handlers
Object.assign(window, {
  request,
  escapeHtml,
  renderMarkdown,
  formatRelativeTime,
  safeIso,
  statusBadge,
  metricRow,
  healthDot,
  timeAgo,
  renderStars,
  approvalBadge,
  formatUptime,
  togglePanelCollapse,
  safeRenderStep,
  dashboardLog,
  renderLogsPanel,
  filterLogs,
  clearLogs,
  getToolState,
  getPluginState,
  getUtilityState,
  getReview,
  setItemRating,
  setItemApproval,
  saveItemNotes,
  toggleItemExpand,
  toggleItemEnabled,
  toCsvValue,
  reconcileExpandedSessionPackages,
  loadSessionPackages,
  loadSessionPackageHistory,
  mutateSessionPackage,
  getPackagedSessionIdSet,
  buildSessionTimeline,
  exportSession,
  importSession,
  packageSessions,
  toggleSessionPackage,
  getSessionsForPackage,
  runPackageWorkflow,
  setPackageStatus,
  cyclePackageStatus,
  exportPackageTrace,
  unpackageSessionPackage,
  getLocalLlmSelection,
  setLocalLlmSelection,
  clearLocalLlmSelection,
  loadSessions,
  createSession,
  openNewSessionModal,
  loadMessages,
  refreshChrome,
  renderSessions,
  renderOnboarding,
  renderToolBlocks,
  renderMessages,
  renderOverview,
  renderBrandPanel,
  selectSession,
  deleteSession,
  renameSession,
  copySession,
  handleFileSelect,
  pasteFromClipboard,
  removeAttachment,
  renderAttachmentPreview,
  uploadAttachments,
  sendMessage,
  runAction,
  quickApplyLlm,
  refreshOllamaModels,
  rollbackLlmConfig,
  approve,
  deny,
  connectAgenticStream,
  renderRoutingStrategyControls,
  renderLlm,
  onHeaderProviderChanged,
  onHeaderModelChanged,
  renderHeader,
  fetchReadinessAndRefresh,
  toggleCapabilityMatrix,
  setMatrixSort,
  setMatrixFilter,
  setMatrixDraftField,
  clearMatrixDraft,
  startMatrixEdit,
  saveMatrixEntry,
  deleteMatrixEntry,
  updateModelMatrix,
  renderCapabilityMatrix,
  guessTier,
  resolveMatrixEntry,
  sortArrow,
  getModelProficiencyBadges,
  getModelModalityBadges,
  fetchModelProfiles,
  fetchRoutingState,
  saveRoutingConfig,
  suggestOptimalRouting,
  setRoutingStrategy,
  setSessionRoutingStrategy,
  onModalitySelected,
  onModalityFilterToggle,
  setModalityOverride,
  getModelsForModalityFilter,
  setRoleOverride,
  renderModelRouting,
  setAgentOverride,
  onLlmProviderChanged,
  onLlmModelChanged,
  renderProviderCards,
  toggleProviderCard,
  toggleApiKeyVisibility,
  saveProviderCardSettings,
  saveProviderCardApiKey,
  removeProviderCardApiKey,
  testProviderConnection,
  discoverModels,
  renderLlmAudit,
  exportLlmAuditJson,
  copyLlmAuditJson,
  buildLlmAuditPayload,
  exportLlmAuditCsv,
  renderSettingsPanel,
  sec,
  readonlyRow,
  badgeRow,
  numberRow,
  selectRow,
  toggleSettingsSection,
  markSettingDirty,
  saveSettings,
  toggleSshpPreference,
  savePowerModePreference,
  updatePowerTelemetry,
  recheckReadiness,
  toggleReadinessCat,
  toggleReadinessCheck,
  fixReadinessCheck,
  resolveReadinessCheck,
  toggleOnboardingExpand,
  initSettingsTab,
  refreshLlreTelemetry,
  toggleSRPanel,
  onSRLeftProviderChanged,
  onSRRightProviderChanged,
  onSRModelChanged,
  saveSRConfig,
  toggleSRActivation,
  onSRPresetSelected,
  promptSaveSRPreset,
  cancelSaveSRPreset,
  confirmSaveSRPreset,
  deleteSRPreset,
  suggestSRModels,
  refreshOAuthStatus,
  oauthConnect,
  oauthDisconnect,
  refreshCacChain,
  exportCacAuditJson: exportCacAuditJsonHandler,
  testTool,
  checkPluginHealth,
  updateToolsFilter,
  renderToolsOverviewBar,
  renderToolsPanel,
  showRegisterToolForm,
  cancelRegisterTool,
  submitRegisterTool,
  renderPluginsPanel,
  showInstallPluginForm,
  cancelInstallPlugin,
  submitInstallPlugin,
  renderUtilitiesPanel,
  computePanelSummary,
  renderPanelSummaries,
  switchToolsSubTab,
  setToolsSort,
  setPluginsSort,
  setUtilitiesSort,
  refreshAllToolStatus,
  renderDiagnosticsPanel,
  runBrowserDiagnostics,
  loadDiagnosticsReport,
  computeDiagnosticsSummary,
  handleDiagnosticsWsMessage,
  toggleDiagnosticSuite,
  computeAgentDiagnosticsSummary,
  loadAgentDiagnosticsReport,
  runAgentDiagnostics,
  handleAgentDiagnosticsWsMessage,
  toggleAgentDiagnosticSuite,
  renderAgentDiagnosticsPanel,
  computeComputerDiagnosticsSummary,
  loadComputerDiagnosticsReport,
  runComputerDiagnostics,
  handleComputerDiagnosticsWsMessage,
  toggleComputerDiagnosticSuite,
  renderComputerDiagnosticsPanel,
  computeKnowledgeGraphDiagnosticsSummary,
  loadKnowledgeGraphDiagnosticsReport,
  runKnowledgeGraphDiagnostics,
  handleKnowledgeGraphDiagnosticsWsMessage,
  toggleKnowledgeGraphDiagnosticSuite,
  renderKnowledgeGraphDiagnosticsPanel,
  computeWorkspaceDiagnosticsSummary,
  loadWorkspaceDiagnosticsReport,
  runWorkspaceDiagnostics,
  handleWorkspaceDiagnosticsWsMessage,
  toggleWorkspaceDiagnosticSuite,
  renderWorkspaceDiagnosticsPanel,
  computeNetworkDiagnosticsSummary,
  loadNetworkDiagnosticsReport,
  runNetworkDiagnostics,
  handleNetworkDiagnosticsWsMessage,
  toggleNetworkDiagnosticSuite,
  renderNetworkDiagnosticsPanel,
  computeTelemetryDiagnosticsSummary,
  loadTelemetryDiagnosticsReport,
  runTelemetryDiagnostics,
  handleTelemetryDiagnosticsWsMessage,
  toggleTelemetryDiagnosticSuite,
  renderTelemetryDiagnosticsPanel,
  computeLogsDiagnosticsSummary,
  loadLogsDiagnosticsReport,
  runLogsDiagnostics,
  handleLogsDiagnosticsWsMessage,
  toggleLogsDiagnosticSuite,
  renderLogsDiagnosticsPanel,
  computeSchedulerDiagnosticsSummary,
  loadSchedulerDiagnosticsReport,
  runSchedulerDiagnostics,
  handleSchedulerDiagnosticsWsMessage,
  toggleSchedulerDiagnosticSuite,
  renderSchedulerDiagnosticsPanel,
  computeDemoDiagnosticsSummary,
  loadDemoDiagnosticsReport,
  runDemoDiagnostics,
  handleDemoDiagnosticsWsMessage,
  toggleDemoDiagnosticSuite,
  renderDemoDiagnosticsPanel,
  renderAgentList,
  renderSubAgentTree,
  renderSwarmTopology,
  renderAgentTelemetry,
  refreshAgentList,
  launchNewAgent,
  stopAgent,
  promoteAgent,
  demoteAgent,
  createSwarm,
  refreshSwarmStatus,
  refreshCshHandoffs,
  takeCshControl,
  resumeCshAgent,
  initAgenticTab,
  viewAutonomousGoalTrace,
  renderLocalSystemInfo,
  renderUsageMetrics,
  drawSparkline,
  runLocalCommand,
  submitAutonomousGoal,
  pauseAutonomousGoal,
  resumeAutonomousGoal,
  terminateAutonomousGoal,
  pollAutonomousStatus,
  refreshEnvVars,
  renderEnvVarsList,
  openPolicyEditor,
  refreshPolicyStatus,
  refreshDeviceManager,
  renderDeviceTree,
  openSystemDeviceManager,
  toggleDeviceProperties,
  filterDeviceTree,
  generateDeviceReport,
  captureScreengrab,
  burstCapture,
  showCaptureDiagnostics,
  runFramebufferDiagnostics,
  refreshFramebufferViewer,
  clearFramebufferPreviewVideo,
  setFramebufferPreviewSource,
  setFramebufferPreviewVideoSource,
  detectBurstVideoMimeType,
  loadFramebufferImage,
  buildBurstVideoPreview,
  formatFramebufferTimestamp,
  formatBurstTimestamp,
  summarizeFramebufferSelection,
  previewSelectedFramebufferItem,
  refreshFramebufferGallery,
  selectFramebufferFile,
  openFramebufferFile,
  revealFramebufferFile,
  openFramebufferFolder,
  toggleFramebufferAutoRefresh,
  toggleBurstPlayPause,
  stopBurstFromUI,
  setBurstSpeed,
  initComputerTab,
  pollUsage,
  launchBrowserPreview,
  openBrowserDevTools,
  refreshBrowserInfo,
  setBrowserView,
  toggleBrowserDevTools,
  browserRefreshStorage,
  setStorageSubView,
  renderStorageContent,
  browserRefreshProfiles,
  renderBrowserProfiles,
  browserRefreshLaunchProfiles,
  browserCreateProfile,
  browserDeleteProfile,
  browserLaunchSession,
  browserCloseSession,
  browserNavigate,
  browserTakeScreenshot,
  browserClickElement,
  browserTypeText,
  browserEvaluate,
  browserRefreshNetwork,
  browserRefreshConsole,
  browserRefreshDom,
  browserRunDiagnostics,
  browserSessionChanged,
  populateBrowserSessionDropdowns,
  renderBrowserSessions,
  browserLogAction,
  initBrowserTab,
  refreshSessionsList,
  submitBrowserAutopilot,
  stopBrowserAutopilot,
  resumeActiveCsh,
  updateSshpShieldIndicator,
  renderSelfReview,
  renderRetrievalObservability,
  setTelemetryWindow,
  renderRuntimeExcellence,
  renderReleaseReadiness,
  renderWhatChanged,
  deltaLabel,
  pct,
  renderPackageHistory,
  renderChatTelemetry,
  renderUsagePanel,
  refreshUsagePanel,
  setUsageSort,
  saveUsageCaps,
  clearUsageCaps,
  renderEvents,
  renderTraceView,
  loadTrace,
  renderActions,
  renderApprovals,
  renderActionHistory,
  renderToolCallLog,
  captureIncidentBundle,
  initSchedulerTab,
  refreshSchedulerData,
  switchSchedulerView,
  renderSchedulerPanel,
  setCalMode,
  schedCalNav,
  daysInMonth,
  eventsForDate,
  formatDateStr,
  isToday,
  renderSchedulerCalendar,
  mondayOfWeek,
  renderMiniMonth,
  renderFullMonth,
  renderWeekView,
  renderDayView,
  renderSchedulerProjects,
  openProjectDetail,
  renderSchedulerBoard,
  initBoardDragDrop,
  renderSchedulerGantt,
  openSchedulerModal,
  closeSchedulerModal,
  saveSchedulerModal,
  refreshWorkspaceInfo,
  refreshGitStatus,
  refreshWorkspaceFiles,
  renderWorkspaceFileTree,
  formatFileSize,
  filterWorkspaceFiles,
  openWorkspaceInExplorer,
  changeWorkspaceLocation,
  showImportStatus,
  triggerWorkspaceImport,
  triggerGeneralImport,
  triggerRegisteredImport,
  triggerFolderImport,
  readFileAsBase64,
  refreshImportHistory,
  renderImportHistory,
  initWorkspaceTab,
  clearCharacterPanelStatus,
  renderCharacterSummary,
  renderCharacterDefinitionPreview,
  filterCharacterAssignments,
  toggleCharacterAssignmentDetails,
  renderCharacterRoster,
  renderCharacterAuditLog,
  renderCharacterAssignmentForm,
  loadAvailableCharacters,
  refreshCharacterAssignments,
  refreshCharacterAuditLog,
  refreshCharacterPanel,
  submitCharacterAssignment,
  dispatchCharacterAssignment,
  suspendCharacterAssignment,
  resumeCharacterAssignment,
  revokeCharacterAssignment,
  onCharacterDefinitionChanged,
  onProfileChanged,
  onWorkspaceHubBlur,
  initCharacterPanel,
  onCharacterChipClick,
  showCustomCharacterModal,
  closeCustomCharacterModal,
  onCustomCharProfileChange,
  submitCustomCharacter,
  renderNetworkToolsPanel,
  renderNetworkSettingsPanel,
  renderNetworkTelemetryPanel,
  renderNetworkConsolePanel,
  runNetworkCommand,
  refreshNetworkInterfaces,
  refreshNetworkTelemetry,
  renderNetworkIntelligencePanel,
  checkVrgcStatus,
  runVrgcResearch,
  runVrgcSecurityScan,
  runVrgcPerformanceTest,
  runVrgcFtpBrowse,
  bootstrap,
  render,
  setActiveTab,
  renderTabs,
  renderGuardianPanel,
  refreshGuardianStatus,
  startGuardian,
  stopGuardian,
  configureGuardian,
  refreshLocalModels,
  updateGuardianModel,
  onGuardianModelSelectChange,
  deleteLocalModel,
  addToRecommended,
  removeFromRecommended,
  loadCustomRecommendedModels,
  refreshGuardianTasks,
  runGuardianTask,
  toggleGuardianTask,
  runAllGuardianTasks,
  downloadRecommendedModels,
  startModelDownload,
  updateBurstMediaBar,
  stopBurstFrameAnimation,
  startBurstFrameAnimation,
  showThinkingTraceModal,
});

// Boot marker — if this line prints, the ES module graph evaluated and window.createSession is wired.
// If the "New Session" button still does nothing, inspect for CSS/overlay or auth failure instead.
try {
  console.log('[boot] dashboard-app.js wired window.createSession =', typeof window.createSession);
} catch (_) { /* noop */ }

// Resilient click binding for the "New Session" button.
// The inline onclick="createSession()" depends on a working global; this fallback catches the case
// where something prevents that global from being callable and logs a visible diagnostic instead of
// silently doing nothing. Additive — the inline onclick still runs first.
(function wireNewSessionButton() {
  function attach() {
    var btn = document.getElementById('new-session-button');
    if (!btn) return;
    if (btn.dataset.prismWired === '1') return;
    btn.dataset.prismWired = '1';
    btn.addEventListener('click', async function (ev) {
      // Only handle the event if the inline onclick did not already fire a fetch.
      // We can't tell from here, so we defer slightly and only act if the global is missing.
      if (typeof window.createSession !== 'function') {
        ev.preventDefault();
        console.error('[new-session] window.createSession is not a function (type=' + typeof window.createSession + '). Module wiring failed — reload and inspect console for red errors above.');
        alert('PRISM: cannot create a new session — the dashboard JavaScript did not finish loading. Please reload the page. If this persists, open DevTools (F12) → Console and report the first red error.');
        return;
      }
      try {
        // Inline onclick runs synchronously and already started the fetch; this listener just logs.
        console.log('[new-session] button clicked; window.createSession=' + typeof window.createSession);
      } catch (err) {
        console.error('[new-session] click handler threw:', err);
      }
    }, true); // capture phase so we log before any stopPropagation
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach, { once: true });
  } else {
    attach();
  }
})();

// Resize handle
(function () {
  var handle = document.getElementById('resize-handle');
  var app = document.getElementById('app');
  var sidebar = document.getElementById('sidebar');
  if (!handle || !app || !sidebar) return;
  var dragging = false;
  var startX = 0;
  var startWidth = 0;
  handle.addEventListener('mousedown', function (e) {
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startWidth = sidebar.getBoundingClientRect().width;
    handle.classList.add('active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', function (e) {
    if (!dragging) return;
    var newWidth = Math.max(200, Math.min(600, startWidth + (e.clientX - startX)));
    app.style.setProperty('--sidebar-width', newWidth + 'px');
  });
  document.addEventListener('mouseup', function () {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
})();

// Phase A3B: Expose unified telemetry + identity functions to HTML onclick handlers
window.clearUnifiedTelemetry = clearUnifiedTelemetry;
window.refreshIdentityPanel = refreshIdentityPanel;
window.refreshTabSessions = refreshTabSessions;
window.initializeSupportDesk = initializeSupportDesk;
window.filterSupportCatalog = filterSupportCatalog;
window.triggerSelfHealingSweep = triggerSelfHealingSweep;
window.toggleSupportItem = toggleSupportItem;

// Phase A3B: Support Tickets and Live Console Bindings
window.reconnectMcpServer = reconnectMcpServer;
window.toggleLiveConsolePause = toggleLiveConsolePause;
window.clearLiveConsole = clearLiveConsole;
window.copyLiveConsole = copyLiveConsole;
window.copyActivityLogs = copyActivityLogs;
window.copyUnifiedTelemetry = copyUnifiedTelemetry;
window.toggleCreateTicketForm = toggleCreateTicketForm;
window.submitSupportTicket = submitSupportTicket;
window.investigateSupportTicket = investigateSupportTicket;
window.selfHealSupportTicket = selfHealSupportTicket;
window.resolveSupportTicketPrompt = resolveSupportTicketPrompt;
window.deleteSupportTicket = deleteSupportTicket;
