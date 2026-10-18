"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  Play, SkipBack, SkipForward, RotateCcw, ChevronDown, ChevronUp,
  Cpu, Layers, Database, ArrowRight, Code2, BookOpen, Info, Flag, Sparkles,
} from "lucide-react";
import { TRACE_PROGRAMS, type TraceStep, type CVariable } from "@/lib/codevision/trace-engine";
import dynamic from "next/dynamic";
import type { TeachMode } from "./GemmaTutor";

const HandTrackingPanel = dynamic(() => import("./HandTrackingPanel"), { ssr: false });
const GemmaTutor = dynamic(() => import("./GemmaTutor"), { ssr: false });
const ProgramExplorer = dynamic(() => import("./ProgramExplorer"), { ssr: false });

// ─── Syntax tokens (reuse logic from LiveCodeEditor) ─────────────────────────
const C_KEYWORDS = new Set(["int","char","float","double","void","struct","return","if","else","while","for","do","switch","case","break","continue","NULL","include","define","typedef","const","static","sizeof","malloc","free","printf","scanf","typedef"]);
type Token = { text: string; cls: string };
function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === "/" && line[i+1] === "/") { tokens.push({ text: line.slice(i), cls: "text-slate-500 italic" }); break; }
    if (line[i] === '"' || line[i] === "'") {
      const q = line[i]; let j = i + 1;
      while (j < line.length && !(line[j] === q && line[j-1] !== "\\")) j++;
      tokens.push({ text: line.slice(i, j+1), cls: "text-emerald-300" }); i = j+1; continue;
    }
    if (line[i] === "#") { let j = i; while (j < line.length && !/\s/.test(line[j])) j++; tokens.push({ text: line.slice(i,j), cls: "text-violet-300" }); i = j; continue; }
    if (/[0-9]/.test(line[i])) { let j = i; while (j < line.length && /[0-9a-fA-FxX._]/.test(line[j])) j++; tokens.push({ text: line.slice(i,j), cls: "text-amber-300" }); i = j; continue; }
    if (/[a-zA-Z_]/.test(line[i])) {
      let j = i; while (j < line.length && /[a-zA-Z0-9_]/.test(line[j])) j++;
      const word = line.slice(i,j);
      tokens.push({ text: word, cls: C_KEYWORDS.has(word) ? "text-cyan-300 font-semibold" : /^[A-Z]/.test(word) ? "text-violet-200" : "text-slate-200" });
      i = j; continue;
    }
    tokens.push({ text: line[i], cls: "text-slate-400" }); i++;
  }
  return tokens;
}

