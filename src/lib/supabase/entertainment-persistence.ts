if (typeof window !== "undefined") {
  throw new Error("This module can only be executed on the server.");
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { DEFAULT_BLOCKED_DOMAINS } from "@/lib/blocked-sites/catalog";
import { MAX_BLOCKED_SITES, normalizeBlockedWebsiteDomain } from "@/lib/blocked-sites/domain";
import { getSupabasePublicConfig } from "./env";
import { isSupportedSessionDuration } from "@/lib/extension/session-duration";

export { DEFAULT_BLOCKED_DOMAINS };

export interface EntertainmentSessionRecord {
  id: string;
  userId: string;
  minutes: number;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  status: "active" | "completed" | "expired" | "abandoned";
}

export type StartSessionResult =
  | {
      success: true;
      session: {
        id: string;
        minutes: number;
        startedAt: string;
        expiresAt: string;
        status: string;
      };
      availableMinutes: number;
      method: "rpc";
    }
  | {
      success: false;
      error: string;
      code: "INSUFFICIENT_BALANCE" | "ACTIVE_SESSION_EXISTS" | "DUPLICATE_SESSION" | "INVALID_DURATION" | "DB_ERROR" | "MIGRATION_REQUIRED";
    };

export type EndSessionResult =
  | {
      success: true;
      session: {
        id: string;
        status: string;
        endedAt: string;
      };
    }
  | {
      success: false;
      error: string;
      code: "NOT_FOUND" | "DB_ERROR" | "MIGRATION_REQUIRED";
    };

export interface EntertainmentStatus {
  earnedMinutes: number;
  spentMinutes: number;
  availableMinutes: number;
  activeSession: {
    id: string;
    minutes: number;
    startedAt: string;
    expiresAt: string;
    remainingSeconds: number;
  } | null;
  blockedSites: {
    domain: string;
    enabled: boolean;
  }[];
}

export { MAX_BLOCKED_SITES };

export type SaveBlockedSitesResult =
  | {
      success: true;
      sites: { domain: string; enabled: boolean }[];
    }
  | {
      success: false;
      sites: [];
      error: string;
      code: "VALIDATION" | "DB_ERROR" | "MIGRATION_REQUIRED";
    };

type SpendRewardResponse = Database["public"]["Functions"]["spend_reward_minutes"]["Returns"];
type EndSessionResponse = Database["public"]["Functions"]["end_entertainment_session"]["Returns"];
type ReplaceBlockedSitesResponse = Database["public"]["Functions"]["replace_user_blocked_sites"]["Returns"];

function isSpendRewardResponse(value: unknown): value is SpendRewardResponse {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return typeof result.session_id === "string" &&
    typeof result.minutes === "number" &&
    typeof result.started_at === "string" &&
    typeof result.expires_at === "string" &&
    typeof result.status === "string" &&
    typeof result.available_minutes === "number";
}

function isEndSessionResponse(value: unknown): value is EndSessionResponse {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return typeof result.session_id === "string" &&
    typeof result.status === "string" &&
    typeof result.ended_at === "string";
}

function isReplaceBlockedSitesResponse(value: unknown): value is ReplaceBlockedSitesResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const sites = (value as Record<string, unknown>).sites;
  if (!Array.isArray(sites)) return false;
  return sites.every((item) => {
    if (!item || typeof item !== "object") return false;
    const site = item as Record<string, unknown>;
    return typeof site.domain === "string" && typeof site.enabled === "boolean";
  });
}

function validationFailure(error: string): SaveBlockedSitesResult {
  return { success: false, sites: [], error, code: "VALIDATION" };
}

/**
 * Normalizes a website domain string (removes protocol, www, trailing slashes).
 */
export function normalizeDomain(rawDomain: string): string | null {
  return normalizeBlockedWebsiteDomain(rawDomain);
}

/**
 * Fetches the current entertainment status, wallet balance, active session, and blocked sites for a user.
 */
