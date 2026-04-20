const DEFAULT_SERVER = "https://clarif-ai-beta.vercel.app"
let currentMode = "text"
let serverUrl = DEFAULT_SERVER

const SOCIAL_DOMAINS = {
  "facebook.com": "Facebook", "fb.com": "Facebook", "fb.watch": "Facebook",
  "twitter.com": "X / Twitter", "x.com": "X / Twitter",
  "instagram.com": "Instagram", "tiktok.com": "TikTok",
  "youtube.com": "YouTube", "youtu.be": "YouTube", "reddit.com": "Reddit",
}

function detectSocialPlatform(url) {
  try {
    const host = new URL(url).hostname.replace("www.", "")
    for (const [domain, label] of Object.entries(SOCIAL_DOMAINS)) {
      if (host.includes(domain)) return label
    }
  } catch {}
  return null
}

function extractDomain(url) {
  try { return new URL(url).hostname.replace("www.", "") } catch { return null }
}

function extractTitleFromUrl(url) {
  try {
    const social = detectSocialPlatform(url)
    if (social) return `${social} post`
    const parts = new URL(url).pathname.split("/").filter(Boolean)
    const last = parts[parts.length - 1] || ""
    const title = last.replace(/[-_]/g, " ").replace(/\.\w+$/, "").replace(/\b\w/g, c => c.toUpperCase()).trim()
    return title || extractDomain(url)
  } catch { return url.substring(0, 60) }
}

function escHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

// ── Init ──────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  const stored = await chrome.storage.local.get(["serverUrl", "autoDetect", "showFab"])
  if (stored.serverUrl) {
    serverUrl = stored.serverUrl
    document.getElementById("server-url-input").value = serverUrl
  }
  if (stored.autoDetect === false) document.getElementById("auto-detect").checked = false
  if (stored.showFab === false) document.getElementById("show-fab").checked = false

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab) {
    const url = tab.url || ""
    const social = detectSocialPlatform(url)
    document.getElementById("current-url").textContent = url || "Unknown URL"
    document.getElementById("current-title").textContent = social
      ? `${social}: ${tab.title || "Post"}`
      : (tab.title || "Unknown Page")
    if (!url.startsWith("http")) {
      const btn = document.getElementById("analyze-page-btn")
      btn.disabled = true
    }
  }

  const { pendingAnalysis } = await chrome.storage.local.get("pendingAnalysis")
  if (pendingAnalysis) {
    await chrome.storage.local.remove("pendingAnalysis")
    switchTabByName("manual")
    setMode(pendingAnalysis.type || "url")
    if (pendingAnalysis.type === "text") {
      document.getElementById("manual-text").value = pendingAnalysis.content || ""
    } else {
      document.getElementById("manual-url").value = pendingAnalysis.content || ""
    }
  }

  loadHistory()
})

// ── Tab switching ─────────────────────────────────────────────────────────
function switchTab(name, btnEl) {
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"))
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"))
  if (btnEl) btnEl.classList.add("active")
  const panel = document.getElementById("tab-" + name)
  if (panel) panel.classList.add("active")
  if (name === "history") loadHistory()
}

function switchTabByName(name) {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name))
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"))
  const panel = document.getElementById("tab-" + name)
  if (panel) panel.classList.add("active")
  if (name === "history") loadHistory()
}

// ── Mode toggle ───────────────────────────────────────────────────────────
function setMode(mode) {
  currentMode = mode
  const isText = mode === "text"
  document.getElementById("manual-text").style.display = isText ? "block" : "none"
  document.getElementById("manual-url").style.display = isText ? "none" : "block"
  document.getElementById("mode-text").classList.toggle("active", isText)
  document.getElementById("mode-url").classList.toggle("active", !isText)
}

