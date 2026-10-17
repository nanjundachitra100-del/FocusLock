"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type RecognitionResult = {
  isFinal: boolean;
  0: { transcript: string };
};

type RecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
};

type RecognitionErrorEvent = {
  error: string;
};

type BrowserSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type RecognitionConstructor = new () => BrowserSpeechRecognition;

function getRecognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as Window & {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

export function useSpeechRecognition(lang = "en-US") {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const stopRequestedRef = useRef(false);

  useEffect(() => {
    setSupported(Boolean(getRecognitionConstructor()));
  }, []);

  const stop = useCallback(() => {
    stopRequestedRef.current = true;
    const recognition = recognitionRef.current;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.stop();
      } catch {
        try {
          recognition.abort();
        } catch {
          /* already stopped */
        }
      }
    }
    recognitionRef.current = null;
    setListening(false);
    setInterimTranscript("");
  }, []);

  const start = useCallback(() => {
    const Recognition = getRecognitionConstructor();
    if (!Recognition) {
      setSupported(false);
      setErrorMessage("Microphone dictation is not supported in this browser. Type your question instead.");
      return;
    }

    stop();
    stopRequestedRef.current = false;
    setErrorMessage(null);
    setTranscript("");
    setInterimTranscript("");

    const recognition = new Recognition();
    recognition.lang = lang;
    recognition.interimResults = true;
    recognition.continuous = true;
    recognitionRef.current = recognition;

    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result) continue;
        if (result.isFinal) finalText += result[0].transcript;
        else interimText += result[0].transcript;
      }
      if (finalText) {
        setTranscript((current) => `${current}${current ? " " : ""}${finalText.trim()}`.trim());
      }
      setInterimTranscript(interimText.trim());
    };

    recognition.onerror = (event) => {
      if (event.error === "aborted" || event.error === "no-speech") return;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setErrorMessage("Microphone permission was denied. Allow the microphone, or type your question.");
      } else {
        setErrorMessage("Could not listen right now. Check your microphone, or type your question.");
      }
      setListening(false);
    };

    recognition.onend = () => {
      if (!stopRequestedRef.current && recognitionRef.current === recognition) {
        try {
          recognition.start();
          return;
        } catch {
          /* fall through to idle */
        }
      }
      setListening(false);
      setInterimTranscript("");
    };

    try {
      recognition.start();
      setListening(true);
    } catch {
      setErrorMessage("Could not start the microphone. Type your question instead.");
      setListening(false);
    }
  }, [lang, stop]);

  useEffect(() => {
    return () => {
      stopRequestedRef.current = true;
      try {
        recognitionRef.current?.abort();
      } catch {
        /* unmount */
      }
      recognitionRef.current = null;
    };
  }, []);

  return {
    supported,
    listening,
    transcript,
    interimTranscript,
    errorMessage,
    start,
    stop,
  };
}
