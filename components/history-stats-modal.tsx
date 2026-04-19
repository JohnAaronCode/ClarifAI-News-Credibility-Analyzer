import { useState, useEffect } from "react"
import { BarChart2, Search, X, Clock, Trash2, ChevronRight, AlertTriangle, CheckCircle2, Info } from "lucide-react"
import { Card } from "@/components/ui/card"

type HistoryItem = {
  id: string
  verdict: "REAL" | "FAKE" | "UNVERIFIED"
  content_preview: string
  explanation: string
  created_at: string
  input_type: "url" | "text"
  confidence_score: number
}

const VERDICT_DISPLAY = {
  REAL: {
    label: "Real",
    bg: "bg-emerald-100 dark:bg-emerald-950/20",
    text: "text-emerald-700 dark:text-emerald-400",
    border: "border-emerald-200 dark:border-emerald-900/40",
    icon: CheckCircle2,
  },
  FAKE: {
    label: "Fake",
    bg: "bg-rose-100 dark:bg-rose-950/20",
    text: "text-rose-700 dark:text-rose-400",
    border: "border-rose-200 dark:border-rose-900/40",
    icon: AlertTriangle,
  },
  UNVERIFIED: {
    label: "Unverified",
    bg: "bg-amber-100 dark:bg-amber-950/20",
    text: "text-amber-700 dark:text-amber-400",
    border: "border-amber-200 dark:border-amber-900/40",
    icon: Info,
  },
}

function HistoryTab() {
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [filtered, setFiltered] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeFilter, setActiveFilter] = useState<"ALL" | "REAL" | "FAKE" | "UNVERIFIED">("ALL")
  const [searchQuery, setSearchQuery] = useState("")
  const [expandedId, setExpandedId] = useState<string | null>(null)

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
        i.explanation.toLowerCase().includes(q)
      )
    }
    setFiltered(result)
  }, [history, activeFilter, searchQuery])

  const deleteItem = (id: string) => {
    const updated = history.filter(i => i.id !== id)
    localStorage.setItem("analysisHistory", JSON.stringify(updated))
    setHistory(updated)
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-7 h-7 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (history.length === 0) return (
    <Card className="p-14 text-center bg-white dark:bg-[#17171a] border-slate-200 dark:border-white/6 rounded-2xl">
      <BarChart2 className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
      <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">No assessments yet</p>
      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Analyze some content to see your history here.</p>
    </Card>
  )

  return (
    <div className="space-y-3 fade-in">
      {/* Search + filter */}
      <Card className="p-3 space-y-2.5 bg-white dark:bg-[#17171a] border-slate-200 dark:border-white/6 shadow-sm rounded-2xl">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search assessments..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-8 py-2 text-xs rounded-xl border border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-[#111] text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-teal-500/30 transition"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {(["ALL", "REAL", "FAKE", "UNVERIFIED"] as const).map(f => {
            const count = f === "ALL" ? history.length : history.filter(i => i.verdict === f).length
            const cfg = f !== "ALL" ? VERDICT_DISPLAY[f] : null
            const isActive = activeFilter === f
            return (
              <button
                key={f}
                onClick={() => setActiveFilter(f)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${
                  isActive
                    ? cfg ? `${cfg.bg} ${cfg.text} ${cfg.border}` : "bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-transparent"
                    : "bg-slate-100 dark:bg-[#222] text-slate-500 dark:text-slate-400 border-transparent hover:border-slate-300 dark:hover:border-white/20"
                }`}
              >
                {f === "ALL" ? "All" : VERDICT_DISPLAY[f].label} <span className="opacity-60">{count}</span>
              </button>
            )
          })}
        </div>
      </Card>

      {filtered.length === 0 && (
        <Card className="p-10 text-center bg-white dark:bg-[#17171a] border-slate-200 dark:border-white/6 rounded-2xl">
          <p className="text-sm text-slate-500 dark:text-slate-400">No matching assessments.</p>
        </Card>
      )}

      <div className="space-y-2">
        {filtered.map(item => {
          const cfg = VERDICT_DISPLAY[item.verdict as keyof typeof VERDICT_DISPLAY] ?? VERDICT_DISPLAY["UNVERIFIED"]
          const VIcon = cfg.icon
          const isExpanded = expandedId === item.id
          const date = new Date(item.created_at)

          return (
            <Card key={item.id} className="overflow-hidden bg-white dark:bg-[#17171a] border-slate-200 dark:border-white/6 rounded-xl shadow-sm">
              <div className="p-3.5 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-800 dark:text-slate-200 line-clamp-2 leading-snug mb-1.5">{item.content_preview}</p>
                  <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
                    <Clock className="w-3 h-3" />
                    <span>{date.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium uppercase ${item.input_type === "url" ? "text-violet-500" : "text-sky-500"}`}>
                      {item.input_type}
                    </span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
                    <VIcon className="w-3 h-3" />{cfg.label}
                  </span>
                  <span className="text-xs text-slate-400 font-mono">{item.confidence_score}%</span>
                  <button onClick={() => deleteItem(item.id)} className="text-slate-300 hover:text-rose-400 dark:text-slate-600 dark:hover:text-rose-400 transition">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Confidence bar */}
              <div className="h-0.5 w-full bg-slate-100 dark:bg-[#222]">
                <div
                  className={`h-full ${item.verdict === "REAL" ? "bg-emerald-400" : item.verdict === "FAKE" ? "bg-rose-400" : "bg-amber-400"}`}
                  style={{ width: `${item.confidence_score}%` }}
                />
              </div>

              {/* Expand */}
              <button
                onClick={() => setExpandedId(isExpanded ? null : item.id)}
                className="w-full flex items-center justify-center gap-1 py-1.5 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#1f1f22] transition border-t border-slate-100 dark:border-white/4"
              >
                {isExpanded ? "Hide details" : "Show details"}
                <ChevronRight className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 pt-3 border-t border-slate-100 dark:border-white/4 bg-slate-50/30 dark:bg-transparent space-y-2">
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{item.explanation}</p>
                  {item.verdict === "FAKE" && (
                    <div className="rounded-lg bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 p-2.5 flex items-start gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
                      <p className="text-xs text-rose-700 dark:text-rose-400">Do not share without independent verification.</p>
                    </div>
                  )}
                  {item.verdict === "REAL" && (
                    <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 p-2.5 flex items-start gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                      <p className="text-xs text-emerald-700 dark:text-emerald-400">Appeared credible. Always verify with primary sources.</p>
                    </div>
                  )}
                  {item.verdict === "UNVERIFIED" && (
                    <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 p-2.5 flex items-start gap-2">
                      <Info className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-700 dark:text-amber-400">Seek confirmation from multiple trusted sources.</p>
                    </div>
                  )}
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}