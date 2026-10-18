"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { Play, Pause, SkipBack, SkipForward, RotateCcw } from "lucide-react";
import type { CanvasAction, CanvasStep, CanvasNode } from "@/lib/ai/structured-response";

// ─── Layout constants ───────────────────────────────────────────────────────
const NODE_R = 24;
const NODE_H_SPACING = 88;
const NODE_Y = 90;
const ARRAY_CELL_W = 52;
const ARRAY_CELL_H = 44;

// ─── Color palette ──────────────────────────────────────────────────────────
const COLOR = {
  nodeFill:    "#1a1f3c",
  nodeBorder:  "#38bdf8",
  nodeActive:  "#8b5cf6",
  nodeText:    "#e2e8f0",
  edge:        "#38bdf8",
  edgeArrow:   "#38bdf8",
  label:       "#94a3b8",
  labelActive: "#c4b5fd",
  nullLabel:   "#64748b",
  headLabel:   "#34d399",
  arrayFill:   "#1a1f3c",
  arrayActive: "#7c3aed",
  arrayBorder: "#334155",
  bg:          "transparent",
};

// ─── Canvas drawing helpers ─────────────────────────────────────────────────

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number,
  x2: number, y2: number,
  color = COLOR.edge,
) {
  const headLen = 10;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle - 0.4), y2 - headLen * Math.sin(angle - 0.4));
  ctx.lineTo(x2 - headLen * Math.cos(angle + 0.4), y2 - headLen * Math.sin(angle + 0.4));
  ctx.closePath();
  ctx.fill();
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  node: CanvasNode,
  isActive: boolean,
  showAddress: boolean,
) {
  const border = isActive ? COLOR.nodeActive : COLOR.nodeBorder;
  // Circle
  ctx.beginPath();
  ctx.arc(x, y, NODE_R, 0, Math.PI * 2);
  ctx.fillStyle = isActive ? "#2e1b5e" : COLOR.nodeFill;
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = isActive ? 2.5 : 1.5;
  ctx.stroke();

  // Value
  ctx.fillStyle = COLOR.nodeText;
  ctx.font = `bold 13px ui-monospace, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(node.value), x, y);

  // Address label (illustrative only)
  if (showAddress && node.addressLabel) {
    ctx.fillStyle = "#475569";
    ctx.font = "9px ui-monospace, monospace";
    ctx.fillText(node.addressLabel, x, y + NODE_R + 12);
  }
}

function drawLinkedList(
  ctx: CanvasRenderingContext2D,
  step: CanvasStep,
  w: number,
  activeIds: Set<string>,
  showAddresses: boolean,
) {
  const nodes = step.nodes.slice(0, 10);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const positions = new Map<string, { x: number; y: number }>();

  // Lay out in order following `next` chain from first node
  const visited = new Set<string>();
  let cur: CanvasNode | undefined = nodes[0];
  let xi = 40 + NODE_R;
  while (cur && !visited.has(cur.id)) {
    visited.add(cur.id);
    positions.set(cur.id, { x: xi, y: NODE_Y });
    xi += NODE_H_SPACING;
    cur = cur.next ? nodeMap.get(cur.next) : undefined;
  }
  // Any remaining nodes (disconnected)
  for (const n of nodes) {
    if (!positions.has(n.id)) {
      positions.set(n.id, { x: xi, y: NODE_Y });
      xi += NODE_H_SPACING;
    }
  }

  // Draw "head" label
  const firstPos = positions.get(nodes[0]?.id ?? "");
  if (firstPos) {
    ctx.fillStyle = COLOR.headLabel;
    ctx.font = "bold 10px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("head", firstPos.x, firstPos.y - NODE_R - 18);
    drawArrow(ctx, firstPos.x, firstPos.y - NODE_R - 8, firstPos.x, firstPos.y - NODE_R - 1, COLOR.headLabel);
  }

  // Draw edges (arrows between nodes)
  for (const edge of step.edges) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (from && to) {
      drawArrow(ctx, from.x + NODE_R, from.y, to.x - NODE_R, to.y);
    }
  }

  // NULL terminal
  const lastId = nodes[nodes.length - 1]?.id ?? "";
  const lastPos = positions.get(lastId);
  if (lastPos) {
    const nx = lastPos.x + NODE_R + 30;
    ctx.strokeStyle = COLOR.nullLabel;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(lastPos.x + NODE_R, lastPos.y);
    ctx.lineTo(nx, lastPos.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COLOR.nullLabel;
    ctx.font = "bold 10px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText("NULL", nx + 4, lastPos.y + 4);
  }

  // Draw nodes (on top of arrows)
  for (const node of nodes) {
    const pos = positions.get(node.id);
    if (!pos) continue;
    drawNode(ctx, pos.x, pos.y, node, activeIds.has(node.id), showAddresses);
  }

  // Node id labels below
  for (const node of nodes) {
    const pos = positions.get(node.id);
    if (!pos) continue;
    if (node.id !== String(node.value)) {
      ctx.fillStyle = activeIds.has(node.id) ? COLOR.labelActive : COLOR.label;
      ctx.font = "9px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(node.id, pos.x, pos.y + NODE_R + (showAddresses && node.addressLabel ? 24 : 14));
    }
  }

  return w; // satisfy return
}

function drawArray(
  ctx: CanvasRenderingContext2D,
  step: CanvasStep,
  w: number,
) {
  const nodes = step.nodes.slice(0, 20);
  const activeSet = new Set(step.activeNodeIds ?? []);
  const activeIdx = new Set(step.activeIndices ?? []);
  const totalW = nodes.length * ARRAY_CELL_W;
  const startX = Math.max(20, (w - totalW) / 2);
  const y = 60;

  for (let i = 0; i < nodes.length; i++) {
    const x = startX + i * ARRAY_CELL_W;
    const isActive = activeSet.has(nodes[i].id) || activeIdx.has(i);
    ctx.fillStyle = isActive ? COLOR.arrayActive : COLOR.arrayFill;
    ctx.strokeStyle = isActive ? "#a78bfa" : COLOR.arrayBorder;
    ctx.lineWidth = isActive ? 2 : 1;
    ctx.beginPath();
    ctx.roundRect?.(x, y, ARRAY_CELL_W - 2, ARRAY_CELL_H, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = COLOR.nodeText;
    ctx.font = "bold 13px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(nodes[i].value), x + (ARRAY_CELL_W - 2) / 2, y + ARRAY_CELL_H / 2);

    // Index label
    ctx.fillStyle = COLOR.label;
    ctx.font = "9px ui-monospace, monospace";
    ctx.fillText(String(i), x + (ARRAY_CELL_W - 2) / 2, y + ARRAY_CELL_H + 14);
  }
}

function drawBinaryTree(
  ctx: CanvasRenderingContext2D,
  step: CanvasStep,
  w: number,
  activeIds: Set<string>,
) {
  const nodes = step.nodes.slice(0, 31);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const positions = new Map<string, { x: number; y: number }>();

  // BFS layout
  const root = nodes[0];
  if (!root) return;
  type QItem = { id: string; depth: number; pos: number; spread: number };
  const queue: QItem[] = [{ id: root.id, depth: 0, pos: w / 2, spread: w / 3 }];
  while (queue.length > 0) {
    const item = queue.shift()!;
    const n = nodeMap.get(item.id);
    if (!n || positions.has(item.id)) continue;
    const y = 40 + item.depth * 70;
    positions.set(item.id, { x: item.pos, y });
    const childSpread = item.spread * 0.55;
    if (n.left) queue.push({ id: n.left, depth: item.depth + 1, pos: item.pos - item.spread / 2, spread: childSpread });
    if (n.right) queue.push({ id: n.right, depth: item.depth + 1, pos: item.pos + item.spread / 2, spread: childSpread });
  }

  // Edges
  for (const n of nodes) {
    const from = positions.get(n.id);
    if (!from) continue;
    for (const childId of [n.left, n.right]) {
      if (!childId) continue;
      const to = positions.get(childId);
      if (to) {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const ux = dx / dist, uy = dy / dist;
        drawArrow(
          ctx,
          from.x + ux * NODE_R, from.y + uy * NODE_R,
          to.x - ux * NODE_R, to.y - uy * NODE_R,
        );
      }
    }
  }

  // Nodes
  for (const n of nodes) {
    const pos = positions.get(n.id);
    if (!pos) continue;
    drawNode(ctx, pos.x, pos.y, n, activeIds.has(n.id), false);
  }
}

// ─── Main component ─────────────────────────────────────────────────────────

export type AlgorithmVisualCanvasProps = {
  canvasAction: CanvasAction;
  showAddresses?: boolean;
  onNodeClick?: (nodeId: string, nodeValue: string | number, type: string) => void;
  className?: string;
};

export default function AlgorithmVisualCanvas({
  canvasAction,
  showAddresses = false,
  onNodeClick,
  className = "",
}: AlgorithmVisualCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const steps = canvasAction.steps;
  const totalSteps = steps.length;
  const currentStep = steps[Math.min(stepIndex, totalSteps - 1)] ?? steps[0];

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || !currentStep) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = container.clientWidth;
    const h = container.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const activeIds = new Set(currentStep.activeNodeIds ?? []);
    const type = canvasAction.type;

    if (type === "linked_list" || type === "doubly_linked_list" || type === "pointers" || type === "stack" || type === "queue") {
      drawLinkedList(ctx, currentStep, w, activeIds, showAddresses);
    } else if (type === "array" || type === "sorting" || type === "search") {
      drawArray(ctx, currentStep, w);
    } else if (type === "binary_tree" || type === "recursion_tree") {
      drawBinaryTree(ctx, currentStep, w, activeIds);
    } else {
      // Generic: fall back to linked-list layout
      drawLinkedList(ctx, currentStep, w, activeIds, showAddresses);
    }
  }, [currentStep, canvasAction.type, showAddresses]);

  // Redraw on step change or resize
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  // Resize observer
  useEffect(() => {
    const obs = new ResizeObserver(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(draw);
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [draw]);

  // Auto-play
  useEffect(() => {
    if (playing) {
      playIntervalRef.current = setInterval(() => {
        setStepIndex((prev) => {
          if (prev >= totalSteps - 1) {
            setPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 1200);
    } else {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    }
    return () => { if (playIntervalRef.current) clearInterval(playIntervalRef.current); };
  }, [playing, totalSteps]);

  // Reset when canvasAction changes
  useEffect(() => {
    setStepIndex(0);
    setPlaying(false);
  }, [canvasAction]);

  // Click detection for node explain
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!onNodeClick || !currentStep) return;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      // Hit-test nodes (approximate circle check)
      const nodes = currentStep.nodes.slice(0, 16);
      const w = rect.width;
      const nodeMap = new Map(nodes.map((n) => [n.id, n]));
      const positions = new Map<string, { x: number; y: number }>();

      if (
        canvasAction.type === "linked_list" ||
        canvasAction.type === "doubly_linked_list" ||
        canvasAction.type === "pointers" ||
        canvasAction.type === "stack" ||
        canvasAction.type === "queue"
      ) {
        let xi = 40 + NODE_R;
        const visited = new Set<string>();
        let cur: CanvasNode | undefined = nodes[0];
        while (cur && !visited.has(cur.id)) {
          visited.add(cur.id);
          positions.set(cur.id, { x: xi, y: NODE_Y });
          xi += NODE_H_SPACING;
          cur = cur.next ? nodeMap.get(cur.next) : undefined;
        }
      } else if (canvasAction.type === "array" || canvasAction.type === "sorting" || canvasAction.type === "search") {
        const totalW = nodes.length * ARRAY_CELL_W;
        const startX = Math.max(20, (w - totalW) / 2);
        nodes.forEach((n, i) => {
          positions.set(n.id, { x: startX + i * ARRAY_CELL_W + ARRAY_CELL_W / 2, y: 60 + ARRAY_CELL_H / 2 });
        });
      }

      for (const [id, pos] of positions) {
        const dx = cx - pos.x, dy = cy - pos.y;
        if (Math.sqrt(dx * dx + dy * dy) <= NODE_R + 4) {
          const node = nodeMap.get(id);
          if (node) onNodeClick(id, node.value, canvasAction.type);
          return;
        }
      }
    },
    [currentStep, canvasAction.type, onNodeClick],
  );

  return (
    <div className={`flex flex-col rounded-xl border border-white/10 bg-[#0c0f1e] overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-white/8 bg-[#0e1225] px-3 py-2">
        <span className="text-[11px] font-semibold text-cyan-300 truncate">{canvasAction.title}</span>
        <span className="text-[10px] text-slate-500 shrink-0">
          {canvasAction.type.replace("_", " ")}
        </span>
      </div>

      {/* Canvas */}
      <div ref={containerRef} className="relative h-48 w-full bg-[#080b18]">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 cursor-pointer"
          onClick={handleCanvasClick}
          aria-label={`${canvasAction.title} visualization`}
        />
        {onNodeClick && (
          <div className="pointer-events-none absolute bottom-2 right-2 text-[9px] text-slate-600">
            Click a node to explain
          </div>
        )}
      </div>

      {/* Step description */}
      <div className="min-h-8 px-3 py-2 text-[11px] text-slate-300 border-t border-white/5 bg-[#0a0d1a]">
        {currentStep?.description || "\u00a0"}
      </div>

      {/* Playback controls */}
      {totalSteps > 1 && (
        <div className="flex items-center gap-2 border-t border-white/8 bg-[#0e1225] px-3 py-2">
          <button
            type="button"
            onClick={() => { setStepIndex(0); setPlaying(false); }}
            className="rounded p-1 text-slate-400 hover:text-white transition-colors"
            aria-label="Reset"
          >
            <RotateCcw className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setStepIndex((p) => Math.max(0, p - 1))}
            disabled={stepIndex === 0}
            className="rounded p-1 text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
            aria-label="Previous step"
          >
            <SkipBack className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            disabled={stepIndex >= totalSteps - 1 && !playing}
            className="rounded-lg bg-violet-500/20 px-3 py-1 text-[11px] font-semibold text-violet-200 hover:bg-violet-500/30 disabled:opacity-30 transition-colors"
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? <Pause className="size-3 inline" /> : <Play className="size-3 inline" />}
            <span className="ml-1">{playing ? "Pause" : "Play"}</span>
          </button>
          <button
            type="button"
            onClick={() => setStepIndex((p) => Math.min(totalSteps - 1, p + 1))}
            disabled={stepIndex >= totalSteps - 1}
            className="rounded p-1 text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
            aria-label="Next step"
          >
            <SkipForward className="size-3.5" />
          </button>
          <span className="ml-auto text-[10px] text-slate-500 font-mono">
            {stepIndex + 1} / {totalSteps}
          </span>
        </div>
      )}
    </div>
  );
}
