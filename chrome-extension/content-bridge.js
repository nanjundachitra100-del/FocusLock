/**
 * FocusLock Guardian - Content Script Message Bridge
 *
 * Facilitates secure, credential-free communication between the FocusLock
 * dashboard (running in the browser tab) and the Chrome extension service worker.
 */

function sanitizeExtensionStatus(response) {
  if (!response || typeof response !== "object") {
    return {
      installed: true,
      state: "UNAVAILABLE",
      availableMinutes: null,
      hasActiveSession: false,
    };
  }

  const rawState = response.state;
  let safeState = "UNAVAILABLE";
  if (rawState === "AUTHENTICATED") {
    safeState = "AUTHENTICATED";
  } else if (rawState === "SIGNED_OUT" || rawState === "AUTHENTICATION_EXPIRED") {
    safeState = "AUTH_REQUIRED";
  } else if (rawState === "NETWORK_UNAVAILABLE" || rawState === "FORBIDDEN") {
    safeState = "UNAVAILABLE";
  }

  const availableMinutes =
    response.status && typeof response.status.availableMinutes === "number"
      ? response.status.availableMinutes
      : null;

  const hasActiveSession = Boolean(response.status?.activeSession);

  return {
    installed: true,
    state: safeState,
    availableMinutes,
    hasActiveSession,
  };
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

function postExtensionStatus(postMessageTarget, status, requestId) {
  const message = {
    source: "focuslock-extension",
    type: "FOCUSLOCK_EXTENSION_STATUS",
    ...status,
  };
  if (Number.isSafeInteger(requestId)) {
    message.requestId = requestId;
  }
  postMessageTarget.postMessage(message, "*");
}

function handleDashboardMessage(event, runtime, postMessageTarget) {
  const expectedSource = typeof window !== "undefined" ? window : postMessageTarget;
  if (!event || !event.data || typeof event.data !== "object") return;
  const sourceMatches = event.source === expectedSource;
  const sourceMarkerMatches = event.data.source === "focuslock-dashboard";
  const requestTypeMatches = event.data.type === "FOCUSLOCK_CHECK_EXTENSION";
  if (sourceMarkerMatches && requestTypeMatches) {
    console.info("FocusLock bridge diagnostic.", {
      stage: "content_saw_dashboard_event",
      sourceMatches,
      requestId: Number.isSafeInteger(event.data.requestId) ? event.data.requestId : null,
    });
  }
  if (!sourceMatches || !sourceMarkerMatches) return;

  if (requestTypeMatches) {
    const requestId = Number.isSafeInteger(event.data.requestId)
      ? event.data.requestId
      : undefined;
    console.info("FocusLock bridge diagnostic.", {
      stage: "content_received_dashboard_request",
      requestId: requestId ?? null,
    });
    if (!runtime || typeof runtime.sendMessage !== "function") {
      console.info("FocusLock bridge diagnostic.", {
        stage: "content_runtime_unavailable",
        requestId: requestId ?? null,
        state: "NOT_DETECTED",
      });
      postExtensionStatus(postMessageTarget, {
          installed: false,
          state: "NOT_DETECTED",
          availableMinutes: null,
          hasActiveSession: false,
        }, requestId);
      return;
    }

    try {
      runtime.sendMessage({ type: "GET_STATUS", requestId }, (response) => {
        const runtimeError = Boolean(runtime.lastError);
        console.info("FocusLock bridge diagnostic.", {
          stage: "content_received_worker_response",
          requestId: requestId ?? null,
          responseId: requestId ?? null,
          runtimeError,
          state: diagnosticState(response?.state),
        });
        if (runtimeError || !response) {
          console.info("FocusLock bridge diagnostic.", {
            stage: "content_forwarded_status",
            requestId: requestId ?? null,
            state: "UNAVAILABLE",
          });
          postExtensionStatus(postMessageTarget, {
              installed: true,
              state: "UNAVAILABLE",
              availableMinutes: null,
              hasActiveSession: false,
            }, requestId);
          return;
        }

        const sanitized = sanitizeExtensionStatus(response);
        console.info("FocusLock bridge diagnostic.", {
          stage: "content_forwarded_status",
          requestId: requestId ?? null,
          state: sanitized.state,
        });
        postExtensionStatus(postMessageTarget, {
            ...sanitized,
          }, requestId);
      });
    } catch {
      console.info("FocusLock bridge diagnostic.", {
        stage: "content_runtime_send_failed",
        requestId: requestId ?? null,
        state: "UNAVAILABLE",
      });
      console.info("FocusLock bridge diagnostic.", {
        stage: "content_forwarded_status",
        requestId: requestId ?? null,
        state: "UNAVAILABLE",
      });
      postExtensionStatus(postMessageTarget, {
          installed: true,
          state: "UNAVAILABLE",
          availableMinutes: null,
          hasActiveSession: false,
        }, requestId);
    }
  }
}

function handleRuntimeMessage(message, postMessageTarget) {
  if (!message || typeof message !== "object") return;
  if (message.type === "FOCUSLOCK_STATUS_UPDATE") {
    const sanitized = sanitizeExtensionStatus(message);
    console.info("FocusLock bridge diagnostic.", {
      stage: "content_received_status_broadcast",
      state: sanitized.state,
    });
    postExtensionStatus(postMessageTarget, sanitized);
    console.info("FocusLock bridge diagnostic.", {
      stage: "content_forwarded_broadcast",
      state: sanitized.state,
    });
  }
}

function initContentBridge(globalWindow, chromeRuntime) {
  if (!globalWindow || typeof globalWindow.addEventListener !== "function") return;
  console.info("FocusLock bridge diagnostic.", {
    stage: "content_script_loaded",
  });

  globalWindow.addEventListener("message", (event) => {
    handleDashboardMessage(event, chromeRuntime, globalWindow);
  });

  if (chromeRuntime && typeof chromeRuntime.onMessage?.addListener === "function") {
    chromeRuntime.onMessage.addListener((message) => {
      handleRuntimeMessage(message, globalWindow);
    });
  }

  try {
    globalWindow.postMessage(
      {
        source: "focuslock-extension",
        type: "FOCUSLOCK_EXTENSION_ANNOUNCE",
        installed: true,
      },
      "*",
    );
  } catch {
    // Ignore if postMessage fails on unloaded window
  }
}

// Auto-initialize when running in browser content-script context
if (typeof window !== "undefined") {
  initContentBridge(window, typeof chrome !== "undefined" ? chrome.runtime : undefined);
}

// Export for Node/Vitest unit testing
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    sanitizeExtensionStatus,
    postExtensionStatus,
    handleDashboardMessage,
    handleRuntimeMessage,
    initContentBridge,
  };
}
