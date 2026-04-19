import { NextResponse, NextRequest } from "next/server"
import { promises as fs } from "fs"
import path from "path"
import { randomUUID } from "crypto"

const DATA_FILE = path.join(process.cwd(), "data", "visitors.json")
const SESSION_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes

interface VisitorData {
  total_visitors: number
  today_visitors: number
  total_analyses: number
  today_date: string
  updated_at: string
  sessions: Record<string, number> // sessionId -> last active timestamp
}

async function readData(): Promise<VisitorData> {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf-8")
    const parsed = JSON.parse(raw)
    return {
      total_visitors: parsed.total_visitors ?? 0,
      today_visitors: parsed.today_visitors ?? parsed.today ?? 0,
      total_analyses: parsed.total_analyses ?? 0,
      today_date: parsed.today_date ?? getTodayPH(),
      updated_at: parsed.updated_at ?? new Date().toISOString(),
      sessions: parsed.sessions ?? {},
    }
  } catch {
    return {
      total_visitors: 0,
      today_visitors: 0,
      total_analyses: 0,
      today_date: getTodayPH(),
      updated_at: new Date().toISOString(),
      sessions: {},
    }
  }
}

async function writeData(data: VisitorData) {
  await fs.mkdir(path.join(process.cwd(), "data"), { recursive: true })
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2))
}

// Get today's date in Philippine Time (UTC+8)
function getTodayPH(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
}

// Remove expired sessions (older than 30 mins) and old daily sessions
function cleanSessions(sessions: Record<string, number>, today: string): Record<string, number> {
  const now = Date.now()
  const cleaned: Record<string, number> = {}
  for (const [id, lastActive] of Object.entries(sessions)) {
    // Keep if active within 30 mins
    if (now - lastActive < SESSION_TIMEOUT_MS) {
      cleaned[id] = lastActive
    }
  }
  return cleaned
}

export async function GET() {
  const data = await readData()
  return NextResponse.json({
    total_visitors: data.total_visitors,
    today: data.today_visitors,
    total_analyses: data.total_analyses,
    today_date: data.today_date,
  })
}

export async function POST(req: NextRequest) {
  const data = await readData()
  const today = getTodayPH()
  const now = Date.now()

  // Reset daily count if new day
  if (data.today_date !== today) {
    data.today_date = today
    data.today_visitors = 0
  }

  // Clean expired sessions
  data.sessions = cleanSessions(data.sessions, today)

  // Get or create session ID from cookie
  const existingSessionId = req.cookies.get("session_id")?.value
  const sessionId = existingSessionId ?? randomUUID()

  const lastActive = data.sessions[sessionId]
  const isExpiredOrNew = !lastActive || (now - lastActive >= SESSION_TIMEOUT_MS)

  if (isExpiredOrNew) {
    // New or expired session = new visit
    data.sessions[sessionId] = now
    data.today_visitors += 1
    data.total_visitors += 1
  } else {
    // Active session — just update last active time
    data.sessions[sessionId] = now
  }

  data.updated_at = new Date().toISOString()
  await writeData(data)

  const res = NextResponse.json({
    total_visitors: data.total_visitors,
    today: data.today_visitors,
    total_analyses: data.total_analyses,
    today_date: data.today_date,
  })

  // Set session cookie (expires in 1 day — resets daily)
  res.cookies.set("session_id", sessionId, {
    httpOnly: true,
    path: "/",
    maxAge: 60 * 60 * 24, // 1 day
    sameSite: "lax",
  })

  return res
}

export async function PATCH() {
  const data = await readData()
  data.total_analyses += 1
  data.updated_at = new Date().toISOString()
  await writeData(data)
  return NextResponse.json({ total_analyses: data.total_analyses })
}