// lib/ml-utils.ts
// Primary: Gemini Flash (free)
// Fallback 1: Groq Llama (free)
// Fallback 2: ML Heuristic (always available)

interface EnsembleResult {
  primary_verdict: "REAL" | "FAKE" | "UNVERIFIED"
  confidence_score: number
  reasoning: string
  ml_signals: {
    verdict_explanation: string
    credibility_indicators: string[]
    red_flags: string[]
    sentiment: string
    writing_quality: string
  } | null
}

// ── Gemini Flash API Call ─────────────────────────────────────────────────
async function callGemini(prompt: string, systemPrompt: string, apiKey: string): Promise<string | null> {
  const models = [
    "gemini-2.0-flash",
    "gemini-1.5-flash-latest",      
  ]

  for (const model of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 700, responseMimeType: "application/json" },
          }),
          signal: AbortSignal.timeout(15000),
        }
      )

      if (res.status === 429) {
        console.warn(`[Gemini] 429 on ${model}, trying next...`)
        await new Promise(r => setTimeout(r, 1000)) // wait 1s before next model
        continue
      }

      if (!res.ok) { console.warn(`[Gemini] HTTP ${res.status} on ${model}`); continue }

      const data = await res.json()
      return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null
    } catch (err) {
      console.warn(`[Gemini] Error on ${model}:`, err)
    }
  }
  return null
}

// ── Groq Fallback ─────────────────────────────────────────────────────────
async function callGroq(
  prompt: string,
  systemPrompt: string,
  apiKey: string,
): Promise<string | null> {
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 700,
        temperature: 0.1,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      console.warn(`[Groq] HTTP ${res.status}`)
      return null
    }
    const data = await res.json()
    return data.choices?.[0]?.message?.content ?? null
  } catch (err) {
    console.warn("[Groq] Error:", err)
    return null
  }
}

// ── Shared Prompt Builder ─────────────────────────────────────────────────
function buildPrompt(content: string, evidence?: string): { system: string; user: string } {
  const system = `You are an expert news credibility analyst. Analyze the article and return ONLY a valid JSON object — no markdown, no extra text.`

  const evidenceSection = evidence
    ? `\n\nPre-gathered evidence:\n"""\n${evidence}\n"""\n`
    : ""

  const user = `Analyze this news article for credibility.${evidenceSection}

Return ONLY this JSON:
{
  "verdict": "REAL" | "FAKE" | "UNVERIFIED",
  "confidence": <number 30-97>,
  "verdict_explanation": "<2-3 sentence explanation>",
  "credibility_indicators": ["<positive signal>"],
  "red_flags": ["<concern>"],
  "sentiment": "neutral" | "slightly emotional" | "moderately emotional" | "highly emotional",
  "writing_quality": "professional" | "average" | "poor"
}

Verdict rules:
- REAL: credible source, factual language, verifiable claims
- FAKE: sensationalist, unverified claims, clickbait, no sources
- UNVERIFIED: mixed signals, plausible but insufficient evidence

Article:
"""
${content.substring(0, 3000)}
"""`

  return { system, user }
}

// ── Parse JSON Response ───────────────────────────────────────────────────
function parseResponse(raw: string, source: string): EnsembleResult | null {
  try {
    const clean = raw.replace(/```json\n?|\n?```/g, "").trim()
    const parsed = JSON.parse(clean)
    if (!parsed.verdict || !["REAL", "FAKE", "UNVERIFIED"].includes(parsed.verdict)) return null
    return {
      primary_verdict: parsed.verdict,
      confidence_score: Math.min(Math.max(Math.round(parsed.confidence ?? 50), 30), 97),
      reasoning: `${source}: ${parsed.verdict_explanation ?? ""}`,
      ml_signals: {
        verdict_explanation: parsed.verdict_explanation ?? "",
        credibility_indicators: parsed.credibility_indicators ?? [],
        red_flags: parsed.red_flags ?? [],
        sentiment: parsed.sentiment ?? "neutral",
        writing_quality: parsed.writing_quality ?? "average",
      },
    }
  } catch {
    console.warn(`[${source}] JSON parse failed`)
    return null
  }
}

