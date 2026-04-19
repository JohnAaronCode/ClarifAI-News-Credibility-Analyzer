import { type NextRequest, NextResponse } from "next/server"
import { ensembleAnalysis } from "@/lib/ml-utils"
import { analysisCache, factCheckCache, newsApiCache, makeCacheKey, makeQueryKey } from "@/lib/cache"

export async function POST(request: NextRequest) {
  try {
    const { content, type, fileName } = await request.json()
    if (!content) {
      return NextResponse.json({ error: "No content provided" }, { status: 400 })
    }

    let processedContent = content
    let extractedTitle: string | undefined = undefined

    if (type === "url") {
      try {
        console.log("[v0] Fetching URL:", content)
        const response = await fetch(content, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
          signal: AbortSignal.timeout(15000),
        })
        if (!response.ok) {
          return NextResponse.json({
            verdict: "ERROR",
            confidence_score: 0,
            explanation: `Unable to fetch URL. Status: ${response.status}. Please check if the URL is accessible.`,
          })
        }
        const html = await response.text()
        processedContent = extractTextFromHTML(html)
        extractedTitle = extractTitleFromHTML(html) || undefined
        console.log("[v0] Extracted URL content length:", processedContent.length)
        console.log("[v0] Extracted title:", extractedTitle)

        if (processedContent.length < 30) {
          return NextResponse.json({
            verdict: "ERROR",
            confidence_score: 0,
            explanation: "URL content is too short or empty. Please check if the URL contains an article.",
          })
        }
      } catch (error) {
        console.error("[v0] Error fetching URL:", error)
        return NextResponse.json({
          verdict: "ERROR",
          confidence_score: 0,
          explanation: "Failed to fetch the URL. Please ensure it is valid and accessible.",
        })
      }
    }

    const validationResult = validateContent(processedContent, type)
    if (!validationResult.isValid) {
      return NextResponse.json({
        verdict: "ERROR",
        confidence_score: 0,
        explanation: validationResult.message,
      })
    }

    // ── Cache check ───────────────────────────────────────────────────────
    const cacheKey = makeCacheKey(processedContent, type)
    const cached = analysisCache.get(cacheKey)
    if (cached) {
      console.log("[ClarifAI] Cache hit — returning cached analysis")
      return NextResponse.json(cached)
    }

    const analysis = await analyzeContentWithDualEngine(processedContent, type, fileName, content, extractedTitle)
    analysisCache.set(cacheKey, analysis)
    return NextResponse.json(analysis)
  } catch (error) {
    console.error("Analysis error:", error)
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 })
  }
}

// ── Shared HTML entity decoder ────────────────────────────────────────────
function decodeHTMLEntities(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    // Numeric decimal entities — covers WordPress curly quotes like &#8216; &#8217; &#8220; &#8221;
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    // Numeric hex entities like &#x2019;
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    // Named entities
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&ldquo;/g, "\u201C")
    .replace(/&rdquo;/g, "\u201D")
    .replace(/&lsquo;/g, "\u2018")
    .replace(/&rsquo;/g, "\u2019")
    .replace(/&mdash;/g, "\u2014")
    .replace(/&ndash;/g, "\u2013")
    .trim()
}

function extractTitleFromHTML(html: string): string {
  // 1st priority: <h1> — most accurate headline on news sites
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  if (h1Match) {
    const decoded = decodeHTMLEntities(h1Match[1])
    if (decoded.length > 10) return decoded
  }

  // 2nd priority: og:title meta — complete headline without site-name suffix
  const ogTitleMatch =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)
  if (ogTitleMatch) {
    const decoded = decodeHTMLEntities(ogTitleMatch[1])
    if (decoded.length > 10) return decoded
  }

  // 3rd priority: <title> tag — strip site name suffix
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (titleMatch) {
    return decodeHTMLEntities(titleMatch[1]).split(/\s[\|\-–—]\s/)[0].trim()
  }

  return ""
}

function extractTextFromHTML(html: string): string {
  const text = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Decode numeric entities in body text too
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\s+/g, " ")
    .trim()
  return text
}

function detectMeaninglessContent(content: string): { isMeaningless: boolean; reason: string; score: number } {
  const trimmed = content.trim()
  const words = trimmed.toLowerCase().split(/\s+/).filter((w) => w.length > 0)
  const sentences = trimmed.split(/[.!?]+/).filter((s) => s.trim().length > 0)
  let meaningfulnessScore = 100

  const punctuationRatio = (trimmed.match(/[!?]{2,}|\.{2,}/g) || []).length * 5
  if (punctuationRatio > 20) meaningfulnessScore -= 30
  const oddCapitalizations = (trimmed.match(/[a-z][A-Z][a-z]/g) || []).length
  if (oddCapitalizations > words.length * 0.2) meaningfulnessScore -= 25
  const avgSentenceLength = words.length / Math.max(sentences.length, 1)
  if (avgSentenceLength < 3 && words.length > 20) meaningfulnessScore -= 20
  const fillerWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'to', 'of', 'in', 'at', 'on', 'by'])
  let fillerCount = 0
  for (const word of words) { if (fillerWords.has(word)) fillerCount++ }
  if (fillerCount / words.length > 0.5) meaningfulnessScore -= 25
  const spamPhrases = ['best', 'amazing', 'incredible', 'absolutely', 'definitely', 'certainly', 'extremely', 'very', 'really', 'so', 'most', 'must', 'should', 'would']
  const lc = trimmed.toLowerCase()
  let superlativeCount = 0
  for (const p of spamPhrases) superlativeCount += (lc.match(new RegExp(p, 'g')) || []).length
  if (superlativeCount > words.length * 0.15) meaningfulnessScore -= 20
  if ((trimmed.match(/([a-z])\1{2,}/g) || []).length > 5) meaningfulnessScore -= 30
  if ((trimmed.match(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]{2,}/g) || []).length > 3) meaningfulnessScore -= 25
  const uppercase = (trimmed.match(/[A-Z]/g) || []).length
  const lowercase = (trimmed.match(/[a-z]/g) || []).length
  if (uppercase === 0 || lowercase === 0) meaningfulnessScore -= 15
  const transitionWords = ['however', 'therefore', 'thus', 'meanwhile', 'furthermore', 'moreover', 'consequently', 'accordingly', 'subsequently', 'likewise', 'similarly', 'instead', 'otherwise', 'rather', 'namely', 'indeed', 'also', 'because']
  if (transitionWords.filter(w => lc.includes(w)).length === 0 && words.length > 100) meaningfulnessScore -= 10
  if (new Set(words).size / words.length < 0.3) meaningfulnessScore -= 15
  meaningfulnessScore = Math.max(0, Math.min(100, meaningfulnessScore))
  if (meaningfulnessScore < 30) {
    return { isMeaningless: true, reason: "Content appears to be random, nonsensical, or gibberish. Please provide meaningful, coherent text for analysis.", score: meaningfulnessScore }
  }
  return { isMeaningless: false, reason: "", score: meaningfulnessScore }
}

function detectRepetitiveContent(content: string): { isRepetitive: boolean; reason: string } {
  const words = content.toLowerCase().split(/\s+/).filter((w) => w.length > 0)
  const uniqueWords = new Set(words)
  if (uniqueWords.size / words.length < 0.4) {
    return { isRepetitive: true, reason: "Content appears to be repetitive or spammy. Unique word ratio is too low." }
  }
  const wordFreq = new Map<string, number>()
  for (const word of words) wordFreq.set(word, (wordFreq.get(word) || 0) + 1)
  let maxFreq = 0, maxWord = ""
  for (const [word, freq] of wordFreq.entries()) {
    if (freq > maxFreq && word.length > 2) { maxFreq = freq; maxWord = word }
  }
  if (maxFreq > 0 && maxFreq / words.length > 0.3) {
    return { isRepetitive: true, reason: `Content is overly repetitive with the word "${maxWord}" appearing excessively.` }
  }
  const phrases = new Set<string>(), repeatedPhrases = new Set<string>()
  for (let i = 0; i < words.length - 2; i++) {
    const phrase = words.slice(i, i + 3).join(" ")
    if (phrases.has(phrase)) repeatedPhrases.add(phrase)
    phrases.add(phrase)
  }
  if (repeatedPhrases.size > words.length / 20) {
    return { isRepetitive: true, reason: "Content contains excessive phrase repetition, suggesting fabricated or template-based text." }
  }
  return { isRepetitive: false, reason: "" }
}

