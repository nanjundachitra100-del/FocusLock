export type AuraSyncCategory =
  | "All"
  | "AI & Machine Learning"
  | "Technology"
  | "Programming"
  | "Science"
  | "Important News"
  | "Social Media Trends";

export type ContentFreshness = "fresh" | "recent" | "archived";

export type TrendLabel = "TRENDING" | "LATEST" | "POPULAR" | "RECOMMENDED";

export interface AuraSyncItem {
  id: string;
  title: string;
  url: string;
  source: string;
  sourceUrl?: string;
  category: AuraSyncCategory;
  publishedAt: string; // ISO date string
  summary: string;
  thumbnailUrl?: string | null;
  readingTimeMinutes: number;
  relevanceNote: string;
  freshnessStatus: ContentFreshness;
  label: TrendLabel;
  score: number;
  author?: string;
  tags?: string[];
}

export interface TopicExplanation {
  summary: string;
  keyFacts: string[];
  whyItMatters: string;
  context: string;
  relatedTopics: string[];
  avatarAnnouncement: string;
  estimatedReadingTime: string;
}

export interface SavedTopic {
  id: string;
  title: string;
  url: string;
  source: string;
  category: AuraSyncCategory;
  summary: string;
  savedAt: string; // ISO date string
  isRead: boolean;
  notes?: string;
}

export interface UserInterests {
  categories: AuraSyncCategory[];
  keywords: string[];
  timerBudgetMinutes: number; // default: 5
  remindersEnabled: boolean; // default: true
  avatarNarrationEnabled: boolean; // default: false
}

export interface FeedResponse {
  items: AuraSyncItem[];
  lastUpdated: string;
  isCached: boolean;
  totalCount: number;
  sources: Array<{
    name: string;
    count: number;
    status: "ok" | "failed" | "cached";
  }>;
}
