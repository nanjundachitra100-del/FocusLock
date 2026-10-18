import type { AuraSyncCategory, AuraSyncItem, FeedResponse } from "./types";
import { CONFIGURED_FEED_SOURCES, type FeedSourceConfig } from "./rss-sources";
import { fetchFeedWithTimeout } from "./rss-parser";

interface ServerCache {
  items: AuraSyncItem[];
  lastUpdated: string;
  sourceStatuses: Array<{
    name: string;
    count: number;
    status: "ok" | "failed" | "cached";
  }>;
}

let memoryCache: ServerCache | null = null;
let lastCacheTime = 0;
const CACHE_TTL_MS = 8 * 60 * 1000; // 8 minutes

// In-flight request deduplication
let inFlightFetch: Promise<FeedResponse> | null = null;

// High-quality offline fallback data (used if network is disconnected or feeds are blocked)
export const FALLBACK_AURASYNC_ITEMS: AuraSyncItem[] = [
  {
    id: "aura-fallback-01",
    title: "DeepSeek-V3 Architecture: Multi-Head Latent Attention and Dual-Pipe Inference",
    url: "https://arxiv.org/abs/2412.19437",
    source: "ArXiv AI Research",
    sourceUrl: "https://arxiv.org",
    category: "AI & Machine Learning",
    publishedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    summary:
      "DeepSeek-V3 introduces Multi-Head Latent Attention (MLA) and DeepSeekMoE to achieve state-of-the-art reasoning at a fraction of traditional GPU training and inference cost.",
    thumbnailUrl: null,
    readingTimeMinutes: 4,
    relevanceNote: "Key development in AI architecture and model capability.",
    freshnessStatus: "fresh",
    label: "TRENDING",
    score: 98,
  },
  {
    id: "aura-fallback-02",
    title: "TypeScript 5.8 Release Candidate: Granular Return Checks and Node.js Require Flags",
    url: "https://devblogs.microsoft.com/typescript/",
    source: "Dev.to",
    sourceUrl: "https://dev.to",
    category: "Programming",
    publishedAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
    summary:
      "The TypeScript team unveils compiler optimizations, granular return type narrowing, and support for require() of ECMAScript modules in modern Node.js environments.",
    thumbnailUrl: null,
    readingTimeMinutes: 3,
    relevanceNote: "Directly relevant for modern software development and engineering.",
    freshnessStatus: "fresh",
    label: "LATEST",
    score: 92,
  },
  {
    id: "aura-fallback-03",
    title: "Quantum Error Correction Reaches Below Physical Fault-Tolerance Threshold",
    url: "https://www.nature.com",
    source: "Wired Science",
    sourceUrl: "https://www.wired.com",
    category: "Science",
    publishedAt: new Date(Date.now() - 14 * 3600 * 1000).toISOString(),
    summary:
      "Physicists demonstrate surface-code logical qubits with lower error rates than the underlying physical gates, surpassing a historic milestone for fault-tolerant quantum computing.",
    thumbnailUrl: null,
    readingTimeMinutes: 5,
    relevanceNote: "Scientific breakthrough expanding fundamental understanding.",
    freshnessStatus: "recent",
    label: "RECOMMENDED",
    score: 88,
  },
  {
    id: "aura-fallback-04",
    title: "SQLite 3.48 Adds Better Query Planner Directives and Memory Optimizations",
    url: "https://sqlite.org",
    source: "Hacker News",
    sourceUrl: "https://news.ycombinator.com",
    category: "Programming",
    publishedAt: new Date(Date.now() - 20 * 3600 * 1000).toISOString(),
    summary:
      "The latest release of SQLite enhances query planner bloom filters, reduces memory overhead on embedded instances, and improves concurrent WAL mode reads.",
    thumbnailUrl: null,
    readingTimeMinutes: 2,
    relevanceNote: "Directly relevant for modern software development and engineering.",
    freshnessStatus: "recent",
    label: "POPULAR",
    score: 84,
  },
  {
    id: "aura-fallback-05",
    title: "Next-Gen 2nm Transistors Enter Pilot Risk Production in Semiconductor Fabs",
    url: "https://www.theverge.com",
    source: "The Verge",
    sourceUrl: "https://www.theverge.com",
    category: "Technology",
    publishedAt: new Date(Date.now() - 28 * 3600 * 1000).toISOString(),
    summary:
      "Gate-All-Around (GAA) nanosheet transistors enter high-volume fabrication testing, promising 15% faster speeds and up to 30% lower power consumption for next-generation silicon.",
    thumbnailUrl: null,
    readingTimeMinutes: 3,
    relevanceNote: "Notable shift in technology landscape.",
    freshnessStatus: "recent",
    label: "POPULAR",
    score: 79,
  },
  {
    id: "aura-fallback-06",
    title: "Algorithmic Attention Fatigue: The Shift Toward Intentional Focus in 2026",
    url: "https://techcrunch.com",
    source: "TechCrunch",
    sourceUrl: "https://techcrunch.com",
    category: "Social Media Trends",
    publishedAt: new Date(Date.now() - 36 * 3600 * 1000).toISOString(),
    summary:
      "New consumer behavioral studies reveal a significant rise in digital detox adoption and demand for focus-enhancing tools that replace endless algorithmic feeds with curated deep-work sprints.",
    thumbnailUrl: null,
    readingTimeMinutes: 4,
    relevanceNote: "Emerging pattern in digital communication and attention culture.",
    freshnessStatus: "recent",
    label: "RECOMMENDED",
    score: 86,
  },
];