function validateContent(content: string, type: string): { isValid: boolean; message: string } {
  const trimmed = content.trim()
  if (trimmed.length < 30) return { isValid: false, message: "Content is too short. Please provide more text." }
  if (!/[a-zA-Z]/.test(trimmed)) return { isValid: false, message: "Content must contain text. Please provide a valid article or document." }
  if (trimmed.split(/\s+/).length < 5) return { isValid: false, message: "Please provide meaningful content to proceed." }
  const meaningfulnessCheck = detectMeaninglessContent(trimmed)
  if (meaningfulnessCheck.isMeaningless) return { isValid: false, message: meaningfulnessCheck.reason }
  if (type !== "url") {
    const repetitionCheck = detectRepetitiveContent(trimmed)
    if (repetitionCheck.isRepetitive) return { isValid: false, message: repetitionCheck.reason }
  }
  return { isValid: true, message: "" }
}

function buildSourceSearchUrl(sourceDomain: string, query: string): string {
  const encoded = query.substring(0, 80).trim().split(/\s+/).map(encodeURIComponent).join("+")
  const searchUrlMap: Record<string, string> = {
    "rappler.com":        `https://www.rappler.com/search?q=${encoded}`,
    "gmanetwork.com":     `https://www.gmanetwork.com/news/search?q=${encoded}`,
    "abs-cbn.com":        `https://news.abs-cbn.com/search?q=${encoded}`,
    "inquirer.net":       `https://www.inquirer.net/search?q=${encoded}`,
    "philstar.com":       `https://www.philstar.com/search?q=${encoded}`,
    "manilatimes.net":    `https://www.manilatimes.net/search?q=${encoded}`,
    "mb.com.ph":          `https://mb.com.ph/search?s=${encoded}`,
    "cnnphilippines.com": `https://www.cnnphilippines.com/search?q=${encoded}`,
    "bbc.com":            `https://www.bbc.co.uk/search?q=${encoded}`,
    "reuters.com":        `https://www.reuters.com/search/news?blob=${encoded}`,
    "apnews.com":         `https://apnews.com/search?q=${encoded}`,
    "cnn.com":            `https://edition.cnn.com/search?q=${encoded}`,
    "theguardian.com":    `https://www.theguardian.com/search?q=${encoded}`,
    "nytimes.com":        `https://www.nytimes.com/search?query=${encoded}`,
    "washingtonpost.com": `https://www.washingtonpost.com/search/?query=${encoded}`,
    "bloomberg.com":      `https://www.bloomberg.com/search?query=${encoded}`,
    "aljazeera.com":      `https://www.aljazeera.com/search/${encoded}`,
    "npr.org":            `https://www.npr.org/search?query=${encoded}`,
    "cnbc.com":           `https://www.cnbc.com/search/?query=${encoded}`,
    "foxnews.com":        `https://www.foxnews.com/search-results/search?q=${encoded}`,
  }
  const match = Object.entries(searchUrlMap).find(([domain]) => sourceDomain.includes(domain))
  if (match) return match[1]
  return `https://news.google.com/search?q=${encoded}+site:${sourceDomain}`
}

function extractContentKeywords(content: string, maxKeywords = 6): string {
  const stopwords = new Set([
    "the","a","an","and","or","but","is","are","was","were","to","of","in",
    "at","on","by","for","with","this","that","it","its","as","be","been",
    "has","had","have","will","said","also","from","more","than","about",
    "after","before","over","under","they","their","there","would","could",
    "should","very","just","which","when","what","where","who","how","may",
    "might","then","than","into","onto","upon","within","without","between",
    "through","during","until","while","since","because","although","however",
    "therefore","thus","so","yet","nor","not","no","only","even","still",
    "already","again","once","twice","many","much","some","any","all","both",
    "each","every","either","neither","other","another","such","same","own",
    "its","our","your","his","her","their","my","we","you","he","she","they",
    "i","me","him","us","them","what","which","who","whom","whose",
  ])
  const words = content
    .replace(/[^a-zA-Z0-9\s'-]/g, " ")
    .split(/\s+/)
    .map(w => w.toLowerCase().replace(/^['-]+|['-]+$/g, ""))
    .filter(w => w.length > 3 && !stopwords.has(w) && !/^\d+$/.test(w))
  const freq = new Map<string, number>()
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1)
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([w]) => w)
    .join(" ")
    .trim()
}

async function fetchFromGNews(
  query: string,
  excludeDomain: string | null,
  apiKey: string,
): Promise<Array<{ name: string; url: string; article_url: string; search_url: string; homepage_url: string }>> {
  const cacheKey = makeQueryKey(query, "gnews")
  const cached = newsApiCache.get(cacheKey)
  if (cached) return cached
  try {
    const q = encodeURIComponent(query.replace(/[^\w\s]/g, " ").substring(0, 80).trim())
    const url = `https://gnews.io/api/v4/search?q=${q}&lang=en&max=10&apikey=${apiKey}`
    const res = await fetch(url, { signal: AbortSignal.timeout(7000) })
    if (!res.ok) { console.warn(`[GNews] HTTP ${res.status}`); return [] }
    const data = await res.json()
    const articles: any[] = data.articles ?? []
    const seen = new Set<string>()
    const results: Array<{ name: string; url: string; article_url: string; search_url: string; homepage_url: string }> = []
    for (const article of articles) {
      if (!article.url?.startsWith("http")) continue
      if (article.title === "[Removed]") continue
      let domain = ""
      try { domain = new URL(article.url).hostname.replace("www.", "") } catch { continue }
      if (excludeDomain && domain.includes(excludeDomain)) continue
      if (seen.has(domain)) continue
      seen.add(domain)
      results.push({ name: article.source?.name || domain, url: article.url, article_url: article.url, search_url: article.url, homepage_url: `https://${domain}` })
      if (results.length >= 3) break
    }
    newsApiCache.set(cacheKey, results)
    return results
  } catch (err) { console.warn("[GNews] Error:", err); return [] }
}

async function fetchFromGoogleSearch(
  query: string,
  excludeDomain: string | null,
  apiKey: string,
  cx: string,
): Promise<Array<{ name: string; url: string; article_url: string; search_url: string; homepage_url: string }>> {
  const cacheKey = makeQueryKey(query, "google")
  const cached = newsApiCache.get(cacheKey)
  if (cached) return cached
  try {
    const q = encodeURIComponent(query.substring(0, 100))
    const url = `https://www.googleapis.com/customsearch/v1?q=${q}&key=${apiKey}&cx=${cx}&num=10`
    const res = await fetch(url, { signal: AbortSignal.timeout(7000) })
    if (!res.ok) { console.warn(`[Google Search] HTTP ${res.status}`); return [] }
    const data = await res.json()
    const items: any[] = data.items ?? []
    const seen = new Set<string>()
    const results: Array<{ name: string; url: string; article_url: string; search_url: string; homepage_url: string }> = []
    for (const item of items) {
      if (!item.link?.startsWith("http")) continue
      let domain = ""
      try { domain = new URL(item.link).hostname.replace("www.", "") } catch { continue }
      if (excludeDomain && domain.includes(excludeDomain)) continue
      if (seen.has(domain)) continue
      seen.add(domain)
      results.push({ name: item.og?.site_name || item.displayLink?.replace("www.", "") || domain, url: item.link, article_url: item.link, search_url: item.link, homepage_url: `https://${domain}` })
      if (results.length >= 3) break
    }
    newsApiCache.set(cacheKey, results)
    return results
  } catch (err) { console.warn("[Google Search] Error:", err); return [] }
}

