const CONFIG_KEY = "focusLockExtensionConfig";
const REQUEST_TIMEOUT_MS = 10_000;
const REFRESH_MARGIN_SECONDS = 60;
const MAX_SESSION_MINUTES = 180;
const DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeBaseUrl(value, { allowLocalHttp = true } = {}) {
  if (typeof value !== "string" || value.trim() === "") return null;

  try {
    const url = new URL(value.trim());
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

function isPublishableKey(value) {
  if (typeof value !== "string") return false;
  if (value.startsWith("sb_secret_")) return false;
  if (value.startsWith("sb_publishable_")) {
    return value.length > "sb_publishable_".length;
  }

  const parts = value.split(".");
  if (parts.length !== 3) return false;

  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(payload));
    return claims.role === "anon";
  } catch {
    return false;
  }
}

export function validateExtensionConfigResult(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, reason: "INVALID_CONFIG" };
  }

  const supabaseUrl = normalizeBaseUrl(input.supabaseUrl);
  if (!supabaseUrl) return { ok: false, reason: "INVALID_SUPABASE_URL" };

  const backendUrl = normalizeBaseUrl(input.backendUrl);
  if (!backendUrl) return { ok: false, reason: "INVALID_BACKEND_URL" };

  const publishableKey =
    typeof input.publishableKey === "string" ? input.publishableKey.trim() : "";

  if (!isPublishableKey(publishableKey)) {
    return { ok: false, reason: "INVALID_PUBLISHABLE_KEY" };
  }
  return {
    ok: true,
    config: { supabaseUrl, backendUrl, publishableKey },
  };
}

export function validateExtensionConfig(input) {
  const result = validateExtensionConfigResult(input);
  return result.ok ? result.config : null;
}

function isValidSession(session) {
  if (session === null) return true;
  if (!session || typeof session !== "object" || Array.isArray(session)) return false;
  const startedAt = Date.parse(session.startedAt);
  const expiresAt = Date.parse(session.expiresAt);
  const authorizedDurationMs = session.minutes * 60_000;
  return typeof session.id === "string" &&
    UUID_PATTERN.test(session.id) &&
    Number.isInteger(session.minutes) &&
    session.minutes > 0 &&
    Number.isFinite(startedAt) &&
    Number.isFinite(expiresAt) &&
    expiresAt - startedAt <= authorizedDurationMs + 5_000 &&
    expiresAt > startedAt &&
    Number.isInteger(session.remainingSeconds) &&
    session.remainingSeconds >= 0;
}

function isValidStatus(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const availableMinutes = payload.wallet?.availableMinutes;
  const session = payload.activeSession;
  const blockedSites = payload.blockedSites;
  const validSites =
    Array.isArray(blockedSites) &&
    blockedSites.length <= 50 &&
    blockedSites.every((site) =>
      site &&
      typeof site === "object" &&
      !Array.isArray(site) &&
      typeof site.domain === "string" &&
      DOMAIN_PATTERN.test(site.domain) &&
      typeof site.enabled === "boolean",
    );
  return payload.authenticated === true &&
    Number.isInteger(availableMinutes) &&
    availableMinutes >= 0 &&
    validSites &&
    isValidSession(session);
}

function makeTimeoutFetch(fetchImpl, timeoutMs) {
  return async (input, init = {}) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  };
}

