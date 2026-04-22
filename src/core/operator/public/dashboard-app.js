// Dashboard App — entry point, imports all modules, wires window.*
import { state, tabs, request, escapeHtml, renderMarkdown, formatRelativeTime, safeIso, statusBadge, metricRow, healthDot, timeAgo, renderStars, approvalBadge, formatUptime, togglePanelCollapse, safeRenderStep, dashboardLog, renderLogsPanel, filterLogs, clearLogs, getToolState, getPluginState, getUtilityState, getReview, setItemRating, setItemApproval, saveItemNotes, toggleItemExpand, toggleItemEnabled, toCsvValue, authHeaders, wsUrl, createReconnector } from './dashboard-core.js';
import { reconcileExpandedSessionPackages, loadSessionPackages, loadSessionPackageHistory, mutateSessionPackage, getPackagedSessionIdSet, buildSessionTimeline, exportSession, importSession, packageSessions, toggleSessionPackage, getSessionsForPackage, runPackageWorkflow, setPackageStatus, cyclePackageStatus, exportPackageTrace, unpackageSessionPackage, getLocalLlmSelection, setLocalLlmSelection, clearLocalLlmSelection, loadSessions, createSession, loadMessages, refreshChrome, renderSessions, renderOnboarding, renderToolBlocks, renderMessages, renderOverview, renderBrandPanel, selectSession, deleteSession, renameSession, copySession, handleFileSelect, pasteFromClipboard, removeAttachment, renderAttachmentPreview, uploadAttachments, sendMessage, runAction, quickApplyLlm, refreshOllamaModels, rollbackLlmConfig, approve, deny, connectAgenticStream } from './tab-chat.js';
import { renderRoutingStrategyControls, renderLlm, onHeaderProviderChanged, onHeaderModelChanged, renderHeader, fetchReadinessAndRefresh, toggleCapabilityMatrix, setMatrixSort, setMatrixFilter, setMatrixDraftField, clearMatrixDraft, startMatrixEdit, saveMatrixEntry, deleteMatrixEntry, updateModelMatrix, renderCapabilityMatrix, guessTier, resolveMatrixEntry, sortArrow, getModelProficiencyBadges, getModelModalityBadges, fetchModelProfiles, fetchRoutingState, saveRoutingConfig, suggestOptimalRouting, setRoutingStrategy, setSessionRoutingStrategy, onModalitySelected, onModalityFilterToggle, setModalityOverride, getModelsForModalityFilter, setRoleOverride, renderModelRouting, setAgentOverride, onLlmProviderChanged, onLlmModelChanged, renderProviderCards, toggleProviderCard, toggleApiKeyVisibility, saveProviderCardSettings, saveProviderCardApiKey, removeProviderCardApiKey, testProviderConnection, discoverModels, renderLlmAudit, exportLlmAuditJson, copyLlmAuditJson, buildLlmAuditPayload, exportLlmAuditCsv, renderSettingsPanel, sec, readonlyRow, badgeRow, numberRow, selectRow, toggleSettingsSection, markSettingDirty, saveSettings, recheckReadiness, toggleReadinessCat, toggleReadinessCheck, fixReadinessCheck, resolveReadinessCheck, toggleOnboardingExpand, initSettingsTab, toggleSRPanel, onSRLeftProviderChanged, onSRRightProviderChanged, onSRModelChanged, saveSRConfig, toggleSRActivation, onSRPresetSelected, promptSaveSRPreset, cancelSaveSRPreset, confirmSaveSRPreset, deleteSRPreset, suggestSRModels, refreshOAuthStatus, oauthConnect, oauthDisconnect, refreshCacChain, exportCacAuditJson as exportCacAuditJsonHandler } from './tab-settings.js';
import { testTool, checkPluginHealth, updateToolsFilter, renderToolsOverviewBar, renderToolsPanel, showRegisterToolForm, cancelRegisterTool, submitRegisterTool, renderPluginsPanel, showInstallPluginForm, cancelInstallPlugin, submitInstallPlugin, renderUtilitiesPanel, computePanelSummary, renderPanelSummaries, switchToolsSubTab, setToolsSort, setPluginsSort, setUtilitiesSort, refreshAllToolStatus, renderDiagnosticsPanel, runBrowserDiagnostics, loadDiagnosticsReport, computeDiagnosticsSummary, handleDiagnosticsWsMessage, toggleDiagnosticSuite, computeAgentDiagnosticsSummary, loadAgentDiagnosticsReport, runAgentDiagnostics, handleAgentDiagnosticsWsMessage, toggleAgentDiagnosticSuite, renderAgentDiagnosticsPanel, computeComputerDiagnosticsSummary, loadComputerDiagnosticsReport, runComputerDiagnostics, handleComputerDiagnosticsWsMessage, toggleComputerDiagnosticSuite, renderComputerDiagnosticsPanel, computeKnowledgeGraphDiagnosticsSummary, loadKnowledgeGraphDiagnosticsReport, runKnowledgeGraphDiagnostics, handleKnowledgeGraphDiagnosticsWsMessage, toggleKnowledgeGraphDiagnosticSuite, renderKnowledgeGraphDiagnosticsPanel, computeWorkspaceDiagnosticsSummary, loadWorkspaceDiagnosticsReport, runWorkspaceDiagnostics, handleWorkspaceDiagnosticsWsMessage, toggleWorkspaceDiagnosticSuite, renderWorkspaceDiagnosticsPanel, computeNetworkDiagnosticsSummary, loadNetworkDiagnosticsReport, runNetworkDiagnostics, handleNetworkDiagnosticsWsMessage, toggleNetworkDiagnosticSuite, renderNetworkDiagnosticsPanel, computeTelemetryDiagnosticsSummary, loadTelemetryDiagnosticsReport, runTelemetryDiagnostics, handleTelemetryDiagnosticsWsMessage, toggleTelemetryDiagnosticSuite, renderTelemetryDiagnosticsPanel, computeLogsDiagnosticsSummary, loadLogsDiagnosticsReport, runLogsDiagnostics, handleLogsDiagnosticsWsMessage, toggleLogsDiagnosticSuite, renderLogsDiagnosticsPanel, computeSchedulerDiagnosticsSummary, loadSchedulerDiagnosticsReport, runSchedulerDiagnostics, handleSchedulerDiagnosticsWsMessage, toggleSchedulerDiagnosticSuite, renderSchedulerDiagnosticsPanel, computeDemoDiagnosticsSummary, loadDemoDiagnosticsReport, runDemoDiagnostics, handleDemoDiagnosticsWsMessage, toggleDemoDiagnosticSuite, renderDemoDiagnosticsPanel, pollPluginHealth, startPluginHealthPolling, stopPluginHealthPolling } from './tab-tools.js';
import { renderGuardianPanel, refreshGuardianStatus, startGuardian, stopGuardian, configureGuardian, refreshLocalModels, updateGuardianModel, addToRecommended, removeFromRecommended, loadCustomRecommendedModels, downloadRecommendedModels, startModelDownload, refreshGuardianTasks, runGuardianTask, toggleGuardianTask, runAllGuardianTasks, renderAgentList, renderSubAgentTree, renderSwarmTopology, renderAgentTelemetry, refreshAgentList, launchNewAgent, stopAgent, promoteAgent, demoteAgent, createSwarm, refreshSwarmStatus, initAgenticTab } from './tab-agentic.js';
import { renderLocalSystemInfo, renderUsageMetrics, drawSparkline, runLocalCommand, refreshEnvVars, renderEnvVarsList, openPolicyEditor, refreshPolicyStatus, refreshDeviceManager, renderDeviceTree, openSystemDeviceManager, toggleDeviceProperties, filterDeviceTree, generateDeviceReport, captureScreengrab, burstCapture, showCaptureDiagnostics, runFramebufferDiagnostics, refreshFramebufferViewer, clearFramebufferPreviewVideo, setFramebufferPreviewSource, setFramebufferPreviewVideoSource, detectBurstVideoMimeType, loadFramebufferImage, buildBurstVideoPreview, formatFramebufferTimestamp, formatBurstTimestamp, summarizeFramebufferSelection, previewSelectedFramebufferItem, refreshFramebufferGallery, selectFramebufferFile, openFramebufferFile, revealFramebufferFile, openFramebufferFolder, toggleFramebufferAutoRefresh, toggleBurstPlayPause, stopBurstFromUI, setBurstSpeed, initComputerTab, pollUsage, updateBurstMediaBar, stopBurstFrameAnimation, startBurstFrameAnimation } from './tab-computer.js';
import { launchBrowserPreview, openBrowserDevTools, refreshBrowserInfo, setBrowserView, toggleBrowserDevTools, browserRefreshStorage, setStorageSubView, renderStorageContent, browserRefreshProfiles, renderBrowserProfiles, browserRefreshLaunchProfiles, browserCreateProfile, browserDeleteProfile, browserLaunchSession, browserCloseSession, browserNavigate, browserTakeScreenshot, browserClickElement, browserTypeText, browserEvaluate, browserRefreshNetwork, browserRefreshConsole, browserRefreshDom, browserRunDiagnostics, browserSessionChanged, populateBrowserSessionDropdowns, renderBrowserSessions, browserLogAction, initBrowserTab, refreshSessionsList } from './tab-browser.js';
import { renderSelfReview, renderRetrievalObservability, setTelemetryWindow, renderRuntimeExcellence, renderReleaseReadiness, renderWhatChanged, deltaLabel, pct, renderPackageHistory, renderChatTelemetry, renderUsagePanel, refreshUsagePanel, setUsageSort, saveUsageCaps, clearUsageCaps, refreshSloGauges, startSloAutoRefresh, stopSloAutoRefresh } from './tab-telemetry.js';
import { renderEvents, renderTraceView, loadTrace, renderActions, renderApprovals, renderActionHistory, renderToolCallLog, captureIncidentBundle } from './tab-logs.js';
import { initSchedulerTab, refreshSchedulerData, switchSchedulerView, renderSchedulerPanel, setCalMode, schedCalNav, daysInMonth, eventsForDate, formatDateStr, isToday, renderSchedulerCalendar, mondayOfWeek, renderMiniMonth, renderFullMonth, renderWeekView, renderDayView, renderSchedulerProjects, openProjectDetail, renderSchedulerBoard, initBoardDragDrop, renderSchedulerGantt, openSchedulerModal, closeSchedulerModal, saveSchedulerModal } from './tab-scheduler.js';
import { refreshWorkspaceInfo, refreshGitStatus, refreshWorkspaceFiles, renderWorkspaceFileTree, formatFileSize, filterWorkspaceFiles, openWorkspaceInExplorer, changeWorkspaceLocation, showImportStatus, triggerWorkspaceImport, triggerGeneralImport, triggerRegisteredImport, triggerFolderImport, readFileAsBase64, refreshImportHistory, renderImportHistory, initWorkspaceTab } from './tab-workspace.js';
import { clearCharacterPanelStatus, renderCharacterSummary, renderCharacterDefinitionPreview, filterCharacterAssignments, toggleCharacterAssignmentDetails, renderCharacterRoster, renderCharacterAuditLog, renderCharacterAssignmentForm, loadAvailableCharacters, loadWorkspaceHub, refreshCharacterAssignments, refreshCharacterAuditLog, refreshCharacterPanel, submitCharacterAssignment, dispatchCharacterAssignment, suspendCharacterAssignment, resumeCharacterAssignment, revokeCharacterAssignment, onCharacterDefinitionChanged, onProfileChanged, onWorkspaceHubBlur, initCharacterPanel } from './tab-characters.js';
import { renderNetworkToolsPanel, renderNetworkSettingsPanel, renderNetworkTelemetryPanel, renderNetworkConsolePanel, runNetworkCommand, refreshNetworkInterfaces, refreshNetworkTelemetry, renderNetworkIntelligencePanel, checkVrgcStatus, runVrgcResearch, runVrgcSecurityScan, runVrgcPerformanceTest, runVrgcFtpBrowse } from './tab-network.js';
import { initHardwareTab, refreshHardwareSwarm, loadModelToSlot, unloadModelSlot } from './tab-hardware.js';

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
async function bootstrap() {
  try {
    await loadSessions();
    if (state.sessions.length === 0) {
      await createSession();
    } else {
      await Promise.all([refreshChrome(), loadMessages()]);
    }
    // Load model profiles and routing config in background
    fetchModelProfiles();
    fetchRoutingState();

    // Connect to streams for real-time progress and UI actions
    connectAgenticStream();
    connectWebSocket();
  } catch (error) {
    state.notice = String(error);
  } finally {
    render();
  }
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


function setActiveTab(tabId) {
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
  state.activeTab = tabId;
  if (tabId === 'settings') {
    refreshChrome().then(function () { render(); });
    refreshOAuthStatus().then(function () { render(); });
    initSettingsTab();
  }
  if (tabId === 'agentic') {
    initAgenticTab();
    refreshGuardianStatus();
    initHardwareTab();
  }
  if (tabId === 'workspace') {
    initWorkspaceTab();
    initCharacterPanel();
  }
  if (tabId === 'computer') {
    initComputerTab();
  }
  if (tabId === 'browser') {
    initBrowserTab().catch(function () { });
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
  }
  if (tabId === 'scheduler') {
    initSchedulerTab();
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

var _wsReconnector = createReconnector(connectWebSocket, { label: 'ws', baseDelay: 1000, maxDelay: 30000, maxRetries: 50 });

function connectWebSocket() {
  const ws = new WebSocket(wsUrl('/ws'));

  ws.onopen = () => {
    console.log('[ws] connected');
    _wsReconnector.reset();
    // Update connection indicator
    var dot = document.getElementById('prism-ws-status');
    if (dot) { dot.style.background = '#22c55e'; dot.title = 'WebSocket connected'; }
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'ui_action' && data.action === 'switch_tab' && data.tabId) {
        setActiveTab(data.tabId);
      }
      if (data.type === 'guardian_event') {
        dashboardLog('agentic', 'guardian.event', data.detail || data.operation);
        if (state.activeTab === 'agentic') {
          refreshGuardianStatus();
          refreshGuardianTasks();
        }
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
    } catch (e) {
      console.error('[ws] message error:', e);
    }
  };

  ws.onclose = () => {
    console.log('[ws] disconnected');
    var dot = document.getElementById('prism-ws-status');
    if (dot) { dot.style.background = '#ef4444'; dot.title = 'WebSocket disconnected — reconnecting…'; }
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

// Keyboard shortcut: Enter sends message
var comp = document.getElementById('composer');
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
  recheckReadiness,
  toggleReadinessCat,
  toggleReadinessCheck,
  fixReadinessCheck,
  resolveReadinessCheck,
  toggleOnboardingExpand,
  initSettingsTab,
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
  initAgenticTab,
  renderLocalSystemInfo,
  renderUsageMetrics,
  drawSparkline,
  runLocalCommand,
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
});

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
