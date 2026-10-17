import { useCallback, useEffect, useRef, useState } from "react";
import {
  BrowserRouter,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Brain,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  Coffee,
  Compass,
  Flame,
  Lightbulb,
  LoaderCircle,
  MessageCircle,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Send,
  Settings2,
  ShieldAlert,
  Sparkles,
  Sprout,
  Sun,
  Timer,
  Trash2,
} from "lucide-react";
import {
  useCompanionChat,
  useDashboardData,
  useLogFocusSession,
  useSaveSettings,
  useSubmitQuiz,
} from "./lib/api-hooks.jsx";
import {
  formatTimer,
  makeTimer,
  pauseTimer,
  readTimer,
  remainingSeconds,
  saveTimer,
  startTimer,
} from "./lib/timer.js";
import { SAMPLE_QUESTIONS, scoreQuiz } from "./lib/quiz.js";

const DEFAULT_SETTINGS = { focus_minutes: 25, break_minutes: 5, blocked_sites: [] };
const PAUSED_FOCUS_KEY = "focuslock.paused-focus.v1";
const ROUTES = [
  { to: "/dashboard", label: "Overview", icon: Compass },
  { to: "/focus", label: "Focus timer", icon: Timer },
  { to: "/quiz", label: "Quick quiz", icon: Brain },
  { to: "/companion", label: "Nova", icon: MessageCircle },
  { to: "/break", label: "Take a break", icon: Coffee },
  { to: "/settings", label: "Settings", icon: Settings2 },
];

function loadPausedFocus() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(PAUSED_FOCUS_KEY) || "null");
    if (saved && saved.mode === "focus" && ["idle", "paused"].includes(saved.status)) return saved;
  } catch {
    // Ignore unavailable or malformed browser-local data.
  }
  return null;
}

function safeSaveTimer(timer) {
  try {
    saveTimer(timer);
  } catch {
    // Timer controls remain usable if browser storage is unavailable.
  }
}

function Brand() {
  return (
    <div className="brand">
      <div className="brand-mark"><Sprout size={19} strokeWidth={2.2} /></div>
      <div>
        <div className="brand-name">FocusLock</div>
        <div className="brand-tag">make room to focus</div>
      </div>
    </div>
  );
}

function Sidebar() {
  return (
    <aside className="sidebar">
      <Brand />
      <div className="nav-label">Your space</div>
      <nav className="nav-list" aria-label="Main navigation">
        {ROUTES.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}>
            <Icon size={17} strokeWidth={1.8} /> {label}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-note">
          <div className="eyebrow">A small reminder</div>
          <p>One thing at a time is enough.</p>
          <span>Your attention is a resource. Spend it on what matters to you.</span>
        </div>
        <div className="profile-row">
          <div className="profile-avatar">Y</div>
          <div className="profile-copy"><strong>Your study space</strong><span>Personal progress</span></div>
        </div>
      </div>
    </aside>
  );
}

function MobileNavigation() {
  return (
    <nav className="mobile-nav" aria-label="Mobile navigation">
      {ROUTES.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} className={({ isActive }) => `mobile-link${isActive ? " active" : ""}`}>
          <Icon size={18} strokeWidth={1.8} /><span>{label === "Take a break" ? "Break" : label === "Focus timer" ? "Focus" : label === "Quick quiz" ? "Quiz" : label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function AppFrame({ children }) {
  const location = useLocation();
  const dateLabel = new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" }).format(new Date());
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-area">
        <header className="topbar">
          <div className="today-pill"><span className="today-dot" />{dateLabel}</div>
          <div className="local-badge">Local demo</div>
        </header>
         <div key={location.pathname}>{children}</div>
      </div>
      <MobileNavigation />
    </div>
  );
}

function PageHeading({ eyebrow, title, description, children }) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children && <div className="heading-actions">{children}</div>}
    </div>
  );
}

function ErrorBanner({ children }) {
  if (!children) return null;
  return <div className="alert" role="alert"><ShieldAlert size={16} /> <span>{children}</span></div>;
}

