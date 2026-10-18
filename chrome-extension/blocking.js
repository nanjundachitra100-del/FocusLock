export const DEFAULT_BLOCKED_DOMAINS = [
  "youtube.com",
  "instagram.com",
  "reddit.com",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "netflix.com",
  "twitch.tv",
];

export const BLOCK_RULE_ID_START = 1000;
export const ALLOW_RULE_ID_START = 2000;
export const MAX_BLOCKED_SITES = 50;
export const SESSION_REVOKE_MARGIN_MS = 60_000;
export const BLOCKED_PAGE_PATH = "/blocked.html";

const HOST_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeHostname(input) {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!value || value.length > 2048 || /[\s\\]/.test(value)) return null;

  let hostname;
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
    let url;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    hostname = url.hostname;
  } else {
    if (/[\/@?#]/.test(value)) return null;
    hostname = value;
  }

  hostname = hostname.toLowerCase().replace(/\.$/, "");
  if (hostname.startsWith("www.")) hostname = hostname.slice(4);
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) ||
    !HOST_PATTERN.test(hostname) ||
    hostname.split(".").some((label) => label.length > 63)
  ) {
    return null;
  }
  return hostname;
}

function isValidSite(site) {
  if (!site || typeof site !== "object" || Array.isArray(site)) return false;
  return typeof site.domain === "string" &&
    typeof site.enabled === "boolean" &&
    normalizeHostname(site.domain) === site.domain.toLowerCase();
}

export function validateBlockedSites(sites) {
  if (!Array.isArray(sites) || sites.length === 0 || sites.length > MAX_BLOCKED_SITES) {
    return null;
  }

  const normalized = [];
  for (const site of sites) {
    if (!site || typeof site !== "object" || Array.isArray(site) ||
      typeof site.domain !== "string" || typeof site.enabled !== "boolean") {
      return null;
    }
    const domain = normalizeHostname(site.domain);
    if (!domain) return null;
    const existing = normalized.find((entry) => entry.domain === domain);
    if (existing) {
      if (existing.enabled !== site.enabled) return null;
      continue;
    }
    normalized.push({ domain, enabled: site.enabled });
  }
  return normalized;
}

export function validateExcludedHosts(hosts) {
  if (!Array.isArray(hosts)) return null;

  const normalized = hosts.map((host) => {
    if (typeof host !== "string") return null;
    const value = host.trim().toLowerCase().replace(/\.$/, "");
    if (value === "localhost" || value === "127.0.0.1") return value;
    return normalizeHostname(host);
  });
  return normalized.some((host) => !host) ? null : normalized;
}

export function getHostPermissionOrigins(sites, excludedHosts = []) {
  const validSites = validateBlockedSites(sites);
  if (!validSites) return null;
  const exclusions = validateExcludedHosts(excludedHosts);
  if (!exclusions) return null;

  return [...new Set(
    validSites
      .filter((site) =>
        site.enabled &&
        !exclusions.some((host) =>
          site.domain === host || site.domain.endsWith(`.${host}`),
        ),
      )
      .map((site) => `*://*.${site.domain}/*`),
  )].sort();
}

export async function getPermissionScopedSites(sites, excludedHosts, containsPermission) {
  const origins = getHostPermissionOrigins(sites, excludedHosts);
  if (!origins || typeof containsPermission !== "function") return null;

  const results = await Promise.all(origins.map(async (origin) => {
    try {
      return { origin, granted: await containsPermission(origin) };
    } catch {
      return { origin, granted: false };
    }
  }));
  const grantedOrigins = new Set(
    results.filter((result) => result.granted).map((result) => result.origin),
  );
  const allowedSites = sites.filter((site) => {
    if (!site.enabled) return true;
    const origin = `*://*.${site.domain}/*`;
    if (excludedHosts.some((host) =>
      site.domain === host || site.domain.endsWith(`.${host}`),
    )) {
      return false;
    }
    return grantedOrigins.has(origin);
  });

  return {
    sites: allowedSites,
    missingOrigins: results.filter((result) => !result.granted).map((result) => result.origin),
  };
}

export function matchesBlockedSite(url, sites, { includeSubdomains = true, excludedHosts = [] } = {}) {
  if (typeof url !== "string") return false;

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return false;
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") return false;

  const hostname = normalizeHostname(parsedUrl.hostname);
  if (!hostname) return false;

  const exclusions = validateExcludedHosts(excludedHosts) ?? [];
  if (exclusions.some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
    return false;
  }

  const validSites = validateBlockedSites(sites);
  if (!validSites) return false;

  return validSites.some(({ domain, enabled }) =>
    enabled && (hostname === domain || (includeSubdomains && hostname.endsWith(`.${domain}`))),
  );
}