async function fetchFromNewsAPI(
  query: string,
  excludeDomain: string | null,
  apiKey: string,
): Promise<Array<{ name: string; url: string; article_url: string; search_url: string; homepage_url: string }>> {
  const cacheKey = makeQueryKey(query, "newsapi")
  const cached = newsApiCache.get(cacheKey)
  if (cached) return cached
  try {
    const q = query.substring(0, 100).trim().split(/\s+/).map(encodeURIComponent).join("+")
    const url = `https://newsapi.org/v2/everything?q=${q}&sortBy=relevancy&pageSize=10&language=en&apiKey=${apiKey}`
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return []
    const data = await res.json()
    const articles: any[] = data.articles ?? []
    const seen = new Set<string>()
    const results: Array<{ name: string; url: string; article_url: string; search_url: string; homepage_url: string }> = []
    for (const article of articles) {
      if (!article.url?.startsWith("http")) continue
      if (article.title === "[Removed]" || article.url?.includes("removed")) continue
      let domain = ""
      try { domain = new URL(article.url).hostname.replace("www.", "") } catch { continue }
      if (excludeDomain && domain.includes(excludeDomain)) continue
      if (seen.has(domain)) continue
      seen.add(domain)
      results.push({ name: article.source?.name || domain, url: article.url, article_url: article.url, search_url: article.url, homepage_url: `https://${domain}` })
      if (results.length >= 3) break
    }
    newsApiCache.set(cacheKey, results)
    return results
  } catch (err) { console.warn("[NewsAPI] Error:", err); return [] }
}

type SourceResult = { name: string; url: string; article_url?: string; search_url: string; homepage_url: string }