function NovaCharacter({ compact = false }) {
  return (
    <div className={`nova-character${compact ? " compact" : ""}`} role="img" aria-label="Nova, your study companion">
      <svg viewBox="0 0 96 96" aria-hidden="true">
        <ellipse cx="48" cy="86" rx="22" ry="4" fill="#26342f" opacity=".1" />
        <path d="M30 29C22 17 14 20 15 30c1 7 7 12 17 14M66 29c8-12 16-9 15 1-1 7-7 12-17 14" fill="#315d4e" />
        <path d="M18 57c0-21 12-35 30-35s30 14 30 35c0 18-12 27-30 27S18 75 18 57Z" fill="#d97951" />
        <path d="M27 67c5 10 13 14 21 14s16-4 21-14c-3-9-11-14-21-14S30 58 27 67Z" fill="#f4e2d7" />
        <g className="nova-eye-group">
          <ellipse cx="38" cy="51" rx="7" ry="8" fill="#fffaf3" />
          <circle cx="40" cy="52" r="3.2" fill="#26342f" />
          <circle cx="41" cy="50.8" r="1" fill="#fffaf3" />
        </g>
        <g className="nova-eye-group nova-eye-right">
          <ellipse cx="58" cy="51" rx="7" ry="8" fill="#fffaf3" />
          <circle cx="60" cy="52" r="3.2" fill="#26342f" />
          <circle cx="61" cy="50.8" r="1" fill="#fffaf3" />
        </g>
        <path d="m45 61 3 3 3-3" fill="none" stroke="#26342f" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M40 17c1-5 4-8 8-10M48 15c2-5 6-7 10-7" fill="none" stroke="#315d4e" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M40 15c-5-7-12-5-10 1 2 5 7 6 13 4M49 12c2-7 9-9 11-3 1 5-4 8-10 9" fill="#8da786" />
        <path d="M25 59c-5 1-8 4-8 9 5 0 9-2 12-6M71 59c5 1 8 4 8 9-5 0-9-2-12-6" fill="#c86e4c" />
      </svg>
    </div>
  );
}

function DashboardPage({ dashboard, loading, error, reload, beginBreak, startStudying }) {
  const stats = dashboard?.stats || {};
  const recent = dashboard?.recent_sessions || [];
  const todayMinutes = Number(stats.today_focus_minutes || 0);
  const sessions = Number(stats.today_sessions || 0);
  const goal = 120;
  const progress = Math.min(100, Math.round((todayMinutes / goal) * 100));
  const recentLabel = (session) => session.kind === "break" ? "Intentional break" : "Focus session";
  return (
    <main className="page-content">
      <PageHeading eyebrow="Your study space / today" title="A little progress adds up." description="Make today feel manageable. Pick one thing, then begin." />
      <ErrorBanner>{error ? `Progress could not be refreshed: ${error}` : ""}</ErrorBanner>
      <section className="grid dashboard-top">
        <div className="focus-card card">
          <div className="eyebrow">Ready when you are</div>
          <div className="focus-ornament"><Sprout size={27} /></div>
          <h2>Give your next 25 minutes a purpose.</h2>
          <p>Choose one task. We’ll keep the time, so you can stay with the work.</p>
          <button className="button" onClick={startStudying}><Play size={15} fill="currentColor" /> Start studying <ArrowRight size={15} /></button>
        </div>
        <div className="stats-card card">
          <div className="stats-card-top">
            <div>
              <div className="eyebrow">Focused today</div>
              {loading && !dashboard ? <div className="skeleton" style={{ width: 100, height: 51, marginTop: 15 }} /> :
                <div className="stat-number">{todayMinutes}<span className="stat-unit"> min</span></div>}
              <div className="stat-caption">Small blocks, meaningful progress.</div>
            </div>
            <div className="activity-icon"><Clock3 size={18} /></div>
          </div>
          <div>
            <div className="stat-separator" />
            <div className="stats-bottom">
              <div className="sessions-count"><strong>{loading && !dashboard ? "—" : sessions}</strong><span>sessions completed today</span></div>
              <div className="streak-mark"><Flame size={15} /> keep going</div>
            </div>
          </div>
        </div>
      </section>
      <section className="grid dashboard-lower">
        <div className="panel card">
          <div className="panel-head">
            <div><h2 className="panel-title">Your study progress</h2><div className="panel-subtitle">A gentle target, not a deadline.</div></div>
            <div className="activity-icon"><Sprout size={17} /></div>
          </div>
          <div className="progress-wrap">
            <div className="progress-ring">
              <svg viewBox="0 0 112 112" aria-hidden="true">
                <circle className="track" cx="56" cy="56" r="46" />
                <circle className="value" cx="56" cy="56" r="46" strokeDasharray="289" strokeDashoffset={289 - (289 * progress) / 100} />
              </svg>
              <div className="ring-label"><strong>{progress}%</strong><span>of 2 hours</span></div>
            </div>
            <div className="progress-copy">
              <strong>{todayMinutes} of {goal} minutes</strong>
              <p>{todayMinutes >= goal ? "You reached today's focus goal. Take a moment to notice that." : "Every focused minute counts. Come back for another block whenever you're ready."}</p>
              <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
            </div>
          </div>
          <div className="stat-separator" />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <span style={{ color: "var(--muted)", fontSize: 11 }}>Lifetime focus <strong style={{ color: "var(--ink)" }}>{Number(stats.total_focus_minutes || 0)} min</strong></span>
            <span style={{ color: "var(--muted)", fontSize: 11 }}>Quiz best <strong style={{ color: "var(--ink)" }}>{Number(stats.best_quiz_score || 0)}%</strong></span>
          </div>
        </div>
        <div className="panel card">
          <div className="panel-head">
            <div><h2 className="panel-title">Recent sessions</h2><div className="panel-subtitle">The work you’ve already put in.</div></div>
            <button className="icon-button" aria-label="Refresh progress" onClick={() => reload().catch(() => {})}><RotateCcw size={15} /></button>
          </div>
          {loading && !dashboard ? (
            <div style={{ display: "grid", gap: 14 }}>{[1, 2, 3].map((item) => <div key={item} className="skeleton" style={{ height: 45 }} />)}</div>
          ) : recent.length ? (
            <div className="recent-list">
              {recent.slice(0, 4).map((session, index) => {
                const seconds = Number(session.duration_seconds || 0);
                const minutes = Math.round(seconds / 60);
                const date = session.completed_at ? new Date(session.completed_at) : null;
                return <div className="recent-item" key={session.id || `${session.completed_at}-${index}`}>
                  <div className="recent-icon">{session.kind === "break" ? <Coffee size={16} /> : <Timer size={16} />}</div>
                  <div className="recent-item-copy"><strong>{recentLabel(session)}</strong><span>{date && !Number.isNaN(date.getTime()) ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "Completed recently"}</span></div>
                  <div className="recent-duration">{minutes} min</div>
                </div>;
              })}
            </div>
          ) : (
            <div className="empty-state"><div className="empty-icon"><Clock3 size={18} /></div>Your first focus session will show up here. Start with a small block.</div>
          )}
        </div>
      </section>
      <section className="grid" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 18 }}>
        <div className="card panel" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
          <div><div className="eyebrow">Need a reset?</div><h2 className="panel-title" style={{ marginTop: 7 }}>Take a proper pause.</h2><div className="panel-subtitle">A short break is part of the plan.</div></div>
          <button className="button button-light button-small" onClick={beginBreak}><Coffee size={15} /> Break</button>
        </div>
        <div className="card panel" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
          <div><div className="eyebrow">Check what stuck</div><h2 className="panel-title" style={{ marginTop: 7 }}>Try a five-question quiz.</h2><div className="panel-subtitle">Sample study skills, with explanations.</div></div>
          <NavLink className="button button-light button-small" to="/quiz"><BookOpen size={15} /> Quiz</NavLink>
        </div>
      </section>
    </main>
  );
}

