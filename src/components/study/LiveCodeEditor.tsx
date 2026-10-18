"use client";

import { useEffect, useRef, useCallback } from "react";
import { Copy, Check } from "lucide-react";
import { useState } from "react";
import type { CodeHighlight } from "@/lib/ai/structured-response";

export type SupportedLanguage =
  | "c" | "cpp" | "python" | "javascript" | "typescript" | "plaintext" | "pseudocode";

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  c: "C",
  cpp: "C++",
  python: "Python",
  javascript: "JavaScript",
  typescript: "TypeScript",
  plaintext: "Text",
  pseudocode: "Pseudocode",
};

// Very lightweight token-based syntax highlighting via regex
// Returns an array of { text, className } spans for a single line
type Token = { text: string; cls: string };

const KEYWORDS: Record<string, string[]> = {
  c:          ["int","char","float","double","void","struct","return","if","else","while","for","do","switch","case","break","continue","NULL","include","define","typedef","const","static","sizeof","malloc","free","printf","scanf"],
  cpp:        ["int","char","float","double","void","struct","class","return","if","else","while","for","do","switch","case","break","continue","nullptr","NULL","include","define","typedef","const","static","sizeof","new","delete","cout","cin","std","public","private","protected","template","auto"],
  python:     ["def","class","return","if","elif","else","while","for","in","and","or","not","None","True","False","import","from","as","pass","break","continue","lambda","with","yield","try","except","raise","finally","global","nonlocal","self"],
  javascript: ["const","let","var","function","return","if","else","while","for","of","in","class","new","null","undefined","true","false","import","export","default","async","await","try","catch","finally","typeof","instanceof","this","=>"],
  typescript: ["const","let","var","function","return","if","else","while","for","of","in","class","new","null","undefined","true","false","import","export","default","async","await","try","catch","finally","typeof","instanceof","this","type","interface","enum","extends","implements","as","keyof","readonly","=>"],
  plaintext:  [],
  pseudocode: ["BEGIN","END","IF","ELSE","THEN","WHILE","DO","FOR","RETURN","FUNCTION","PROCEDURE","INPUT","OUTPUT","AND","OR","NOT","NULL"],
};

function tokenize(line: string, lang: SupportedLanguage): Token[] {
  if (lang === "plaintext") return [{ text: line, cls: "text-slate-300" }];

  const kws = new Set((KEYWORDS[lang] ?? []).map((k) => k.toLowerCase()));
  const tokens: Token[] = [];
  let i = 0;

  while (i < line.length) {
    // Line comment
    if ((lang === "c" || lang === "cpp" || lang === "javascript" || lang === "typescript") && line[i] === "/" && line[i + 1] === "/") {
      tokens.push({ text: line.slice(i), cls: "text-slate-500 italic" });
      break;
    }
    if (lang === "python" && line[i] === "#") {
      tokens.push({ text: line.slice(i), cls: "text-slate-500 italic" });
      break;
    }
    // String literal
    if (line[i] === '"' || line[i] === "'") {
      const q = line[i];
      let j = i + 1;
      while (j < line.length && !(line[j] === q && line[j - 1] !== "\\")) j++;
      tokens.push({ text: line.slice(i, j + 1), cls: "text-emerald-300" });
      i = j + 1;
      continue;
    }
    // Number literal
    if (/[0-9]/.test(line[i])) {
      let j = i;
      while (j < line.length && /[0-9a-fA-FxX._]/.test(line[j])) j++;
      tokens.push({ text: line.slice(i, j), cls: "text-amber-300" });
      i = j;
      continue;
    }
    // Preprocessor / decorator
    if (line[i] === "#" || (lang === "python" && line[i] === "@")) {
      let j = i;
      while (j < line.length && !/\s/.test(line[j])) j++;
      tokens.push({ text: line.slice(i, j), cls: "text-violet-300" });
      i = j;
      continue;
    }
    // Identifier or keyword
    if (/[a-zA-Z_]/.test(line[i])) {
      let j = i;
      while (j < line.length && /[a-zA-Z0-9_]/.test(line[j])) j++;
      const word = line.slice(i, j);
      if (kws.has(word.toLowerCase())) {
        tokens.push({ text: word, cls: "text-cyan-300 font-semibold" });
      } else if (/^[A-Z]/.test(word)) {
        tokens.push({ text: word, cls: "text-violet-200" });
      } else {
        tokens.push({ text: word, cls: "text-slate-200" });
      }
      i = j;
      continue;
    }
    // Punctuation / operator
    if (/[{}()[\];,.<>!&|^~%+\-*=/\\]/.test(line[i])) {
      tokens.push({ text: line[i], cls: "text-slate-400" });
      i++;
      continue;
    }
    tokens.push({ text: line[i], cls: "text-slate-300" });
    i++;
  }
  return tokens;
}

export type LiveCodeEditorProps = {
  code: string;
  language?: SupportedLanguage;
  highlights?: CodeHighlight[];
  /** 1-based line number to scroll into view */
  scrollToLine?: number;
  /** Called when user requests an explanation of a line */
  onExplainLine?: (lineNumber: number, lineText: string) => void;
  className?: string;
};

