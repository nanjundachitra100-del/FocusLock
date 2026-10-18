import type { AuraSyncCategory } from "./types";

export interface FeedSourceConfig {
  id: string;
  name: string;
  url: string;
  siteUrl: string;
  defaultCategory: AuraSyncCategory;
  reliabilityWeight: number; // 0.8 to 1.2
  enabled: boolean;
}

export const CONFIGURED_FEED_SOURCES: FeedSourceConfig[] = [
  {
    id: "hackernews",
    name: "Hacker News",
    url: "https://hnrss.org/frontpage?points=50",
    siteUrl: "https://news.ycombinator.com",
    defaultCategory: "Programming",
    reliabilityWeight: 1.15,
    enabled: true,
  },
  {
    id: "techcrunch",
    name: "TechCrunch",
    url: "https://techcrunch.com/feed/",
    siteUrl: "https://techcrunch.com",
    defaultCategory: "Technology",
    reliabilityWeight: 1.1,
    enabled: true,
  },
  {
    id: "arxiv-ai",
    name: "ArXiv AI Research",
    url: "https://rss.arxiv.org/rss/cs.AI",
    siteUrl: "https://arxiv.org/corr/cs.AI",
    defaultCategory: "AI & Machine Learning",
    reliabilityWeight: 1.2,
    enabled: true,
  },
  {
    id: "theverge",
    name: "The Verge",
    url: "https://www.theverge.com/rss/index.xml",
    siteUrl: "https://www.theverge.com",
    defaultCategory: "Technology",
    reliabilityWeight: 1.05,
    enabled: true,
  },
  {
    id: "devto",
    name: "Dev.to",
    url: "https://dev.to/feed",
    siteUrl: "https://dev.to",
    defaultCategory: "Programming",
    reliabilityWeight: 1.0,
    enabled: true,
  },
  {
    id: "wired-science",
    name: "Wired Science",
    url: "https://www.wired.com/feed/category/science/latest/rss",
    siteUrl: "https://www.wired.com/category/science/",
    defaultCategory: "Science",
    reliabilityWeight: 1.05,
    enabled: true,
  },
];