async function findRelatedTrustedSources(
  searchQuery: string,
  contentKeywords: string,
  excludeDomain: string | null,
  gNewsApiKey: string | undefined,
  googleSearchApiKey: string | undefined,
  googleSearchCx: string | undefined,
  newsApiKey: string | undefined,
  detectedTopics: string[],
  isPhilippinesContent: boolean,
): Promise<SourceResult[]> {
  const query = contentKeywords || searchQuery
  if (!query) return []
  console.log("[ClarifAI] Related sources query:", query)
  if (gNewsApiKey) {
    const results = await fetchFromGNews(query, excludeDomain, gNewsApiKey)
    if (results.length >= 1) { console.log(`[ClarifAI] GNews returned ${results.length} related articles`); return results.slice(0, 2) }
  }
  if (googleSearchApiKey && googleSearchCx) {
    const results = await fetchFromGoogleSearch(query, excludeDomain, googleSearchApiKey, googleSearchCx)
    if (results.length >= 1) { console.log(`[ClarifAI] Google Search returned ${results.length} related articles`); return results.slice(0, 2) }
  }
  if (newsApiKey) {
    const results = await fetchFromNewsAPI(query, excludeDomain, newsApiKey)
    if (results.length > 0) { console.log(`[ClarifAI] NewsAPI returned ${results.length} related articles`); return results.slice(0, 2) }
  }
  if (detectedTopics.length === 0) return []
  const topicMatched = ALL_SOURCES
    .filter((src) => {
      if (excludeDomain && src.domain.includes(excludeDomain)) return false
      if (src.isLocal && !isPhilippinesContent) return false
      return true
    })
    .map((src) => {
      const overlap = src.topics.filter((t) => detectedTopics.includes(t)).length
      return { src, overlap, score: overlap + src.credibility * 0.01 }
    })
    .filter((s) => s.overlap > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
  if (topicMatched.length === 0) return []
  return topicMatched.map(({ src }) => {
    const search_url = buildSourceSearchUrl(src.domain, searchQuery)
    return { name: src.name, url: search_url, article_url: undefined, search_url, homepage_url: src.url }
  })
}

async function analyzeContentWithDualEngine(
  content: string,
  type: string,
  fileName?: string,
  originalInput?: string,
  articleTitle?: string,
) {
  const openaiApiKey    = process.env.OPENAI_API_KEY
  const groqApiKey      = process.env.GROQ_API_KEY
  const gNewsApiKey     = process.env.GNEWS_API_KEY
  const googleSearchKey = process.env.GOOGLE_SEARCH_API_KEY
  const googleSearchCx  = process.env.GOOGLE_SEARCH_CX
  const newsApiKey      = process.env.NEWS_API_KEY

  const entities            = extractEntitiesAdvanced(content)
  const claims              = extractMainClaims(content)
  const detectedTopics      = detectTopicsFromContent(content.toLowerCase())
  const phKeywordMatches    = TOPIC_KEYWORDS.national.filter((kw) => content.toLowerCase().includes(kw)).length
  const isPhilippinesContent = detectedTopics.includes("national") && phKeywordMatches >= 2
  const sourceAnalysis      = analyzeSource(content, type, originalInput)
  const factChecks          = await generateFactChecksWithRealAPIs(content, claims)
  const clickbaitScore      = detectClickbait(content)
  const credibilityPatterns = analyzeCredibilityPatterns(content)
  const sentimentAnalysis   = analyzeSentiment(content)

  const contentKeywords = extractContentKeywords(content, 6)
  const aiQuery    = await buildAISearchQuery(content, openaiApiKey, groqApiKey)
  const searchQuery = aiQuery || buildSearchQuery(content, claims)
  console.log("[ClarifAI] Content keywords:", contentKeywords)
  console.log("[ClarifAI] Search query:", searchQuery)

  let reference = ""
  if (sourceAnalysis.source) {
    try {
      const parsed = new URL(sourceAnalysis.source)
      reference = buildSourceSearchUrl(parsed.hostname.replace("www.", ""), searchQuery)
    } catch { reference = sourceAnalysis.source }
  }
  const bestFactCheck = factChecks.find((f: any) => f.source?.startsWith("http") && f.source !== "Source not identified")
  if (bestFactCheck) reference = bestFactCheck.source

  const evidence = buildEvidenceContext({
    sourceAnalysis, factChecks, clickbaitScore, credibilityPatterns, sentimentAnalysis, detectedTopics,
  })

  let verdict: "REAL" | "FAKE" | "UNVERIFIED" = "UNVERIFIED"
  let confidence = 50
  let explanation = ""
  let ensembleResult: any = null

  if (groqApiKey || openaiApiKey) {
    ensembleResult = await ensembleAnalysis(content, evidence, openaiApiKey || "", groqApiKey)
  }

  if (ensembleResult?.ml_signals) {
    verdict     = ensembleResult.primary_verdict as any
    confidence  = ensembleResult.confidence_score
    explanation = ensembleResult.ml_signals.verdict_explanation || ""
  } else {
    const rawScore =
      sourceAnalysis.credibility * 0.35 +
      credibilityPatterns.score  * 0.30 +
      (1 - Math.max(0, sentimentAnalysis.emotionalScore - 0.3)) * 0.15 +
      (1 - clickbaitScore) * 0.15 +
      Math.min(content.length / 2000, 0.1) * 0.05
    confidence = Math.round(Math.min(rawScore * 100, 99))
    if (rawScore >= 0.72)      verdict = "REAL"
    else if (rawScore <= 0.38) verdict = "FAKE"
    else                       verdict = "UNVERIFIED"
    explanation = buildExplanation(verdict, {
      sourceCredibility: sourceAnalysis.credibility,
      emotionalScore: sentimentAnalysis.emotionalScore,
      clickbaitScore, credibilityPatterns, hasFactCheck: !!bestFactCheck,
    })
  }

  let analyzedDomain: string | null = null
  let ownSourceLink: SourceResult | null = null

  if (type === "url" && originalInput) {
    try {
      const parsed = new URL(originalInput)
      analyzedDomain = parsed.hostname.replace("www.", "")
      const matchedSrc = ALL_SOURCES.find(s => analyzedDomain!.includes(s.domain))
      const ownSearchUrl = buildSourceSearchUrl(analyzedDomain, searchQuery)
      ownSourceLink = {
        name: matchedSrc?.name ?? analyzedDomain,
        url: ownSearchUrl,
        article_url: originalInput,
        search_url: ownSearchUrl,
        homepage_url: `https://${analyzedDomain}`,
      }
    } catch { /* ignore */ }
  } else if (type === "text" && sourceAnalysis.source) {
    try {
      const parsed = new URL(sourceAnalysis.source)
      analyzedDomain = parsed.hostname.replace("www.", "")
      const matchedSrc = ALL_SOURCES.find(s => analyzedDomain!.includes(s.domain))
      if (matchedSrc) {
        const ownSearchUrl = buildSourceSearchUrl(analyzedDomain, searchQuery)
        ownSourceLink = {
          name: matchedSrc.name,
          url: ownSearchUrl,
          article_url: undefined,
          search_url: ownSearchUrl,
          homepage_url: matchedSrc.url,
        }
      }
    } catch { /* ignore */ }
  }

  const relatedSources = await findRelatedTrustedSources(
    searchQuery, contentKeywords, analyzedDomain,
    gNewsApiKey, googleSearchKey, googleSearchCx, newsApiKey,
    detectedTopics, isPhilippinesContent,
  )

  const seenDomains = new Set<string>()
  const enrichedSourceLinks: SourceResult[] = []

  if (ownSourceLink) {
    enrichedSourceLinks.push(ownSourceLink)
    seenDomains.add(analyzedDomain ?? "")
  }

  for (const src of relatedSources) {
    let domain = ""
    try { domain = new URL(src.url).hostname.replace("www.", "") } catch { domain = src.url }
    if (!seenDomains.has(domain)) {
      enrichedSourceLinks.push(src)
      seenDomains.add(domain)
    }
    if (enrichedSourceLinks.length >= 3) break
  }

  const sourceCredibility   = await analyzeSourceCredibility(content, type, sourceAnalysis.credibility, verdict)
  const contentQuality      = await analyzeContentQuality(content, verdict, confidence)

  let adjustedSourceCred    = sourceCredibility.credibility_score
  let adjustedContentQuality = contentQuality.overall_score
  if (verdict === "REAL") {
    adjustedSourceCred    = Math.max(0.7, Math.min(1, adjustedSourceCred))
    adjustedContentQuality = Math.max(0.7, Math.min(1, adjustedContentQuality))
  } else if (verdict === "FAKE") {
    adjustedSourceCred    = Math.min(0.3, adjustedSourceCred)
    adjustedContentQuality = Math.min(0.4, adjustedContentQuality)
  } else if (verdict === "UNVERIFIED") {
    adjustedSourceCred    = Math.max(0.3, Math.min(0.5, adjustedSourceCred))
    adjustedContentQuality = Math.max(0.4, Math.min(0.6, adjustedContentQuality))
  }
  sourceCredibility.credibility_score = adjustedSourceCred
  contentQuality.overall_score        = adjustedContentQuality

  return {
    verdict,
    confidence_score: confidence,
    explanation,
    reference,
    reference_label: reference ? `Search related articles on ${extractDomainLabel(reference)}` : undefined,
    source_links: enrichedSourceLinks,
    key_entities: entities,
    sentiment_score: sentimentAnalysis.score,
    sentiment_label: sentimentAnalysis.label,
    source_credibility: Math.round(sourceAnalysis.credibility * 100),
    source_label: sourceAnalysis.label,
    source_url: sourceAnalysis.source,
    credibility_indicators: credibilityPatterns,
    fact_check_results: factChecks,
    clickbait_score: clickbaitScore,
    file_name: fileName,
    ml_enhanced: !!(ensembleResult?.ml_signals),
    ensemble_analysis: ensembleResult,
    source_credibility_detailed: sourceCredibility,
    content_quality_detailed: contentQuality,
    search_query: searchQuery,
    content_keywords: contentKeywords,
    detected_topics: detectedTopics,
    analyzed_domain: analyzedDomain,
    article_title: articleTitle,
  }
}

function buildEvidenceContext(data: {
  sourceAnalysis: { credibility: number; label: string; source: string }
  factChecks: any[]
  clickbaitScore: number
  credibilityPatterns: { score: number; hasIssues: boolean; issues: string[] }
  sentimentAnalysis: { emotionalScore: number; label: string }
  detectedTopics: string[]
}): string {
  const lines: string[] = []
  lines.push(`Source credibility: ${Math.round(data.sourceAnalysis.credibility * 100)}% — ${data.sourceAnalysis.label || "unknown source"}`)
  if (data.detectedTopics.length > 0) lines.push(`Detected topics: ${data.detectedTopics.join(", ")}`)
  const validFactChecks = data.factChecks.filter((f: any) =>
    f.source !== "Source not identified" &&
    f.reviewer !== "Manual Verification Required" &&
    f.relevance > 0.1
  )
  if (validFactChecks.length > 0) {
    lines.push(`Fact-check results (${validFactChecks.length} found):`)
    validFactChecks.slice(0, 3).forEach((f: any) => lines.push(`  - "${f.claim.substring(0, 80)}..." → ${f.conclusion} (by ${f.reviewer})`))
  } else {
    lines.push("Fact-check results: No matching fact-checks found in external databases")
  }
  const clickPct = Math.round(data.clickbaitScore * 100)
  lines.push(`Clickbait/sensationalism score: ${clickPct}% — ${clickPct > 60 ? "high" : clickPct > 30 ? "moderate" : "low — professional tone"}`)
  lines.push(`Sentiment: ${data.sentimentAnalysis.label} (emotional score: ${Math.round(data.sentimentAnalysis.emotionalScore * 100)}%)`)
  if (data.credibilityPatterns.hasIssues && data.credibilityPatterns.issues.length > 0) {
    lines.push(`Writing quality issues: ${data.credibilityPatterns.issues.join("; ")}`)
  } else {
    lines.push("Writing quality: No major issues detected")
  }
  return lines.join("\n")
}

function buildExplanation(
  verdict: "REAL" | "FAKE" | "UNVERIFIED",
  signals: { sourceCredibility: number; emotionalScore: number; clickbaitScore: number; credibilityPatterns: { score: number; hasIssues: boolean; issues: string[] }; hasFactCheck: boolean },
): string {
  const { sourceCredibility, emotionalScore, clickbaitScore, credibilityPatterns, hasFactCheck } = signals
  const reasons: string[] = []
  if (verdict === "REAL") {
    if (sourceCredibility >= 0.85) reasons.push("published by a highly credible source")
    else if (sourceCredibility >= 0.65) reasons.push("source has a good credibility record")
    if (emotionalScore < 0.25) reasons.push("written in a neutral, objective tone")
    if (clickbaitScore < 0.2) reasons.push("no sensationalist language detected")
    if (hasFactCheck) reasons.push("at least one claim was verified by a fact-checker")
    if (credibilityPatterns.score > 0.75) reasons.push("strong writing structure and credibility patterns")
    if (reasons.length === 0) return "The article shows overall credible indicators based on available signals."
    return `This article appears credible. It is ${reasons.slice(0, -1).join(", ")}${reasons.length > 1 ? ", and " : ""}${reasons[reasons.length - 1]}.`
  }
  if (verdict === "FAKE") {
    if (clickbaitScore > 0.6) reasons.push("uses sensationalist or clickbait language")
    if (emotionalScore > 0.65) reasons.push("the tone is highly emotional rather than factual")
    if (sourceCredibility < 0.35) reasons.push("the source has a low credibility rating")
    if (credibilityPatterns.issues.includes("No citations or evidence references")) reasons.push("no sources or evidence are cited")
    if (credibilityPatterns.issues.some(i => i.includes("ALL CAPS"))) reasons.push("contains multiple all-caps phrases")
    if (credibilityPatterns.issues.some(i => i.includes("Vague"))) reasons.push("relies on vague, unattributed claims")
    if (reasons.length === 0) return "The article shows several signs of unreliable or misleading content based on detected patterns."
    return `This article raises credibility concerns. It ${reasons.slice(0, -1).join(", ")}${reasons.length > 1 ? ", and " : ""}${reasons[reasons.length - 1]}.`
  }
  if (sourceCredibility >= 0.65) reasons.push("the source is generally credible")
  if (credibilityPatterns.issues.includes("No citations or evidence references")) reasons.push("no citations or evidence are provided")
  if (emotionalScore > 0.35) reasons.push("some emotional language is present")
  if (!hasFactCheck) reasons.push("no external fact-check was found for the claims")
  if (reasons.length === 0) return "The article could not be fully verified. Cross-referencing with other sources is recommended."
  return `This article's credibility is unclear. ${reasons.map(r => r.charAt(0).toUpperCase() + r.slice(1)).join(". ")}.`
}

function extractDomainLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace("www.", "")
    const knownLabels: Record<string, string> = {
      "rappler.com": "Rappler", "gmanetwork.com": "GMA News", "abs-cbn.com": "ABS-CBN",
      "inquirer.net": "Inquirer", "philstar.com": "Philstar", "bbc.co.uk": "BBC",
      "bbc.com": "BBC", "reuters.com": "Reuters", "apnews.com": "AP News",
      "cnn.com": "CNN", "nytimes.com": "NYT", "theguardian.com": "The Guardian",
      "news.google.com": "Google News",
    }
    return Object.entries(knownLabels).find(([d]) => host.includes(d))?.[1] ?? host
  } catch { return "trusted source" }
}

