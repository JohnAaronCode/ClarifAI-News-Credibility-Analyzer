"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Card } from "@/components/ui/card"
import { useState } from "react"

interface HistoryItem {
  id: string
  input_type: "text" | "url" | "file"
  content_preview: string
  fileName?: string
  verdict: "REAL" | "FAKE" | "UNVERIFIED"
  confidence_score: number
  explanation: string
  key_entities?: any
  sentiment_score?: number
  source_credibility?: number
  fact_check_results?: any
  created_at: string
}

interface HistoryStatsModalProps {
  isOpen: boolean
  onClose: () => void
  stats: {
    total: number
    real: number
    fake: number
    unverified: number
    avgConfidence: number
  }
}

export default function HistoryStatsModal({ isOpen, onClose, stats }: HistoryStatsModalProps) {
  const [activeFilter, setActiveFilter] = useState<"REAL" | "FAKE" | "UNVERIFIED" | null>(null)
  const [filteredHistory, setFilteredHistory] = useState<HistoryItem[]>([])

  const handleVerdictClick = (verdict: "REAL" | "FAKE" | "UNVERIFIED") => {
    setActiveFilter(activeFilter === verdict ? null : verdict)

    if (activeFilter !== verdict) {
      const history = JSON.parse(localStorage.getItem("analysisHistory") || "[]")
      const filtered = history.filter((item: HistoryItem) => item.verdict === verdict)
      setFilteredHistory(filtered)
    }
  }

  const verdictStats = [
    {
      label: "Credible",
      verdict: "REAL",
      count: stats.real,
      color: "bg-green-100 dark:bg-green-900/30",
      textColor: "text-green-700 dark:text-green-400",
      borderColor: "border-green-200 dark:border-green-800",
    },
    {
      label: "Likely False",
      verdict: "FAKE",
      count: stats.fake,
      color: "bg-red-100 dark:bg-red-900/30",
      textColor: "text-red-700 dark:text-red-400",
      borderColor: "border-red-200 dark:border-red-800",
    },
    {
      label: "Unverified",
      verdict: "UNVERIFIED",
      count: stats.unverified,
      color: "bg-yellow-100 dark:bg-yellow-900/30",
      textColor: "text-yellow-700 dark:text-yellow-400",
      borderColor: "border-yellow-200 dark:border-yellow-800",
    },
  ]

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Credibility Assessment History</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-4 space-y-6">
          {/* Overall Summary */}
          <div className="p-6 bg-muted/50 rounded-lg sticky top-0 z-10">
            <div className="grid grid-cols-2 gap-8 text-center">
              <div>
                <div className="text-5xl font-bold text-foreground mb-2">{stats.total}</div>
                <div className="text-sm text-muted-foreground">Total Assessments</div>
              </div>
              <div>
                <div className="text-5xl font-bold text-blue-600 dark:text-blue-400 mb-2">{stats.avgConfidence}%</div>
                <div className="text-sm text-muted-foreground">Average Credibility Score</div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="font-semibold text-foreground text-base">Click to view assessments by credibility:</h4>
            <div className="grid grid-cols-3 gap-4">
              {verdictStats.map((item) => (
                <button
                  key={item.verdict}
                  onClick={() => handleVerdictClick(item.verdict as "REAL" | "FAKE" | "UNVERIFIED")}
                  className={`p-6 rounded-lg border-2 transition-all cursor-pointer ${
                    activeFilter === item.verdict
                      ? `${item.color} ${item.borderColor} border-2`
                      : `bg-muted/30 border-border hover:border-foreground/30`
                  }`}
                >
                  <div
                    className={`text-3xl font-bold ${activeFilter === item.verdict ? item.textColor : "text-foreground"}`}
                  >
                    {item.count}
                  </div>
                  <div className="text-sm text-muted-foreground mt-2 font-medium">{item.label}</div>
                </button>
              ))}
            </div>
          </div>

          {activeFilter && filteredHistory.length > 0 && (
            <div className="space-y-3">
              <h4 className="font-semibold text-foreground text-base">
                {verdictStats.find(s => s.verdict === activeFilter)?.label} Content ({filteredHistory.length})
              </h4>
              <div className="space-y-2 max-h-[45vh] overflow-y-auto border rounded-lg p-3 bg-muted/10">
                {filteredHistory.map((item) => (
                  <Card key={item.id} className="p-4 hover:bg-muted/50 transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium line-clamp-2 text-foreground">
                          {item.input_type === "file" ? item.fileName || "File" : item.content_preview}
                        </p>
                        <div className="flex gap-2 text-xs text-muted-foreground mt-2">
                          <span>{new Date(item.created_at).toLocaleDateString()}</span>
                          <span>•</span>
                          <span className="uppercase font-medium">{item.input_type}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-base font-bold text-foreground">{item.confidence_score}%</div>
                        <p className="text-xs text-muted-foreground mt-1">{item.explanation.substring(0, 30)}...</p>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {activeFilter && filteredHistory.length === 0 && (
            <div className="p-6 bg-muted/50 rounded-lg text-center">
              <p className="text-sm text-muted-foreground">No assessments found in this credibility category</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}