// ─── Code panel ───────────────────────────────────────────────────────────────
function CodePanel({ code, activeLine, highlightLines }: { code: string; activeLine: number; highlightLines: number[] }) {
  const activeRef = useRef<HTMLTableRowElement>(null);
  const lines = code.split("\n");
  const hlSet = new Set(highlightLines);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [activeLine]);

  return (
    <div className="h-full overflow-auto font-mono text-xs leading-5" style={{ scrollbarWidth: "thin", scrollbarColor: "#1e2540 transparent" }}>
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((line, idx) => {
            const lineNum = idx + 1;
            const isActive = lineNum === activeLine;
            const isHighlighted = hlSet.has(lineNum);
            const tokens = tokenizeLine(line);
            return (
              <tr
                key={lineNum}
                ref={isActive ? activeRef : undefined}
                className={`transition-colors ${
                  isActive
                    ? "bg-violet-500/25 border-l-2 border-violet-400"
                    : isHighlighted
                    ? "bg-violet-500/10 border-l-2 border-violet-600/50"
                    : "border-l-2 border-transparent"
                }`}
              >
                <td className={`select-none w-9 pr-2 text-right align-top pt-px pl-1 shrink-0 ${isActive ? "text-violet-300 font-bold" : "text-slate-600"}`}>
                  {lineNum}
                </td>
                <td className="pr-3 whitespace-pre align-top">
                  {tokens.map((t, ti) => <span key={ti} className={t.cls}>{t.text}</span>)}
                  {line === "" && "\u00a0"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Variables panel ─────────────────────────────────────────────────────────
function VariablesPanel({ variables }: { variables: CVariable[] }) {
  if (variables.length === 0) return (
    <div className="flex h-full items-center justify-center text-xs text-slate-600">No variables yet</div>
  );
  return (
    <div className="overflow-auto h-full" style={{ scrollbarWidth: "thin" }}>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/8 text-[10px] text-slate-500 uppercase tracking-wider">
            <th className="pb-1.5 pl-2 text-left font-medium">Name</th>
            <th className="pb-1.5 text-left font-medium">Type</th>
            <th className="pb-1.5 text-left font-medium">Value</th>
            <th className="pb-1.5 pr-2 text-left font-medium">Addr</th>
          </tr>
        </thead>
        <tbody>
          {variables.map((v) => (
            <tr
              key={v.name + v.address}
              className={`border-b border-white/4 transition-colors ${v.changed ? "bg-amber-400/10" : ""}`}
            >
              <td className={`py-1 pl-2 font-mono font-semibold ${v.isPointer ? "text-cyan-300" : "text-slate-200"}`}>{v.name}</td>
              <td className="py-1 text-violet-300/80 font-mono">{v.type}</td>
              <td className={`py-1 font-mono ${v.changed ? "text-amber-300 font-bold" : v.isPointer ? "text-cyan-300" : "text-emerald-300"}`}>
                {String(v.value ?? "NULL")}
              </td>
              <td className="py-1 pr-2 text-slate-600 font-mono text-[10px]">{v.address}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Stack panel ─────────────────────────────────────────────────────────────
function StackPanel({ stack }: { stack: TraceStep["stack"] }) {
  if (stack.length === 0) return (
    <div className="flex h-full items-center justify-center text-xs text-slate-600">Empty call stack</div>
  );
  return (
    <div className="overflow-auto h-full space-y-2 pr-1" style={{ scrollbarWidth: "thin" }}>
      {[...stack].reverse().map((frame, fi) => (
        <div key={frame.functionName + fi} className={`rounded-lg border px-2 py-1.5 ${fi === 0 ? "border-violet-400/30 bg-violet-500/8" : "border-white/8 bg-white/2"}`}>
          <div className={`mb-1 text-[10px] font-bold uppercase tracking-wider ${fi === 0 ? "text-violet-300" : "text-slate-500"}`}>
            {fi === 0 ? "▶ " : ""}{frame.functionName}()
          </div>
          {frame.locals.slice(0, 4).map((v) => (
            <div key={v.name} className="flex items-center gap-1 text-[10px]">
              <span className={`font-mono ${v.isPointer ? "text-cyan-300/80" : "text-slate-400"}`}>{v.name}</span>
              <span className="text-slate-600">=</span>
              <span className={`font-mono ${v.changed ? "text-amber-300" : v.isPointer ? "text-cyan-300/80" : "text-emerald-300/80"}`}>{String(v.value ?? "NULL")}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Heap panel ──────────────────────────────────────────────────────────────
function HeapPanel({ heap }: { heap: TraceStep["heap"] }) {
  if (heap.length === 0) return (
    <div className="flex h-full items-center justify-center text-xs text-slate-600">No heap allocations</div>
  );
  return (
    <div className="overflow-auto h-full space-y-2 pr-1" style={{ scrollbarWidth: "thin" }}>
      {heap.map((node) => (
        <div
          key={node.address}
          className={`rounded-lg border px-2 py-1.5 transition-colors ${
            node.isNew ? "border-emerald-400/40 bg-emerald-500/8" : node.isActive ? "border-violet-400/30 bg-violet-500/8" : "border-white/8 bg-white/2"
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold text-cyan-300">{node.label ?? node.address}</span>
            <span className="text-[9px] text-slate-600 font-mono">{node.address}</span>
            {node.isNew && <span className="text-[9px] text-emerald-400 font-bold">NEW</span>}
          </div>
          {node.fields.map((f) => (
            <div key={f.name} className="flex items-center gap-1 text-[10px]">
              <span className={`font-mono ${f.isPointer ? "text-cyan-300/80" : "text-slate-400"}`}>{f.name}</span>
              <span className="text-slate-600">:</span>
              <span className={`font-mono ${f.changed ? "text-amber-300" : f.isPointer ? "text-cyan-300/80" : "text-emerald-300/80"}`}>{String(f.value ?? "NULL")}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Linked-list visualizer ───────────────────────────────────────────────────
function LinkedListViz({ nodes }: { nodes: TraceStep["linkedList"] }) {
  if (nodes.length === 0) return (
    <div className="flex h-full items-center justify-center text-xs text-slate-600">No linked list yet</div>
  );
  return (
    <div className="flex items-center gap-0 overflow-x-auto py-2 px-1 h-full" style={{ scrollbarWidth: "thin" }}>
      {nodes.map((node, i) => (
        <div key={node.address} className="flex items-center shrink-0">
          {/* Node box */}
          <div className={`relative rounded-lg border px-3 py-2 text-center transition-all ${
            node.isActive ? "border-violet-400 bg-violet-500/20 shadow-[0_0_12px_rgba(139,92,246,0.3)]"
            : node.isHead ? "border-cyan-400/60 bg-cyan-500/10"
            : "border-white/15 bg-white/4"
          }`}>
            {node.isHead && (
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-[9px] font-bold text-cyan-400 whitespace-nowrap">head</div>
            )}
            <div className={`text-base font-bold font-mono ${node.isActive ? "text-violet-200" : node.isHead ? "text-cyan-200" : "text-slate-200"}`}>
              {String(node.data)}
            </div>
            <div className="mt-0.5 text-[9px] text-slate-600 font-mono">{node.address}</div>
            {/* data | next layout */}
            <div className="mt-1 flex border-t border-white/10 pt-1 gap-2 text-[9px]">
              <span className="text-slate-500">data</span>
              <span className="text-white/20">|</span>
              <span className={`font-mono ${node.nextAddress ? "text-cyan-400/70" : "text-slate-600"}`}>
                {node.nextAddress ? "next→" : "NULL"}
              </span>
            </div>
          </div>
          {/* Arrow to next or NULL */}
          {i < nodes.length - 1 ? (
            <div className="flex items-center mx-1">
              <ArrowRight className="size-4 text-cyan-400/60" />
            </div>
          ) : (
            <div className="flex items-center mx-2">
              <ArrowRight className="size-3 text-slate-600" />
              <span className="text-[10px] text-slate-600 font-mono font-bold">NULL</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Pointer arrows (SVG) ─────────────────────────────────────────────────────
function PointerViz({ pointers }: { pointers: TraceStep["pointers"] }) {
  if (pointers.length === 0) return (
    <div className="flex h-full items-center justify-center text-xs text-slate-600">No pointer relationships</div>
  );
  return (
    <div className="overflow-auto h-full space-y-1.5">
      {pointers.map((p, i) => (
        <div key={i} className="flex items-center gap-2 text-xs rounded-lg border border-white/6 bg-white/2 px-2 py-1.5">
          <span className="font-mono text-cyan-300 font-semibold shrink-0">{p.fromLabel}</span>
          <span className="text-slate-600 text-[10px]">({p.fromAddress})</span>
          <ArrowRight className="size-3 text-violet-400 shrink-0" />
          {p.toAddress ? (
            <span className="font-mono text-emerald-300">{p.toAddress}</span>
          ) : (
            <span className="font-mono text-slate-500 font-bold">NULL</span>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── AI Insight Panel ────────────────────────────────────────────────────────
function AIInsightPanel({ step, programId }: { step: TraceStep; programId: string }) {
  const changedVars = step.stack.flatMap((f) => f.locals).filter((v) => v.changed);
  const newHeapNodes = step.heap.filter((n) => n.isNew);
  const activeHeap = step.heap.filter((n) => n.isActive && !n.isNew);
  const changedPointers = step.pointers;

  return (
    <div className="rounded-xl border border-violet-400/20 bg-[#09091f] p-4 space-y-3">
      <div className="flex items-center gap-2 border-b border-white/6 pb-2">
        <BookOpen className="size-3.5 text-violet-400" />
        <span className="text-[11px] font-bold tracking-widest text-violet-300">AI INSIGHT</span>
        <span className="ml-auto text-[9px] text-slate-600">Step {step.stepIndex + 1} · Line {step.activeLine}</span>
      </div>

      {/* What's happening */}
      <div>
        <div className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider mb-1">What&apos;s Happening</div>
        <p className="text-xs text-slate-300 leading-relaxed">{step.explanation}</p>
      </div>

      {/* Changed variables */}
      {changedVars.length > 0 && (
        <div>
          <div className="text-[10px] font-bold text-amber-400 uppercase tracking-wider mb-1">Variables Changed</div>
          <div className="space-y-1">
            {changedVars.map((v) => (
              <div key={v.name + v.address} className="flex items-center gap-2 text-xs rounded-lg border border-amber-400/15 bg-amber-500/5 px-2 py-1">
                <span className="font-mono font-bold text-amber-300">{v.name}</span>
                <span className="text-slate-600">→</span>
                <span className="font-mono text-emerald-300">{String(v.value ?? "NULL")}</span>
                <span className="ml-auto text-[9px] text-slate-600">{v.type}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* New heap allocations */}
      {newHeapNodes.length > 0 && (
        <div>
          <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider mb-1">Heap Allocated</div>
          {newHeapNodes.map((n) => (
            <div key={n.address} className="text-xs rounded-lg border border-emerald-400/15 bg-emerald-500/5 px-2 py-1">
              <span className="font-mono text-emerald-300 font-bold">{n.label ?? n.address}</span>
              <span className="text-slate-600 text-[10px] ml-2">malloc() at {n.address}</span>
            </div>
          ))}
        </div>
      )}

      {/* Active pointer changes */}
      {changedPointers.length > 0 && (
        <div>
          <div className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider mb-1">Pointer Targets</div>
          <div className="space-y-1">
            {changedPointers.map((p, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[10px] font-mono">
                <span className="text-cyan-300">{p.fromLabel}</span>
                <span className="text-slate-600">→</span>
                <span className={p.toAddress ? "text-emerald-300" : "text-slate-500 font-bold"}>{p.toAddress ?? "NULL"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active nodes */}
      {activeHeap.length > 0 && (
        <div>
          <div className="text-[10px] font-bold text-violet-400 uppercase tracking-wider mb-1">Active Node</div>
          {activeHeap.map((n) => (
            <div key={n.address} className="text-xs text-slate-400">
              Processing <span className="font-mono text-violet-300">{n.label ?? n.address}</span> in the linked list.
            </div>
          ))}
        </div>
      )}

      {/* Linked list state */}
      {step.linkedList.length > 0 && (
        <div>
          <div className="text-[10px] font-bold text-blue-400 uppercase tracking-wider mb-1">List State</div>
          <div className="text-xs text-slate-400 font-mono">
            {step.linkedList.map((n, i) => (
              <span key={n.address}>
                <span className={n.isHead ? "text-cyan-300 font-bold" : n.isActive ? "text-violet-300 font-bold" : "text-slate-400"}>
                  {String(n.data)}
                </span>
                {i < step.linkedList.length - 1 ? <span className="text-slate-600"> → </span> : <span className="text-slate-600"> → NULL</span>}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main workspace ───────────────────────────────────────────────────────────
export default function CodeVisionWorkspace() {
  const [selectedProgramId, setSelectedProgramId] = useState(TRACE_PROGRAMS[0].id);
  const [stepIndex, setStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showInsight, setShowInsight] = useState(false);
  const [expandedMemory, setExpandedMemory] = useState(false);
  const [checkpoint, setCheckpoint] = useState<number | null>(null);
  const [checkpointFlash, setCheckpointFlash] = useState(false);
  const [teachMode, setTeachMode] = useState<TeachMode>("manual");
  const [gestureTriggered, setGestureTriggered] = useState(false);
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cpFlashRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const program = TRACE_PROGRAMS.find((p) => p.id === selectedProgramId) ?? TRACE_PROGRAMS[0];
  const step = program.steps[stepIndex] ?? program.steps[0];
  const totalSteps = program.steps.length;

  // All locals from all stack frames flattened for the variables panel
  const allLocals = step.stack.flatMap((f) => f.locals);

  const goTo = useCallback((idx: number) => {
    setStepIndex(Math.max(0, Math.min(idx, totalSteps - 1)));
  }, [totalSteps]);

  const stopPlay = useCallback(() => {
    setIsPlaying(false);
    if (playRef.current) { clearInterval(playRef.current); playRef.current = null; }
  }, []);

  const togglePlay = useCallback(() => {
    if (isPlaying) { stopPlay(); return; }
    if (stepIndex >= totalSteps - 1) { goTo(0); }
    setIsPlaying(true);
  }, [isPlaying, stepIndex, totalSteps, stopPlay, goTo]);

  useEffect(() => {
    if (!isPlaying) return;
    playRef.current = setInterval(() => {
      setStepIndex((prev) => {
        if (prev >= totalSteps - 1) { stopPlay(); return prev; }
        return prev + 1;
      });
    }, 1400);
    return () => { if (playRef.current) clearInterval(playRef.current); };
  }, [isPlaying, totalSteps, stopPlay]);

  const handleProgramChange = (id: string) => {
    stopPlay();
    setSelectedProgramId(id);
    setStepIndex(0);
  };

  const handleReset = () => { stopPlay(); setStepIndex(0); };

  const handleAutoRun = useCallback(() => {
    if (stepIndex >= totalSteps - 1) goTo(0);
    setIsPlaying(true);
  }, [stepIndex, totalSteps, goTo]);

  const handleSaveCheckpoint = useCallback(() => {
    setCheckpoint(stepIndex);
    setCheckpointFlash(true);
    if (cpFlashRef.current) clearTimeout(cpFlashRef.current);
    cpFlashRef.current = setTimeout(() => setCheckpointFlash(false), 2500);
  }, [stepIndex]);

  useEffect(() => {
    return () => { if (cpFlashRef.current) clearTimeout(cpFlashRef.current); };
  }, []);

  // Wrap goTo to signal gesture trigger for GemmaTutor
  const goToWithGesture = useCallback((idx: number) => {
    goTo(idx);
    if (teachMode === "gesture") setGestureTriggered(true);
  }, [goTo, teachMode]);

  return (
    <div className="flex flex-col gap-4">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-violet-600">
              <Code2 className="size-4 text-white" />
            </div>
            <span className="text-[11px] font-bold tracking-[.2em] text-cyan-300 uppercase">CODEVISION · C DEBUGGER</span>
          </div>
          <p className="text-xs text-slate-500 max-w-lg">
            Step through C programs and watch memory, the stack, and the heap change in real time.
            <span className="text-amber-400/70"> · Simulated execution for educational use.</span>
          </p>
        </div>
        {/* Teach mode selector */}
        <div className="flex items-center gap-1 rounded-xl border border-white/8 bg-[#0b0f22] p-1">
          {(["manual", "gesture", "auto"] as TeachMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setTeachMode(m)}
              className="rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider transition"
              style={{
                background: teachMode === m ? "rgba(139,92,246,0.25)" : "transparent",
                color: teachMode === m ? "#c4b5fd" : "#475569",
                border: teachMode === m ? "1px solid rgba(139,92,246,0.3)" : "1px solid transparent",
              }}
            >
              {m === "auto" ? "🤖 Auto-Teach" : m === "gesture" ? "🤌 On Gesture" : "🖱 Manual"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Program Explorer ────────────────────────────────────────── */}
      <ProgramExplorer selectedId={selectedProgramId} onSelect={handleProgramChange} />

      {/* ── Controls bar ────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-[#0b0f22] px-3 py-2">
        <button onClick={handleReset} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/8 hover:text-white transition" title="Reset"><RotateCcw className="size-4" /></button>
        <button onClick={() => goTo(stepIndex - 1)} disabled={stepIndex === 0} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/8 hover:text-white transition disabled:opacity-30" title="Step backward"><SkipBack className="size-4" /></button>
        <button
          onClick={togglePlay}
          className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition ${isPlaying ? "bg-rose-500/20 border border-rose-400/30 text-rose-200" : "bg-cyan-500/15 border border-cyan-400/30 text-cyan-200 hover:bg-cyan-500/25"}`}
        >
          {isPlaying ? "⏸ Pause" : <><Play className="size-3.5 fill-current" /> Run</>}
        </button>
        <button onClick={() => goTo(stepIndex + 1)} disabled={stepIndex >= totalSteps - 1} className="rounded-lg p-1.5 text-slate-400 hover:bg-white/8 hover:text-white transition disabled:opacity-30" title="Step forward"><SkipForward className="size-4" /></button>

        {/* Progress bar */}
        <div className="flex-1 mx-2">
          <input
            type="range"
            min={0}
            max={totalSteps - 1}
            value={stepIndex}
            onChange={(e) => { stopPlay(); goTo(Number(e.target.value)); }}
            className="w-full accent-violet-400"
            aria-label="Step slider"
          />
        </div>
        <span className="text-[11px] text-slate-400 font-mono shrink-0">
          {stepIndex + 1} / {totalSteps}
        </span>
      </div>

      {/* ── Explanation callout ──────────────────────────────────────── */}
      <div className="flex items-start gap-2 rounded-xl border border-violet-400/20 bg-violet-500/8 px-3 py-2.5">
        <Info className="size-4 text-violet-400 shrink-0 mt-0.5" />
        <p className="text-sm text-slate-300 leading-relaxed">{step.explanation}</p>
      </div>

      {/* ── Main split layout ────────────────────────────────────────── */}
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        {/* Code editor */}
        <div className="flex flex-col rounded-xl border border-white/10 bg-[#090c1c] overflow-hidden" style={{ minHeight: 380 }}>
          <div className="flex items-center gap-2 border-b border-white/8 bg-[#0c0f20] px-3 py-2 shrink-0">
            <Code2 className="size-3.5 text-slate-500" />
            <span className="text-[11px] font-semibold text-slate-400">{program.title}</span>
            <span className="ml-auto rounded bg-cyan-500/15 px-1.5 py-0.5 text-[9px] font-bold text-cyan-300 uppercase">C</span>
          </div>
          <div className="flex-1 overflow-hidden">
            <CodePanel code={program.code} activeLine={step.activeLine} highlightLines={step.highlightLines} />
          </div>
        </div>

        {/* Right panels */}
        <div className="flex flex-col gap-3">
          {/* Variables */}
          <PanelBox icon={<Cpu className="size-3.5 text-amber-300" />} title="Variables" color="amber">
            <VariablesPanel variables={allLocals} />
          </PanelBox>

          {/* Stack */}
          <PanelBox icon={<Layers className="size-3.5 text-violet-300" />} title="Call Stack" color="violet">
            <StackPanel stack={step.stack} />
          </PanelBox>
        </div>
      </div>

      {/* ── Bottom panels ─────────────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {/* Heap */}
        <PanelBox icon={<Database className="size-3.5 text-emerald-300" />} title="Heap (malloc)" color="emerald">
          <HeapPanel heap={step.heap} />
        </PanelBox>

        {/* Linked list */}
        <PanelBox icon={<ArrowRight className="size-3.5 text-cyan-300" />} title="Linked List" color="cyan" extraClass="xl:col-span-1">
          <LinkedListViz nodes={step.linkedList} />
        </PanelBox>

        {/* Pointer map */}
        <PanelBox icon={<BookOpen className="size-3.5 text-blue-300" />} title="Pointer Map" color="blue">
          <PointerViz pointers={step.pointers} />
        </PanelBox>
      </div>

      {/* ── Checkpoint + Insight bar ─────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Checkpoint */}
        <button
          onClick={handleSaveCheckpoint}
          className="flex items-center gap-1.5 rounded-xl border border-sky-400/25 bg-sky-500/8 px-3 py-1.5 text-xs font-semibold text-sky-300 hover:bg-sky-500/15 transition"
          title="Save checkpoint at current step"
        >
          <Flag className="size-3.5" /> Save Checkpoint
        </button>
        {checkpoint !== null && (
          <button
            onClick={() => goTo(checkpoint)}
            className="flex items-center gap-1.5 rounded-xl border border-sky-400/20 bg-sky-500/5 px-3 py-1.5 text-xs text-sky-400 hover:bg-sky-500/12 transition"
          >
            ↩ Return to step {checkpoint + 1}
          </button>
        )}
        {checkpointFlash && (
          <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-[10px] font-bold text-emerald-300 animate-pulse">
            ✌ CHECKPOINT SAVED — Step {(checkpoint ?? 0) + 1}
          </span>
        )}

        {/* Insight toggle */}
        <button
          onClick={() => setShowInsight((s) => !s)}
          className={`ml-auto flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
            showInsight
              ? "border-violet-400/40 bg-violet-500/15 text-violet-200"
              : "border-white/10 bg-white/4 text-slate-400 hover:bg-white/8"
          }`}
        >
          <BookOpen className="size-3.5" /> {showInsight ? "Hide" : "Show"} AI Insight
        </button>

        {/* Memory view toggle */}
        <button
          onClick={() => setExpandedMemory((m) => !m)}
          className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
            expandedMemory
              ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200"
              : "border-white/10 bg-white/4 text-slate-400 hover:bg-white/8"
          }`}
        >
          <Layers className="size-3.5" /> {expandedMemory ? "Compact" : "Expand"} Memory
        </button>
      </div>

      {/* ── AI Insight Panel ─────────────────────────────────────────── */}
      {showInsight && <AIInsightPanel step={step} programId={selectedProgramId} />}

      {/* ── Gemma 4 AI Tutor ─────────────────────────────────────────── */}
      <GemmaTutor
        step={step}
        programTitle={program.title}
        stepIndex={stepIndex}
        totalSteps={totalSteps}
        mode={teachMode}
        gestureTriggered={gestureTriggered}
        onGestureConsumed={() => setGestureTriggered(false)}
      />

      {/* ── Hand Tracking Panel ───────────────────────────────────────── */}
      <HandTrackingPanel
        onStepForward={() => goToWithGesture(stepIndex + 1)}
        onStepBackward={() => goToWithGesture(stepIndex - 1)}
        onPause={stopPlay}
        onReset={handleReset}
        onAutoRun={handleAutoRun}
        onToggleInsight={() => setShowInsight((s) => !s)}
        onToggleMemoryView={() => setExpandedMemory((m) => !m)}
        onSaveCheckpoint={handleSaveCheckpoint}
      />
    </div>
  );
}

// ─── Reusable panel box ───────────────────────────────────────────────────────
function PanelBox({
  icon, title, color, children, extraClass = "",
}: {
  icon: React.ReactNode;
  title: string;
  color: "amber" | "violet" | "emerald" | "cyan" | "blue";
  children: React.ReactNode;
  extraClass?: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const borderCls = {
    amber:   "border-amber-400/15",
    violet:  "border-violet-400/15",
    emerald: "border-emerald-400/15",
    cyan:    "border-cyan-400/15",
    blue:    "border-blue-400/15",
  }[color];

  return (
    <div className={`flex flex-col rounded-xl border ${borderCls} bg-[#090c1c] overflow-hidden ${extraClass}`}>
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center gap-2 border-b border-white/6 bg-[#0c0f20] px-3 py-2 text-left shrink-0 hover:bg-white/3 transition"
      >
        {icon}
        <span className="text-[11px] font-semibold text-slate-400">{title}</span>
        <span className="ml-auto text-slate-600">{collapsed ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />}</span>
      </button>
      {!collapsed && (
        <div className="flex-1 p-2.5 overflow-auto" style={{ minHeight: 80, maxHeight: 180 }}>
          {children}
        </div>
      )}
    </div>
  );
}
