import {
  isValidConfigResponse,
  sendRuntimeMessage,
} from "./runtime-messaging.js";
import {
  DEFAULT_SESSION_DURATION,
  SUPPORTED_SESSION_DURATIONS,
  durationIsAffordable,
  loadPreferredSessionDuration,
  savePreferredSessionDuration,
} from "./session-duration.js";

const connectionStatus = document.getElementById("connection-status");
const connectionIndicator = document.getElementById("connection-indicator");
const availableMinutes = document.getElementById("available-minutes");
const sessionStatus = document.getElementById("session-status");
const sessionCaption = document.getElementById("session-caption");
const statusMessage = document.getElementById("status-message");
const refreshButton = document.getElementById("refresh-button");
const dashboardLink = document.getElementById("dashboard-link");
const setupPanel = document.getElementById("setup-panel");
const authPanel = document.getElementById("auth-panel");
const configForm = document.getElementById("config-form");
const signInForm = document.getElementById("sign-in-form");
const saveConfigButton = document.getElementById("save-config-button");
const signInButton = document.getElementById("sign-in-button");
const signOutButton = document.getElementById("sign-out-button");
const editConfigButton = document.getElementById("edit-config-button");
const authTitle = document.getElementById("auth-title");
const blockingMessage = document.getElementById("blocking-message");
const enableBlockingButton = document.getElementById("enable-blocking-button");
const unlockPanel = document.getElementById("unlock-panel");
const unlockLimit = document.getElementById("unlock-limit");
const unlockDuration = document.getElementById("unlock-duration");
const startSessionButton = document.getElementById("start-session-button");
const endSessionButton = document.getElementById("end-session-button");
let missingHostOrigins = [];
let sessionCountdown = null;
let preferredUnlockDuration = DEFAULT_SESSION_DURATION;
let currentAvailableMinutes = null;
const CONFIG_ERROR_MESSAGES = {
  INVALID_CONFIG: "Configuration is incomplete. Check all three project settings.",
  INVALID_SUPABASE_URL: "Enter a valid HTTPS Supabase project URL without a path, query, or credentials.",
  INVALID_BACKEND_URL: "Enter a valid HTTPS backend URL. HTTP is allowed only for localhost or 127.0.0.1.",
  INVALID_PUBLISHABLE_KEY: "Enter a valid public anon or sb_publishable_ key. Secret and service-role keys are not accepted.",
  BLOCKING_RECONCILIATION_FAILED: "Could not safely reset website access before saving. Reload the extension and try again.",
  CONFIG_SAVE_FAILED: "Could not validate or save project settings. Check extension storage and try again.",
  INVALID_SERVICE_RESPONSE: "The configuration service returned an invalid response. Reload the extension and try again.",
  INVALID_RESPONSE: "The extension service worker returned an invalid response. Reload the extension and try again.",
  CONFIG_OPERATION_FAILED: "The extension could not complete configuration setup. Reload it and try again.",
};
const CONFIG_STAGE_LABELS = {
  before_save: "before configuration save",
  save: "while saving configuration",
  message_response: "while returning the configuration result",
};

function setConnection(state, label) {
  connectionIndicator.dataset.state = state;
  connectionStatus.textContent = label;
}

function clearAccountValues() {
  availableMinutes.textContent = "—";
  sessionStatus.textContent = "—";
  sessionCaption.textContent = "Session status";
}

function showUnavailable(message) {
  setConnection("unavailable", "Network unavailable");
  clearAccountValues();
  statusMessage.textContent = message;
}

function updateBlockingPermissionState(result) {
  missingHostOrigins = Array.isArray(result?.blocking?.missingOrigins)
    ? result.blocking.missingOrigins.filter((origin) => typeof origin === "string")
    : [];
  const count = missingHostOrigins.length;
  enableBlockingButton.hidden = count === 0;
  blockingMessage.hidden = count === 0;
  blockingMessage.textContent = count > 0
    ? `Chrome permission is needed for ${count} configured website${count === 1 ? "" : "s"}. Blocking will not apply until you approve it.`
    : "";
}

