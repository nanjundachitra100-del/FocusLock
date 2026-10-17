"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Square, Volume2 } from "lucide-react";
import { useSpeechSynthesis, type SpeechStatus } from "@/hooks/useSpeechSynthesis";

export const AUTO_NARRATION_STORAGE_KEY = "focuslock.autoNarration";
const RATES = [0.75, 1, 1.25, 1.5];

/** Survives Strict Mode remounts so the same text is not auto-spoken twice per instance. */
const lastAutoNarratedByInstance = new Map<string, string | null>();

type AutoVoiceOverProps = {
  text: string;
  enabled?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
  lang?: string;
  rate?: number;
  instanceId?: string;
  autoSpeakNewText?: boolean;
  title?: string;
  description?: string;
};

const STATUS_LABEL: Record<SpeechStatus, string> = {
  ready: "Ready",
  speaking: "Speaking",
  paused: "Paused",
  finished: "Finished",
  unsupported: "Unsupported",
  failed: "Failed",
};

function rememberSpoken(instanceId: string, value: string | null) {
  lastAutoNarratedByInstance.set(instanceId, value);
}

function wasJustSpoken(instanceId: string, value: string) {
  return lastAutoNarratedByInstance.get(instanceId) === value;
}

export default function AutoVoiceOver({
  text,
  enabled: enabledProp,
  onEnabledChange,
  lang = "en-US",
  rate: rateProp = 1,
  instanceId = "default",
  autoSpeakNewText = false,
  title = "Explanation voice-over",
  description = "Reads a new explanation aloud after you enable it.",
}: AutoVoiceOverProps) {
  const [internalEnabled, setInternalEnabled] = useState(false);
  const [rate, setRate] = useState(rateProp);
  const [voiceURI, setVoiceURI] = useState<string | null>(null);
  const enabled = enabledProp ?? internalEnabled;

  const { status, supported, voices, errorMessage, speak, pause, resume, stop } = useSpeechSynthesis({
    text,
    lang,
    rate,
    voiceURI,
  });

  const lastAutoSpokenRef = useRef<string | null>(null);
  const unlockedRef = useRef(false);
  const speakRef = useRef(speak);
  const stopRef = useRef(stop);
  speakRef.current = speak;
  stopRef.current = stop;

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(AUTO_NARRATION_STORAGE_KEY);
      if (stored === "true" && enabledProp === undefined) {
        setInternalEnabled(true);
        // Do NOT set unlockedRef here — restoring the toggle state should not
        // cause the current text to auto-play on page load. The user must
        // explicitly interact (enable the toggle or press Play) first.
      }
    } catch {
      /* localStorage may be unavailable */
    }
  }, [enabledProp, autoSpeakNewText]);

  useEffect(() => {
    if (enabled && autoSpeakNewText) unlockedRef.current = true;
  }, [enabled, autoSpeakNewText]);

  const persistEnabled = useCallback(
    (next: boolean) => {
      if (enabledProp === undefined) setInternalEnabled(next);
      onEnabledChange?.(next);
      try {
        window.localStorage.setItem(AUTO_NARRATION_STORAGE_KEY, String(next));
      } catch {
        /* ignore quota / private mode */
      }
    },
    [enabledProp, onEnabledChange],
  );

  const handleEnabledChange = (next: boolean) => {
    persistEnabled(next);
    if (!next) {
      unlockedRef.current = false;
      lastAutoSpokenRef.current = null;
      rememberSpoken(instanceId, null);
      stop();
      return;
    }

    unlockedRef.current = true;
    const nextText = text.trim();
    if (!nextText || !supported) return;
    lastAutoSpokenRef.current = nextText;
    rememberSpoken(instanceId, nextText);
    speak();
  };

  useEffect(() => {
    if (!enabled || !supported) return;
    if (!autoSpeakNewText && !unlockedRef.current) return;

    const nextText = text.trim();
    if (!nextText) {
      if (lastAutoSpokenRef.current) stopRef.current();
      lastAutoSpokenRef.current = null;
      rememberSpoken(instanceId, null);
      return;
    }
    if (lastAutoSpokenRef.current === nextText || wasJustSpoken(instanceId, nextText)) return;
    lastAutoSpokenRef.current = nextText;
    rememberSpoken(instanceId, nextText);
    stopRef.current();
    speakRef.current();
  }, [text, enabled, supported, autoSpeakNewText, instanceId]);

  useEffect(() => {
    return () => {
      lastAutoNarratedByInstance.delete(instanceId);
    };
  }, [instanceId]);

  const playOrReplay = () => {
    unlockedRef.current = true;
    const nextText = text.trim() || null;
    lastAutoSpokenRef.current = nextText;
    rememberSpoken(instanceId, nextText);
    speak();
  };

  const empty = !text.trim();
  const canSpeak = supported && !empty;
  const isSpeaking = status === "speaking";
  const isPaused = status === "paused";

  return (
    <div className="rounded-xl border border-white/10 bg-white/4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-slate-200">
          <Volume2 className="size-4 text-violet-300" aria-hidden="true" />
          <span className="font-medium">{title}</span>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
            status === "speaking"
              ? "bg-emerald-400/10 text-emerald-300"
              : status === "failed" || status === "unsupported"
                ? "bg-rose-400/10 text-rose-300"
                : status === "paused"
                  ? "bg-amber-400/10 text-amber-200"
                  : "bg-white/5 text-slate-300"
          }`}
          aria-live="polite"
        >
          {STATUS_LABEL[status]}
        </span>
      </div>

      <label className="mt-4 flex cursor-pointer items-center justify-between gap-4 text-sm">
        <span>
          <span className="block text-slate-300">Automatic narration</span>
          <span className="text-xs text-slate-500">{description}</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          aria-label="Automatic narration"
          className="size-4 accent-violet-400"
          checked={enabled}
          disabled={!supported}
          onChange={(event) => handleEnabledChange(event.target.checked)}
        />
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        {isPaused ? (
          <button
            type="button"
            aria-label="Resume narration"
            onClick={resume}
            disabled={!canSpeak}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-blue-500 px-3 py-2 text-xs font-semibold disabled:opacity-40"
          >
            <Play className="size-3.5 fill-current" /> Resume
          </button>
        ) : (
          <button
            type="button"
            aria-label={isSpeaking ? "Replay narration from the start" : "Play narration"}
            onClick={playOrReplay}
            disabled={!canSpeak}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-blue-500 px-3 py-2 text-xs font-semibold disabled:opacity-40"
          >
            {status === "finished" ? <RotateCcw className="size-3.5" /> : <Play className="size-3.5 fill-current" />}
            {status === "finished" || isSpeaking ? "Replay" : "Play"}
          </button>
        )}
        <button
          type="button"
          aria-label="Pause narration"
          onClick={pause}
          disabled={!canSpeak || !isSpeaking}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 disabled:opacity-40"
        >
          <Pause className="size-3.5" /> Pause
        </button>
        <button
          type="button"
          aria-label="Stop narration"
          onClick={() => {
            lastAutoSpokenRef.current = text.trim();
            rememberSpoken(instanceId, text.trim() || null);
            stop();
          }}
          disabled={!canSpeak || (!isSpeaking && !isPaused)}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 disabled:opacity-40"
        >
          <Square className="size-3.5" /> Stop
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-slate-400">
          Speech rate
          <select
            aria-label="Speech rate"
            className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 outline-none focus:border-violet-400/60"
            value={String(rate)}
            onChange={(event) => setRate(Number(event.target.value))}
          >
            {RATES.map((value) => (
              <option key={value} value={value}>
                {value === 1 ? "1× (normal)" : `${value}×`}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-slate-400">
          Voice
          <select
            aria-label="Narration voice"
            className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 outline-none focus:border-violet-400/60"
            value={voiceURI ?? ""}
            onChange={(event) => setVoiceURI(event.target.value || null)}
            disabled={!supported || voices.length === 0}
          >
            <option value="">Browser default</option>
            {voices.map((voice) => (
              <option key={voice.voiceURI} value={voice.voiceURI}>
                {voice.name} ({voice.lang})
              </option>
            ))}
          </select>
        </label>
      </div>

      {!supported && (
        <p className="mt-3 text-xs text-rose-300">This browser cannot read text aloud. You can still read the text on the page.</p>
      )}
      {supported && voices.length === 0 && (
        <p className="mt-3 text-xs text-amber-200">No system voices were listed yet. Playback may still use the browser default voice.</p>
      )}
      {empty && <p className="mt-3 text-xs text-slate-500">Waiting for text to narrate.</p>}
      {errorMessage && status !== "unsupported" && <p className="mt-3 text-xs text-rose-300">{errorMessage}</p>}
    </div>
  );
}