function FocusPage({ timer, timerRemaining, updateTimer, dashboard, beginBreak, resumeFocus, startStudying, timerError, settings }) {
  const navigate = useNavigate();
  const [duration, setDuration] = useState(Math.max(1, Math.round(timer.durationSeconds / 60)));
  const [durationError, setDurationError] = useState("");
  useEffect(() => setDuration(Math.max(1, Math.round(timer.durationSeconds / 60))), [timer.durationSeconds]);
  const isPausedFocusAvailable = timer.mode === "break";
  const updateDuration = (value) => {
    const minutes = Math.min(120, Math.max(1, Number(value) || 1));
    setDuration(minutes);
    if (timer.status !== "running") updateTimer(makeTimer(timer.mode, minutes * 60));
    setDurationError("");
  };
  const setTimerDuration = () => {
    if (!Number.isFinite(Number(duration)) || Number(duration) < 1 || Number(duration) > 120) {
      setDurationError("Choose a duration between 1 and 120 minutes.");
      return;
    }
    updateTimer(makeTimer("focus", Number(duration) * 60));
    setDurationError("");
  };
  const progress = timer.durationSeconds ? Math.max(0, Math.min(1, timerRemaining / timer.durationSeconds)) : 0;
  return (
    <main className="page-content">
      <PageHeading eyebrow="Focus room" title="Stay with one thing." description="A calm timer for the task in front of you. Your timer continues if you move around the app." />
      {timerError && <ErrorBanner>{timerError}</ErrorBanner>}
      <section className="timer-layout">
        <div className="timer-card card">
          <div className="timer-mode">{timer.mode === "focus" ? "Focus session" : "Intentional break"}</div>
          <div className="timer-clock" aria-live="polite">{formatTimer(timerRemaining)}</div>
          <div className="timer-status">{timer.status === "running" ? "One task. You’re right where you need to be." : timer.status === "paused" ? "Paused. Pick it back up when it feels right." : timerRemaining === 0 ? "That block is complete. Nice work." : "Settle in, then begin when you’re ready."}</div>
          <div className="timer-actions">
            {timer.status === "running" ? <button className="button button-primary" onClick={() => updateTimer((current) => pauseTimer(current))}><Pause size={15} /> Pause</button> :
              <button className="button button-primary" onClick={() => timer.mode === "focus" && isPausedFocusAvailable ? resumeFocus() : startStudying()}><Play size={15} fill="currentColor" /> {timer.status === "paused" || timer.mode === "break" ? "Resume" : "Start focus"}</button>}
            <button className="button button-light" onClick={() => updateTimer((current) => makeTimer(current.mode, current.durationSeconds))}><RotateCcw size={15} /> Reset</button>
          </div>
          {timer.mode === "focus" && <div className="progress-track" style={{ width: "min(360px,80%)", marginTop: 28 }}><span style={{ width: `${(1 - progress) * 100}%` }} /></div>}
        </div>
        <aside className="control-panel card">
          <h3>Make it yours</h3>
          <p>Choose a focus block that feels doable. You can change it between sessions.</p>
          <div className="eyebrow">Focus duration</div>
          <div className="duration-input" style={{ marginTop: 9 }}>
            <input aria-label="Focus duration in minutes" type="number" min="1" max="120" value={duration} onChange={(event) => updateDuration(event.target.value)} disabled={timer.status === "running"} />
            <span>minutes</span>
            <button className="button button-light button-small" onClick={setTimerDuration} disabled={timer.status === "running"}>Set</button>
          </div>
          {durationError && <div style={{ color: "#9a4e37", fontSize: 10, marginTop: 7 }}>{durationError}</div>}
          <div className="preset-list">
            {[15, 25, 45].map((minutes) => <button key={minutes} className={`preset${duration === minutes ? " selected" : ""}`} onClick={() => updateDuration(minutes)} disabled={timer.status === "running"}>{minutes} min</button>)}
          </div>
          <div className="control-divider" />
          <div className="switch-row">
            <div><strong>Break length</strong><span>{dashboard?.settings?.break_minutes || settings.break_minutes} minutes by default</span></div>
            <button className="button button-light button-small" onClick={() => navigate("/settings")}><Settings2 size={14} /> Settings</button>
          </div>
          <div className="control-divider" />
          <div className="switch-row">
            <div><strong>Ready to pause?</strong><span>Your paused focus timer stays saved.</span></div>
            <button className="icon-button" aria-label="Start an intentional break" onClick={beginBreak}><Coffee size={16} /></button>
          </div>
          {isPausedFocusAvailable && <button className="button button-outline button-small" style={{ width: "100%", marginTop: 15 }} onClick={resumeFocus}><ArrowLeft size={14} /> Return to paused focus</button>}
        </aside>
      </section>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 20, gap: 12, flexWrap: "wrap" }}>
        <span style={{ color: "var(--muted)", fontSize: 11 }}><CheckCircle2 size={14} style={{ verticalAlign: "middle", marginRight: 5, color: "var(--forest)" }} /> Completed focus blocks are added to your progress.</span>
        <button className="inline-link" onClick={() => navigate("/settings")}>Manage preferences <ChevronRight size={14} /></button>
      </div>
    </main>
  );
}

