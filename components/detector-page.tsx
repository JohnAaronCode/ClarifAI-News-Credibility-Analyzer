"use client"

import { useState, useEffect, useRef } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card } from "@/components/ui/card"
import Navbar from "@/components/navbar"
import DetectorForm from "@/components/detector-form"
import ResultsDisplay from "@/components/results-display"
import Footer from "@/components/footer"
import {
  ShieldCheck, ShieldAlert, ShieldQuestion, Trash2, CheckSquare, Square,
  BarChart2, Clock, FileText, Link2, ChevronRight, X, Search,
  Filter, AlertTriangle, CheckCircle2, Info, Users, TrendingUp,
  Activity, ScanSearch, History, RefreshCw, ExternalLink,
} from "lucide-react"

interface AnalysisResult {
  verdict: "REAL" | "FAKE" | "UNVERIFIED" | "ERROR"
  confidence_score: number
  explanation: string
  key_entities?: any
  sentiment_score?: number
  source_credibility?: number
  fact_check_results?: any
}

interface HistoryItem {
  id: string
  input_type: "text" | "url"
  content_preview: string
  full_content: string          // full original input for re-analysis & "view"
  article_title?: string
  article_domain?: string
  verdict: "REAL" | "FAKE" | "UNVERIFIED"
  confidence_score: number
  explanation: string
  key_entities?: any
  sentiment_score?: number
  source_credibility?: number
  fact_check_results?: any
  created_at: string
}

interface VisitorData {
  total_visitors: number
  total_analyses: number
  today: number
  today_date: string
}

const VERDICT_DISPLAY = {
  REAL:       { label: "Credible",     bg: "bg-emerald-100 dark:bg-emerald-900/40", text: "text-emerald-700 dark:text-emerald-400", border: "border-emerald-200 dark:border-emerald-700", icon: ShieldCheck,    dot: "bg-emerald-500" },
  FAKE:       { label: "Likely False", bg: "bg-rose-100 dark:bg-rose-900/40",       text: "text-rose-700 dark:text-rose-400",       border: "border-rose-200 dark:border-rose-700",       icon: ShieldAlert,    dot: "bg-rose-500"    },
  UNVERIFIED: { label: "Unverified",   bg: "bg-amber-100 dark:bg-amber-900/40",     text: "text-amber-700 dark:text-amber-400",     border: "border-amber-200 dark:border-amber-700",     icon: ShieldQuestion, dot: "bg-amber-500"   },
}

// ── Decode HTML entities (handles WordPress numeric entities like &#8217;) ──
function decodeEntities(text: string): string {
  if (!text) return ""
  return text
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
}

// Use the FULL content (not truncated) as the dedup key
function makeContentKey(content: string): string {
  if (!content) return ""
  return content.trim().toLowerCase().replace(/\s+/g, " ")
}

// Detect if URL is a social media post
function detectSocialMedia(url: string): { isSocial: boolean; platform: string; label: string } {
  const u = url.toLowerCase()
  if (u.includes("facebook.com") || u.includes("fb.com") || u.includes("fb.watch")) return { isSocial: true, platform: "facebook", label: "Facebook" }
  if (u.includes("twitter.com") || u.includes("x.com")) return { isSocial: true, platform: "twitter", label: "X / Twitter" }
  if (u.includes("instagram.com")) return { isSocial: true, platform: "instagram", label: "Instagram" }
  if (u.includes("tiktok.com")) return { isSocial: true, platform: "tiktok", label: "TikTok" }
  if (u.includes("youtube.com") || u.includes("youtu.be")) return { isSocial: true, platform: "youtube", label: "YouTube" }
  if (u.includes("reddit.com")) return { isSocial: true, platform: "reddit", label: "Reddit" }
  return { isSocial: false, platform: "", label: "" }
}