export function isSessionAuthorized(session, now = Date.now()) {
  if (!session || typeof session !== "object" || Array.isArray(session)) return false;
  if (
    typeof session.id !== "string" ||
    !session.id ||
    !Number.isFinite(session.minutes) ||
    session.minutes <= 0 ||
    typeof session.expiresAt !== "string"
  ) {
    return false;
  }

  const startedAt = Date.parse(session.startedAt);
  const expiresAt = Date.parse(session.expiresAt);
  const authorizedDurationMs = session.minutes * 60_000;
  return Number.isFinite(startedAt) &&
    Number.isFinite(expiresAt) &&
    startedAt <= now &&
    expiresAt > startedAt &&
    expiresAt - startedAt <= authorizedDurationMs + 5_000 &&
    expiresAt > now + SESSION_REVOKE_MARGIN_MS;
}

export function isConfirmedSessionStart(result, status, now = Date.now()) {
  const session = status?.status?.activeSession;
  return result?.state === "SESSION_STARTED" &&
    status?.state === "AUTHENTICATED" &&
    typeof result.session?.id === "string" &&
    session?.id === result.session.id &&
    Date.parse(session.expiresAt) > now &&
    isSessionAuthorized(session, now);
}

export function isReconciliationCurrent(expectedGeneration, currentGeneration) {
  return Number.isSafeInteger(expectedGeneration) &&
    Number.isSafeInteger(currentGeneration) &&
    expectedGeneration === currentGeneration;
}

export function getBlockedTabQueryPatterns(domains) {
  if (!Array.isArray(domains)) return [];
  return [...new Set(domains.flatMap((domain) => {
    const normalized = normalizeHostname(domain);
    return normalized ? [`*://${normalized}/*`, `*://*.${normalized}/*`] : [];
  }))];
}

function isExcludedDomain(domain, excludedHosts) {
  return excludedHosts.some((host) => domain === host || domain.endsWith(`.${host}`));
}

function isWebsiteRule(rule) {
  if (!rule || !["allow", "redirect"].includes(rule.action?.type)) return false;
  if ((Array.isArray(rule.condition?.resourceTypes) &&
    !rule.condition.resourceTypes.includes("main_frame")) ||
    typeof rule.condition?.urlFilter !== "string") {
    return false;
  }
  const match = /^\|\|([a-z0-9.-]+)\^$/i.exec(rule.condition.urlFilter);
  return Boolean(match && normalizeHostname(match[1]));
}

function reportRuleValidationFailure(reason, sites, excludedHosts, blockedPagePath) {
  console.error("FocusLock blocking rule validation failed.", {
    stage: "build_blocking_rules",
    reason,
    siteInputType: Array.isArray(sites) ? "array" : typeof sites,
    siteCount: Array.isArray(sites) ? sites.length : null,
    excludedHostsInputType: Array.isArray(excludedHosts) ? "array" : typeof excludedHosts,
    excludedHostCount: Array.isArray(excludedHosts) ? excludedHosts.length : null,
    blockedPagePathType: typeof blockedPagePath,
  });
}

export function buildBlockingRules({
  sites,
  session = null,
  now = Date.now(),
  excludedHosts = [],
  blockedPagePath = BLOCKED_PAGE_PATH,
}) {
  // Permission filtering can legitimately leave no sites the user has granted.
  // Keep strict empty-list validation elsewhere, but allow an empty rule plan.
  const validSites =
    Array.isArray(sites) && sites.length === 0 ? [] : validateBlockedSites(sites);
  if (!validSites) {
    reportRuleValidationFailure("blocked_sites_invalid_or_empty", sites, excludedHosts, blockedPagePath);
    return null;
  }
  if (typeof blockedPagePath !== "string" || !/^\/[a-zA-Z0-9._/-]+$/.test(blockedPagePath)) {
    reportRuleValidationFailure("blocked_page_path_invalid", sites, excludedHosts, blockedPagePath);
    return null;
  }

  const normalizedExclusions = validateExcludedHosts(excludedHosts);
  if (!normalizedExclusions) {
    reportRuleValidationFailure("excluded_hosts_invalid", sites, excludedHosts, blockedPagePath);
    return null;
  }
  const domains = [...new Set(
    validSites
      .filter((site) => site.enabled)
      .map((site) => site.domain)
      .filter((domain) => !isExcludedDomain(domain, normalizedExclusions)),
  )].sort();

  const allowSites = isSessionAuthorized(session, now);
  const blockRules = domains.map((domain, index) => ({
    id: BLOCK_RULE_ID_START + index,
    priority: 1,
    action: {
      type: "redirect",
      redirect: { extensionPath: blockedPagePath },
    },
    condition: {
      urlFilter: `||${domain}^`,
      resourceTypes: ["main_frame"],
      ...(normalizedExclusions.length > 0
        ? { excludedRequestDomains: normalizedExclusions }
        : {}),
    },
  }));

  const allowRules = allowSites
    ? domains.map((domain, index) => ({
        id: ALLOW_RULE_ID_START + index,
        priority: 2,
        action: { type: "allow" },
        condition: {
          urlFilter: `||${domain}^`,
          resourceTypes: ["main_frame"],
          ...(normalizedExclusions.length > 0
            ? { excludedRequestDomains: normalizedExclusions }
            : {}),
        },
      }))
    : [];

  return { blockRules, allowRules, domains, authorizedUntil: allowSites ? Date.parse(session.expiresAt) : null };
}

