import { createExtensionAuth } from "./auth-client.js";
import {
  DEFAULT_BLOCKED_DOMAINS,
  BLOCKED_PAGE_PATH,
  SESSION_REVOKE_MARGIN_MS,
  buildBlockingRules,
  getPermissionScopedSites,
  getBlockedTabQueryPatterns,
  isConfirmedSessionStart,
  isReconciliationCurrent,
  isSessionAuthorized,
  reconcileDynamicRules,
  removeAllowRules,
  validateExcludedHosts,
  validateBlockedSites,
} from "./blocking.js";

const STATE_KEY = "focusLockExtensionState";
const CACHED_SITES_KEY = "focusLockVerifiedBlockedSites";
const SESSION_ALARM = "focusLockSessionRevoke";
const DIAGNOSTIC_KEY = "focusLockSessionDiagnostics";
const WORKER_BUILD_ID = "2026-10-17-rule-validation-2";
const auth = createExtensionAuth();
let reconciliationQueue = Promise.resolve();
let dnrMutationQueue = Promise.resolve();
let accessGeneration = 0;
// TEMP diagnostic: retained only for this service-worker lifetime; contains sanitized error text.
let lastRuleReconciliationError = null;

async function recordSessionDiagnostic(stage, details = {}) {
  // Persist only timestamps, enums, rule metadata and sanitized error details.
  try {
    const stored = await chrome.storage.local.get(DIAGNOSTIC_KEY);
    const events = Array.isArray(stored[DIAGNOSTIC_KEY]) ? stored[DIAGNOSTIC_KEY] : [];
    events.push({ at: new Date().toISOString(), stage, ...details });
    await chrome.storage.local.set({ [DIAGNOSTIC_KEY]: events.slice(-40) });
  } catch {
    // Diagnostics must never interfere with session enforcement.
  }
}

async function clearSessionAlarm() {
  try {
    return await chrome.alarms.clear(SESSION_ALARM);
  } catch (error) {
    await recordSessionDiagnostic("session_alarm_clear_error", safeErrorDetails(error));
    throw error;
  }
}

async function scheduleStatusRetryAlarm(stage) {
  const scheduledTime = Date.now() + 30_000;
  try {
    await chrome.alarms.create(SESSION_ALARM, { when: scheduledTime });
    await recordSessionDiagnostic("status_retry_alarm_scheduled", {
      stage,
      scheduledTime: new Date(scheduledTime).toISOString(),
    });
  } catch (error) {
    await recordSessionDiagnostic("status_retry_alarm_error", {
      stage,
      ...safeErrorDetails(error),
    });
  }
}

function invalidateTemporaryAccess(reason) {
  accessGeneration += 1;
  void recordSessionDiagnostic("temporary_access_invalidated", {
    reason,
    generation: accessGeneration,
  });
  return accessGeneration;
}

function enqueueDnrMutation(task) {
  const operation = dnrMutationQueue.then(task);
  dnrMutationQueue = operation.catch(() => undefined);
  return operation;
}

async function enforceBlockedTabs(domains, reason) {
  if (!Array.isArray(domains) || domains.length === 0 || !chrome.tabs?.query || !chrome.tabs?.update) {
    return { redirected: 0, failed: 0 };
  }
  const patterns = getBlockedTabQueryPatterns(domains);
  let tabs;
  try {
    tabs = await chrome.tabs.query({ url: patterns });
  } catch (error) {
    await recordSessionDiagnostic("blocked_tab_query_error", {
      reason,
      ...safeErrorDetails(error),
    });
    return { redirected: 0, failed: 1 };
  }

  const blockedPageUrl = chrome.runtime.getURL(BLOCKED_PAGE_PATH);
  const results = await Promise.allSettled(
    tabs
      .filter((tab) => Number.isInteger(tab?.id))
      .map((tab) => chrome.tabs.update(tab.id, { url: blockedPageUrl })),
  );
  const redirected = results.filter((result) => result.status === "fulfilled").length;
  const failed = results.length - redirected;
  await recordSessionDiagnostic("blocked_tabs_enforced", {
    reason,
    matched: results.length,
    redirected,
    failed,
  });
  return { redirected, failed };
}