function QuizPage({ submitQuiz }) {
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const answered = Object.keys(answers).length;
  const handleSubmit = async () => {
    if (answered !== SAMPLE_QUESTIONS.length || submitting) return;
    const current = scoreQuiz(SAMPLE_QUESTIONS, answers);
    setResult(current);
    setSubmitting(true);
    setError("");
    try {
      await submitQuiz({ correct: current.correct, total: current.total });
    } catch (caught) {
      setError(`Your score is shown, but it could not be saved: ${caught.message || "Please try again."}`);
    } finally {
      setSubmitting(false);
    }
  };
  const restart = () => { setAnswers({}); setResult(null); setError(""); };
  return (
    <main className="page-content">
      <PageHeading eyebrow="Learning corner" title="A quick check-in." description="Five sample questions about study habits. Choose your answers, then see what you got right and why.">
        <span className="sample-badge">Sample content</span>
      </PageHeading>
      <ErrorBanner>{error}</ErrorBanner>
      <section className="quiz-layout">
        <div>
          {SAMPLE_QUESTIONS.map((question, questionIndex) => (
            <article className="question-card card" key={question.prompt}>
              <div className="question-top"><span className="question-number">Question {String(questionIndex + 1).padStart(2, "0")} / {SAMPLE_QUESTIONS.length}</span>{result && (answers[questionIndex] === question.answer ? <CheckCircle2 size={17} color="#477856" /> : <CircleHelp size={17} color="#c56a49" />)}</div>
              <h3>{question.prompt}</h3>
              <div className="option-list">
                {question.options.map((option, optionIndex) => {
                  const selected = answers[questionIndex] === optionIndex;
                  const status = result && optionIndex === question.answer ? " correct" : result && selected && optionIndex !== question.answer ? " incorrect" : "";
                  return <button type="button" key={option} disabled={!!result} className={`option${selected ? " selected" : ""}${status}`} onClick={() => setAnswers((previous) => ({ ...previous, [questionIndex]: optionIndex }))}>
                    <span className="option-letter">{String.fromCharCode(65 + optionIndex)}</span>{option}
                  </button>;
                })}
              </div>
              {result && <p className="explanation"><Lightbulb size={14} style={{ flex: "none", marginTop: 1, color: "var(--orange)" }} />{question.explanation}</p>}
            </article>
          ))}
          {!result ? <button className="button button-primary" disabled={answered !== SAMPLE_QUESTIONS.length || submitting} onClick={handleSubmit}>{submitting ? <LoaderCircle size={15} /> : <Check size={15} />} Submit answers <ArrowRight size={15} /></button> :
            <button className="button button-primary" onClick={restart}><RotateCcw size={15} /> Try again</button>}
        </div>
        <aside className="quiz-side card">
          <div className="eyebrow">Your check-in</div>
          <h3>{result ? "Here’s what you learned." : "Take it at your pace."}</h3>
          <p>{result ? "Your answers stay visible with an explanation for every question." : "This is sample content for the local demo, not an AI-generated quiz."}</p>
          <div className="question-dots">{SAMPLE_QUESTIONS.map((_, index) => <div key={index} className={`question-dot${answers[index] !== undefined ? " done" : ""}`}>{answers[index] !== undefined ? <Check size={12} /> : index + 1}</div>)}</div>
          <div className="progress-track"><span style={{ width: `${(answered / SAMPLE_QUESTIONS.length) * 100}%` }} /></div>
          <p style={{ marginBottom: 5 }}>{answered} of {SAMPLE_QUESTIONS.length} answered</p>
          {result && <div className="score-hero"><strong>{result.percentage}%</strong><span>{result.correct} correct out of {result.total}</span></div>}
          <div className="stat-separator" />
          <div style={{ color: "var(--muted)", fontSize: 10, lineHeight: 1.6 }}><BookOpen size={14} style={{ verticalAlign: "middle", marginRight: 5 }} /> Sample study skills quiz</div>
        </aside>
      </section>
    </main>
  );
}

