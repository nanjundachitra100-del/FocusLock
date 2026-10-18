"use client";

import { useState, useCallback } from "react";
import { ChevronLeft, ChevronRight, Code2, GitBranch, RotateCcw, Sparkles } from "lucide-react";
import dynamic from "next/dynamic";
import type { CodeHighlight, CanvasAction } from "@/lib/ai/structured-response";
import type { SupportedLanguage } from "./LiveCodeEditor";

// Lazy-load heavy sub-components so they don't affect initial page paint
const LiveCodeEditor = dynamic(() => import("./LiveCodeEditor"), { ssr: false });
const AlgorithmVisualCanvas = dynamic(() => import("./AlgorithmVisualCanvas"), { ssr: false });

// ─── Default example shown before the AI responds ──────────────────────────
const DEFAULT_CODE = `// Ask a study question to see relevant code here.
// Example: "Explain pointers in C" or
// "Show how a linked list node is allocated with malloc."

#include <stdio.h>
#include <stdlib.h>

typedef struct Node {
    int data;
    struct Node* next;
} Node;

Node* create_node(int value) {
    Node* node = (Node*)malloc(sizeof(Node));
    if (node == NULL) return NULL;
    node->data  = value;
    node->next  = NULL;
    return node;
}

int main(void) {
    Node* head = create_node(10);
    printf("Created node with value: %d\\n", head->data);
    free(head);
    return 0;
}`;

const DEFAULT_LANGUAGE: SupportedLanguage = "c";

type Tab = "code" | "visualize";

export type LiveCodeCanvasPanelProps = {
  /** Code from the last AI response */
  code?: string | null;
  language?: string | null;
  highlights?: CodeHighlight[];
  canvasAction?: CanvasAction | null;
  isLoading?: boolean;
  /** Called when the user requests a line explanation */
  onExplainLine?: (lineNumber: number, lineText: string) => void;
  /** Called when the user requests a node explanation */
  onExplainNode?: (nodeId: string, nodeValue: string | number, type: string) => void;
  className?: string;
};

export default function LiveCodeCanvasPanel({
  code,
  language,
  highlights = [],
  canvasAction,
  isLoading = false,
  onExplainLine,
  onExplainNode,
  className = "",
}: LiveCodeCanvasPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<Tab>("code");
  const [showAddresses, setShowAddresses] = useState(false);

  const displayCode = code || DEFAULT_CODE;
  const displayLang = (language as SupportedLanguage | null) ?? DEFAULT_LANGUAGE;
  const hasCanvas = !!canvasAction && canvasAction.steps.length > 0;

  // Switch to visualize tab automatically when a new canvas arrives
  const prevCanvasRef = useState<CanvasAction | null>(null);
  if (canvasAction && canvasAction !== prevCanvasRef[0]) {
    prevCanvasRef[1](canvasAction);
    if (hasCanvas) setTab("visualize");
  }

  const handleReset = useCallback(() => {
    setTab("code");
  }, []);

  if (collapsed) {
    return (
      <div className={`flex flex-col items-center rounded-2xl border border-white/10 bg-[#0b0f22]/80 py-4 px-2 gap-4 ${className}`}>
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="rounded-lg p-2 text-violet-300 hover:bg-white/5 transition-colors"
          aria-label="Expand code panel"
          title="Expand Live Code Panel"
        >
          <ChevronLeft className="size-4" />
        </button>
        <Code2 className="size-4 text-slate-500" />
        <GitBranch className="size-4 text-slate-500" />
      </div>
    );
  }

  return (
    <div className={`flex flex-col rounded-2xl border border-white/10 bg-[#0b0f22]/80 overflow-hidden ${className}`}>
      {/* Panel header */}
      <div className="flex items-center justify-between gap-2 border-b border-white/8 bg-[#0d1128] px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex size-6 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-violet-600">
            <Code2 className="size-3.5 text-white" />
          </div>
          <span className="text-xs font-semibold text-slate-200">Live Code &amp; Visual Canvas</span>
          {isLoading && (
            <span className="flex items-center gap-1 text-[10px] text-violet-300 animate-pulse">
              <Sparkles className="size-3" /> Generating…
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleReset}
            className="rounded p-1.5 text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
            title="Reset to default example"
            aria-label="Reset"
          >
            <RotateCcw className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="rounded p-1.5 text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
            title="Collapse panel"
            aria-label="Collapse"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-white/8 bg-[#0d1128]">
        <button
          type="button"
          onClick={() => setTab("code")}
          className={`flex items-center gap-1.5 px-4 py-2 text-[11px] font-medium transition-colors border-b-2 ${
            tab === "code"
              ? "border-cyan-400 text-cyan-300"
              : "border-transparent text-slate-500 hover:text-slate-300"
          }`}
        >
          <Code2 className="size-3" /> Code
        </button>
        <button
          type="button"
          onClick={() => setTab("visualize")}
          disabled={!hasCanvas}
          className={`flex items-center gap-1.5 px-4 py-2 text-[11px] font-medium transition-colors border-b-2 disabled:opacity-30 ${
            tab === "visualize"
              ? "border-violet-400 text-violet-300"
              : "border-transparent text-slate-500 hover:text-slate-300"
          }`}
        >
          <GitBranch className="size-3" /> Visualize
          {hasCanvas && (
            <span className="ml-1 rounded-full bg-violet-500/20 px-1.5 py-0.5 text-[9px] text-violet-300">
              {canvasAction!.steps.length}
            </span>
          )}
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden p-3 flex flex-col gap-3">
        {tab === "code" && (
          <>
            {isLoading ? (
              <div className="flex h-48 items-center justify-center rounded-xl border border-white/8 bg-[#080b18]">
                <div className="text-center">
                  <div className="mx-auto mb-2 size-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
                  <p className="text-[11px] text-slate-500">Generating code…</p>
                </div>
              </div>
            ) : (
              <LiveCodeEditor
                code={displayCode}
                language={displayLang}
                highlights={highlights}
                onExplainLine={onExplainLine}
              />
            )}
          </>
        )}

        {tab === "visualize" && (
          <>
            {isLoading ? (
              <div className="flex h-48 items-center justify-center rounded-xl border border-white/8 bg-[#080b18]">
                <div className="text-center">
                  <div className="mx-auto mb-2 size-6 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
                  <p className="text-[11px] text-slate-500">Building visualization…</p>
                </div>
              </div>
            ) : hasCanvas ? (
              <>
                <AlgorithmVisualCanvas
                  canvasAction={canvasAction!}
                  showAddresses={showAddresses}
                  onNodeClick={onExplainNode}
                />
                <label className="flex cursor-pointer items-center gap-2 self-start text-[10px] text-slate-500 hover:text-slate-300 transition-colors">
                  <input
                    type="checkbox"
                    checked={showAddresses}
                    onChange={(e) => setShowAddresses(e.target.checked)}
                    className="size-3 accent-violet-400"
                  />
                  Show illustrative addresses
                </label>
              </>
            ) : (
              <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-white/10 bg-[#080b18]">
                <p className="text-[11px] text-slate-600 text-center px-6">
                  No visualization yet. Ask about a data structure or algorithm to generate one.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