function normalizeTitleForDeduplication(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function deduplicateAndRankItems(
  items: AuraSyncItem[],
  preferredCategories?: AuraSyncCategory[],
  searchQuery?: string
): AuraSyncItem[] {
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const uniqueItems: AuraSyncItem[] = [];

  for (const item of items) {
    // Normalise URL by stripping query-string for dedup purposes
    const cleanUrl = item.url.split("?")[0].toLowerCase().replace(/\/$/, "");
    const cleanTitle = normalizeTitleForDeduplication(item.title);

    // Skip if already seen by id, URL, or near-identical title
    if (seenIds.has(item.id) || seenUrls.has(cleanUrl) || seenTitles.has(cleanTitle)) {
      continue;
    }

    seenIds.add(item.id);
    seenUrls.add(cleanUrl);
    seenTitles.add(cleanTitle);

    // Apply personalization boost if matches user preferences
    let personalizedScore = item.score;
    if (preferredCategories && preferredCategories.length > 0) {
      if (preferredCategories.includes(item.category)) {
        personalizedScore += 18;
      }
    }

    // Apply search filter if query provided
    if (searchQuery && searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const inTitle = item.title.toLowerCase().includes(q);
      const inSummary = item.summary.toLowerCase().includes(q);
      const inCategory = item.category.toLowerCase().includes(q);
      if (!inTitle && !inSummary && !inCategory) {
        continue;
      }
      if (inTitle) personalizedScore += 30;
    }

    uniqueItems.push({
      ...item,
      score: personalizedScore,
    });
  }

  // Sort by score descending, then by publication date descending
  return uniqueItems.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });
}

export async function getAuraSyncFeed(
  forceRefresh: boolean = false,
  preferredCategories?: AuraSyncCategory[],
  searchQuery?: string
): Promise<FeedResponse> {
  const now = Date.now();
  const isCacheValid = memoryCache && now - lastCacheTime < CACHE_TTL_MS;

  // 1. If cache is fresh and not forcing refresh, return immediately
  if (isCacheValid && !forceRefresh && memoryCache) {
    const ranked = deduplicateAndRankItems(memoryCache.items, preferredCategories, searchQuery);
    return {
      items: ranked,
      lastUpdated: memoryCache.lastUpdated,
      isCached: true,
      totalCount: ranked.length,
      sources: memoryCache.sourceStatuses,
    };
  }

  // 2. If an in-flight fetch is already happening, await it
  if (inFlightFetch) {
    const res = await inFlightFetch;
    return {
      ...res,
      items: deduplicateAndRankItems(res.items, preferredCategories, searchQuery),
    };
  }

  // 3. Launch live fetch across configured RSS sources
  inFlightFetch = (async (): Promise<FeedResponse> => {
    const enabledSources = CONFIGURED_FEED_SOURCES.filter((s) => s.enabled);
    const sourceStatuses: Array<{
      name: string;
      count: number;
      status: "ok" | "failed" | "cached";
    }> = [];

    const fetchPromises = enabledSources.map(async (source) => {
      try {
        const items = await fetchFeedWithTimeout(source, 5500);
        sourceStatuses.push({
          name: source.name,
          count: items.length,
          status: "ok",
        });
        return items;
      } catch (error) {
        console.warn(`[AuraSync] Failed to fetch feed from ${source.name}:`, (error as Error).message);
        sourceStatuses.push({
          name: source.name,
          count: 0,
          status: "failed",
        });
        return [];
      }
    });

    const results = await Promise.allSettled(fetchPromises);
    const collectedItems: AuraSyncItem[] = [];

    for (const result of results) {
      if (result.status === "fulfilled") {
        collectedItems.push(...result.value);
      }
    }

    // If zero items could be fetched from network, merge fallback items
    if (collectedItems.length === 0) {
      collectedItems.push(...FALLBACK_AURASYNC_ITEMS);
      sourceStatuses.push({
        name: "AuraSync Offline Cache",
        count: FALLBACK_AURASYNC_ITEMS.length,
        status: "cached",
      });
    }

    const deduplicated = deduplicateAndRankItems(collectedItems);
    const lastUpdated = new Date().toISOString();

    // Update memory cache
    memoryCache = {
      items: deduplicated,
      lastUpdated,
      sourceStatuses,
    };
    lastCacheTime = Date.now();

    return {
      items: deduplicated,
      lastUpdated,
      isCached: false,
      totalCount: deduplicated.length,
      sources: sourceStatuses,
    };
  })();

  try {
    const response = await inFlightFetch;
    const ranked = deduplicateAndRankItems(response.items, preferredCategories, searchQuery);
    return {
      ...response,
      items: ranked,
      totalCount: ranked.length,
    };
  } finally {
    inFlightFetch = null;
  }
}
