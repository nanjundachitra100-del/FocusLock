import { describe, expect, it } from "vitest";
import {
  mapRawExtensionState,
  isCurrentExtensionStatusRequest,
  DASHBOARD_SOURCE,
  EXTENSION_SOURCE,
} from "../src/lib/extension/status-bridge";

describe("dashboard extension status mapping", () => {
  it("maps raw extension states to dashboard connection states", () => {
    expect(mapRawExtensionState("AUTHENTICATED")).toBe("authenticated");
    expect(mapRawExtensionState("AUTH_REQUIRED")).toBe("auth_required");
    expect(mapRawExtensionState("SIGNED_OUT")).toBe("auth_required");
    expect(mapRawExtensionState("AUTHENTICATION_EXPIRED")).toBe("auth_required");
    expect(mapRawExtensionState("UNAVAILABLE")).toBe("unavailable");
    expect(mapRawExtensionState("NETWORK_UNAVAILABLE")).toBe("unavailable");
    expect(mapRawExtensionState("FORBIDDEN")).toBe("unavailable");
    expect(mapRawExtensionState("NOT_DETECTED")).toBe("not_detected");
    expect(mapRawExtensionState(undefined)).toBe("unavailable");
    expect(mapRawExtensionState("UNKNOWN_RANDOM_STATE")).toBe("unavailable");
  });

  it("uses expected message source constants", () => {
    expect(DASHBOARD_SOURCE).toBe("focuslock-dashboard");
    expect(EXTENSION_SOURCE).toBe("focuslock-extension");
  });

  it("distinguishes authenticated state from auth_required states", () => {
    expect(mapRawExtensionState("AUTHENTICATED")).toBe("authenticated");
    expect(mapRawExtensionState("SIGNED_OUT")).toBe("auth_required");
    expect(mapRawExtensionState("AUTH_REQUIRED")).toBe("auth_required");
    expect(mapRawExtensionState("AUTHENTICATION_EXPIRED")).toBe("auth_required");
  });

  it("rejects an older query response after a newer request or pushed status", () => {
    const firstRequestId = 1;
    let latestRequestId = firstRequestId;
    expect(isCurrentExtensionStatusRequest(firstRequestId, latestRequestId)).toBe(true);

    const secondRequestId = 2;
    latestRequestId = secondRequestId;
    expect(isCurrentExtensionStatusRequest(firstRequestId, latestRequestId)).toBe(false);
    expect(isCurrentExtensionStatusRequest(secondRequestId, latestRequestId)).toBe(true);

    // A pushed sign-in update advances the active generation and supersedes in-flight queries.
    latestRequestId = 3;
    expect(isCurrentExtensionStatusRequest(secondRequestId, latestRequestId)).toBe(false);
  });
});
