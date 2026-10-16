"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertCircle, Brain, CalendarDays, Check, Clock3, LoaderCircle, RotateCw, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

type DashboardView = "overview" | "wallet" | "insights";
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type FocusSession = Database["public"]["Tables"]["focus_sessions"]["Row"];
type QuizAttempt = Database["public"]["Tables"]["quiz_attempts"]["Row"];
type RewardTransaction = Database["public"]["Tables"]["reward_transactions"]["Row"];

type AccountData = {
  email: string;
  profile: Profile | null;
  sessions: FocusSession[];
  quizAttempts: QuizAttempt[];
  rewards: RewardTransaction[];
};

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

async function fetchAllRows<T>(fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>) {
  const pageSize = 500;
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

function sessionSeconds(session: FocusSession) {
  if (session.duration_seconds !== null) return Math.max(0, session.duration_seconds);
  if (!session.ended_at) return 0;
  return Math.max(0, Math.floor((Date.parse(session.ended_at) - Date.parse(session.started_at)) / 1000));
}

function formatDuration(seconds: number) {
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${totalMinutes}m`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getWeeklyFocus(sessions: FocusSession[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - 6 + index);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { date, key, hours: 0 };
  });

  for (const session of sessions) {
    if (session.status !== "completed") continue;
    const startedAt = new Date(session.started_at);
    const key = `${startedAt.getFullYear()}-${String(startedAt.getMonth() + 1).padStart(2, "0")}-${String(startedAt.getDate()).padStart(2, "0")}`;
    const day = days.find((candidate) => candidate.key === key);
    if (day) day.hours += sessionSeconds(session) / 3600;
  }

  return days.map(({ date, hours }) => ({
    day: date.toLocaleDateString(undefined, { weekday: "short" }),
    hours: Number(hours.toFixed(2)),
  }));
}

function Metric({
  icon: Icon,
  label,
  value,
  note,
  tone,
}: {
  icon: typeof Clock3;
  label: string;
  value: string;
  note: string;
  tone: "green" | "blue" | "purple";
}) {
  const iconColor = tone === "green" ? "text-emerald-300" : tone === "blue" ? "text-blue-300" : "text-violet-300";
  return (
    <div className="glass rounded-2xl p-5">
      <div className="mb-5 flex items-center justify-between gap-3 text-sm text-slate-400">
        <span>{label}</span>
        <Icon className={`size-4 shrink-0 ${iconColor}`} />
      </div>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{note}</div>
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-slate-400">{children}</p>;
}

function SectionHeading({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mb-5">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </div>
  );
}

export function AccountDashboard({ view, refreshKey }: { view: DashboardView; refreshKey?: number }) {
  const router = useRouter();
  const [account, setAccount] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadAccount() {
      setLoading(true);
      setError(null);

      try {
        const supabase = createClient();
        const { data: authData, error: authError } = await supabase.auth.getUser();
        if (authError) throw new Error(`Unable to verify your account: ${authError.message}`);
        if (!authData.user) {
          router.replace("/login");
          return;
        }

        const userId = authData.user.id;
        const [profileResult, sessions, quizAttempts, rewards] = await Promise.all([
          supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
          fetchAllRows<FocusSession>((from, to) =>
            supabase.from("focus_sessions").select("*").eq("user_id", userId).order("started_at", { ascending: false }).range(from, to),
          ),
          fetchAllRows<QuizAttempt>((from, to) =>
            supabase.from("quiz_attempts").select("*").eq("user_id", userId).order("created_at", { ascending: false }).range(from, to),
          ),
          fetchAllRows<RewardTransaction>((from, to) =>
            supabase.from("reward_transactions").select("*").eq("user_id", userId).order("created_at", { ascending: false }).range(from, to),
          ),
        ]);

        if (profileResult.error) throw new Error(`Unable to load your profile: ${profileResult.error.message}`);
        if (cancelled) return;

        setAccount({
          email: authData.user.email ?? "",
          profile: profileResult.data,
          sessions,
          quizAttempts,
          rewards,
        });
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load your account activity.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadAccount();
    return () => {
      cancelled = true;
    };
  }, [reloadKey, refreshKey, router]);

  if (loading) {
    return (
      <div className="glass flex min-h-40 items-center justify-center gap-3 rounded-2xl p-6 text-sm text-slate-300" role="status">
        <LoaderCircle className="size-4 animate-spin text-violet-300" /> Loading your account activity...
      </div>
    );
  }

  if (error || !account) {
    return (
      <div className="glass rounded-2xl p-6" role="alert">
        <div className="flex items-start gap-3 text-rose-200">
          <AlertCircle className="mt-0.5 size-5 shrink-0" />
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold">Account activity could not be loaded</h2>
            <p className="mt-1 break-words text-sm text-rose-100/80">{error ?? "No authenticated account data was returned."}</p>
            <button
              type="button"
              onClick={() => setReloadKey((key) => key + 1)}
              className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 hover:bg-white/5"
            >
              <RotateCw className="size-4" /> Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  const displayName = account.profile?.display_name.trim() || account.email || "there";
  const completedSessions = account.sessions.filter((session) => session.status === "completed");
  const totalFocusSeconds = completedSessions.reduce((total, session) => total + sessionSeconds(session), 0);
  const totalQuizScore = account.quizAttempts.reduce((total, attempt) => total + attempt.score, 0);
  const totalQuizQuestions = account.quizAttempts.reduce((total, attempt) => total + attempt.total_questions, 0);
  const quizAccuracy = totalQuizQuestions > 0 ? `${Math.round((totalQuizScore / totalQuizQuestions) * 100)}%` : null;
  const earnedMinutes = account.rewards
    .filter((transaction) => transaction.transaction_type === "earned")
    .reduce((total, transaction) => total + transaction.minutes, 0);
  const spentMinutes = account.rewards
    .filter((transaction) => transaction.transaction_type === "spent")
    .reduce((total, transaction) => total + transaction.minutes, 0);
  const availableMinutes = Math.max(0, earnedMinutes - spentMinutes);
  const weeklyFocus = getWeeklyFocus(account.sessions);

  if (view === "wallet") {
    return (
      <>
        <div className="mb-6">
          <p className="mb-2 text-[11px] font-semibold tracking-[.2em] text-violet-300">EARN YOUR SCROLL</p>
          <h2 className="text-2xl font-semibold">Reward Wallet</h2>
          <p className="mt-1 text-sm text-slate-400">Minutes calculated from your reward transactions.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Metric icon={Wallet} label="Available minutes" value={`${availableMinutes} min`} note="Earned less spent" tone="purple" />
          <Metric icon={Check} label="Total earned" value={`${earnedMinutes} min`} note="From your account ledger" tone="green" />
          <Metric icon={Clock3} label="Total spent" value={`${spentMinutes} min`} note="From your account ledger" tone="blue" />
        </div>
        <section className="glass mt-4 rounded-2xl p-6">
          <SectionHeading title="Reward history" detail="Most recent transactions first" />
          {account.rewards.length === 0 ? (
            <EmptyState>No reward transactions yet. Earned or spent minutes will appear here when recorded.</EmptyState>
          ) : (
            <div>
              {account.rewards.slice(0, 20).map((transaction) => (
                <div className="flex flex-wrap items-center gap-3 border-t border-white/6 py-4 text-sm" key={transaction.id}>
                  <div className="flex size-8 items-center justify-center rounded-lg bg-white/5">
                    <Wallet className="size-4 text-violet-200" />
                  </div>
                  <span className="min-w-32 flex-1 text-slate-300">{transaction.transaction_type === "earned" ? "Minutes earned" : "Minutes spent"}</span>
                  <span className={transaction.transaction_type === "earned" ? "text-emerald-300" : "text-slate-300"}>
                    {transaction.transaction_type === "earned" ? "+" : "−"}{transaction.minutes} min
                  </span>
                  <time className="w-full text-xs text-slate-500 sm:w-auto">{formatDate(transaction.created_at)}</time>
                </div>
              ))}
            </div>
          )}
        </section>
      </>
    );
  }

  if (view === "insights") {
    return (
      <>
        <div className="mb-6">
          <p className="mb-2 text-[11px] font-semibold tracking-[.2em] text-violet-300">YOUR ACTIVITY</p>
          <h2 className="text-2xl font-semibold">Focus Insights</h2>
          <p className="mt-1 text-sm text-slate-400">Insights calculated from your recorded sessions and assessments.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Metric icon={Clock3} label="Completed focus time" value={formatDuration(totalFocusSeconds)} note="Across your recorded sessions" tone="purple" />
          <Metric icon={Check} label="Completed sessions" value={String(completedSessions.length)} note="From your session history" tone="green" />
          <Metric icon={Brain} label="Quiz accuracy" value={quizAccuracy ?? "No attempts"} note={quizAccuracy ? `${account.quizAttempts.length} recorded attempts` : "Complete an assessment to see accuracy"} tone="blue" />
        </div>
        <section className="glass mt-4 rounded-2xl p-6">
          <SectionHeading title="Weekly focus rhythm" detail="Completed focus hours by session start day · last 7 days" />
          {completedSessions.length === 0 ? (
            <EmptyState>No completed focus sessions yet. Your weekly rhythm will appear after your first recorded session.</EmptyState>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={weeklyFocus}>
                  <defs>
                    <linearGradient id="account-insights-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8f7cff" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#8f7cff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: "#68708e", fontSize: 11 }} />
                  <YAxis hide />
                  <Tooltip contentStyle={{ background: "#161b35", border: "1px solid #333b60", borderRadius: 12 }} />
                  <Area type="monotone" dataKey="hours" stroke="#9a8bff" strokeWidth={3} fill="url(#account-insights-fill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </>
    );
  }

  const recentSessions = account.sessions.slice(0, 8);
  const hasWeeklyFocus = weeklyFocus.some((day) => day.hours > 0);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mb-1 text-sm text-violet-300">Welcome back, {displayName}</p>
          <p className="text-xs text-slate-500">Your activity below comes from your authenticated account.</p>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Metric icon={Clock3} label="Completed focus time" value={formatDuration(totalFocusSeconds)} note="Across your recorded sessions" tone="purple" />
        <Metric icon={Check} label="Sessions completed" value={String(completedSessions.length)} note="From your session history" tone="green" />
        <Metric icon={Brain} label="Quiz accuracy" value={quizAccuracy ?? "No attempts"} note={quizAccuracy ? `${account.quizAttempts.length} recorded attempts` : "No quiz attempts recorded"} tone="blue" />
        <Metric icon={Wallet} label="Available minutes" value={`${availableMinutes} min`} note="Earned less spent" tone="purple" />
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
        <section className="glass rounded-2xl p-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">Weekly focus rhythm</h2>
              <p className="mt-1 text-xs text-slate-500">Hours from your completed sessions · last 7 days</p>
            </div>
            {hasWeeklyFocus && <span className="text-xs text-emerald-300">Recorded</span>}
          </div>
          {hasWeeklyFocus ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={weeklyFocus}>
                  <defs>
                    <linearGradient id="account-focus-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8f7cff" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#8f7cff" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: "#68708e", fontSize: 11 }} />
                  <YAxis hide />
                  <Tooltip contentStyle={{ background: "#161b35", border: "1px solid #333b60", borderRadius: 12 }} />
                  <Area type="monotone" dataKey="hours" stroke="#9a8bff" strokeWidth={3} fill="url(#account-focus-fill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState>No completed sessions in the last 7 days. Your focus rhythm will appear here when sessions are recorded.</EmptyState>
          )}
        </section>
        <section className="glass rounded-2xl p-5">
          <SectionHeading title="Recent sessions" detail="Latest records from your account" />
          {recentSessions.length === 0 ? (
            <EmptyState>No focus sessions have been recorded for your account yet.</EmptyState>
          ) : (
            <div>
              {recentSessions.slice(0, 5).map((session) => (
                <div className="flex items-center gap-3 border-t border-white/6 py-3" key={session.id}>
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/5">
                    {session.status === "completed" ? <Check className="size-4 text-emerald-300" /> : <CalendarDays className="size-4 text-violet-300" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm capitalize text-slate-200">{session.status.replace("_", " ")}</div>
                    <time className="text-xs text-slate-500">{formatDate(session.started_at)}</time>
                  </div>
                  <span className="shrink-0 text-xs text-slate-300">{formatDuration(sessionSeconds(session))}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}