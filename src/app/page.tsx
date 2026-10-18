"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Brain, CalendarDays, Check, ChevronRight, CircleHelp, Clock3, Cloud, Code2, Compass, Flame, Gauge, Gem, LayoutDashboard, Leaf, LoaderCircle, LockKeyhole, Menu, Moon, Play, RotateCw, Settings, ShieldCheck, Sparkles, Sprout, Target, TreePine, Trophy, Wallet, X } from "lucide-react";
import AutoVoiceOver, { AUTO_NARRATION_STORAGE_KEY } from "@/components/voice/AutoVoiceOver";
import StudyAssistantChat from "@/components/study/StudyAssistantChat";
import LazyAvatarStage from "@/components/avatar/LazyAvatarStage";
import DiscoverFeed from "@/components/aurasync/DiscoverFeed";
import { SAMPLE_EXPLANATIONS } from "@/data/sampleExplanations";
import dynamic from "next/dynamic";
import type { CodeHighlight, CanvasAction } from "@/lib/ai/structured-response";
import { AuthControls } from "@/components/auth-controls";
import { AccountDashboard } from "@/components/account-dashboard";
import { createClient } from "@/lib/supabase/client";
import { abandonFocusSession, completeFocusSession, createFocusSession } from "@/lib/supabase/focus-timer";
import { AiLearningLab } from "@/components/ai-learning-lab";
import { useExtensionStatus } from "@/lib/extension/status-bridge";
import { BlockedWebsitesSettings } from "@/components/blocked-websites-settings";

const LiveCodeCanvasPanel = dynamic(
  () => import("@/components/study/LiveCodeCanvasPanel"),
  { ssr: false },
);

const CodeVisionWorkspace = dynamic(
  () => import("@/components/codevision/CodeVisionWorkspace"),
  { ssr: false },
);

type Page = "Dashboard" | "Discover" | "Focus Missions" | "Focus Session" | "AI Learning Lab" | "CodeVision" | "Skill Tree" | "Focus Garden" | "Reward Wallet" | "Focus Insights" | "Settings";
const nav: {label: Page; icon: React.ElementType}[] = [
  {label:"Dashboard",icon:LayoutDashboard},{label:"Discover",icon:Compass},{label:"Focus Missions",icon:Target},{label:"Focus Session",icon:Clock3},{label:"AI Learning Lab",icon:Brain},{label:"CodeVision",icon:Code2},{label:"Skill Tree",icon:Gem},{label:"Focus Garden",icon:Leaf},{label:"Reward Wallet",icon:Wallet},{label:"Focus Insights",icon:Gauge},{label:"Settings",icon:Settings}
];
const chartData = [{day:"Mon",hours:1.6},{day:"Tue",hours:2.3},{day:"Wed",hours:1.8},{day:"Thu",hours:3.1},{day:"Fri",hours:2.4},{day:"Sat",hours:3.8},{day:"Sun",hours:2.8}];
const missions = [{title:"Conquer Linked Lists",subject:"Data Structures",level:"Intermediate",time:"25 min",reward:"10 min",progress:72,color:"#8f7cff"},{title:"Vectors & Embeddings",subject:"Machine Learning",level:"Advanced",time:"45 min",reward:"20 min",progress:0,color:"#5aa8ff"},{title:"The Art of Recursion",subject:"Algorithms",level:"Beginner",time:"15 min",reward:"5 min",progress:35,color:"#53d2ac"}];
const concepts = [{name:"Linked-list insertion",value:86,status:"Strong",action:"Keep practicing"},{name:"Pointer manipulation",value:61,status:"Improving",action:"Review examples"},{name:"Memory allocation",value:38,status:"Needs revision",action:"Start a review"}];

