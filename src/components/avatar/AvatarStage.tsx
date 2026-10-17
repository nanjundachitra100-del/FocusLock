"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, Eye, Volume2, Square, Brain, HelpCircle, VolumeX } from "lucide-react";
import AvatarCanvas, { type AvatarExpression } from "./AvatarCanvas";
import { useSpeechSynthesis } from "@/hooks/useSpeechSynthesis";

export type AvatarStageProps = {
  latestAnswer?: string;
  isThinking?: boolean;
  isSpeaking?: boolean;
  onSpeakingChange?: (speaking: boolean) => void;
  expression?: AvatarExpression;
  mouthOpen?: number;
  className?: string;
};

const DEMO_INTRO_TEXT = "Hello! I am your FocusLock AI virtual human companion. Ask me any question below and I will explain and speak with you!";

export default function AvatarStage({
  latestAnswer,
  isThinking: externalIsThinking = false,
  isSpeaking: externalIsSpeaking,
  onSpeakingChange,
  expression: externalExpression,
  mouthOpen: externalMouthOpen = 0,
  className = "",
}: AvatarStageProps) {
  const [internalExpression, setInternalExpression] = useState<AvatarExpression>("neutral");
  const [gazeTracking, setGazeTracking] = useState(true);
  const [showAssetInfo, setShowAssetInfo] = useState(false);
  const [autoSpeakEnabled, setAutoSpeakEnabled] = useState(false); // Default OFF per strict requirement

  const lastSpokenAnswerRef = useRef<string | null>(null);

  const textToSpeak = latestAnswer?.trim() || DEMO_INTRO_TEXT;

  // Speech synthesis for speaking the assistant answer aloud
  const { status, supported, errorMessage, speak, stop } = useSpeechSynthesis({
    text: textToSpeak,
    lang: "en-US",
    rate: 1,
  });

  const speechActive = status === "speaking";
  const effectiveIsSpeaking = externalIsSpeaking ?? speechActive;

  // Determine avatar expression
  let activeExpression: AvatarExpression = externalExpression ?? internalExpression;
  if (effectiveIsSpeaking) {
    activeExpression = "speaking";
  } else if (externalIsThinking) {
    activeExpression = "thinking";
  }

  // Notify parent component of speaking state changes
  useEffect(() => {
    onSpeakingChange?.(effectiveIsSpeaking);
  }, [effectiveIsSpeaking, onSpeakingChange]);

  // Optional automatic speech when a new answer arrives (ONLY if enabled by user)
  useEffect(() => {
    if (!autoSpeakEnabled || !latestAnswer || !supported) return;
    const trimmed = latestAnswer.trim();
    if (trimmed && trimmed !== lastSpokenAnswerRef.current) {
      lastSpokenAnswerRef.current = trimmed;
      speak();
    }
  }, [latestAnswer, autoSpeakEnabled, supported, speak]);

  // Clean up: cancel speech when unmounting
  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  const handleSpeakClick = () => {
    if (!supported) return;
    lastSpokenAnswerRef.current = textToSpeak;
    speak();
  };

  const handleStopClick = () => {
    stop();
  };

  return (
    <div className={`glass relative flex flex-col rounded-2xl border border-white/10 p-5 ${className}`}>
      {/* Header Bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-blue-500 text-white shadow-md shadow-violet-500/20">
            <Sparkles className="size-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-white">AI Virtual Human Companion</h3>
            <p className="text-[11px] text-slate-400">Interactive 3D Study Assistant · Speech & Real-time Animation</p>
          </div>
        </div>

        {/* State Indicators */}
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all ${
              effectiveIsSpeaking
                ? "border border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                : externalIsThinking
                  ? "border border-amber-400/30 bg-amber-400/10 text-amber-200"
                  : "border border-violet-400/20 bg-violet-400/10 text-violet-200"
            }`}
          >
            <span
              className={`size-1.5 rounded-full ${
                effectiveIsSpeaking
                  ? "animate-pulse bg-emerald-400"
                  : externalIsThinking
                    ? "animate-ping bg-amber-400"
                    : "bg-violet-400"
              }`}
            />
            {effectiveIsSpeaking ? "Speaking Aloud" : externalIsThinking ? "Thinking…" : "Ready to Assist"}
          </span>

          <button
            type="button"
            onClick={() => setShowAssetInfo(!showAssetInfo)}
            className="flex size-7 items-center justify-center rounded-lg border border-white/10 text-slate-400 hover:bg-white/5 hover:text-white"
            title="Custom Avatar Asset Info"
          >
            <HelpCircle className="size-3.5" />
          </button>
        </div>
      </div>

      {/* 3D Canvas Viewport */}
      <div className="relative h-72 w-full overflow-hidden rounded-xl border border-white/8 bg-gradient-to-b from-[#10142e] via-[#0d1024] to-[#080b18]">
        <AvatarCanvas
          expression={activeExpression}
          isSpeaking={effectiveIsSpeaking}
          mouthOpen={externalMouthOpen}
          enableTracking={gazeTracking}
          className="h-full w-full"
        />

        {/* Asset Drop-in Guide Overlay */}
        {showAssetInfo && (
          <div className="absolute inset-0 z-10 flex flex-col justify-center bg-[#090d22]/95 p-6 backdrop-blur-md">
            <h4 className="text-sm font-semibold text-violet-200">Custom 3D Avatar Models</h4>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">
              The 3D rendering engine currently operates using the lightweight procedural cyber-humanoid foundation with
              procedural blinking, jaw articulation, and gaze tracking.
            </p>
            <div className="mt-3 rounded-lg border border-white/10 bg-black/40 p-3 font-mono text-[11px] text-slate-300">
              Drop any standard <span className="text-violet-300">.glb</span> /{" "}
              <span className="text-violet-300">.gltf</span> avatar with ARKit/VRM visemes into:
              <br />
              <span className="text-emerald-300">public/avatars/companion.glb</span>
            </div>
            <button
              type="button"
              onClick={() => setShowAssetInfo(false)}
              className="mt-4 self-end rounded-lg bg-violet-500/20 px-3 py-1.5 text-xs font-medium text-violet-200 hover:bg-violet-500/30"
            >
              Close
            </button>
          </div>
        )}
      </div>

      {/* Speech & Interaction Bar */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/6 pt-3 text-xs">
        {/* Primary Speech Action (Speak / Stop) */}
        <div className="flex items-center gap-2">
          {effectiveIsSpeaking ? (
            <button
              type="button"
              onClick={handleStopClick}
              className="inline-flex items-center gap-1.5 rounded-xl border border-rose-400/40 bg-rose-500/20 px-3.5 py-1.5 text-xs font-semibold text-rose-200 shadow-lg shadow-rose-500/10 hover:bg-rose-500/30"
              aria-label="Stop speaking"
            >
              <Square className="size-3.5 fill-current" /> Stop Speaking
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSpeakClick}
              disabled={!supported}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-500 to-blue-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg shadow-violet-500/20 hover:brightness-110 disabled:opacity-40"
              aria-label="Speak answer aloud"
            >
              <Volume2 className="size-3.5" /> {latestAnswer?.trim() ? "Speak Answer" : "Test Voice Intro"}
            </button>
          )}

          {/* Auto-speech toggle (Default: OFF) */}
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/10 bg-white/4 px-2.5 py-1 text-[11px] text-slate-300 hover:bg-white/7">
            <input
              type="checkbox"
              checked={autoSpeakEnabled}
              disabled={!supported}
              onChange={(e) => setAutoSpeakEnabled(e.target.checked)}
              className="size-3.5 accent-violet-400"
            />
            <span>Auto-speak new answers</span>
          </label>
        </div>

        {/* Head Tracking toggle */}
        <label className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-400">
          <Eye className="size-3.5 text-slate-400" />
          <span>Gaze Tracking</span>
          <input
            type="checkbox"
            checked={gazeTracking}
            onChange={(e) => setGazeTracking(e.target.checked)}
            className="size-3.5 accent-violet-400"
          />
        </label>
      </div>

      {/* Answer status / fallback info */}
      <div className="mt-2 text-[11px] text-slate-400">
        {!supported && (
          <span className="inline-flex items-center gap-1 text-amber-300">
            <VolumeX className="size-3" /> Speech synthesis is not supported in this browser.
          </span>
        )}
        {supported && !latestAnswer?.trim() && (
          <span className="text-slate-500">Ask a study question below. The avatar can speak Gemma AI answers aloud.</span>
        )}
        {supported && latestAnswer?.trim() && !effectiveIsSpeaking && (
          <span className="text-slate-400">
            Latest answer ready. Click <span className="text-violet-200 font-medium">Speak Answer</span> to hear it spoken with mouth animation.
          </span>
        )}
        {errorMessage && status !== "unsupported" && (
          <span className="text-rose-300">{errorMessage}</span>
        )}
      </div>
    </div>
  );
}