function CompanionPage() {
  const { sendMessage, sending } = useCompanionChat();
  const [messages, setMessages] = useState([{ who: "nova", text: "Hi, I’m Nova. I can help you think through a study plan or find a small next step. What’s on your mind?" }]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState("local-demo");
  const bottomRef = useRef(null);
  useEffect(() => bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [messages, sending]);
  const send = async (suggestion) => {
    const message = (suggestion ?? text).trim();
    if (!message || sending) return;
    setText("");
    setError("");
    setMessages((current) => [...current, { who: "you", text: message }]);
    try {
      const response = await sendMessage(message);
      setMode(response.mode || "local-demo");
      setMessages((current) => [...current, { who: "nova", text: response.reply || "Try breaking the work into one small next step." }]);
    } catch (caught) {
      setError(`Nova could not reply just now: ${caught.message || "Please try again."}`);
    }
  };
  return (
    <main className="page-content">
      <PageHeading eyebrow="A study companion" title="Talk it through with Nova." description="A friendly place to untangle a task, make a plan, or get a little encouragement.">
        <span className="local-badge">{mode}</span>
      </PageHeading>
      <ErrorBanner>{error}</ErrorBanner>
      <section className="companion-layout">
        <div className="chat-card card">
          <div className="chat-header">
            <NovaCharacter compact />
            <div><strong>Nova</strong><span>Local demo · predefined replies</span></div>
            <div style={{ marginLeft: "auto" }} className="local-badge">No AI connected</div>
          </div>
          <div className="chat-body" aria-live="polite">
            {messages.map((message, index) => <div className={`message${message.who === "you" ? " user" : ""}`} key={`${message.who}-${index}`}>{message.text}</div>)}
            {sending && <div className="message" style={{ display: "flex", gap: 7, alignItems: "center" }}><LoaderCircle size={14} /> Nova is thinking…</div>}
            <div ref={bottomRef} />
          </div>
          <form className="chat-compose" onSubmit={(event) => { event.preventDefault(); send(); }}>
            <input value={text} onChange={(event) => setText(event.target.value)} placeholder="What are you working through?" aria-label="Message Nova" />
            <button className="button button-primary" aria-label="Send message" disabled={!text.trim() || sending}><Send size={15} /> Send</button>
          </form>
        </div>
        <aside className="companion-aside card">
          <NovaCharacter />
          <div className="eyebrow">Try a starting point</div>
          <h3>It’s okay to start small.</h3>
          <p>Nova’s replies are predefined for this local demo. Messages are not sent to an external AI model.</p>
          <button className="prompt-chip" onClick={() => send("Help me break a big assignment into a first step.")}>Help me find a first step</button>
          <button className="prompt-chip" onClick={() => send("I’m finding it hard to focus right now.")}>I’m finding it hard to focus</button>
          <button className="prompt-chip" onClick={() => send("Help me make a short study plan.")}>Help me make a short plan</button>
          <div className="stat-separator" />
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--forest)", fontSize: 11 }}><Sprout size={16} /> No perfect plan required.</div>
        </aside>
      </section>
    </main>
  );
}

