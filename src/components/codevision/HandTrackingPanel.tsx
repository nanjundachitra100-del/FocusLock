"use client";

/**
 * HandTrackingPanel — FocusLock CodeVision AI Hand Control
 *
 * MediaPipe Tasks Vision loaded from CDN at runtime — no build-time install.
 * All processing is local. No video data leaves the device.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Camera, CameraOff, Hand, Zap, AlertCircle, Loader2,
  BookOpen, Layers, Flag, ChevronDown, ChevronUp,
} from "lucide-react";

// ─── MediaPipe types ──────────────────────────────────────────────────────────
interface Landmark { x: number; y: number; z: number }
interface HandLandmarkerResult {
  landmarks: Landmark[][];
  worldLandmarks: Landmark[][];
  handedness: Array<Array<{ score: number; index: number; categoryName: string; displayName: string }>>;
}
interface HandLandmarker {
  detectForVideo(video: HTMLVideoElement, timestamp: number): HandLandmarkerResult;
  close(): void;
}
interface HandLandmarkerOptions {
  baseOptions: { modelAssetPath: string; delegate?: string };
  runningMode: "VIDEO";
  numHands?: number;
  minHandDetectionConfidence?: number;
  minHandPresenceConfidence?: number;
  minTrackingConfidence?: number;
}

// ─── CDN config ───────────────────────────────────────────────────────────────
const MP_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MP_PKG = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// ─── Hand connections ─────────────────────────────────────────────────────────
const CONNECTIONS: [number, number][] = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17],
];

// ─── Gesture types ────────────────────────────────────────────────────────────
export type Gesture =
  | "index_up"      // step forward
  | "two_up"        // step backward / left
  | "three_up"      // toggle memory view
  | "open_palm"     // pause
  | "fist"          // reset (hold)
  | "thumbs_up"     // auto-run
  | "thumbs_down"   // stop
  | "point_left"    // prev step
  | "point_right"   // next step
  | "pinch"         // toggle insight
  | "v_sign"        // checkpoint
  | "none";

// ─── Gesture metadata ─────────────────────────────────────────────────────────
export const GESTURE_META: Record<Gesture, { label: string; icon: string; action: string; howTo: string }> = {
  index_up:    { label: "Index Up",      icon: "☝",  action: "Step Forward",      howTo: "Raise only index finger" },
  two_up:      { label: "Two Up",        icon: "✌",  action: "Step Backward",     howTo: "Raise index + middle finger" },
  three_up:    { label: "Three Up",      icon: "🤟", action: "Toggle Memory View", howTo: "Raise index, middle & ring" },
  open_palm:   { label: "Open Palm",     icon: "🖐",  action: "Pause Auto-Run",    howTo: "Show all four fingers" },
  fist:        { label: "Fist (Hold)",   icon: "✊",  action: "Reset Execution",   howTo: "Close fist for ~1 second" },
  thumbs_up:   { label: "Thumbs Up",     icon: "👍", action: "Auto-Run",          howTo: "Extend thumb up, curl fingers" },
  thumbs_down: { label: "Thumbs Down",   icon: "👎", action: "Stop / Pause",      howTo: "Point thumb down, curl fingers" },
  point_left:  { label: "Point Left",    icon: "👈", action: "Previous Step",     howTo: "Index finger pointing left" },
  point_right: { label: "Point Right",   icon: "👉", action: "Next Step",         howTo: "Index finger pointing right" },
  pinch:       { label: "Pinch",         icon: "🤌", action: "Toggle AI Insight", howTo: "Pinch thumb & index close" },
  v_sign:      { label: "V Sign",        icon: "✌",  action: "Save Checkpoint",   howTo: "V shape, hand tilted" },
  none:        { label: "—",             icon: "—",  action: "—",                 howTo: "—" },
};

// ─── Gesture detection ────────────────────────────────────────────────────────
function isFingerExtended(lm: Landmark[], tipIdx: number, baseIdx: number): boolean {
  return lm[tipIdx].y < lm[baseIdx].y - 0.04;
}

function isCurled(lm: Landmark[], tipIdx: number, mcpIdx: number): boolean {
  return lm[tipIdx].y > lm[mcpIdx].y + 0.02;
}

function detectGesture(lm: Landmark[]): Gesture {
  if (!lm || lm.length < 21) return "none";

  const indexUp  = isFingerExtended(lm, 8, 6);
  const middleUp = isFingerExtended(lm, 12, 10);
  const ringUp   = isFingerExtended(lm, 16, 14);
  const pinkyUp  = isFingerExtended(lm, 20, 18);

  const indexCurled  = isCurled(lm, 8, 5);
  const middleCurled = isCurled(lm, 12, 9);
  const ringCurled   = isCurled(lm, 16, 13);
  const pinkyCurled  = isCurled(lm, 20, 17);

  // Thumb: compare tip x vs ip joint x (accounts for mirroring)
  const thumbTipX = lm[4].x;
  const thumbIpX  = lm[3].x;
  const thumbMcpX = lm[2].x;
  // Thumb up: tip above ip and mcp in y
  const thumbUp   = lm[4].y < lm[3].y - 0.06 && lm[4].y < lm[2].y - 0.06;
  // Thumb down: tip below ip and mcp in y
  const thumbDown = lm[4].y > lm[3].y + 0.06 && lm[4].y > lm[2].y + 0.06;
  const thumbSide = Math.abs(thumbTipX - thumbIpX) > 0.06; // extended sideways

  const extCount = [indexUp, middleUp, ringUp, pinkyUp].filter(Boolean).length;

  // Priority order — most specific first to avoid misclassification

  // Fist: all curled
  if (indexCurled && middleCurled && ringCurled && pinkyCurled && !thumbUp) return "fist";

  // Thumbs up: only thumb up, all fingers curled
  if (thumbUp && indexCurled && middleCurled && ringCurled && pinkyCurled) return "thumbs_up";

  // Thumbs down: only thumb down, all fingers curled
  if (thumbDown && indexCurled && middleCurled && ringCurled && pinkyCurled) return "thumbs_down";

  // Pinch: index and thumb close together, others curled/neutral
  const pinchDist = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
  if (pinchDist < 0.07 && middleCurled && ringCurled && pinkyCurled) return "pinch";

  // Open palm: all 4 fingers up
  if (extCount === 4) return "open_palm";

  // Three up: index + middle + ring, no pinky
  if (indexUp && middleUp && ringUp && !pinkyUp) return "three_up";

  // Two up: index + middle only
  if (indexUp && middleUp && !ringUp && !pinkyUp) {
    // Distinguish V-sign (fingers spread wide) vs two_up (fingers close)
    const spread = Math.abs(lm[8].x - lm[12].x);
    if (spread > 0.09) return "v_sign";
    return "two_up";
  }

  // Index only up
  if (indexUp && !middleUp && !ringUp && !pinkyUp) {
    // Pointing left/right: check horizontal direction of index tip vs mcp
    const dx = lm[8].x - lm[5].x; // mirrored, so positive dx = pointing left in mirror
    if (Math.abs(dx) > 0.12 && Math.abs(lm[8].y - lm[5].y) < 0.08) {
      return dx > 0 ? "point_left" : "point_right";
    }
    return "index_up";
  }

  // Thumb extended sideways (not up/down), all fingers curled — ambiguous, skip
  if (thumbSide && indexCurled && middleCurled) return "none";

  return "none";
}

// ─── Canvas drawing ───────────────────────────────────────────────────────────
const GESTURE_GLOW_COLORS: Partial<Record<Gesture, string>> = {
  thumbs_up:   "#22c55e",
  thumbs_down: "#f43f5e",
  open_palm:   "#f59e0b",
  fist:        "#ef4444",
  pinch:       "#a78bfa",
  v_sign:      "#38bdf8",
  three_up:    "#8b5cf6",
  index_up:    "#38bdf8",
  two_up:      "#60a5fa",
  point_left:  "#06b6d4",
  point_right: "#06b6d4",
};

function drawLandmarks(
  ctx: CanvasRenderingContext2D,
  lm: Landmark[],
  w: number,
  h: number,
  gesture: Gesture,
) {
  const px = (l: Landmark) => ({ x: (1 - l.x) * w, y: l.y * h });
  const accentColor = GESTURE_GLOW_COLORS[gesture] ?? "rgba(56,189,248,0.55)";

  // Grid overlay (subtle)
  ctx.strokeStyle = "rgba(56,189,248,0.04)";
  ctx.lineWidth = 0.5;
  for (let gx = 0; gx < w; gx += 40) {
    ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
  }
  for (let gy = 0; gy < h; gy += 40) {
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
  }

  // Bounding box glow around hand
  const xs = lm.map((l) => (1 - l.x) * w);
  const ys = lm.map((l) => l.y * h);
  const minX = Math.min(...xs) - 12, maxX = Math.max(...xs) + 12;
  const minY = Math.min(...ys) - 12, maxY = Math.max(...ys) + 12;
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1;
  ctx.shadowColor = accentColor;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.roundRect(minX, minY, maxX - minX, maxY - minY, 8);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Connections
  ctx.strokeStyle = gesture !== "none" ? accentColor : "rgba(56,189,248,0.45)";
  ctx.lineWidth = 1.5;
  ctx.shadowColor = gesture !== "none" ? accentColor : "rgba(56,189,248,0.3)";
  ctx.shadowBlur = 4;
  for (const [a, b] of CONNECTIONS) {
    const pa = px(lm[a]), pb = px(lm[b]);
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
  }
  ctx.shadowBlur = 0;

  // Landmark dots
  const tips = new Set([4, 8, 12, 16, 20]);
  const wrist = new Set([0]);
  for (let i = 0; i < lm.length; i++) {
    const p = px(lm[i]);
    const isTip = tips.has(i);
    const isWrist = wrist.has(i);
    const r = isTip ? 5.5 : isWrist ? 4 : 2.5;
    const color = isTip ? (gesture !== "none" ? accentColor : "#38bdf8") : "#7dd3fc";
    ctx.shadowColor = color;
    ctx.shadowBlur = isTip ? 14 : 5;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.shadowBlur = 0;
}

// ─── AI status labels ─────────────────────────────────────────────────────────
type AIStatus = "CAMERA_DISABLED" | "INITIALIZING" | "SEARCHING" | "HAND_DETECTED" | "GESTURE_RECOGNIZED" | "ERROR";

const AI_STATUS_STYLES: Record<AIStatus, string> = {
  CAMERA_DISABLED:    "text-slate-600 border-slate-600/20 bg-slate-600/5",
  INITIALIZING:       "text-amber-300 border-amber-400/30 bg-amber-500/8",
  SEARCHING:          "text-cyan-400 border-cyan-400/30 bg-cyan-500/8",
  HAND_DETECTED:      "text-emerald-300 border-emerald-400/30 bg-emerald-500/8",
  GESTURE_RECOGNIZED: "text-violet-300 border-violet-400/30 bg-violet-500/8",
  ERROR:              "text-rose-300 border-rose-400/30 bg-rose-500/8",
};

// ─── Props ────────────────────────────────────────────────────────────────────
export interface HandTrackingPanelProps {
  onStepForward: () => void;
  onStepBackward: () => void;
  onPause: () => void;
  onReset: () => void;
  onAutoRun?: () => void;
  onToggleInsight?: () => void;
  onToggleMemoryView?: () => void;
  onSaveCheckpoint?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function HandTrackingPanel({
  onStepForward,
  onStepBackward,
  onPause,
  onReset,
  onAutoRun,
  onToggleInsight,
  onToggleMemoryView,
  onSaveCheckpoint,
}: HandTrackingPanelProps) {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [gesture, setGesture] = useState<Gesture>("none");
  const [fps, setFps] = useState(0);
  const [handPresent, setHandPresent] = useState(false);
  const [fistHoldPct, setFistHoldPct] = useState(0);
  const [lastAction, setLastAction] = useState("");
  const [cmdExpanded, setCmdExpanded] = useState(true);
  const [aiStatus, setAiStatus] = useState<AIStatus>("CAMERA_DISABLED");

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const mountedRef = useRef(true);
  const actionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Gesture confirmation + cooldown refs
  const confirmRef = useRef<{ gesture: Gesture; frames: number }>({ gesture: "none", frames: 0 });
  const cooldownRef = useRef<Partial<Record<Gesture, number>>>({});
  const fistFramesRef = useRef(0);

  const CONFIRM_FRAMES = 5;
  const COOLDOWN_MS: Partial<Record<Gesture, number>> = {
    index_up: 700, two_up: 700, three_up: 1200, open_palm: 800,
    thumbs_up: 900, thumbs_down: 800, point_left: 600, point_right: 600,
    pinch: 1200, v_sign: 1200, fist: 0, none: 0,
  };
  const FIST_HOLD_FRAMES = 28;

  const fpsFrameCount = useRef(0);
  const fpsTimer = useRef(performance.now());

  const showAction = useCallback((msg: string) => {
    setLastAction(msg);
    if (actionTimerRef.current) clearTimeout(actionTimerRef.current);
    actionTimerRef.current = setTimeout(() => setLastAction(""), 2000);
  }, []);

  // ── Load MediaPipe ─────────────────────────────────────────────────────────
  const loadMediaPipe = useCallback(async () => {
    setStatus("loading");
    setAiStatus("INITIALIZING");
    setErrorMsg("");
    try {
      if (!(window as unknown as Record<string, unknown>)["__mpVisionLoaded__"]) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.type = "module";
          script.textContent = `
            import { HandLandmarker, FilesetResolver } from "${MP_PKG}/vision_bundle.mjs";
            window.__HandLandmarker = HandLandmarker;
            window.__FilesetResolver = FilesetResolver;
            window.__mpVisionLoaded__ = true;
            window.dispatchEvent(new Event("__mpVisionReady__"));
          `;
          const onReady = () => { resolve(); window.removeEventListener("__mpVisionReady__", onReady); };
          window.addEventListener("__mpVisionReady__", onReady);
          script.onerror = () => reject(new Error("Failed to load MediaPipe from CDN"));
          document.head.appendChild(script);
          setTimeout(() => reject(new Error("MediaPipe load timeout (20s)")), 20000);
        });
      }
      const HandLandmarkerCtor = (window as unknown as Record<string, unknown>)["__HandLandmarker"] as {
        createFromOptions(resolver: unknown, opts: HandLandmarkerOptions): Promise<HandLandmarker>;
      };
      const FilesetResolver = (window as unknown as Record<string, unknown>)["__FilesetResolver"] as {
        forVisionTasks(path: string): Promise<unknown>;
      };
      const vision = await FilesetResolver.forVisionTasks(MP_CDN);
      const landmarker = await HandLandmarkerCtor.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 1,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      landmarkerRef.current = landmarker;
      if (!mountedRef.current) { landmarker.close(); return; }
      setStatus("ready");
      setAiStatus("SEARCHING");
    } catch (e) {
      if (!mountedRef.current) return;
      setStatus("error");
      setAiStatus("ERROR");
      setErrorMsg((e as Error).message ?? "Unknown error loading MediaPipe");
    }
  }, []);

  // ── Start camera ───────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false,
      });
      if (!mountedRef.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (e) {
      setStatus("error");
      setAiStatus("ERROR");
      const msg = (e as DOMException).name === "NotAllowedError"
        ? "Camera permission denied. Allow camera access and try again."
        : (e as Error).message ?? "Camera unavailable";
      setErrorMsg(msg);
    }
  }, []);

  // ── Stop everything ────────────────────────────────────────────────────────
  const stopTracking = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    landmarkerRef.current?.close();
    landmarkerRef.current = null;
    setGesture("none");
    setHandPresent(false);
    setFps(0);
    setFistHoldPct(0);
    setAiStatus("CAMERA_DISABLED");
  }, []);

  // ── Detection loop ─────────────────────────────────────────────────────────
  const runDetection = useCallback(() => {
    const video = videoRef.current;
    const canvas = overlayRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || !canvas || !landmarker || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(runDetection);
      return;
    }
    const w = video.videoWidth, h = video.videoHeight;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) { rafRef.current = requestAnimationFrame(runDetection); return; }
    ctx.clearRect(0, 0, w, h);

    let result: HandLandmarkerResult;
    try { result = landmarker.detectForVideo(video, performance.now()); }
    catch { rafRef.current = requestAnimationFrame(runDetection); return; }

    const hasHand = result.landmarks.length > 0;
    setHandPresent(hasHand);

    if (hasHand) {
      const lm = result.landmarks[0];
      const raw = detectGesture(lm);
      drawLandmarks(ctx, lm, w, h, raw);

      const conf = confirmRef.current;
      if (raw === conf.gesture) conf.frames++;
      else { conf.gesture = raw; conf.frames = 1; }

      if (conf.frames >= CONFIRM_FRAMES) {
        setGesture(raw);
        const now = performance.now();

        if (raw === "fist") {
          fistFramesRef.current++;
          setFistHoldPct(Math.min(100, (fistFramesRef.current / FIST_HOLD_FRAMES) * 100));
          if (fistFramesRef.current >= FIST_HOLD_FRAMES) {
            const cd = cooldownRef.current["fist"] ?? 0;
            if (now > cd) {
              cooldownRef.current["fist"] = now + 2000;
              fistFramesRef.current = 0;
              setFistHoldPct(0);
              onReset();
              showAction("✊ Reset Execution");
              setAiStatus("GESTURE_RECOGNIZED");
            }
          }
        } else {
          fistFramesRef.current = 0;
          setFistHoldPct(0);
        }

        if (raw !== "fist" && raw !== "none") {
          const cd = cooldownRef.current[raw] ?? 0;
          if (now > cd) {
            const delay = COOLDOWN_MS[raw] ?? 700;
            cooldownRef.current[raw] = now + delay;
            setAiStatus("GESTURE_RECOGNIZED");
            switch (raw) {
              case "index_up":
              case "point_right":
                onStepForward(); showAction(`${GESTURE_META[raw].icon} Step Forward`); break;
              case "two_up":
              case "point_left":
                onStepBackward(); showAction(`${GESTURE_META[raw].icon} Step Backward`); break;
              case "open_palm":
                onPause(); showAction("🖐 Paused"); break;
              case "thumbs_up":
                onAutoRun?.(); showAction("👍 AUTO-RUN ACTIVATED"); break;
              case "thumbs_down":
                onPause(); showAction("👎 Execution Paused"); break;
              case "pinch":
                onToggleInsight?.(); showAction("🤌 AI Insight Toggled"); break;
              case "three_up":
                onToggleMemoryView?.(); showAction("🤟 Memory View Toggled"); break;
              case "v_sign":
                onSaveCheckpoint?.(); showAction("✌ Checkpoint Saved"); break;
            }
          }
        } else if (raw !== "fist") {
          setAiStatus("HAND_DETECTED");
        }
      }
    } else {
      setGesture("none");
      fistFramesRef.current = 0;
      setFistHoldPct(0);
      setAiStatus("SEARCHING");
    }

    fpsFrameCount.current++;
    const now = performance.now();
    if (now - fpsTimer.current >= 1000) {
      setFps(Math.round((fpsFrameCount.current * 1000) / (now - fpsTimer.current)));
      fpsFrameCount.current = 0;
      fpsTimer.current = now;
    }
    rafRef.current = requestAnimationFrame(runDetection);
  }, [onStepForward, onStepBackward, onPause, onReset, onAutoRun, onToggleInsight, onToggleMemoryView, onSaveCheckpoint, showAction]);

  // ── Enable / disable ───────────────────────────────────────────────────────
  const handleEnable = useCallback(async () => {
    setEnabled(true);
    await loadMediaPipe();
    await startCamera();
  }, [loadMediaPipe, startCamera]);

  const handleDisable = useCallback(() => {
    setEnabled(false);
    stopTracking();
    setStatus("idle");
  }, [stopTracking]);

  useEffect(() => {
    if (status === "ready" && enabled) rafRef.current = requestAnimationFrame(runDetection);
    return () => cancelAnimationFrame(rafRef.current);
  }, [status, enabled, runDetection]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelAnimationFrame(rafRef.current);
      if (actionTimerRef.current) clearTimeout(actionTimerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      landmarkerRef.current?.close();
    };
  }, []);

  // ── Gesture card colour ────────────────────────────────────────────────────
  const gestureCardCls = (g: Gesture) => {
    const active = gesture === g;
    const map: Partial<Record<Gesture, string>> = {
      index_up:    "border-cyan-400/50 bg-cyan-500/15 text-cyan-200",
      two_up:      "border-blue-400/50 bg-blue-500/15 text-blue-200",
      three_up:    "border-violet-400/50 bg-violet-500/15 text-violet-200",
      open_palm:   "border-amber-400/50 bg-amber-500/15 text-amber-200",
      fist:        "border-rose-400/50 bg-rose-500/15 text-rose-200",
      thumbs_up:   "border-emerald-400/50 bg-emerald-500/15 text-emerald-200",
      thumbs_down: "border-rose-400/50 bg-rose-500/15 text-rose-200",
      point_left:  "border-cyan-400/50 bg-cyan-500/15 text-cyan-200",
      point_right: "border-cyan-400/50 bg-cyan-500/15 text-cyan-200",
      pinch:       "border-violet-400/50 bg-violet-500/15 text-violet-200",
      v_sign:      "border-sky-400/50 bg-sky-500/15 text-sky-200",
      none:        "border-white/8 bg-white/2 text-slate-500",
    };
    return active ? (map[g] ?? "border-white/8 bg-white/2 text-slate-500") : "border-white/6 bg-white/2 text-slate-600";
  };

  // ── Gesture command center entries ─────────────────────────────────────────
  const CMD_GESTURES: Gesture[] = [
    "thumbs_up", "index_up", "two_up", "point_right", "point_left",
    "open_palm", "thumbs_down", "fist", "pinch", "three_up", "v_sign",
  ];

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: "linear-gradient(135deg, #050810 0%, #080d1a 40%, #050a14 100%)",
        border: "1px solid rgba(56,189,248,0.18)",
        boxShadow: "0 0 40px rgba(56,189,248,0.04), inset 0 0 60px rgba(139,92,246,0.03)",
      }}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between gap-3 px-5 py-3.5"
        style={{ borderBottom: "1px solid rgba(56,189,248,0.1)", background: "rgba(8,13,26,0.8)" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex size-8 items-center justify-center rounded-xl"
            style={{ background: "linear-gradient(135deg, #06b6d4 0%, #8b5cf6 100%)", boxShadow: "0 0 16px rgba(6,182,212,0.35)" }}
          >
            <Hand className="size-4 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold tracking-tight text-white">AI Hand Control</span>
              <span
                className="rounded-full px-2 py-0.5 text-[9px] font-bold tracking-widest"
                style={{ border: "1px solid rgba(6,182,212,0.35)", background: "rgba(6,182,212,0.1)", color: "#67e8f9" }}
              >
                LOCAL · PRIVATE
              </span>
            </div>
            <p className="text-[10px] mt-0.5" style={{ color: "#475569" }}>
              MediaPipe hand landmarks · 21 keypoints · browser-only inference
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* AI Status pill */}
          <span className={`rounded-full border px-2.5 py-1 text-[9px] font-bold tracking-widest transition-all ${AI_STATUS_STYLES[aiStatus]}`}>
            {aiStatus.replace(/_/g, " ")}
          </span>

          {enabled && fps > 0 && (
            <span className="rounded-full border border-emerald-400/20 bg-emerald-500/8 px-2 py-0.5 text-[10px] font-mono text-emerald-400">{fps} FPS</span>
          )}

          <button
            onClick={enabled ? handleDisable : handleEnable}
            disabled={status === "loading"}
            className="flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50"
            style={enabled
              ? { border: "1px solid rgba(244,63,94,0.4)", background: "rgba(244,63,94,0.1)", color: "#fda4af" }
              : { border: "1px solid rgba(6,182,212,0.4)", background: "rgba(6,182,212,0.1)", color: "#67e8f9" }
            }
          >
            {status === "loading"
              ? <><Loader2 className="size-3.5 animate-spin" /> Loading…</>
              : enabled
              ? <><CameraOff className="size-3.5" /> Disable</>
              : <><Camera className="size-3.5" /> Enable</>
            }
          </button>
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      {!enabled ? (
        /* Off state — show gesture reference */
        <div className="p-5">
          <div className="flex flex-col items-center gap-4 py-6 text-center mb-5">
            <div
              className="flex size-16 items-center justify-center rounded-2xl"
              style={{ border: "1px solid rgba(6,182,212,0.2)", background: "rgba(6,182,212,0.06)", boxShadow: "0 0 24px rgba(6,182,212,0.1)" }}
            >
              <Hand className="size-8" style={{ color: "#22d3ee" }} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-200">Real-Time Hand Tracking</h3>
              <p className="mt-1 max-w-sm text-xs leading-relaxed" style={{ color: "#475569" }}>
                Uses MediaPipe to track 21 hand landmarks locally in your browser.
                Control code execution with natural gestures.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 mb-4">
            {CMD_GESTURES.slice(0, 6).map((g) => (
              <div
                key={g}
                className="rounded-xl p-2.5 text-[10px]"
                style={{ border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}
              >
                <div className="text-base mb-0.5">{GESTURE_META[g].icon}</div>
                <div className="font-bold text-slate-300">{GESTURE_META[g].action}</div>
                <div className="text-slate-600 mt-0.5">{GESTURE_META[g].howTo}</div>
              </div>
            ))}
          </div>
          <p className="text-center text-[10px]" style={{ color: "#334155" }}>Camera permission required · all processing is local · no data uploaded</p>
        </div>
      ) : status === "error" ? (
        <div className="flex flex-col items-center gap-3 py-8 px-6 text-center">
          <AlertCircle className="size-8 text-rose-400" />
          <p className="text-sm font-semibold text-rose-300">Hand tracking unavailable</p>
          <p className="text-xs max-w-xs" style={{ color: "#64748b" }}>{errorMsg}</p>
          <button
            onClick={handleDisable}
            className="rounded-xl px-4 py-1.5 text-xs transition"
            style={{ border: "1px solid rgba(255,255,255,0.1)", color: "#94a3b8" }}
          >
            Dismiss
          </button>
        </div>
      ) : (
        <div className="p-4 space-y-4">

          {/* Action flash banner */}
          {lastAction && (
            <div
              className="rounded-xl px-4 py-2.5 text-center text-sm font-bold tracking-wide"
              style={{
                border: "1px solid rgba(139,92,246,0.4)",
                background: "rgba(139,92,246,0.12)",
                color: "#c4b5fd",
                boxShadow: "0 0 20px rgba(139,92,246,0.15)",
              }}
            >
              {lastAction}
            </div>
          )}

          {/* Camera + overlay */}
          <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
            {/* Video */}
            <div
              className="relative overflow-hidden rounded-xl aspect-video"
              style={{ border: "1px solid rgba(6,182,212,0.2)", background: "#000", boxShadow: "0 0 30px rgba(6,182,212,0.06)" }}
            >
              {status === "loading" && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 z-10" style={{ background: "rgba(0,0,0,0.85)" }}>
                  <Loader2 className="size-6 animate-spin" style={{ color: "#22d3ee" }} />
                  <p className="text-xs" style={{ color: "#64748b" }}>Loading AI model…</p>
                  <p className="text-[10px]" style={{ color: "#334155" }}>~8MB one-time download</p>
                </div>
              )}

              {/* Scanning line animation */}
              <div
                className="absolute inset-x-0 h-px z-10 pointer-events-none opacity-60"
                style={{
                  background: "linear-gradient(90deg, transparent, #22d3ee, transparent)",
                  animation: "scanline 3s linear infinite",
                  top: "50%",
                }}
              />

              <video
                ref={videoRef}
                className="absolute inset-0 w-full h-full object-cover"
                style={{ transform: "scaleX(-1)" }}
                muted
                playsInline
                autoPlay
              />
              <canvas
                ref={overlayRef}
                className="absolute inset-0 w-full h-full"
                style={{ pointerEvents: "none" }}
              />

              {/* Top-left status */}
              <div className="absolute top-2 left-2 flex items-center gap-1.5">
                <span
                  className="size-2 rounded-full"
                  style={{
                    background: handPresent ? "#4ade80" : "#475569",
                    boxShadow: handPresent ? "0 0 8px rgba(74,222,128,0.8)" : "none",
                  }}
                />
                <span
                  className="rounded-full px-2 py-0.5 text-[10px]"
                  style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)", color: "#cbd5e1" }}
                >
                  {handPresent ? "HAND DETECTED" : "SEARCHING…"}
                </span>
              </div>

              {/* Top-right LIVE */}
              <div className="absolute top-2 right-2 flex items-center gap-1.5">
                <span
                  className="size-1.5 rounded-full animate-pulse"
                  style={{ background: "#f43f5e" }}
                />
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-bold font-mono"
                  style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)", color: "#22d3ee" }}
                >
                  LIVE
                </span>
              </div>

              {/* Gesture name overlay at bottom */}
              {gesture !== "none" && (
                <div className="absolute bottom-2 inset-x-2 flex justify-center">
                  <span
                    className="rounded-xl px-3 py-1 text-xs font-bold"
                    style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.3)" }}
                  >
                    {GESTURE_META[gesture].icon} {GESTURE_META[gesture].label} → {GESTURE_META[gesture].action}
                  </span>
                </div>
              )}

              <style>{`
                @keyframes scanline {
                  0% { top: 0%; opacity: 0; }
                  5% { opacity: 0.6; }
                  95% { opacity: 0.6; }
                  100% { top: 100%; opacity: 0; }
                }
              `}</style>
            </div>

            {/* Gesture status column */}
            <div className="flex flex-col gap-2.5">
              {/* Current gesture card */}
              <div
                className="rounded-xl p-3 text-center"
                style={{
                  border: `1px solid ${gesture !== "none" ? "rgba(139,92,246,0.4)" : "rgba(255,255,255,0.06)"}`,
                  background: gesture !== "none" ? "rgba(139,92,246,0.1)" : "rgba(255,255,255,0.02)",
                  transition: "all 0.2s",
                }}
              >
                <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "#475569" }}>Gesture</div>
                <div className="text-2xl mb-1">{gesture !== "none" ? GESTURE_META[gesture].icon : "—"}</div>
                <div className="text-xs font-bold" style={{ color: gesture !== "none" ? "#c4b5fd" : "#475569" }}>
                  {gesture !== "none" ? GESTURE_META[gesture].action : "No gesture"}
                </div>
              </div>

              {/* Fist hold ring */}
              {gesture === "fist" && fistHoldPct > 0 && (
                <div className="rounded-xl p-2.5" style={{ border: "1px solid rgba(244,63,94,0.3)", background: "rgba(244,63,94,0.07)" }}>
                  <div className="text-[10px] mb-1.5" style={{ color: "#f87171" }}>Hold for reset…</div>
                  <div className="h-2 rounded-full" style={{ background: "rgba(255,255,255,0.07)" }}>
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${fistHoldPct}%`, background: "linear-gradient(90deg, #f43f5e, #fb7185)" }}
                    />
                  </div>
                  <div className="text-right text-[9px] mt-1" style={{ color: "#94a3b8" }}>{Math.round(fistHoldPct)}%</div>
                </div>
              )}

              {/* Quick action buttons (always available) */}
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { icon: "⏭", label: "Next", action: onStepForward },
                  { icon: "⏮", label: "Prev", action: onStepBackward },
                  { icon: "▶", label: "Run", action: onAutoRun },
                  { icon: "⏸", label: "Pause", action: onPause },
                ].map(({ icon, label, action }) => (
                  <button
                    key={label}
                    onClick={action}
                    disabled={!action}
                    className="rounded-lg py-1.5 text-[10px] font-semibold transition disabled:opacity-30"
                    style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)", color: "#94a3b8" }}
                  >
                    {icon} {label}
                  </button>
                ))}
              </div>

              {/* Privacy note */}
              <div
                className="flex items-start gap-1.5 rounded-lg px-2.5 py-2"
                style={{ border: "1px solid rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.01)" }}
              >
                <Zap className="size-3 shrink-0 mt-px" style={{ color: "#7c3aed" }} />
                <p className="text-[9px] leading-relaxed" style={{ color: "#334155" }}>
                  All inference is local. No video data leaves your device.
                </p>
              </div>
            </div>
          </div>

          {/* ── Gesture Command Center ────────────────────────────────── */}
          <div
            className="rounded-xl overflow-hidden"
            style={{ border: "1px solid rgba(139,92,246,0.15)", background: "rgba(139,92,246,0.03)" }}
          >
            <button
              type="button"
              onClick={() => setCmdExpanded((e) => !e)}
              className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-left transition"
              style={{ borderBottom: cmdExpanded ? "1px solid rgba(139,92,246,0.12)" : "none", background: "rgba(0,0,0,0.2)" }}
            >
              <div className="flex items-center gap-2">
                <Layers className="size-3.5" style={{ color: "#8b5cf6" }} />
                <span className="text-[11px] font-bold tracking-widest" style={{ color: "#a78bfa" }}>AI GESTURE COMMAND CENTER</span>
              </div>
              <span style={{ color: "#475569" }}>
                {cmdExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              </span>
            </button>

            {cmdExpanded && (
              <div className="p-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {CMD_GESTURES.map((g) => {
                  const isActive = gesture === g;
                  return (
                    <div
                      key={g}
                      className="rounded-lg p-2.5 transition-all"
                      style={{
                        border: isActive ? "1px solid rgba(139,92,246,0.5)" : "1px solid rgba(255,255,255,0.05)",
                        background: isActive ? "rgba(139,92,246,0.12)" : "rgba(255,255,255,0.02)",
                        boxShadow: isActive ? "0 0 12px rgba(139,92,246,0.15)" : "none",
                      }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-base">{GESTURE_META[g].icon}</span>
                        {isActive && (
                          <span className="rounded-full px-1.5 text-[8px] font-bold" style={{ background: "rgba(139,92,246,0.25)", color: "#c4b5fd" }}>
                            ACTIVE
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] font-bold mb-0.5" style={{ color: isActive ? "#c4b5fd" : "#94a3b8" }}>{GESTURE_META[g].action}</div>
                      <div className="text-[9px]" style={{ color: "#334155" }}>{GESTURE_META[g].howTo}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Gesture limitation note ───────────────────────────────── */}
          <div
            className="rounded-xl px-3 py-2.5 flex items-start gap-2"
            style={{ border: "1px solid rgba(245,158,11,0.15)", background: "rgba(245,158,11,0.04)" }}
          >
            <BookOpen className="size-3.5 shrink-0 mt-0.5" style={{ color: "#f59e0b" }} />
            <p className="text-[10px] leading-relaxed" style={{ color: "#78716c" }}>
              <strong style={{ color: "#a8a29e" }}>Gesture accuracy note:</strong> point_left/right detection
              requires holding the index finger distinctly horizontal. Thumbs up/down works best when the
              fist is clearly formed and the thumb extends vertically. Pinch requires all other fingers curled.
              V-sign is distinguished from two_up by finger spread width. In ambiguous poses the system
              returns "none" and takes no action.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