export async function getEntertainmentStatus(
  authenticatedClient: SupabaseClient<Database>,
  userId: string,
): Promise<EntertainmentStatus> {
  // 1. Compute wallet balance from reward transactions
  const { data: transactions, error: transactionsError } = await authenticatedClient
    .from("reward_transactions")
    .select("transaction_type, minutes")
    .eq("user_id", userId);

  if (transactionsError || !transactions) {
    throw new Error("Failed to load reward balance.");
  }

  let earnedMinutes = 0;
  let spentMinutes = 0;

  if (transactions && Array.isArray(transactions)) {
    for (const tx of transactions) {
      if (tx.transaction_type === "earned") {
        earnedMinutes += tx.minutes;
      } else if (tx.transaction_type === "spent") {
        spentMinutes += tx.minutes;
      }
    }
  }

  const availableMinutes = Math.max(0, earnedMinutes - spentMinutes);

  // 2. Fetch active entertainment session
  const now = new Date();
  const { data: sessionRows, error: sessionsError } = await authenticatedClient
    .from("entertainment_sessions")
    .select("id, minutes, started_at, expires_at, status")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("expires_at", { ascending: false })
    .limit(1);

  if (sessionsError || !sessionRows) {
    throw new Error("Failed to load entertainment session.");
  }

  let activeSession: EntertainmentStatus["activeSession"] = null;

  if (sessionRows && sessionRows.length > 0) {
    const candidate = sessionRows[0];
    const expiresAt = new Date(candidate.expires_at);
    const remainingSeconds = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));

    if (remainingSeconds > 0) {
      activeSession = {
        id: candidate.id,
        minutes: candidate.minutes,
        startedAt: candidate.started_at,
        expiresAt: candidate.expires_at,
        remainingSeconds,
      };
    }
  }

  // 3. Fetch user blocked sites
  const { data: siteRows, error: sitesError } = await authenticatedClient
    .from("user_blocked_sites")
    .select("domain, enabled")
    .eq("user_id", userId)
    .order("domain", { ascending: true });

  if (sitesError || !siteRows) {
    throw new Error("Failed to load blocked sites.");
  }

  let blockedSites: EntertainmentStatus["blockedSites"] = [];

  if (siteRows && siteRows.length > 0) {
    blockedSites = siteRows.map((s) => ({
      domain: s.domain,
      enabled: s.enabled,
    }));
  } else {
    // Default blocked domains
    blockedSites = DEFAULT_BLOCKED_DOMAINS.map((domain) => ({
      domain,
      enabled: true,
    }));
  }

  return {
    earnedMinutes,
    spentMinutes,
    availableMinutes,
    activeSession,
    blockedSites,
  };
}

/**
 * Atomically starts an entertainment session and spends reward minutes.
 */
export async function startEntertainmentSession(
  authenticatedClient: SupabaseClient<Database>,
  options: {
    minutes: number;
    sessionId?: string;
  },
): Promise<StartSessionResult> {
  const { minutes, sessionId } = options;

  if (!isSupportedSessionDuration(minutes)) {
    return {
      success: false,
      error: "Choose 5, 10, 15, 30, or 60 minutes.",
      code: "INVALID_DURATION",
    };
  }

  try {
    const { data, error: rpcError } = await authenticatedClient.rpc(
      "spend_reward_minutes",
      {
        p_minutes: minutes,
        p_session_id: sessionId || null,
      },
    );
    const rpcData: unknown = data;

    if (rpcError) {
      const msg = rpcError.message || "";
      if (msg.includes("Insufficient reward balance")) {
        return {
          success: false,
          error: "Insufficient reward balance.",
          code: "INSUFFICIENT_BALANCE",
        };
      }
      if (msg.includes("already in progress")) {
        return {
          success: false,
          error: "An active entertainment session is already in progress.",
          code: "ACTIVE_SESSION_EXISTS",
        };
      }
      if (msg.includes("already been used")) {
        return {
          success: false,
          error: "This session ID has already been used.",
          code: "DUPLICATE_SESSION",
        };
      }
      if (msg.includes("Invalid minutes")) {
        return {
          success: false,
          error: "Choose 5, 10, 15, 30, or 60 minutes.",
          code: "INVALID_DURATION",
        };
      }
      if (rpcError.code === "23505") {
        return {
          success: false,
          error: "This session ID has already been used.",
          code: "DUPLICATE_SESSION",
        };
      }
      if (msg.includes("Profile not found")) {
        return {
          success: false,
          error: "Profile not found for authenticated user.",
          code: "DB_ERROR",
        };
      }
      if (rpcError.code === "PGRST202" || rpcError.code === "42883") {
        return {
          success: false,
          error: "Database migration required: spend_reward_minutes RPC is not installed.",
          code: "MIGRATION_REQUIRED",
        };
      }

      return {
        success: false,
        error: "Unable to confirm entertainment session start.",
        code: "DB_ERROR",
      };
    }

    if (!isSpendRewardResponse(rpcData)) {
      return {
        success: false,
        error: "Unable to confirm entertainment session start.",
        code: "DB_ERROR",
      };
    }

    return {
      success: true,
      session: {
        id: rpcData.session_id,
        minutes: rpcData.minutes,
        startedAt: rpcData.started_at,
        expiresAt: rpcData.expires_at,
        status: rpcData.status,
      },
      availableMinutes: rpcData.available_minutes,
      method: "rpc",
    };
  } catch {
    return {
      success: false,
      error: "Unable to confirm entertainment session start.",
      code: "DB_ERROR",
    };
  }
}

/**
 * Ends an active entertainment session.
 */
