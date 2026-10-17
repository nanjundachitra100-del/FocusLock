"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ExtensionConnectionState =
  | "checking"
  | "not_detected"
  | "auth_required"
  | "authenticated"
  | "unavailable";

export interface ExtensionStatus {
  state: ExtensionConnectionState;
  availableMinutes: number | null;
  hasActiveSession: boolean;
  lastChecked: number | null;
}

export const DASHBOARD_SOURCE = "focuslock-dashboard";
export const EXTENSION_SOURCE = "focuslock-extension";
export const CHECK_TIMEOUT_MS = 1500;

export function mapRawExtensionState(rawState: string | undefined): ExtensionConnectionState {
  switch (rawState) {
    case "AUTHENTICATED":
      return "authenticated";
    case "AUTH_REQUIRED":
    case "SIGNED_OUT":
    case "AUTHENTICATION_EXPIRED":
      return "auth_required";
    case "UNAVAILABLE":
    case "NETWORK_UNAVAILABLE":
    case "FORBIDDEN":
      return "unavailable";
    case "NOT_DETECTED":
      return "not_detected";
    default:
      return "unavailable";
  }
}

export function isCurrentExtensionStatusRequest(requestId: unknown, latestRequestId: number): boolean {
  return Number.isSafeInteger(requestId) && requestId === latestRequestId;
}

function diagnosticState(state: unknown): string {
  return typeof state === "string" &&
    [
      "AUTHENTICATED",
      "AUTH_REQUIRED",
      "SIGNED_OUT",
      "AUTHENTICATION_EXPIRED",
      "NETWORK_UNAVAILABLE",
      "FORBIDDEN",
      "UNAVAILABLE",
      "NOT_DETECTED",
    ].includes(state)
    ? state
    : "UNKNOWN";
}

export function useExtensionStatus(timeoutMs: number = CHECK_TIMEOUT_MS): ExtensionStatus & { refresh: () => void } {
  const [status, setStatus] = useState<ExtensionStatus>({
    state: "checking",
    availableMinutes: null,
    hasActiveSession: false,
    lastChecked: null,
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSequenceRef = useRef(0);
  const latestRequestIdRef = useRef(0);

  const checkStatus = useCallback((explicit = false) => {
    if (typeof window === "undefined") return;

    const requestId = ++requestSequenceRef.current;
    latestRequestIdRef.current = requestId;
    if (explicit) {
      setStatus((prev) => ({ ...prev, state: "checking" }));
    }

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      if (latestRequestIdRef.current !== requestId) return;
      console.info("FocusLock status bridge diagnostic.", {
        stage: "dashboard_request_timeout",
        requestId,
      });
      setStatus((prev) => {
        if (prev.state === "checking") {
          return {
            ...prev,
            state: "not_detected",
            lastChecked: Date.now(),
          };
        }
        return prev;
      });
    }, timeoutMs);

    console.info("FocusLock status bridge diagnostic.", {
      stage: "dashboard_sent_request",
      requestId,
    });
    window.postMessage(
      {
        source: DASHBOARD_SOURCE,
        type: "FOCUSLOCK_CHECK_EXTENSION",
        requestId,
      },
      "*",
    );
  }, [timeoutMs]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    function handleMessage(event: MessageEvent) {
      if (!event.data || typeof event.data !== "object") return;
      if (event.data.source !== EXTENSION_SOURCE) return;
      const requestId = typeof event.data.requestId === "number" &&
        Number.isSafeInteger(event.data.requestId)
        ? event.data.requestId
        : null;
      const sourceMatches = event.source === window;
      if (event.data.type === "FOCUSLOCK_EXTENSION_STATUS") {
        console.info("FocusLock status bridge diagnostic.", {
          stage: "dashboard_received_status",
          sourceMatches,
          requestId,
          state: diagnosticState(event.data.state),
        });
      }
      if (!sourceMatches) return;

      if (event.data.type === "FOCUSLOCK_EXTENSION_ANNOUNCE") {
        checkStatus();
        return;
      }

      if (event.data.type === "FOCUSLOCK_EXTENSION_STATUS") {
        if (event.data.requestId !== undefined) {
          if (!isCurrentExtensionStatusRequest(
            event.data.requestId,
            latestRequestIdRef.current,
          )) {
            return;
          }
        } else {
          // A pushed status update supersedes any request already in flight.
          latestRequestIdRef.current = ++requestSequenceRef.current;
        }

        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }

        const mappedState = mapRawExtensionState(event.data.state);
        console.info("FocusLock status bridge diagnostic.", {
          stage: "dashboard_mapped_status",
          requestId,
          state: mappedState,
        });
        setStatus({
          state: mappedState,
          availableMinutes:
            typeof event.data.availableMinutes === "number" ? event.data.availableMinutes : null,
          hasActiveSession: Boolean(event.data.hasActiveSession),
          lastChecked: Date.now(),
        });
      }
    }

    function handleFocus() {
      checkStatus();
    }

    function handleVisibilityChange() {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        checkStatus();
      }
    }

    window.addEventListener("message", handleMessage);
    window.addEventListener("focus", handleFocus);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    checkStatus(true);

    const intervalId = setInterval(() => {
      checkStatus();
    }, 4000);

    return () => {
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("focus", handleFocus);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
      clearInterval(intervalId);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [checkStatus]);

  return {
    ...status,
    refresh: () => checkStatus(true),
  };
}
