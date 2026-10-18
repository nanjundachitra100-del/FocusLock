"use client";

import { useState } from "react";
import {
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  Circle,
  ExternalLink,
  Sparkles,
  Trash2,
  Clock,
  BookOpen,
} from "lucide-react";
import type { AuraSyncCategory, AuraSyncItem, SavedTopic } from "@/lib/aurasync/types";

interface SavedReadingListProps {
  savedTopics: SavedTopic[];
  onToggleRead: (id: string) => void;
  onRemove: (id: string) => void;
  onOpenTopic: (item: AuraSyncItem) => void;
}

export default function SavedReadingList({
  savedTopics,
  onToggleRead,
  onRemove,
  onOpenTopic,
}: SavedReadingListProps) {
  const [filter, setFilter] = useState<"all" | "unread" | "read">("all");

  const filteredTopics = savedTopics.filter((t) => {
    if (filter === "unread") return !t.isRead;
    if (filter === "read") return t.isRead;
    return true;
  });

  const unreadCount = savedTopics.filter((t) => !t.isRead).length;

  if (savedTopics.length === 0) {
    return (
      <div className="glass rounded-3xl border border-white/8 p-12 text-center">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-violet-400/10 text-violet-300">
          <Bookmark className="size-7" />
        </div>
        <h3 className="text-base font-semibold text-white">Your Reading List is Empty</h3>
        <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-slate-400">
          Browse the Discover feed and click &ldquo;Save for Later&rdquo; on any topic. They will be
          waiting here for your next leisure reading sprint.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter and Stats Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/6 bg-white/2 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-300">
            {savedTopics.length} saved topic{savedTopics.length === 1 ? "" : "s"}
          </span>
          {unreadCount > 0 && (
            <span className="rounded-full bg-violet-400/20 px-2 py-0.5 text-[10px] font-semibold text-violet-300">
              {unreadCount} unread
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {(["all", "unread", "read"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`rounded-xl px-3 py-1 text-xs capitalize transition ${
                filter === tab
                  ? "bg-violet-500/20 text-violet-200 border border-violet-400/30"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Topics List */}
      <div className="grid gap-3 sm:grid-cols-2">
        {filteredTopics.map((topic) => (
          <div
            key={topic.id}
            className={`glass group relative flex flex-col justify-between rounded-2xl border p-5 transition-all hover:border-violet-400/30 ${
              topic.isRead
                ? "border-white/5 bg-white/1 opacity-80"
                : "border-white/10 bg-white/3"
            }`}
          >
            <div>
              <div className="flex items-start justify-between gap-2">
                <span className="rounded-full bg-violet-400/10 px-2 py-0.5 text-[10px] font-medium text-violet-300">
                  {topic.category}
                </span>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => onToggleRead(topic.id)}
                    className="p-1 text-slate-400 hover:text-emerald-300"
                    title={topic.isRead ? "Mark as Unread" : "Mark as Read"}
                  >
                    {topic.isRead ? (
                      <CheckCircle2 className="size-4 text-emerald-400" />
                    ) : (
                      <Circle className="size-4 text-slate-400" />
                    )}
                  </button>

                  <button
                    onClick={() => onRemove(topic.id)}
                    className="p-1 text-slate-500 hover:text-rose-400"
                    title="Remove from reading list"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>

              <h4 className="mt-3 text-sm font-semibold leading-snug text-white group-hover:text-violet-200">
                {topic.title}
              </h4>

              <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-slate-400">
                {topic.summary}
              </p>
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-white/6 pt-3 text-[11px] text-slate-500">
              <span>Saved {new Date(topic.savedAt).toLocaleDateString()}</span>

              <button
                onClick={() => {
                  // Synthesize minimal AuraSyncItem to open drawer
                  const item: AuraSyncItem = {
                    id: topic.id,
                    title: topic.title,
                    url: topic.url,
                    source: topic.source,
                    category: topic.category as AuraSyncCategory,
                    publishedAt: topic.savedAt,
                    summary: topic.summary,
                    readingTimeMinutes: 3,
                    relevanceNote: "Saved from your FocusLock discovery feed.",
                    freshnessStatus: "archived",
                    label: "RECOMMENDED",
                    score: 90,
                  };
                  onOpenTopic(item);
                }}
                className="flex items-center gap-1 font-medium text-violet-300 hover:underline"
              >
                <span>Explore with AI</span>
                <Sparkles className="size-3" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
