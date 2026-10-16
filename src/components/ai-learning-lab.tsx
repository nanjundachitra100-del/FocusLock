"use client";

import { useState, useRef, type ChangeEvent, type FormEvent } from "react";
import {
  Brain,
  Sparkles,
  Upload,
  FileText,
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  RotateCw,
  LoaderCircle,
  HelpCircle,
  Send,
  BookOpen,
  X,
  Trophy,
  XCircle,
  Check,
} from "lucide-react";
import type { ClientQuizQuestion, QuizPayload, QuizEvaluationResult } from "@/lib/ai/quiz-schema";

type InputMode = "paste" | "upload";
type QuizState = "input" | "taking" | "submitted";

const SAMPLE_NOTES = `Binary Search Trees (BST) are node-based data structures where each node has at most two children: left and right.
In a valid BST, the value of the left child is always strictly less than its parent node, and the value of the right child is always strictly greater.
The in-order traversal of a BST always yields the elements sorted in ascending order.
The time complexity for search, insert, and delete operations in a balanced BST is O(log n).
However, in the worst case (such as inserting strictly sorted elements into an unbalanced tree), the tree degenerates into a linked list with O(n) search time.
Self-balancing binary search trees like AVL trees and Red-Black trees maintain a logarithmic height to guarantee O(log n) worst-case performance.`;

