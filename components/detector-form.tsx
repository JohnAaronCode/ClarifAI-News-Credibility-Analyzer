"use client"

import type React from "react"
import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Loader2, X, FileText, Link2, ScanSearch, Sparkles } from "lucide-react"

interface DetectorFormProps {
  onAnalyze: (content: string, type: "text" | "url") => void
  onClearResult: () => void
  loading: boolean
}

export default function DetectorForm({ onAnalyze, onClearResult, loading }: DetectorFormProps) {
  const [activeTab, setActiveTab] = useState("article")
  const [articleText, setArticleText] = useState("")
  const [urlInput, setUrlInput] = useState("")
  const [articleError, setArticleError] = useState("")
  const [urlError, setUrlError] = useState("")

  function looksLikeUrl(text: string): boolean {
    const trimmed = text.trim()
    return /^https?:\/\//i.test(trimmed) || /^www\./i.test(trimmed) || /^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(\/|$)/.test(trimmed)
  }

  const validateArticleInput = (text: string): { isValid: boolean; error: string } => {
    const trimmed = text.trim()
    if (!trimmed) return { isValid: false, error: "" }
    if (looksLikeUrl(trimmed)) return { isValid: false, error: "This looks like a URL. Please switch to the URL tab." }
    if (trimmed.length < 30) return { isValid: false, error: "Content is too short. Please paste a full article." }
    const wordCount = trimmed.split(/\s+/).filter(Boolean).length
    if (wordCount < 5) return { isValid: false, error: "Please paste a full article or more text." }
    const words = trimmed.toLowerCase().split(/\s+/).filter(Boolean)
    const uniqueRatio = new Set(words).size / words.length
    if (uniqueRatio < 0.4) return { isValid: false, error: "Content seems repetitive. Please provide a real article." }
    return { isValid: true, error: "" }
  }

  const validateUrlInput = (url: string): { isValid: boolean; error: string } => {
    const trimmed = url.trim()
    if (!trimmed) return { isValid: false, error: "" }
    if (!looksLikeUrl(trimmed)) return { isValid: false, error: "This looks like article text. Please switch to the Article tab." }
    try {
      const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
      new URL(withScheme)
      return { isValid: true, error: "" }
    } catch {
      return { isValid: false, error: "Please enter a valid URL (e.g. https://rappler.com/article)" }
    }
  }

  const handleArticleSubmit = () => {
    const validation = validateArticleInput(articleText)
    if (!validation.isValid) { setArticleError(validation.error); return }
    setArticleError("")
    onAnalyze(articleText, "text")
  }

  const handleUrlSubmit = () => {
    const validation = validateUrlInput(urlInput)
    if (!validation.isValid) { setUrlError(validation.error); return }
    setUrlError("")
    const trimmed = urlInput.trim()
    const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    onAnalyze(normalized, "url")
  }

  const handleArticleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setArticleText(e.target.value)
    setArticleError("")
    if (urlInput) setUrlInput("")
    if (e.target.value.trim() === "") onClearResult()
  }

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUrlInput(e.target.value)
    setUrlError("")
    if (articleText) setArticleText("")
    if (e.target.value.trim() === "") onClearResult()
  }

  const handleClearArticle = () => { setArticleText(""); setArticleError(""); onClearResult() }
  const handleClearUrl = () => { setUrlInput(""); setUrlError(""); onClearResult() }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500&display=swap');
        .detector-form { font-family: 'DM Sans', sans-serif; }

        .form-section-label {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.07em;
          text-transform: uppercase;
          margin-bottom: 10px;
        }

        .analyze-btn {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 12px 20px;
          border-radius: 12px;
          font-size: 14px;
          font-weight: 600;
          border: none;
          cursor: pointer;
          transition: all 0.2s ease;
          font-family: 'DM Sans', sans-serif;
          letter-spacing: 0.01em;
        }
        .analyze-btn:not(:disabled) {
          background: linear-gradient(135deg, #0d9488, #0f766e);
          color: white;
          box-shadow: 0 2px 12px rgba(13,148,136,0.25);
        }
        .analyze-btn:not(:disabled):hover {
          box-shadow: 0 4px 20px rgba(13,148,136,0.4);
          transform: translateY(-1px);
        }
        .analyze-btn:not(:disabled):active {
          transform: translateY(0);
          box-shadow: 0 1px 6px rgba(13,148,136,0.2);
        }
        .analyze-btn:disabled {
          background: #e2e8f0;
          color: #94a3b8;
          cursor: not-allowed;
        }
        .dark .analyze-btn:disabled {
          background: #1e293b;
          color: #475569;
        }

        .form-textarea, .form-input {
          width: 100%;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 12px 14px;
          font-size: 14px;
          color: #0f172a;
          font-family: 'DM Sans', sans-serif;
          transition: border-color 0.2s, box-shadow 0.2s;
          resize: vertical;
          line-height: 1.6;
        }
        .dark .form-textarea, .dark .form-input {
          background: #0f1117;
          border-color: rgba(255,255,255,0.08);
          color: #e2e8f0;
        }
        .form-textarea:focus, .form-input:focus {
          outline: none;
          border-color: #0d9488;
          box-shadow: 0 0 0 3px rgba(13,148,136,0.1);
        }
        .form-textarea.error, .form-input.error {
          border-color: #f87171;
        }
        .form-textarea::placeholder, .form-input::placeholder {
          color: #94a3b8;
        }
        .dark .form-textarea::placeholder, .dark .form-input::placeholder {
          color: #475569;
        }

        .error-msg {
          display: flex;
          align-items: flex-start;
          gap: 7px;
          padding: 10px 12px;
          border-radius: 10px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          font-size: 12.5px;
          color: #dc2626;
        }
        .dark .error-msg {
          background: rgba(239,68,68,0.08);
          border-color: rgba(239,68,68,0.2);
          color: #f87171;
        }
      `}</style>

      <div className="detector-form w-full">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-5 bg-slate-100 dark:bg-[#111] border border-slate-200 dark:border-white/6 p-1 rounded-xl h-auto">
            <TabsTrigger
              value="article"
              className="flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-[#1e1e22] data-[state=active]:text-slate-900 dark:data-[state=active]:text-white data-[state=active]:shadow-sm text-slate-500 dark:text-slate-400 transition-all"
            >
              <FileText className="w-3.5 h-3.5" />
              Text
            </TabsTrigger>
            <TabsTrigger
              value="url"
              className="flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-[#1e1e22] data-[state=active]:text-slate-900 dark:data-[state=active]:text-white data-[state=active]:shadow-sm text-slate-500 dark:text-slate-400 transition-all"
            >
              <Link2 className="w-3.5 h-3.5" />
              URL
            </TabsTrigger>
          </TabsList>

          {/* ARTICLE TAB */}
          <TabsContent value="article" className="space-y-3">
            <div className="form-section-label text-slate-400 dark:text-slate-500">
              <FileText style={{ width: 12, height: 12 }} />
              Paste article text
            </div>
            <div className="relative">
              <textarea
                className={`form-textarea min-h-[120px] pr-10 ${articleError ? "error" : ""}`}
                placeholder="Paste the full article content here to assess credibility..."
                value={articleText}
                onChange={handleArticleChange}
                rows={5}
              />
              {articleText && (
                <button
                  onClick={handleClearArticle}
                  className="absolute top-3 right-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition"
                  aria-label="Clear"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {articleError && (
              <div className="error-msg">
                <X style={{ width: 13, height: 13, marginTop: 1, flexShrink: 0 }} />
                {articleError}
              </div>
            )}

            <button
              className="analyze-btn"
              onClick={handleArticleSubmit}
              disabled={loading || !articleText.trim()}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <ScanSearch className="w-4 h-4" />
                  Analyze
                </>
              )}
            </button>
          </TabsContent>

          {/* URL TAB */}
          <TabsContent value="url" className="space-y-3">
            <div className="form-section-label text-slate-400 dark:text-slate-500">
              <Link2 style={{ width: 12, height: 12 }} />
              Enter article URL
            </div>
            <div className="relative">
              <input
                type="url"
                className={`form-input pr-10 ${urlError ? "error" : ""}`}
                placeholder="https://rappler.com/article/..."
                value={urlInput}
                onChange={handleUrlChange}
              />
              {urlInput && (
                <button
                  onClick={handleClearUrl}
                  className="absolute top-1/2 -translate-y-1/2 right-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition"
                  aria-label="Clear"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {urlError && (
              <div className="error-msg">
                <X style={{ width: 13, height: 13, marginTop: 1, flexShrink: 0 }} />
                {urlError}
              </div>
            )}

            <button
              className="analyze-btn"
              onClick={handleUrlSubmit}
              disabled={loading || !urlInput.trim()}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <ScanSearch className="w-4 h-4" />
                  Analyze
                </>
              )}
            </button>
          </TabsContent>
        </Tabs>
      </div>
    </>
  )
}