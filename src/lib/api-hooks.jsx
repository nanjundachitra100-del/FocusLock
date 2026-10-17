import { useCallback, useEffect, useState } from "react";

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || `Request failed (${response.status})`);
  }
  return data;
}

export function useDashboardData() {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const offset = new Date().getTimezoneOffset();
      const result = await request(
        `/api/dashboard?timezone_offset_minutes=${offset}`,
      );
      setDashboard(result);
      return result;
    } catch (caught) {
      setError(caught.message || "Could not load your study progress.");
      throw caught;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload().catch(() => {});
  }, [reload]);

  return { dashboard, loading, error, reload };
}

export function useSaveSettings() {
  const [saving, setSaving] = useState(false);
  const saveSettings = useCallback(async (settings) => {
    setSaving(true);
    try {
      return await request("/api/settings", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
    } finally {
      setSaving(false);
    }
  }, []);
  return { saveSettings, saving };
}

export function useLogFocusSession() {
  const logFocusSession = useCallback(
    ({ kind = "focus", duration_seconds }) =>
      request("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ kind, duration_seconds }),
      }),
    [],
  );
  return { logFocusSession };
}

export function useSubmitQuiz() {
  const submitQuiz = useCallback(
    ({ correct, total }) =>
      request("/api/quizzes", {
        method: "POST",
        body: JSON.stringify({ correct, total }),
      }),
    [],
  );
  return { submitQuiz };
}

export function useCompanionChat() {
  const [sending, setSending] = useState(false);
  const sendMessage = useCallback(async (message) => {
    setSending(true);
    try {
      return await request("/api/chat", {
        method: "POST",
        body: JSON.stringify({ message }),
      });
    } finally {
      setSending(false);
    }
  }, []);
  return { sendMessage, sending };
}