function analyzeSentiment(text: string) {
  const emotionalWords = {
    extreme: ["shocking","outrageous","unbelievable","evil","exclusive","breaking","exposed","scandal","bombshell","conspiracy"],
    high: ["amazing","terrible","urgent","alarming","horrific","disaster","tragic","devastating","stunning","astonishing"],
    moderate: ["important","significant","notable","remarkable","developing","concerning"],
  }
  const lowerText = text.toLowerCase()
  let emotionalScore = 0
  for (const word of emotionalWords.extreme) emotionalScore += (lowerText.match(new RegExp(`\\b${word}\\b`, "gi")) || []).length * 0.2
  for (const word of emotionalWords.high)    emotionalScore += (lowerText.match(new RegExp(`\\b${word}\\b`, "gi")) || []).length * 0.1
  for (const word of emotionalWords.moderate) emotionalScore += (lowerText.match(new RegExp(`\\b${word}\\b`, "gi")) || []).length * 0.05
  emotionalScore = Math.min(emotionalScore, 1)
  let label = "Neutral"
  if (emotionalScore > 0.75) label = "Highly emotional"
  else if (emotionalScore > 0.6) label = "Moderately emotional"
  else if (emotionalScore > 0.4) label = "Slightly emotional"
  return { score: emotionalScore, emotionalScore, label }
}

function detectClickbait(text: string): number {
  const patterns = {
    urgency: ["you won't believe","shocking","must see","don't miss","breaking news","just happened","this second","immediately","act now","limited time"],
    exaggeration: ["number one","best ever","worst ever","unbelievable","insane","crazy","mind-blowing","absolutely","stunning","astonishing"],
    vague: ["they say","people claim","sources say","officials say","health experts say","celebrities say"],
  }
  const lowerText = text.toLowerCase()
  let score = 0
  for (const p of patterns.urgency)       if (lowerText.includes(p)) score += 0.16
  for (const p of patterns.exaggeration)  if (lowerText.includes(p)) score += 0.13
  for (const p of patterns.vague)         if (lowerText.includes(p)) score += 0.22
  if ((text.match(/\?/g) || []).length > 4) score += 0.12
  return Math.min(score, 1)
}

function extractEntitiesAdvanced(text: string) {
  const words = text.split(/\s+/)
  const persons = new Set<string>(), organizations = new Set<string>(), locations = new Set<string>()
  for (let i = 0; i < words.length - 1; i++) {
    const pair = `${words[i]} ${words[i + 1]}`
    if (/^[A-Z][a-z]+\s+[A-Z][a-z]+/.test(pair)) {
      if (words[i + 1].includes("Inc") || words[i + 1].includes("Corp") || words[i + 1].includes("Ltd")) {
        organizations.add(pair)
      } else {
        persons.add(pair)
      }
    }
  }
  return { persons: Array.from(persons).slice(0, 5), organizations: Array.from(organizations).slice(0, 3), locations: Array.from(locations).slice(0, 3) }
}

function extractMainClaims(text: string): string[] {
  return text.split(/[.!?]+/).filter((s) => s.trim().length > 15).slice(0, 3).map((s) => s.trim())
}

const ALL_SOURCES = [
  { domain: "rappler.com",        name: "Rappler",                   credibility: 0.95, url: "https://rappler.com",           isLocal: true,  topics: ["national","politics","crime","health","social","technology","economy","environment"] },
  { domain: "gmanetwork.com",     name: "GMA News",                  credibility: 0.93, url: "https://gmanetwork.com/news",   isLocal: true,  topics: ["national","politics","entertainment","sports","social","health"] },
  { domain: "abs-cbn.com",        name: "ABS-CBN News",              credibility: 0.92, url: "https://news.abs-cbn.com",      isLocal: true,  topics: ["national","politics","entertainment","sports","social","health","crime"] },
  { domain: "inquirer.net",       name: "Philippine Daily Inquirer", credibility: 0.90, url: "https://inquirer.net",          isLocal: true,  topics: ["national","politics","crime","economy","social","sports"] },
  { domain: "philstar.com",       name: "Philstar",                  credibility: 0.88, url: "https://philstar.com",          isLocal: true,  topics: ["national","politics","economy","sports","entertainment","social"] },
  { domain: "manilatimes.net",    name: "Manila Times",              credibility: 0.87, url: "https://manilatimes.net",       isLocal: true,  topics: ["national","politics","economy","business","social"] },
  { domain: "mb.com.ph",          name: "Manila Bulletin",           credibility: 0.86, url: "https://mb.com.ph",             isLocal: true,  topics: ["national","politics","economy","technology","sports"] },
  { domain: "cnnphilippines.com", name: "CNN Philippines",           credibility: 0.94, url: "https://cnnphilippines.com",    isLocal: true,  topics: ["national","politics","economy","health","social","environment"] },
  { domain: "bbc.com",            name: "BBC News",                  credibility: 0.98, url: "https://bbc.com/news",          isLocal: false, topics: ["world","politics","health","science","technology","environment","economy","sports"] },
  { domain: "reuters.com",        name: "Reuters",                   credibility: 0.97, url: "https://reuters.com",           isLocal: false, topics: ["economy","finance","world","politics","health","technology","science"] },
  { domain: "apnews.com",         name: "Associated Press",          credibility: 0.97, url: "https://apnews.com",            isLocal: false, topics: ["world","politics","health","sports","science","technology","crime"] },
  { domain: "cnn.com",            name: "CNN",                       credibility: 0.95, url: "https://cnn.com",               isLocal: false, topics: ["world","politics","health","technology","entertainment","business"] },
  { domain: "theguardian.com",    name: "The Guardian",              credibility: 0.94, url: "https://theguardian.com",       isLocal: false, topics: ["environment","science","health","politics","social","technology","world"] },
  { domain: "nytimes.com",        name: "New York Times",            credibility: 0.96, url: "https://nytimes.com",           isLocal: false, topics: ["world","politics","economy","health","science","technology","social"] },
  { domain: "washingtonpost.com", name: "Washington Post",           credibility: 0.95, url: "https://washingtonpost.com",    isLocal: false, topics: ["world","politics","economy","technology","social"] },
  { domain: "bloomberg.com",      name: "Bloomberg",                 credibility: 0.94, url: "https://bloomberg.com",         isLocal: false, topics: ["economy","finance","markets","business","technology"] },
  { domain: "aljazeera.com",      name: "Al Jazeera",                credibility: 0.93, url: "https://aljazeera.com",         isLocal: false, topics: ["world","politics","environment","social","health"] },
  { domain: "npr.org",            name: "NPR",                       credibility: 0.96, url: "https://npr.org",               isLocal: false, topics: ["science","health","technology","social","politics","environment"] },
  { domain: "cnbc.com",           name: "CNBC",                      credibility: 0.94, url: "https://cnbc.com",              isLocal: false, topics: ["economy","finance","markets","business","technology"] },
  { domain: "foxnews.com",        name: "Fox News",                  credibility: 0.85, url: "https://foxnews.com",           isLocal: false, topics: ["world","politics","sports","entertainment"] },
]

