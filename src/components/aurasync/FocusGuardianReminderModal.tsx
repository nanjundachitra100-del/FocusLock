"use client";

import { useEffect, useRef } from "react";
import { Sparkles, Clock, ArrowRight, BookmarkCheck, Plus, X } from "lucide-react";
import type { AuraSyncItem } from "@/lib/aurasync/types";

interface FocusGuardianReminderModalProps {
  isOpen: boolean;
  topic: AuraSyncItem | null;
  budgetMinutes: number;
  onReturnToStudy: () => void;
  onSaveAndReturn: () => void;
  onAddMoreMinutes: (minutes: number) => void;
  onContinueExploring: () => void;
}

export default function FocusGuardianReminderModal({
  isOpen,
  topic,
  budgetMinutes,
  onReturnToStudy,
  onSaveAndReturn,
  onAddMoreMinutes,
  onContinueExploring,
}: FocusGuardianReminderModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    // Play subtle audio chime or voice if permitted
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onContinueExploring();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onContinueExploring]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-md bg-black/60 animate-in fade-in duration-200">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guardian-title"
        className="glass relative w-full max-w-lg rounded-3xl border border-violet-500/30 bg-[#0d1127]/95 p-6 shadow-2xl shadow-violet-500/20 sm:p-8"
      >
        {/* Glow Header */}
        <div className="mb-6 flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-blue-500 text-white shadow-lg shadow-violet-500/30">
            <Sparkles className="size-6" />
          </div>
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/20 bg-violet-400/10 px-2.5 py-0.5 text-[11px] font-semibold text-violet-300">
              <Clock className="size-3" /> FOCUS GUARDIAN ALERT
            </div>
            <h3 id="guardian-title" className="mt-1 text-xl font-bold tracking-tight text-white">
              Hey bro! 👋
            </h3>
          </div>
          <button
            onClick={onContinueExploring}
            className="ml-auto rounded-lg p-1 text-slate-400 hover:bg-white/5 hover:text-white"
            title="Dismiss reminder"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Friendly Message Body */}
        <div className="space-y-3 rounded-2xl border border-white/6 bg-white/3 p-4 text-sm leading-relaxed text-slate-300">
          <p>
            You&apos;ve been exploring{" "}
            <span className="font-semibold text-violet-200">
              &ldquo;{topic?.title || "this topic"}&rdquo;
            </span>{" "}
            for <span className="font-semibold text-white">{budgetMinutes} minutes</span>.
          </p>
          <p className="text-slate-400">
            Found something interesting? 😄 Your study session is still waiting for you.
          </p>
          <p className="text-violet-300 font-medium">
            Want to save this topic and get back to work?
          </p>
        </div>

        {/* 4 Clear Action Choices */}
        <div className="mt-6 flex flex-col gap-2.5 sm:grid sm:grid-cols-2">
          {/* Primary: Save & Return */}
          <button
            onClick={onSaveAndReturn}
            className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-blue-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition hover:brightness-110"
          >
            <BookmarkCheck className="size-4" /> Save & Return
          </button>

          {/* Return to Study without saving */}
          <button
            onClick={onReturnToStudy}
            className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-slate-200 hover:bg-white/10"
          >
            <ArrowRight className="size-4" /> Return to Study
          </button>

          {/* Add 2 More Minutes */}
          <button
            onClick={() => onAddMoreMinutes(2)}
            className="flex items-center justify-center gap-2 rounded-xl border border-violet-400/20 bg-violet-400/10 px-4 py-2.5 text-xs font-medium text-violet-200 hover:bg-violet-400/20"
          >
            <Plus className="size-3.5" /> Add 2 More Minutes
          </button>

          {/* Continue Exploring */}
          <button
            onClick={onContinueExploring}
            className="flex items-center justify-center gap-2 rounded-xl border border-white/6 bg-transparent px-4 py-2.5 text-xs text-slate-400 hover:bg-white/5 hover:text-slate-300"
          >
            Continue Exploring
          </button>
        </div>

        <div className="mt-4 text-center text-[11px] text-slate-500">
          FocusLock protects your deep-work rhythm without breaking your flow.
        </div>
      </div>
    </div>
  );
}
