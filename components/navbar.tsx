"use client"

import { useTheme } from "next-themes"
import { useEffect, useState } from "react"
import Link from "next/link"
import { Sun, Moon } from "lucide-react"

export default function Navbar() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const saved = localStorage.getItem("clarifai_theme") ?? localStorage.getItem("theme")
    if (saved) setTheme(saved)

    const handleStorage = (e: StorageEvent) => {
      if (e.key === "clarifai_theme" && e.newValue) setTheme(e.newValue)
    }
    window.addEventListener("storage", handleStorage)
    return () => window.removeEventListener("storage", handleStorage)
  }, [setTheme])

  const isDark = mounted ? theme === "dark" : false

  const handleToggle = () => {
    const next = isDark ? "light" : "dark"
    setTheme(next)
    localStorage.setItem("clarifai_theme", next)
    localStorage.setItem("theme", next)
    document.documentElement.classList.toggle("dark", next === "dark")
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&family=DM+Serif+Display:ital@1&display=swap');

        .cai-nav {
          font-family: 'DM Sans', sans-serif;
        }
        .cai-wordmark {
          font-family: 'DM Serif Display', serif;
          font-style: normal;
        }
        .cai-theme-btn {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 6px 12px 6px 10px;
          border-radius: 999px;
          border: 1px solid;
          cursor: pointer;
          transition: all 0.2s ease;
          font-size: 12.5px;
          font-weight: 500;
          background: transparent;
          font-family: 'DM Sans', sans-serif;
        }
        .cai-theme-btn.dark-state {
          border-color: rgba(255,255,255,0.12);
          color: #94a3b8;
        }
        .cai-theme-btn.dark-state:hover {
          border-color: rgba(255,255,255,0.22);
          background: rgba(255,255,255,0.05);
          color: #cbd5e1;
        }
        .cai-theme-btn.light-state {
          border-color: rgba(0,0,0,0.12);
          color: #64748b;
        }
        .cai-theme-btn.light-state:hover {
          border-color: rgba(0,0,0,0.2);
          background: rgba(0,0,0,0.04);
          color: #475569;
        }
        .cai-logo-ring {
          width: 34px;
          height: 34px;
          border-radius: 10px;
          background: linear-gradient(135deg, #0d9488, #0f766e);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 8px rgba(13,148,136,0.3);
          flex-shrink: 0;
        }
      `}</style>

      <nav
        className="cai-nav sticky top-0 z-50"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 1.5rem",
          height: "56px",
          borderBottom: isDark
            ? "0.5px solid rgba(255,255,255,0.06)"
            : "0.5px solid rgba(0,0,0,0.07)",
          background: isDark
            ? "rgba(14,14,15,0.92)"
            : "rgba(248,250,252,0.92)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
        }}
      >
        {/* Logo */}
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
          <div className="cai-logo-ring">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </div>
          <div>
            <div
              className="cai-wordmark"
              style={{
                fontSize: 17,
                lineHeight: 1.1,
                color: isDark ? "#f1f5f9" : "#0f172a",
                letterSpacing: "-0.2px",
              }}
            >
              ClarifAI
            </div>
            <div style={{ fontSize: 10, fontWeight: 500, color: isDark ? "#475569" : "#94a3b8", marginTop: 1, letterSpacing: "0.04em", textTransform: "uppercase" }}>
              News Credibility Analyzer
            </div>
          </div>
        </Link>

        {/* Theme toggle */}
        {mounted && (
          <button
            onClick={handleToggle}
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            className={`cai-theme-btn ${isDark ? "dark-state" : "light-state"}`}
          >
            {isDark
              ? <Moon style={{ width: 13, height: 13 }} />
              : <Sun style={{ width: 13, height: 13 }} />
            }
            {isDark ? "Dark mode" : "Light mode"}
          </button>
        )}
      </nav>
    </>
  )
}