export async function endEntertainmentSession(
  authenticatedClient: SupabaseClient<Database>,
  options: {
    sessionId: string;
  },
): Promise<EndSessionResult> {
  const { sessionId } = options;

  if (!sessionId || typeof sessionId !== "string") {
    return {
      success: false,
      error: "Missing or invalid session ID.",
      code: "DB_ERROR",
    };
  }

  try {
    const { data, error: rpcError } = await authenticatedClient.rpc(
      "end_entertainment_session",
      {
        p_session_id: sessionId,
      },
    );
    const rpcData: unknown = data;

    if (rpcError) {
      const msg = rpcError.message || "";
      if (msg.includes("not found")) {
        return { success: false, error: "Entertainment session not found.", code: "NOT_FOUND" };
      }
      if (rpcError.code === "PGRST202" || rpcError.code === "42883") {
        return {
          success: false,
          error: "Database migration required: end_entertainment_session RPC is not installed.",
          code: "MIGRATION_REQUIRED",
        };
      }

      return {
        success: false,
        error: "Unable to confirm entertainment session end.",
        code: "DB_ERROR",
      };
    }

    if (!isEndSessionResponse(rpcData)) {
      return {
        success: false,
        error: "Unable to confirm entertainment session end.",
        code: "DB_ERROR",
      };
    }

    return {
      success: true,
      session: {
        id: rpcData.session_id,
        status: rpcData.status,
        endedAt: rpcData.ended_at,
      },
    };
  } catch {
    return {
      success: false,
      error: "Unable to confirm entertainment session end.",
      code: "DB_ERROR",
    };
  }
}

/**
 * Atomically replaces the authenticated user's blocked-site list.
 * Ownership is enforced by replace_user_blocked_sites via auth.uid().
 */
export async function saveUserBlockedSites(
  authenticatedClient: SupabaseClient<Database>,
  domains: { domain: string; enabled: boolean }[],
): Promise<SaveBlockedSitesResult> {
  if (!Array.isArray(domains) || domains.length === 0 || domains.length > MAX_BLOCKED_SITES) {
    return validationFailure("Blocked sites must contain between 1 and 50 entries.");
  }

  const validSites: { domain: string; enabled: boolean }[] = [];
  const seen = new Set<string>();

  for (const item of domains) {
    if (!item || typeof item !== "object" || typeof item.domain !== "string" ||
      (item.enabled !== undefined && typeof item.enabled !== "boolean")) {
      return validationFailure("One or more blocked site entries are invalid.");
    }

    const normalized = normalizeDomain(item.domain);
    if (!normalized) {
      return validationFailure("One or more website domains are invalid.");
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      validSites.push({ domain: normalized, enabled: item.enabled !== false });
    }
  }

  if (validSites.length === 0) {
    return validationFailure("Blocked sites must contain between 1 and 50 entries.");
  }

  try {
    const { data, error: rpcError } = await authenticatedClient.rpc(
      "replace_user_blocked_sites",
      { p_sites: validSites },
    );
    const rpcData: unknown = data;

    if (rpcError) {
      const msg = rpcError.message || "";
      if (
        msg.includes("must contain between 1 and 50") ||
        msg.includes("must be a JSON array") ||
        msg.includes("entries are invalid") ||
        msg.includes("domains are invalid")
      ) {
        return validationFailure(
          msg.includes("must contain between 1 and 50")
            ? "Blocked sites must contain between 1 and 50 entries."
            : msg.includes("domains are invalid")
              ? "One or more website domains are invalid."
              : "One or more blocked site entries are invalid.",
        );
      }
      if (rpcError.code === "PGRST202" || rpcError.code === "42883") {
        const configuredUrl = getSupabasePublicConfig()?.url;
        const configuredProjectHost = configuredUrl ? new URL(configuredUrl).hostname : null;
        const normalizedMessage = msg.toLowerCase();
        const messageKind = normalizedMessage.includes("schema cache")
          ? "schema_cache_lookup"
          : normalizedMessage.includes("could not find the function")
            ? "function_not_found"
            : rpcError.code === "42883"
              ? "postgres_undefined_function"
              : "unclassified";
        console.error(
          `Blocked-site RPC resolution failure: rpc=replace_user_blocked_sites code=${rpcError.code} project=${configuredProjectHost ?? "unknown"} messageKind=${messageKind}`,
        );
        return {
          success: false,
          sites: [],
          error: "Database migration required: replace_user_blocked_sites RPC is not installed.",
          code: "MIGRATION_REQUIRED",
        };
      }

      return {
        success: false,
        sites: [],
        error: "Failed to update blocked sites.",
        code: "DB_ERROR",
      };
    }

    if (!isReplaceBlockedSitesResponse(rpcData)) {
      return {
        success: false,
        sites: [],
        error: "Failed to update blocked sites.",
        code: "DB_ERROR",
      };
    }

    return {
      success: true,
      sites: rpcData.sites,
    };
  } catch {
    return {
      success: false,
      sites: [],
      error: "Failed to update blocked sites.",
      code: "DB_ERROR",
    };
  }
}
