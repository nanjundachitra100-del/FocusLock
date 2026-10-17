"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, Mic, MicOff, Send, Trash2 } from "lucide-react";
import AutoVoiceOver from "@/components/voice/AutoVoiceOver";
import { sendStudyMessage, StudyAssistantUnavailableError, type StudyMessage } from "@/lib/studyAssistant";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";

type ThreadItem =
  | { id: string; kind: "user" | "assistant"; content: string }
  | { id: string; kind: "error"; content: string };

let messageSeq = 0;
function nextId() {
  messageSeq += 1;
  return `study-${Date.now()}-${messageSeq}`;
}

type StudyAssistantChatProps = {
  narrationEnabled?: boolean;
  onNarrationEnabledChange?: (enabled: boolean) => void;
};

export default function StudyAssistantChat({
  narrationEnabled,
  onNarrationEnabledChange,
}: StudyAssistantChatProps) {
  const [draft, setDraft] = useState("");
  const [items, setItems] = useState<ThreadItem[]>([]);
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);
  const recognition = useSpeechRecognition();
  const appliedTranscriptRef = useRef("");

  const latestAssistant = useMemo(() => {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (item?.kind === "assistant") return item.content;
    }
    return "";
  }, [items]);

  useEffect(() => {
    const node = listRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [items, loading]);

  useEffect(() => {
    const next = recognition.transcript.trim();
    if (!next || next === appliedTranscriptRef.current) return;
    appliedTranscriptRef.current = next;
    setDraft((current) => {
      const trimmed = current.trim();
      if (!trimmed) return next;
      if (trimmed.endsWith(next) || trimmed.includes(next)) return current;
      return `${trimmed} ${next}`.trim();
    });
  }, [recognition.transcript]);

  const sendDraft = async (raw: string) => {
    const content = raw.trim();
    if (!content || loading) return;

    recognition.stop();
    setDraft("");
    appliedTranscriptRef.current = "";

    const history: StudyMessage[] = items
      .filter((item): item is ThreadItem & { kind: "user" | "assistant" } => item.kind === "user" || item.kind === "assistant")
      .map((item) => ({ role: item.kind, content: item.content }));
    history.push({ role: "user", content });

    const userItem: ThreadItem = { id: nextId(), kind: "user", content };
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setItems((current) => [...current, userItem]);
    setLoading(true);

    try {
      const reply = await sendStudyMessage(history);
      if (requestIdRef.current !== requestId) return;
      setItems((current) => [...current, { id: nextId(), kind: "assistant", content: reply }]);
    } catch (error) {
      if (requestIdRef.current !== requestId) return;
      const message =
        error instanceof StudyAssistantUnavailableError
          ? error.message
          : "The study assistant backend is unavailable. You can still type and use voice-over once an answer exists.";
      setItems((current) => [...current, { id: nextId(), kind: "error", content: message }]);
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  };

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void sendDraft(draft);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendDraft(draft);
    }
  };

  const clearConversation = () => {
    if (items.length === 0 && !draft) return;
    const confirmed = window.confirm("Clear this study conversation? This cannot be undone.");
    if (!confirmed) return;
    requestIdRef.current += 1;
    recognition.stop();
    setItems([]);
    setDraft("");
    appliedTranscriptRef.current = "";
    setLoading(false);
  };

  const toggleMic = () => {
    if (!recognition.supported) return;
    if (recognition.listening) {
      recognition.stop();
      return;
    }
    recognition.start();
  };

  return (
    <section className="glass max-w-3xl rounded-2xl p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold tracking-[.2em] text-violet-300">STUDY ASSISTANT</div>
          <h3 className="mt-1 font-semibold">Ask by typing or speaking</h3>
          <p className="mt-1 text-xs text-slate-500">
            Type or speak a question. Gemma AI will answer and you can listen using the voice controls below.
          </p>
        </div>
        <button
          type="button"
          onClick={clearConversation}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/5"
          aria-label="Clear conversation"
        >
          <Trash2 className="size-3.5" /> Clear
        </button>
      </div>

      <div
        ref={listRef}
        className="mb-4 flex max-h-80 flex-col gap-3 overflow-y-auto rounded-xl border border-white/8 bg-black/20 p-3"
        aria-live="polite"
      >
        {items.length === 0 && (
          <p className="px-1 py-6 text-center text-sm text-slate-500">
            Ask a follow-up about your topic. Answers will appear as chat messages. They are not generated until the
            learning engine is connected.
          </p>
        )}
        {items.map((item) => (
          <div
            key={item.id}
            className={`max-w-[90%] rounded-2xl px-3 py-2.5 text-sm leading-6 ${
              item.kind === "user"
                ? "ml-auto bg-violet-500/20 text-violet-50"
                : item.kind === "assistant"
                  ? "mr-auto bg-white/8 text-slate-200"
                  : "mr-auto border border-amber-400/20 bg-amber-400/10 text-amber-100"
            }`}
          >
            <div className="mb-1 text-[10px] uppercase tracking-[.16em] text-slate-400">
              {item.kind === "user" ? "You" : item.kind === "assistant" ? "Assistant" : "Unavailable"}
            </div>
            {item.content}
          </div>
        ))}
        {loading && (
          <div className="mr-auto inline-flex items-center gap-2 rounded-2xl bg-white/8 px-3 py-2 text-xs text-slate-300">
            <LoaderCircle className="size-3.5 animate-spin" /> Waiting for the learning engine…
          </div>
        )}
      </div>

      <AutoVoiceOver
        text={latestAssistant}
        enabled={narrationEnabled}
        onEnabledChange={onNarrationEnabledChange}
        instanceId="study-assistant"
        title="Answer voice-over"
        description="Press Play to hear the latest answer aloud. Enable automatic narration to read each new answer automatically."
      />

      <form onSubmit={onSubmit} className="mt-4">
        <label htmlFor="study-assistant-input" className="mb-2 block text-xs text-slate-400">
          Your question
        </label>
        <textarea
          id="study-assistant-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          placeholder="Type a question, or use the microphone and edit the transcript before sending."
          className="w-full resize-y rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm outline-none focus:border-violet-400/60"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={toggleMic}
            disabled={!recognition.supported}
            aria-label={recognition.listening ? "Stop listening" : "Start microphone dictation"}
            aria-pressed={recognition.listening}
            title={
              recognition.supported
                ? recognition.listening
                  ? "Stop listening"
                  : "Speak your question"
                : "Microphone dictation is not supported in this browser"
            }
            className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium disabled:opacity-40 ${
              recognition.listening
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                : "border-white/10 text-slate-300 hover:bg-white/5"
            }`}
          >
            {recognition.listening ? <MicOff className="size-3.5" /> : <Mic className="size-3.5" />}
            {recognition.listening ? "Listening… tap to stop" : "Microphone"}
          </button>
          <button
            type="submit"
            disabled={loading || !draft.trim()}
            className="ml-auto inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-blue-500 px-4 py-2 text-sm font-semibold disabled:opacity-40"
          >
            <Send className="size-3.5" /> Send
          </button>
        </div>
        {recognition.listening && (
          <p className="mt-2 text-xs text-emerald-300">
            Listening{recognition.interimTranscript ? `: ${recognition.interimTranscript}` : ". Speak now, then edit if needed."}
          </p>
        )}
        {!recognition.supported && (
          <p className="mt-2 text-xs text-amber-200">
            This browser does not support speech-to-text. Chrome or Edge on desktop usually work. Typing still works.
          </p>
        )}
        {recognition.errorMessage && <p className="mt-2 text-xs text-rose-300">{recognition.errorMessage}</p>}
      </form>
    </section>
  );
}