// ── Analyze current page ──────────────────────────────────────────────────
async function analyzeCurrentPage() {
  const btn = document.getElementById("analyze-page-btn")
  const resultEl = document.getElementById("page-result")
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

  if (!tab?.url?.startsWith("http")) {
    resultEl.innerHTML = `<div class="error-box">Cannot analyze this page. Please navigate to a news article or social media post first.</div>`
    return
  }

  btn.disabled = true
  btn.innerHTML = `<div class="spinner" style="width:14px;height:14px;border-width:2px"></div>`
  resultEl.innerHTML = renderLoading()

  try {
    const data = await callAnalyzeAPI(tab.url, "url")
    resultEl.innerHTML = renderResult(data, tab.url, "url")
    if (data.verdict !== "ERROR") {
      await saveToHistory({
        content: tab.url, full_content: tab.url,
        title: tab.title || extractTitleFromUrl(tab.url),
        domain: extractDomain(tab.url), type: "url", ...data,
      })
    }
  } catch (err) {
    resultEl.innerHTML = `<div class="error-box">❌ ${escHtml(err.message)}<br><small style="opacity:.7;margin-top:4px;display:block">Check Server URL in Settings</small></div>`
  } finally {
    btn.disabled = false
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Analyze This Page`
  }
}

// ── Analyze manual input ──────────────────────────────────────────────────
async function analyzeManual() {
  const resultEl = document.getElementById("manual-result")
  const raw = currentMode === "text"
    ? document.getElementById("manual-text").value.trim()
    : document.getElementById("manual-url").value.trim()

  if (!raw) {
    resultEl.innerHTML = `<div class="error-box">Please enter content to analyze.</div>`
    return
  }
  if (currentMode === "text" && raw.length < 30) {
    resultEl.innerHTML = `<div class="error-box">Content too short. Please paste a full article or post.</div>`
    return
  }

  const content = (currentMode === "url" && !/^https?:\/\//i.test(raw)) ? `https://${raw}` : raw

  if (currentMode === "url") {
    try { new URL(content) } catch {
      resultEl.innerHTML = `<div class="error-box">Please enter a valid URL.</div>`
      return
    }
  }

  resultEl.innerHTML = renderLoading()

  try {
    const data = await callAnalyzeAPI(content, currentMode)
    resultEl.innerHTML = renderResult(data, content, currentMode)
    if (data.verdict !== "ERROR") {
      const title = currentMode === "url"
        ? (data.search_query?.replace(/\b\w/g, c => c.toUpperCase()).trim() || extractTitleFromUrl(content))
        : (raw.split(/[.\n]/)[0]?.trim().substring(0, 80) || "Pasted text")
      await saveToHistory({
        content: raw.substring(0, 200), full_content: raw,
        title, domain: currentMode === "url" ? extractDomain(content) : null,
        type: currentMode, ...data,
      })
    }
  } catch (err) {
    resultEl.innerHTML = `<div class="error-box">❌ ${escHtml(err.message)}<br><small style="opacity:.7;margin-top:4px;display:block">Check Server URL in Settings</small></div>`
  }
}

// ── API ───────────────────────────────────────────────────────────────────
async function callAnalyzeAPI(content, type) {
  const base = serverUrl.replace(/\/$/, "")
  let res
  try {
    res = await fetch(`${base}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, type }),
    })
  } catch {
    throw new Error("Cannot reach server. Check your Server URL in Settings.")
  }
  if (!res.ok) throw new Error(`Server error (${res.status})`)
  return res.json()
}

// ── Render ────────────────────────────────────────────────────────────────
function renderLoading() {
  return `<div class="loading"><div class="spinner"></div><div class="loading-text">Analyzing credibility...</div></div>`
}

function buildResultBullets(data) {
  const bullets = []
  const cred = data.source_credibility ?? 0
  const clickbait = (data.clickbait_score ?? 0) * 100
  const sentiment = (data.sentiment_label ?? "").toLowerCase()
  const expl = (data.explanation ?? "").toLowerCase()
  const ml = data.ensemble_analysis?.ml_signals

  if (ml?.credibility_indicators?.length) bullets.push(ml.credibility_indicators[0])
  else if (cred >= 80) bullets.push("Credible domain detected")
  else if (cred >= 60) bullets.push("Partially verified source")
  else bullets.push("Source credibility unverified")

  if (ml?.red_flags?.length) bullets.push(ml.red_flags[0])
  else if (expl.includes("no citation") || expl.includes("no sources")) bullets.push("No direct evidence citations found")
  else if (expl.includes("evidence") || expl.includes("cited")) bullets.push("Evidence citations present")

  if (clickbait >= 50 || sentiment.includes("highly")) bullets.push("Emotional / sensational language")
  else if (clickbait < 20) bullets.push("Neutral, professional tone")

  const hasFC = (data.fact_check_results ?? []).some(f => f.relevance > 0.1)
  bullets.push(hasFC ? "Matched external fact-check" : "No matching fact-check found")

  return [...new Set(bullets)].slice(0, 4)
}

function renderResult(data, originalInput, inputType) {
  if (data.verdict === "ERROR") {
    return `<div class="error-box">${escHtml(data.explanation || "Analysis failed.")}</div>`
  }

  const labels = { REAL: "Credible", FAKE: "Likely False", UNVERIFIED: "Unverified" }
  const icons  = { REAL: "✓", FAKE: "✕", UNVERIFIED: "?" }
  const conf   = data.confidence_score ?? 50
  const label  = labels[data.verdict] ?? data.verdict
  const icon   = icons[data.verdict]  ?? "?"
  const social = inputType === "url" ? detectSocialPlatform(originalInput) : null
  const bullets = buildResultBullets(data)

  const bulletsHtml = bullets.map(b =>
    `<li><span class="bullet-dot bullet-${data.verdict}"></span>${escHtml(b)}</li>`
  ).join("")

  // Source links with headline-based search URLs
  const sourceLinks = (data.source_links ?? []).slice(0, 2)
  const sq = data.search_query || ""
  const sourceLinksHtml = sourceLinks.length
    ? `<div class="source-links">
        <div class="source-links-label">Cross-check sources</div>
        ${sourceLinks.map(src => {
          let href = src.article_url || src.url || "#"
          // If it's not a direct article, build a headline search URL
          if (sq && src.article_url === src.homepage_url) {
            try {
              const domain = new URL(src.homepage_url || src.url).hostname.replace("www.", "")
              href = `https://news.google.com/search?q=${encodeURIComponent(sq)}+site:${domain}`
            } catch {}
          }
          return `<a href="${escHtml(href)}" target="_blank" class="source-link">
            <span>${escHtml(src.name)}</span>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </a>`
        }).join("")}
      </div>`
    : ""

  const socialNote = social
    ? `<div class="social-note">📱 Analyzed from ${social}. Results reflect the post and linked content.</div>`
    : ""

  return `
    <div class="result-card">
      ${socialNote}
      <div class="verdict-row">
        <span class="verdict-badge verdict-${data.verdict}">${icon} ${label}</span>
        <span class="confidence-text">${conf}% confidence</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill fill-${data.verdict}" style="width:${conf}%"></div>
      </div>
      <ul class="result-bullets">${bulletsHtml}</ul>
      ${sourceLinksHtml}
      <a class="open-full-btn" href="${escHtml(serverUrl.replace(/\/$/, "") + "/")}" target="_blank">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
        Open full analysis
      </a>
    </div>`
}

// ── History ───────────────────────────────────────────────────────────────
async function saveToHistory(item) {
  const { history = [] } = await chrome.storage.local.get("history")
  const newKey = (item.full_content || item.content || "").trim().toLowerCase()
  const deduped = history.filter(h => {
    const k = (h.full_content || h.content || "").trim().toLowerCase()
    return k !== newKey
  })
  deduped.unshift({ ...item, id: Date.now(), created_at: new Date().toISOString() })
  await chrome.storage.local.set({ history: deduped.slice(0, 30) })
}

async function loadHistory() {
  const { history = [] } = await chrome.storage.local.get("history")
  const el = document.getElementById("history-list")
  if (!el) return

  if (!history.length) {
    el.innerHTML = `<div class="empty-state"><div class="icon">📋</div>No analyses yet.<br>Analyze a news article or social media post to see your history here.</div>`
    return
  }

  const labels = { REAL: "Credible", FAKE: "Likely False", UNVERIFIED: "Unverified" }

  el.innerHTML = history.map(item => {
    const title = item.title || item.content || "Unknown"
    const domain = item.domain || ""
    const date = new Date(item.created_at)
    const timeStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
      + " · " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    const conf = item.confidence_score ?? 0
    const verdict = item.verdict || "UNVERIFIED"
    const typeTag = item.type === "url"
      ? `<span style="color:#8b5cf6;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em">URL</span>`
      : `<span style="color:#0ea5e9;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em">TEXT</span>`

    return `
      <div class="history-item" id="hist-${item.id}">
        <div class="history-row">
          <div class="history-title" title="${escHtml(title)}">${escHtml(title.substring(0, 52))}${title.length > 52 ? "…" : ""}</div>
          <span class="verdict-badge verdict-${verdict}" style="font-size:9px;padding:2px 7px;white-space:nowrap;flex-shrink:0">${labels[verdict] ?? verdict} · ${conf}%</span>
        </div>
        <div class="history-meta">
          ${domain ? `<span class="history-domain">${escHtml(domain)}</span>` : ""}
          ${typeTag}
          <span class="history-time">${timeStr}</span>
        </div>
        <div class="history-actions">
          <button class="hist-btn hist-reanalyze" onclick="reanalyzeItem(${item.id})">↺ Re-analyze</button>
          ${item.type === "url"
            ? `<a href="${escHtml(item.full_content || item.content || "#")}" target="_blank" class="hist-btn hist-open">↗ Open URL</a>`
            : `<button class="hist-btn hist-view" onclick="viewContent(${item.id})">📄 View</button>`}
          <button class="hist-btn hist-delete" onclick="deleteHistoryItem(${item.id})">✕</button>
        </div>
      </div>`
  }).join("")
}

async function reanalyzeItem(id) {
  const { history = [] } = await chrome.storage.local.get("history")
  const item = history.find(h => h.id === id)
  if (!item) return
  const content = item.full_content || item.content || ""
  const type = item.type || "url"
  switchTabByName("manual")
  setMode(type)
  if (type === "text") document.getElementById("manual-text").value = content
  else document.getElementById("manual-url").value = content
  setTimeout(() => analyzeManual(), 80)
}

function viewContent(id) {
  chrome.storage.local.get("history").then(({ history = [] }) => {
    const item = history.find(h => h.id === id)
    if (!item) return
    const content = item.full_content || item.content || "No content stored."
    const overlay = document.createElement("div")
    overlay.style.cssText = "position:fixed;inset:0;z-index:999;background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:12px;"
    overlay.innerHTML = `
      <div style="background:#17171a;border:1px solid rgba(255,255,255,0.08);border-radius:12px;width:100%;max-height:420px;display:flex;flex-direction:column;overflow:hidden;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,0.06);">
          <span style="font-size:12px;font-weight:600;color:#e2e8f0;">📄 Analyzed Content</span>
          <button onclick="this.closest('[style*=fixed]').remove()" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:18px;line-height:1;padding:0 2px;">✕</button>
        </div>
        <div style="padding:12px 14px;overflow-y:auto;flex:1;">
          <p style="font-size:11.5px;color:#94a3b8;line-height:1.7;white-space:pre-wrap;">${escHtml(content)}</p>
        </div>
        <div style="padding:10px 14px;border-top:1px solid rgba(255,255,255,0.06);display:flex;justify-content:flex-end;">
          <button onclick="this.closest('[style*=fixed]').remove()" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:7px;color:#94a3b8;font-size:11px;padding:5px 12px;cursor:pointer;font-family:inherit;">Close</button>
        </div>
      </div>`
    overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove() })
    document.body.appendChild(overlay)
  })
}

async function deleteHistoryItem(id) {
  const { history = [] } = await chrome.storage.local.get("history")
  await chrome.storage.local.set({ history: history.filter(h => h.id !== id) })
  const el = document.getElementById("hist-" + id)
  if (el) {
    el.style.cssText += ";opacity:0;transform:translateX(8px);transition:all .18s;"
    setTimeout(() => { el.remove(); if (!document.querySelector(".history-item")) loadHistory() }, 200)
  }
}

// ── Settings ──────────────────────────────────────────────────────────────
async function saveSettings() {
  const url = document.getElementById("server-url-input").value.trim()
  if (!url) { alert("Please enter a server URL."); return }
  serverUrl = url
  const autoDetect = document.getElementById("auto-detect").checked
  const showFab = document.getElementById("show-fab").checked
  await chrome.storage.local.set({ serverUrl: url, autoDetect, showFab })
  const btn = document.querySelector(".save-btn")
  const orig = btn.textContent
  btn.textContent = "✓ Saved!"
  setTimeout(() => { btn.textContent = orig }, 1800)
}
