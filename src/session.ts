/**
 * Bind DSH session ids → Cursor local agent ids (memory + optional disk).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type { SDKAgent } from '@cursor/sdk'

export interface SessionBinding {
  agentId: string
  cwd: string
  lastRunId?: string
  updatedAt: number
}

export class SessionStore {
  private readonly live = new Map<string, SDKAgent>()
  private readonly meta = new Map<string, SessionBinding>()
  private readonly path: string

  constructor(stateDir?: string) {
    const dir = stateDir?.trim()
      || join(homedir(), '.dsh', 'cursor-bridge')
    mkdirSync(dir, { recursive: true })
    this.path = join(dir, 'sessions.json')
    this.load()
  }

  private load() {
    if (!existsSync(this.path)) return
    try {
      const raw = JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, SessionBinding>
      for (const [k, v] of Object.entries(raw)) {
        if (v?.agentId && v?.cwd) this.meta.set(k, v)
      }
    } catch {
      /* ignore corrupt store */
    }
  }

  private save() {
    const obj: Record<string, SessionBinding> = {}
    for (const [k, v] of this.meta) obj[k] = v
    mkdirSync(dirname(this.path), { recursive: true })
    writeFileSync(this.path, JSON.stringify(obj, null, 2))
  }

  getLive(dshSessionId: string): SDKAgent | undefined {
    return this.live.get(dshSessionId)
  }

  getMeta(dshSessionId: string): SessionBinding | undefined {
    return this.meta.get(dshSessionId)
  }

  setLive(dshSessionId: string, agent: SDKAgent, cwd: string, lastRunId?: string) {
    this.live.set(dshSessionId, agent)
    this.meta.set(dshSessionId, {
      agentId: agent.agentId,
      cwd,
      lastRunId,
      updatedAt: Date.now(),
    })
    this.save()
  }

  touchRun(dshSessionId: string, runId: string) {
    const m = this.meta.get(dshSessionId)
    if (!m) return
    m.lastRunId = runId
    m.updatedAt = Date.now()
    this.save()
  }

  async clear(dshSessionId: string): Promise<void> {
    const agent = this.live.get(dshSessionId)
    this.live.delete(dshSessionId)
    this.meta.delete(dshSessionId)
    this.save()
    if (agent) {
      try {
        await agent[Symbol.asyncDispose]()
      } catch {
        try { agent.close() } catch { /* */ }
      }
    }
  }

  async disposeAll(): Promise<void> {
    const ids = [...this.live.keys()]
    for (const id of ids) await this.clear(id)
  }
}
