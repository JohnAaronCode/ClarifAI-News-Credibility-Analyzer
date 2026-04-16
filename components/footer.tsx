"use client"

import { ShieldCheck } from "lucide-react"

export default function Footer() {
  const currentYear = new Date().getFullYear()

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500&display=swap');
        .cai-footer { font-family: 'DM Sans', sans-serif; }
      `}</style>

      <footer className="cai-footer mt-16 py-7">
        <div
          className="max-w-3xl mx-auto px-4"
          style={{
            borderTop: "0.5px solid",
            borderColor: "rgba(148,163,184,0.15)",
            paddingTop: "1.5rem",
          }}
        >
          <p className="text-xs text-slate-400 dark:text-slate-500 text-center">
            © {currentYear} ClarifAI. All rights reserved. Built by{" "}
            <a
              href="https://github.com/JohnAaronCode"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 transition-colors"
              style={{ textDecoration: "none" }}
            >
              John Aaron Tumangan
            </a>
          </p>
        </div>
      </footer>
    </>
  )
}