/**
 * Shared types for the structured study-assistant response contract.
 * Both the API route (server) and frontend components import from here.
 */

export interface CodeHighlight {
  startLine: number; // 1-based
  endLine: number;   // 1-based, inclusive
  reason?: string;
}

// ─── Canvas action types ───────────────────────────────────────────────────

export interface CanvasNode {
  id: string;
  value: string | number;
  /** id of the next node for linked-list edges */
  next?: string | null;
  /** id of a previous node (doubly-linked) */
  prev?: string | null;
  /** id of left child (tree) */
  left?: string | null;
  /** id of right child (tree) */
  right?: string | null;
  /** illustrative memory address label — NOT a real address */
  addressLabel?: string;
}

export interface CanvasEdge {
  from: string;
  to: string;
  label?: string;
}

export interface CanvasStep {
  description: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  activeNodeIds?: string[];
  /** For arrays: highlight these indices */
  activeIndices?: number[];
}

export type CanvasType =
  | "linked_list"
  | "doubly_linked_list"
  | "array"
  | "stack"
  | "queue"
  | "binary_tree"
  | "recursion_tree"
  | "sorting"
  | "search"
  | "pointers";

export interface CanvasAction {
  type: CanvasType;
  title: string;
  steps: CanvasStep[];
}

// ─── Full structured response ──────────────────────────────────────────────

export interface StructuredStudyResponse {
  answer: string;
  language?: string;
  code?: string;
  highlights?: CodeHighlight[];
  canvasAction?: CanvasAction;
}

// ─── Parse helpers ─────────────────────────────────────────────────────────

function isCanvasNode(v: unknown): v is CanvasNode {
  return typeof v === "object" && v !== null && "id" in v && "value" in v;
}

function isCanvasStep(v: unknown): v is CanvasStep {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return typeof s.description === "string" && Array.isArray(s.nodes);
}

function isCanvasAction(v: unknown): v is CanvasAction {
  if (typeof v !== "object" || v === null) return false;
  const a = v as Record<string, unknown>;
  return typeof a.type === "string" && typeof a.title === "string" && Array.isArray(a.steps);
}

/**
 * Attempt to parse a structured response from raw model text.
 * Returns null if the text is not valid JSON or does not contain an `answer` field.
 * Never throws.
 */
export function parseStructuredResponse(raw: string): StructuredStudyResponse | null {
  if (!raw.trim()) return null;

  // Strip markdown code fences if present
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    // Try to find a JSON object anywhere in the text (model sometimes adds preamble)
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.answer !== "string" || !obj.answer.trim()) return null;

  const result: StructuredStudyResponse = { answer: obj.answer.trim() };

  if (typeof obj.language === "string") result.language = obj.language;
  if (typeof obj.code === "string") result.code = obj.code;

  if (Array.isArray(obj.highlights)) {
    result.highlights = (obj.highlights as unknown[])
      .filter(
        (h): h is CodeHighlight =>
          typeof h === "object" &&
          h !== null &&
          typeof (h as Record<string, unknown>).startLine === "number" &&
          typeof (h as Record<string, unknown>).endLine === "number",
      )
      .map((h) => ({
        startLine: Math.max(1, Math.floor((h as CodeHighlight).startLine)),
        endLine: Math.max(1, Math.floor((h as CodeHighlight).endLine)),
        reason: typeof (h as CodeHighlight).reason === "string" ? (h as CodeHighlight).reason : undefined,
      }));
  }

  if (isCanvasAction(obj.canvasAction)) {
    const ca = obj.canvasAction as unknown as Record<string, unknown>;
    const steps = (Array.isArray(ca.steps) ? ca.steps : [])
      .filter(isCanvasStep)
      .slice(0, 30) // safety cap
      .map((s) => {
        const step = s as unknown as Record<string, unknown>;
        return {
          description: String(step.description ?? ""),
          nodes: (Array.isArray(step.nodes) ? step.nodes : []).filter(isCanvasNode).slice(0, 64),
          edges: Array.isArray(step.edges)
            ? (step.edges as unknown[]).filter(
                (e): e is CanvasEdge =>
                  typeof e === "object" &&
                  e !== null &&
                  typeof (e as Record<string, unknown>).from === "string" &&
                  typeof (e as Record<string, unknown>).to === "string",
              )
            : [],
          activeNodeIds: Array.isArray(step.activeNodeIds)
            ? (step.activeNodeIds as unknown[]).filter((x): x is string => typeof x === "string")
            : [],
          activeIndices: Array.isArray(step.activeIndices)
            ? (step.activeIndices as unknown[]).filter((x): x is number => typeof x === "number")
            : [],
        } satisfies CanvasStep;
      });

    result.canvasAction = {
      type: ca.type as CanvasType,
      title: String(ca.title ?? ""),
      steps,
    };
  }

  return result;
}
