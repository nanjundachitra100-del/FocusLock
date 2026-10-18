import {
  BLOCKED_SITE_CATALOG,
  DEFAULT_BLOCKED_DOMAINS,
  SETTINGS_BLOCKED_DOMAINS,
} from "./catalog";
import { MAX_BLOCKED_SITES, normalizeBlockedWebsiteDomain } from "./domain";
import type { ExtensionConnectionState } from "@/lib/extension/status-bridge";

export type BlockedSiteRecord = {
  domain: string;
  enabled: boolean;
};

export const EMPTY_SELECTION_ERROR = "Select at least one website to block.";
export const INVALID_CUSTOM_WEBSITE_ERROR = "Enter a valid website domain or HTTP(S) URL.";
export const DUPLICATE_CUSTOM_WEBSITE_ERROR = "That website is already in your list.";
export const MAX_CUSTOM_WEBSITES_ERROR = `You can save up to ${MAX_BLOCKED_SITES} websites.`;

export function normalizeCustomWebsiteInput(input: string):
  | { success: true; domain: string }
  | { success: false; error: string } {
  const domain = normalizeBlockedWebsiteDomain(input);
  return domain
    ? { success: true, domain }
    : { success: false, error: INVALID_CUSTOM_WEBSITE_ERROR };
}

export function addCustomWebsite(
  input: string,
  selectedDomains: string[],
  extraSites: BlockedSiteRecord[],
):
  | { success: true; domain: string; kind: "catalog" | "custom"; extraSites: BlockedSiteRecord[] }
  | { success: false; error: string } {
  const normalized = normalizeCustomWebsiteInput(input);
  if (!normalized.success) return normalized;

  const { domain } = normalized;
  if (SETTINGS_BLOCKED_DOMAINS.includes(domain)) {
    if (selectedDomains.includes(domain)) {
      return { success: false, error: DUPLICATE_CUSTOM_WEBSITE_ERROR };
    }
    return { success: true, domain, kind: "catalog", extraSites };
  }

  const existing = extraSites.find((site) => site.domain === domain);
  if (existing?.enabled) {
    return { success: false, error: DUPLICATE_CUSTOM_WEBSITE_ERROR };
  }
  if (existing) {
    return {
      success: true,
      domain,
      kind: "custom",
      extraSites: extraSites.map((site) => site.domain === domain ? { ...site, enabled: true } : site),
    };
  }

  if (buildSavePayload(selectedDomains, extraSites).length >= MAX_BLOCKED_SITES) {
    return { success: false, error: MAX_CUSTOM_WEBSITES_ERROR };
  }

  return {
    success: true,
    domain,
    kind: "custom",
    extraSites: [...extraSites, { domain, enabled: true }],
  };
}

export function toggleCustomWebsite(extraSites: BlockedSiteRecord[], domain: string): BlockedSiteRecord[] {
  return extraSites.map((site) => site.domain === domain ? { ...site, enabled: !site.enabled } : site);
}

export function removeCustomWebsite(extraSites: BlockedSiteRecord[], domain: string): BlockedSiteRecord[] {
  return extraSites.filter((site) => site.domain !== domain);
}

export function parseBlockedSitesResponse(body: unknown):
  | { success: true; sites: BlockedSiteRecord[] }
  | { success: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { success: false, error: "Blocked websites could not be loaded." };
  }

  const sites = (body as Record<string, unknown>).sites;
  if (!Array.isArray(sites)) {
    return { success: false, error: "Blocked websites could not be loaded." };
  }

  const parsed: BlockedSiteRecord[] = [];
  for (const item of sites) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { success: false, error: "Blocked websites could not be loaded." };
    }
    const site = item as Record<string, unknown>;
    if (typeof site.domain !== "string" || typeof site.enabled !== "boolean") {
      return { success: false, error: "Blocked websites could not be loaded." };
    }
    parsed.push({ domain: site.domain, enabled: site.enabled });
  }

  return { success: true, sites: parsed };
}

export function catalogSelectionFromSavedSites(
  sites: BlockedSiteRecord[],
  catalogDomains: readonly string[] = SETTINGS_BLOCKED_DOMAINS,
): string[] {
  const enabled = new Set(
    sites.filter((site) => site.enabled).map((site) => site.domain),
  );
  return catalogDomains.filter((domain) => enabled.has(domain));
}

export function extraSitesFromSavedSites(
  sites: BlockedSiteRecord[],
  catalogDomains: readonly string[] = SETTINGS_BLOCKED_DOMAINS,
): BlockedSiteRecord[] {
  const catalog = new Set(catalogDomains);
  return sites.filter((site) => !catalog.has(site.domain));
}