const TOPIC_KEYWORDS: Record<string, string[]> = {
  politics:      ["president","senator","congress","parliament","election","vote","politician","government","administration","policy","senate","official","minister","governor","mayor","legislative","cabinet","ruling"],
  health:        ["disease","health","hospital","doctor","medicine","vaccine","pandemic","covid","virus","treatment","patient","medical","surgery","clinic","symptoms","outbreak","healthcare","mortality","epidemic"],
  economy:       ["economy","market","stock","business","trade","investment","finance","money","gdp","inflation","unemployment","budget","debt","revenue","fiscal","monetary","recession","bank"],
  technology:    ["technology","tech","software","app","digital","internet","computer","artificial intelligence","ai","robot","startup","cybersecurity","hack","data","smartphone","cloud","algorithm","platform"],
  science:       ["scientist","discovery","experiment","space","nasa","species","fossil","gene","dna","particle","research","laboratory","asteroid","telescope","biology","chemistry","physics"],
  sports:        ["sport","game","team","player","match","championship","score","league","tournament","coach","athlete","basketball","football","boxing","tennis","olympics","fifa","nba"],
  entertainment: ["movie","film","actor","actress","music","singer","celebrity","concert","award","show","series","netflix","streaming","album","director","box office","grammy","oscar"],
  environment:   ["climate","pollution","flood","typhoon","earthquake","carbon","renewable","energy","deforestation","wildlife","ocean","emissions","drought","wildfire","biodiversity","glacier"],
  crime:         ["crime","arrest","police","drug","murder","robbery","kidnap","suspect","court","verdict","prison","investigation","illegal","trafficking","fraud","corruption","sentenced","convicted","charged"],
  social:        ["poverty","education","school","student","protest","rights","gender","equality","welfare","housing","migrant","discrimination","inequality","refugee","human rights"],
  world:         ["international","foreign","war","conflict","treaty","diplomacy","united nations","nato","sanctions","embassy","bilateral","geopolitics","military","troops","ceasefire","invasion"],
  national:      ["philippines","filipino","manila","luzon","visayas","mindanao","cebu","davao","quezon city","makati","ncrpo","doh","dpwh","deped","dilg","nbi","pnp","bsp","pcso"],
}

function detectTopicsFromContent(text: string): string[] {
  const lower = text.toLowerCase()
  const scores: Record<string, number> = {}
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    let score = 0
    for (const kw of keywords) {
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")
      const matches = lower.match(new RegExp(`\\b${escaped}\\b`, "g"))
      if (matches) score += matches.length
    }
    if (score >= 2) scores[topic] = score
  }
  if (Object.keys(scores).length === 0) return []
  const maxScore = Math.max(...Object.values(scores))
  return Object.entries(scores)
    .filter(([, s]) => s >= maxScore * 0.30)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([topic]) => topic)
}

function selectRelevantSources(excludeDomain: string | null, detectedTopics: string[], count: number, isPhilippinesContent: boolean): typeof ALL_SOURCES {
  if (detectedTopics.length === 0) return []
  const scored = ALL_SOURCES
    .filter((src) => {
      if (excludeDomain && src.domain.includes(excludeDomain)) return false
      if (src.isLocal && !isPhilippinesContent) return false
      return true
    })
    .map((src) => {
      const overlap = src.topics.filter((t) => detectedTopics.includes(t)).length
      return { src, overlap, score: overlap + src.credibility * 0.01 }
    })
    .filter((s) => s.overlap > 0)
    .sort((a, b) => b.score - a.score)
  if (scored.length === 0) return []
  return scored.slice(0, count).map((s) => s.src)
}

function analyzeSource(content: string, type: string, originalInput?: string) {
  const text = content.toLowerCase()
  const urlToParse = type === "url" && originalInput ? originalInput : content
  const detectedTopics = detectTopicsFromContent(text)
  const phKeywordMatches = TOPIC_KEYWORDS.national.filter((kw) => text.includes(kw)).length
  const isPhilippinesContent = detectedTopics.includes("national") && phKeywordMatches >= 2
  let detectedSource = "", credibility = 0.5, label = "Unable to verify source"
  let excludeDomain: string | null = null
  const detectedSources: Array<{ name: string; url: string }> = []

  if (type === "url") {
    try {
      const parsed = new URL(urlToParse)
      detectedSource = parsed.href
      const host = parsed.hostname.replace("www.", "")
      const match = ALL_SOURCES.find((src) => host.includes(src.domain))
      excludeDomain = host
      if (match) {
        credibility = match.credibility
        label = match.isLocal ? `Verified Philippine news: ${match.name}` : `Verified International source: ${match.name}`
        const suggestions = selectRelevantSources(host, detectedTopics, 3, isPhilippinesContent)
        detectedSources.push(...suggestions.map((s) => ({ name: s.name, url: s.url })))
      } else {
        credibility = 0.35
        label = `Unverified source: ${host}`
        const suggestions = selectRelevantSources(host, detectedTopics, 3, isPhilippinesContent)
        detectedSources.push(...suggestions.map((s) => ({ name: s.name, url: s.url })))
      }
    } catch { /* ignore */ }
  } else {
    const mentionedSource = ALL_SOURCES.find((src) => text.includes(src.domain.split(".")[0]) || text.includes(src.name.toLowerCase()))
    if (mentionedSource) {
      credibility = mentionedSource.credibility
      detectedSource = mentionedSource.url
      excludeDomain = mentionedSource.domain
      label = mentionedSource.isLocal ? `Verified Philippine news: ${mentionedSource.name}` : `Verified International source: ${mentionedSource.name}`
      const suggestions = selectRelevantSources(mentionedSource.domain, detectedTopics, 3, isPhilippinesContent)
      detectedSources.push(...suggestions.map((s) => ({ name: s.name, url: s.url })))
    } else {
      if (detectedTopics.length > 0) {
        label = `Suggested sources for: ${detectedTopics.slice(0, 2).join(", ")}`
        const suggestions = selectRelevantSources(null, detectedTopics, 3, isPhilippinesContent)
        detectedSources.push(...suggestions.map((s) => ({ name: s.name, url: s.url })))
      } else {
        label = "Unable to verify source"
      }
    }
  }
  return { credibility, label, source: detectedSource, detectedSources: detectedSources.slice(0, 3) }
}

