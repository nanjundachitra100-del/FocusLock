import type { AuraSyncItem, TopicExplanation } from "./types";
import { getGemmaApiKey, getGemmaConfig } from "@/lib/ai/gemma-config";

const EXPLANATION_CACHE = new Map<string, TopicExplanation>();

function buildFallbackExplanation(item: AuraSyncItem): TopicExplanation {
  const categoryContexts: Record<string, string> = {
    "AI & Machine Learning":
      "Artificial Intelligence systems and neural architectures are progressing rapidly toward more efficient inference, reduced compute barriers, and specialized domain reasoning.",
    Programming:
      "Modern software engineering requires balancing developer velocity, memory safety, concurrency, and tooling ergonomics across distributed and local runtimes.",
    Science:
      "Fundamental scientific breakthroughs create the bedrock for future engineering paradigms, from quantum computing substrates to advanced materials.",
    Technology:
      "The broader computing landscape is characterized by hardware acceleration, tighter platform integration, and evolving regulatory boundaries.",
    "Social Media Trends":
      "Digital attention dynamics and algorithmic curation are pushing users and developers toward more intentional, asynchronous, and focus-oriented digital spaces.",
    "Important News":
      "Industry restructuring and technological policy decisions carry significant ripple effects across privacy, economic incentives, and technical standards.",
  };

  const contextStr =
    categoryContexts[item.category] ??
    "This milestone represents a notable advancement in the modern technological landscape.";

  return {
    summary: `${item.title} brings important updates to the field of ${item.category}. According to reporting from ${item.source}, ${item.summary}`,
    keyFacts: [
      `Reported by ${item.source} under category ${item.category}.`,
      `Core topic: ${item.title}.`,
      item.summary.length > 40
        ? `Primary excerpt: "${item.summary.slice(0, 160)}..."`
        : `Published at ${new Date(item.publishedAt).toLocaleDateString()}.`,
      `Assigned signal score of ${item.score}/100 with freshness indicator "${item.freshnessStatus.toUpperCase()}".`,
    ],
    whyItMatters:
      item.relevanceNote ||
      `Understanding developments in ${item.category} helps engineering students and professionals anticipate architectural shifts.`,
    context: contextStr,
    relatedTopics: [
      `${item.category} best practices`,
      `${item.source} tech analysis`,
      "System architecture & optimization",
      "FocusLock deep-work learning paths",
    ],
    avatarAnnouncement: `Hey! I've summarized this update from ${item.source} on ${item.category}. Take a quick look, and whenever you're ready, let's head back to our study session!`,
    estimatedReadingTime: `${item.readingTimeMinutes} min read`,
  };
}