export function selectionsFromSavedSites(sites: BlockedSiteRecord[]): {
  selected: string[];
  extraSites: BlockedSiteRecord[];
} {
  return {
    selected: catalogSelectionFromSavedSites(sites),
    extraSites: extraSitesFromSavedSites(sites),
  };
}

export function toggleDomain(selected: string[], domain: string): string[] {
  if (selected.includes(domain)) {
    return selected.filter((item) => item !== domain);
  }
  return [...selected, domain];
}

export function validateSelection(selected: string[], extraSites: BlockedSiteRecord[] = []):
  | { valid: true }
  | { valid: false; error: string } {
  if (selected.length === 0 && !extraSites.some((site) => site.enabled)) {
    return { valid: false, error: EMPTY_SELECTION_ERROR };
  }
  return { valid: true };
}

export function buildSavePayload(
  selectedDomains: string[],
  extraSites: BlockedSiteRecord[] = [],
  catalogDomains: readonly string[] = SETTINGS_BLOCKED_DOMAINS,
): BlockedSiteRecord[] {
  const sites: BlockedSiteRecord[] = [];
  const seen = new Set<string>();

  for (const domain of catalogDomains) {
    if (!selectedDomains.includes(domain) || seen.has(domain)) continue;
    seen.add(domain);
    sites.push({ domain, enabled: true });
  }

  for (const domain of selectedDomains) {
    if (seen.has(domain)) continue;
    seen.add(domain);
    sites.push({ domain, enabled: true });
  }

  for (const site of extraSites) {
    if (seen.has(site.domain)) continue;
    seen.add(site.domain);
    sites.push({ domain: site.domain, enabled: site.enabled });
  }

  return sites;
}

export async function persistBlockedWebsiteSelection(options: {
  selectedDomains: string[];
  extraSites?: BlockedSiteRecord[];
  save: (
    sites: BlockedSiteRecord[],
  ) => Promise<{ success: true; sites: BlockedSiteRecord[] } | { success: false; error: string }>;
  refreshExtension?: () => void;
}): Promise<
  | { success: true; sites: BlockedSiteRecord[] }
  | { success: false; error: string; reason: "empty" | "api" }
> {
  const extraSites = options.extraSites ?? [];
  const validation = validateSelection(options.selectedDomains, extraSites);
  if (!validation.valid) {
    return { success: false, error: validation.error, reason: "empty" };
  }

  const sites = buildSavePayload(options.selectedDomains, extraSites);
  if (sites.length > MAX_BLOCKED_SITES) {
    return { success: false, error: MAX_CUSTOM_WEBSITES_ERROR, reason: "api" };
  }
  const result = await options.save(sites);
  if (!result.success) {
    return { success: false, error: result.error, reason: "api" };
  }

  options.refreshExtension?.();
  return { success: true, sites: result.sites };
}

export async function loadBlockedWebsiteSelections(options: {
  load: () => Promise<{ success: true; sites: BlockedSiteRecord[] } | { success: false; error: string }>;
}): Promise<
  | { success: true; selected: string[]; extraSites: BlockedSiteRecord[]; sites: BlockedSiteRecord[] }
  | { success: false; error: string }
> {
  const result = await options.load();
  if (!result.success) {
    return result;
  }

  const selections = selectionsFromSavedSites(result.sites);
  return {
    success: true,
    sites: result.sites,
    ...selections,
  };
}

export function hostPermissionGuidance(state: ExtensionConnectionState): string {
  const cannotGrant = "This dashboard cannot grant those Chrome host permissions itself.";

  switch (state) {
    case "authenticated":
      return `Saving updates your blocked list for FocusLock Guardian. Chrome may still require host permissions for each site. ${cannotGrant} After saving, open the extension popup and choose Enable website blocking if Chrome asks.`;
    case "auth_required":
      return `Your list is stored on your account, but the extension still needs you to sign in. ${cannotGrant} Open the FocusLock Guardian popup to sign in, then use Enable website blocking.`;
    case "unavailable":
      return `The extension connection is unavailable, so blocking may not apply yet. ${cannotGrant} Host access is granted only in Chrome, through FocusLock Guardian.`;
    case "checking":
      return `Chrome host permissions are granted in FocusLock Guardian, not in this Settings page. ${cannotGrant}`;
    case "not_detected":
    default:
      return `Install FocusLock Guardian to enforce this list. Blocking starts only after you grant host permissions in Chrome. ${cannotGrant}`;
  }
}

export { BLOCKED_SITE_CATALOG, DEFAULT_BLOCKED_DOMAINS, SETTINGS_BLOCKED_DOMAINS };