function ProgressRing({value, size=92}:{value:number;size?:number}) { const r=(size-10)/2, c=2*Math.PI*r; return <div className="relative shrink-0" style={{width:size,height:size}}><svg width={size} height={size} className="-rotate-90"><circle cx={size/2} cy={size/2} r={r} stroke="#252c4b" strokeWidth="7" fill="none"/><circle cx={size/2} cy={size/2} r={r} stroke="#9584ff" strokeWidth="7" fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c-(value/100)*c}/></svg><span className="absolute inset-0 flex items-center justify-center text-sm font-semibold">{value}%</span></div> }
function Pill({children, tone="muted"}:{children:React.ReactNode;tone?:"muted"|"purple"|"green"|"blue"}) { const styles={muted:"bg-white/5 text-slate-300",purple:"bg-violet-400/10 text-violet-200",green:"bg-emerald-400/10 text-emerald-300",blue:"bg-blue-400/10 text-blue-200"}; return <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${styles[tone]}`}>{children}</span> }

export default function FocusLock() {
  const [active, setActive] = useState<Page>("Dashboard");
  const [previousStudyPage, setPreviousStudyPage] = useState<Page>("AI Learning Lab");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [duration, setDuration] = useState(25);
  const [minutes, setMinutes] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0);
  const extensionStatus = useExtensionStatus();

  const [quiz, setQuiz] = useState(false);
  const [answers, setAnswers] = useState<Record<number, string>>({});

  const activeSessionIdRef = useRef<string | null>(null);
  const isCompletingRef = useRef(false);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  const handleCompleteFocus = useCallback(async () => {
    if (isCompletingRef.current) return;
    isCompletingRef.current = true;
    setRunning(false);
    setIsSaving(true);
    setSessionError(null);

    const sessionId = activeSessionIdRef.current;
    if (!sessionId) {
      setCompleted(true);
      setIsSaving(false);
      isCompletingRef.current = false;
      return;
    }

    try {
      const plannedDuration = duration * 60;
      await completeFocusSession(sessionId, plannedDuration);
      activeSessionIdRef.current = null;
      setActiveSessionId(null);
      setCompleted(true);
      setSaveSuccess(true);
      setDashboardRefreshKey((k) => k + 1);
    } catch (err) {
      setSessionError(err instanceof Error ? err.message : "Failed to save completed session.");
      setSaveSuccess(false);
      setCompleted(true);
    } finally {
      setIsSaving(false);
      isCompletingRef.current = false;
    }
  }, [duration]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setMinutes((prev) => {
        if (prev <= 1) {
          clearInterval(id);
          void handleCompleteFocus();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, handleCompleteFocus]);

  async function handleStartFocus() {
    if (isSaving) return;
    setSessionError(null);
    if (activeSessionIdRef.current) {
      setRunning(true);
      return;
    }
    setIsSaving(true);
    try {
      const supabase = createClient();
      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError || !authData.user) {
        throw new Error("You must be logged in to start a focus session.");
      }
      const session = await createFocusSession(authData.user.id);
      activeSessionIdRef.current = session.id;
      setActiveSessionId(session.id);
      setCompleted(false);
      setSaveSuccess(false);
      setRunning(true);
    } catch (err) {
      setSessionError(err instanceof Error ? err.message : "Unable to start session.");
    } finally {
      setIsSaving(false);
    }
  }

  function handlePauseFocus() {
    setRunning(false);
  }

  async function handleResetFocus() {
    if (isSaving) return;
    setRunning(false);
    setSessionError(null);
    const sessionId = activeSessionIdRef.current;
    if (sessionId) {
      setIsSaving(true);
      try {
        const elapsed = Math.max(0, duration * 60 - minutes);
        await abandonFocusSession(sessionId, elapsed);
        setDashboardRefreshKey((k) => k + 1);
      } catch (err) {
        setSessionError(err instanceof Error ? err.message : "Unable to record abandoned session.");
      } finally {
        setIsSaving(false);
      }
    }
    activeSessionIdRef.current = null;
    setActiveSessionId(null);
    setMinutes(duration * 60);
    setCompleted(false);
    setSaveSuccess(false);
  }

  async function handleChangeDuration(newDuration: number) {
    if (newDuration === duration && minutes === duration * 60) return;
    if (isSaving) return;
    const sessionId = activeSessionIdRef.current;
    if (sessionId) {
      setIsSaving(true);
      try {
        const elapsed = Math.max(0, duration * 60 - minutes);
        await abandonFocusSession(sessionId, elapsed);
        setDashboardRefreshKey((k) => k + 1);
      } catch { /* continue */ } finally {
        setIsSaving(false);
      }
    }
    activeSessionIdRef.current = null;
    setActiveSessionId(null);
    setDuration(newDuration);
    setMinutes(newDuration * 60);
    setRunning(false);
    setCompleted(false);
    setSaveSuccess(false);
    setSessionError(null);
  }

  function handleRetryComplete() {
    void handleCompleteFocus();
  }

  const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const title = active === "Discover" ? "AuraSync Discovery" : active === "Dashboard" ? "Good morning, Alex" : active;

  const handleNav = (label: Page) => {
    if (active !== "Discover" && (active === "AI Learning Lab" || active === "Focus Session" || active === "Focus Missions" || active === "Dashboard")) {
      setPreviousStudyPage(active);
    }
    setActive(label);
    setMobileOpen(false);
  };

  return (
    <div className="min-h-screen bg-[#080b18] text-white">
      <div className="flex min-h-screen">
        <aside className={`${mobileOpen ? "fixed inset-y-0 left-0 z-20 flex" : "hidden"} w-64 shrink-0 flex-col border-r border-white/8 bg-[#0b0f22] lg:flex`}>
          <div className="flex h-20 items-center gap-3 px-6">
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-blue-500 shadow-lg shadow-violet-500/20">
              <LockKeyhole className="size-5" />
            </div>
            <div>
              <div className="font-semibold tracking-tight">FocusLock</div>
              <div className="text-[10px] uppercase tracking-[.22em] text-slate-500">Earn your scroll</div>
            </div>
          </div>
          <nav className="flex flex-1 flex-col gap-1 px-3 py-5">
            {nav.map(({ label, icon: Icon }) => (
              <button
                key={label}
                onClick={() => handleNav(label)}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition ${active === label ? "bg-violet-500/15 text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"}`}
              >
                <Icon className="size-[17px]" />
                <span>{label}</span>
                {label === "Discover" && <Pill tone="purple">AURASYNC</Pill>}
                {label === "AI Learning Lab" && <Pill tone="purple">DEMO</Pill>}
                {label === "CodeVision" && <Pill tone="blue">NEW</Pill>}
              </button>
            ))}
          </nav>
          <div className="m-3 rounded-2xl border border-violet-400/15 bg-violet-400/5 p-4">
            <div className="mb-2 flex items-center gap-2 text-xs text-violet-200"><Sparkles className="size-3.5"/> Focus streak</div>
            <div className="flex items-end justify-between"><strong className="text-2xl">7 days</strong><Flame className="mb-1 size-5 text-orange-300"/></div>
            <div className="mt-2 h-1.5 rounded-full bg-white/10"><div className="h-full w-4/5 rounded-full bg-gradient-to-r from-violet-400 to-blue-400"/></div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="flex h-20 items-center justify-between border-b border-white/8 px-5 sm:px-8">
            <div className="flex items-center gap-3">
              <button className="lg:hidden" onClick={() => setMobileOpen(true)}><Menu className="size-5"/></button>
              <div className="text-sm text-slate-500">Workspace <ChevronRight className="mx-1 inline size-3"/> <span className="text-slate-200">{active}</span></div>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300 sm:flex"><Cloud className="size-3.5 text-emerald-300"/> Demo mode</div>
              <AuthControls />
            </div>
          </header>

          <div className="grid-bg min-h-[calc(100vh-5rem)] p-5 sm:p-8">
            <div className="mx-auto max-w-7xl">
              <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="mb-2 text-sm text-violet-300">Wednesday, October 15, 2026</p>
                  <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
                  <p className="mt-1 text-sm text-slate-400">Your attention is your superpower.</p>
                </div>
                {active !== "Discover" && (
                  <button onClick={() => setActive("Focus Session")} className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-blue-500 px-4 py-2.5 text-sm font-semibold shadow-lg shadow-violet-500/20 hover:brightness-110">
                    <Play className="size-4 fill-current"/> Start today&apos;s mission
                  </button>
                )}
                {active === "Discover" && (
                  <button onClick={() => setActive(previousStudyPage)} className="flex items-center gap-2 rounded-xl border border-violet-400/30 bg-violet-500/10 px-4 py-2.5 text-sm font-medium text-violet-100 hover:bg-violet-500/20">
                    <Brain className="size-4 text-violet-300"/> Back to {previousStudyPage}
                  </button>
                )}
              </div>

              {active === "Dashboard" && <AccountDashboard view="overview" refreshKey={dashboardRefreshKey} />}
              {active === "Discover" && <DiscoverFeed onReturnToStudy={() => setActive(previousStudyPage)} />}
              {active === "CodeVision" && <CodeVisionWorkspace />}
              {active === "Focus Missions" && <Missions setActive={setActive} />}
              {active === "Focus Session" && (
                <Session
                  time={time}
                  duration={duration}
                  minutes={minutes}
                  running={running}
                  activeSessionId={activeSessionId}
                  isSaving={isSaving}
                  sessionError={sessionError}
                  completed={completed}
                  saveSuccess={saveSuccess}
                  onStart={handleStartFocus}
                  onPause={handlePauseFocus}
                  onReset={handleResetFocus}
                  onChangeDuration={handleChangeDuration}
                  onRetryComplete={handleRetryComplete}
                />
              )}
              {active === "AI Learning Lab" && (
                <>
                  <Quiz quiz={quiz} setQuiz={setQuiz} answers={answers} setAnswers={setAnswers} />
                  <div className="mt-6">
                    <AiLearningLab
                      onQuizComplete={() => setDashboardRefreshKey((k) => k + 1)}
                      activeSessionId={activeSessionId}
                    />
                  </div>
                </>
              )}
              {active === "Skill Tree" && <SkillTree />}
              {active === "Focus Garden" && <Garden />}
              {active === "Reward Wallet" && <AccountDashboard view="wallet" refreshKey={dashboardRefreshKey} />}
              {active === "Focus Insights" && <AccountDashboard view="insights" refreshKey={dashboardRefreshKey} />}
              {active === "Settings" && <SettingsPage status={extensionStatus} onRefresh={extensionStatus.refresh} />}

              <div className="mt-6 text-center text-xs text-slate-600">
                FocusLock prototype · Demo data only · {extensionStatus.state === "authenticated" ? "Extension connected" : "No extension connected"}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function Dashboard({setActive}:{setActive:(p:Page)=>void}) { return <><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><div className="glass rounded-2xl p-5"><div className="mb-4 flex items-center justify-between text-sm text-slate-400">Daily progress <Target className="size-4 text-violet-300"/></div><div className="flex items-center gap-4"><ProgressRing value={68}/><div><div className="text-2xl font-semibold">2h 42m</div><div className="text-xs text-slate-500">of 4h goal</div></div></div></div><Stat icon={Check} label="Sessions completed" value="4" note="+2 this week" tone="green"/><Stat icon={Brain} label="Quiz accuracy" value="84%" note="Top 12% this month" tone="blue"/><Stat icon={Wallet} label="Entertainment time" value="42 min" note="Available to spend" tone="purple"/></div><div className="mt-4 grid gap-4 xl:grid-cols-[1.35fr_.65fr]"><section className="glass rounded-2xl p-5"><div className="mb-5 flex items-center justify-between"><div><h2 className="font-semibold">Weekly focus rhythm</h2><p className="mt-1 text-xs text-slate-500">Hours of deep work · last 7 days</p></div><Pill tone="green">On track</Pill></div><div className="h-56"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData}><defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8f7cff" stopOpacity={.35}/><stop offset="100%" stopColor="#8f7cff" stopOpacity={0}/></linearGradient></defs><XAxis dataKey="day" axisLine={false} tickLine={false} tick={{fill:"#68708e",fontSize:11}}/><YAxis hide/><Tooltip contentStyle={{background:"#161b35",border:"1px solid #333b60",borderRadius:12}}/><Area type="monotone" dataKey="hours" stroke="#9a8bff" strokeWidth={3} fill="url(#fill)"/></AreaChart></ResponsiveContainer></div></section><section className="glass rounded-2xl p-5"><div className="mb-5 flex items-center justify-between"><div><h2 className="font-semibold">Today&apos;s mission</h2><p className="mt-1 text-xs text-slate-500">Your next best step</p></div><Pill tone="purple">In progress</Pill></div><h3 className="text-lg font-medium">Conquer Linked Lists</h3><p className="mt-2 text-sm leading-6 text-slate-400">Master insertion, deletion, and pointer manipulation.</p><div className="mt-5 flex items-center justify-between text-xs text-slate-400"><span>72% complete</span><span>25 min</span></div><div className="mt-2 h-2 rounded-full bg-white/8"><div className="h-full w-[72%] rounded-full bg-gradient-to-r from-violet-400 to-blue-400"/></div><button onClick={()=>setActive("Focus Session")} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl border border-violet-400/30 bg-violet-400/10 py-2.5 text-sm font-medium text-violet-100 hover:bg-violet-400/20">Continue mission <ChevronRight className="size-4"/></button></section></div><div className="mt-4 grid gap-4 lg:grid-cols-2"><section className="glass rounded-2xl p-5"><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">Recent activity</h2><button className="text-xs text-violet-300">View all</button></div>{["Completed Focus Session","Passed Linked Lists quiz","Unlocked 7 day streak"].map((x,i)=><div className="flex items-center gap-3 border-t border-white/6 py-3" key={x}><div className="flex size-8 items-center justify-center rounded-lg bg-white/5"><Check className="size-4 text-emerald-300"/></div><div className="flex-1 text-sm">{x}<div className="text-xs text-slate-500">{i+1} hour{i?"s":""} ago</div></div><ChevronRight className="size-4 text-slate-600"/></div>)}</section><section className="glass rounded-2xl p-5"><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">Weak concepts</h2><button onClick={()=>setActive("AI Learning Lab")} className="text-xs text-violet-300">Review now</button></div>{concepts.map(c=><div key={c.name} className="mb-4"><div className="mb-2 flex justify-between text-sm"><span>{c.name}</span><span className={c.value>75?"text-emerald-300":c.value>50?"text-amber-300":"text-rose-300"}>{c.status}</span></div><div className="h-1.5 rounded-full bg-white/8"><div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-blue-400" style={{width:`${c.value}%`}}/></div></div>)}</section></div></> }
function Stat({icon:Icon,label,value,note,tone}:{icon:React.ElementType;label:string;value:string;note:string;tone:"green"|"blue"|"purple"}) { return <div className="glass rounded-2xl p-5"><div className="mb-5 flex items-center justify-between text-sm text-slate-400">{label}<Icon className={`size-4 ${tone==="green"?"text-emerald-300":tone==="blue"?"text-blue-300":"text-violet-300"}`}/></div><div className="text-2xl font-semibold">{value}</div><div className="mt-1 text-xs text-slate-500">{note}</div></div> }
function Missions({setActive}:{setActive:(p:Page)=>void}) { return <><SectionHead eyebrow="LEARNING PATH" title="Focus Missions" copy="Turn your goals into small, winnable challenges."/><div className="grid gap-4 lg:grid-cols-3">{missions.map((m,i)=><div key={m.title} className="glass rounded-2xl p-5"><div className="mb-5 flex items-center justify-between"><Pill tone={i===0?"purple":i===1?"blue":"green"}>{m.subject}</Pill><span className="text-xs text-slate-500">{m.time}</span></div><h3 className="text-lg font-semibold">{m.title}</h3><p className="mt-2 min-h-12 text-sm leading-6 text-slate-400">Build practical confidence through a focused study sprint and assessment.</p><div className="mt-5 flex items-center gap-2 text-xs text-slate-400"><Trophy className="size-4 text-amber-300"/> Earn {m.reward} scroll time</div><div className="mt-4 h-1.5 rounded-full bg-white/8"><div className="h-full rounded-full" style={{width:`${m.progress}%`,background:m.color}}/></div><button onClick={()=>setActive("Focus Session")} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-white/8 py-2.5 text-sm font-medium hover:bg-white/12">{m.progress?"Continue mission":"Start mission"}<ChevronRight className="size-4"/></button></div>)}</div></> }
function SectionHead({eyebrow,title,copy}:{eyebrow:string;title:string;copy:string}) { return <div className="mb-6"><div className="mb-2 text-[11px] font-semibold tracking-[.2em] text-violet-300">{eyebrow}</div><h2 className="text-2xl font-semibold">{title}</h2><p className="mt-1 text-sm text-slate-400">{copy}</p></div> }

// Karthik's authenticated Session component
function Session({time,duration,minutes,running,activeSessionId,isSaving,sessionError,completed,saveSuccess,onStart,onPause,onReset,onChangeDuration,onRetryComplete}:{time:string;duration:number;minutes:number;running:boolean;activeSessionId:string|null;isSaving:boolean;sessionError:string|null;completed:boolean;saveSuccess:boolean;onStart:()=>void;onPause:()=>void;onReset:()=>void;onChangeDuration:(n:number)=>void;onRetryComplete:()=>void}) {
  return <><SectionHead eyebrow="DEEP WORK" title="Focus Session" copy="One clear objective. Everything else can wait."/>
  {sessionError && <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-rose-400/20 bg-rose-500/8 px-4 py-3 text-xs text-rose-300"><span>{sessionError}</span>{completed&&<button onClick={onRetryComplete} className="flex items-center gap-1 rounded-lg bg-rose-500/20 px-3 py-1.5 font-semibold hover:bg-rose-500/30"><RotateCw className="size-3.5"/> Retry</button>}</div>}
  <div className="grid gap-4 xl:grid-cols-[1fr_.7fr]"><section className="glass grid-bg rounded-2xl p-8 text-center"><Pill tone="purple">Conquer Linked Lists · Objective 2 of 3</Pill><div className="relative mx-auto my-8 flex size-64 items-center justify-center rounded-full shadow-[0_0_80px_rgba(139,92,246,.12)]"><ProgressRing value={Math.round((1-minutes/(duration*60))*100)} size={256}/><div className="absolute"><div className="text-5xl font-semibold tracking-tight">{time}</div><div className="mt-2 text-xs text-slate-500">{running?"In focus":completed?"Session complete":"Ready when you are"}</div></div></div><div className="mx-auto flex max-w-sm flex-wrap justify-center gap-2">{[5,15,25,45].map(n=><button key={n} onClick={()=>onChangeDuration(n)} disabled={running||isSaving} className={`rounded-lg px-3 py-2 text-xs disabled:opacity-40 ${duration===n?"bg-violet-400/20 text-violet-100":"bg-white/5 text-slate-400"}`}>{n} min</button>)}</div><div className="mt-5 flex justify-center gap-3">{!running&&!completed&&<button onClick={onStart} disabled={isSaving} className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-blue-500 px-6 py-3 text-sm font-semibold disabled:opacity-50">{isSaving?<LoaderCircle className="size-4 animate-spin"/>:<Play className="size-4 fill-current"/>}{isSaving?"Saving…":"Start focus"}</button>}{running&&<button onClick={onPause} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-6 py-3 text-sm font-semibold">Pause</button>}{(running||(!completed&&minutes<duration*60))&&<button onClick={onReset} disabled={isSaving} className="rounded-xl border border-white/10 px-4 text-sm text-slate-300 disabled:opacity-40">Reset</button>}</div>{completed&&<div className={`mt-5 rounded-xl border p-3 text-sm ${saveSuccess?"border-emerald-400/20 bg-emerald-400/10 text-emerald-200":"border-amber-400/20 bg-amber-400/10 text-amber-200"}`}>{saveSuccess?"Session saved! Assessment pending before rewards unlock.":"Session complete. Could not save — check connection."}</div>}{activeSessionId&&<div className="mt-3 text-[10px] text-slate-600 font-mono">Session {activeSessionId.slice(0,8)}…</div>}</section><section className="glass rounded-2xl p-6"><h3 className="font-semibold">Session intention</h3><label className="mt-5 block text-xs text-slate-400">What are you focusing on?</label><input defaultValue="Linked list insertion and deletion" className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm outline-none focus:border-violet-400/60"/><label className="mt-5 block text-xs text-slate-400">Today&apos;s objective</label><div className="mt-2 rounded-xl border border-violet-400/15 bg-violet-400/5 p-4 text-sm leading-6 text-slate-300">Understand how nodes move through a linked list without losing the head reference.</div><div className="mt-6 flex items-center gap-3 text-xs text-slate-500"><ShieldCheck className="size-4 text-emerald-300"/> Rewards are held until assessment passes.</div></section></div></>
}

function Quiz({quiz,setQuiz,answers,setAnswers}:{quiz:boolean;setQuiz:(x:boolean)=>void;answers:Record<number,string>;setAnswers:React.Dispatch<React.SetStateAction<Record<number,string>>>}) {
  const questions=["What does the head pointer reference?","Which operation is O(1) with a known node?"];
  const [topicId,setTopicId]=useState(SAMPLE_EXPLANATIONS[0].id);
  const [narrationEnabled,setNarrationEnabled]=useState(false);
  const [latestAssistantAnswer,setLatestAssistantAnswer]=useState("");
  const [isAssistantThinking,setIsAssistantThinking]=useState(false);
  // Panel state — kept here so it survives chat re-renders
  const [panelCode,setPanelCode]=useState<string|null>(null);
  const [panelLang,setPanelLang]=useState<string|null>(null);
  const [panelHighlights,setPanelHighlights]=useState<CodeHighlight[]>([]);
  const [panelCanvas,setPanelCanvas]=useState<CanvasAction|null>(null);
  const [pendingExplain,setPendingExplain]=useState<string|null>(null);
  const explanation=SAMPLE_EXPLANATIONS.find((item)=>item.id===topicId)??SAMPLE_EXPLANATIONS[0];

  useEffect(()=>{ try { setNarrationEnabled(window.localStorage.getItem(AUTO_NARRATION_STORAGE_KEY)==="true"); } catch { /* private mode */ } },[]);

  const handleStructured = useCallback((data:{code:string|null;language:string|null;highlights:CodeHighlight[];canvasAction:CanvasAction|null})=>{
    if(data.code) { setPanelCode(data.code); setPanelLang(data.language); setPanelHighlights(data.highlights); }
    if(data.canvasAction) setPanelCanvas(data.canvasAction);
  },[]);

  const handleExplainLine = useCallback((lineNum:number, lineText:string)=>{
    setPendingExplain(`Explain line ${lineNum} of the code: \`${lineText}\``);
  },[]);

  const handleExplainNode = useCallback((nodeId:string, nodeValue:string|number, type:string)=>{
    setPendingExplain(`In the ${type.replace("_"," ")} diagram, explain the node with value "${nodeValue}" (id: ${nodeId}).`);
  },[]);

  return <>
    <SectionHead eyebrow="DEMO ASSESSMENT" title="AI Learning Lab" copy="Ask questions, see code, and watch data structures come to life."/>
    <div className="mb-5 flex items-center gap-2 rounded-xl border border-blue-400/15 bg-blue-400/5 px-4 py-3 text-xs text-blue-200"><CircleHelp className="size-4"/> Demo questions are used until the FastAPI learning service is connected.</div>
    <div className="mb-5 max-w-3xl"><LazyAvatarStage latestAnswer={latestAssistantAnswer} isThinking={isAssistantThinking} /></div>
    <section className="glass mb-5 max-w-3xl rounded-2xl p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div><div className="text-[11px] font-semibold tracking-[.2em] text-violet-300">LEARNING EXPLANATION</div><h3 className="mt-1 font-semibold">Read or listen to a sample lesson</h3><p className="mt-1 text-xs text-slate-500">Sample educational text for voice-over testing.</p></div>
        <label className="text-xs text-slate-400">Topic<select aria-label="Sample explanation topic" className="mt-1 block rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 outline-none focus:border-violet-400/60" value={topicId} onChange={(event)=>setTopicId(event.target.value)}>{SAMPLE_EXPLANATIONS.map((item)=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      </div>
      <p className="mb-4 text-sm leading-6 text-slate-300">{explanation.text}</p>
      <AutoVoiceOver text={explanation.text} enabled={narrationEnabled} onEnabledChange={setNarrationEnabled} instanceId="learning-lab-lesson" />
    </section>

    {/* Chat + panel side-by-side on large screens */}
    <div className="mb-5 grid gap-4 xl:grid-cols-[1fr_420px]">
      <StudyAssistantChat
        narrationEnabled={narrationEnabled}
        onNarrationEnabledChange={setNarrationEnabled}
        onAnswerReady={setLatestAssistantAnswer}
        onLoadingChange={setIsAssistantThinking}
        onStructuredResponse={handleStructured}
        pendingMessage={pendingExplain}
        onPendingMessageConsumed={()=>setPendingExplain(null)}
      />
      <LiveCodeCanvasPanel
        code={panelCode}
        language={panelLang}
        highlights={panelHighlights}
        canvasAction={panelCanvas}
        isLoading={isAssistantThinking}
        onExplainLine={handleExplainLine}
        onExplainNode={handleExplainNode}
      />
    </div>

    {!quiz?<div className="glass max-w-2xl rounded-2xl p-6"><label className="block text-sm text-slate-300">Topic</label><input defaultValue="Linked Lists" className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3 outline-none focus:border-violet-400/60"/><div className="mt-5 grid gap-4 sm:grid-cols-2"><label className="text-sm text-slate-300">Difficulty<select className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3"><option>Intermediate</option><option>Beginner</option><option>Advanced</option></select></label><label className="text-sm text-slate-300">Questions<select className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3"><option>5 questions</option><option>10 questions</option></select></label></div><button onClick={()=>setQuiz(true)} className="mt-6 rounded-xl bg-gradient-to-r from-violet-500 to-blue-500 px-5 py-3 text-sm font-semibold">Generate demo quiz <Sparkles className="ml-2 inline size-4"/></button></div>:<div className="grid gap-4 lg:grid-cols-2">{questions.map((q,i)=><div className="glass rounded-2xl p-6" key={q}><div className="mb-4 flex justify-between text-xs text-slate-500">Question {i+1} of 2 <Pill tone="purple">Multiple choice</Pill></div><h3 className="font-medium leading-6">{q}</h3><div className="mt-5 flex flex-col gap-2">{["The first node in the list","The last node in the list","The current index","The list length"].map(o=><button key={o} onClick={()=>setAnswers(a=>({...a,[i]:o}))} className={`rounded-xl border p-3 text-left text-sm ${answers[i]===o?"border-violet-400/60 bg-violet-400/10 text-violet-100":"border-white/8 bg-white/3 text-slate-400 hover:bg-white/7"}`}>{o}</button>)}</div></div>)}<div className="glass rounded-2xl p-6 lg:col-span-2"><button onClick={()=>setQuiz(false)} className="rounded-xl bg-gradient-to-r from-violet-500 to-blue-500 px-5 py-3 text-sm font-semibold">Submit assessment</button><p className="mt-3 text-xs text-slate-500">Answer both questions to see your demo score.</p></div></div>}
  </>;
}

function SkillTree(){return <><SectionHead eyebrow="YOUR ROADMAP" title="Skill Tree" copy="Every strong skill starts as a small, consistent habit."/><div className="glass rounded-2xl p-6"><div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">{["Programming","Data Structures","Algorithms","Machine Learning","Deep Learning"].map((x,i)=><div key={x} className="relative rounded-2xl border border-white/8 bg-white/3 p-4"><div className={`mb-5 flex size-12 items-center justify-center rounded-2xl ${i<2?"bg-violet-400/15 text-violet-200":"bg-white/5 text-slate-500"}`}>{i<2?<Check className="size-5"/>:<LockKeyhole className="size-5"/>}</div><div className="text-sm font-medium">{x}</div><div className="mt-2 text-xs text-slate-500">{i===0?"Completed":i===1?"In progress":"Locked"}</div>{i<4&&<div className="absolute right-[-21px] top-10 hidden h-px w-5 bg-violet-400/30 lg:block"/>}</div>)}</div></div></>}
function Garden(){return <><SectionHead eyebrow="GROW YOUR FOCUS" title="Focus Garden" copy="Every completed session plants a little proof of progress."/><div className="glass rounded-2xl p-8"><div className="flex min-h-72 items-end justify-center gap-5 rounded-2xl bg-gradient-to-b from-[#111a36] to-[#0d2a2a] p-8"><div className="text-center"><Sprout className="mx-auto mb-2 size-10 text-emerald-300"/><div className="text-xs text-emerald-200">New seed</div></div><div className="text-center"><Sprout className="mx-auto mb-2 size-14 text-emerald-300"/><div className="text-xs text-emerald-200">3 sessions</div></div><div className="text-center"><TreePine className="mx-auto mb-2 size-20 text-emerald-200"/><div className="text-xs text-emerald-200">Quiz passed</div></div><div className="flex size-20 items-center justify-center rounded-full border border-dashed border-white/15 text-xs text-slate-500">Plant next</div></div><div className="mt-5 flex items-center justify-between text-sm"><span className="text-slate-400">Garden level 2 · 3 of 5 plants grown</span><button className="rounded-xl bg-emerald-400/10 px-4 py-2 text-emerald-200">Plant a seed</button></div></div></>}
function WalletPage(){return <><SectionHead eyebrow="EARN YOUR SCROLL" title="Reward Wallet" copy="Entertainment time is earned through focused learning."/><div className="grid gap-4 md:grid-cols-3"><Stat icon={Wallet} label="Available minutes" value="42 min" note="Expires in 6 days" tone="purple"/><Stat icon={Trophy} label="Total earned" value="180 min" note="Across 21 sessions" tone="green"/><Stat icon={Clock3} label="Pending assessment" value="10 min" note="Complete your quiz" tone="blue"/></div><div className="glass mt-4 rounded-2xl p-6"><h3 className="font-semibold">Reward history</h3>{["Linked Lists · 10 minutes earned","Focus streak · 15 minutes earned","Graph traversal · Assessment pending"].map((x,i)=><div className="flex items-center gap-3 border-t border-white/6 py-4 text-sm" key={x}><div className="flex size-8 items-center justify-center rounded-lg bg-white/5"><Trophy className="size-4 text-amber-300"/></div><span className="flex-1">{x}</span><Pill tone={i===2?"muted":"green"}>{i===2?"Pending":"Granted"}</Pill></div>)}</div></>}
function Insights(){return <><SectionHead eyebrow="UNDERSTAND YOUR RHYTHM" title="Focus Insights" copy="Patterns from your demo activity, designed to become real once connected."/><div className="grid gap-4 md:grid-cols-3"><Stat icon={Clock3} label="Weekly study" value="17.8h" note="+18% vs last week" tone="purple"/><Stat icon={Target} label="Consistency" value="82%" note="Best day: Saturday" tone="green"/><Stat icon={Brain} label="Avg. accuracy" value="84%" note="+6% this month" tone="blue"/></div><div className="glass mt-4 rounded-2xl p-6"><h3 className="mb-5 font-semibold">Study duration</h3><div className="h-64"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData}><XAxis dataKey="day" axisLine={false} tickLine={false} tick={{fill:"#68708e",fontSize:11}}/><YAxis axisLine={false} tickLine={false} tick={{fill:"#68708e",fontSize:11}}/><Tooltip contentStyle={{background:"#161b35",border:"1px solid #333b60",borderRadius:12}}/><Area type="monotone" dataKey="hours" stroke="#58cdb0" fill="#58cdb0" fillOpacity={.12}/></AreaChart></ResponsiveContainer></div></div></>}
function SettingsPage({status,onRefresh}:{status:{state:string;refresh:()=>void};onRefresh:()=>void}){return <><SectionHead eyebrow="PREFERENCES" title="Settings" copy="Shape FocusLock around the way you learn best."/><div className="glass max-w-2xl rounded-2xl p-6"><div className="flex flex-col gap-5">{[["Daily learning goal","4 hours"],["Preferred session duration","25 minutes"],["Quiz passing threshold","80%"]].map(([l,v])=><label className="flex items-center justify-between gap-4 border-b border-white/6 pb-5 text-sm" key={l}><span className="text-slate-300">{l}</span><select className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-slate-200"><option>{v}</option><option>30 minutes</option><option>90%</option></select></label>)}<label className="flex items-center justify-between text-sm"><span><span className="block text-slate-300">Focus Guardian</span><span className="text-xs text-slate-500">{status.state==="authenticated"?"Extension connected":"The Chrome extension is not connected."}</span></span><span className={`rounded-full px-3 py-1.5 text-xs ${status.state==="authenticated"?"bg-emerald-400/10 text-emerald-200":"bg-amber-400/10 text-amber-200"}`}>{status.state==="authenticated"?"Connected":"Not connected"}</span></label></div><div className="mt-4 flex gap-3"><button className="mt-3 rounded-xl bg-gradient-to-r from-violet-500 to-blue-500 px-5 py-3 text-sm font-semibold">Save preferences</button>{status.state!=="authenticated"&&<button onClick={onRefresh} className="mt-3 rounded-xl border border-white/10 px-5 py-3 text-sm text-slate-300 hover:bg-white/5">Retry connection</button>}</div></div><BlockedWebsitesSettings /></>}
