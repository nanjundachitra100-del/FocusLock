import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: {
    getConfig: vi.fn(),
    setConfig: vi.fn(),
    getStatus: vi.fn(),
  },
  buildBlockingRules: vi.fn(),
  getHostPermissionOrigins: vi.fn(),
  getBlockedTabQueryPatterns: vi.fn(),
  getPermissionScopedSites: vi.fn(),
  isConfirmedSessionStart: vi.fn(),
  isReconciliationCurrent: vi.fn(),
  isSessionAuthorized: vi.fn(),
  reconcileDynamicRules: vi.fn(),
  removeAllowRules: vi.fn(),
  validateExcludedHosts: vi.fn(),
  validateBlockedSites: vi.fn(),
}));

vi.mock("../chrome-extension/auth-client.js", () => ({
  createExtensionAuth: () => mocks.auth,
}));

vi.mock("../chrome-extension/blocking.js", () => ({
  BLOCKED_PAGE_PATH: "/blocked.html",
  DEFAULT_BLOCKED_DOMAINS: ["youtube.com"],
  SESSION_REVOKE_MARGIN_MS: 60_000,
  buildBlockingRules: mocks.buildBlockingRules,
  getBlockedTabQueryPatterns: mocks.getBlockedTabQueryPatterns,
  getHostPermissionOrigins: mocks.getHostPermissionOrigins,
  getPermissionScopedSites: mocks.getPermissionScopedSites,
  isConfirmedSessionStart: mocks.isConfirmedSessionStart,
  isReconciliationCurrent: mocks.isReconciliationCurrent,
  isSessionAuthorized: mocks.isSessionAuthorized,
  reconcileDynamicRules: mocks.reconcileDynamicRules,
  removeAllowRules: mocks.removeAllowRules,
  validateExcludedHosts: mocks.validateExcludedHosts,
  validateBlockedSites: mocks.validateBlockedSites,
}));

function makeChromeMock() {
  return {
    runtime: {
      getManifest: vi.fn(() => ({ version: "0.1.1" })),
      getURL: vi.fn((path) => `chrome-extension://focuslock${path}`),
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn() },
    },
    alarms: {
      clear: vi.fn().mockResolvedValue(true),
      create: vi.fn().mockResolvedValue(undefined),
      onAlarm: { addListener: vi.fn() },
    },
    permissions: {
      contains: vi.fn().mockResolvedValue(false),
      onAdded: { addListener: vi.fn() },
      onRemoved: { addListener: vi.fn() },
    },
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
    declarativeNetRequest: {
      getDynamicRules: vi.fn().mockResolvedValue([]),
      getSessionRules: vi.fn().mockResolvedValue([]),
    },
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 12, url: "https://youtube.com/" }]),
      update: vi.fn().mockResolvedValue(undefined),
    },
  };
}

async function sendSetConfig(chrome: ReturnType<typeof makeChromeMock>, config: unknown) {
  await import("../chrome-extension/background.js");
  const listener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
  let responseCount = 0;
  const response = await new Promise((resolve) => {
    const keepAlive = listener({ type: "SET_CONFIG", config }, {}, (value) => {
      responseCount++;
      resolve(value);
    });
    expect(keepAlive).toBe(true);
  });
  return { response, responseCount };
}