async function generateFactChecksWithRealAPIs(content: string, claims: string[]) {
  const googleApiKey = process.env.GOOGLE_FACT_CHECK_API_KEY
  const newsApiKey   = process.env.NEWS_API_KEY
  const mainClaim    = claims[0] || content.substring(0, 150)
  const results: any[] = []

  const fcKey = makeQueryKey(mainClaim.substring(0, 100), "factcheck")
  const cachedFc = factCheckCache.get(fcKey)
  if (cachedFc) return cachedFc

  try {
    if (googleApiKey) {
      try {
        const url = `https://factchecktools.googleapis.com/v1alpha1/claims:search?query=${encodeURIComponent(mainClaim)}&key=${googleApiKey}`
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
        if (res.ok) {
          const data = await res.json()
          if (data.claims?.length) {
            results.push(...data.claims.slice(0, 3).map((c: any) => ({
              claim: c.text,
              conclusion: c.claimReview?.[0]?.textualRating || "Unverified",
              source: c.claimReview?.[0]?.url || "https://toolbox.google.com/factcheck",
              source_label: c.claimReview?.[0]?.publisher?.name || "Google Fact Check",
              reviewer: c.claimReview?.[0]?.publisher?.name || "Google Fact Check",
              relevance: computeRelevance(mainClaim, c.text),
            })))
          }
        }
      } catch (err) { console.error("[Google Fact Check] Error:", err) }
    }
    if (newsApiKey && results.length < 2) {
      try {
        const keywords = mainClaim.split(/\s+/).slice(0, 6).join(" ")
        const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(keywords)}&language=en&sortBy=relevancy&pageSize=5&apiKey=${newsApiKey}`
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
        if (res.ok) {
          const data = await res.json()
          if (data.articles?.length) {
            const relevant = data.articles
              .map((a: any) => ({
                claim: a.title,
                conclusion: a.description
                  ? `${a.source?.name || "News source"} reports: "${a.description.substring(0, 120)}"`
                  : `Covered by ${a.source?.name || "trusted news source"}`,
                source: a.url,
                source_label: a.source?.name || "News Source",
                reviewer: a.source?.name || "News Source",
                relevance: computeRelevance(mainClaim, a.title + " " + (a.description || "")),
              }))
              .filter((a: any) => a.relevance > 0.08)
              .sort((a: any, b: any) => b.relevance - a.relevance)
            results.push(...relevant.slice(0, 3))
          }
        }
      } catch (err) { console.error("[NewsAPI] Error:", err) }
    }
  } catch (err) { console.error("[API] Fact check general error:", err) }

  const sorted = results
    .filter(r => r.relevance > 0 || r.reviewer !== "Manual Verification Required")
    .sort((a, b) => b.relevance - a.relevance)
  factCheckCache.set(fcKey, sorted)
  return sorted
}

function computeRelevance(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter(w => w.length > 3))
  const wordsB = new Set(b.toLowerCase().split(/\W+/).filter(w => w.length > 3))
  if (wordsA.size === 0 || wordsB.size === 0) return 0
  const intersection = [...wordsA].filter((w) => wordsB.has(w))
  return intersection.length / Math.max(wordsA.size, wordsB.size)
}

function analyzeCredibilityPatterns(text: string): { score: number; hasIssues: boolean; issues: string[] } {
  const issues: string[] = []
  let score = 1.0
  const citationPatterns = [/according to\s+(?:sources|officials|experts)/i, /research\s+(?:shows|indicates|suggests)/i, /studies?\s+(?:found|show|indicate)/i, /experts?\s+(?:say|warn|suggest)/i, /\[\d+\]/]
  const citationCount = citationPatterns.filter((p) => p.test(text)).length
  if (citationCount >= 2) score += 0.15
  else if (citationCount === 0) { issues.push("No citations or evidence references"); score -= 0.15 }
  const passiveRatio = (text.match(/\b(?:was|were|been|is|are)\s+\w+ed\b/gi) || []).length / text.split(/\s+/).length
  if (passiveRatio > 0.15) { issues.push("Excessive passive voice (suspicious style)"); score -= 0.1 }
  const hedgingWords = ["may","might","could","possibly","allegedly","reportedly","suggest"]
  if (hedgingWords.filter((w) => text.toLowerCase().includes(w)).length >= 2) score += 0.1
  const vaguePatterns = [/(?:they|people|sources?|officials?)\s+(?:say|claim)\s+(?:that\s+)?(?:they|it)\s+(?:is|are)\s+(?:very|extremely|incredibly)\s+\w+/i, /unidentified\s+(?:sources?|officials?)/i, /some\s+(?:experts?|sources?)\s+believe/i]
  if (vaguePatterns.filter((p) => p.test(text)).length > 0) { issues.push("Vague or unverified claims"); score -= 0.12 }
  if ((text.match(/\b[A-Z\s]{8,}\b/g) || []).length > 2) { issues.push("Multiple ALL CAPS phrases"); score -= 0.1 }
  if ((text.match(/\.\.\./g) || []).length > 3) { issues.push("Excessive ellipsis (casual/unreliable style)"); score -= 0.08 }
  return { score: Math.max(0, Math.min(score, 1)), hasIssues: issues.length > 0, issues }
}

async function analyzeSourceCredibility(content: string, type: string, baseCredibility: number, verdict?: string) {
  const googleApiKey = process.env.GOOGLE_FACT_CHECK_API_KEY
  const newsApiKey   = process.env.NEWS_API_KEY
  const lower        = content.toLowerCase()
  const result: any  = { api_checks: [], credibility_score: baseCredibility, credibility_label: "Neutral", domain_authority: null, reason: [], bias_indicators: [] }

  if (type === "url") {
    try {
      const domain = new URL(content).hostname.replace("www.", "")
      const daScore = await fetch(`https://openpagerank.com/api/v1.0/getPageRank?domains[]=${domain}`, { headers: { "API-OPR": process.env.OPEN_PAGE_RANK_API_KEY || "" } }).then((r) => r.json()).catch(() => null)
      if (daScore?.response?.[0]?.page_rank_integer) {
        result.domain_authority = daScore.response[0].page_rank_integer / 10
        result.credibility_score = (result.credibility_score + result.domain_authority) / 2
        result.reason.push("Domain authority successfully retrieved.")
      } else { result.reason.push("Domain authority unavailable.") }
    } catch { result.reason.push("URL parsing failed.") }
  }

  if (googleApiKey) {
    try {
      const res = await fetch(`https://factchecktools.googleapis.com/v1alpha1/claims:search?query=${encodeURIComponent(content.substring(0, 120))}&key=${googleApiKey}`)
      const data = await res.json()
      if (data.claims?.length) {
        result.api_checks.push({ api: "Google Fact Check", status: "Found", rating: data.claims[0].claimReview?.[0]?.textualRating || "Unverified" })
        const rating = result.api_checks[0].rating.toLowerCase()
        if (rating.includes("true") || rating.includes("accurate")) { result.credibility_score += 0.25; result.reason.push("Google Fact Check marked content as accurate.") }
        else if (rating.includes("false") || rating.includes("incorrect")) { result.credibility_score -= 0.25; result.reason.push("Google Fact Check flagged content as false.") }
      } else { result.api_checks.push({ api: "Google Fact Check", status: "No match" }) }
    } catch { result.api_checks.push({ api: "Google Fact Check", status: "Failed" }) }
  }

  if (newsApiKey) {
    try {
      const res = await fetch(`https://newsapi.org/v2/top-headlines?language=en&apiKey=${newsApiKey}`)
      const data = await res.json()
      if (data.sources) {
        const trusted = data.sources.map((s: any) => s.name.toLowerCase())
        if (trusted.some((src: string) => lower.includes(src))) { result.credibility_score += 0.1; result.reason.push("Trusted news outlet mentioned in text.") }
      }
    } catch { /* skip */ }
  }

  const final = result.credibility_score
  result.credibility_label = final > 0.8 ? "Highly credible" : final > 0.6 ? "Credible" : final > 0.4 ? "Uncertain" : "Low credibility"

  try {
    const knownRight  = ["foxnews.com","breitbart.com","dailycaller.com"]
    const knownLeft   = ["cnn.com","msnbc.com","huffpost.com"]
    const knownCenter = ["reuters.com","apnews.com","bbc.com","nytimes.com"]
    if (result.domain_authority && typeof result.domain_authority === "number" && result.domain_authority > 0) {
      const domain = type === "url" ? (() => { try { return new URL(content).hostname.replace("www.", "") } catch { return "" } })() : ""
      if (domain) {
        if (knownRight.some((d) => domain.includes(d))) { result.bias_rating = "Right-leaning"; result.bias_indicators = ["Known right-leaning editorial stance"] }
        else if (knownLeft.some((d) => domain.includes(d))) { result.bias_rating = "Left-leaning"; result.bias_indicators = ["Known left-leaning editorial stance"] }
        else if (knownCenter.some((d) => domain.includes(d))) { result.bias_rating = "Neutral"; result.bias_indicators = ["Reputable news organization with neutral reporting standards"] }
        else { result.bias_rating = "Unable to determine"; result.bias_indicators = ["Unknown source credibility"] }
      } else { result.bias_rating = "Unable to determine"; result.bias_indicators = ["Source domain not provided"] }
    } else { result.bias_rating = "Unable to determine"; result.bias_indicators = ["Insufficient source information available"] }
  } catch { result.bias_rating = "Unable to determine"; result.bias_indicators = ["Error during bias assessment"] }

  if (verdict === "FAKE") { result.credibility_score = Math.min(0.3, result.credibility_score); result.credibility_label = "Low credibility" }
  else if (verdict === "REAL") { result.credibility_score = Math.max(0.7, result.credibility_score); result.credibility_label = "High credibility" }
  return result
}