export function createAuthService({
  createClient,
  storage,
  sessionStorage = storage,
  fetchImpl = fetch,
  authStorageKey = "focuslock-guardian-auth",
  timeoutMs = REQUEST_TIMEOUT_MS,
  now = () => Date.now(),
}) {
  const timeoutFetch = makeTimeoutFetch(fetchImpl, timeoutMs);
  let config = null;
  let client = null;
  let clientConfigKey = null;
  let refreshInProgress = null;

  async function loadConfig() {
    if (config) return config;
    const values = await storage.get(CONFIG_KEY);
    config = validateExtensionConfig(values[CONFIG_KEY]);
    return config;
  }

  async function getClient() {
    const currentConfig = await loadConfig();
    if (!currentConfig) return null;
    const nextClientConfigKey = `${currentConfig.supabaseUrl}\n${currentConfig.publishableKey}`;
    if (client && clientConfigKey === nextClientConfigKey) return client;

    clientConfigKey = nextClientConfigKey;
    client = createClient(currentConfig.supabaseUrl, currentConfig.publishableKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: true,
        storage: sessionStorage,
        storageKey: authStorageKey,
      },
      global: {
        fetch: timeoutFetch,
      },
    });
    return client;
  }

  async function clearSession(supabase) {
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      await sessionStorage.removeItem(authStorageKey);
    }
    await sessionStorage.removeItem(authStorageKey);
  }

  async function getSession(supabase) {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) return { error: true, session: null };
      return { error: false, session: data.session ?? null };
    } catch {
      return { error: true, session: null };
    }
  }

  async function refreshSession(supabase, rejectedAccessToken) {
    if (refreshInProgress) return refreshInProgress;

    refreshInProgress = (async () => {
      const current = await getSession(supabase);
      if (current.error) return { session: null, state: "NETWORK_UNAVAILABLE" };
      if (!current.session?.refresh_token) return { session: null, state: "AUTHENTICATION_EXPIRED" };
      if (
        rejectedAccessToken &&
        current.session.access_token !== rejectedAccessToken &&
        current.session.expires_at * 1000 > now()
      ) {
        return { session: current.session, state: "AUTHENTICATED" };
      }

      try {
        const { data, error } = await supabase.auth.refreshSession();
        if (error) {
          const status = error.status;
          const transient = status === undefined || status === 0 || status === 408 || status === 429 || status >= 500;
          return {
            session: null,
            state: transient ? "NETWORK_UNAVAILABLE" : "AUTHENTICATION_EXPIRED",
          };
        }
        return data.session
          ? { session: data.session, state: "AUTHENTICATED" }
          : { session: null, state: "AUTHENTICATION_EXPIRED" };
      } catch {
        return { session: null, state: "NETWORK_UNAVAILABLE" };
      }
    })();

    try {
      return await refreshInProgress;
    } finally {
      refreshInProgress = null;
    }
  }

  async function requestStatus(currentConfig, accessToken) {
    try {
      const response = await timeoutFetch(
        `${currentConfig.backendUrl}/api/extension/status`,
        {
          method: "GET",
          cache: "no-store",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );
      return { response };
    } catch {
      return { networkError: true };
    }
  }

  async function requestStatusWithRefresh(supabase, currentConfig, session) {
    let accessToken = session.access_token;
    const first = await requestStatus(currentConfig, accessToken);
    if (first.networkError) return { state: "NETWORK_UNAVAILABLE" };
    if (first.response.status === 403) return { state: "FORBIDDEN" };

    let response = first.response;
    if (response.status === 401) {
      const refreshed = await refreshSession(supabase, accessToken);
      if (!refreshed.session?.access_token) {
        if (refreshed.state === "NETWORK_UNAVAILABLE") return { state: "NETWORK_UNAVAILABLE" };
        await clearSession(supabase);
        return { state: "AUTHENTICATION_EXPIRED" };
      }
      accessToken = refreshed.session.access_token;
      const retry = await requestStatus(currentConfig, accessToken);
      if (retry.networkError) return { state: "NETWORK_UNAVAILABLE" };
      if (retry.response.status === 401) {
        await clearSession(supabase);
        return { state: "AUTHENTICATION_EXPIRED" };
      }
      if (retry.response.status === 403) return { state: "FORBIDDEN" };
      response = retry.response;
    }

    if (!response.ok) return { state: "NETWORK_UNAVAILABLE" };

    try {
      const payload = await response.json();
      if (!isValidStatus(payload)) return { state: "NETWORK_UNAVAILABLE" };
      return {
        state: "AUTHENTICATED",
        status: {
          availableMinutes: payload.wallet.availableMinutes,
          activeSession: payload.activeSession,
          blockedSites: payload.blockedSites,
        },
      };
    } catch {
      return { state: "NETWORK_UNAVAILABLE" };
    }
  }

  async function requestAuthenticatedJson(path, init = {}) {
    const currentConfig = await loadConfig();
    if (!currentConfig) return { state: "NETWORK_UNAVAILABLE" };

    const supabase = await getClient();
    const current = await getSession(supabase);
    if (current.error) return { state: "NETWORK_UNAVAILABLE" };
    if (!current.session) return { state: "SIGNED_OUT" };

    let session = current.session;
    const expiresAt = Number(session.expires_at);
    if (
      !session.access_token ||
      !session.refresh_token ||
      !Number.isFinite(expiresAt)
    ) {
      await clearSession(supabase);
      return { state: "AUTHENTICATION_EXPIRED" };
    }

    if (expiresAt <= Math.floor(now() / 1000) + REFRESH_MARGIN_SECONDS) {
      const refreshed = await refreshSession(supabase, null);
      if (!refreshed.session?.access_token) {
        if (refreshed.state === "NETWORK_UNAVAILABLE") return refreshed;
        await clearSession(supabase);
        return { state: "AUTHENTICATION_EXPIRED" };
      }
      session = refreshed.session;
    }

    async function send(accessToken) {
      return timeoutFetch(`${currentConfig.backendUrl}${path}`, {
        ...init,
        cache: "no-store",
        headers: {
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
          Authorization: `Bearer ${accessToken}`,
        },
      });
    }

    let response;
    try {
      response = await send(session.access_token);
    } catch {
      return { state: "NETWORK_UNAVAILABLE" };
    }

    if (response.status === 401) {
      const refreshed = await refreshSession(supabase, session.access_token);
      if (!refreshed.session?.access_token) {
        if (refreshed.state === "NETWORK_UNAVAILABLE") return refreshed;
        await clearSession(supabase);
        return { state: "AUTHENTICATION_EXPIRED" };
      }
      try {
        response = await send(refreshed.session.access_token);
      } catch {
        return { state: "NETWORK_UNAVAILABLE" };
      }
      if (response.status === 401) {
        await clearSession(supabase);
        return { state: "AUTHENTICATION_EXPIRED", httpStatus: 401, serverCreated: false };
      }
    }

    if (response.status === 403) return { state: "FORBIDDEN", httpStatus: 403, serverCreated: false };

    let payload;
    try {
      payload = await response.json();
    } catch {
      return { state: "NETWORK_UNAVAILABLE" };
    }

    if (!response.ok) {
      return {
        state: "API_ERROR",
        status: response.status,
        httpStatus: response.status,
        code: typeof payload?.code === "string" ? payload.code : undefined,
      };
    }

    return { state: "RESPONSE", payload, httpStatus: response.status };
  }

  async function getVerifiedStatus() {
    const currentConfig = await loadConfig();
    if (!currentConfig) return { state: "NETWORK_UNAVAILABLE", reason: "NOT_CONFIGURED" };

    const supabase = await getClient();
    const current = await getSession(supabase);
    if (current.error) return { state: "NETWORK_UNAVAILABLE" };
    if (!current.session) return { state: "SIGNED_OUT" };

    let session = current.session;
    const expiresAt = Number(session.expires_at);
    if (
      !session.access_token ||
      !session.refresh_token ||
      !Number.isFinite(expiresAt)
    ) {
      await clearSession(supabase);
      return { state: "AUTHENTICATION_EXPIRED" };
    }

    if (expiresAt <= Math.floor(now() / 1000) + REFRESH_MARGIN_SECONDS) {
      const refreshed = await refreshSession(supabase, null);
      if (!refreshed.session?.access_token) {
        if (refreshed.state === "NETWORK_UNAVAILABLE") return { state: "NETWORK_UNAVAILABLE" };
        await clearSession(supabase);
        return { state: "AUTHENTICATION_EXPIRED" };
      }
      session = refreshed.session;
    }

    return requestStatusWithRefresh(supabase, currentConfig, session);
  }

  return {
    async getConfig() {
      const currentConfig = await loadConfig();
      return currentConfig
        ? {
            configured: true,
            backendUrl: currentConfig.backendUrl,
            supabaseUrl: currentConfig.supabaseUrl,
            publishableKey: currentConfig.publishableKey,
          }
        : { configured: false };
    },

    async setConfig(input) {
      const validation = validateExtensionConfigResult(input);
      if (!validation.ok) return validation;
      const nextConfig = validation.config;

      const oldClient = client;
      if (oldClient) await clearSession(oldClient);
      await storage.set({ [CONFIG_KEY]: nextConfig });
      await sessionStorage.removeItem(authStorageKey);
      config = nextConfig;
      client = null;
      clientConfigKey = null;
      return { ok: true };
    },

    async signIn(email, password) {
      if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password) {
        return { state: "SIGNED_OUT", reason: "INVALID_CREDENTIALS" };
      }

      const supabase = await getClient();
      if (!supabase) return { state: "NETWORK_UNAVAILABLE", reason: "NOT_CONFIGURED" };

      const current = await getSession(supabase);
      if (current.error) return { state: "NETWORK_UNAVAILABLE" };
      if (current.session) await clearSession(supabase);

      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error || !data.session?.access_token || !data.session.refresh_token) {
          return { state: "SIGNED_OUT", reason: "SIGN_IN_FAILED" };
        }
        return { state: "AUTHENTICATED" };
      } catch {
        return { state: "NETWORK_UNAVAILABLE" };
      }
    },

    async signOut() {
      const supabase = await getClient();
      if (supabase) await clearSession(supabase);
      return { state: "SIGNED_OUT" };
    },

    async startSession(requestedMinutes) {
      if (
        !Number.isInteger(requestedMinutes) ||
        requestedMinutes < 1 ||
        requestedMinutes > MAX_SESSION_MINUTES
      ) {
        return { state: "INVALID_DURATION" };
      }

      const result = await requestAuthenticatedJson(
        "/api/extension/session/start",
        {
          method: "POST",
          body: JSON.stringify({ requestedMinutes }),
        },
      );
      if (result.state === "API_ERROR") {
        if (result.code === "INSUFFICIENT_BALANCE") return { state: "INSUFFICIENT_BALANCE", httpStatus: result.httpStatus, serverCreated: false };
        if (result.code === "ACTIVE_SESSION_EXISTS") return { state: "ACTIVE_SESSION_EXISTS", httpStatus: result.httpStatus, serverCreated: false };
        return result;
      }
      if (result.state !== "RESPONSE") return result;

      const session = result.payload?.session;
      const availableMinutes = result.payload?.availableMinutes;
      const startedAt = Date.parse(session?.startedAt);
      const expiresAt = Date.parse(session?.expiresAt);
      if (
        result.payload?.success !== true ||
        typeof session?.id !== "string" ||
        !UUID_PATTERN.test(session.id) ||
        session.minutes !== requestedMinutes ||
        session.status !== "active" ||
        !Number.isFinite(startedAt) ||
        !Number.isFinite(expiresAt) ||
        expiresAt <= startedAt ||
        expiresAt - startedAt > requestedMinutes * 60_000 + 5_000 ||
        expiresAt <= now() ||
        !Number.isInteger(availableMinutes) ||
        availableMinutes < 0
      ) {
        return { state: "NETWORK_UNAVAILABLE", httpStatus: result.httpStatus, serverCreated: result.payload?.success === true };
      }

      return {
        state: "SESSION_STARTED",
        httpStatus: result.httpStatus,
        serverCreated: true,
        session: {
          id: session.id,
          minutes: session.minutes,
          expiresAt: session.expiresAt,
        },
      };
    },

    async endActiveSession() {
      const status = await getVerifiedStatus();
      if (status.state !== "AUTHENTICATED") return status;

      const activeSession = status.status.activeSession;
      if (!activeSession || Date.parse(activeSession.expiresAt) <= now()) {
        return { state: "NO_ACTIVE_SESSION" };
      }

      const result = await requestAuthenticatedJson(
        "/api/extension/session/end",
        {
          method: "POST",
          body: JSON.stringify({ sessionId: activeSession.id }),
        },
      );
      if (result.state !== "RESPONSE") return result;

      const endedSession = result.payload?.session;
      if (
        result.payload?.success !== true ||
        endedSession?.id !== activeSession.id ||
        typeof endedSession.status !== "string" ||
        typeof endedSession.endedAt !== "string" ||
        !Number.isFinite(Date.parse(endedSession.endedAt))
      ) {
        return { state: "NETWORK_UNAVAILABLE" };
      }

      return { state: "SESSION_ENDED", sessionId: activeSession.id };
    },

    async getStatus() {
      return getVerifiedStatus();
    },
  };
}
