/**
 * Thin wrapper around @cursor/sdk local Agent create / resume / send.
 *
 * Uses JsonlLocalAgentStore (not the default SQLite backend) so a disposed /
 * shared sqlite handle cannot surface as "database is not open" mid-chat.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  Agent,
  CursorAgentError,
  JsonlLocalAgentStore,
  type SDKAgent,
  type RunResult,
} from '@cursor/sdk'

export interface BridgeClientConfig {
  apiKey: string
  cwd: string
  model: string
  timeoutMs: number
  maxReplyChars: number
  /** Directory for JsonlLocalAgentStore files. */
  agentStoreDir: string
}

export interface AskResult {
  agentId: string
  runId: string
  status: string
  text: string
  error?: string
  kind: 'ok' | 'run_error' | 'startup_error' | 'timeout'
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n…(truncated, ${text.length} chars total)`
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms`)), ms)
    promise.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}

export function isClosedDbError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /database is not open/i.test(msg)
}

export class CursorBridgeClient {
  private readonly store: JsonlLocalAgentStore

  constructor(private readonly config: BridgeClientConfig) {
    mkdirSync(config.agentStoreDir, { recursive: true })
    this.store = new JsonlLocalAgentStore(config.agentStoreDir)
  }

  resolveApiKey(override?: string): string {
    const key = (override ?? this.config.apiKey ?? process.env.CURSOR_API_KEY ?? '').trim()
    if (!key) {
      throw new Error(
        '缺少 CURSOR_API_KEY：在 https://cursor.com/dashboard/integrations 创建后 export，或写入插件 config.apiKey',
      )
    }
    return key
  }

  private localOpts(cwd: string) {
    return {
      cwd,
      settingSources: [] as [],
      store: this.store,
    }
  }

  async createAgent(opts: { cwd: string; name?: string }): Promise<SDKAgent> {
    const apiKey = this.resolveApiKey()
    return Agent.create({
      apiKey,
      model: { id: this.config.model },
      name: opts.name ?? 'dsh-cursor-bridge',
      local: this.localOpts(opts.cwd),
    })
  }

  async resumeAgent(agentId: string, cwd: string): Promise<SDKAgent> {
    const apiKey = this.resolveApiKey()
    return Agent.resume(agentId, {
      apiKey,
      model: { id: this.config.model },
      local: this.localOpts(cwd),
    })
  }

  async send(
    agent: SDKAgent,
    message: string,
  ): Promise<{ runId: string; result: RunResult }> {
    const run = await agent.send(message)
    const result = await withTimeout(
      run.wait(),
      this.config.timeoutMs,
      `cursor-run ${run.id}`,
    )
    return { runId: run.id, result }
  }

  formatResult(agentId: string, runId: string, result: RunResult): AskResult {
    const raw = (result.result ?? '').trim()
    const text = clip(raw || (result.error?.message ?? ''), this.config.maxReplyChars)
    if (result.status === 'finished') {
      return { agentId, runId, status: result.status, text, kind: 'ok' }
    }
    return {
      agentId,
      runId,
      status: result.status,
      text: text || `run ${result.status}`,
      error: result.error?.message ?? result.status,
      kind: 'run_error',
    }
  }

  wrapStartupError(err: unknown): AskResult {
    if (err instanceof CursorAgentError) {
      return {
        agentId: '',
        runId: '',
        status: 'startup_error',
        text: '',
        error: `${err.name}: ${err.message}${err.isRetryable ? ' (retryable)' : ''}`,
        kind: 'startup_error',
      }
    }
    const msg = err instanceof Error ? err.message : String(err)
    const kind = /timed out/i.test(msg) ? 'timeout' as const : 'startup_error' as const
    return {
      agentId: '',
      runId: '',
      status: kind,
      text: '',
      error: msg,
      kind,
    }
  }
}

/** Default agent-store path under the bridge state dir. */
export function defaultAgentStoreDir(stateDir: string): string {
  return join(stateDir, 'agent-jsonl')
}