export function AiLearningLab({
  onQuizComplete,
  activeSessionId,
}: {
  onQuizComplete?: () => void;
  activeSessionId?: string | null;
} = {}) {
  // Input form state
  const [inputMode, setInputMode] = useState<InputMode>("paste");
  const [topic, setTopic] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Generation / Network state
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [missingConfig, setMissingConfig] = useState<string[] | null>(null);

  // Active quiz state
  const [quizState, setQuizState] = useState<QuizState>("input");
  const [quizData, setQuizData] = useState<QuizPayload | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Record<number, string>>({});

  // Evaluation state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [evaluationResult, setEvaluationResult] = useState<QuizEvaluationResult | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileSelect(e: ChangeEvent<HTMLInputElement>) {
    setErrorMessage(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    if (!lowerName.endsWith(".txt") && !lowerName.endsWith(".md")) {
      setErrorMessage("Please select a plain text (.txt) or markdown (.md) file.");
      setSelectedFile(null);
      return;
    }

    if (file.size > 512 * 1024) {
      setErrorMessage("File exceeds 512 KB limit. Please choose a smaller file.");
      setSelectedFile(null);
      return;
    }

    setSelectedFile(file);
    if (!topic) {
      setTopic(file.name.replace(/\.(txt|md)$/i, ""));
    }
  }

  function handleRemoveFile() {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handleLoadSampleNotes() {
    setNotes(SAMPLE_NOTES);
    setTopic("Binary Search Trees");
    setErrorMessage(null);
  }

  async function handleGenerateQuiz(e: FormEvent) {
    e.preventDefault();
    setErrorMessage(null);
    setMissingConfig(null);

    // Client-side pre-validation
    if (inputMode === "paste" && notes.trim().length < 20) {
      setErrorMessage("Please provide at least 20 characters of study notes.");
      return;
    }

    if (inputMode === "upload" && !selectedFile) {
      setErrorMessage("Please choose a .txt or .md notes file to upload.");
      return;
    }

    setIsGenerating(true);

    try {
      let response: Response;

      if (inputMode === "upload" && selectedFile) {
        const formData = new FormData();
        formData.append("file", selectedFile);
        if (topic.trim()) formData.append("topic", topic.trim());
        if (notes.trim()) formData.append("notes", notes.trim());

        response = await fetch("/api/quiz/generate", {
          method: "POST",
          body: formData,
        });
      } else {
        response = await fetch("/api/quiz/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            notes: notes.trim(),
            topic: topic.trim() || undefined,
          }),
        });
      }

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 503 && data.code === "MISSING_KEY") {
          setMissingConfig(data.missingKeys || ["GEMMA_API_KEY"]);
          setErrorMessage(
            data.error || "Gemma 4 provider is not configured. Set GEMMA_API_KEY in server environment.",
          );
        } else if (response.status === 401) {
          setErrorMessage("You must be logged in to generate quizzes. Please refresh or sign in.");
        } else {
          setErrorMessage(data.error || `Failed to generate quiz (Status ${response.status}).`);
        }
        setIsGenerating(false);
        return;
      }

      // Quiz received successfully
      setQuizData(data as QuizPayload);
      setCurrentQuestionIndex(0);
      setUserAnswers({});
      setQuizState("taking");
    } catch (err) {
      setErrorMessage(
        `Network error: ${err instanceof Error ? err.message : "Unable to contact quiz service."}`,
      );
    } finally {
      setIsGenerating(false);
    }
  }

  function handleSelectOption(optionText: string) {
    setUserAnswers((prev) => ({
      ...prev,
      [currentQuestionIndex]: optionText,
    }));
  }

  function handleNextQuestion() {
    if (!quizData) return;
    if (currentQuestionIndex < quizData.questions.length - 1) {
      setCurrentQuestionIndex((prev) => prev + 1);
    }
  }

  function handlePrevQuestion() {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex((prev) => prev - 1);
    }
  }

  async function handleSubmitQuiz() {
    if (!quizData?.quizToken || !allAnswered || isSubmitting) return;

    setIsSubmitting(true);
    setSubmissionError(null);

    try {
      const response = await fetch("/api/quiz/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quizToken: quizData.quizToken,
          answers: userAnswers,
          focusSessionId: activeSessionId || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setSubmissionError(
          data.error || `Evaluation failed with status ${response.status}. Please try again.`
        );
        setIsSubmitting(false);
        return;
      }

      setEvaluationResult(data as QuizEvaluationResult);
      setQuizState("submitted");
      onQuizComplete?.();
    } catch (err) {
      setSubmissionError(
        `Network error during evaluation: ${err instanceof Error ? err.message : "Unable to reach evaluation server."}`
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleResetQuiz() {
    setQuizState("input");
    setQuizData(null);
    setUserAnswers({});
    setCurrentQuestionIndex(0);
    setErrorMessage(null);
    setSubmissionError(null);
    setEvaluationResult(null);
    setIsSubmitting(false);
  }

  // Current question helper
  const currentQuestion: ClientQuizQuestion | undefined =
    quizData?.questions[currentQuestionIndex];
  const totalQuestions = quizData?.questions.length || 0;
  const answeredCount = Object.keys(userAnswers).length;
  const allAnswered = totalQuestions > 0 && answeredCount === totalQuestions;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-[.2em] text-violet-300">
            <Sparkles className="size-3.5 text-violet-400" />
            AI ASSESSMENT ENGINE
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-white">AI Learning Lab</h2>
          <p className="mt-1 text-sm text-slate-400">
            Generate grounded multiple-choice quizzes from your study notes using Google Gemma 4.
          </p>
        </div>

        {quizState !== "input" && (
          <button
            type="button"
            onClick={handleResetQuiz}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/10 hover:text-white"
          >
            <RotateCw className="size-3.5" /> Start New Quiz
          </button>
        )}
      </div>

      {/* STATE 1: NOTE INPUT & GENERATE FORM */}
      {quizState === "input" && (
        <div className="glass max-w-3xl rounded-2xl p-6 sm:p-8">
          <form onSubmit={handleGenerateQuiz} className="space-y-6">
            {/* Topic Input */}
            <div>
              <label htmlFor="quiz-topic" className="block text-xs font-medium text-slate-300">
                Quiz Subject / Topic <span className="text-slate-500">(Optional)</span>
              </label>
              <input
                id="quiz-topic"
                type="text"
                placeholder="e.g. Binary Search Trees, Cell Biology, Microeconomics"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                maxLength={100}
                className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none transition focus:border-violet-400/60"
              />
            </div>

            {/* Input Mode Selector */}
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-300">Study Notes Input</span>
                <button
                  type="button"
                  onClick={handleLoadSampleNotes}
                  className="inline-flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300"
                >
                  <BookOpen className="size-3" /> Load sample notes
                </button>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl bg-white/5 p-1">
                <button
                  type="button"
                  onClick={() => setInputMode("paste")}
                  className={`flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium transition ${
                    inputMode === "paste"
                      ? "bg-violet-500/20 text-violet-200 shadow"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <FileText className="size-3.5" /> Paste Notes
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode("upload")}
                  className={`flex items-center justify-center gap-2 rounded-lg py-2 text-xs font-medium transition ${
                    inputMode === "upload"
                      ? "bg-violet-500/20 text-violet-200 shadow"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  <Upload className="size-3.5" /> Upload File (.txt, .md)
                </button>
              </div>
            </div>

            {/* Mode: Paste Notes */}
            {inputMode === "paste" && (
              <div>
                <textarea
                  rows={8}
                  placeholder="Paste your lecture notes, summaries, or textbook excerpts here (minimum 20 characters)..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={50000}
                  className="w-full rounded-xl border border-white/10 bg-white/5 p-4 text-sm leading-relaxed text-white placeholder-slate-500 outline-none transition focus:border-violet-400/60"
                />
                <div className="mt-1.5 flex justify-between text-[11px] text-slate-500">
                  <span>Minimum 20 characters required</span>
                  <span>{notes.length.toLocaleString()} / 50,000 characters</span>
                </div>
              </div>
            )}

            {/* Mode: File Upload */}
            {inputMode === "upload" && (
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.md"
                  onChange={handleFileSelect}
                  className="hidden"
                  id="notes-file-input"
                />

                {!selectedFile ? (
                  <label
                    htmlFor="notes-file-input"
                    className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-white/15 bg-white/3 p-8 text-center transition hover:border-violet-400/40 hover:bg-white/5"
                  >
                    <Upload className="mb-3 size-8 text-violet-400" />
                    <span className="text-sm font-medium text-slate-200">
                      Click to browse or drop your notes file
                    </span>
                    <span className="mt-1 text-xs text-slate-500">
                      Supported formats: Plain Text (.txt) or Markdown (.md) up to 512 KB
                    </span>
                  </label>
                ) : (
                  <div className="flex items-center justify-between rounded-xl border border-violet-400/30 bg-violet-500/10 p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 items-center justify-center rounded-lg bg-violet-500/20 text-violet-300">
                        <FileText className="size-4" />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-violet-100">{selectedFile.name}</div>
                        <div className="text-xs text-violet-300/70">
                          {(selectedFile.size / 1024).toFixed(1)} KB
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleRemoveFile}
                      aria-label="Remove file"
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Error & Warning Banner */}
            {errorMessage && (
              <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 p-4 text-sm text-rose-200">
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 size-4 shrink-0 text-rose-300" />
                  <div className="space-y-1">
                    <div className="font-medium text-rose-100">Unable to generate quiz</div>
                    <div className="text-xs leading-5 text-rose-200/80">{errorMessage}</div>
                    {missingConfig && (
                      <div className="mt-2 text-xs text-rose-300">
                        Add <code className="rounded bg-rose-950/60 px-1 py-0.5">{missingConfig.join(", ")}</code> to{" "}
                        <code className="rounded bg-rose-950/60 px-1 py-0.5">.env.local</code> on the server to activate live Gemma 4 generation.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Submit Action */}
            <div className="flex items-center justify-between pt-2">
              <span className="text-xs text-slate-500">
                5 grounded questions generated per session
              </span>

              <button
                type="submit"
                disabled={isGenerating}
                className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-blue-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:brightness-110 disabled:opacity-50"
              >
                {isGenerating ? (
                  <>
                    <LoaderCircle className="size-4 animate-spin" />
                    Generating with Gemma 4...
                  </>
                ) : (
                  <>
                    Generate Quiz
                    <Sparkles className="size-4" />
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* STATE 2: ACTIVE QUIZ VIEW (ONE QUESTION AT A TIME) */}
      {quizState === "taking" && currentQuestion && quizData && (
        <div className="glass max-w-3xl rounded-2xl p-6 sm:p-8">
          {/* Quiz Header & Progress Bar */}
          <div className="mb-6 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-semibold uppercase tracking-wider text-violet-300">
                {quizData.topic}
              </span>
              <span>
                Question {currentQuestionIndex + 1} of {totalQuestions}
              </span>
            </div>

            {/* Progress Bar */}
            <div className="h-1.5 w-full rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-violet-500 to-blue-400 transition-all duration-300"
                style={{
                  width: `${((currentQuestionIndex + 1) / totalQuestions) * 100}%`,
                }}
              />
            </div>

            {/* Question Quick-Jump Pills */}
            <div className="flex gap-2 pt-2">
              {quizData.questions.map((q, idx) => {
                const isCurrent = idx === currentQuestionIndex;
                const isAnswered = userAnswers[idx] !== undefined;

                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setCurrentQuestionIndex(idx)}
                    className={`flex size-8 items-center justify-center rounded-lg text-xs font-medium transition ${
                      isCurrent
                        ? "bg-violet-500 text-white shadow-md shadow-violet-500/30"
                        : isAnswered
                          ? "border border-emerald-400/40 bg-emerald-500/20 text-emerald-200"
                          : "border border-white/10 bg-white/5 text-slate-400 hover:text-white"
                    }`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Question Card */}
          <div className="my-6 space-y-5">
            <div className="rounded-xl border border-white/8 bg-white/3 p-5">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Question {currentQuestionIndex + 1}
              </div>
              <h3 className="mt-2 text-lg font-medium leading-relaxed text-white">
                {currentQuestion.question}
              </h3>
            </div>

            {/* 4 Answer Choices */}
            <div className="space-y-2.5">
              {currentQuestion.options.map((option, optIdx) => {
                const isSelected = userAnswers[currentQuestionIndex] === option;
                const letter = String.fromCharCode(65 + optIdx); // A, B, C, D

                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => handleSelectOption(option)}
                    className={`flex w-full items-center gap-3.5 rounded-xl border p-4 text-left text-sm transition ${
                      isSelected
                        ? "border-violet-400/80 bg-violet-500/20 text-white shadow-sm"
                        : "border-white/8 bg-white/3 text-slate-300 hover:border-white/20 hover:bg-white/6"
                    }`}
                  >
                    <span
                      className={`flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold ${
                        isSelected
                          ? "bg-violet-500 text-white"
                          : "bg-white/10 text-slate-400"
                      }`}
                    >
                      {letter}
                    </span>
                    <span className="flex-1 leading-snug">{option}</span>
                    {isSelected && (
                      <CheckCircle2 className="size-4 shrink-0 text-violet-400" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Navigation Controls */}
          <div className="flex items-center justify-between border-t border-white/8 pt-5">
            <button
              type="button"
              onClick={handlePrevQuestion}
              disabled={currentQuestionIndex === 0}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-medium text-slate-300 transition hover:bg-white/10 disabled:opacity-40"
            >
              <ChevronLeft className="size-4" /> Previous
            </button>

            <div className="text-xs text-slate-500">
              {answeredCount} of {totalQuestions} answered
            </div>

            {currentQuestionIndex < totalQuestions - 1 ? (
              <button
                type="button"
                onClick={handleNextQuestion}
                className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-5 py-2.5 text-xs font-semibold text-white transition hover:bg-violet-500"
              >
                Next <ChevronRight className="size-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmitQuiz}
                disabled={!allAnswered || isSubmitting}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-emerald-500 px-6 py-2.5 text-xs font-semibold text-white shadow-lg transition hover:brightness-110 disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <LoaderCircle className="size-3.5 animate-spin" /> Evaluating...
                  </>
                ) : (
                  <>
                    Submit Quiz <Send className="size-3.5" />
                  </>
                )}
              </button>
            )}
          </div>

          {submissionError && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-rose-400/20 bg-rose-500/10 p-3 text-xs text-rose-200">
              <div className="flex items-center gap-2">
                <AlertCircle className="size-4 shrink-0 text-rose-400" />
                <span>{submissionError}</span>
              </div>
              <button
                type="button"
                onClick={handleSubmitQuiz}
                disabled={isSubmitting}
                className="inline-flex items-center gap-1 rounded-lg border border-rose-400/30 bg-rose-500/20 px-2.5 py-1 text-[11px] font-medium text-rose-100 hover:bg-rose-500/30"
              >
                <RotateCw className="size-3" /> Retry
              </button>
            </div>
          )}
        </div>
      )}

      {/* STATE 3: EVALUATED & SUBMITTED RESULT VIEW */}
      {quizState === "submitted" && evaluationResult && (
        <div className="space-y-6">
          {/* Main Score & Reward Hero Banner */}
          <div
            className={`glass relative overflow-hidden rounded-2xl p-6 sm:p-8 ${
              evaluationResult.passed
                ? "border-emerald-500/30 bg-gradient-to-br from-violet-950/40 via-[#0e1630] to-emerald-950/40"
                : "border-amber-500/30 bg-gradient-to-br from-violet-950/40 via-[#0e1630] to-rose-950/30"
            }`}
          >
            <div className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
              <div
                className={`flex size-16 shrink-0 items-center justify-center rounded-2xl shadow-lg ${
                  evaluationResult.passed
                    ? "bg-emerald-500/20 text-emerald-400 shadow-emerald-500/20"
                    : "bg-amber-500/20 text-amber-400 shadow-amber-500/20"
                }`}
              >
                {evaluationResult.passed ? (
                  <Trophy className="size-9 text-amber-300" />
                ) : (
                  <AlertCircle className="size-9 text-amber-300" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider ${
                      evaluationResult.passed
                        ? "bg-emerald-400/15 text-emerald-300"
                        : "bg-amber-400/15 text-amber-300"
                    }`}
                  >
                    {evaluationResult.passed ? "Passed" : "Needs Review"}
                  </span>
                  <span className="text-xs text-slate-400">
                    Topic: <strong className="text-slate-200">{evaluationResult.topic}</strong>
                  </span>
                </div>

                <h3 className="mt-1 text-2xl font-bold text-white">
                  {evaluationResult.passed
                    ? "Congratulations! 10 Minutes Earned"
                    : "Quiz Completed (0 Minutes Earned)"}
                </h3>

                <p className="mt-1 text-xs text-slate-300">
                  {evaluationResult.passed
                    ? "You scored 80% or higher! 10 entertainment minutes have been credited to your Reward Wallet."
                    : "An 80% score (at least 4 out of 5) is required to unlock entertainment time. Review the explanations below to improve."}
                </p>
              </div>

              {/* Score Display */}
              <div className="flex shrink-0 flex-col items-center rounded-xl border border-white/10 bg-white/5 px-6 py-4">
                <div className="text-3xl font-extrabold text-white">
                  {evaluationResult.score} / {evaluationResult.totalQuestions}
                </div>
                <div
                  className={`mt-0.5 text-xs font-semibold ${
                    evaluationResult.passed ? "text-emerald-300" : "text-amber-300"
                  }`}
                >
                  {evaluationResult.percentage}% Accuracy
                </div>
              </div>
            </div>

            {/* Persistence & Ledger Status Sub-bar */}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-4 text-xs">
              <div className="flex items-center gap-2">
                {evaluationResult.persisted ? (
                  <span className="inline-flex items-center gap-1.5 font-medium text-emerald-300">
                    <CheckCircle2 className="size-3.5" />
                    Saved to your account activity ledger
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-amber-300">
                    <AlertCircle className="size-3.5" />
                    {evaluationResult.persistenceError || "Attempt scored locally."}
                  </span>
                )}
              </div>

              {typeof evaluationResult.availableMinutes === "number" && (
                <div className="text-slate-300">
                  Available Wallet Balance:{" "}
                  <strong className="text-violet-300 font-semibold">
                    {evaluationResult.availableMinutes} min
                  </strong>
                </div>
              )}
            </div>
          </div>

          {/* Question Breakdown List */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-white">Detailed Solutions & Feedback</h4>
              <span className="text-xs text-slate-500">
                {evaluationResult.score} of {evaluationResult.totalQuestions} correct
              </span>
            </div>

            {evaluationResult.questions.map((q, idx) => {
              const originalQuestion = quizData?.questions.find((item) => item.id === q.id);
              const options = originalQuestion?.options || [];

              return (
                <div
                  key={q.id}
                  className={`glass rounded-2xl p-5 sm:p-6 transition ${
                    q.isCorrect ? "border-emerald-500/20" : "border-rose-500/20"
                  }`}
                >
                  {/* Question Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="flex size-6 items-center justify-center rounded-lg bg-white/5 text-xs font-semibold text-slate-400">
                        {idx + 1}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          q.isCorrect
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "bg-rose-500/15 text-rose-300"
                        }`}
                      >
                        {q.isCorrect ? "Correct (+1)" : "Incorrect (0)"}
                      </span>
                    </div>
                  </div>

                  {/* Question Text */}
                  <p className="mt-3 text-sm font-medium leading-relaxed text-slate-100">
                    {originalQuestion?.question || `Question ${idx + 1}`}
                  </p>

                  {/* 4 Choices */}
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {options.map((opt) => {
                      const isCorrectChoice =
                        opt.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase();
                      const isUserSelection =
                        q.selectedAnswer &&
                        opt.trim().toLowerCase() === q.selectedAnswer.trim().toLowerCase();

                      let cardStyle = "border-white/6 bg-white/2 text-slate-400";
                      let tagContent: React.ReactNode = null;

                      if (isCorrectChoice && isUserSelection) {
                        cardStyle =
                          "border-emerald-500/60 bg-emerald-500/15 text-emerald-100 font-medium";
                        tagContent = (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                            <Check className="size-3" /> Your Choice · Correct
                          </span>
                        );
                      } else if (isCorrectChoice) {
                        cardStyle =
                          "border-emerald-500/40 bg-emerald-500/10 text-emerald-200 font-medium";
                        tagContent = (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                            <Check className="size-3" /> Correct Answer
                          </span>
                        );
                      } else if (isUserSelection) {
                        cardStyle =
                          "border-rose-500/50 bg-rose-500/15 text-rose-200 line-through font-medium";
                        tagContent = (
                          <span className="inline-flex items-center gap-1 rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">
                            <X className="size-3" /> Your Choice
                          </span>
                        );
                      }

                      return (
                        <div
                          key={opt}
                          className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-xs leading-relaxed transition ${cardStyle}`}
                        >
                          <span className="min-w-0 flex-1">{opt}</span>
                          {tagContent}
                        </div>
                      );
                    })}
                  </div>

                  {/* Explanation Callout */}
                  <div className="mt-4 rounded-xl border border-violet-400/20 bg-violet-500/5 p-3 text-xs text-slate-300">
                    <div className="mb-0.5 flex items-center gap-1.5 font-semibold text-violet-300">
                      <Sparkles className="size-3.5 text-violet-400" />
                      Key Concept & Explanation
                    </div>
                    <p className="mt-1 text-slate-300 leading-relaxed">{q.explanation}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Action Footer */}
          <div className="flex flex-wrap items-center justify-center gap-4 pt-4">
            <button
              type="button"
              onClick={handleResetQuiz}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-blue-500 px-6 py-3 text-xs font-semibold text-white shadow-lg shadow-violet-500/20 transition hover:brightness-110"
            >
              <RotateCw className="size-3.5" /> Take Another Quiz
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
