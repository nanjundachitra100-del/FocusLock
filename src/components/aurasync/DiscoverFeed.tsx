"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  Compass,
  RefreshCw,
  Search,
  Sliders,
  Bookmark,
  BookmarkCheck,
  ExternalLink,
  Sparkles,
  Flame,
  Clock,
  ThumbsUp,
  Star,
  EyeOff,
  AlertCircle,
  Radio,
  BookOpen,
} from "lucide-react";
import type {
  AuraSyncCategory,
  AuraSyncItem,
  FeedResponse,
  SavedTopic,
  UserInterests,
  TrendLabel,
} from "@/lib/aurasync/types";
import TopicExplorationDrawer from "./TopicExplorationDrawer";
import SavedReadingList from "./SavedReadingList";
import AuraSyncPreferencesModal from "./AuraSyncPreferencesModal";

// ─── Constants ───────────────────────────────────────────────────────────────

const CACHE_STORAGE_KEY = "focuslock.aurasync.cached_feed";
const SAVED_TOPICS_STORAGE_KEY = "focuslock.aurasync.saved_topics";
const USER_PREFS_STORAGE_KEY = "focuslock.aurasync.preferences";
const DISMISSED_IDS_STORAGE_KEY = "focuslock.aurasync.dismissed_ids";

const DEFAULT_PREFERENCES: UserInterests = {
  categories: [
    "AI & Machine Learning",
    "Technology",
    "Programming",
    "Science",
    "Important News",
    "Social Media Trends",
  ],
  keywords: [],
  timerBudgetMinutes: 5,
  remindersEnabled: true,
  avatarNarrationEnabled: false,
};

// Tab definitions — mapped to real AuraSyncCategory values or special keys
type TabKey = AuraSyncCategory | "Saved";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "All", label: "For You" },
  { key: "AI & Machine Learning", label: "AI & ML" },
  { key: "Technology", label: "Technology" },
  { key: "Programming", label: "Developer" },
  { key: "Science", label: "Science" },
  { key: "Important News", label: "News" },
  { key: "Social Media Trends", label: "Trends" },
  { key: "Saved", label: "Saved" },
];

// ─── Category colour map ─────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  "AI & Machine Learning": "bg-violet-500/15 text-violet-300 border-violet-500/20",
  Technology:              "bg-blue-500/15 text-blue-300 border-blue-500/20",
  Programming:             "bg-cyan-500/15 text-cyan-300 border-cyan-500/20",
  Science:                 "bg-emerald-500/15 text-emerald-300 border-emerald-500/20",
  "Important News":        "bg-rose-500/15 text-rose-300 border-rose-500/20",
  "Social Media Trends":   "bg-amber-500/15 text-amber-300 border-amber-500/20",
};
function categoryPill(cat: string) {
  return CATEGORY_COLORS[cat] ?? "bg-white/5 text-slate-300 border-white/10";
}

// ─── Relative time helper ────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Trend badge ─────────────────────────────────────────────────────────────

function TrendBadge({ label }: { label: TrendLabel }) {
  switch (label) {
    case "TRENDING":
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-violet-400/30 bg-violet-400/15 px-2 py-0.5 text-[10px] font-bold tracking-wide text-violet-300">
          <Flame className="size-2.5 fill-violet-300" />
          TRENDING
        </span>
      );
    case "LATEST":
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/15 px-2 py-0.5 text-[10px] font-bold tracking-wide text-emerald-300">
          <Clock className="size-2.5" />
          LATEST
        </span>
      );
    case "RECOMMENDED":
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-blue-400/30 bg-blue-400/15 px-2 py-0.5 text-[10px] font-bold tracking-wide text-blue-300">
          <Star className="size-2.5 fill-blue-300" />
          PICK
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-slate-400">
          <ThumbsUp className="size-2.5" />
          POPULAR
        </span>
      );
  }
}

// ─── Thumbnail fallback ───────────────────────────────────────────────────────

