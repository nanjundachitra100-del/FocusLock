"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  X,
  ExternalLink,
  Clock,
  Pause,
  Play,
  RotateCcw,
  Plus,
  Sparkles,
  Bookmark,
  BookmarkCheck,
  Send,
  LoaderCircle,
  HelpCircle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { AuraSyncItem, TopicExplanation } from "@/lib/aurasync/types";
import FocusGuardianReminderModal from "./FocusGuardianReminderModal";
import LazyAvatarStage from "@/components/avatar/LazyAvatarStage";

interface TopicExplorationDrawerProps {
  item: AuraSyncItem | null;
  isOpen: boolean;
  onClose: () => void;
  onReturnToStudy: () => void;
  onSaveForLater: (item: AuraSyncItem) => void;
  isSaved: boolean;
  defaultBudgetMinutes?: number;
}

const BUDGET_OPTIONS = [1, 3, 5, 10];

export default function TopicExplorationDrawer({
  item,
  isOpen,
  onClose,
  onReturnToStudy,
  onSaveForLater,
  isSaved,
  defaultBudgetMinutes = 5,
}: TopicExplorationDrawerProps) {
  const [explanation, setExplanation] = useState<TopicExplanation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Timer State (strictly timestamp-based to survive tab throttling)
  const [budgetMinutes, setBudgetMinutes] = useState(defaultBudgetMinutes);
  const [secondsRemaining, setSecondsRemaining] = useState(defaultBudgetMinutes * 60);
  const [isTimerPaused, setIsTimerPaused] = useState(false);
  const [showReminder, setShowReminder] = useState(false);
  const [reminderHandled, setReminderHandled] = useState(false);

  // Follow-up Q&A
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState<Array<{ q: string; a: string }>>([]);
  const [askingAi, setAskingAi] = useState(false);

  // Avatar speech toggle for explanation
  const [showAvatar, setShowAvatar] = useState(false);

  // Timestamp references
  const deadlineRef = useRef<number>(0);
  const pauseStartRef = useRef<number | null>(null);
  const accumulatedPauseMsRef = useRef<number>(0);

  // Fetch or reset explanation when item opens
  useEffect(() => {
    if (!isOpen || !item) return;

    // Reset timer
    const totalSecs = budgetMinutes * 60;
    setSecondsRemaining(totalSecs);
    setIsTimerPaused(false);
    setShowReminder(false);
    setReminderHandled(false);
    accumulatedPauseMsRef.current = 0;
    pauseStartRef.current = null;
    deadlineRef.current = Date.now() + totalSecs * 1000;

    // Reset Q&A
    setAnswers([]);
    setQuestion("");

    // Fetch AI explanation
    let active = true;
    setLoading(true);
    setError(null);

    fetch("/api/aurasync/explore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load topic analysis.");
        return res.json();
      })
      .then((data) => {
        if (active && data.explanation) {
          setExplanation(data.explanation);
        }
      })
      .catch((err) => {
        if (active) {
          console.warn("[AuraSync] Explanation fetch error:", err);
          setError("Could not generate deep explanation. Basic facts are shown below.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isOpen, item, budgetMinutes]);

  // Reliable Timestamp-based countdown loop
  useEffect(() => {
    if (!isOpen || isTimerPaused || showReminder) return;

    const intervalId = setInterval(() => {
      const now = Date.now();
      const remainingMs = deadlineRef.current - now;
      const secs = Math.max(0, Math.ceil(remainingMs / 1000));
      setSecondsRemaining(secs);

      if (secs <= 0 && !reminderHandled && !showReminder) {
        clearInterval(intervalId);
        setShowReminder(true);
      }
    }, 500);

    return () => clearInterval(intervalId);
  }, [isOpen, isTimerPaused, showReminder, reminderHandled]);

  // Handle Tab Visibility (Pause elapsed decay calculation accurately)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Tab is backgrounded
      } else {
        // Returned to tab: recalculate remaining from deadline
        if (!isTimerPaused && deadlineRef.current > 0) {
          const now = Date.now();
          const secs = Math.max(0, Math.ceil((deadlineRef.current - now) / 1000));
          setSecondsRemaining(secs);
          if (secs <= 0 && !reminderHandled && !showReminder) {
            setShowReminder(true);
          }
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [isTimerPaused, showReminder, reminderHandled]);

  // Pause / Resume Timer
  const togglePauseTimer = useCallback(() => {
    if (isTimerPaused) {
      // Resuming
      if (pauseStartRef.current) {
        const pauseDuration = Date.now() - pauseStartRef.current;
        accumulatedPauseMsRef.current += pauseDuration;
        deadlineRef.current += pauseDuration;
      }
      pauseStartRef.current = null;
      setIsTimerPaused(false);
    } else {
      // Pausing
      pauseStartRef.current = Date.now();
      setIsTimerPaused(true);
    }
  }, [isTimerPaused]);

  // Add more minutes
  const addMoreMinutes = useCallback((mins: number) => {
    deadlineRef.current += mins * 60 * 1000;
    setSecondsRemaining((prev) => prev + mins * 60);
    setShowReminder(false);
    setIsTimerPaused(false);
    pauseStartRef.current = null;
  }, []);

  // Save & Return action
  const handleSaveAndReturn = useCallback(() => {
    if (item) onSaveForLater(item);
    setShowReminder(false);
    onClose();
    onReturnToStudy();
  }, [item, onSaveForLater, onClose, onReturnToStudy]);

  // Ask AI follow-up
  const handleAskAi = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || askingAi || !item || !explanation) return;

    setAskingAi(true);
    setQuestion("");

    try {
      const res = await fetch("/api/aurasync/explore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item,
          question: q,
          existingExplanation: explanation,
        }),
      });

      const data = await res.json();
      const ans = data.answer || "Answer unavailable.";
      setAnswers((prev) => [...prev, { q, a: ans }]);
    } catch {
      setAnswers((prev) => [
        ...prev,
        {
          q,
          a: `According to ${item.source}, "${item.title}" centers around: ${item.summary}`,
        },
      ]);
    } finally {
      setAskingAi(false);
    }
  };

  if (!isOpen || !item) return null;

  const formattedMinutes = String(Math.floor(secondsRemaining / 60)).padStart(2, "0");
  const formattedSeconds = String(secondsRemaining % 60).padStart(2, "0");
  const totalBudgetSeconds = budgetMinutes * 60;
  const progressPercent = Math.min(
    100,
    Math.max(0, Math.round(((totalBudgetSeconds - secondsRemaining) / totalBudgetSeconds) * 100))
  );

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Slide-in Exploration Drawer */}
      <div
        role="dialog"
        aria-label={`Explore topic: ${item.title}`}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-white/10 bg-[#090d20] text-white shadow-2xl shadow-violet-500/20 animate-in slide-in-from-right duration-300"
      >
        {/* Top Header Bar */}
        <div className="flex items-center justify-between border-b border-white/8 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-violet-400/10 px-2.5 py-1 text-[11px] font-semibold text-violet-300 border border-violet-400/20">
              {item.category}
            </span>
            <span className="text-xs text-slate-400">Source: {item.source}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onSaveForLater(item)}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
                isSaved
                  ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                  : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
              }`}
              title={isSaved ? "Saved to Reading List" : "Save for Later"}
            >
              {isSaved ? <BookmarkCheck className="size-3.5" /> : <Bookmark className="size-3.5" />}
              <span>{isSaved ? "Saved" : "Save for Later"}</span>
            </button>

            <button
              onClick={onClose}
              className="rounded-xl border border-white/10 bg-white/5 p-2 text-slate-400 hover:bg-white/10 hover:text-white"
              title="Close exploration"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Exploration Timer Banner */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-violet-500/15 bg-gradient-to-r from-violet-500/10 via-blue-500/5 to-transparent px-6 py-3 text-xs">
          <div className="flex items-center gap-3">
            <div className="flex size-7 items-center justify-center rounded-lg bg-violet-500/20 text-violet-300">
              <Clock className="size-4" />
            </div>
            <div>
              <span className="text-[10px] uppercase tracking-wider text-slate-400">
                EXPLORATION TIMER
              </span>
              <div className="font-mono text-base font-bold text-white">
                {formattedMinutes}:{formattedSeconds}{" "}
                <span className="text-xs font-normal text-slate-400">
                  / {String(budgetMinutes).padStart(2, "0")}:00
                </span>
              </div>
            </div>
          </div>

          {/* Timer Controls */}
          <div className="flex items-center gap-2">
            <select
              aria-label="Set exploration budget"
              value={budgetMinutes}
              onChange={(e) => setBudgetMinutes(Number(e.target.value))}
              className="rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs text-slate-200 outline-none focus:border-violet-400"
            >
              {BUDGET_OPTIONS.map((min) => (
                <option key={min} value={min}>
                  {min} min budget
                </option>
              ))}
            </select>

            <button
              onClick={togglePauseTimer}
              className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10"
              title={isTimerPaused ? "Resume Timer" : "Pause Timer"}
            >
              {isTimerPaused ? <Play className="size-3" /> : <Pause className="size-3" />}
              <span>{isTimerPaused ? "Resume" : "Pause"}</span>
            </button>

            <button
              onClick={() => addMoreMinutes(2)}
              className="flex items-center gap-1 rounded-lg border border-violet-400/20 bg-violet-400/10 px-2 py-1 text-xs text-violet-200 hover:bg-violet-400/20"
              title="Add 2 more minutes"
            >
              <Plus className="size-3" /> 2m
            </button>
          </div>
        </div>

        {/* Linear Progress Indicator */}
        <div className="h-1 w-full bg-white/5">
          <div
            className={`h-full transition-all duration-500 ${
              progressPercent > 80 ? "bg-amber-400" : "bg-gradient-to-r from-violet-500 to-blue-400"
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
          {/* Title & Attribution */}
          <div>
            <h2 className="text-xl font-bold leading-snug text-white sm:text-2xl">
              {item.title}
            </h2>
            <div className="mt-2.5 flex flex-wrap items-center gap-3 text-xs text-slate-400">
              <span>Published {new Date(item.publishedAt).toLocaleDateString()}</span>
              <span>•</span>
              <span>{item.readingTimeMinutes} min read</span>
              <span>•</span>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-violet-300 hover:underline"
              >
                <span>Read Original Article</span>
                <ExternalLink className="size-3" />
              </a>
            </div>
          </div>

          {/* Optional Embedded Avatar Stage */}
          <div className="rounded-2xl border border-white/8 bg-white/3 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-violet-400" />
                <span className="text-xs font-semibold text-violet-200">
                  FocusLock Virtual Companion
                </span>
              </div>
              <button
                onClick={() => setShowAvatar(!showAvatar)}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-white"
              >
                {showAvatar ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
                <span>{showAvatar ? "Hide Avatar" : "Show 3D Avatar Stage"}</span>
              </button>
            </div>

            {showAvatar ? (
              <div className="overflow-hidden rounded-xl border border-white/5">
                <LazyAvatarStage
                  latestAnswer={
                    explanation?.avatarAnnouncement ||
                    `Exploring ${item.title}. Let's take a look, then get back to our mission!`
                  }
                  isThinking={loading}
                />
              </div>
            ) : (
              <p className="text-xs italic text-slate-400 leading-relaxed">
                &ldquo;
                {explanation?.avatarAnnouncement ||
                  `Hey! Here is the briefing on ${item.title}. Read the core facts, and when you're ready, return to your study session!`}&rdquo;
              </p>
            )}
          </div>

          {/* Loading State */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400 space-y-3">
              <LoaderCircle className="size-7 animate-spin text-violet-400" />
              <p className="text-xs">Gemma AI is analyzing article & synthesizing key takeaways…</p>
            </div>
          )}

          {/* Error Notice if any */}
          {error && (
            <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-xs text-amber-200">
              {error}
            </div>
          )}

          {/* AI Explanation Content */}
          {!loading && explanation && (
            <div className="space-y-6 animate-in fade-in duration-200">
              {/* Executive Summary */}
              <section className="glass rounded-2xl p-5 border border-white/8 space-y-2">
                <div className="text-[10px] font-bold tracking-widest text-violet-300 uppercase">
                  EXECUTIVE SUMMARY
                </div>
                <p className="text-sm leading-relaxed text-slate-200">
                  {explanation.summary}
                </p>
              </section>

              {/* Key Facts */}
              <section className="glass rounded-2xl p-5 border border-white/8 space-y-3">
                <div className="text-[10px] font-bold tracking-widest text-emerald-400 uppercase">
                  VERIFIED KEY FACTS
                </div>
                <ul className="space-y-2 text-xs leading-relaxed text-slate-300">
                  {explanation.keyFacts.map((fact, idx) => (
                    <li key={idx} className="flex items-start gap-2.5">
                      <CheckCircle2 className="size-4 shrink-0 text-emerald-400/80 mt-0.5" />
                      <span>{fact}</span>
                    </li>
                  ))}
                </ul>
              </section>

              {/* Why It Matters */}
              <section className="glass rounded-2xl p-5 border border-white/8 space-y-2">
                <div className="text-[10px] font-bold tracking-widest text-blue-400 uppercase">
                  WHY THIS MATTERS FOR LEARNERS
                </div>
                <p className="text-xs leading-relaxed text-slate-300">
                  {explanation.whyItMatters}
                </p>
              </section>

              {/* Broader Context */}
              <section className="glass rounded-2xl p-5 border border-white/8 space-y-2">
                <div className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">
                  BROADER COMPUTING CONTEXT
                </div>
                <p className="text-xs leading-relaxed text-slate-300">
                  {explanation.context}
                </p>
              </section>

              {/* Related Topics */}
              {explanation.relatedTopics.length > 0 && (
                <div>
                  <div className="mb-2 text-[10px] font-bold tracking-widest text-slate-400 uppercase">
                    RELATED CONCEPTS
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {explanation.relatedTopics.map((topic, idx) => (
                      <span
                        key={idx}
                        className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300"
                      >
                        {topic}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Interactive Ask AI Section */}
              <section className="glass rounded-2xl p-5 border border-violet-400/20 space-y-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4 text-violet-400" />
                  <h4 className="text-xs font-semibold text-white">Ask AI About This Discovery</h4>
                </div>

                {/* Answers history */}
                {answers.map((item, idx) => (
                  <div key={idx} className="space-y-2 text-xs border-b border-white/6 pb-3">
                    <div className="font-medium text-violet-200">Q: {item.q}</div>
                    <div className="text-slate-300 leading-relaxed">A: {item.a}</div>
                  </div>
                ))}

                <form onSubmit={handleAskAi} className="flex gap-2">
                  <input
                    type="text"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="Ask a quick question about this topic…"
                    className="flex-1 rounded-xl border border-white/10 bg-black/40 px-3.5 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-violet-400/60"
                  />
                  <button
                    type="submit"
                    disabled={askingAi || !question.trim()}
                    className="flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-violet-500 disabled:opacity-40"
                  >
                    {askingAi ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : (
                      <Send className="size-3.5" />
                    )}
                    <span>Ask</span>
                  </button>
                </form>
              </section>
            </div>
          )}
        </div>

        {/* Bottom Sticky Action Bar */}
        <div className="border-t border-white/10 bg-[#0d1127] p-4 sm:flex sm:items-center sm:justify-between sm:gap-3 space-y-2 sm:space-y-0">
          <button
            onClick={handleSaveAndReturn}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-blue-500 px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-violet-500/20 hover:brightness-110 sm:w-auto"
          >
            <BookmarkCheck className="size-3.5" />
            <span>Save Topic & Return to Study</span>
          </button>

          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => {
                onClose();
                onReturnToStudy();
              }}
              className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-medium text-slate-300 hover:bg-white/10"
            >
              <ArrowRight className="size-3.5" />
              <span>Return to Study</span>
            </button>

            <button
              onClick={onClose}
              className="rounded-xl border border-white/6 px-3 py-2.5 text-xs text-slate-400 hover:bg-white/5 hover:text-white"
            >
              Close
            </button>
          </div>
        </div>
      </div>

      {/* Focus Guardian Automatic Reminder Modal */}
      <FocusGuardianReminderModal
        isOpen={showReminder}
        topic={item}
        budgetMinutes={budgetMinutes}
        onReturnToStudy={() => {
          setShowReminder(false);
          setReminderHandled(true);
          onClose();
          onReturnToStudy();
        }}
        onSaveAndReturn={() => {
          handleSaveAndReturn();
        }}
        onAddMoreMinutes={(mins) => {
          addMoreMinutes(mins);
          setReminderHandled(false);
        }}
        onContinueExploring={() => {
          setShowReminder(false);
          setReminderHandled(true);
        }}
      />
    </>
  );
}
