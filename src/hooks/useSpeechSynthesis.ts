"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SpeechStatus =
  | "ready"
  | "speaking"
  | "paused"
  | "finished"
  | "unsupported"
  | "failed";

export type SpeechVoiceOption = {
  voiceURI: string;
  name: string;
  lang: string;
};

type UseSpeechSynthesisOptions = {
  text: string;
  lang?: string;
  rate?: number;
  voiceURI?: string | null;
};

function getSynthesis(): SpeechSynthesis | null {
  if (typeof window === "undefined") return null;
  return window.speechSynthesis ?? null;
}

function splitChunks(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const parts = trimmed.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [trimmed];
}

function isIgnorableSpeechError(error: string): boolean {
  return error === "interrupted" || error === "canceled";
}

export function useSpeechSynthesis({
  text,
  lang = "en-US",
  rate = 1,
  voiceURI = null,
}: UseSpeechSynthesisOptions) {
  const [status, setStatus] = useState<SpeechStatus>("ready");
  const [voices, setVoices] = useState<SpeechVoiceOption[]>([]);
  const [supported, setSupported] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const textRef = useRef(text);
  const langRef = useRef(lang);
  const rateRef = useRef(rate);
  const voiceURIRef = useRef(voiceURI);
  const speakGenerationRef = useRef(0);
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  textRef.current = text;
  langRef.current = lang;
  rateRef.current = rate;
  voiceURIRef.current = voiceURI;

  useEffect(() => {
    const synth = getSynthesis();
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
      setSupported(false);
      setStatus("unsupported");
      return;
    }

    setSupported(true);

    const loadVoices = () => {
      const next = synth.getVoices().map((voice) => ({
        voiceURI: voice.voiceURI,
        name: voice.name,
        lang: voice.lang,
      }));
      setVoices(next);
    };

    loadVoices();
    synth.addEventListener("voiceschanged", loadVoices);
    return () => {
      synth.removeEventListener("voiceschanged", loadVoices);
    };
  }, []);

  const stop = useCallback(() => {
    speakGenerationRef.current += 1;
    activeUtteranceRef.current = null;
    const synth = getSynthesis();
    synth?.cancel();
    setStatus((current) => (current === "unsupported" ? current : "ready"));
  }, []);

  const speak = useCallback(() => {
    const synth = getSynthesis();
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
      setSupported(false);
      setStatus("unsupported");
      setErrorMessage("Speech synthesis is not available in this browser.");
      return;
    }

    const content = textRef.current.trim();
    if (!content) {
      setErrorMessage("There is no explanation to read.");
      setStatus("ready");
      return;
    }

    const generation = ++speakGenerationRef.current;
    synth.cancel();
    setErrorMessage(null);

    const chunks = splitChunks(content);
    const availableVoices = synth.getVoices();
    const selectedVoice =
      availableVoices.find((voice) => voice.voiceURI === voiceURIRef.current) ??
      availableVoices.find((voice) => voice.lang.startsWith(langRef.current.split("-")[0] ?? "en")) ??
      null;

    const queueUtterances = () => {
      if (speakGenerationRef.current !== generation) return;

      chunks.forEach((chunk, index) => {
        const utterance = new SpeechSynthesisUtterance(chunk);
        utterance.lang = selectedVoice?.lang || langRef.current;
        utterance.rate = Math.min(1.5, Math.max(0.75, rateRef.current));
        if (selectedVoice) utterance.voice = selectedVoice;

        utterance.onstart = () => {
          if (speakGenerationRef.current !== generation) return;
          activeUtteranceRef.current = utterance;
          setStatus("speaking");
        };
        utterance.onpause = () => {
          if (speakGenerationRef.current !== generation) return;
          setStatus("paused");
        };
        utterance.onresume = () => {
          if (speakGenerationRef.current !== generation) return;
          setStatus("speaking");
        };
        utterance.onend = () => {
          if (speakGenerationRef.current !== generation) return;
          if (index === chunks.length - 1) {
            activeUtteranceRef.current = null;
            setStatus("finished");
          }
        };
        utterance.onerror = (event) => {
          if (speakGenerationRef.current !== generation) return;
          if (isIgnorableSpeechError(event.error)) return;
          activeUtteranceRef.current = null;
          setStatus("failed");
          setErrorMessage("Narration failed. Try play again, or pick another voice.");
        };

        synth.speak(utterance);
      });
    };

    window.setTimeout(queueUtterances, 40);
  }, []);

  const pause = useCallback(() => {
    const synth = getSynthesis();
    if (!synth || synth.paused) return;
    synth.pause();
    if (synth.paused) setStatus("paused");
  }, []);

  const resume = useCallback(() => {
    const synth = getSynthesis();
    if (!synth) return;
    synth.resume();
    if (!synth.paused && synth.speaking) setStatus("speaking");
  }, []);

  useEffect(() => {
    return () => {
      speakGenerationRef.current += 1;
      getSynthesis()?.cancel();
    };
  }, []);

  return {
    status,
    supported,
    voices,
    errorMessage,
    speak,
    pause,
    resume,
    stop,
  };
}