async function analyzeContentQuality(content: string, verdict?: string, confidence?: number) {
  const ltKey    = process.env.LT_API_KEY
  const result: any = {
    readability_score: null, grammar_issues: [], coherence_score: null,
    structure: { paragraphs: content.split(/\n\s*\n/).length, avg_sentence_length: 0 }, quality_label: "Neutral",
  }
  const sentences = content.split(/[.!?]+/).filter((s) => s.trim().length)
  const words     = content.split(/\s+/).length
  result.structure.avg_sentence_length = Math.round(words / Math.max(sentences.length, 1))
  result.readability_score = Math.max(0, Math.min(1, 1 - result.structure.avg_sentence_length / 40))
  if (ltKey) {
    try {
      const res = await fetch("https://api.languagetoolplus.com/v2/check", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ text: content, language: "en-US", apiKey: ltKey }) })
      const data = await res.json()
      result.grammar_issues = data.matches?.slice(0, 5) || []
    } catch {}
  }
  const numbersCount      = (content.match(/\b\d{1,4}\b/g) || []).length
  const dateMatches       = (content.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\b|\b\d{4}\b/g) || []).length
  const namedSourcesCount = [/according to/i, /reported by/i, /said/i, /source:/i, /\bvia\b/i].reduce((acc, p) => acc + (p.test(content) ? 1 : 0), 0)
  const namedEntitiesCount = (content.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b/g) || []).length
  const specificityScore  = Math.max(0, Math.min(1, Math.min(10, numbersCount) * 0.04 + Math.min(3, dateMatches) * 0.12 + Math.min(3, namedSourcesCount) * 0.25 + Math.min(6, namedEntitiesCount) * 0.02))
  let specificity_label = "Unspecific"
  if (specificityScore > 0.75) specificity_label = "Highly specific"
  else if (specificityScore > 0.5) specificity_label = "Somewhat specific"
  else if (specificityScore > 0.3) specificity_label = "Slightly specific"
  const citationCount  = [/according to\s+(?:sources|officials|experts)/i, /research\s+(?:shows|indicates|suggests)/i, /studies?\s+(?:found|show|indicate)/i, /experts?\s+(?:say|warn|suggest)/i, /\[\d+\]/].reduce((acc, p) => acc + (p.test(content) ? 1 : 0), 0)
  const grammarPenalty = Math.min(1, result.grammar_issues.length / 6)
  const evidenceScore  = Math.max(0, Math.min(1, Math.min(3, citationCount) * 0.28 + (1 - grammarPenalty) * 0.32 + (result.coherence_score || 0.5) * 0.4))
  let evidence_strength_label = "Poor"
  if (evidenceScore > 0.75) evidence_strength_label = "Strong"
  else if (evidenceScore > 0.5) evidence_strength_label = "Moderate"
  else if (evidenceScore > 0.35) evidence_strength_label = "Weak"
  if (verdict === "FAKE") { result.overall_score = Math.min(0.4, evidenceScore); evidence_strength_label = "Weak" }
  else if (verdict === "REAL") { result.overall_score = Math.max(0.7, evidenceScore); evidence_strength_label = "Strong" }
  else if (verdict === "UNVERIFIED") { result.overall_score = Math.max(0.4, Math.min(0.6, evidenceScore)); evidence_strength_label = evidence_strength_label === "Poor" ? "Weak" : evidence_strength_label }
  else { result.overall_score = evidenceScore }
  result.specificity_label       = specificity_label
  result.specificity_score       = specificityScore
  result.evidence_strength_label = evidence_strength_label
  result.evidence_strength_score = evidenceScore
  result.quality_label = result.overall_score > 0.75 ? "High Quality" : result.overall_score > 0.55 ? "Good" : result.overall_score > 0.4 ? "Low Quality" : "Poor"
  return result
}

function buildSearchQuery(content: string, claims: string[]): string {
  const stopwords = new Set(["the","a","an","and","or","but","is","are","was","were","to","of","in","at","on","by","for","with","this","that","it","its","as","be","been","has","had","have","will","said","also","from","more","than","about","after","before","over","under","they","their","there","been","would","could","should","very","just","that","which","when","what","where","who"])
  const base = claims[0] || content.substring(0, 200)
  const tokens = base.replace(/[^a-zA-Z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !stopwords.has(w.toLowerCase())).slice(0, 5)
  return tokens.join(" ").trim() || content.substring(0, 60).replace(/[^a-zA-Z0-9\s]/g, " ").trim()
}

async function buildAISearchQuery(content: string, openaiApiKey?: string, groqApiKey?: string): Promise<string | null> {
  const systemMsg = "You generate short, specific news search queries. Respond with ONLY the query — no quotes, no punctuation, no explanation. Max 6 words."
  const userMsg   = `Generate a search query for finding related news articles about this:\n\n${content.substring(0, 800)}`
  const tryQuery  = async (baseUrl: string, key: string, model: string) => {
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model, max_tokens: 20, temperature: 0, messages: [{ role: "system", content: systemMsg }, { role: "user", content: userMsg }] }), signal: AbortSignal.timeout(6000) })
      if (!res.ok) return null
      const data = await res.json()
      const q = data.choices?.[0]?.message?.content?.trim()
      return q && q.length > 3 && q.length < 80 && !q.includes("{") ? q : null
    } catch { return null }
  }
  if (groqApiKey) { const q = await tryQuery("https://api.groq.com/openai/v1", groqApiKey, "llama-3.3-70b-versatile"); if (q) return q }
  if (openaiApiKey) { const q = await tryQuery("https://api.openai.com/v1", openaiApiKey, "gpt-4o-mini"); if (q) return q }
  return null
}