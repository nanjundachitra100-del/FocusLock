import { beforeEach, describe, expect, it, vi } from "vitest";
const {
  sanitizeExtensionStatus,
  handleDashboardMessage,
  initContentBridge,
} = require("../chrome-extension/content-bridge.js");

describe("content script extension bridge", () => {
  it("sanitizes an authenticated extension status and redacts sensitive data", () => {
    const rawResponse = {
      state: "AUTHENTICATED",
      status: {
        availableMinutes: 42,
        activeSession: {
          id: "session-123",
          expiresAt: "2026-10-18T00:00:00Z",
          remainingSeconds: 600,
        },
        blockedSites: [{ domain: "youtube.com", enabled: true }],
      },
      user: {
        id: "user-123",
        email: "test@example.com",
        access_token: "secret-token-that-must-never-leak",
      },
      token: "jwt-token-123",
      publishableKey: "pk-123",
    };

    const sanitized = sanitizeExtensionStatus(rawResponse);

    expect(sanitized).toEqual({
      installed: true,
      state: "AUTHENTICATED",
      availableMinutes: 42,
      hasActiveSession: true,
    });

    expect(sanitized).not.toHaveProperty("user");
    expect(sanitized).not.toHaveProperty("token");
    expect(sanitized).not.toHaveProperty("publishableKey");
    expect(sanitized).not.toHaveProperty("access_token");
  });

  it("maps SIGNED_OUT and AUTHENTICATION_EXPIRED to AUTH_REQUIRED", () => {
    expect(sanitizeExtensionStatus({ state: "SIGNED_OUT" }).state).toBe("AUTH_REQUIRED");
    expect(sanitizeExtensionStatus({ state: "AUTHENTICATION_EXPIRED" }).state).toBe("AUTH_REQUIRED");
  });

  it("maps NETWORK_UNAVAILABLE, FORBIDDEN, and null to UNAVAILABLE", () => {
    expect(sanitizeExtensionStatus({ state: "NETWORK_UNAVAILABLE" }).state).toBe("UNAVAILABLE");
    expect(sanitizeExtensionStatus({ state: "FORBIDDEN" }).state).toBe("UNAVAILABLE");
    expect(sanitizeExtensionStatus(null).state).toBe("UNAVAILABLE");
    expect(sanitizeExtensionStatus(undefined).state).toBe("UNAVAILABLE");
  });

  it("ignores messages that do not come from the FocusLock dashboard", () => {
    const fakeWindow = { postMessage: vi.fn() };
    const mockRuntime = { sendMessage: vi.fn() };

    // Foreign source
    handleDashboardMessage(
      { source: fakeWindow, data: { source: "other-app", type: "FOCUSLOCK_CHECK_EXTENSION" } },
      mockRuntime,
      fakeWindow,
    );
    expect(mockRuntime.sendMessage).not.toHaveBeenCalled();
    expect(fakeWindow.postMessage).not.toHaveBeenCalled();

    // Wrong message type
    handleDashboardMessage(
      { source: fakeWindow, data: { source: "focuslock-dashboard", type: "UNKNOWN_TYPE" } },
      mockRuntime,
      fakeWindow,
    );
    expect(mockRuntime.sendMessage).not.toHaveBeenCalled();
    expect(fakeWindow.postMessage).not.toHaveBeenCalled();
  });

  it("delivers sanitized status to postMessageTarget when runtime responds", () => {
    const fakeWindow = { postMessage: vi.fn() };
    const mockRuntime = {
      sendMessage: vi.fn((_msg, cb) =>
        cb({
          state: "AUTHENTICATED",
          status: { availableMinutes: 25, activeSession: null },
        }),
      ),
    };

    handleDashboardMessage(
      {
        source: fakeWindow,
        data: {
          source: "focuslock-dashboard",
          type: "FOCUSLOCK_CHECK_EXTENSION",
          requestId: 1,
        },
      },
      mockRuntime,
      fakeWindow,
    );

    expect(mockRuntime.sendMessage).toHaveBeenCalledWith(
      { type: "GET_STATUS", requestId: 1 },
      expect.any(Function),
    );
    expect(fakeWindow.postMessage).toHaveBeenCalledWith(
      {
        source: "focuslock-extension",
        type: "FOCUSLOCK_EXTENSION_STATUS",
        installed: true,
        state: "AUTHENTICATED",
        availableMinutes: 25,
        hasActiveSession: false,
        requestId: 1,
      },
      "*",
    );
  });

  it("reports UNAVAILABLE when runtime has lastError or throws", () => {
    const fakeWindow = { postMessage: vi.fn() };
    const mockRuntime = {
      lastError: { message: "Service worker unavailable" },
      sendMessage: vi.fn((_msg, cb) => cb(null)),
    };

    handleDashboardMessage(
      {
        source: fakeWindow,
        data: { source: "focuslock-dashboard", type: "FOCUSLOCK_CHECK_EXTENSION" },
      },
      mockRuntime,
      fakeWindow,
    );

    expect(fakeWindow.postMessage).toHaveBeenCalledWith(
      {
        source: "focuslock-extension",
        type: "FOCUSLOCK_EXTENSION_STATUS",
        installed: true,
        state: "UNAVAILABLE",
        availableMinutes: null,
        hasActiveSession: false,
      },
      "*",
    );
  });

  it("broadcasts an announcement message when content script initializes", () => {
    const mockWindow = {
      addEventListener: vi.fn(),
      postMessage: vi.fn(),
    };

    initContentBridge(mockWindow, {});

    expect(mockWindow.addEventListener).toHaveBeenCalledWith("message", expect.any(Function));
    expect(mockWindow.postMessage).toHaveBeenCalledWith(
      {
        source: "focuslock-extension",
        type: "FOCUSLOCK_EXTENSION_ANNOUNCE",
        installed: true,
      },
      "*",
    );
  });

  it("forwards runtime status update broadcasts to the dashboard window", () => {
    const fakeWindow = { postMessage: vi.fn() };
    const { handleRuntimeMessage } = require("../chrome-extension/content-bridge.js");

    handleRuntimeMessage(
      {
        type: "FOCUSLOCK_STATUS_UPDATE",
        state: "AUTHENTICATED",
        status: { availableMinutes: 15, activeSession: null },
      },
      fakeWindow,
    );

    expect(fakeWindow.postMessage).toHaveBeenCalledWith(
      {
        source: "focuslock-extension",
        type: "FOCUSLOCK_EXTENSION_STATUS",
        installed: true,
        state: "AUTHENTICATED",
        availableMinutes: 15,
        hasActiveSession: false,
      },
      "*",
    );
  });

  it("subscribes to chrome.runtime.onMessage in initContentBridge when available", () => {
    const mockWindow = { addEventListener: vi.fn(), postMessage: vi.fn() };
    const mockRuntime = { onMessage: { addListener: vi.fn() } };

    initContentBridge(mockWindow, mockRuntime);

    expect(mockRuntime.onMessage.addListener).toHaveBeenCalledWith(expect.any(Function));
  });
});
