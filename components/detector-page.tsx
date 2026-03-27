"use client"

import { useState, useEffect } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card } from "@/components/ui/card"
import Navbar from "@/components/navbar"
import DetectorForm from "@/components/detector-form"
import ResultsDisplay from "@/components/results-display"
import HistoryStatsModal from "@/components/history-stats-modal"
import Footer from "@/components/footer"

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
  verdict: "REAL" | "FAKE" | "UNVERIFIED"
  confidence_score: number
  explanation: string
  key_entities?: any
  sentiment_score?: number
  source_credibility?: number
  fact_check_results?: any
  created_at: string
}

function getCredibilityLabel(verdict: string): string {
  switch (verdict) {
    case "REAL":
      return "Credible"
    case "FAKE":
      return "Likely False"
    case "UNVERIFIED":
      return "Unverified"
    default:
      return verdict
  }
}

export default function DetectorPage() {
  const [activeTab, setActiveTab] = useState("detector")
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [inputContent, setInputContent] = useState("")

  const handleAnalyze = async (content: string, type: "text" | "url") => {
    setLoading(true)
    setInputContent(content)

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, type }),
      })

      const data = await response.json()
      setResult(data)

      if (data.verdict !== "ERROR") {
        const history = JSON.parse(localStorage.getItem("analysisHistory") || "[]")

        const contentHash = Buffer.from(content.substring(0, 300)).toString("base64")

        const existingIndex = history.findIndex(
          (item: HistoryItem) =>
            item.content_preview === content.substring(0, 200)
        )

        const newEntry: HistoryItem = {
          id: existingIndex >= 0 ? history[existingIndex].id : Date.now().toString(),
          input_type: type,
          content_preview: content.substring(0, 200),
          verdict: data.verdict,
          confidence_score: data.confidence_score,
          explanation: data.explanation,
          key_entities: data.key_entities,
          sentiment_score: data.sentiment_score,
          source_credibility: data.source_credibility,
          fact_check_results: data.fact_check_results,
          created_at: new Date().toISOString(),
        }

        if (existingIndex >= 0) {
          history.splice(existingIndex, 1)
        }

        history.unshift(newEntry)
        localStorage.setItem("analysisHistory", JSON.stringify(history))
      }
    } catch (error) {
      console.error("Analysis error:", error)
      setResult({
        verdict: "ERROR",
        confidence_score: 0,
        explanation: "Error during analysis. Please try again.",
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />

      <main className="max-w-4xl mx-auto px-4 py-8 flex-1 w-full">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2 text-center">ClarifAI</h1>
          <p className="text-center text-muted-foreground">News Credibility Analyzer</p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="detector">Content Credibility Analysis</TabsTrigger>
            <TabsTrigger value="history">Analysis History</TabsTrigger>
          </TabsList>

          <TabsContent value="detector" className="space-y-6">
            <Card className="p-6">
              <h2 className="text-2xl font-semibold mb-2 text-center">Article Credibility Assessment</h2>
              <p className="text-muted-foreground mb-6 text-center">Submit a news article or URL for credibility assessment and detailed analysis.</p>

              <DetectorForm onAnalyze={handleAnalyze} onClearResult={() => setResult(null)} loading={loading} />
            </Card>

            {result && <ResultsDisplay result={result} inputContent={inputContent} />}
          </TabsContent>

          <TabsContent value="history">
            <HistoryTab />
          </TabsContent>
        </Tabs>
      </main>

      <Footer />
    </div>
  )
}

function HistoryTab() {
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [stats, setStats] = useState({ total: 0, real: 0, fake: 0, unverified: 0, avgConfidence: 0 })
  const [loading, setLoading] = useState(true)
  const [selectedItems, setSelectedItems] = useState<string[]>([])
  const [selectAll, setSelectAll] = useState(false)
  const [statsModalOpen, setStatsModalOpen] = useState(false)

  useEffect(() => {
    const savedHistory = JSON.parse(localStorage.getItem("analysisHistory") || "[]")
    setHistory(savedHistory)

    if (savedHistory.length > 0) {
      const real = savedHistory.filter((d: HistoryItem) => d.verdict === "REAL").length
      const fake = savedHistory.filter((d: HistoryItem) => d.verdict === "FAKE").length
      const unverified = savedHistory.filter((d: HistoryItem) => d.verdict === "UNVERIFIED").length
      const avgConfidence =
        savedHistory.reduce((sum: number, d: HistoryItem) => sum + d.confidence_score, 0) / savedHistory.length

      setStats({
        total: savedHistory.length,
        real,
        fake,
        unverified,
        avgConfidence: Math.round(avgConfidence),
      })
    }

    setLoading(false)
  }, [])

  const handleSelect = (id: string) => {
    setSelectedItems((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedItems([])
      setSelectAll(false)
    } else {
      setSelectedItems(history.map((item) => item.id))
      setSelectAll(true)
    }
  }

  const handleDeleteSelected = () => {
    if (selectedItems.length === 0) {
      alert("Please select at least one item to delete.")
      return
    }

    const updatedHistory = history.filter((item) => !selectedItems.includes(item.id))
    localStorage.setItem("analysisHistory", JSON.stringify(updatedHistory))
    setHistory(updatedHistory)
    setSelectedItems([])
    setSelectAll(false)
  }

  if (loading) return <div className="text-center py-8">Loading history...</div>

  if (history.length === 0) {
    return (
      <Card className="p-12">
        <div className="text-center">
          <p className="text-muted-foreground text-lg">No assessment history yet. Start by assessing some content!</p>
        </div>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <div>
            <h2 className="text-2xl font-semibold">Credibility Assessment History</h2>
            <div className="text-sm text-muted-foreground mt-1">{stats.total} total assessments</div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleSelectAll}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {selectAll ? "Deselect All" : "Select All"}
            </button>
            <button
              onClick={handleDeleteSelected}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Delete Selected
            </button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <button
            onClick={() => setStatsModalOpen(true)}
            className="bg-blue-50 dark:bg-blue-950 p-4 rounded-lg hover:shadow-md transition-shadow cursor-pointer"
          >
            <div className="text-3xl font-bold text-blue-600">{stats.total}</div>
            <div className="text-sm text-muted-foreground">Total</div>
          </button>
          <button
            onClick={() => setStatsModalOpen(true)}
            className="bg-green-50 dark:bg-green-950 p-4 rounded-lg hover:shadow-md transition-shadow cursor-pointer"
          >
            <div className="text-3xl font-bold text-green-600">{stats.real}</div>
            <div className="text-sm text-muted-foreground">Credible</div>
          </button>
          <button
            onClick={() => setStatsModalOpen(true)}
            className="bg-red-50 dark:bg-red-950 p-4 rounded-lg hover:shadow-md transition-shadow cursor-pointer"
          >
            <div className="text-3xl font-bold text-red-600">{stats.fake}</div>
            <div className="text-sm text-muted-foreground">Likely False</div>
          </button>
          <button
            onClick={() => setStatsModalOpen(true)}
            className="bg-yellow-50 dark:bg-yellow-950 p-4 rounded-lg hover:shadow-md transition-shadow cursor-pointer"
          >
            <div className="text-3xl font-bold text-yellow-600">{stats.unverified}</div>
            <div className="text-sm text-muted-foreground">Unverified</div>
          </button>
        </div>
      </Card>

      <div className="space-y-3">
        {history.map((item) => (
          <Card key={item.id} className="p-5 hover:bg-muted/50 transition-colors">
            <div className="flex items-start gap-4">
              <input
                type="checkbox"
                checked={selectedItems.includes(item.id)}
                onChange={() => handleSelect(item.id)}
                className="mt-2 accent-blue-600 w-4 h-4 shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-2 mb-3">
                  <p className="font-semibold line-clamp-2 text-foreground wrap-break-words">
                    {item.content_preview}
                  </p>
                </div>

                <div className="h-px bg-border/40 my-3" />

                <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <span>
                      {new Date(item.created_at).toLocaleDateString()} -{" "}
                      {new Date(item.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <span>•</span>
                  <div className="flex items-center gap-1">
                    <span className="uppercase text-xs font-medium">
                      {item.input_type === "url" ? "URL" : "TEXT"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="text-right ml-4 shrink-0">
                <div
                  className={`font-bold text-sm mb-2 px-3 py-1 rounded-full inline-block ${
                    item.verdict === "REAL"
                      ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                      : item.verdict === "FAKE"
                        ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                        : "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-600"
                  }`}
                >
                  {getCredibilityLabel(item.verdict)}
                </div>
                <div className="flex items-center gap-1 justify-end">
                  <span className="text-xl font-bold text-foreground">{item.confidence_score}%</span>
                  <span className="text-xs text-muted-foreground">credibility</span>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <HistoryStatsModal isOpen={statsModalOpen} onClose={() => setStatsModalOpen(false)} stats={stats} />
    </div>
  )
}