describe("extension SET_CONFIG message handling", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("chrome", makeChromeMock());
    mocks.auth.getConfig.mockResolvedValue({ configured: false });
    mocks.auth.setConfig.mockResolvedValue({ ok: true });
    mocks.auth.getStatus.mockResolvedValue({ state: "SIGNED_OUT" });
    mocks.getPermissionScopedSites.mockImplementation(async (sites: unknown) => ({
      sites,
      missingOrigins: [],
    }));
    mocks.buildBlockingRules.mockReturnValue({
      blockRules: [],
      allowRules: [],
      domains: [],
      authorizedUntil: null,
    });
    mocks.getHostPermissionOrigins.mockReturnValue([]);
    mocks.getBlockedTabQueryPatterns.mockReturnValue(["*://youtube.com/*"]);
    mocks.isReconciliationCurrent.mockImplementation((expected, current) => expected === current);
    mocks.isSessionAuthorized.mockReturnValue(false);
    mocks.reconcileDynamicRules.mockResolvedValue([]);
    mocks.removeAllowRules.mockResolvedValue(undefined);
    mocks.validateExcludedHosts.mockImplementation((hosts: unknown) =>
      Array.isArray(hosts) ? hosts : null,
    );
    mocks.validateBlockedSites.mockReturnValue(null);
  });

  it("reports pre-save blocking failure distinctly and does not save config", async () => {
    const chrome = (globalThis as typeof globalThis & {
      chrome: ReturnType<typeof makeChromeMock>;
    }).chrome;
    mocks.reconcileDynamicRules.mockRejectedValueOnce(new Error("DNR rejected update"));

    await expect(sendSetConfig(chrome, { backendUrl: "http://localhost:3000" })).resolves.toEqual({
      response: {
        ok: false,
        reason: "BLOCKING_RECONCILIATION_FAILED",
        stage: "before_save",
      },
      responseCount: 1,
    });
    expect(mocks.auth.setConfig).not.toHaveBeenCalled();
  });

  it("passes safe validation reason codes through unchanged", async () => {
    const chrome = (globalThis as typeof globalThis & {
      chrome: ReturnType<typeof makeChromeMock>;
    }).chrome;
    mocks.auth.setConfig.mockResolvedValueOnce({
      ok: false,
      reason: "INVALID_PUBLISHABLE_KEY",
    });

    await expect(sendSetConfig(chrome, {})).resolves.toEqual({
      response: { ok: false, reason: "INVALID_PUBLISHABLE_KEY", stage: "save" },
      responseCount: 1,
    });
    expect(mocks.auth.setConfig).toHaveBeenCalledOnce();
  });

  it("sends one consistent success response after asynchronous initialization", async () => {
    const chrome = (globalThis as typeof globalThis & {
      chrome: ReturnType<typeof makeChromeMock>;
    }).chrome;

    await expect(sendSetConfig(chrome, {})).resolves.toEqual({
      response: { ok: true },
      responseCount: 1,
    });
  });

  it("normalizes a missing auth-service response instead of returning undefined", async () => {
    const chrome = (globalThis as typeof globalThis & {
      chrome: ReturnType<typeof makeChromeMock>;
    }).chrome;
    mocks.auth.setConfig.mockResolvedValueOnce(undefined);

    await expect(sendSetConfig(chrome, {})).resolves.toEqual({
      response: {
        ok: false,
        reason: "INVALID_SERVICE_RESPONSE",
        stage: "save",
      },
      responseCount: 1,
    });
  });

  it("returns a safe failure when auth storage throws", async () => {
    const chrome = (globalThis as typeof globalThis & {
      chrome: ReturnType<typeof makeChromeMock>;
    }).chrome;
    mocks.auth.setConfig.mockRejectedValueOnce(new Error(
      "failed https://user:pass@example.test?token=secret sb_secret_hidden",
    ));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(sendSetConfig(chrome, {})).resolves.toEqual({
      response: { ok: false, reason: "CONFIG_SAVE_FAILED", stage: "save" },
      responseCount: 1,
    });
    const logged = JSON.stringify(errorLog.mock.calls);
    expect(logged).not.toContain("user:pass");
    expect(logged).not.toContain("token=secret");
    expect(logged).not.toContain("sb_secret_hidden");
  });

  it("handles an expiry alarm by removing access, restoring rules, and replacing open YouTube tabs", async () => {
    const chrome = (globalThis as typeof globalThis & {
      chrome: ReturnType<typeof makeChromeMock>;
    }).chrome;
    mocks.buildBlockingRules.mockReturnValue({
      blockRules: [],
      allowRules: [],
      domains: ["youtube.com"],
      authorizedUntil: null,
    });
    await import("../chrome-extension/background.js");
    const alarmListener = chrome.alarms.onAlarm.addListener.mock.calls[0][0];
    let notifyTabUpdate: (() => void) | undefined;
    const tabUpdated = new Promise<void>((resolve) => {
      notifyTabUpdate = resolve;
    });
    chrome.tabs.update.mockImplementation(async () => notifyTabUpdate?.());

    alarmListener({ name: "focusLockSessionRevoke", scheduledTime: Date.now() - 1 });

    await tabUpdated;
    expect(chrome.tabs.update).toHaveBeenCalledWith(12, {
      url: "chrome-extension://focuslock/blocked.html",
    });
    expect(mocks.removeAllowRules).toHaveBeenCalled();
    expect(mocks.reconcileDynamicRules).toHaveBeenCalled();
  });
});
