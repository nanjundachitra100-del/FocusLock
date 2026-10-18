"use client";

import { useState } from "react";
import { X, Sliders, Check, Clock, Bell, Sparkles } from "lucide-react";
import type { AuraSyncCategory, UserInterests } from "@/lib/aurasync/types";

const ALL_CATEGORIES: AuraSyncCategory[] = [
  "AI & Machine Learning",
  "Technology",
  "Programming",
  "Science",
  "Important News",
  "Social Media Trends",
];

const TIMER_PRESETS = [1, 3, 5, 10];

interface AuraSyncPreferencesModalProps {
  isOpen: boolean;
  onClose: () => void;
  preferences: UserInterests;
  onSavePreferences: (prefs: UserInterests) => void;
}

export default function AuraSyncPreferencesModal({
  isOpen,
  onClose,
  preferences,
  onSavePreferences,
}: AuraSyncPreferencesModalProps) {
  const [selectedCategories, setSelectedCategories] = useState<AuraSyncCategory[]>(
    preferences.categories
  );
  const [budget, setBudget] = useState(preferences.timerBudgetMinutes);
  const [reminders, setReminders] = useState(preferences.remindersEnabled);
  const [narration, setNarration] = useState(preferences.avatarNarrationEnabled);

  if (!isOpen) return null;

  const toggleCategory = (cat: AuraSyncCategory) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const handleSave = () => {
    onSavePreferences({
      categories: selectedCategories.length > 0 ? selectedCategories : ALL_CATEGORIES,
      keywords: preferences.keywords,
      timerBudgetMinutes: budget,
      remindersEnabled: reminders,
      avatarNarrationEnabled: narration,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="prefs-title"
        className="glass relative w-full max-w-md rounded-3xl border border-white/10 bg-[#0d1127]/95 p-6 shadow-2xl sm:p-7"
      >
        <div className="flex items-center justify-between border-b border-white/8 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-xl bg-violet-500/20 text-violet-300">
              <Sliders className="size-4" />
            </div>
            <div>
              <h3 id="prefs-title" className="text-base font-semibold text-white">
                AuraSync Personalization
              </h3>
              <p className="text-[11px] text-slate-400">
                Shape your autonomous discovery feed & focus boundaries
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-white/5 hover:text-white"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-5 space-y-6">
          {/* Preferred Categories */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Preferred Topic Categories
            </label>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Stories in these categories are given priority ranking in your feed.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {ALL_CATEGORIES.map((cat) => {
                const active = selectedCategories.includes(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition ${
                      active
                        ? "border-violet-400/40 bg-violet-400/15 text-violet-100"
                        : "border-white/8 bg-white/2 text-slate-400 hover:bg-white/6"
                    }`}
                  >
                    {active && <Check className="size-3" />}
                    <span>{cat}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Default Timer Budget */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-300">
              <Clock className="size-3.5 text-violet-400" />
              <span>Default Exploration Budget</span>
            </label>
            <p className="mt-0.5 text-[11px] text-slate-400">
              How many minutes you plan to spend exploring an interesting discovery.
            </p>
            <div className="mt-2.5 flex gap-2">
              {TIMER_PRESETS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setBudget(m)}
                  className={`flex-1 rounded-xl border py-2 text-xs font-semibold transition ${
                    budget === m
                      ? "border-violet-400/50 bg-violet-500/20 text-white"
                      : "border-white/8 bg-white/3 text-slate-400 hover:bg-white/8"
                  }`}
                >
                  {m} min
                </button>
              ))}
            </div>
          </div>

          {/* Toggle Switches */}
          <div className="space-y-3 rounded-2xl border border-white/6 bg-white/2 p-4">
            <label className="flex items-center justify-between gap-3 cursor-pointer text-xs">
              <div className="flex items-center gap-2">
                <Bell className="size-3.5 text-amber-300" />
                <span className="text-slate-300">Focus Guardian Reminders</span>
              </div>
              <input
                type="checkbox"
                checked={reminders}
                onChange={(e) => setReminders(e.target.checked)}
                className="size-4 rounded accent-violet-500"
              />
            </label>

            <label className="flex items-center justify-between gap-3 cursor-pointer text-xs">
              <div className="flex items-center gap-2">
                <Sparkles className="size-3.5 text-violet-300" />
                <span className="text-slate-300">Avatar Voice Intro & Briefing</span>
              </div>
              <input
                type="checkbox"
                checked={narration}
                onChange={(e) => setNarration(e.target.checked)}
                className="size-4 rounded accent-violet-500"
              />
            </label>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mt-6 flex items-center justify-end gap-2 border-t border-white/8 pt-4">
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 px-4 py-2 text-xs font-medium text-slate-400 hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="rounded-xl bg-gradient-to-r from-violet-500 to-blue-500 px-5 py-2 text-xs font-semibold text-white shadow-lg shadow-violet-500/20 hover:brightness-110"
          >
            Save Preferences
          </button>
        </div>
      </div>
    </div>
  );
}