const JOKES = [
  "Why did the student bring a ladder to the library? They wanted to reach the next level.",
  "What did the pencil say after a long study session? I’m drawing a blank.",
  "Why was the notebook so calm? It had everything written down.",
];
const RIDDLES = [
  { question: "I have pages but I’m not a tree. I help you find answers, but I’m not a person. What am I?", answer: "A book." },
  { question: "The more you take, the more you leave behind. What are they?", answer: "Footsteps." },
  { question: "I’m full of keys, but I can’t open a single door. What am I?", answer: "A piano." },
];
const ENCOURAGEMENTS = [
  "You don’t have to finish everything today. Just choose the next useful thing.",
  "A pause isn’t lost time. Let your attention catch its breath.",
  "You showed up for the work. That counts, even before the result.",
];

function BreakPage({ beginBreak, resumeFocus, hasPausedFocus, timer, breakMinutes }) {
  const [jokeIndex, setJokeIndex] = useState(0);
  const [riddleIndex, setRiddleIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [encouragementIndex, setEncouragementIndex] = useState(0);
  return (
    <main className="page-content">
      <PageHeading eyebrow="A breath between blocks" title="Rest is part of the work." description="Step away on purpose. Let the next thing wait for a moment." />
      <section className="break-hero">
        <div><div className="eyebrow">Your intentional break</div><h2>{timer.mode === "break" && timer.status === "running" ? "You’re taking a moment. That’s enough." : "Let your mind change gears."}</h2><p>Stand up, stretch, drink some water, or simply look out the window. No scrolling required.</p></div>
        <div className="break-sun"><Sun size={42} strokeWidth={1.4} /></div>
      </section>
      <section className="grid break-grid">
        <article className="activity-card card">
          <div className="activity-top"><div className="eyebrow">A little levity</div><div className="activity-icon"><Sparkles size={17} /></div></div>
          <h3>Quick study joke</h3><p>{JOKES[jokeIndex]}</p>
          <button className="inline-link" onClick={() => setJokeIndex((jokeIndex + 1) % JOKES.length)}>Another one <ArrowRight size={14} /></button>
        </article>
        <article className="activity-card card">
          <div className="activity-top"><div className="eyebrow">Something to ponder</div><div className="activity-icon" style={{ background: "#f4e2d7", color: "#a55c3b" }}><Lightbulb size={17} /></div></div>
          <h3>A small riddle</h3><p>{RIDDLES[riddleIndex].question}</p>
          {showAnswer && <p style={{ color: "var(--forest)", fontWeight: 700, marginTop: -7 }}>{RIDDLES[riddleIndex].answer}</p>}
          <button className="inline-link" onClick={() => showAnswer ? (setRiddleIndex((riddleIndex + 1) % RIDDLES.length), setShowAnswer(false)) : setShowAnswer(true)}>{showAnswer ? "Try another" : "Reveal answer"} <ArrowRight size={14} /></button>
        </article>
        <article className="activity-card card">
          <div className="activity-top"><div className="eyebrow">A kind word</div><div className="activity-icon"><Sprout size={17} /></div></div>
          <h3>Keep this with you</h3><p>{ENCOURAGEMENTS[encouragementIndex]}</p>
          <button className="inline-link" onClick={() => setEncouragementIndex((encouragementIndex + 1) % ENCOURAGEMENTS.length)}>A different thought <ArrowRight size={14} /></button>
        </article>
        <article className="activity-card card" style={{ background: "#e8ede2", borderColor: "#d5dfcf" }}>
          <div className="activity-top"><div className="eyebrow">When you’re ready</div><div className="activity-icon"><Timer size={17} /></div></div>
          <h3>Come back gently.</h3>
          <p>{hasPausedFocus ? "Your focus timer is paused and waiting. Your next block can start whenever you’re ready." : "Take a short break with the timer, then begin a fresh focus block when you’re ready."}</p>
          <button className="button button-primary button-small" onClick={() => { if (hasPausedFocus) resumeFocus(); else beginBreak(); }}>
             {hasPausedFocus ? <><Play size={14} fill="currentColor" /> Resume focus</> : <><Timer size={14} /> Start a {breakMinutes}-minute break</>}
          </button>
        </article>
      </section>
    </main>
  );
}

function SettingsPage({ settings, setSettings, saveSettings, saving }) {
  const [newSite, setNewSite] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const setNumber = (key, value) => {
    const maximum = key === "break_minutes" ? 60 : 120;
    const parsed = Math.min(maximum, Math.max(1, Number(value) || 1));
    setSettings((current) => ({ ...current, [key]: parsed }));
    setSaved(false);
  };
  const addSite = (event) => {
    event.preventDefault();
    const domain = newSite.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!domain || !domain.includes(".") || /\s/.test(domain)) {
      setError("Enter a website domain, such as example.com.");
      return;
    }
    if (settings.blocked_sites.some((site) => site.toLowerCase() === domain)) {
      setError("That website is already on your list.");
      return;
    }
    setSettings((current) => ({ ...current, blocked_sites: [...current.blocked_sites, domain] }));
    setNewSite("");
    setError("");
    setSaved(false);
  };
  const removeSite = (domain) => {
    setSettings((current) => ({ ...current, blocked_sites: current.blocked_sites.filter((site) => site !== domain) }));
    setSaved(false);
  };
  const save = async () => {
    setError("");
    setSaved(false);
    try {
      await saveSettings(settings);
      setSaved(true);
    } catch (caught) {
      setError(`Preferences could not be saved: ${caught.message || "Please try again."}`);
    }
  };
  return (
    <main className="page-content">
      <PageHeading eyebrow="Your preferences" title="Set up your study rhythm." description="A few gentle defaults, shaped around the way you work." />
      <ErrorBanner>{error}</ErrorBanner>
      <section className="settings-layout">
        <div>
          <div className="settings-panel card">
            <div className="eyebrow">Timer rhythm</div>
            <h2>Give your sessions a shape.</h2>
            <p>These are your defaults. You can still adjust a focus session before it starts.</p>
            <div className="field-row">
              <div><strong>Focus session</strong><span>Time for one task, without switching.</span></div>
              <div className="number-control"><input aria-label="Default focus duration" type="number" min="1" max="120" value={settings.focus_minutes} onChange={(event) => setNumber("focus_minutes", event.target.value)} /><span>min</span></div>
            </div>
            <div className="field-row">
              <div><strong>Intentional break</strong><span>A short reset between focus blocks.</span></div>
               <div className="number-control"><input aria-label="Default break duration" type="number" min="1" max="60" value={settings.break_minutes} onChange={(event) => setNumber("break_minutes", event.target.value)} /><span>min</span></div>
            </div>
            <div style={{ paddingTop: 14, display: "flex", alignItems: "center" }}>
              <button className="button button-primary" onClick={save} disabled={saving}>{saving ? <LoaderCircle size={15} /> : <Check size={15} />} {saving ? "Saving…" : "Save preferences"}</button>
              {saved && <span className="saved-note" role="status">Saved just now.</span>}
            </div>
          </div>
          <div className="settings-panel card">
            <div className="eyebrow">A personal list</div>
            <h2>Websites you want to avoid.</h2>
            <p>Keep a reminder list of places that tend to pull you away while studying.</p>
            <form className="site-add" onSubmit={addSite}>
              <input value={newSite} onChange={(event) => setNewSite(event.target.value)} placeholder="example.com" aria-label="Website domain to add" />
              <button className="button button-light button-small" type="submit"><Plus size={14} /> Add site</button>
            </form>
            {settings.blocked_sites.length > 0 ? <div className="site-list">{settings.blocked_sites.map((domain) => <div key={domain} className="site-row"><span>{domain}</span><button aria-label={`Remove ${domain}`} onClick={() => removeSite(domain)}><Trash2 size={15} /></button></div>)}</div> :
              <div className="empty-state" style={{ padding: "16px 10px" }}><div className="empty-icon"><ShieldAlert size={17} /></div>No sites on your list yet. Add one if it helps you stay intentional.</div>}
            <div style={{ paddingTop: 16 }}><button className="button button-primary" onClick={save} disabled={saving}>{saving ? <LoaderCircle size={15} /> : <Check size={15} />} Save preferences</button>{saved && <span className="saved-note">Saved just now.</span>}</div>
          </div>
        </div>
        <aside className="notice-card card">
          <div className="notice-icon"><ShieldAlert size={20} /></div>
          <div className="eyebrow">A clear limit</div>
          <h3>Your list is a reminder, not a blocker.</h3>
          <p>FocusLock saves these websites as personal settings only. This regular web app cannot block other websites or apps on your device. Device-wide blocking would need a separately implemented browser extension or another supported mechanism. Blocking is not active in this demo.</p>
        </aside>
      </section>
    </main>
  );
}