function formatSession(session) {
  if (sessionCountdown !== null) {
    clearInterval(sessionCountdown);
    sessionCountdown = null;
  }

  if (!session) {
    sessionStatus.textContent = "No active session";
    sessionCaption.textContent = "Session status";
    endSessionButton.hidden = true;
    return;
  }

  sessionStatus.textContent = "Active";
  endSessionButton.hidden = false;

  const renderRemaining = () => {
    const remainingSeconds = Math.max(
      0,
      Math.ceil((Date.parse(session.expiresAt) - Date.now()) / 1000),
    );
    const minutes = Math.floor(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    sessionCaption.textContent = remainingSeconds > 0
      ? `${minutes}:${String(seconds).padStart(2, "0")} remaining`
      : "Session expired; checking access…";
    if (remainingSeconds === 0) {
      clearInterval(sessionCountdown);
      sessionCountdown = null;
      void refreshStatus();
    }
  };

  renderRemaining();
  sessionCountdown = setInterval(renderRemaining, 1000);
}

function renderUnlockControls(status) {
  const activeSession = status.activeSession;
  unlockPanel.hidden = false;
  startSessionButton.hidden = Boolean(activeSession);
  endSessionButton.hidden = !activeSession;

  if (activeSession) {
    unlockLimit.textContent = `Authorized until ${new Date(activeSession.expiresAt).toLocaleTimeString()}.`;
    unlockDuration.hidden = true;
    unlockPanel.querySelector("label").hidden = true;
    return;
  }

  unlockDuration.hidden = false;
  unlockPanel.querySelector("label").hidden = false;
  currentAvailableMinutes = Number.isFinite(status.availableMinutes)
    ? Math.max(0, status.availableMinutes)
    : 0;
  unlockLimit.textContent = `${currentAvailableMinutes} earned entertainment minutes are available. Durations above this balance are disabled.`;
  unlockDuration.replaceChildren();
  for (const minutes of SUPPORTED_SESSION_DURATIONS) {
    const option = document.createElement("option");
    option.value = String(minutes);
    option.disabled = !durationIsAffordable(minutes, currentAvailableMinutes);
    option.textContent = option.disabled
      ? `${minutes} minutes (requires ${minutes} earned minutes)`
      : `${minutes} minutes`;
    unlockDuration.append(option);
  }
  unlockDuration.value = String(preferredUnlockDuration);
  startSessionButton.disabled = !durationIsAffordable(preferredUnlockDuration, currentAvailableMinutes);
}

function showState(result) {
  updateBlockingPermissionState(result);
  switch (result?.state) {
    case "AUTHENTICATED":
      setConnection("connected", "Authenticated");
      availableMinutes.textContent = String(result.status.availableMinutes);
      formatSession(result.status.activeSession);
      renderUnlockControls(result.status);
      statusMessage.textContent = result.actionFailure === "INSUFFICIENT_BALANCE"
        ? "Not enough reward minutes for that duration."
        : result.actionFailure === "ACTIVE_SESSION_EXISTS"
          ? "A session is already active; its verified state has been refreshed."
          : result.actionFailure === "INVALID_DURATION"
            ? "The server rejected that unlock duration."
          : result.actionFailure === "NO_ACTIVE_SESSION"
            ? "No active session is available to end."
            : result.actionFailure
              ? `The session request failed (${result.actionFailure}).`
            : result.action === "SESSION_STARTED"
              ? "Session confirmed by FocusLock. Website access is being reconciled."
              : result.action === "SESSION_ENDED"
                ? "Session ended by FocusLock. Website blocking is being restored."
                : "Account status loaded from FocusLock.";
      signInForm.hidden = true;
      signOutButton.hidden = false;
      authPanel.hidden = false;
      authTitle.textContent = "Signed in to FocusLock";
      return;
    case "SIGNED_OUT":
      setConnection("attention", "Signed out");
      clearAccountValues();
      unlockPanel.hidden = true;
      formatSession(null);
      statusMessage.textContent = "Sign in with your FocusLock account to load your status.";
      signInForm.hidden = false;
      signOutButton.hidden = true;
      authPanel.hidden = false;
      authTitle.textContent = "Sign in to FocusLock";
      return;
    case "AUTHENTICATION_EXPIRED":
      setConnection("attention", "Authentication expired");
      clearAccountValues();
      unlockPanel.hidden = true;
      formatSession(null);
      statusMessage.textContent = "Your session could not be refreshed. Sign in again to reconnect.";
      signInForm.hidden = false;
      signOutButton.hidden = true;
      authPanel.hidden = false;
      authTitle.textContent = "Sign in again";
      return;
    case "FORBIDDEN":
      setConnection("unavailable", "Access denied");
      clearAccountValues();
      unlockPanel.hidden = true;
      formatSession(null);
      statusMessage.textContent = "FocusLock denied this request (403). Verify the account and backend configuration.";
      signInForm.hidden = true;
      signOutButton.hidden = false;
      authPanel.hidden = false;
      authTitle.textContent = "Signed in to FocusLock";
      return;
    case "NETWORK_UNAVAILABLE":
    default:
      showUnavailable("Could not contact or read the FocusLock service. Check your URLs, permissions, and network.");
      unlockPanel.hidden = true;
      formatSession(null);
      signInForm.hidden = false;
      signOutButton.hidden = true;
      authPanel.hidden = false;
      authTitle.textContent = "Sign in to FocusLock";
  }
}

async function sendMessage(type, extra = {}) {
  return sendRuntimeMessage(chrome.runtime, { type, ...extra });
}

function normalizeOrigin(value, allowLocalHttp) {
  try {
    const url = new URL(value);
    const isLocalHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (
      (url.protocol !== "https:" && !(allowLocalHttp && isLocalHost && url.protocol === "http:")) ||
      url.username ||
      url.password ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function toHostPermissionPattern(origin) {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
}

async function requestHostPermissions(config) {
  const backendOrigin = normalizeOrigin(config.backendUrl, true);
  const supabaseOrigin = normalizeOrigin(config.supabaseUrl, true);
  if (!backendOrigin || !supabaseOrigin) return false;

  const origins = [...new Set([
    toHostPermissionPattern(backendOrigin),
    toHostPermissionPattern(supabaseOrigin),
  ])];
  return chrome.permissions.request({ origins });
}

async function refreshStatus() {
  refreshButton.disabled = true;
  refreshButton.setAttribute("aria-busy", "true");
  setConnection("attention", "Connecting…");
  clearAccountValues();
  statusMessage.textContent = "Checking your FocusLock account…";

  try {
    showState(await sendMessage("GET_STATUS"));
  } catch {
    showUnavailable("The extension could not contact its service worker. Reload the extension and try again.");
  } finally {
    refreshButton.disabled = false;
    refreshButton.removeAttribute("aria-busy");
  }
}

configForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  saveConfigButton.disabled = true;
  statusMessage.textContent = "Requesting access to the configured project hosts…";

  const form = new FormData(configForm);
  const config = {
    backendUrl: String(form.get("backendUrl") ?? "").trim(),
    supabaseUrl: String(form.get("supabaseUrl") ?? "").trim(),
    publishableKey: String(form.get("publishableKey") ?? "").trim(),
  };

  try {
    const granted = await requestHostPermissions(config);
    if (!granted) {
      statusMessage.textContent = "Host access was not granted. FocusLock cannot connect without the exact backend and Supabase origins.";
      return;
    }

    const result = await sendMessage("SET_CONFIG", { config });
    if (!isValidConfigResponse(result)) {
      statusMessage.textContent =
        "The extension service worker returned an invalid configuration response. Reload the extension and try again.";
      return;
    }
    if (!result.ok) {
      statusMessage.textContent =
        CONFIG_ERROR_MESSAGES[result?.reason] ||
        "The extension service worker could not save the configuration. Reload the extension and try again.";
      if (CONFIG_STAGE_LABELS[result?.stage]) {
        statusMessage.textContent += ` (failed ${CONFIG_STAGE_LABELS[result.stage]})`;
      }
      return;
    }

    dashboardLink.href = `${config.backendUrl}/`;
    setupPanel.hidden = true;
    editConfigButton.hidden = false;
    authPanel.hidden = false;
    statusMessage.textContent = "Project settings saved. Sign in with your FocusLock account.";
    await refreshStatus();
    if (result.warning === "CONFIG_SAVED_BLOCKING_RECONCILIATION_FAILED") {
      statusMessage.textContent =
        "Project settings were saved, but website blocking could not be reconciled. Reload the extension and check its permissions.";
    }
  } catch {
    statusMessage.textContent =
      "Could not communicate with the extension service worker. Reload the extension and try again.";
  } finally {
    saveConfigButton.disabled = false;
  }
});

signInForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  signInButton.disabled = true;
  statusMessage.textContent = "Connecting to Supabase…";

  const form = new FormData(signInForm);
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");

  try {
    const result = await sendMessage("SIGN_IN", { email, password });
    signInForm.reset();
    if (result?.state === "AUTHENTICATED") {
      await refreshStatus();
    } else if (result?.state === "NETWORK_UNAVAILABLE") {
      showUnavailable("Sign-in could not reach Supabase. Check your network and project URL.");
    } else {
      showState({ state: "SIGNED_OUT" });
      statusMessage.textContent = "Sign-in failed. Check your email and password, then try again.";
    }
  } catch {
    signInForm.reset();
    showUnavailable("The extension could not complete sign-in. Reload it and try again.");
  } finally {
    signInButton.disabled = false;
  }
});