function ArticleThumbnail({
  src,
  category,
  title,
  featured = false,
}: {
  src?: string | null;
  category: string;
  title: string;
  featured?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const h = featured ? "h-48 sm:h-56" : "h-36";

  if (src && !failed) {
    return (
      <div className={`relative w-full overflow-hidden rounded-xl ${h} bg-white/5`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          aria-hidden="true"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
        />
      </div>
    );
  }

  // Attractive gradient fallback — no fake images
  const gradients: Record<string, string> = {
    "AI & Machine Learning": "from-violet-900/60 to-indigo-900/60",
    Technology:              "from-blue-900/60 to-slate-900/60",
    Programming:             "from-cyan-900/60 to-teal-900/60",
    Science:                 "from-emerald-900/60 to-green-900/60",
    "Important News":        "from-rose-900/60 to-red-900/60",
    "Social Media Trends":   "from-amber-900/60 to-orange-900/60",
  };
  const gradient = gradients[category] ?? "from-slate-800/60 to-slate-900/60";
  const initials = title
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();

  return (
    <div
      className={`relative flex w-full items-center justify-center overflow-hidden rounded-xl ${h} bg-gradient-to-br ${gradient} border border-white/5`}
      aria-hidden="true"
    >
      <span className="select-none text-3xl font-black tracking-tighter text-white/10">
        {initials}
      </span>
    </div>
  );
}

// ─── Featured card (first/top article) ───────────────────────────────────────

function FeaturedCard({
  item,
  isSaved,
  onExplore,
  onSave,
  onDismiss,
}: {
  item: AuraSyncItem;
  isSaved: boolean;
  onExplore: () => void;
  onSave: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-[#0e1225] transition-all hover:border-violet-500/30">
      <ArticleThumbnail src={item.thumbnailUrl} category={item.category} title={item.title} featured />

      {/* Gradient overlay on image */}
      <div className="absolute inset-x-0 top-0 h-48 sm:h-56 bg-gradient-to-b from-transparent to-[#0e1225] pointer-events-none" />

      {/* Badges pinned to image area */}
      <div className="absolute left-4 top-4 flex items-center gap-2">
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${categoryPill(item.category)}`}>
          {item.category}
        </span>
        <TrendBadge label={item.label} />
      </div>

      <div className="p-5">
        <h2 className="text-xl font-bold leading-snug text-white transition group-hover:text-violet-200 sm:text-2xl">
          {item.title}
        </h2>

        <p className="mt-2 text-sm leading-relaxed text-slate-400 line-clamp-2">{item.summary}</p>

        {/* Meta row */}
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          <span className="font-medium text-slate-300">{item.source}</span>
          <span>·</span>
          <span>{relativeTime(item.publishedAt)}</span>
          <span>·</span>
          <span>{item.readingTimeMinutes} min read</span>
        </div>

        {/* Actions */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={onExplore}
            className="flex items-center gap-1.5 rounded-xl bg-violet-600/25 border border-violet-500/30 px-4 py-2 text-sm font-semibold text-violet-200 transition hover:bg-violet-600/40"
          >
            <Sparkles className="size-3.5" />
            Explain with AI
          </button>
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/10 hover:text-white"
          >
            Read article
            <ExternalLink className="size-3.5" />
          </a>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={onSave}
              className={`rounded-lg p-2 transition ${isSaved ? "bg-emerald-500/15 text-emerald-400" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}
              title={isSaved ? "Saved" : "Save for later"}
            >
              {isSaved ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
            </button>
            <button
              onClick={onDismiss}
              className="rounded-lg p-2 text-slate-600 hover:bg-white/5 hover:text-slate-400 transition"
              title="Dismiss"
            >
              <EyeOff className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Regular card ─────────────────────────────────────────────────────────────

function ArticleCard({
  item,
  isSaved,
  onExplore,
  onSave,
  onDismiss,
}: {
  item: AuraSyncItem;
  isSaved: boolean;
  onExplore: () => void;
  onSave: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-white/8 bg-[#0e1225] transition-all hover:border-violet-500/25 hover:bg-[#101428]">
      <ArticleThumbnail src={item.thumbnailUrl} category={item.category} title={item.title} />

      <div className="flex flex-1 flex-col p-4">
        {/* Category + badge */}
        <div className="flex items-center gap-2 mb-2.5">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${categoryPill(item.category)}`}>
            {item.category}
          </span>
          <TrendBadge label={item.label} />
        </div>

        {/* Headline */}
        <h3 className="text-sm font-semibold leading-snug text-white transition group-hover:text-violet-200 line-clamp-3">
          {item.title}
        </h3>

        {/* Summary */}
        <p className="mt-1.5 text-xs leading-relaxed text-slate-500 line-clamp-2 flex-1">
          {item.summary}
        </p>

        {/* Meta */}
        <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-600">
          <span className="truncate font-medium text-slate-400">{item.source}</span>
          <span>·</span>
          <span className="shrink-0">{relativeTime(item.publishedAt)}</span>
          <span>·</span>
          <span className="shrink-0">{item.readingTimeMinutes}m</span>
        </div>

        {/* Relevance note */}
        <p className="mt-2 text-[10px] leading-relaxed text-slate-600 line-clamp-1">
          <span className="text-violet-400/80">↗ </span>
          {item.relevanceNote}
        </p>

        {/* Action row */}
        <div className="mt-3 flex items-center justify-between gap-1 border-t border-white/5 pt-3">
          <button
            onClick={onExplore}
            className="flex items-center gap-1 rounded-lg bg-violet-600/20 border border-violet-500/25 px-2.5 py-1.5 text-[11px] font-semibold text-violet-300 transition hover:bg-violet-600/30"
          >
            <Sparkles className="size-3" />
            Explain
          </button>
          <div className="flex items-center gap-1">
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg p-1.5 text-slate-500 hover:bg-white/5 hover:text-slate-300 transition"
              title="Read original article"
            >
              <ExternalLink className="size-3.5" />
            </a>
            <button
              onClick={onSave}
              className={`rounded-lg p-1.5 transition ${isSaved ? "bg-emerald-500/15 text-emerald-400" : "text-slate-500 hover:bg-white/5 hover:text-slate-300"}`}
              title={isSaved ? "Saved" : "Save for later"}
            >
              {isSaved ? <BookmarkCheck className="size-3.5" /> : <Bookmark className="size-3.5" />}
            </button>
            <button
              onClick={onDismiss}
              className="rounded-lg p-1.5 text-slate-600 hover:bg-white/5 hover:text-slate-400 transition"
              title="Dismiss"
            >
              <EyeOff className="size-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Skeleton loader ─────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="animate-pulse overflow-hidden rounded-2xl border border-white/6 bg-[#0e1225]">
      <div className="h-36 w-full bg-white/5" />
      <div className="p-4 space-y-2">
        <div className="h-3 w-1/3 rounded bg-white/5" />
        <div className="h-4 w-full rounded bg-white/5" />
        <div className="h-4 w-4/5 rounded bg-white/5" />
        <div className="h-3 w-1/2 rounded bg-white/5 mt-3" />
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

interface DiscoverFeedProps {
  onReturnToStudy: () => void;
}

export default function DiscoverFeed({ onReturnToStudy }: DiscoverFeedProps) {
  const [items, setItems] = useState<AuraSyncItem[]>([]);
  const [selectedTab, setSelectedTab] = useState<TabKey>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [isShowingCache, setIsShowingCache] = useState(false);
  const [sourcesStatus, setSourcesStatus] = useState<FeedResponse["sources"]>([]);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);

  const [preferences, setPreferences] = useState<UserInterests>(DEFAULT_PREFERENCES);
  const [savedTopics, setSavedTopics] = useState<SavedTopic[]>([]);
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);
  const [isPrefsOpen, setIsPrefsOpen] = useState(false);
  const [activeItem, setActiveItem] = useState<AuraSyncItem | null>(null);

  const initialFetchInitiatedRef = useRef(false);
  const lastFetchTimestampRef = useRef(0);

  // ── Load from localStorage on mount ──────────────────────────────────────
  useEffect(() => {
    try {
      const savedRaw = localStorage.getItem(SAVED_TOPICS_STORAGE_KEY);
      if (savedRaw) setSavedTopics(JSON.parse(savedRaw));
      const prefsRaw = localStorage.getItem(USER_PREFS_STORAGE_KEY);
      if (prefsRaw) setPreferences(JSON.parse(prefsRaw));
      const dismissedRaw = localStorage.getItem(DISMISSED_IDS_STORAGE_KEY);
      if (dismissedRaw) setDismissedIds(JSON.parse(dismissedRaw));
      const cachedRaw = localStorage.getItem(CACHE_STORAGE_KEY);
      if (cachedRaw) {
        const cached: FeedResponse = JSON.parse(cachedRaw);
        if (Array.isArray(cached.items) && cached.items.length > 0) {
          setItems(cached.items);
          setLastUpdated(cached.lastUpdated);
          setIsShowingCache(true);
          setSourcesStatus(cached.sources || []);
          setInitialLoading(false);
        }
      }
    } catch (e) {
      console.warn("[AuraSync] Error reading local cache:", e);
    }
  }, []);

  // ── Fetch fresh feed ──────────────────────────────────────────────────────
  const fetchFeed = useCallback(async (forceRefresh = false) => {
    setIsRefreshing(true);
    setErrorNotice(null);
    try {
      const url = `/api/aurasync/feed${forceRefresh ? "?refresh=true" : ""}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const data: FeedResponse = await res.json();
      if (Array.isArray(data.items) && data.items.length > 0) {
        setItems(data.items);
        setLastUpdated(data.lastUpdated);
        setIsShowingCache(false);
        setSourcesStatus(data.sources || []);
        try { localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(data)); } catch { /* quota */ }
      }
      lastFetchTimestampRef.current = Date.now();
    } catch (err) {
      console.warn("[AuraSync] Network fetch failed:", err);
      setErrorNotice("Live refresh unavailable. Displaying cached discoveries.");
    } finally {
      setIsRefreshing(false);
      setInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialFetchInitiatedRef.current) return;
    initialFetchInitiatedRef.current = true;
    fetchFeed(false);
  }, [fetchFeed]);

  useEffect(() => {
    const handleVisibility = () => {
      if (!document.hidden) {
        const elapsed = Date.now() - lastFetchTimestampRef.current;
        if (elapsed > 8 * 60 * 1000) fetchFeed(false);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [fetchFeed]);

  // ── Saved topics ──────────────────────────────────────────────────────────
  const handleToggleSave = useCallback((item: AuraSyncItem) => {
    setSavedTopics((prev) => {
      const exists = prev.some((t) => t.id === item.id);
      const next: SavedTopic[] = exists
        ? prev.filter((t) => t.id !== item.id)
        : [{ id: item.id, title: item.title, url: item.url, source: item.source, category: item.category, summary: item.summary, savedAt: new Date().toISOString(), isRead: false }, ...prev];
      try { localStorage.setItem(SAVED_TOPICS_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const handleToggleRead = useCallback((id: string) => {
    setSavedTopics((prev) => {
      const next = prev.map((t) => (t.id === id ? { ...t, isRead: !t.isRead } : t));
      try { localStorage.setItem(SAVED_TOPICS_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const handleRemoveSaved = useCallback((id: string) => {
    setSavedTopics((prev) => {
      const next = prev.filter((t) => t.id !== id);
      try { localStorage.setItem(SAVED_TOPICS_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const handleDismiss = useCallback((id: string) => {
    setDismissedIds((prev) => {
      const next = [...prev, id];
      try { localStorage.setItem(DISMISSED_IDS_STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const handleSavePreferences = useCallback((newPrefs: UserInterests) => {
    setPreferences(newPrefs);
    try { localStorage.setItem(USER_PREFS_STORAGE_KEY, JSON.stringify(newPrefs)); } catch { /* ignore */ }
  }, []);

  // ── Filtered items ────────────────────────────────────────────────────────
  const displayedItems = useMemo(() => {
    let list = items.filter((item) => !dismissedIds.includes(item.id));

    if (selectedTab !== "All" && selectedTab !== "Saved") {
      list = list.filter((item) => item.category === selectedTab);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          item.summary.toLowerCase().includes(q) ||
          item.source.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q),
      );
    }

    if (preferences.categories.length > 0) {
      list = [...list].sort((a, b) => {
        const aBoost = preferences.categories.includes(a.category) ? 20 : 0;
        const bBoost = preferences.categories.includes(b.category) ? 20 : 0;
        return (b.score + bBoost) - (a.score + aBoost);
      });
    }

    const seenIds = new Set<string>();
    return list.filter((item) => {
      if (seenIds.has(item.id)) return false;
      seenIds.add(item.id);
      return true;
    });
  }, [items, dismissedIds, selectedTab, searchQuery, preferences]);

  const featuredItem = selectedTab === "All" && !searchQuery.trim() ? displayedItems[0] ?? null : null;
  const gridItems = featuredItem ? displayedItems.slice(1) : displayedItems;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-0">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 border-b border-white/8 bg-[#080b18]/95 backdrop-blur-md">
        <div className="flex flex-col gap-3 px-1 pb-0 pt-4 sm:flex-row sm:items-center sm:justify-between">
          {/* Title */}
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-blue-600 shadow-lg shadow-violet-500/25">
              <Radio className="size-4 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold tracking-tight text-white">AuraSync</span>
                <span className="rounded-full bg-violet-500/20 border border-violet-500/30 px-2 py-0.5 text-[10px] font-bold text-violet-300 tracking-wider">
                  DISCOVER
                </span>
              </div>
              <p className="text-[10px] text-slate-500 leading-none mt-0.5">
                Live from Hacker News · TechCrunch · ArXiv · The Verge · Dev.to
              </p>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-2 size-3.5 text-slate-500 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search articles…"
                aria-label="Search articles"
                className="h-8 w-44 rounded-xl border border-white/10 bg-white/5 pl-8 pr-3 text-xs text-white placeholder-slate-500 outline-none transition focus:border-violet-400/60 focus:w-56"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1.5 text-slate-500 hover:text-white text-xs"
                  aria-label="Clear search"
                >
                  ✕
                </button>
              )}
            </div>

            <button
              onClick={() => setIsPrefsOpen(true)}
              className="flex size-8 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-400 transition hover:bg-white/10 hover:text-white"
              title="Personalize feed"
              aria-label="Personalize feed"
            >
              <Sliders className="size-3.5" />
            </button>

            <button
              onClick={() => fetchFeed(true)}
              disabled={isRefreshing}
              className="flex size-8 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-400 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
              title="Refresh feed"
              aria-label="Refresh feed"
            >
              <RefreshCw className={`size-3.5 ${isRefreshing ? "animate-spin text-violet-400" : ""}`} />
            </button>
          </div>
        </div>

        {/* ── Category tabs ─────────────────────────────────────────────── */}
        <div className="flex items-center gap-0.5 overflow-x-auto pt-3 no-scrollbar px-1">
          {TABS.map(({ key, label }) => {
            const active = selectedTab === key;
            const isSaved = key === "Saved";
            return (
              <button
                key={key}
                onClick={() => setSelectedTab(key)}
                className={`relative shrink-0 rounded-t-lg px-3.5 py-2 text-xs font-semibold transition-colors ${
                  active
                    ? "text-white"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {isSaved ? (
                  <span className="flex items-center gap-1.5">
                    <BookmarkCheck className="size-3" />
                    Saved
                    {savedTopics.length > 0 && (
                      <span className="rounded-full bg-violet-500/25 px-1.5 py-px text-[9px] text-violet-300">
                        {savedTopics.length}
                      </span>
                    )}
                  </span>
                ) : label}
                {active && (
                  <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-gradient-to-r from-violet-400 to-blue-400" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Status strip ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-1 py-2 text-[10px] text-slate-600">
        <span
          className={`size-1.5 rounded-full shrink-0 ${
            isRefreshing ? "bg-amber-400 animate-pulse" : isShowingCache ? "bg-blue-400/70" : "bg-emerald-400/70"
          }`}
        />
        {isRefreshing
          ? "Refreshing…"
          : isShowingCache
          ? "Cached · refreshing in background"
          : lastUpdated
          ? `Updated ${relativeTime(lastUpdated)}`
          : ""}
        {!isRefreshing && displayedItems.length > 0 && (
          <span className="ml-auto">{displayedItems.length} articles</span>
        )}
      </div>

      {/* ── Error notice ────────────────────────────────────────────────── */}
      {errorNotice && (
        <div className="mx-1 flex items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-400/8 px-3 py-2 text-xs text-amber-200">
          <AlertCircle className="size-3.5 shrink-0" />
          {errorNotice}
        </div>
      )}

      {/* ── Main content ────────────────────────────────────────────────── */}
      <div className="pt-4">
        {selectedTab === "Saved" ? (
          <SavedReadingList
            savedTopics={savedTopics}
            onToggleRead={handleToggleRead}
            onRemove={handleRemoveSaved}
            onOpenTopic={(item) => setActiveItem(item)}
          />
        ) : initialLoading ? (
          /* Loading skeletons */
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)}
          </div>
        ) : displayedItems.length === 0 ? (
          /* Empty state */
          <div className="rounded-2xl border border-white/8 bg-white/2 p-14 text-center">
            <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-white/5 text-slate-400">
              <Compass className="size-6" />
            </div>
            <h3 className="text-sm font-semibold text-white">No articles found</h3>
            <p className="mx-auto mt-1 max-w-xs text-xs text-slate-500">
              {searchQuery
                ? `No results for "${searchQuery}". Try a different keyword.`
                : "Try switching to a different category or refresh the feed."}
            </p>
            <button
              onClick={() => { setSearchQuery(""); setSelectedTab("All"); fetchFeed(true); }}
              className="mt-5 rounded-xl border border-violet-400/25 bg-violet-500/15 px-4 py-2 text-xs font-medium text-violet-200 hover:bg-violet-500/25 transition"
            >
              Reset &amp; Refresh
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Featured story */}
            {featuredItem && (
              <FeaturedCard
                item={featuredItem}
                isSaved={savedTopics.some((t) => t.id === featuredItem.id)}
                onExplore={() => setActiveItem(featuredItem)}
                onSave={() => handleToggleSave(featuredItem)}
                onDismiss={() => handleDismiss(featuredItem.id)}
              />
            )}

            {/* Grid */}
            {gridItems.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {gridItems.map((item) => (
                  <ArticleCard
                    key={item.id}
                    item={item}
                    isSaved={savedTopics.some((t) => t.id === item.id)}
                    onExplore={() => setActiveItem(item)}
                    onSave={() => handleToggleSave(item)}
                    onDismiss={() => handleDismiss(item.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Preserved sub-components ─────────────────────────────────── */}
      <TopicExplorationDrawer
        item={activeItem}
        isOpen={Boolean(activeItem)}
        onClose={() => setActiveItem(null)}
        onReturnToStudy={onReturnToStudy}
        onSaveForLater={handleToggleSave}
        isSaved={Boolean(activeItem && savedTopics.some((t) => t.id === activeItem.id))}
        defaultBudgetMinutes={preferences.timerBudgetMinutes}
      />

      <AuraSyncPreferencesModal
        isOpen={isPrefsOpen}
        onClose={() => setIsPrefsOpen(false)}
        preferences={preferences}
        onSavePreferences={handleSavePreferences}
      />
    </div>
  );
}
