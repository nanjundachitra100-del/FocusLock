"use client";

import { useState, useMemo } from "react";
import { Search, ChevronRight, ChevronDown, Code2 } from "lucide-react";
import { TRACE_PROGRAMS } from "@/lib/codevision/trace-engine";

// ─── Extended program catalogue ───────────────────────────────────────────────
// Programs with traces come from TRACE_PROGRAMS.
// Additional catalogue entries are listed here for search/browse but open
// with a "visualization not available" notice when selected.

export interface ProgramEntry {
  id: string;
  title: string;
  category: string;
  keywords: string[];
  hasTrace: boolean;
  description: string;
}

const CATEGORIES = [
  "All",
  "Arrays",
  "Pointers",
  "Linked Lists",
  "Sorting",
  "Recursion",
  "Stacks & Queues",
  "Trees",
  "C Fundamentals",
] as const;

export const PROGRAM_CATALOGUE: ProgramEntry[] = [
  // ── Traced programs (from trace-engine) ──
  {
    id: "array-traversal",
    title: "Array Traversal",
    category: "Arrays",
    keywords: ["array", "loop", "sum", "index", "for"],
    hasTrace: true,
    description: "Iterate over an integer array and compute the sum.",
  },
  {
    id: "pointer-modification",
    title: "Pointer Modification",
    category: "Pointers",
    keywords: ["pointer", "dereference", "address", "function", "pass by reference"],
    hasTrace: true,
    description: "Modify a variable through a pointer, including inside a function.",
  },
  {
    id: "linked-list-insertion",
    title: "Linked List Insertion",
    category: "Linked Lists",
    keywords: ["linked list", "node", "malloc", "next", "head", "traverse"],
    hasTrace: true,
    description: "Build a singly linked list with malloc and traverse it.",
  },
  // ── Browse-only entries (no trace) ──
  {
    id: "bubble-sort",
    title: "Bubble Sort",
    category: "Sorting",
    keywords: ["sort", "bubble", "swap", "array", "comparison"],
    hasTrace: false,
    description: "Classic O(n²) sorting algorithm with adjacent element swaps.",
  },
  {
    id: "binary-search",
    title: "Binary Search",
    category: "Arrays",
    keywords: ["search", "binary", "sorted", "mid", "low", "high"],
    hasTrace: false,
    description: "O(log n) search on a sorted array.",
  },
  {
    id: "factorial-recursive",
    title: "Factorial (Recursive)",
    category: "Recursion",
    keywords: ["factorial", "recursion", "recursive", "base case", "call stack"],
    hasTrace: false,
    description: "Classic recursion example with call stack growth.",
  },
  {
    id: "stack-push-pop",
    title: "Stack Push & Pop",
    category: "Stacks & Queues",
    keywords: ["stack", "push", "pop", "LIFO", "array"],
    hasTrace: false,
    description: "Implement a stack using an array with push and pop operations.",
  },
  {
    id: "fibonacci",
    title: "Fibonacci Sequence",
    category: "Recursion",
    keywords: ["fibonacci", "recursion", "loop", "sequence"],
    hasTrace: false,
    description: "Generate Fibonacci numbers iteratively and recursively.",
  },
  {
    id: "pointer-arithmetic",
    title: "Pointer Arithmetic",
    category: "Pointers",
    keywords: ["pointer", "arithmetic", "increment", "array", "address"],
    hasTrace: false,
    description: "Navigate an array using pointer arithmetic.",
  },
  {
    id: "doubly-linked-list",
    title: "Doubly Linked List",
    category: "Linked Lists",
    keywords: ["doubly linked list", "prev", "next", "bidirectional"],
    hasTrace: false,
    description: "Build and traverse a doubly linked list.",
  },
  {
    id: "hello-world",
    title: "Hello World",
    category: "C Fundamentals",
    keywords: ["hello", "printf", "main", "basic", "beginner"],
    hasTrace: false,
    description: "The simplest C program — output a string to the console.",
  },
  {
    id: "swap-variables",
    title: "Swap Variables",
    category: "C Fundamentals",
    keywords: ["swap", "temp", "variable", "exchange"],
    hasTrace: false,
    description: "Swap two integers using a temporary variable or XOR trick.",
  },
];

export interface ProgramExplorerProps {
  selectedId: string;
  onSelect: (id: string) => void;
}

export default function ProgramExplorer({ selectedId, onSelect }: ProgramExplorerProps) {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [expanded, setExpanded] = useState(true);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return PROGRAM_CATALOGUE.filter((p) => {
      const matchesCategory = selectedCategory === "All" || p.category === selectedCategory;
      const matchesSearch =
        !q ||
        p.title.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.keywords.some((k) => k.includes(q)) ||
        p.category.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [search, selectedCategory]);

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: "1px solid rgba(6,182,212,0.15)", background: "#060911" }}
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left transition hover:bg-white/3"
        style={{ borderBottom: expanded ? "1px solid rgba(6,182,212,0.1)" : "none", background: "rgba(6,182,212,0.04)" }}
      >
        <Code2 className="size-3.5" style={{ color: "#22d3ee" }} />
        <span className="text-[11px] font-bold tracking-widest" style={{ color: "#22d3ee" }}>PROGRAM EXPLORER</span>
        <span className="ml-auto" style={{ color: "#475569" }}>
          {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </span>
      </button>

      {expanded && (
        <div className="p-2 space-y-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2 size-3 pointer-events-none" style={{ color: "#475569" }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search programs…"
              className="w-full rounded-lg border border-white/8 bg-white/3 pl-7 pr-3 py-1.5 text-[11px] text-white placeholder-slate-700 outline-none focus:border-cyan-400/50"
            />
          </div>

          {/* Category pills */}
          <div className="flex flex-wrap gap-1">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className="rounded-full px-2 py-0.5 text-[9px] font-semibold transition"
                style={{
                  border: selectedCategory === cat ? "1px solid rgba(6,182,212,0.5)" : "1px solid rgba(255,255,255,0.06)",
                  background: selectedCategory === cat ? "rgba(6,182,212,0.12)" : "rgba(255,255,255,0.02)",
                  color: selectedCategory === cat ? "#22d3ee" : "#475569",
                }}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Program list */}
          <div className="space-y-0.5 max-h-64 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
            {filtered.length === 0 && (
              <p className="text-center text-[10px] py-4" style={{ color: "#334155" }}>No programs match your search.</p>
            )}
            {filtered.map((p) => {
              const isSelected = selectedId === p.id;
              const isTraceable = p.hasTrace || TRACE_PROGRAMS.some((t) => t.id === p.id);
              return (
                <button
                  key={p.id}
                  onClick={() => onSelect(p.id)}
                  className="w-full flex items-start gap-2 rounded-lg px-2.5 py-2 text-left transition"
                  style={{
                    border: isSelected ? "1px solid rgba(6,182,212,0.35)" : "1px solid transparent",
                    background: isSelected ? "rgba(6,182,212,0.08)" : "transparent",
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-semibold truncate" style={{ color: isSelected ? "#22d3ee" : "#94a3b8" }}>
                        {p.title}
                      </span>
                      {!isTraceable && (
                        <span className="rounded px-1 text-[8px] shrink-0" style={{ background: "rgba(245,158,11,0.1)", color: "#d97706" }}>
                          no viz
                        </span>
                      )}
                    </div>
                    <div className="text-[9px] mt-0.5 truncate" style={{ color: "#334155" }}>{p.category}</div>
                  </div>
                  {isSelected && <ChevronRight className="size-3 shrink-0 mt-0.5" style={{ color: "#22d3ee" }} />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