export async function reconcileDynamicRules(
  declarativeNetRequest,
  plan,
  { failClosed = false } = {},
) {
  const [currentDynamic, currentSession] = await Promise.all([
    declarativeNetRequest.getDynamicRules(),
    declarativeNetRequest.getSessionRules(),
  ]);
  const managedDynamicIds = currentDynamic
    .filter((rule) => {
      const managedId =
        (rule.id >= BLOCK_RULE_ID_START && rule.id < BLOCK_RULE_ID_START + MAX_BLOCKED_SITES) ||
        (rule.id >= ALLOW_RULE_ID_START && rule.id < ALLOW_RULE_ID_START + MAX_BLOCKED_SITES);
      // Prior versions may have stored website redirects or temporary allows under
      // different IDs. Replace those top-level site rules as one blocking policy.
      return managedId || isWebsiteRule(rule);
    })
    .map((rule) => rule.id);
  const managedSessionIds = currentSession
    .filter((rule) =>
      (rule.id >= ALLOW_RULE_ID_START && rule.id < ALLOW_RULE_ID_START + MAX_BLOCKED_SITES) ||
      isWebsiteRule(rule),
    )
    .map((rule) => rule.id);

  if (failClosed) {
    await declarativeNetRequest.updateSessionRules({
      removeRuleIds: [...new Set(managedSessionIds)],
      addRules: [],
    });
    await declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [...new Set(managedDynamicIds)],
      addRules: plan.blockRules,
    });
    return plan.blockRules;
  }

  await declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [...new Set(managedDynamicIds)],
    addRules: plan.blockRules,
  });
  await declarativeNetRequest.updateSessionRules({
    removeRuleIds: [...new Set(managedSessionIds)],
    addRules: plan.allowRules,
  });

  return [...plan.blockRules, ...plan.allowRules];
}

export async function removeAllowRules(declarativeNetRequest) {
  const ids = Array.from(
    { length: MAX_BLOCKED_SITES },
    (_value, index) => ALLOW_RULE_ID_START + index,
  );
  const [dynamicRules, sessionRules] = await Promise.all([
    declarativeNetRequest.getDynamicRules(),
    declarativeNetRequest.getSessionRules(),
  ]);
  const dynamicIds = [
    ...ids,
    ...dynamicRules.filter((rule) => rule.action?.type === "allow" && isWebsiteRule(rule))
      .map((rule) => rule.id),
  ];
  const sessionIds = [
    ...ids,
    ...sessionRules.filter((rule) => rule.action?.type === "allow" && isWebsiteRule(rule))
      .map((rule) => rule.id),
  ];
  await Promise.all([
    declarativeNetRequest.updateSessionRules({ removeRuleIds: [...new Set(sessionIds)], addRules: [] }),
    declarativeNetRequest.updateDynamicRules({ removeRuleIds: [...new Set(dynamicIds)], addRules: [] }),
  ]);
}

/** Remove temporary access before starting a potentially queued/network-backed status refresh. */
export async function revokeAccessBeforeRevalidation(declarativeNetRequest, revalidate) {
  try {
    await removeAllowRules(declarativeNetRequest);
  } catch (error) {
    // A transient DNR failure should not prevent a second immediate revocation attempt.
    try {
      await removeAllowRules(declarativeNetRequest);
    } catch {
      throw error;
    }
  }
  try {
    return await revalidate();
  } catch (error) {
    // Keep expiry/revocation fail-closed even when status revalidation fails.
    await removeAllowRules(declarativeNetRequest).catch(() => undefined);
    throw error;
  }
}
