"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Sparkles, Loader2, AlertCircle, RefreshCw,
  ChevronDown, ChevronUp, Volume2, VolumeX,
  Mic, MicOff, Square, Pause, Play,
} from "lucide-react";
import type { TraceStep } from "@/lib/codevision/trace-engine";

export type TeachMode = "auto" | "gesture" | "manual";

export type GemmaTutorProps = {
  step: TraceStep;
  programTitle: string;
  stepIndex: number;
  totalSteps: number;
  mode: TeachMode;
  gestureTriggered?: boolean;
  onGestureConsumed?: () => void;
};

type TutorStatus = "idle" | "loading" | "ready" | "error";
type TutorAction = "explain_step" | "explain_simpler" | "give_hint" | "what_changed" | "next_step_hint" | "practice" | "custom";
type SpeechStatus = "idle" | "speaking" | "paused";
type MicStatus = "idle" | "listening" | "error";

const ACTION_LABELS: Record<TutorAction, string> = {
  explain_step:     "Explain This Step",
  explain_simpler:  "Explain Simply",
  give_hint:        "Give a Hint",
  what_changed:     "What Changed?",
  next_step_hint:   "What Happens Next?",
  practice:         "Practice Question",
  custom:           "Ask a Question",
};

const SUGGESTED_QUESTIONS = [
  "Explain this line like I'm a beginner.",
  "What changed in memory?",
  "Why did this pointer change?",
  "What will happen in the next step?",
  "Give me a hint.",
  "Generate a practice question.",
];

// ─── Speech synthesis helpers ─────────────────────────────────────────────────
function getSynth(): SpeechSynthesis | null {
  if (typeof window === "undefined") return null;
  return window.speechSynthesis ?? null;
}

function isSSSupported(): boolean {
  return Boolean(getSynth()) && typeof SpeechSynthesisUtterance !== "undefined";
}

// ─── Speech recognition helpers ──────────────────────────────────────────────
type BrowserRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

