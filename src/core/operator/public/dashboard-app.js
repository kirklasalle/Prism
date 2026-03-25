// Dashboard App — entry point, imports all modules, wires window.*
import { state, tabs, request, escapeHtml, renderMarkdown, formatRelativeTime, safeIso, statusBadge, metricRow, healthDot, timeAgo, renderStars, approvalBadge, formatUptime, togglePanelCollapse, safeRenderStep, dashboardLog, renderLogsPanel, filterLogs, clearLogs, getToolState, getPluginState, getUtilityState, getReview, setItemRating, setItemApproval, saveItemNotes, toggleItemExpand, toggleItemEnabled, toCsvValue } from './dashboard-core.js';
import { reconcileExpandedSessionPackages, loadSessionPackages, loadSessionPackageHistory, mutateSessionPackage, getPackagedSessionIdSet, buildSessionTimeline, exportSession, importSession, packageSessions, toggleSessionPackage, getSessionsForPackage, runPackageWorkflow, setPackageStatus, cyclePackageStatus, exportPackageTrace, unpackageSessionPackage, getLocalLlmSelection, setLocalLlmSelection, clearLocalLlmSelection, loadSessions, createSession, loadMessages, refreshChrome, renderSessions, renderOnboarding, renderToolBlocks, renderMessages, renderOverview, renderBrandPanel, selectSession, deleteSession, renameSession, copySession, handleFileSelect, pasteFromClipboard, removeAttachment, renderAttachmentPreview, uploadAttachments, sendMessage, runAction, quickApplyLlm, refreshOllamaModels, rollbackLlmConfig, approve, deny, connectAgenticStream } from './tab-chat.js';
import { renderRoutingStrategyControls, renderLlm, onHeaderProviderChanged, onHeaderModelChanged, renderHeader, fetchReadinessAndRefresh, toggleCapabilityMatrix, setMatrixSort, setMatrixFilter, setMatrixDraftField, clearMatrixDraft, startMatrixEdit, saveMatrixEntry, deleteMatrixEntry, renderCapabilityMatrix, guessTier, resolveMatrixEntry, sortArrow, getModelProficiencyBadges, fetchModelProfiles, fetchRoutingState, saveRoutingConfig, suggestOptimalRouting, setRoutingStrategy, setSessionRoutingStrategy, onModalitySelected, onModalityFilterToggle, setModalityOverride, getModelsForModalityFilter, setRoleOverride, renderModelRouting, setAgentOverride, onLlmProviderChanged, onLlmModelChanged, renderProviderCards, toggleProviderCard, toggleApiKeyVisibility, saveProviderCardSettings, saveProviderCardApiKey, removeProviderCardApiKey, testProviderConnection, discoverModels, renderLlmAudit, exportLlmAuditJson, copyLlmAuditJson, buildLlmAuditPayload, exportLlmAuditCsv, renderSettingsPanel, sec, readonlyRow, badgeRow, numberRow, selectRow, toggleSettingsSection, markSettingDirty, saveSettings, recheckReadiness, toggleReadinessCat, toggleReadinessCheck, fixReadinessCheck, resolveReadinessCheck, toggleOnboardingExpand, initSettingsTab } from './tab-settings.js';
import { testTool, checkPluginHealth, updateToolsFilter, renderToolsOverviewBar, renderToolsPanel, showRegisterToolForm, cancelRegisterTool, submitRegisterTool, renderPluginsPanel, showInstallPluginForm, cancelInstallPlugin, submitInstallPlugin, renderUtilitiesPanel } from './tab-tools.js';
import { renderAgentList, renderSubAgentTree, renderSwarmTopology, renderAgentTelemetry, refreshAgentList, launchNewAgent, stopAgent, promoteAgent, demoteAgent, createSwarm, refreshSwarmStatus, initAgenticTab } from './tab-agentic.js';
import { renderLocalSystemInfo, renderUsageMetrics, drawSparkline, runLocalCommand, refreshEnvVars, renderEnvVarsList, openPolicyEditor, refreshPolicyStatus, refreshDeviceManager, renderDeviceTree, openSystemDeviceManager, captureScreengrab, burstCapture, showCaptureDiagnostics, runFramebufferDiagnostics, refreshFramebufferViewer, clearFramebufferPreviewVideo, setFramebufferPreviewSource, setFramebufferPreviewVideoSource, detectBurstVideoMimeType, loadFramebufferImage, buildBurstVideoPreview, formatFramebufferTimestamp, formatBurstTimestamp, summarizeFramebufferSelection, previewSelectedFramebufferItem, refreshFramebufferGallery, selectFramebufferFile, openFramebufferFile, revealFramebufferFile, openFramebufferFolder, toggleFramebufferAutoRefresh, toggleBurstPlayPause, stopBurstFromUI, setBurstSpeed, initComputerTab, pollUsage } from './tab-computer.js';
import { launchBrowserPreview, openBrowserDevTools, refreshBrowserInfo, setBrowserView, toggleBrowserDevTools, browserRefreshStorage, setStorageSubView, renderStorageContent, browserRefreshProfiles, renderBrowserProfiles, browserRefreshLaunchProfiles, browserCreateProfile, browserDeleteProfile, browserLaunchSession, browserCloseSession, browserNavigate, browserTakeScreenshot, browserClickElement, browserTypeText, browserEvaluate, browserRefreshNetwork, browserRefreshConsole, browserRefreshDom, browserRunDiagnostics, browserSessionChanged, populateBrowserSessionDropdowns, renderBrowserSessions, browserLogAction, initBrowserTab, refreshSessionsList } from './tab-browser.js';
import { renderSelfReview, renderRetrievalObservability, setTelemetryWindow, renderRuntimeExcellence, renderReleaseReadiness, renderWhatChanged, deltaLabel, pct, renderPackageHistory, renderChatTelemetry } from './tab-telemetry.js';
import { renderEvents, renderTraceView, loadTrace, renderActions, renderApprovals, renderActionHistory, renderToolCallLog } from './tab-logs.js';
import { initSchedulerTab, refreshSchedulerData, switchSchedulerView, renderSchedulerPanel, setCalMode, schedCalNav, daysInMonth, eventsForDate, formatDateStr, isToday, renderSchedulerCalendar, mondayOfWeek, renderMiniMonth, renderFullMonth, renderWeekView, renderDayView, renderSchedulerProjects, openProjectDetail, renderSchedulerBoard, initBoardDragDrop, renderSchedulerGantt, openSchedulerModal, closeSchedulerModal, saveSchedulerModal } from './tab-scheduler.js';
import { refreshWorkspaceInfo, refreshGitStatus, refreshWorkspaceFiles, renderWorkspaceFileTree, formatFileSize, filterWorkspaceFiles, openWorkspaceInExplorer, changeWorkspaceLocation, showImportStatus, triggerWorkspaceImport, triggerGeneralImport, triggerRegisteredImport, triggerFolderImport, readFileAsBase64, refreshImportHistory, renderImportHistory, initWorkspaceTab } from './tab-workspace.js';
import { clearCharacterPanelStatus, renderCharacterSummary, renderCharacterDefinitionPreview, filterCharacterAssignments, toggleCharacterAssignmentDetails, renderCharacterRoster, renderCharacterAuditLog, renderCharacterAssignmentForm, loadAvailableCharacters, refreshCharacterAssignments, refreshCharacterAuditLog, refreshCharacterPanel, submitCharacterAssignment, dispatchCharacterAssignment, suspendCharacterAssignment, resumeCharacterAssignment, revokeCharacterAssignment, onCharacterDefinitionChanged, initCharacterPanel } from './tab-characters.js';
import { renderNetworkToolsPanel, renderNetworkSettingsPanel, renderNetworkTelemetryPanel, renderNetworkConsolePanel, runNetworkCommand, refreshNetworkInterfaces, refreshNetworkTelemetry } from './tab-network.js';


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
  safeRenderStep('actions', renderActions);
  safeRenderStep('approvals', renderApprovals);
  safeRenderStep('actionHistory', renderActionHistory);
  safeRenderStep('chatTelemetry', renderChatTelemetry);
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
    initSettingsTab();
  }
  if (tabId === 'agentic') {
    initAgenticTab();
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
  if (tabId === 'network') {
    refreshNetworkInterfaces();
    refreshNetworkTelemetry();
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
    return; // setTelemetryWindow calls render() — skip double render
  }
  render();
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
document.getElementById('composer').addEventListener('keydown', function (event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    void sendMessage();
  }
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
  renderCapabilityMatrix,
  guessTier,
  resolveMatrixEntry,
  sortArrow,
  getModelProficiencyBadges,
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
  renderEvents,
  renderTraceView,
  loadTrace,
  renderActions,
  renderApprovals,
  renderActionHistory,
  renderToolCallLog,
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
  initCharacterPanel,
  renderNetworkToolsPanel,
  renderNetworkSettingsPanel,
  renderNetworkTelemetryPanel,
  renderNetworkConsolePanel,
  runNetworkCommand,
  refreshNetworkInterfaces,
  refreshNetworkTelemetry,
  bootstrap,
  render,
  setActiveTab,
  renderTabs,
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
