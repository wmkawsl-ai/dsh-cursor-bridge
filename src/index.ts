/**
 * dsh-cursor-bridge — call a local Cursor Agent from DSH via tools.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { CursorBridgeClient, defaultAgentStoreDir } from './client.ts'
import { SessionStore } from './session.ts'
import { registerCursorTools } from './tools.ts'

export const name = 'dsh-cursor-bridge'
export const inject = ['tools']

export interface Config {
  /** Explicit API key; empty → CURSOR_API_KEY env. */
  apiKey: string
  /** Default local Agent cwd when session has none. */
  cwd: string
  /** Model id for local Agent (required by SDK). */
  model: string
  /** Per-run wait timeout. */
  timeoutMs: number
  /** Truncate assistant text returned to DSH. */
  maxReplyChars: number
  /** Where to persist session→agentId bindings. Empty → ~/.dsh/cursor-bridge */
  stateDir: string
}

export const Config: Schema<Config> = Schema.object({
  apiKey: Schema.string().default(''),
  cwd: Schema.string().default(''),
  model: Schema.string().default('composer-2.5'),
  timeoutMs: Schema.number().default(600_000),
  maxReplyChars: Schema.number().default(8000),
  stateDir: Schema.string().default(''),
})

const TAG = '[dsh-cursor-bridge]'

function log(...args: unknown[]) {
  console.error(TAG, ...args)
}

export function apply(ctx: Context, config: Config) {
  const cwd = (config.cwd && config.cwd.trim())
    || process.cwd()
    || join(homedir())

  const stateDir = (config.stateDir && config.stateDir.trim())
    || join(homedir(), '.dsh', 'cursor-bridge')
  const agentStoreDir = defaultAgentStoreDir(stateDir)

  const client = new CursorBridgeClient({
    apiKey: config.apiKey,
    cwd,
    model: config.model || 'composer-2.5',
    timeoutMs: Math.max(30_000, config.timeoutMs || 600_000),
    maxReplyChars: Math.max(500, config.maxReplyChars || 8000),
    agentStoreDir,
  })
  const sessions = new SessionStore(stateDir)

  registerCursorTools(ctx, client, sessions, { cwd })

  ctx.effect(() => () => {
    void sessions.disposeAll().catch((e) => log('dispose error', e))
  })

  const keyHint = (config.apiKey?.trim() || process.env.CURSOR_API_KEY)
    ? 'apiKey=set'
    : 'apiKey=MISSING (set CURSOR_API_KEY)'
  log('ready — tools: cursor_ask/followup/status/close', {
    cwd,
    model: config.model,
    keyHint,
    agentStore: agentStoreDir,
  })
}