// Extract article title and domain from URL or text content
function extractArticleMeta(content: string, inputType: "text" | "url"): { title?: string; domain?: string; isSocial?: boolean; platform?: string } {
  if (inputType === "url") {
    try {
      const url = new URL(content)
      const domain = url.hostname.replace("www.", "")
      const social = detectSocialMedia(content)
      if (social.isSocial) {
        return { title: `${social.label} post`, domain, isSocial: true, platform: social.platform }
      }
      // Extract title-like text from path
      const pathParts = url.pathname.split("/").filter(Boolean)
      const lastPart = pathParts[pathParts.length - 1] || ""
      const title = lastPart
        .replace(/[-_]/g, " ")
        .replace(/\.\w+$/, "")
        .replace(/\b\w/g, c => c.toUpperCase())
        .trim()
      return { title: title || domain, domain }
    } catch {
      return {}
    }
  }
  // For text, take first meaningful sentence as title
  const firstLine = content.trim().split(/[.\n]/)[0]?.trim()
  return { title: firstLine?.substring(0, 80) }
}

// ── Live visitor counter with polling ────────────────────────────────────
function useVisitorCount() {
  const [data, setData] = useState<VisitorData | null>(null)
  const [loading, setLoading] = useState(true)
  const hasCounted = useRef(false)

  const fetchData = async (method?: "POST") => {
    try {
      const res = method === "POST"
        ? await fetch("/api/visitors", { method: "POST" })
        : await fetch("/api/visitors")
      if (res.ok) setData(await res.json())
    } catch {}
  }

  useEffect(() => {
    const run = async () => {
      if (!hasCounted.current) {
        hasCounted.current = true
        const alreadyCounted = sessionStorage.getItem("clarifai_counted")
        await fetchData(alreadyCounted ? undefined : "POST")
        if (!alreadyCounted) sessionStorage.setItem("clarifai_counted", "1")
      }
      setLoading(false)
    }
    run()

    // Poll every 30 seconds for live updates
    const interval = setInterval(() => fetchData(), 30000)
    return () => clearInterval(interval)
  }, [])

  return { data, loading }
}

function AnimatedCounter({ value, loading }: { value: number | undefined; loading: boolean }) {
  const [displayed, setDisplayed] = useState(0)
  const frameRef = useRef<number>(0)

  useEffect(() => {
    if (loading || value === undefined) return
    const start = displayed
    const end = value
    const duration = 1200
    const startTime = performance.now()
    const animate = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplayed(Math.round(start + (end - start) * eased))
      if (progress < 1) frameRef.current = requestAnimationFrame(animate)
    }
    frameRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frameRef.current)
  }, [value, loading])

  if (loading) return <span className="inline-block w-8 h-5 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
  return <span>{displayed.toLocaleString()}</span>
}

const STAT_CONFIG = [
  { key: "total_visitors" as keyof VisitorData, label: "Total Visitors", icon: Users, color: "text-teal-600 dark:text-teal-400", iconBg: "bg-teal-50 dark:bg-teal-900/30", border: "border-teal-100 dark:border-teal-900/40" },
  { key: "today" as keyof VisitorData, label: "Today's Visitors", icon: TrendingUp, color: "text-sky-600 dark:text-sky-400", iconBg: "bg-sky-50 dark:bg-sky-900/30", border: "border-sky-100 dark:border-sky-900/40" },
  { key: "total_analyses" as keyof VisitorData, label: "Analyses Done", icon: Activity, color: "text-violet-600 dark:text-violet-400", iconBg: "bg-violet-50 dark:bg-violet-900/30", border: "border-violet-100 dark:border-violet-900/40" },
]