signOutButton.addEventListener("click", async () => {
  signOutButton.disabled = true;
  try {
    await sendMessage("SIGN_OUT");
    showState(await sendMessage("GET_STATUS"));
  } catch {
    showUnavailable("Sign-out could not be confirmed. Reopen the popup to check your session.");
  } finally {
    signOutButton.disabled = false;
  }
});

enableBlockingButton.addEventListener("click", async () => {
  if (missingHostOrigins.length === 0) return;
  enableBlockingButton.disabled = true;
  try {
    const granted = await chrome.permissions.request({ origins: missingHostOrigins });
    if (!granted) {
      blockingMessage.textContent = "Website access was not granted. Those sites will not be blocked.";
      return;
    }
    await refreshStatus();
  } catch {
    blockingMessage.textContent = "Chrome could not grant website access. Check extension permissions and try again.";
  } finally {
    enableBlockingButton.disabled = false;
  }
});

editConfigButton.addEventListener("click", () => {
  setupPanel.hidden = false;
});

refreshButton.addEventListener("click", refreshStatus);

startSessionButton.addEventListener("click", async () => {
  const requestedMinutes = Number(unlockDuration.value);
  if (!durationIsAffordable(requestedMinutes, currentAvailableMinutes)) {
    statusMessage.textContent = "That unlock duration exceeds your currently available earned time.";
    return;
  }

  startSessionButton.disabled = true;
  statusMessage.textContent = "Requesting a reward-backed session…";
  try {
    const result = await sendMessage("START_SESSION", { requestedMinutes });
    if (result?.state === "AUTHENTICATED") {
      showState(result);
    } else {
      showState(result);
      if (result?.action === "SESSION_STARTED") {
        statusMessage.textContent = "Session creation was acknowledged, but its status could not be confirmed. Websites remain blocked; refresh to recover.";
      }
    }
  } catch {
    showUnavailable("Could not confirm the session request. Refresh status before trying again.");
  } finally {
    startSessionButton.disabled = false;
  }
});

