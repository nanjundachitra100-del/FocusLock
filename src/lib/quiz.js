export const SAMPLE_QUESTIONS = [
  {
    prompt: "Which study technique asks you to recall information without looking at your notes?",
    options: ["Passive review", "Active recall", "Highlighting", "Re-reading"],
    answer: 1,
    explanation:
      "Active recall strengthens memory by asking your brain to retrieve information from memory.",
  },
  {
    prompt: "What is a practical first step when a large assignment feels overwhelming?",
    options: [
      "Wait until you feel motivated",
      "Open every related tab",
      "Break it into one small next action",
      "Try to finish it all at once",
    ],
    answer: 2,
    explanation:
      "A clear, small next action lowers the barrier to starting and makes progress easier to see.",
  },
  {
    prompt: "During a focused study block, what is most likely to help protect your attention?",
    options: [
      "Keep notifications visible",
      "Switch between several tasks",
      "Choose one task and silence distractions",
      "Check messages between every paragraph",
    ],
    answer: 2,
    explanation:
      "Choosing one task and reducing interruptions makes it easier to stay with the work.",
  },
  {
    prompt: "Why can a short break help during a long study session?",
    options: [
      "It gives your attention a chance to recover",
      "It replaces the need to review",
      "It guarantees perfect concentration",
      "It makes all tasks take less time",
    ],
    answer: 0,
    explanation:
      "A brief, intentional break can help refresh attention before the next focus block.",
  },
  {
    prompt: "Which is the best way to check whether you understand a concept?",
    options: [
      "Recognize the page where it appeared",
      "Explain it in your own words",
      "Read the title again",
      "Copy the definition exactly",
    ],
    answer: 1,
    explanation:
      "Explaining a concept in your own words checks understanding, not just familiarity.",
  },
];

export function scoreQuiz(questions, answers) {
  const total = questions.length;
  const correct = questions.reduce(
    (score, question, index) => score + (answers[index] === question.answer ? 1 : 0),
    0,
  );
  return { correct, total, percentage: total ? Math.round((correct / total) * 100) : 0 };
}
