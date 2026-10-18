import type { AuraSyncCategory, AuraSyncItem, ContentFreshness, TrendLabel } from "./types";
import type { FeedSourceConfig } from "./rss-sources";

function decodeHtmlEntities(text: string): string {
  if (!text) return "";
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function stripHtml(html: string): string {
  if (!html) return "";
  return decodeHtmlEntities(
    html
      .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
      .replace(/<style[^>]*>.*?<\/style>/gis, "")
      .replace(/<script[^>]*>.*?<\/script>/gis, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function extractFirstMatch(xml: string, tag: string): string | null {
  // Support both tag with attributes and CDATA
  const cdataRegex = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[(.*?)\\]\\]>\\s*<\\/${tag}>`, "is");
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch && cdataMatch[1]) return cdataMatch[1].trim();

  const standardRegex = new RegExp(`<${tag}[^>]*>(.*?)<\\/${tag}>`, "is");
  const match = xml.match(standardRegex);
  if (match && match[1]) return match[1].trim();

  return null;
}

function extractAttribute(xml: string, tag: string, attr: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*?\\s${attr}=["']([^"']+)["'][^>]*>`, "is");
  const match = xml.match(regex);
  return match && match[1] ? match[1].trim() : null;
}

function extractThumbnail(itemXml: string): string | null {
  // Try media:content url
  const mediaUrl = extractAttribute(itemXml, "media:content", "url");
  if (mediaUrl && /^https?:\/\//i.test(mediaUrl)) return decodeHtmlEntities(mediaUrl);

  // Try media:thumbnail url
  const thumbUrl = extractAttribute(itemXml, "media:thumbnail", "url");
  if (thumbUrl && /^https?:\/\//i.test(thumbUrl)) return decodeHtmlEntities(thumbUrl);

  // Try enclosure url if type is image
  const enclosureType = extractAttribute(itemXml, "enclosure", "type");
  const enclosureUrl = extractAttribute(itemXml, "enclosure", "url");
  if (enclosureUrl && enclosureType?.startsWith("image/")) return decodeHtmlEntities(enclosureUrl);

  // Try <img> src inside description, content, or summary (handles CDATA blocks too)
  // The URL may contain HTML entities (e.g. &#038; for &) — decode before returning
  const imgRegex = /<img[^>]+src=["'](https?:\/\/[^"']+)["']/i;
  const imgMatch = itemXml.match(imgRegex);
  if (imgMatch?.[1]) return decodeHtmlEntities(imgMatch[1]);

  return null;
}

function inferCategory(title: string, summary: string, fallback: AuraSyncCategory): AuraSyncCategory {
  const combined = `${title} ${summary}`.toLowerCase();

  if (
    /\b(llm|gpt|gemma|claude|gemini|deepseek|transformer|neural|ai model|machine learning|diffusion|openai|anthropic|mistral|generative ai|embedding|agentic)\b/i.test(
      combined
    )
  ) {
    return "AI & Machine Learning";
  }

  if (
    /\b(python|javascript|typescript|rust|golang|c\+\+|compiler|github|linux|kernel|git|react|nextjs|database|sql|docker|kubernetes|api|backend|frontend)\b/i.test(
      combined
    )
  ) {
    return "Programming";
  }

  if (
    /\b(quantum|physics|astronomy|telescope|nasa|biology|crispr|climate|neuroscience|dna|fusion|superconductor|solar|space)\b/i.test(
      combined
    )
  ) {
    return "Science";
  }

  if (
    /\b(social media|tiktok|instagram|x\.com|twitter|meta|threads|creator|algorithm|viral|feed|influencer)\b/i.test(
      combined
    )
  ) {
    return "Social Media Trends";
  }

  if (
    /\b(security|vulnerability|zero-day|cyber|breach|regulation|court|law|sec|antitrust|investigation|economy|fed)\b/i.test(
      combined
    )
  ) {
    return "Important News";
  }

  if (
    /\b(apple|google|microsoft|nvidia|intel|amd|hardware|chip|semiconductor|smartphone|gadget|vr|headset)\b/i.test(
      combined
    )
  ) {
    return "Technology";
  }

  return fallback;
}

function generateRelevanceNote(category: AuraSyncCategory, title: string): string {
  switch (category) {
    case "AI & Machine Learning":
      return "Key development in AI architecture and model capability.";
    case "Programming":
      return "Directly relevant for modern software development and engineering.";
    case "Science":
      return "Scientific breakthrough expanding fundamental understanding.";
    case "Social Media Trends":
      return "Emerging pattern in digital communication and attention culture.";
    case "Important News":
      return "High-impact tech industry or policy milestone.";
    default:
      return "Notable shift in technology landscape.";
  }
}

function calculateScore(
  publishedAt: Date,
  sourceReliability: number,
  title: string
): { score: number; freshness: ContentFreshness; label: TrendLabel } {
  const now = Date.now();
  const ageHours = Math.max(0, (now - publishedAt.getTime()) / (1000 * 60 * 60));

  let freshness: ContentFreshness = "archived";
  if (ageHours < 8) freshness = "fresh";
  else if (ageHours < 48) freshness = "recent";

  // Recency factor decays over 48 hours
  const recencyFactor = Math.max(0.1, 1 - ageHours / 72);

  // High interest keywords signal
  const highSignalKeywords = [
    "breakthrough",
    "release",
    "unveils",
    "open source",
    "critical",
    "launch",
    "announces",
    "new model",
    "deepseek",
    "gemma",
    "agent",
  ];
  const hasHighSignal = highSignalKeywords.some((kw) => title.toLowerCase().includes(kw));

  const baseScore = 60 + (hasHighSignal ? 20 : 0) + recencyFactor * 25;
  const finalScore = Math.round(baseScore * sourceReliability);

  let label: TrendLabel = "POPULAR";
  if (finalScore >= 95 && ageHours < 24) {
    label = "TRENDING";
  } else if (ageHours < 6) {
    label = "LATEST";
  } else if (finalScore >= 80) {
    label = "RECOMMENDED";
  }

  return { score: finalScore, freshness, label };
}

export function parseRssOrAtomXml(
  xmlText: string,
  source: FeedSourceConfig
): AuraSyncItem[] {
  const items: AuraSyncItem[] = [];

  // Determine if it's RSS (<item>) or Atom (<entry>)
  const isAtom = xmlText.includes("<entry") && !xmlText.includes("<item");
  const blockRegex = isAtom ? /<entry[^>]*>(.*?)<\/entry>/gis : /<item[^>]*>(.*?)<\/item>/gis;

  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(xmlText)) !== null) {
    const block = match[1];
    if (!block) continue;

    // 1. Title
    const rawTitle = extractFirstMatch(block, "title") || "Untitled Discovery";
    const title = stripHtml(rawTitle);
    if (!title || title.length < 5) continue;

    // 2. Link
    let url = "";
    if (isAtom) {
      url = extractAttribute(block, "link", "href") || extractFirstMatch(block, "link") || "";
    } else {
      url = extractFirstMatch(block, "link") || "";
    }
    url = url.trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      // In some feeds link is inside guid
      const guid = extractFirstMatch(block, "guid");
      if (guid && /^https?:\/\//i.test(guid)) url = guid.trim();
    }
    if (!url) continue;

    // 3. Description / Summary
    const rawDesc =
      extractFirstMatch(block, "description") ||
      extractFirstMatch(block, "content") ||
      extractFirstMatch(block, "summary") ||
      "";
    const cleanDesc = stripHtml(rawDesc);
    const summary = cleanDesc.slice(0, 320) + (cleanDesc.length > 320 ? "…" : "");

    // 4. Publication Date
    const rawDate =
      extractFirstMatch(block, "pubDate") ||
      extractFirstMatch(block, "published") ||
      extractFirstMatch(block, "updated") ||
      extractFirstMatch(block, "dc:date");

    let publishedAt = new Date();
    if (rawDate) {
      const parsed = new Date(rawDate);
      if (!isNaN(parsed.getTime())) {
        publishedAt = parsed;
      }
    }

    // 5. Category
    const category = inferCategory(title, summary, source.defaultCategory);

    // 6. Thumbnail
    const thumbnailUrl = extractThumbnail(block);

    // 7. Reading Time
    const wordCount = (summary ? summary.split(/\s+/).length : 50) + 150;
    const readingTimeMinutes = Math.max(1, Math.min(8, Math.round(wordCount / 200)));

    // 8. Relevance & Score
    const relevanceNote = generateRelevanceNote(category, title);
    const { score, freshness, label } = calculateScore(publishedAt, source.reliabilityWeight, title);

    // Deterministic ID: full URL encoded, not truncated — truncating caused collisions
    // when multiple articles share a long common URL prefix (e.g. all arxiv.org/abs/*)
    const id = "aura-" + Buffer.from(url).toString("base64url").slice(0, 48);

    items.push({
      id,
      title,
      url,
      source: source.name,
      sourceUrl: source.siteUrl,
      category,
      publishedAt: publishedAt.toISOString(),
      summary: summary || `${title}. Click to explore this topic with AI explanation.`,
      thumbnailUrl,
      readingTimeMinutes,
      relevanceNote,
      freshnessStatus: freshness,
      label,
      score,
    });

    if (items.length >= 15) break; // Limit per single feed to prevent bloat
  }

  return items;
}

export async function fetchFeedWithTimeout(
  source: FeedSourceConfig,
  timeoutMs: number = 6000
): Promise<AuraSyncItem[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "FocusLock-AuraSync/1.0 (Educational Focus Guardian; +https://focuslock.app)",
        Accept: "application/rss+xml, application/atom+xml, text/xml, application/xml, */*",
      },
      next: { revalidate: 600 }, // Next.js 10-minute cache hint
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${source.name}`);
    }

    const xml = await response.text();
    return parseRssOrAtomXml(xml, source);
  } finally {
    clearTimeout(timeoutId);
  }
}
