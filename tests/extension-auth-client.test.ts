import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  createAuthService,
  validateExtensionConfig,
  validateExtensionConfigResult,
} from "../chrome-extension/auth-core.js";

const CONFIG_KEY = "focusLockExtensionConfig";
const AUTH_KEY = "focuslock-guardian-auth";
const now = 1_800_000_000_000;

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    access_token: "access-token",
    refresh_token: "refresh-token",
    expires_at: Math.floor(now / 1000) + 3600,
    ...overrides,
  };
}

function makeStatus(overrides: Record<string, unknown> = {}) {
  return {
    authenticated: true,
    wallet: { availableMinutes: 17, earnedMinutes: 20, spentMinutes: 3 },
    activeSession: null,
    blockedSites: [
      { domain: "youtube.com", enabled: true },
      { domain: "example.net", enabled: false },
    ],
    ...overrides,
  };
}

function makeStatusSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "6b29fef0-0639-4a53-aa93-b35d4de1784c",
    minutes: 10,
    startedAt: new Date(now - 5_000).toISOString(),
    expiresAt: new Date(now + 595_000).toISOString(),
    remainingSeconds: 595,
    ...overrides,
  };
}

function makeStartResponse(minutes = 10) {
  const startedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + minutes * 60_000).toISOString();
  return makeResponse(200, {
    success: true,
    session: {
      id: "6b29fef0-0639-4a53-aa93-b35d4de1784c",
      minutes,
      startedAt,
      expiresAt,
      status: "active",
    },
    availableMinutes: 7,
  });
}

function makeResponse(status: number, body: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: vi.fn().mockResolvedValue(body),
  };
}

function setup({
  session = makeSession(),
  statusResponses = [makeResponse(200, makeStatus())],
  fetchError,
  refreshResult,
  getSessionError = null,
  timeoutMs = 20,
}: {
  session?: ReturnType<typeof makeSession> | null;
  statusResponses?: ReturnType<typeof makeResponse>[];
  fetchError?: Error;
  refreshResult?: { data: { session: ReturnType<typeof makeSession> | null }; error: unknown };
  getSessionError?: unknown;
  timeoutMs?: number;
} = {}) {
  const values = new Map<string, unknown>([
    [
      CONFIG_KEY,
      {
        backendUrl: "http://localhost:3000",
        supabaseUrl: "https://project.supabase.co",
        publishableKey: "sb_publishable_test-key",
      },
    ],
  ]);
  const storage = {
    get: vi.fn(async (key: string) => ({ [key]: values.get(key) })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) values.set(key, value);
    }),
  };
  const sessionValues = new Map<string, string>();
  const sessionStorage = {
    getItem: vi.fn(async (key: string) => sessionValues.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      sessionValues.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      sessionValues.delete(key);
    }),
  };

  const auth = {
    getSession: vi.fn(async () => ({
      data: { session },
      error: getSessionError,
    })),
    signInWithPassword: vi.fn(async () => ({
      data: { session },
      error: null,
    })),
    refreshSession: vi.fn(async () =>
      refreshResult ?? { data: { session: makeSession({ access_token: "refreshed-token" }) }, error: null },
    ),
    signOut: vi.fn(async () => ({ error: null })),
  };

  const supabase = { auth };
  const createClient = vi.fn(() => supabase);
  const fetchImpl = vi.fn(async () => {
    if (fetchError) throw fetchError;
    const response = statusResponses.shift();
    if (!response) throw new Error("No queued API response.");
    return response;
  });
  const service = createAuthService({
    createClient,
    storage,
    sessionStorage,
    fetchImpl,
    authStorageKey: AUTH_KEY,
    timeoutMs,
    now: () => now,
  });

  return { service, storage, sessionStorage, auth, createClient, fetchImpl, values };
}