async function getYouTubeRuleSnapshot() {
  const query = async (readRules) => {
    try {
      return (await readRules())
        .filter((rule) => typeof rule.condition?.urlFilter === "string" &&
          rule.condition.urlFilter.toLowerCase().includes("youtube.com"))
        .filter((rule) => rule.action?.type === "redirect" || rule.action?.type === "allow")
        .map((rule) => ({
          id: rule.id,
          priority: rule.priority,
          action: rule.action.type,
          urlFilter: rule.condition.urlFilter,
          resourceTypes: Array.isArray(rule.condition.resourceTypes) ? rule.condition.resourceTypes : [],
        }));
    } catch (error) {
      return { error: safeErrorDetails(error) };
    }
  };
  const [dynamic, session] = await Promise.all([
    query(() => chrome.declarativeNetRequest.getDynamicRules()),
    query(() => chrome.declarativeNetRequest.getSessionRules()),
  ]);
  return { dynamic, session };
}

console.info("FocusLock extension worker loaded.", {
  buildId: WORKER_BUILD_ID,
  extensionVersion: chrome.runtime.getManifest().version,
});

function safeErrorDetails(error) {
  const name = error instanceof Error ? error.name : "UnknownError";
  const message = error instanceof Error ? error.message : "Unknown failure";
  return {
    name: String(name).slice(0, 60),
    message: String(message)
      .replace(/https?:\/\/[^\s"'<>]+/gi, "[url]")
      .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
      .replace(/\b(?:cookie|set-cookie)=\S+/gi, "cookie=[redacted]")
      .replace(/\b(?:sb_publishable|sb_secret)_[A-Za-z0-9_-]+/gi, "[redacted-key]")
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-token]")
      .replace(/\b(?:token|key|authorization)=\S+/gi, "[redacted-parameter]")
      .slice(0, 240),
  };
}

function logConfigStage(stage, state, error) {
  if (error) {
    console.error("FocusLock SET_CONFIG stage failed.", {
      stage,
      ...safeErrorDetails(error),
    });
    return;
  }
  console.info("FocusLock SET_CONFIG stage.", { stage, state });
}

function isConfigResponse(value) {
  return value !== null &&
    typeof value === "object" &&
    typeof value.ok === "boolean";
}

function diagnosticState(state) {
  return [
    "AUTHENTICATED",
    "AUTH_REQUIRED",
    "SIGNED_OUT",
    "AUTHENTICATION_EXPIRED",
    "NETWORK_UNAVAILABLE",
    "FORBIDDEN",
    "UNAVAILABLE",
    "NOT_DETECTED",
  ].includes(state) ? state : "UNKNOWN";
}

async function handleSetConfig(config) {
  console.info("FocusLock received SET_CONFIG.");
  logConfigStage("pre_save_reconciliation", "started");
  try {
    await reconcileFailClosed();
    logConfigStage("pre_save_reconciliation", "completed");
  } catch (error) {
    logConfigStage("pre_save_reconciliation", "failed", error);
    return {
      ok: false,
      reason: "BLOCKING_RECONCILIATION_FAILED",
      stage: "before_save",
    };
  }

  logConfigStage("validate_and_store", "started");
  let result;
  try {
    result = await auth.setConfig(config);
    if (!isConfigResponse(result)) {
      logConfigStage(
        "validate_and_store",
        "invalid_response",
        new Error("Auth service returned an invalid configuration response."),
      );
      return {
        ok: false,
        reason: "INVALID_SERVICE_RESPONSE",
        stage: "save",
      };
    }
    if (!result.ok) {
      logConfigStage("validate_and_store", "rejected");
      return {
        ok: false,
        reason: typeof result.reason === "string" ? result.reason : "CONFIG_SAVE_FAILED",
        stage: "save",
      };
    }
    logConfigStage("validate_and_store", "completed");
  } catch (error) {
    logConfigStage("validate_and_store", "failed", error);
    return { ok: false, reason: "CONFIG_SAVE_FAILED", stage: "save" };
  }

  logConfigStage("post_save_initialization", "started");
  try {
    await initializeAndReconcile();
    logConfigStage("post_save_initialization", "completed");
    return { ok: true };
  } catch (error) {
    logConfigStage("post_save_initialization", "failed", error);
    return {
      ok: true,
      warning: "CONFIG_SAVED_BLOCKING_RECONCILIATION_FAILED",
    };
  }
}

async function initializeState() {
  const stored = await chrome.storage.local.get(STATE_KEY);
  const state = stored[STATE_KEY];

  if (!state) {
    await chrome.storage.local.set({
      [STATE_KEY]: {
        schemaVersion: 1,
      },
    });
    return;
  }

  if (state.schemaVersion !== 1) {
    throw new Error("Unsupported extension state version.");
  }
}

function getHostname(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

async function getFailClosedSites() {
  const stored = await chrome.storage.local.get(CACHED_SITES_KEY);
  const sites = validateBlockedSites(stored[CACHED_SITES_KEY]);
  if (sites) return sites;
  return DEFAULT_BLOCKED_DOMAINS.map((domain) => ({ domain, enabled: true }));
}

async function reconcileFailClosed({ enforceOpenTabs = false, reason = "fail_closed" } = {}) {
  await clearSessionAlarm();
  await enqueueDnrMutation(() => removeAllowRules(chrome.declarativeNetRequest));
  const [sites, config] = await Promise.all([
    getFailClosedSites(),
    auth.getConfig(),
  ]);
  const excludedHosts = config.configured
    ? [getHostname(config.backendUrl), getHostname(config.supabaseUrl)].filter(Boolean)
    : [];
  const permissionState = await getPermissionScopedSites(
    sites,
    excludedHosts,
    async (origin) => chrome.permissions.contains({ origins: [origin] }),
  );
  if (!permissionState) {
    console.error("FocusLock host-permission validation failed.", {
      stage: "permission_scope_validation",
      siteInputType: Array.isArray(sites) ? "array" : typeof sites,
      siteCount: Array.isArray(sites) ? sites.length : null,
      blockedSitesValid: validateBlockedSites(sites) !== null,
      excludedHostsInputType: Array.isArray(excludedHosts) ? "array" : typeof excludedHosts,
      excludedHostCount: Array.isArray(excludedHosts) ? excludedHosts.length : null,
      excludedHostsValid: validateExcludedHosts(excludedHosts) !== null,
    });
    throw new Error("Unable to validate host-permission configuration.");
  }
  const plan = buildBlockingRules({ sites: permissionState.sites, excludedHosts });
  console.info("FocusLock fail-closed rule validation.", {
    stage: "rule_plan_validation",
    buildId: WORKER_BUILD_ID,
    siteCount: permissionState.sites.length,
    siteListState: permissionState.sites.length === 0
      ? "empty"
      : validateBlockedSites(permissionState.sites)
        ? "valid"
        : "invalid",
    excludedHostCount: excludedHosts.length,
    excludedHostsValid: validateExcludedHosts(excludedHosts) !== null,
    planValid: plan !== null,
  });
  if (!plan) throw new Error("Unable to validate blocked-site configuration.");

  try {
    await enqueueDnrMutation(() => reconcileDynamicRules(
      chrome.declarativeNetRequest,
      plan,
      { failClosed: true },
    ));
    lastRuleReconciliationError = null;
  } catch (error) {
    lastRuleReconciliationError = {
      stage: "fail_closed",
      ...safeErrorDetails(error),
    };
    await recordSessionDiagnostic("dnr_reconciliation_error", lastRuleReconciliationError);
    await enqueueDnrMutation(() => removeAllowRules(chrome.declarativeNetRequest));
    throw error;
  }
  await recordSessionDiagnostic("fail_closed_rules_applied", {
    rules: await getYouTubeRuleSnapshot(),
  });
  if (enforceOpenTabs) await enforceBlockedTabs(plan.domains, reason);
  return { missingOrigins: permissionState.missingOrigins, domains: plan.domains };
}

async function reconcileVerifiedStatus(result, expectedGeneration = accessGeneration) {
  if (!isReconciliationCurrent(expectedGeneration, accessGeneration)) {
    await recordSessionDiagnostic("stale_authorization_discarded", {
      expectedGeneration,
      currentGeneration: accessGeneration,
    });
    return reconcileFailClosed({ enforceOpenTabs: true, reason: "stale_authorization" });
  }
  if (result?.state !== "AUTHENTICATED" || !result.status) {
    const blocking = await reconcileFailClosed({ enforceOpenTabs: true, reason: "status_unverified" });
    if (result?.state === "NETWORK_UNAVAILABLE") {
      await scheduleStatusRetryAlarm("status_unverified");
    }
    return blocking;
  }

  const sites = validateBlockedSites(result.status.blockedSites);
  if (!sites) {
    return reconcileFailClosed({ enforceOpenTabs: true, reason: "invalid_status" });
  }

  await chrome.storage.local.set({ [CACHED_SITES_KEY]: sites });
  await clearSessionAlarm();

  const config = await auth.getConfig();
  const excludedHosts = config.configured
    ? [getHostname(config.backendUrl), getHostname(config.supabaseUrl)].filter(Boolean)
    : [];
  const permissionState = await getPermissionScopedSites(
    sites,
    excludedHosts,
    async (origin) => chrome.permissions.contains({ origins: [origin] }),
  );
  if (!permissionState) throw new Error("Unable to validate host-permission configuration.");
  const session = result.status.activeSession;
  const sessionAuthorized = isSessionAuthorized(session, Date.now());
  await recordSessionDiagnostic("session_authorization_checked", {
    status: diagnosticState(result.state),
    exists: Boolean(session),
    authorized: sessionAuthorized,
    expiresAt: session && typeof session.expiresAt === "string" ? session.expiresAt : null,
    remainingSeconds: sessionAuthorized ? Math.max(0, Math.floor((Date.parse(session.expiresAt) - Date.now()) / 1000)) : null,
  });
  const plan = buildBlockingRules({
    sites: permissionState.sites,
    session,
    now: Date.now(),
    excludedHosts,
  });
  if (!plan) {
    return reconcileFailClosed({ enforceOpenTabs: true, reason: "invalid_rule_plan" });
  }

  try {
    const rulesApplied = await enqueueDnrMutation(async () => {
      if (!isReconciliationCurrent(expectedGeneration, accessGeneration)) return false;
      await reconcileDynamicRules(chrome.declarativeNetRequest, plan);
      return true;
    });
    if (!rulesApplied) {
      await recordSessionDiagnostic("stale_authorization_discarded", {
        expectedGeneration,
        currentGeneration: accessGeneration,
      });
      return reconcileFailClosed({ enforceOpenTabs: true, reason: "stale_authorization_before_rules" });
    }
    lastRuleReconciliationError = null;
  } catch (error) {
    lastRuleReconciliationError = {
      stage: "verified_status",
      ...safeErrorDetails(error),
    };
    await recordSessionDiagnostic("dnr_reconciliation_error", lastRuleReconciliationError);
    throw error;
  }
  await recordSessionDiagnostic("verified_rules_applied", {
    authorized: sessionAuthorized,
    expiresAt: plan.authorizedUntil === null ? null : new Date(plan.authorizedUntil).toISOString(),
    rules: await getYouTubeRuleSnapshot(),
  });
  if (!sessionAuthorized) {
    await enforceBlockedTabs(plan.domains, "session_not_authorized");
  }
  if (!isReconciliationCurrent(expectedGeneration, accessGeneration)) {
    await recordSessionDiagnostic("stale_authorization_discarded", {
      expectedGeneration,
      currentGeneration: accessGeneration,
    });
    return reconcileFailClosed({ enforceOpenTabs: true, reason: "stale_authorization_after_rules" });
  }
  if (plan.authorizedUntil !== null) {
    const refreshAt = Math.min(
      Date.now() + 30_000,
      plan.authorizedUntil - SESSION_REVOKE_MARGIN_MS,
    );
    if (refreshAt > Date.now()) {
      try {
        await chrome.alarms.create(SESSION_ALARM, { when: refreshAt });
        await recordSessionDiagnostic("expiry_alarm_scheduled", {
          scheduledTime: new Date(refreshAt).toISOString(),
          authorizedUntil: new Date(plan.authorizedUntil).toISOString(),
        });
      } catch (error) {
        await recordSessionDiagnostic("expiry_alarm_schedule_error", safeErrorDetails(error));
        await reconcileFailClosed();
        throw error;
      }
    }
  } else {
    try {
      const scheduledTime = Date.now() + 30_000;
      await chrome.alarms.create(SESSION_ALARM, { when: scheduledTime });
      await recordSessionDiagnostic("status_refresh_alarm_scheduled", { scheduledTime: new Date(scheduledTime).toISOString() });
    } catch (error) {
      await recordSessionDiagnostic("status_refresh_alarm_schedule_error", safeErrorDetails(error));
      await reconcileFailClosed();
      throw error;
    }
  }
  return { missingOrigins: permissionState.missingOrigins, domains: plan.domains };
}

function refreshBlockingStatus() {
  const expectedGeneration = accessGeneration;
  const operation = reconciliationQueue.then(async () => {
    await reconcileFailClosed();
    try {
      const result = await auth.getStatus();
      const blocking = await reconcileVerifiedStatus(result, expectedGeneration);
      return { ...result, blocking };
    } catch (error) {
      const blocking = await reconcileFailClosed({ enforceOpenTabs: true, reason: "status_refresh_error" });
      await recordSessionDiagnostic("status_refresh_error", safeErrorDetails(error));
      await scheduleStatusRetryAlarm("status_refresh_error");
      return { state: "NETWORK_UNAVAILABLE", blocking };
    }
  });
  reconciliationQueue = operation.catch(() => undefined);
  return operation;
}

// TEMP diagnostic: read installed YouTube DNR rules and independently check fresh session state.
async function getDnrDiagnostics() {
  const ruleQuery = async (readRules) => {
    try {
      const rules = await readRules();
      return {
        rules: rules
          .filter((rule) => typeof rule.condition?.urlFilter === "string" &&
            rule.condition.urlFilter.toLowerCase().includes("youtube.com"))
          .filter((rule) => rule.action?.type === "redirect" || rule.action?.type === "allow")
          .map((rule) => ({
            id: rule.id,
            priority: rule.priority,
            action: rule.action.type,
            urlFilter: rule.condition.urlFilter,
            resourceTypes: Array.isArray(rule.condition.resourceTypes)
              ? rule.condition.resourceTypes
              : [],
          })),
      };
    } catch (error) {
      return { error: safeErrorDetails(error) };
    }
  };

  const [dynamic, sessionRules, status, alarm] = await Promise.all([
    ruleQuery(() => chrome.declarativeNetRequest.getDynamicRules()),
    ruleQuery(() => chrome.declarativeNetRequest.getSessionRules()),
    auth.getStatus().catch((error) => ({ state: "NETWORK_UNAVAILABLE", error: safeErrorDetails(error) })),
    chrome.alarms.get(SESSION_ALARM).catch((error) => ({ error: safeErrorDetails(error) })),
  ]);
  const currentSession = status?.state === "AUTHENTICATED"
    ? status.status?.activeSession ?? null
    : null;
  return {
    dynamicRedirectRules: {
      ...dynamic,
      rules: dynamic.rules?.filter((rule) => rule.action === "redirect") ?? dynamic.rules,
    },
    dynamicAllowRules: {
      ...dynamic,
      rules: dynamic.rules?.filter((rule) => rule.action === "allow") ?? dynamic.rules,
    },
    sessionAllowRules: {
      ...sessionRules,
      rules: sessionRules.rules?.filter((rule) => rule.action === "allow") ?? sessionRules.rules,
    },
    session: {
      status: diagnosticState(status?.state),
      exists: currentSession !== null,
      passesAuthorizationAndExpiryChecks: isSessionAuthorized(currentSession, Date.now()),
      expiresAt: typeof currentSession?.expiresAt === "string" ? currentSession.expiresAt : null,
      remainingSeconds: currentSession
        ? Math.max(0, Math.floor((Date.parse(currentSession.expiresAt) - Date.now()) / 1000))
        : null,
    },
    lastRuleReconciliationError,
    alarm: alarm?.scheduledTime
      ? { name: alarm.name, scheduledTime: new Date(alarm.scheduledTime).toISOString() }
      : alarm?.error ? { error: alarm.error } : null,
    timeline: (await chrome.storage.local.get(DIAGNOSTIC_KEY))[DIAGNOSTIC_KEY] ?? [],
  };
}

async function initializeAndReconcile() {
  await initializeState();
  await refreshBlockingStatus();
}

chrome.runtime.onInstalled.addListener(() => {
  initializeAndReconcile().catch(() => {
    console.error("FocusLock blocking initialization failed.");
  });
});

chrome.runtime.onStartup.addListener(() => {
  initializeAndReconcile().catch(() => {
    console.error("FocusLock blocking startup reconciliation failed.");
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== SESSION_ALARM) return;
  void (async () => {
    const generation = invalidateTemporaryAccess("expiry_alarm");
    const rulesBeforeCleanup = await getYouTubeRuleSnapshot();
    await recordSessionDiagnostic("expiry_alarm_fired", {
      scheduledTime: Number.isFinite(alarm.scheduledTime) ? new Date(alarm.scheduledTime).toISOString() : null,
      firedAt: new Date().toISOString(),
      rulesBeforeCleanup,
    });
    try {
      const blocking = await reconcileFailClosed({
        enforceOpenTabs: true,
        reason: "expiry_alarm",
      });
      const status = await refreshBlockingStatus();
      await recordSessionDiagnostic("expiry_alarm_reconciled", {
        generation,
        status: diagnosticState(status?.state),
        blockedDomains: blocking.domains,
        rulesAfter: await getYouTubeRuleSnapshot(),
      });
    } catch (error) {
      await recordSessionDiagnostic("expiry_alarm_reconciliation_error", safeErrorDetails(error));
      console.error("FocusLock could not reconcile session expiry; temporary access cleanup was retried.");
    }
  })();
});

chrome.permissions.onRemoved.addListener(() => {
  invalidateTemporaryAccess("host_permission_removed");
  refreshBlockingStatus().catch(() => {
    reconcileFailClosed({ enforceOpenTabs: true, reason: "host_permission_removed" }).catch(() => {
      console.error("FocusLock could not clear rules after permission removal.");
    });
  });
});

chrome.permissions.onAdded.addListener(() => {
  refreshBlockingStatus().catch(() => {
    console.error("FocusLock could not reconcile newly granted permissions.");
  });
});

async function broadcastStatusUpdate(status) {
  try {
    if (typeof chrome !== "undefined" && chrome.tabs && typeof chrome.tabs.query === "function") {
      const tabs = await chrome.tabs.query({ url: ["http://localhost/*", "http://127.0.0.1/*"] });
      let sentCount = 0;
      for (const tab of tabs) {
        if (tab?.id && typeof chrome.tabs.sendMessage === "function") {
          sentCount += 1;
          chrome.tabs.sendMessage(tab.id, {
            type: "FOCUSLOCK_STATUS_UPDATE",
            ...status,
          }).catch(() => {
            console.info("FocusLock status bridge diagnostic.", {
              stage: "worker_broadcast_delivery_failed",
              state: diagnosticState(status?.state),
            });
          });
        }
      }
      console.info("FocusLock status bridge diagnostic.", {
        stage: "worker_broadcast_dispatched",
        tabCount: tabs.length,
        sentCount,
        state: diagnosticState(status?.state),
      });
    }
  } catch {
    console.info("FocusLock status bridge diagnostic.", {
      stage: "worker_broadcast_query_failed",
      state: diagnosticState(status?.state),
    });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  let operation;

  switch (message?.type) {
    case "GET_CONFIG":
      operation = auth.getConfig();
      break;
    case "SET_CONFIG":
      operation = handleSetConfig(message.config);
      break;
    case "SIGN_IN":
      operation = (async () => {
        await reconcileFailClosed();
        const result = await auth.signIn(message.email, message.password);
        if (result.state === "AUTHENTICATED") {
          const freshStatus = await refreshBlockingStatus();
          await broadcastStatusUpdate(freshStatus);
        }
        return result;
      })();
      break;
    case "SIGN_OUT":
      operation = (async () => {
        invalidateTemporaryAccess("sign_out");
        const result = await auth.signOut();
        await reconcileFailClosed({ enforceOpenTabs: true, reason: "sign_out" });
        await broadcastStatusUpdate({ state: "SIGNED_OUT" });
        return result;
      })();
      break;
    case "GET_STATUS":
      console.info("FocusLock status bridge diagnostic.", {
        stage: "worker_received_get_status",
        requestId: Number.isSafeInteger(message.requestId) ? message.requestId : null,
      });
      operation = refreshBlockingStatus();
      break;
    // TEMP diagnostic: remove this case after collecting runtime evidence.
    case "GET_DNR_DIAGNOSTICS":
      operation = getDnrDiagnostics();
      break;
    case "START_SESSION":
      operation = (async () => {
        invalidateTemporaryAccess("session_start_requested");
        await recordSessionDiagnostic("worker_received_start_session", {
          requestedMinutes: Number.isInteger(message.requestedMinutes) ? message.requestedMinutes : null,
          rulesBefore: await getYouTubeRuleSnapshot(),
        });
        await reconcileFailClosed();
        const result = await auth.startSession(message.requestedMinutes);
        await recordSessionDiagnostic("worker_received_session_start_response", {
          state: diagnosticState(result?.state),
          httpStatus: Number.isInteger(result?.httpStatus) ? result.httpStatus : null,
          serverCreated: result?.serverCreated === true,
          code: ["INSUFFICIENT_BALANCE", "ACTIVE_SESSION_EXISTS"].includes(result?.code)
            ? result.code
            : result?.state === "API_ERROR" ? "API_ERROR" : null,
          sessionExpiresAt: typeof result?.session?.expiresAt === "string" ? result.session.expiresAt : null,
        });
        if (result.state !== "SESSION_STARTED") {
          const status = await refreshBlockingStatus();
          await recordSessionDiagnostic("session_start_failed", {
            state: diagnosticState(result?.state),
            httpStatus: Number.isInteger(result?.httpStatus) ? result.httpStatus : null,
            serverCreated: result?.serverCreated === true,
            rulesAfter: await getYouTubeRuleSnapshot(),
          });
          return { ...status, actionFailure: result.state };
        }
        const status = await refreshBlockingStatus();
        if (!isConfirmedSessionStart(result, status, Date.now())) {
          await recordSessionDiagnostic("session_start_unconfirmed", {
            state: diagnosticState(status?.state),
            rulesAfter: await getYouTubeRuleSnapshot(),
          });
          return { state: "NETWORK_UNAVAILABLE", action: "SESSION_START_UNCONFIRMED" };
        }
        await recordSessionDiagnostic("session_start_confirmed", {
          httpStatus: Number.isInteger(result.httpStatus) ? result.httpStatus : null,
          serverCreated: result.serverCreated === true,
          expiresAt: status.status.activeSession.expiresAt,
          authorized: isSessionAuthorized(status.status.activeSession, Date.now()),
          rulesAfter: await getYouTubeRuleSnapshot(),
        });
        return { ...status, action: "SESSION_STARTED" };
      })();
      break;
    case "END_SESSION":
      operation = (async () => {
        invalidateTemporaryAccess("session_end_requested");
        await reconcileFailClosed({ enforceOpenTabs: true, reason: "session_end_requested" });
        const result = await auth.endActiveSession();
        if (result.state !== "SESSION_ENDED") {
          const status = await refreshBlockingStatus();
          return { ...status, actionFailure: result.state };
        }
        const status = await refreshBlockingStatus();
        if (
          status.state !== "AUTHENTICATED" ||
          status.status.activeSession?.id === result.sessionId
        ) {
          return { state: "NETWORK_UNAVAILABLE", action: "SESSION_END_UNCONFIRMED" };
        }
        return { ...status, action: "SESSION_ENDED" };
      })();
      break;
    default:
      return false;
  }

  let responseSent = false;
  const reply = (response) => {
    if (responseSent) return;
    responseSent = true;
    try {
      sendResponse(response);
    } catch (error) {
      console.error("FocusLock could not deliver an extension message response.", safeErrorDetails(error));
    }
  };

  operation
    .then((response) => {
      if (message?.type === "GET_STATUS") {
        console.info("FocusLock status bridge diagnostic.", {
          stage: "worker_returning_get_status",
          requestId: Number.isSafeInteger(message.requestId) ? message.requestId : null,
          responseId: Number.isSafeInteger(message.requestId) ? message.requestId : null,
          state: diagnosticState(response?.state),
        });
      }
      if (message?.type === "SET_CONFIG" && !isConfigResponse(response)) {
        logConfigStage(
          "message_response",
          "invalid_response",
          new Error("SET_CONFIG operation returned an invalid response."),
        );
        reply({
          ok: false,
          reason: "INVALID_SERVICE_RESPONSE",
          stage: "message_response",
        });
        return;
      }
      if (message?.type === "SET_CONFIG") {
        console.info("FocusLock SET_CONFIG response sent.", {
          keys: Object.keys(response),
          ok: response.ok,
          reason: typeof response.reason === "string" ? response.reason : null,
        });
      }
      reply(response);
    })
    .catch((error) => {
      console.error("FocusLock extension request failed.", safeErrorDetails(error));
      if (message?.type === "START_SESSION") {
        recordSessionDiagnostic("session_start_exception", safeErrorDetails(error)).catch(() => undefined);
      }
      if (message?.type === "GET_STATUS") {
        console.info("FocusLock status bridge diagnostic.", {
          stage: "worker_get_status_failed",
          requestId: Number.isSafeInteger(message.requestId) ? message.requestId : null,
          state: "NETWORK_UNAVAILABLE",
        });
      }
      reconcileFailClosed().catch(() => {
        console.error("FocusLock could not reconcile fail-closed rules.");
      });
      reply(message?.type === "SET_CONFIG"
        ? { ok: false, reason: "CONFIG_OPERATION_FAILED", stage: "message_response" }
        : { state: "NETWORK_UNAVAILABLE" });
    });

  return true;
});