// ── Main Ensemble Analysis ────────────────────────────────────────────────
export async function ensembleAnalysis(
  content: string,
  evidence: string,
  _openaiKey: string,   // kept for backward compat, no longer used
  groqApiKey?: string,
): Promise<EnsembleResult> {
  const geminiKey = process.env.GEMINI_API_KEY
  const groqKey   = groqApiKey ?? process.env.GROQ_API_KEY
  const { system, user } = buildPrompt(content, evidence)

  // ── 1. Try Gemini Flash (primary) ────────────────────────────────────
  if (geminiKey) {
    const raw = await callGemini(user, system, geminiKey)
    if (raw) {
      const result = parseResponse(raw, "Gemini Flash")
      if (result) {
        console.log(`[ClarifAI] ✓ Gemini: ${result.primary_verdict} (${result.confidence_score}%)`)
        return result
      }
    }
    console.warn("[ClarifAI] Gemini failed, trying Groq...")
  }

  // ── 2. Try Groq Llama (fallback) ─────────────────────────────────────
  if (groqKey) {
    const raw = await callGroq(user, system, groqKey)
    if (raw) {
      const result = parseResponse(raw, "Groq Llama")
      if (result) {
        console.log(`[ClarifAI] ✓ Groq: ${result.primary_verdict} (${result.confidence_score}%)`)
        return result
      }
    }
    console.warn("[ClarifAI] Groq failed, using heuristic...")
  }

  // ── 3. Heuristic fallback (always works) ─────────────────────────────
  console.warn("[ClarifAI] All LLMs unavailable — heuristic fallback")
  return heuristicFallback(content)
}

// ── Heuristic Fallback ────────────────────────────────────────────────────
function heuristicFallback(content: string): EnsembleResult {
  const emotional   = analyzeEmotional(content)
  const credibility = analyzeCredibility(content)

  let verdict: "REAL" | "FAKE" | "UNVERIFIED" = "UNVERIFIED"
  let confidence = 50

  if (credibility > 0.68 && emotional < 0.35) {
    verdict = "REAL"; confidence = Math.round(55 + credibility * 28)
  } else if (credibility < 0.32 && emotional > 0.55) {
    verdict = "FAKE"; confidence = Math.round(55 + (1 - credibility) * 22)
  }

  return {
    primary_verdict: verdict,
    confidence_score: Math.min(confidence, 75),
    reasoning: `Heuristic (LLMs unavailable). Credibility: ${(credibility * 100).toFixed(0)}%`,
    ml_signals: {
      verdict_explanation: `Analyzed using built-in heuristics. Credibility score: ${(credibility * 100).toFixed(0)}%, Emotional tone: ${(emotional * 100).toFixed(0)}%.`,
      credibility_indicators: credibility > 0.5 ? ["Content contains credible writing patterns"] : [],
      red_flags: emotional > 0.5 ? ["High emotional language detected"] : [],
      sentiment: emotional > 0.6 ? "highly emotional" : emotional > 0.35 ? "moderately emotional" : "neutral",
      writing_quality: credibility > 0.65 ? "professional" : credibility > 0.4 ? "average" : "poor",
    },
  }
}

function analyzeEmotional(text: string): number {
  const extreme = ["shocking","outrageous","unbelievable","evil","scandal","bombshell","exposed","conspiracy"]
  const high    = ["amazing","terrible","urgent","horrific","disaster","tragic","devastating","stunning"]
  const lower   = text.toLowerCase()
  let score = 0
  for (const w of extreme) score += (lower.match(new RegExp(`\\b${w}\\b`, "g")) || []).length * 0.15
  for (const w of high)    score += (lower.match(new RegExp(`\\b${w}\\b`, "g")) || []).length * 0.08
  return Math.min(score, 1)
}

function analyzeCredibility(text: string): number {
  let score = 0.5
  const citations = [/according to/i, /research (shows|indicates)/i, /study found/i, /experts? (say|warn)/i, /reported by/i, /\[\d+\]/]
  score += citations.filter(p => p.test(text)).length * 0.07
  score += Math.min((text.match(/\b\d+(\.\d+)?%?\b/g) || []).length / 10, 0.1)
  const vague = [/they say/i, /sources claim/i, /people are saying/i]
  score -= vague.filter(p => p.test(text)).length * 0.08
  const clickbait = [/you won't believe/i, /shocking truth/i, /they don't want you to know/i]
  score -= clickbait.filter(p => p.test(text)).length * 0.1
  return Math.max(0, Math.min(score, 1))
}

// ── Legacy exports (kept for backward compat) ─────────────────────────────
export async function analyzeSentimentWithTransformers() { return null }
export async function extractEntitiesWithNER() { return [] }