function getRecognitionCtor(): (new () => BrowserRecognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & { SpeechRecognition?: new () => BrowserRecognition; webkitSpeechRecognition?: new () => BrowserRecognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function GemmaTutor({
  step,
  programTitle,
  stepIndex,
  totalSteps,
  mode,
  gestureTriggered = false,
  onGestureConsumed,
}: GemmaTutorProps) {
  // ── Tutor state ──
  const [reply, setReply] = useState("");
  const [status, setStatus] = useState<TutorStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [lastRequestedStep, setLastRequestedStep] = useState<number>(-1);
  const [customQuestion, setCustomQuestion] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [modelUsed, setModelUsed] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  // ── Speech synthesis state ──
  const [speechStatus, setSpeechStatus] = useState<SpeechStatus>("idle");
  const [autoSpeak, setAutoSpeak] = useState(false);
  const [ssSupported] = useState(isSSSupported);
  const lastSpokenReplyRef = useRef("");
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speakGenRef = useRef(0);

  // ── Speech recognition state ──
  const [micStatus, setMicStatus] = useState<MicStatus>("idle");
  const [transcript, setTranscript] = useState("");
  const [interimText, setInterimText] = useState("");
  const [micError, setMicError] = useState("");
  const [srSupported] = useState(() => Boolean(getRecognitionCtor()));
  const recognitionRef = useRef<BrowserRecognition | null>(null);
  const stopRequestedRef = useRef(false);

  // ── Speech synthesis ─────────────────────────────────────────────────────
  const stopSpeech = useCallback(() => {
    speakGenRef.current++;
    getSynth()?.cancel();
    utteranceRef.current = null;
    setSpeechStatus("idle");
  }, []);

  const speakText = useCallback((text: string) => {
    const synth = getSynth();
    if (!synth || !isSSSupported() || !text.trim()) return;
    synth.cancel();
    const gen = ++speakGenRef.current;
    const utterance = new SpeechSynthesisUtterance(text.trim());
    utterance.lang = "en-US";
    utterance.rate = 1;
    utteranceRef.current = utterance;
    utterance.onstart = () => { if (speakGenRef.current === gen) setSpeechStatus("speaking"); };
    utterance.onpause = () => { if (speakGenRef.current === gen) setSpeechStatus("paused"); };
    utterance.onresume = () => { if (speakGenRef.current === gen) setSpeechStatus("speaking"); };
    utterance.onend = () => { if (speakGenRef.current === gen) { setSpeechStatus("idle"); utteranceRef.current = null; } };
    utterance.onerror = (e) => {
      if (speakGenRef.current !== gen) return;
      if (e.error === "interrupted" || e.error === "canceled") { setSpeechStatus("idle"); return; }
      setSpeechStatus("idle");
    };
    setTimeout(() => { if (speakGenRef.current === gen) synth.speak(utterance); }, 40);
    setSpeechStatus("speaking");
  }, []);

  const pauseSpeech = useCallback(() => {
    const synth = getSynth();
    if (!synth || synth.paused) return;
    synth.pause();
    setSpeechStatus("paused");
  }, []);

  const resumeSpeech = useCallback(() => {
    const synth = getSynth();
    if (!synth) return;
    synth.resume();
    setSpeechStatus("speaking");
  }, []);

  // Cancel speech on step change to avoid stale readout
  useEffect(() => {
    stopSpeech();
    lastSpokenReplyRef.current = "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  // Auto-speak new replies when enabled
  useEffect(() => {
    if (!autoSpeak || !ssSupported || status !== "ready" || !reply) return;
    if (lastSpokenReplyRef.current === reply) return;
    lastSpokenReplyRef.current = reply;
    speakText(reply);
  }, [reply, autoSpeak, ssSupported, status, speakText]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      speakGenRef.current++;
      getSynth()?.cancel();
    };
  }, []);

  // ── Speech recognition ───────────────────────────────────────────────────
  const stopMic = useCallback(() => {
    stopRequestedRef.current = true;
    const r = recognitionRef.current;
    if (r) {
      r.onresult = null; r.onerror = null; r.onend = null;
      try { r.stop(); } catch { try { r.abort(); } catch { /* ok */ } }
    }
    recognitionRef.current = null;
    setMicStatus("idle");
    setInterimText("");
  }, []);

  const startMic = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) { setMicError("Speech recognition is not supported in this browser."); return; }
    stopMic();
    stopRequestedRef.current = false;
    setMicError("");
    setTranscript("");
    setInterimText("");

    const r = new Ctor();
    r.lang = "en-US";
    r.interimResults = true;
    r.continuous = true;
    recognitionRef.current = r;

    r.onresult = (e) => {
      let final = "";
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = (e.results as ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>)[i];
        if (!result) continue;
        if (result.isFinal) final += result[0].transcript;
        else interim += result[0].transcript;
      }
      if (final) setTranscript((prev) => `${prev}${prev ? " " : ""}${final.trim()}`.trim());
      setInterimText(interim.trim());
    };

    r.onerror = (e) => {
      if (e.error === "aborted" || e.error === "no-speech") return;
      setMicError(
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? "Microphone permission denied."
          : "Microphone error. Try typing instead.",
      );
      setMicStatus("idle");
    };

    r.onend = () => {
      if (!stopRequestedRef.current && recognitionRef.current === r) {
        try { r.start(); return; } catch { /* fall through */ }
      }
      setMicStatus("idle");
      setInterimText("");
    };

    try { r.start(); setMicStatus("listening"); }
    catch { setMicError("Could not start microphone."); setMicStatus("idle"); }
  }, [stopMic]);

  const toggleMic = () => {
    if (micStatus === "listening") { stopMic(); return; }
    startMic();
  };

  useEffect(() => {
    return () => {
      stopRequestedRef.current = true;
      try { recognitionRef.current?.abort(); } catch { /* ok */ }
      recognitionRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Gemma API ────────────────────────────────────────────────────────────
  const buildPayload = useCallback((action: TutorAction, question?: string) => {
    const variables = step.stack
      .flatMap((f) => f.locals)
      .map((v) => ({ name: v.name, type: v.type, value: String(v.value ?? "NULL"), changed: v.changed ?? false }));
    const stackFrames = step.stack.map((f) => ({
      fn: f.functionName,
      locals: f.locals.slice(0, 6).map((l) => ({ name: l.name, value: String(l.value ?? "NULL") })),
    }));
    const heap = step.heap.map((n) => ({ address: n.address, label: n.label ?? n.address, isNew: n.isNew ?? false }));
    const pointers = step.pointers.map((p) => ({ from: p.fromLabel, to: p.toAddress }));
    const linkedList = step.linkedList.map((n) => ({ data: String(n.data), isHead: n.isHead ?? false, isActive: n.isActive ?? false }));

    // Map action labels to question text so Gemma receives clear context
    const actionQuestion: Partial<Record<TutorAction, string>> = {
      what_changed: "What changed in memory at this step compared to the previous step?",
      next_step_hint: "What will happen in the next execution step?",
      practice: "Generate one beginner-friendly practice question about the concept demonstrated at this step.",
    };

    return {
      action: (action === "what_changed" || action === "next_step_hint" || action === "practice") ? "custom" : action,
      program: programTitle, language: "c",
      activeLine: step.activeLine, stepIndex, totalSteps,
      explanation: step.explanation,
      variables, stack: stackFrames, heap, pointers, linkedList,
      question: actionQuestion[action] ?? question,
    };
  }, [step, programTitle, stepIndex, totalSteps]);

  const requestExplanation = useCallback(async (action: TutorAction, question?: string) => {
    if (action === "explain_step" && lastRequestedStep === stepIndex) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("loading");
    setErrorMsg("");
    if (action === "explain_step") setLastRequestedStep(stepIndex);

    try {
      const res = await fetch("/api/codevision-tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(action, question)),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const data = (await res.json()) as { reply?: string; error?: string; message?: string; model?: string };
      if (!res.ok || !data.reply) {
        setStatus("error");
        setErrorMsg(data.message ?? "Gemma did not return an explanation.");
        return;
      }
      setReply(data.reply);
      setModelUsed(data.model ?? "");
      setStatus("ready");
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setStatus("error");
      setErrorMsg((e as Error).message ?? "Network error.");
    }
  }, [buildPayload, lastRequestedStep, stepIndex]);

  // Auto-teach
  useEffect(() => {
    if (mode !== "auto") return;
    const timer = setTimeout(() => requestExplanation("explain_step"), 400);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex, mode]);

  // Gesture-triggered
  useEffect(() => {
    if (!gestureTriggered || mode !== "gesture") return;
    onGestureConsumed?.();
    const timer = setTimeout(() => requestExplanation("explain_step"), 300);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gestureTriggered, mode]);

  useEffect(() => { return () => abortRef.current?.abort(); }, []);

  const handleCustomSubmit = () => {
    const q = customQuestion.trim();
    if (!q) return;
    setShowCustomInput(false);
    requestExplanation("custom", q);
    setCustomQuestion("");
  };

  // ── Status styles ────────────────────────────────────────────────────────
  const statusColor = {
    idle:    "text-slate-500 border-slate-600/20 bg-slate-600/5",
    loading: "text-amber-300 border-amber-400/30 bg-amber-500/8",
    ready:   "text-emerald-300 border-emerald-400/30 bg-emerald-500/8",
    error:   "text-rose-300 border-rose-400/30 bg-rose-500/8",
  }[status];

  const statusLabel = {
    idle:    speechStatus === "speaking" ? "SPEAKING" : micStatus === "listening" ? "LISTENING" : "READY",
    loading: "GENERATING…",
    ready:   speechStatus === "speaking" ? "SPEAKING" : speechStatus === "paused" ? "PAUSED" : "RESPONSE RECEIVED",
    error:   "ERROR",
  }[status];

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: "linear-gradient(135deg, #050810 0%, #08101c 100%)",
        border: "1px solid rgba(139,92,246,0.2)",
        boxShadow: "0 0 30px rgba(139,92,246,0.04)",
      }}
    >
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between gap-3 px-4 py-3"
        style={{ borderBottom: collapsed ? "none" : "1px solid rgba(139,92,246,0.12)", background: "rgba(8,13,26,0.8)" }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="flex size-7 items-center justify-center rounded-xl"
            style={{ background: "linear-gradient(135deg, #8b5cf6, #06b6d4)", boxShadow: "0 0 14px rgba(139,92,246,0.3)" }}
          >
            <Sparkles className="size-3.5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white">Gemma 4 Voice Tutor</span>
              <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold tracking-widest ${statusColor}`}>
                {statusLabel}
              </span>
            </div>
            {modelUsed && status === "ready" && (
              <p className="text-[9px] mt-0.5" style={{ color: "#334155" }}>via {modelUsed}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Mode display (read-only — mode is controlled by workspace) */}
          <div className="flex items-center rounded-lg border border-white/8 overflow-hidden text-[10px]">
            {(["manual", "gesture", "auto"] as TeachMode[]).map((m) => (
              <span
                key={m}
                className="px-2 py-1 font-semibold uppercase tracking-wider"
                style={{
                  background: mode === m ? "rgba(139,92,246,0.2)" : "transparent",
                  color: mode === m ? "#c4b5fd" : "#334155",
                }}
              >
                {m}
              </span>
            ))}
          </div>
          {/* Auto-speak toggle */}
          {ssSupported && (
            <button
              onClick={() => setAutoSpeak((a) => !a)}
              className="rounded-lg p-1.5 transition"
              style={{
                border: autoSpeak ? "1px solid rgba(6,182,212,0.4)" : "1px solid rgba(255,255,255,0.06)",
                background: autoSpeak ? "rgba(6,182,212,0.12)" : "transparent",
                color: autoSpeak ? "#22d3ee" : "#475569",
              }}
              title={autoSpeak ? "Auto-speak on (click to disable)" : "Auto-speak off (click to enable)"}
            >
              {autoSpeak ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
            </button>
          )}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="rounded-lg p-1 hover:bg-white/5 transition"
            style={{ color: "#475569" }}
          >
            {collapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="p-4 space-y-3">
          {/* ── Action buttons ─────────────────────────────────────── */}
          <div className="flex flex-wrap gap-1.5">
            {(["explain_step", "explain_simpler", "give_hint", "what_changed", "next_step_hint", "practice"] as TutorAction[]).map((action) => (
              <button
                key={action}
                onClick={() => {
                  if (action === "explain_step") setLastRequestedStep(-1);
                  requestExplanation(action);
                }}
                disabled={status === "loading"}
                className="rounded-xl border px-2.5 py-1.5 text-[10px] font-semibold transition disabled:opacity-40"
                style={{ border: "1px solid rgba(139,92,246,0.25)", background: "rgba(139,92,246,0.07)", color: "#c4b5fd" }}
              >
                {ACTION_LABELS[action]}
              </button>
            ))}
          </div>

          {/* ── Voice question input ────────────────────────────────── */}
          <div
            className="rounded-xl p-3 space-y-2"
            style={{ border: "1px solid rgba(6,182,212,0.12)", background: "rgba(6,182,212,0.03)" }}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <Mic className="size-3 text-cyan-400" />
              <span className="text-[10px] font-bold tracking-widest text-cyan-400">VOICE QUESTION</span>
              {!srSupported && <span className="text-[9px] text-amber-400/70 ml-1">(not supported in this browser)</span>}
            </div>

            <div className="flex gap-2">
              {/* Mic button */}
              {srSupported ? (
                <button
                  onClick={toggleMic}
                  disabled={status === "loading"}
                  className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-semibold transition disabled:opacity-40"
                  style={micStatus === "listening"
                    ? { border: "1px solid rgba(52,211,153,0.4)", background: "rgba(52,211,153,0.12)", color: "#34d399" }
                    : { border: "1px solid rgba(6,182,212,0.3)", background: "rgba(6,182,212,0.08)", color: "#67e8f9" }
                  }
                >
                  {micStatus === "listening"
                    ? <><MicOff className="size-3.5" /> Stop</>
                    : <><Mic className="size-3.5" /> Speak</>
                  }
                </button>
              ) : null}

              {/* Text question input */}
              <input
                type="text"
                value={micStatus === "listening" ? (transcript + (interimText ? ` ${interimText}` : "")) : customQuestion}
                onChange={(e) => {
                  if (micStatus !== "listening") setCustomQuestion(e.target.value);
                }}
                onKeyDown={(e) => e.key === "Enter" && handleAskSubmit()}
                placeholder={micStatus === "listening" ? "Listening…" : srSupported ? "Type or speak a question" : "Type your question"}
                readOnly={micStatus === "listening"}
                className="flex-1 rounded-xl border border-white/8 bg-white/3 px-3 py-2 text-xs text-white placeholder-slate-700 outline-none focus:border-cyan-400/50"
              />

              <button
                onClick={handleAskSubmit}
                disabled={status === "loading" || !(transcript.trim() || customQuestion.trim())}
                className="rounded-xl border border-violet-400/30 bg-violet-500/12 px-3 py-2 text-[11px] font-semibold text-violet-200 hover:bg-violet-500/20 disabled:opacity-40 transition"
              >
                Ask
              </button>
            </div>

            {/* Listening status */}
            {micStatus === "listening" && (
              <p className="text-[10px] text-emerald-300 animate-pulse">
                🎙 Listening{interimText ? `… ${interimText}` : "… speak now"}
              </p>
            )}
            {micError && <p className="text-[10px] text-rose-300">{micError}</p>}
            {!srSupported && (
              <p className="text-[9px]" style={{ color: "#334155" }}>
                Speech recognition is not supported in this browser. Chrome or Edge on desktop is recommended.
              </p>
            )}

            {/* Suggested questions */}
            <div className="flex flex-wrap gap-1 pt-1">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => { setCustomQuestion(q); requestExplanation("custom", q); }}
                  disabled={status === "loading"}
                  className="rounded-full px-2 py-0.5 text-[9px] transition disabled:opacity-40"
                  style={{ border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)", color: "#475569" }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* ── Gemma response loading ──────────────────────────────── */}
          {status === "loading" && (
            <div className="flex items-center gap-2.5 rounded-xl border border-amber-400/15 bg-amber-500/5 px-4 py-3">
              <Loader2 className="size-4 animate-spin shrink-0" style={{ color: "#f59e0b" }} />
              <span className="text-xs" style={{ color: "#78716c" }}>Gemma 4 is thinking…</span>
            </div>
          )}

          {/* ── Error ──────────────────────────────────────────────── */}
          {status === "error" && (
            <div className="flex items-start gap-2.5 rounded-xl border border-rose-400/20 bg-rose-500/8 px-4 py-3">
              <AlertCircle className="size-4 shrink-0 mt-0.5 text-rose-400" />
              <div className="flex-1">
                <p className="text-xs font-semibold text-rose-300 mb-0.5">Gemma unavailable</p>
                <p className="text-xs" style={{ color: "#78716c" }}>{errorMsg}</p>
              </div>
              <button
                onClick={() => { setLastRequestedStep(-1); requestExplanation("explain_step"); }}
                className="shrink-0 rounded-lg p-1 hover:bg-white/5 transition"
                style={{ color: "#64748b" }}
              >
                <RefreshCw className="size-3.5" />
              </button>
            </div>
          )}

          {/* ── Response + voice controls ───────────────────────────── */}
          {status === "ready" && reply && (
            <div
              className="rounded-xl p-4 space-y-3"
              style={{ border: "1px solid rgba(139,92,246,0.15)", background: "rgba(139,92,246,0.04)" }}
            >
              <div className="flex items-center gap-1.5">
                <Sparkles className="size-3 text-violet-400" />
                <span className="text-[9px] font-bold tracking-widest text-violet-400">GEMMA 4 EXPLANATION</span>
                <span className="ml-auto text-[9px]" style={{ color: "#334155" }}>
                  Step {stepIndex + 1} · Line {step.activeLine}
                </span>
              </div>

              <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{reply}</p>

              {/* Voice playback controls */}
              {ssSupported && (
                <div className="flex items-center gap-2 pt-1 border-t border-white/5">
                  {speechStatus === "idle" && (
                    <button
                      onClick={() => { lastSpokenReplyRef.current = ""; speakText(reply); }}
                      className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold transition"
                      style={{ border: "1px solid rgba(6,182,212,0.3)", background: "rgba(6,182,212,0.08)", color: "#67e8f9" }}
                    >
                      <Volume2 className="size-3" /> Speak
                    </button>
                  )}
                  {speechStatus === "speaking" && (
                    <>
                      <button
                        onClick={pauseSpeech}
                        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold transition"
                        style={{ border: "1px solid rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.08)", color: "#fcd34d" }}
                      >
                        <Pause className="size-3" /> Pause
                      </button>
                      <button
                        onClick={stopSpeech}
                        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold transition"
                        style={{ border: "1px solid rgba(244,63,94,0.3)", background: "rgba(244,63,94,0.08)", color: "#fda4af" }}
                      >
                        <Square className="size-3" /> Stop
                      </button>
                      <span className="text-[9px] animate-pulse" style={{ color: "#22d3ee" }}>
                        🔊 Speaking…
                      </span>
                    </>
                  )}
                  {speechStatus === "paused" && (
                    <>
                      <button
                        onClick={resumeSpeech}
                        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold transition"
                        style={{ border: "1px solid rgba(6,182,212,0.3)", background: "rgba(6,182,212,0.08)", color: "#67e8f9" }}
                      >
                        <Play className="size-3 fill-current" /> Resume
                      </button>
                      <button
                        onClick={stopSpeech}
                        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold transition"
                        style={{ border: "1px solid rgba(244,63,94,0.3)", background: "rgba(244,63,94,0.08)", color: "#fda4af" }}
                      >
                        <Square className="size-3" /> Stop
                      </button>
                    </>
                  )}
                  <label className="ml-auto flex items-center gap-1.5 cursor-pointer text-[9px]" style={{ color: "#475569" }}>
                    <input
                      type="checkbox"
                      checked={autoSpeak}
                      onChange={(e) => setAutoSpeak(e.target.checked)}
                      className="size-3 accent-cyan-400"
                    />
                    Auto-speak
                  </label>
                </div>
              )}
              {!ssSupported && (
                <p className="text-[9px] pt-1 border-t border-white/5" style={{ color: "#334155" }}>
                  Speech synthesis not supported in this browser.
                </p>
              )}
            </div>
          )}

          {/* ── Idle prompts ────────────────────────────────────────── */}
          {status === "idle" && mode === "manual" && (
            <p className="text-xs text-center py-2" style={{ color: "#334155" }}>
              Click an action above or ask a question to get a Gemma 4 explanation.
            </p>
          )}
          {status === "idle" && mode === "auto" && (
            <p className="text-xs text-center py-2" style={{ color: "#334155" }}>
              Auto-teach: explanations appear automatically as you step through the code.
            </p>
          )}
        </div>
      )}
    </div>
  );

  // ── Helpers ──────────────────────────────────────────────────────────────
  function handleAskSubmit() {
    if (micStatus === "listening") {
      submitVoiceQuestion();
    } else {
      const q = customQuestion.trim();
      if (!q) return;
      setCustomQuestion("");
      requestExplanation("custom", q);
    }
  }

  function submitVoiceQuestion() {
    const q = transcript.trim();
    if (!q) return;
    stopMic();
    setTranscript("");
    requestExplanation("custom", q);
  }
}