export async function explainAuraSyncTopic(item: AuraSyncItem): Promise<TopicExplanation> {
  // Check in-memory cache first to prevent redundant expensive AI calls
  const cacheKey = `exp-${item.id}`;
  const cached = EXPLANATION_CACHE.get(cacheKey);
  if (cached) {
    return cached;
  }

  const gemmaConfig = getGemmaConfig();
  const apiKey = getGemmaApiKey();

  // If Gemma is not configured in environment, return rich grounded fallback
  if (!gemmaConfig.hasApiKey || !apiKey) {
    const fallback = buildFallbackExplanation(item);
    EXPLANATION_CACHE.set(cacheKey, fallback);
    return fallback;
  }

  const prompt = `You are the FocusLock AI Study Assistant explaining a trending tech topic to a focused student.
Analyze the following retrieved source article and provide an educational, strictly factual explanation.

SOURCE ARTICLE:
Title: "${item.title}"
Source: ${item.source}
Category: ${item.category}
Published: ${item.publishedAt}
Summary/Excerpt: "${item.summary}"
URL: ${item.url}

STRICT REQUIREMENTS:
1. Base your explanation strictly on the provided facts. Do NOT invent details, benchmark scores, or quotes.
2. If any aspect is unconfirmed or ongoing, state so clearly.
3. Keep the tone inspiring, educational, and focused.
4. Respond ONLY with a valid JSON object matching the exact schema below. Do not wrap in markdown or backticks.

JSON SCHEMA:
{
  "summary": "2 concise paragraphs explaining the topic clearly and educationally.",
  "keyFacts": [
    "Fact 1 directly from article",
    "Fact 2 directly from article",
    "Fact 3 directly from article",
    "Fact 4 directly from article"
  ],
  "whyItMatters": "Why this development matters for learners, developers, or society.",
  "context": "How this connects to broader computing, software, or science trends.",
  "relatedTopics": ["Related Topic 1", "Related Topic 2", "Related Topic 3", "Related Topic 4"],
  "avatarAnnouncement": "A friendly 1-2 sentence spoken intro for the FocusLock avatar companion."
}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 18000);

    const requestUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      gemmaConfig.primaryModel
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(requestUrl, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1200,
        },
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`[AuraSync] Gemma explanation failed with status ${response.status}. Using fallback.`);
      const fallback = buildFallbackExplanation(item);
      EXPLANATION_CACHE.set(cacheKey, fallback);
      return fallback;
    }

    const data = await response.json();
    const candidateText: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    // Clean JSON delimiters if model accidentally wrapped with ```json
    const cleanedJson = candidateText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const parsed = JSON.parse(cleanedJson);

    const explanation: TopicExplanation = {
      summary: typeof parsed.summary === "string" ? parsed.summary.trim() : item.summary,
      keyFacts: Array.isArray(parsed.keyFacts)
        ? parsed.keyFacts.filter((f: unknown) => typeof f === "string" && f.trim().length > 0)
        : [item.summary],
      whyItMatters: typeof parsed.whyItMatters === "string" ? parsed.whyItMatters.trim() : item.relevanceNote,
      context:
        typeof parsed.context === "string"
          ? parsed.context.trim()
          : "Relevant update in the contemporary technology ecosystem.",
      relatedTopics: Array.isArray(parsed.relatedTopics)
        ? parsed.relatedTopics.filter((t: unknown) => typeof t === "string" && t.trim().length > 0)
        : [`${item.category} updates`, "FocusLock study paths"],
      avatarAnnouncement:
        typeof parsed.avatarAnnouncement === "string"
          ? parsed.avatarAnnouncement.trim()
          : `Here is a quick overview of ${item.title}. Let's take a look, then get back to our mission!`,
      estimatedReadingTime: `${item.readingTimeMinutes} min read`,
    };

    EXPLANATION_CACHE.set(cacheKey, explanation);
    return explanation;
  } catch (err) {
    console.warn("[AuraSync] Error during Gemma explanation:", (err as Error).message);
    const fallback = buildFallbackExplanation(item);
    EXPLANATION_CACHE.set(cacheKey, fallback);
    return fallback;
  }
}

export async function askTopicFollowUp(
  item: AuraSyncItem,
  question: string,
  existingExplanation: TopicExplanation
): Promise<string> {
  const gemmaConfig = getGemmaConfig();
  const apiKey = getGemmaApiKey();

  if (!gemmaConfig.hasApiKey || !apiKey) {
    return `Based on the reporting for "${item.title}" from ${item.source}: ${item.summary} To learn more specific implementation details, explore the original source at ${item.url}.`;
  }

  const prompt = `You are the FocusLock AI Study Assistant.
The student is exploring this recent article:
Title: "${item.title}"
Source: ${item.source}
Category: ${item.category}
Summary: "${item.summary}"
Key Facts: ${existingExplanation.keyFacts.join(" | ")}

The student asked this follow-up question:
"${question}"

Provide a concise, strictly factual, and direct answer (under 120 words). Do NOT invent unsupported facts. If the article does not specify, state that clearly and suggest how they could research further.`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const requestUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      gemmaConfig.primaryModel
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(requestUrl, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 350,
        },
      }),
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return `According to ${item.source}, "${item.title}" centers around: ${item.summary}. You can read the primary documentation at the original source link.`;
    }

    const data = await response.json();
    return (
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ??
      "I couldn't generate a specific answer for this question, but you can read the primary source for details."
    );
  } catch {
    return `According to ${item.source}, "${item.title}" centers around: ${item.summary}. You can explore the original publication for further details.`;
  }
}
