"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, LoaderCircle, LockKeyhole } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getSupabaseEnvironmentStatus } from "@/lib/supabase/env";

type AuthFormProps = { mode: "login" | "signup" };

function getSupabaseConfigurationMessage() {
  const status = getSupabaseEnvironmentStatus();
  return `Supabase configuration is missing. URL present: ${status.urlPresent ? "yes" : "no"}; publishable key present: ${status.publishableKeyPresent ? "yes" : "no"}. Check .env.local in the project root, then restart Next.js.`;
}

function getAuthErrorMessage(error: { message: string; code?: string }) {
  const message = error.message.toLowerCase();
  const code = error.code?.toLowerCase() ?? "";

  if (code === "invalid_credentials" || message.includes("invalid login credentials")) {
    return "That email and password combination is incorrect.";
  }
  if (code.includes("already") || message.includes("already registered") || message.includes("already exists")) {
    return "An account with this email already exists. Try logging in instead.";
  }
  if (message.includes("email not confirmed") || code.includes("email_not_confirmed")) {
    return "Confirm your email address using the link we sent before logging in.";
  }
  if (message.includes("password") && /(weak|short|least|character|strength)/.test(message)) {
    return "That password is too weak. Use at least 8 characters and check your Supabase password requirements.";
  }
  if (message.includes("fetch") || message.includes("network") || message.includes("timeout")) {
    return "FocusLock could not reach Supabase. Check your connection and try again.";
  }
  return error.message;
}

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "error" | "info"; message: string } | null>(null);

  useEffect(() => {
    const error = new URLSearchParams(window.location.search).get("error");
    if (error === "configuration") {
      const status = getSupabaseEnvironmentStatus();
      if (status.urlPresent && status.publishableKeyPresent) {
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.delete("error");
        window.history.replaceState(null, "", `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
        return;
      }

      setFeedback({
        kind: "error",
        message: getSupabaseConfigurationMessage(),
      });
    } else if (error === "session") {
      setFeedback({
        kind: "error",
        message: "FocusLock could not verify your session with Supabase. Please try logging in again.",
      });
    } else if (error === "confirmation") {
      setFeedback({
        kind: "error",
        message: "The confirmation link could not be verified. Request a new link and try again.",
      });
    } else if (error === "invalid-credentials") {
      setFeedback({ kind: "error", message: "That email and password combination is incorrect." });
    } else if (error === "email-not-confirmed") {
      setFeedback({ kind: "error", message: "Confirm your email address using the link we sent before logging in." });
    } else if (error === "auth-network") {
      setFeedback({ kind: "error", message: "FocusLock could not reach Supabase Auth. Check your connection and try again." });
    } else if (error === "signup" || error === "signup-network") {
      setFeedback({ kind: "error", message: "FocusLock could not create your account. Check your details and connection, then try again." });
    } else if (new URLSearchParams(window.location.search).get("success") === "confirmation") {
      setFeedback({
        kind: "info",
        message: "If this address can be registered, a confirmation email will arrive. Confirm it before logging in.",
      });
    }
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const displayName = String(formData.get("displayName") ?? "").trim();

    if (mode === "signup" && (displayName.length < 2 || displayName.length > 80)) {
      setFeedback({ kind: "error", message: "Your display name must be between 2 and 80 characters." });
      return;
    }
    if (mode === "signup" && password.length < 8) {
      setFeedback({ kind: "error", message: "Use at least 8 characters for your password." });
      return;
    }

    setPending(true);
    try {
      const supabase = createClient();

      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName },
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });

        if (error) throw error;
        if (data.session) {
          router.replace("/");
          router.refresh();
        } else if (data.user) {
          setFeedback({
            kind: "info",
            message: "If this address can be registered, a confirmation email will arrive. Confirm it before logging in.",
          });
        } else {
          setFeedback({ kind: "error", message: "Supabase did not return an account response. Please try again." });
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (!data.session) {
          setFeedback({
            kind: "error",
            message: "No active session was returned. Confirm your email address and try again.",
          });
          return;
        }
        router.replace("/");
        router.refresh();
      }
    } catch (error) {
      const message = error instanceof Error && error.message.startsWith("Supabase is not configured.")
        ? getSupabaseConfigurationMessage()
        : error instanceof Error
          ? getAuthErrorMessage(error)
          : "The authentication request failed. Please try again.";
      setFeedback({ kind: "error", message });
    } finally {
      setPending(false);
    }
  }

  const isSignup = mode === "signup";
  const inputClass = "mt-2 w-full rounded-xl border border-white/10 bg-[#080b18] px-3.5 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-violet-400/60";

  return (
    <main className="grid-bg flex min-h-screen items-center justify-center px-5 py-10">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-7 flex items-center justify-center gap-3" aria-label="FocusLock home">
          <span className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 shadow-lg shadow-violet-500/20">
            <LockKeyhole className="size-5" />
          </span>
          <span>
            <span className="block font-semibold">FocusLock</span>
            <span className="block text-[10px] uppercase tracking-[.22em] text-slate-500">Earn your scroll</span>
          </span>
        </Link>

        <section className="glass rounded-2xl p-6 sm:p-8">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[.18em] text-violet-300">
            {isSignup ? "Start with focus" : "Welcome back"}
          </p>
          <h1 className="text-2xl font-semibold">{isSignup ? "Create your account" : "Log in to FocusLock"}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            {isSignup ? "One account for your focus sessions and learning progress." : "Pick up where your next focused session begins."}
          </p>

          <form action={isSignup ? "/auth/signup" : "/auth/login"} className="mt-6 space-y-4" method="post" onSubmit={handleSubmit}>
            {isSignup && (
              <label className="block text-sm text-slate-300" htmlFor="displayName">
                Display name
                <input
                  id="displayName"
                  name="displayName"
                  type="text"
                  autoComplete="name"
                  minLength={2}
                  maxLength={80}
                  required
                  className={inputClass}
                  placeholder="Your name"
                />
              </label>
            )}
            <label className="block text-sm text-slate-300" htmlFor="email">
              Email
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className={inputClass}
                placeholder="you@example.com"
              />
            </label>
            <label className="block text-sm text-slate-300" htmlFor="password">
              Password
              <input
                id="password"
                name="password"
                type="password"
                autoComplete={isSignup ? "new-password" : "current-password"}
                minLength={isSignup ? 8 : undefined}
                required
                className={inputClass}
                placeholder={isSignup ? "At least 8 characters" : "Your password"}
              />
            </label>

            {feedback && (
              <p
                className={`rounded-xl border px-3.5 py-3 text-sm leading-5 ${feedback.kind === "error" ? "border-rose-400/20 bg-rose-400/5 text-rose-200" : "border-emerald-400/20 bg-emerald-400/5 text-emerald-200"}`}
                role={feedback.kind === "error" ? "alert" : "status"}
              >
                {feedback.message}
              </p>
            )}

            <button
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-blue-500 px-4 py-3 text-sm font-semibold shadow-lg shadow-violet-500/15 transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
              type="submit"
              disabled={pending}
            >
              {pending ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
              {pending ? "Contacting Supabase..." : isSignup ? "Create account" : "Log in"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-slate-400">
            {isSignup ? "Already have an account? " : "New to FocusLock? "}
            <Link className="font-medium text-violet-200 hover:text-white" href={isSignup ? "/login" : "/signup"}>
              {isSignup ? "Log in" : "Create an account"}
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}