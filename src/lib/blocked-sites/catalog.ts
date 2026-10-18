export const DEFAULT_BLOCKED_DOMAINS = [
  "youtube.com",
  "instagram.com",
  "reddit.com",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "netflix.com",
  "twitch.tv",
] as const;

export type DefaultBlockedDomain = (typeof DEFAULT_BLOCKED_DOMAINS)[number];

const BLOCKED_SITE_NAMES: Record<string, string> = {
  "youtube.com": "YouTube",
  "instagram.com": "Instagram",
  "reddit.com": "Reddit",
  "facebook.com": "Facebook",
  "x.com": "X",
  "twitter.com": "Twitter",
  "tiktok.com": "TikTok",
  "netflix.com": "Netflix",
  "twitch.tv": "Twitch",
};

export interface BlockedSiteCatalogEntry {
  domain: string;
  name: string;
}

function catalogFromDefaults(): BlockedSiteCatalogEntry[] {
  const entries: BlockedSiteCatalogEntry[] = DEFAULT_BLOCKED_DOMAINS.map((domain) => ({
    domain,
    name: BLOCKED_SITE_NAMES[domain] ?? domain,
  }));

  if (!DEFAULT_BLOCKED_DOMAINS.includes("facebook.com" as DefaultBlockedDomain)) {
    const redditIndex = entries.findIndex((entry) => entry.domain === "reddit.com");
    const facebook: BlockedSiteCatalogEntry = {
      domain: "facebook.com",
      name: BLOCKED_SITE_NAMES["facebook.com"] ?? "Facebook",
    };
    if (redditIndex >= 0) {
      entries.splice(redditIndex + 1, 0, facebook);
    } else {
      entries.push(facebook);
    }
  }

  return entries;
}

export const BLOCKED_SITE_CATALOG: BlockedSiteCatalogEntry[] = catalogFromDefaults();

export const SETTINGS_BLOCKED_DOMAINS = BLOCKED_SITE_CATALOG.map((site) => site.domain);