endSessionButton.addEventListener("click", async () => {
  endSessionButton.disabled = true;
  statusMessage.textContent = "Ending the active session…";
  try {
    const result = await sendMessage("END_SESSION");
    if (result?.state === "AUTHENTICATED") {
      showState(result);
    } else if (result?.state === "NO_ACTIVE_SESSION") {
      await refreshStatus();
    } else {
      showState(result);
    }
  } catch {
    showUnavailable("Could not confirm session termination. Refresh status to reconcile website access.");
  } finally {
    endSessionButton.disabled = false;
  }
});

unlockDuration.addEventListener("change", () => {
  const value = Number(unlockDuration.value);
  if (!SUPPORTED_SESSION_DURATIONS.includes(value)) return;
  preferredUnlockDuration = value;
  void savePreferredSessionDuration(chrome.storage.local, value);
  startSessionButton.disabled = !durationIsAffordable(value, currentAvailableMinutes);
});

async function initializePopup() {
  try {
    preferredUnlockDuration = await loadPreferredSessionDuration(chrome.storage.local);
    const config = await sendMessage("GET_CONFIG");
    if (!config?.configured) {
      setupPanel.hidden = false;
      authPanel.hidden = true;
      setConnection("attention", "Setup required");
      clearAccountValues();
      statusMessage.textContent = "Configure the public Supabase project and FocusLock backend to get started.";
      return;
    }

    document.getElementById("backend-url").value = config.backendUrl;
    document.getElementById("supabase-url").value = config.supabaseUrl;
    document.getElementById("publishable-key").value = config.publishableKey;
    dashboardLink.href = `${config.backendUrl}/`;
    setupPanel.hidden = true;
    editConfigButton.hidden = false;
    await refreshStatus();
  } catch {
    showUnavailable("The extension could not load its configuration. Reload the extension and try again.");
  }
}

void initializePopup();