function AppContent() {
  const navigate = useNavigate();
  const { dashboard, loading, error, reload } = useDashboardData();
  const { saveSettings, saving } = useSaveSettings();
  const { logFocusSession } = useLogFocusSession();
  const { submitQuiz } = useSubmitQuiz();
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [timer, setTimer] = useState(() => readTimer());
  const [pausedFocus, setPausedFocus] = useState(() => loadPausedFocus());
  const [now, setNow] = useState(Date.now());
  const [timerError, setTimerError] = useState("");
  const completionRef = useRef("");

  useEffect(() => {
    if (dashboard?.settings) {
      setSettings({
        focus_minutes: Number(dashboard.settings.focus_minutes || DEFAULT_SETTINGS.focus_minutes),
        break_minutes: Number(dashboard.settings.break_minutes || DEFAULT_SETTINGS.break_minutes),
        blocked_sites: Array.isArray(dashboard.settings.blocked_sites) ? dashboard.settings.blocked_sites : [],
      });
    }
  }, [dashboard]);

  const updateTimer = useCallback((next) => {
    setTimer((current) => {
      const value = typeof next === "function" ? next(current) : next;
      safeSaveTimer(value);
      return value;
    });
    setTimerError("");
  }, []);

  const timerRemaining = remainingSeconds(timer, now);
  useEffect(() => {
    if (timer.status !== "running") return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [timer.status, timer.endsAt]);

  useEffect(() => {
    safeSaveTimer(timer);
    const seconds = remainingSeconds(timer, now);
    if (timer.status !== "running" || seconds > 0) return;
    const completionKey = `${timer.mode}-${timer.endsAt || timer.durationSeconds}`;
    if (completionRef.current === completionKey) return;
    completionRef.current = completionKey;
    const finished = { ...timer, status: "paused", remainingSeconds: 0, endsAt: null };
    updateTimer(finished);
    logFocusSession({ kind: timer.mode, duration_seconds: timer.durationSeconds }).then(() => reload().catch(() => {})).catch((caught) => {
      setTimerError(`The timer finished, but this session could not be logged: ${caught.message || "Please try again."}`);
    });
  }, [timer, now, updateTimer, logFocusSession, reload]);

  const setPausedFocusSafe = (value) => {
    setPausedFocus(value);
    try {
      if (value) window.localStorage.setItem(PAUSED_FOCUS_KEY, JSON.stringify(value));
      else window.localStorage.removeItem(PAUSED_FOCUS_KEY);
    } catch {
      // The in-memory focus timer is still available during this visit.
    }
  };

  const startStudying = useCallback(() => {
    setTimerError("");
    if (timer.mode === "focus" && timer.status !== "idle" && timerRemaining > 0) {
      updateTimer((current) => startTimer(current));
      navigate("/focus");
      return;
    }
    if (pausedFocus) {
      const restored = { ...pausedFocus, status: "running", endsAt: Date.now() + Math.max(0, pausedFocus.remainingSeconds) * 1000 };
      updateTimer(restored);
      setPausedFocusSafe(null);
    } else {
      const fresh = makeTimer("focus", Number(settings.focus_minutes || 25) * 60);
      updateTimer(startTimer(fresh));
    }
    navigate("/focus");
  }, [timer, timerRemaining, pausedFocus, settings.focus_minutes, navigate, updateTimer]);

  const beginBreak = useCallback(() => {
    setTimerError("");
    if (timer.mode === "focus") {
      const preserved = timer.status === "running" ? pauseTimer(timer) : timer;
      if (remainingSeconds(preserved) > 0) setPausedFocusSafe({ ...preserved, mode: "focus", status: "paused", endsAt: null });
      else setPausedFocusSafe(null);
    }
    const freshBreak = makeTimer("break", Number(settings.break_minutes || 5) * 60);
    updateTimer(startTimer(freshBreak));
    navigate("/break");
  }, [timer, settings.break_minutes, navigate, updateTimer]);

  const resumeFocus = useCallback(() => {
    setTimerError("");
    const candidate = pausedFocus || (timer.mode === "focus" ? timer : makeTimer("focus", Number(settings.focus_minutes || 25) * 60));
    const source = remainingSeconds(candidate) > 0 ? candidate : makeTimer("focus", Number(settings.focus_minutes || 25) * 60);
    const restored = { ...source, mode: "focus", status: "paused", endsAt: null };
    updateTimer(startTimer(restored));
    setPausedFocusSafe(null);
    navigate("/focus");
  }, [pausedFocus, timer, settings.focus_minutes, navigate, updateTimer]);

  const context = {
    timer,
    timerRemaining,
    updateTimer,
    dashboard,
    beginBreak,
    resumeFocus,
    startStudying,
    timerError,
    settings,
  };

  return (
    <AppFrame>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage dashboard={dashboard} loading={loading} error={error} reload={reload} beginBreak={beginBreak} startStudying={startStudying} />} />
        <Route path="/focus" element={<FocusPage {...context} />} />
        <Route path="/quiz" element={<QuizPage submitQuiz={submitQuiz} />} />
        <Route path="/companion" element={<CompanionPage />} />
         <Route path="/break" element={<BreakPage beginBreak={beginBreak} resumeFocus={resumeFocus} hasPausedFocus={!!pausedFocus} timer={timer} breakMinutes={settings.break_minutes} />} />
        <Route path="/settings" element={<SettingsPage settings={settings} setSettings={setSettings} saveSettings={saveSettings} saving={saving} />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AppFrame>
  );
}

export default function App() {
  return <BrowserRouter><AppContent /></BrowserRouter>;
}