export default function LiveCodeEditor({
  code,
  language = "plaintext",
  highlights = [],
  scrollToLine,
  onExplainLine,
  className = "",
}: LiveCodeEditorProps) {
  const [copied, setCopied] = useState(false);
  const [pendingLine, setPendingLine] = useState<number | null>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const lines = code.split("\n");

  // Build a set of highlighted line numbers for fast lookup
  const highlightMap = new Map<number, string>(); // lineNum -> reason
  for (const h of highlights) {
    for (let n = h.startLine; n <= h.endLine; n++) {
      highlightMap.set(n, h.reason ?? "");
    }
  }

  // Scroll to target line
  useEffect(() => {
    if (!scrollToLine || scrollToLine < 1 || scrollToLine > lines.length) return;
    const el = lineRefs.current[scrollToLine - 1];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [scrollToLine, lines.length]);

  // Also scroll to first highlighted line when highlights change
  useEffect(() => {
    if (highlights.length === 0) return;
    const first = highlights[0].startLine;
    const el = lineRefs.current[first - 1];
    if (el) {
      setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlights]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  }, [code]);

  const handleLineClick = (lineNum: number) => {
    setPendingLine(lineNum === pendingLine ? null : lineNum);
  };

  const handleExplain = () => {
    if (pendingLine === null) return;
    const lineText = lines[pendingLine - 1] ?? "";
    onExplainLine?.(pendingLine, lineText.trim());
    setPendingLine(null);
  };

  const langLabel = LANGUAGE_LABELS[language] ?? language;

  return (
    <div className={`flex flex-col rounded-xl border border-white/10 bg-[#0c0f1e] overflow-hidden ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 border-b border-white/8 bg-[#0e1225] px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="rounded bg-cyan-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-cyan-300">
            {langLabel}
          </span>
          {highlights.length > 0 && (
            <span className="text-[10px] text-violet-300">
              {highlights.length} highlight{highlights.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-slate-400 hover:bg-white/5 hover:text-slate-200 transition-colors"
          aria-label="Copy code"
        >
          {copied ? <Check className="size-3 text-emerald-400" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {/* Code area */}
      <div
        ref={containerRef}
        className="overflow-auto max-h-80 font-mono text-xs leading-6 select-text"
        style={{ scrollbarWidth: "thin", scrollbarColor: "#2a2f4e transparent" }}
      >
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, idx) => {
              const lineNum = idx + 1;
              const isHighlighted = highlightMap.has(lineNum);
              const highlightReason = highlightMap.get(lineNum) ?? "";
              const isPending = pendingLine === lineNum;
              const tokens = tokenize(line, language);

              return (
                <tr
                  key={lineNum}
                  ref={(el) => { lineRefs.current[idx] = el as HTMLDivElement | null; }}
                  onClick={() => handleLineClick(lineNum)}
                  title={isHighlighted && highlightReason ? highlightReason : undefined}
                  className={`group cursor-pointer transition-colors ${
                    isHighlighted
                      ? "bg-violet-500/10 border-l-2 border-violet-400"
                      : isPending
                      ? "bg-cyan-500/10 border-l-2 border-cyan-400"
                      : "hover:bg-white/3 border-l-2 border-transparent"
                  }`}
                  style={
                    isHighlighted
                      ? { animation: "pulse-line 1.8s ease-in-out 1" }
                      : undefined
                  }
                >
                  {/* Line number */}
                  <td className="select-none w-10 pr-3 text-right text-slate-600 group-hover:text-slate-500 align-top pt-0.5 pl-2">
                    {lineNum}
                  </td>
                  {/* Line content */}
                  <td className="pr-4 whitespace-pre align-top">
                    {tokens.map((t, ti) => (
                      <span key={ti} className={t.cls}>
                        {t.text}
                      </span>
                    ))}
                    {line === "" && "\u00a0"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Explain-line action popup */}
      {pendingLine !== null && (
        <div className="flex items-center justify-between gap-2 border-t border-white/8 bg-[#0e1225] px-3 py-2">
          <span className="text-[11px] text-slate-400">
            Line {pendingLine}:{" "}
            <span className="font-mono text-slate-300 truncate max-w-xs inline-block align-bottom">
              {(lines[pendingLine - 1] ?? "").trim().slice(0, 60)}
            </span>
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExplain}
              disabled={!onExplainLine}
              className="rounded-lg bg-cyan-500/20 px-3 py-1 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-40 transition-colors"
            >
              Explain this line
            </button>
            <button
              type="button"
              onClick={() => setPendingLine(null)}
              className="rounded-lg px-2 py-1 text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse-line {
          0%   { background-color: rgba(139,92,246,0.25); }
          60%  { background-color: rgba(139,92,246,0.10); }
          100% { background-color: rgba(139,92,246,0.10); }
        }
      `}</style>
    </div>
  );
}