export default function DetectorPage() {
  const [activeTab, setActiveTab] = useState("detector")
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [inputContent, setInputContent] = useState("")
  const [previousResult, setPreviousResult] = useState<HistoryItem | null>(null)
  const { data: visitorData, loading: visitorLoading } = useVisitorCount()

  useEffect(() => {
    document.title = "ClarifAI — News Credibility Analyzer"
  }, [])

const handleAnalyze = async (content: string, type: "text" | "url") => {
    setLoading(true)
    setInputContent(content)
    setPreviousResult(null)

    // Check history for previous analysis
    try {
      const history: HistoryItem[] = JSON.parse(localStorage.getItem("analysisHistory") || "[]")
      const contentKey = makeContentKey(content)
      const existing = history.find(item => makeContentKey(item.full_content) === contentKey)
      if (existing) setPreviousResult(existing)
    } catch {}

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, type }),
      })
      const data = await response.json()
      console.log("API response:", data)
      setResult(data)
      if (data.verdict !== "ERROR") {
        try { await fetch("/api/visitors", { method: "PATCH" }) } catch {}
        try {
          const history: HistoryItem[] = JSON.parse(localStorage.getItem("analysisHistory") || "[]")
          const contentKey = makeContentKey(content)
          const deduplicated = history.filter(item => makeContentKey(item.full_content) !== contentKey)
          const meta = extractArticleMeta(content, type)
          // Decode entities from API title to prevent &#8217; etc. from being saved to localStorage
          const rawApiTitle = data.article_title
            || (data.search_query
              ? data.search_query.replace(/\b\w/g, (c: string) => c.toUpperCase()).trim()
              : undefined)
          const apiTitle = rawApiTitle ? decodeEntities(rawApiTitle) : undefined
          const newEntry: HistoryItem = {
            id: Date.now().toString(),
            input_type: type,
            content_preview: content.substring(0, 200),
            full_content: content,
            article_title: apiTitle || meta.title,
            article_domain: meta.domain,
            verdict: data.verdict,
            confidence_score: data.confidence_score,
            explanation: data.explanation,
            key_entities: data.key_entities,
            sentiment_score: data.sentiment_score,
            source_credibility: data.source_credibility,
            fact_check_results: data.fact_check_results,
            created_at: new Date().toISOString(),
          }
          deduplicated.unshift(newEntry)
          localStorage.setItem("analysisHistory", JSON.stringify(deduplicated.slice(0, 50)))
        } catch (historyError) {
          console.error("History save error:", historyError)
        }
      }
    } catch {
      setResult({ verdict: "ERROR", confidence_score: 0, explanation: "Error during analysis. Please try again." })
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,300&family=DM+Serif+Display:ital@0;1&display=swap');
        .clarifai-root { font-family: 'DM Sans', sans-serif; }
        .hero-wordmark { font-family: 'DM Serif Display', serif; font-style: normal; letter-spacing: -0.02em; }
        .hero-gradient-dark { background: linear-gradient(135deg, #e2e8f0 0%, #94d4c8 40%, #e2e8f0 80%); background-size: 300% auto; -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; animation: gradient-sweep 8s ease-in-out infinite alternate; }
        .hero-gradient-light { background: linear-gradient(135deg, #0f172a 0%, #0d7a68 40%, #0f172a 80%); background-size: 300% auto; -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; animation: gradient-sweep 8s ease-in-out infinite alternate; }
        @keyframes gradient-sweep { 0% { background-position: 0% 50% } 100% { background-position: 100% 50% } }
        .stat-card { position: relative; overflow: hidden; transition: transform 0.2s ease, box-shadow 0.2s ease; }
        .stat-card:hover { transform: translateY(-3px); }
        .live-dot { width: 6px; height: 6px; border-radius: 50%; background: #14b8a6; display: inline-block; animation: live-pulse 2.5s ease-in-out infinite; }
        @keyframes live-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.7); } }
        .tab-pill { transition: all 0.2s ease; }
        .history-item { transition: all 0.2s cubic-bezier(0.4,0,0.2,1); }
        .history-item:hover { transform: translateY(-1px); }
        .fade-in { animation: fade-up 0.4s ease both; }
        @keyframes fade-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      <div className="clarifai-root min-h-screen bg-slate-50 dark:bg-[#0e0e0f] flex flex-col">
        <Navbar />
        <main className="max-w-3xl mx-auto px-4 py-10 flex-1 w-full">

          {/* Hero */}
          <div className="text-center mb-10 fade-in">
            <h1 className="hero-wordmark block mb-3" style={{ fontSize: "clamp(42px, 8vw, 72px)", lineHeight: 1.05 }}>
              <span className="dark:hidden hero-gradient-light">ClarifAI</span>
              <span className="hidden dark:inline hero-gradient-dark">ClarifAI</span>
            </h1>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 tracking-widest uppercase mb-2">News Credibility Analyzer</p>
            <p className="text-sm text-slate-400 dark:text-slate-500 max-w-sm mx-auto leading-relaxed">Don't guess the news — ClarifAI it.</p>

            {/* Stats row with live indicator */}
            <div className="flex justify-center gap-3 flex-wrap mt-8">
              {STAT_CONFIG.map(cfg => {
                const Icon = cfg.icon
                return (
                  <div key={cfg.key} className={`stat-card flex items-center gap-3 px-5 py-3.5 rounded-2xl bg-white dark:bg-[#17171a] border ${cfg.border} shadow-sm`}>
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${cfg.iconBg}`}>
                      <Icon className={`w-4 h-4 ${cfg.color}`} />
                    </div>
                    <div className="text-left">
                      <div className={`text-xl font-semibold leading-tight ${cfg.color}`}>
                        <AnimatedCounter value={visitorData?.[cfg.key] as number | undefined} loading={visitorLoading} />
                      </div>
                      <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 whitespace-nowrap flex items-center gap-1.5">
                        {cfg.key === "today" && <span className="live-dot" />}
                        {cfg.label}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Main Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full fade-in" style={{ animationDelay: "0.1s" }}>
            <TabsList className="grid w-full grid-cols-2 mb-6 bg-white dark:bg-[#17171a] border border-slate-200 dark:border-white/6 p-1 rounded-2xl h-auto shadow-sm">
              <TabsTrigger value="detector" className="tab-pill flex items-center justify-center gap-2 data-[state=active]:bg-slate-900 dark:data-[state=active]:bg-white data-[state=active]:text-white dark:data-[state=active]:text-slate-900 data-[state=active]:shadow-sm text-slate-500 dark:text-slate-400 font-medium py-2.5 text-sm rounded-xl">
                <ScanSearch className="w-4 h-4" />Analyze
              </TabsTrigger>
              <TabsTrigger value="history" className="tab-pill flex items-center justify-center gap-2 data-[state=active]:bg-slate-900 dark:data-[state=active]:bg-white data-[state=active]:text-white dark:data-[state=active]:text-slate-900 data-[state=active]:shadow-sm text-slate-500 dark:text-slate-400 font-medium py-2.5 text-sm rounded-xl">
                <History className="w-4 h-4" />History
              </TabsTrigger>
            </TabsList>

            <TabsContent value="detector" className="space-y-6">
              <Card className="p-6 bg-white dark:bg-[#17171a] border-slate-200 dark:border-white/6 shadow-sm rounded-2xl">
                <DetectorForm onAnalyze={handleAnalyze} onClearResult={() => setResult(null)} loading={loading} />
              </Card>
{previousResult && result && (
                <div className="fade-in mb-4">
                  <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/50 text-xs text-amber-700 dark:text-amber-400">
                    <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>
                      You've analyzed this before on{" "}
                      <strong>{new Date(previousResult.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</strong>
                      {" "}— previous verdict:{" "}
                      <strong>{VERDICT_DISPLAY[previousResult.verdict]?.label ?? previousResult.verdict}</strong>.
                      {" "}Showing fresh analysis below.
                    </span>
                  </div>
                </div>
              )}
              {result && (
                <div className="fade-in">
                  <ResultsDisplay result={result} inputContent={inputContent} />
                </div>
              )}
            </TabsContent>

            <TabsContent value="history">
              <HistoryTab onReanalyze={handleAnalyze} onSwitchToDetector={() => setActiveTab("detector")} />
            </TabsContent>
          </Tabs>
        </main>
        <Footer />
      </div>
    </>
  )
}

// ── History Tab ───────────────────────────────────────────────────────────
function HistoryTab({ onReanalyze, onSwitchToDetector }: {
  onReanalyze: (content: string, type: "text" | "url") => void
  onSwitchToDetector: () => void
}) {
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [filtered, setFiltered] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [activeFilter, setActiveFilter] = useState<"ALL" | "REAL" | "FAKE" | "UNVERIFIED">("ALL")
  const [searchQuery, setSearchQuery] = useState("")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [reanalyzingId, setReanalyzingId] = useState<string | null>(null)

  const stats = {
    total: history.length,
    real: history.filter(d => d.verdict === "REAL").length,
    fake: history.filter(d => d.verdict === "FAKE").length,
    unverified: history.filter(d => d.verdict === "UNVERIFIED").length,
  }

  useEffect(() => {
    const saved: HistoryItem[] = JSON.parse(localStorage.getItem("analysisHistory") || "[]")
    const valid = saved.filter(i => i.verdict === "REAL" || i.verdict === "FAKE" || i.verdict === "UNVERIFIED")
    setHistory(valid); setFiltered(valid); setLoading(false)
  }, [])

  useEffect(() => {
    let result = [...history]
    if (activeFilter !== "ALL") result = result.filter(i => i.verdict === activeFilter)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(i =>
        i.content_preview.toLowerCase().includes(q) ||
        (i.full_content || "").toLowerCase().includes(q) ||
        i.explanation.toLowerCase().includes(q) ||
        (i.article_title || "").toLowerCase().includes(q) ||
        (i.article_domain || "").toLowerCase().includes(q)
      )
    }
    setFiltered(result)
  }, [history, activeFilter, searchQuery])

  const toggleSelect = (id: string) => {
    setSelectedItems(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }
  const toggleSelectAll = () => {
    if (selectedItems.size === filtered.length) setSelectedItems(new Set())
    else setSelectedItems(new Set(filtered.map(i => i.id)))
  }
  const deleteSelected = () => {
    if (selectedItems.size === 0) return
    const updated = history.filter(i => !selectedItems.has(i.id))
    localStorage.setItem("analysisHistory", JSON.stringify(updated))
    setHistory(updated); setSelectedItems(new Set())
  }
  const deleteItem = (id: string) => {
    const updated = history.filter(i => i.id !== id)
    localStorage.setItem("analysisHistory", JSON.stringify(updated))
    setHistory(updated)
  }

  const handleReanalyze = async (item: HistoryItem) => {
    setReanalyzingId(item.id)
    onSwitchToDetector()
    await onReanalyze(item.full_content || item.content_preview, item.input_type)
    setReanalyzingId(null)
  }

  // Show text content in a modal/expandable view
  const [viewingContent, setViewingContent] = useState<string | null>(null)

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="text-center space-y-3">
        <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm text-slate-400 dark:text-slate-500">Loading history...</p>
      </div>
    </div>
  )

  if (history.length === 0) return (
    <Card className="p-16 text-center bg-white dark:bg-[#17171a] border-slate-200 dark:border-white/6 rounded-2xl shadow-sm">
      <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-4">
        <BarChart2 className="w-7 h-7 text-slate-300 dark:text-slate-600" />
      </div>
      <p className="text-base font-semibold text-slate-700 dark:text-slate-300 mb-1">No assessments yet</p>
      <p className="text-sm text-slate-400 dark:text-slate-500">Start by analyzing some content to see your history here.</p>
    </Card>
  )

  const allSelected = filtered.length > 0 && selectedItems.size === filtered.length

  return (
    <div className="space-y-4 fade-in">
      {/* Content Viewer Modal */}
      {viewingContent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          onClick={() => setViewingContent(null)}
        >
          <div
            className="bg-white dark:bg-[#17171a] rounded-2xl border border-slate-200 dark:border-white/8 shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-white/6">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                <FileText className="w-4 h-4 text-teal-500" />
                Analyzed Content
              </p>
              <button
                onClick={() => setViewingContent(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">{viewingContent}</p>
            </div>
            <div className="p-3 border-t border-slate-100 dark:border-white/6 flex justify-end">
              <button
                onClick={() => setViewingContent(null)}
                className="px-4 py-2 rounded-lg text-xs font-medium bg-slate-100 dark:bg-[#222] text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-[#2a2a2a] transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      <Card className="p-4 space-y-3 bg-white dark:bg-[#17171a] border-slate-200 dark:border-white/6 shadow-sm rounded-2xl">
        {/* Search */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
          <input
            type="text"
            placeholder="Search assessments..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-9 py-2 text-sm rounded-xl border border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-[#111] text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500/50 transition"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter pills */}
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
          {(["ALL", "REAL", "FAKE", "UNVERIFIED"] as const).map(f => {
            const countKey = f.toLowerCase() as "real" | "fake" | "unverified"
            const count = f === "ALL" ? stats.total : (stats[countKey] ?? 0)
            const isActive = activeFilter === f
            const cfg = f !== "ALL" ? VERDICT_DISPLAY[f] : null
            return (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                  isActive
                    ? cfg ? `${cfg.bg} ${cfg.text} ${cfg.border}` : "bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-900 dark:border-white"
                    : "bg-slate-100 dark:bg-[#222] text-slate-500 dark:text-slate-400 border-slate-200 dark:border-white/8 hover:border-slate-300 dark:hover:border-white/20"
                }`}
              >
                {cfg && isActive && <cfg.icon className="w-3 h-3" />}
                {f === "ALL" ? "All" : VERDICT_DISPLAY[f].label}
                <span className={`px-1.5 py-0.5 rounded-full text-xs ${isActive ? "bg-black/10 dark:bg-white/20" : "bg-slate-200 dark:bg-[#333]"}`}>{count}</span>
              </button>
            )
          })}
        </div>

        {/* Bulk actions */}
        <div className="flex items-center justify-between gap-3 pt-1 border-t border-slate-100 dark:border-white/[4">
          <button onClick={toggleSelectAll} className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition">
            {allSelected ? <CheckSquare className="w-3.5 h-3.5 text-teal-500" /> : <Square className="w-3.5 h-3.5" />}
            {allSelected ? "Deselect all" : "Select all"}
          </button>
          <div className="flex items-center gap-2">
            {selectedItems.size > 0 && <span className="text-xs text-slate-400 dark:text-slate-500">{selectedItems.size} selected</span>}
            <button
              onClick={deleteSelected}
              disabled={selectedItems.size === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900/40 hover:bg-rose-100 dark:hover:bg-rose-950/50 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              <Trash2 className="w-3 h-3" />Delete selected
            </button>
          </div>
        </div>
      </Card>

      {filtered.length !== history.length && (
        <p className="text-xs text-slate-400 dark:text-slate-500 px-1">Showing {filtered.length} of {history.length} assessments</p>
      )}

      {filtered.length === 0 ? (
        <Card className="p-10 text-center bg-white dark:bg-[#17171a] border-slate-200 dark:border-white/6 rounded-2xl">
          <Search className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-600 dark:text-slate-400">No matching assessments</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Try adjusting your search or filter.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map(item => {
            const cfg = VERDICT_DISPLAY[item.verdict as keyof typeof VERDICT_DISPLAY] ?? VERDICT_DISPLAY["UNVERIFIED"]
            const VIcon = cfg.icon
            const isSelected = selectedItems.has(item.id)
            const isExpanded = expandedId === item.id
            const date = new Date(item.created_at)
            const isUrl = item.input_type === "url"
            // Decode entities at display time — fixes existing corrupted localStorage entries
            const displayTitle = decodeEntities(item.article_title || item.content_preview.substring(0, 60))
            const displayDomain = item.article_domain

            // Extract explanation bullets
            const bullets = buildExplanationBullets(item.explanation, item.source_credibility, item.sentiment_score)

            return (
              <Card
                key={item.id}
                className={`history-item overflow-hidden bg-white dark:bg-[#17171a] shadow-sm rounded-xl ${
                  isSelected ? "border-teal-400 dark:border-teal-600/50" : "border-slate-200 dark:border-white/6 hover:border-slate-300 dark:hover:border-white/12"
                }`}
              >
                <div className="p-4 flex items-start gap-3">
                  <button onClick={() => toggleSelect(item.id)} className="mt-0.5 shrink-0 text-slate-300 dark:text-slate-600 hover:text-teal-500 transition">
                    {isSelected ? <CheckSquare className="w-4 h-4 text-teal-500" /> : <Square className="w-4 h-4" />}
                  </button>

                  <div className="flex-1 min-w-0">
                    {/* Title and domain */}
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 line-clamp-2 mb-1 leading-snug">{displayTitle}</p>
                    {displayDomain && (
                      <p className="text-xs text-slate-400 dark:text-slate-500 mb-1.5 truncate">{displayDomain}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400 dark:text-slate-500">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full font-medium uppercase tracking-wide ${isUrl ? "bg-violet-50 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400" : "bg-sky-50 dark:bg-sky-950/30 text-sky-600 dark:text-sky-400"}`}>
                        {isUrl ? <Link2 className="w-2.5 h-2.5" /> : <FileText className="w-2.5 h-2.5" />}
                        {item.input_type}
                      </span>
                    </div>
                  </div>

                  {/* Verdict + confidence inline */}
                  <div className="flex flex-col items-end gap-1.5 ml-2 shrink-0">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
                      <VIcon className="w-3 h-3" />{cfg.label} · {item.confidence_score}%
                    </span>
                  </div>
                </div>

                {/* Confidence bar */}
                <div className="h-0.5 w-full bg-slate-100 dark:bg-[#222]">
                  <div
                    className={`h-full transition-all duration-700 ${item.verdict === "REAL" ? "bg-emerald-400" : item.verdict === "FAKE" ? "bg-rose-400" : "bg-amber-400"}`}
                    style={{ width: `${item.confidence_score}%` }}
                  />
                </div>

                {/* Expand toggle */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                  className="w-full flex items-center justify-center gap-1 py-1.5 text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#1f1f22] transition border-t border-slate-100 dark:border-white/4"
                >
                  {isExpanded ? "Hide details" : "Show details"}
                  <ChevronRight className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 pt-3 border-t border-slate-100 dark:border-white/4 bg-slate-50/50 dark:bg-transparent space-y-3">
                    {/* Assessment Summary as bullets */}
                    <div>
                      <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">Reasons:</p>
                      <ul className="space-y-1">
                        {bullets.map((b, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-400">
                            <span className="mt-1 shrink-0">•</span>
                            <span>{b}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Source credibility & sentiment with progress bars */}
                    <div className="grid grid-cols-2 gap-3">
                      {item.source_credibility !== undefined && (
                        <MiniProgressCard
                          label="Source Credibility"
                          value={item.source_credibility}
                          verdict={item.verdict}
                        />
                      )}
                      {item.sentiment_score !== undefined && (
                        <MiniProgressCard
                          label="Emotional Tone"
                          value={Math.round(item.sentiment_score * 100)}
                          verdict={item.verdict}
                          invert
                        />
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2 pt-1 flex-wrap">
                      <button
                        onClick={() => handleReanalyze(item)}
                        disabled={reanalyzingId === item.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-teal-50 dark:bg-teal-950/30 text-teal-600 dark:text-teal-400 border border-teal-200 dark:border-teal-800/50 hover:bg-teal-100 dark:hover:bg-teal-900/30 transition disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3 h-3 ${reanalyzingId === item.id ? "animate-spin" : ""}`} />
                        Re-analyze
                      </button>
                      {isUrl ? (
                        <a
                          href={item.full_content || item.content_preview}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/50 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Open URL
                        </a>
                      ) : (
                        <button
                          onClick={() => setViewingContent(item.full_content || item.content_preview)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/50 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition"
                        >
                          <FileText className="w-3 h-3" />
                          View Content
                        </button>
                      )}
                      <button
                        onClick={() => deleteItem(item.id)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900/40 hover:bg-rose-100 dark:hover:bg-rose-950/50 transition ml-auto"
                      >
                        <Trash2 className="w-3 h-3" />
                        Delete
                      </button>
                    </div>

                    {/* Verdict notice */}
                    {item.verdict === "FAKE" && (
                      <div className="rounded-xl bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 p-3 flex items-start gap-2">
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
                        <p className="text-xs text-rose-700 dark:text-rose-400">Strong indicators of misinformation. Do not share without verification.</p>
                      </div>
                    )}
                    {item.verdict === "REAL" && (
                      <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 p-3 flex items-start gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                        <p className="text-xs text-emerald-700 dark:text-emerald-400">Appeared credible at time of assessment. Always verify with primary sources.</p>
                      </div>
                    )}
                    {item.verdict === "UNVERIFIED" && (
                      <div className="rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 p-3 flex items-start gap-2">
                        <Info className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                        <p className="text-xs text-amber-700 dark:text-amber-400">Could not be fully verified. Seek confirmation from multiple trusted sources.</p>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Mini progress card for history ───────────────────────────────────────
function MiniProgressCard({ label, value, verdict, invert = false }: {
  label: string; value: number; verdict: string; invert?: boolean
}) {
  const pct = Math.max(0, Math.min(100, value))
  let color = "bg-slate-400"
  const effectiveValue = invert ? 100 - pct : pct
  if (effectiveValue >= 70) color = "bg-emerald-500"
  else if (effectiveValue >= 40) color = "bg-amber-500"
  else color = "bg-rose-500"

  return (
    <div className="rounded-xl bg-white dark:bg-[#17171a] border border-slate-200 dark:border-white/6 p-3">
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-1">{label}</p>
      <p className="text-sm font-bold text-slate-800 dark:text-white mb-2">{pct}%</p>
      <div className="h-1.5 w-full bg-slate-100 dark:bg-[#222] rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ── Build bullet points from explanation ─────────────────────────────────
function buildExplanationBullets(explanation: string, sourceCred?: number, sentimentScore?: number): string[] {
  const bullets: string[] = []

  if (sourceCred !== undefined) {
    if (sourceCred >= 80) bullets.push("Credible domain detected")
    else if (sourceCred >= 60) bullets.push("Partially verified source")
    else bullets.push("Source credibility could not be confirmed")
  }

  // Parse key signals from explanation text
  const lower = explanation.toLowerCase()
  if (lower.includes("citation") || lower.includes("no sources") || lower.includes("no citation")) {
    bullets.push("No direct evidence citations found")
  } else if (lower.includes("cited") || lower.includes("evidence") || lower.includes("well-supported")) {
    bullets.push("Claims supported with evidence")
  }

  if (lower.includes("sensational") || lower.includes("clickbait") || lower.includes("emotional")) {
    bullets.push("Emotional / sensational wording present")
  } else if (lower.includes("neutral") || lower.includes("professional") || lower.includes("objective")) {
    bullets.push("Neutral and professional tone detected")
  }

  if (sentimentScore !== undefined) {
    const pct = Math.round(sentimentScore * 100)
    if (pct > 60) bullets.push("High emotional language score")
    else if (pct < 20) bullets.push("Low emotional bias detected")
  }

  if (lower.includes("verified") || lower.includes("fact-check")) {
    bullets.push("Matched external fact-check record")
  } else {
    bullets.push("Limited external verification available")
  }

  // Deduplicate and limit
  return [...new Set(bullets)].slice(0, 5)
}