describe("extension Supabase authentication client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects missing configuration and secret/service-role keys", () => {
    expect(validateExtensionConfig(null)).toBeNull();
    expect(validateExtensionConfig({
      backendUrl: "https://focuslock.example",
      supabaseUrl: "https://project.supabase.co",
      publishableKey: "sb_secret_do-not-use",
    })).toBeNull();
  });

  it("accepts HTTPS Supabase, localhost backend, and publishable-key configuration", () => {
    expect(validateExtensionConfigResult({
      supabaseUrl: "https://psodnuwfzjkrffltvotwd.supabase.co",
      backendUrl: "http://localhost:3000",
      publishableKey: "sb_publishable_test-public-key",
    })).toEqual({
      ok: true,
      config: {
        supabaseUrl: "https://psodnuwfzjkrffltvotwd.supabase.co",
        backendUrl: "http://localhost:3000",
        publishableKey: "sb_publishable_test-public-key",
      },
    });
  });

  it("continues to accept legacy anon JWT keys", () => {
    const payload = btoa(JSON.stringify({ role: "anon" }))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    expect(validateExtensionConfig({
      supabaseUrl: "https://project.supabase.co",
      backendUrl: "http://localhost:3000",
      publishableKey: `header.${payload}.signature`,
    })).not.toBeNull();
  });

  it.each([
    ["non-local HTTP Supabase URL", "supabaseUrl", "http://project.supabase.co", "INVALID_SUPABASE_URL"],
    ["Supabase path", "supabaseUrl", "https://project.supabase.co/rest/v1", "INVALID_SUPABASE_URL"],
    ["Supabase query", "supabaseUrl", "https://project.supabase.co?x=1", "INVALID_SUPABASE_URL"],
    ["Supabase credentials", "supabaseUrl", "https://person:password@project.supabase.co", "INVALID_SUPABASE_URL"],
    ["non-local HTTP backend", "backendUrl", "http://focuslock.example", "INVALID_BACKEND_URL"],
  ])("returns a specific error for %s", (_name, property, invalidValue, reason) => {
    const config = {
      supabaseUrl: "https://project.supabase.co",
      backendUrl: "http://localhost:3000",
      publishableKey: "sb_publishable_test-public-key",
      [property]: invalidValue,
    };
    expect(validateExtensionConfigResult(config)).toEqual({ ok: false, reason });
  });

  it.each(["", "sb_publishable_", "sb_secret_service-key", "service-role-key"])(
    "rejects missing or non-public key values",
    (publishableKey) => {
      expect(validateExtensionConfigResult({
        supabaseUrl: "https://project.supabase.co",
        backendUrl: "http://localhost:3000",
        publishableKey,
      })).toEqual({ ok: false, reason: "INVALID_PUBLISHABLE_KEY" });
    },
  );

  it("passes the expected config property names through popup and service-worker code", () => {
    const popup = readFileSync(
      new URL("../chrome-extension/popup.js", import.meta.url),
      "utf8",
    );
    const popupHtml = readFileSync(
      new URL("../chrome-extension/popup.html", import.meta.url),
      "utf8",
    );
    const background = readFileSync(
      new URL("../chrome-extension/background.js", import.meta.url),
      "utf8",
    );
    const authClient = readFileSync(
      new URL("../chrome-extension/auth-client.js", import.meta.url),
      "utf8",
    );

    expect(popup).toContain('form.get("backendUrl")');
    expect(popup).toContain('form.get("supabaseUrl")');
    expect(popup).toContain('form.get("publishableKey")');
    expect(popupHtml).toContain('name="backendUrl"');
    expect(popupHtml).toContain('name="supabaseUrl"');
    expect(popupHtml).toContain('name="publishableKey"');
    expect(popupHtml).toContain('<script src="popup.js" type="module">');
    expect(popup).toContain('sendMessage("SET_CONFIG", { config })');
    expect(popup).toContain('from "./runtime-messaging.js"');
    expect(popup).toContain("isValidConfigResponse(result)");
    expect(popup).toContain('INVALID_SUPABASE_URL: "Enter a valid HTTPS Supabase project URL');
    expect(popup).toContain('INVALID_BACKEND_URL: "Enter a valid HTTPS backend URL');
    expect(popup).toContain('INVALID_PUBLISHABLE_KEY: "Enter a valid public anon or sb_publishable_ key');
    expect(background).toContain("operation = handleSetConfig(message.config)");
    expect(authClient).toContain('from "./auth-core.js"');
  });

  it("returns validation details and does not persist invalid configuration", async () => {
    const { service, storage } = setup();

    await expect(service.setConfig({
      backendUrl: "http://example.com",
      supabaseUrl: "https://project.supabase.co",
      publishableKey: "sb_publishable_test-public-key",
    })).resolves.toEqual({ ok: false, reason: "INVALID_BACKEND_URL" });
    expect(storage.set).not.toHaveBeenCalled();
  });

  it("persists and reloads valid configuration", async () => {
    const { service, storage } = setup();
    const config = {
      backendUrl: "http://localhost:3000",
      supabaseUrl: "https://project.supabase.co",
      publishableKey: "sb_publishable_test-public-key",
    };

    await expect(service.setConfig(config)).resolves.toEqual({ ok: true });
    expect(storage.set).toHaveBeenCalledWith({
      [CONFIG_KEY]: config,
    });
    await expect(service.getConfig()).resolves.toEqual({
      configured: true,
      ...config,
    });
  });

  it("reports signed out without requesting backend data", async () => {
    const { service, fetchImpl } = setup({ session: null });

    await expect(service.getStatus()).resolves.toEqual({ state: "SIGNED_OUT" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("signs in with Supabase and sends the session access token as a Bearer header", async () => {
    const { service, auth, createClient, storage, sessionStorage, fetchImpl } = setup();

    await expect(service.signIn(" person@example.com ", "user-password")).resolves.toEqual({
      state: "AUTHENTICATED",
    });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "person@example.com",
      password: "user-password",
    });

    await expect(service.getStatus()).resolves.toMatchObject({
      state: "AUTHENTICATED",
      status: {
        availableMinutes: 17,
        activeSession: null,
        blockedSites: [
          { domain: "youtube.com", enabled: true },
          { domain: "example.net", enabled: false },
        ],
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:3000/api/extension/status",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer access-token" }),
      }),
    );
    expect(createClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "sb_publishable_test-key",
      expect.objectContaining({
        auth: expect.objectContaining({
          autoRefreshToken: false,
          persistSession: true,
          storage: sessionStorage,
        }),
      }),
    );
    expect(storage.set).not.toHaveBeenCalled();
  });

  it("does not retain an earlier session after a failed sign-in attempt", async () => {
    const { service, auth, sessionStorage } = setup();
    auth.signInWithPassword.mockResolvedValueOnce({
      data: { session: null },
      error: { status: 400 },
    });

    await expect(service.signIn("person@example.com", "wrong-password")).resolves.toEqual({
      state: "SIGNED_OUT",
      reason: "SIGN_IN_FAILED",
    });
    expect(sessionStorage.removeItem).toHaveBeenCalledWith(AUTH_KEY);
  });

  it("refreshes expiring sessions before calling the backend", async () => {
    const expiredSession = makeSession({ expires_at: Math.floor(now / 1000) + 20 });
    const { service, auth, fetchImpl } = setup({ session: expiredSession });

    await expect(service.getStatus()).resolves.toMatchObject({ state: "AUTHENTICATED" });
    expect(auth.refreshSession).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer refreshed-token" }),
      }),
    );
  });

  it("shares one refresh when concurrent status requests encounter expiring credentials", async () => {
    const expiredSession = makeSession({ expires_at: Math.floor(now / 1000) + 20 });
    const { service, auth, fetchImpl } = setup({
      session: expiredSession,
      statusResponses: [
        makeResponse(200, makeStatus()),
        makeResponse(200, makeStatus()),
      ],
    });

    const results = await Promise.all([service.getStatus(), service.getStatus()]);

    expect(results.map((result) => result.state)).toEqual(["AUTHENTICATED", "AUTHENTICATED"]);
    expect(auth.refreshSession).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("clears the extension session and reports authentication expired after a rejected refresh", async () => {
    const expiredSession = makeSession({ expires_at: Math.floor(now / 1000) - 10 });
    const { service, auth, sessionStorage, fetchImpl } = setup({
      session: expiredSession,
      refreshResult: { data: { session: null }, error: { status: 400 } },
    });

    await expect(service.getStatus()).resolves.toEqual({ state: "AUTHENTICATION_EXPIRED" });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(sessionStorage.removeItem).toHaveBeenCalledWith(AUTH_KEY);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports network unavailable without deleting credentials when refresh fails transiently", async () => {
    const expiredSession = makeSession({ expires_at: Math.floor(now / 1000) - 10 });
    const { service, sessionStorage } = setup({
      session: expiredSession,
      refreshResult: { data: { session: null }, error: { status: 503 } },
    });

    await expect(service.getStatus()).resolves.toEqual({ state: "NETWORK_UNAVAILABLE" });
    expect(sessionStorage.removeItem).not.toHaveBeenCalled();
  });

  it("refreshes and retries once when the backend rejects an expired bearer token", async () => {
    const { service, auth, fetchImpl } = setup({
      statusResponses: [
        makeResponse(401, { error: "Unauthorized" }),
        makeResponse(200, makeStatus()),
      ],
    });

    await expect(service.getStatus()).resolves.toMatchObject({ state: "AUTHENTICATED" });
    expect(auth.refreshSession).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({
      headers: { Authorization: "Bearer refreshed-token" },
    });
  });

  it("handles backend 401 after refresh as authentication expired", async () => {
    const { service, sessionStorage } = setup({
      statusResponses: [
        makeResponse(401, { error: "Unauthorized" }),
        makeResponse(401, { error: "Unauthorized" }),
      ],
    });

    await expect(service.getStatus()).resolves.toEqual({ state: "AUTHENTICATION_EXPIRED" });
    expect(sessionStorage.removeItem).toHaveBeenCalledWith(AUTH_KEY);
  });

  it("handles backend 403 without exposing account values", async () => {
    const { service } = setup({ statusResponses: [makeResponse(403, { error: "Forbidden" })] });

    await expect(service.getStatus()).resolves.toEqual({ state: "FORBIDDEN" });
  });

  it("rejects invalid unlock durations before calling the backend", async () => {
    const { service, fetchImpl } = setup();

    await expect(service.startSession(0)).resolves.toEqual({ state: "INVALID_DURATION" });
    await expect(service.startSession(181)).resolves.toEqual({ state: "INVALID_DURATION" });
    await expect(service.startSession("10" as never)).resolves.toEqual({ state: "INVALID_DURATION" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("starts a timed unlock only from an authenticated server-confirmed API response", async () => {
    const { service, fetchImpl } = setup({ statusResponses: [makeStartResponse(10)] });

    await expect(service.startSession(10)).resolves.toEqual({
      state: "SESSION_STARTED",
      httpStatus: 200,
      serverCreated: true,
      session: {
        id: "6b29fef0-0639-4a53-aa93-b35d4de1784c",
        minutes: 10,
        expiresAt: new Date(now + 10 * 60_000).toISOString(),
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:3000/api/extension/session/start",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ requestedMinutes: 10 }),
        headers: expect.objectContaining({ Authorization: "Bearer access-token" }),
      }),
    );
  });

  it("does not create a session for insufficient balance or a duplicate active-session conflict", async () => {
    const insufficient = setup({
      statusResponses: [makeResponse(400, { error: "Insufficient reward balance.", code: "INSUFFICIENT_BALANCE" })],
    });
    await expect(insufficient.service.startSession(10)).resolves.toEqual({
      state: "INSUFFICIENT_BALANCE",
      httpStatus: 400,
      serverCreated: false,
    });

    const duplicate = setup({
      statusResponses: [makeResponse(409, { error: "Session exists.", code: "ACTIVE_SESSION_EXISTS" })],
    });
    await expect(duplicate.service.startSession(10)).resolves.toEqual({
      state: "ACTIVE_SESSION_EXISTS",
      httpStatus: 409,
      serverCreated: false,
    });
  });

  it("ends only the active session ID obtained from authenticated status", async () => {
    const session = makeStatusSession();
    const { service, fetchImpl } = setup({
      statusResponses: [
        makeResponse(200, makeStatus({ activeSession: session })),
        makeResponse(200, {
          success: true,
          session: {
            id: session.id,
            status: "completed",
            endedAt: new Date(now + 1_000).toISOString(),
          },
        }),
      ],
    });

    await expect(service.endActiveSession()).resolves.toEqual({ state: "SESSION_ENDED", sessionId: session.id });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "http://localhost:3000/api/extension/session/end",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ sessionId: session.id }),
      }),
    );
  });

  it("does not call the end endpoint when status has no active session", async () => {
    const { service, fetchImpl } = setup({
      statusResponses: [makeResponse(200, makeStatus({ activeSession: null }))],
    });

    await expect(service.endActiveSession()).resolves.toEqual({ state: "NO_ACTIVE_SESSION" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("treats backend server errors and malformed JSON as unavailable", async () => {
    const serverError = setup({
      statusResponses: [makeResponse(500, { error: "Server failure" })],
    });
    await expect(serverError.service.getStatus()).resolves.toEqual({
      state: "NETWORK_UNAVAILABLE",
    });

    const malformed = makeResponse(200, null);
    malformed.json.mockRejectedValueOnce(new SyntaxError("Malformed JSON"));
    const invalidJson = setup({ statusResponses: [malformed] });
    await expect(invalidJson.service.getStatus()).resolves.toEqual({
      state: "NETWORK_UNAVAILABLE",
    });
  });

  it("handles network failures and request timeouts", async () => {
    const networkFailure = setup({ fetchError: new Error("offline") });
    await expect(networkFailure.service.getStatus()).resolves.toEqual({ state: "NETWORK_UNAVAILABLE" });

    const values = new Map<string, unknown>([
      [
        CONFIG_KEY,
        {
          backendUrl: "http://localhost:3000",
          supabaseUrl: "https://project.supabase.co",
          publishableKey: "sb_publishable_test-key",
        },
      ],
    ]);
    const storage = {
      get: vi.fn(async (key: string) => ({ [key]: values.get(key) })),
      set: vi.fn(),
    };
    const sessionStorage = {
      getItem: vi.fn(async () => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    const service = createAuthService({
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: makeSession() }, error: null }),
          refreshSession: vi.fn(),
        },
      }),
      storage,
      sessionStorage,
      fetchImpl: (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
      timeoutMs: 5,
      now: () => now,
    });
    await expect(service.getStatus()).resolves.toEqual({ state: "NETWORK_UNAVAILABLE" });
  });

  it("rejects malformed successful API responses without showing fabricated values", async () => {
    const malformed = setup({ statusResponses: [makeResponse(200, { authenticated: true, wallet: {} })] });
    await expect(malformed.service.getStatus()).resolves.toEqual({ state: "NETWORK_UNAVAILABLE" });

    const invalidSession = setup({
      statusResponses: [
        makeResponse(200, makeStatus({ activeSession: { id: "x", minutes: -5, expiresAt: "not-a-date" } })),
      ],
    });
    await expect(invalidSession.service.getStatus()).resolves.toEqual({ state: "NETWORK_UNAVAILABLE" });

    const invalidSites = setup({
      statusResponses: [makeResponse(200, makeStatus({ blockedSites: [{ domain: "not a domain", enabled: true }] }))],
    });
    await expect(invalidSites.service.getStatus()).resolves.toEqual({ state: "NETWORK_UNAVAILABLE" });

    const emptySites = setup({
      statusResponses: [makeResponse(200, makeStatus({ blockedSites: [] }))],
    });
    await expect(emptySites.service.getStatus()).resolves.toMatchObject({
      state: "AUTHENTICATED",
      status: { blockedSites: [] },
    });

    const fractionalBalance = setup({
      statusResponses: [makeResponse(200, makeStatus({ wallet: { availableMinutes: 1.5 } }))],
    });
    await expect(fractionalBalance.service.getStatus()).resolves.toEqual({
      state: "NETWORK_UNAVAILABLE",
    });
  });
});
