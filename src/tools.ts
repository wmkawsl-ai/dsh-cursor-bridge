/**
 * DSH tools that talk to a local Cursor Agent.
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { isClosedDbError, type CursorBridgeClient } from './client.ts'
import type { SessionStore } from './session.ts'

function dshSessionId(exec: { agent?: { session?: { id?: string }; id?: string } }): string {
  return String(exec.agent?.session?.id ?? exec.agent?.id ?? 'unknown')
}

function sessionCwd(exec: { agent?: { session?: { header?: { cwd?: string } } } }, fallback: string): string {
  const cwd = exec.agent?.session?.header?.cwd
  return (cwd && cwd.trim()) || fallback
}

export function registerCursorTools(
  ctx: Context,
  client: CursorBridgeClient,
  sessions: SessionStore,
  defaults: { cwd: string },
) {
  ctx.tools.register(defineTool({
    name: 'cursor_ask',
    description:
      'Start or continue a local Cursor Agent conversation on a workspace directory (not the Cursor IDE chat UI). '
      + 'Use for repo questions, edits, or coding help via Cursor. '
      + 'Prefer this for a new topic; use cursor_followup for short follow-ups on the same agent.',
    parameters: {
      message: { type: 'string', required: true, description: 'Prompt for the Cursor Agent' },
      cwd: { type: 'string', description: 'Workspace path; default session cwd or plugin config' },
      fresh: { type: 'boolean', description: 'If true, close any bound agent and create a new one' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          agentId: { type: 'string', required: true },
          runId: { type: 'string', required: true },
          status: { type: 'string', required: true },
          text: { type: 'string', required: true },
          error: { type: 'string' },
          kind: { type: 'string', required: true },
        },
      },
      render: (_a, v) => [{
        type: 'text',
        text: v.kind === 'ok'
          ? `Cursor[${v.agentId.slice(0, 12)}…] ${v.status}\n${v.text}`
          : `Cursor 失败 (${v.kind}): ${v.error ?? v.status}`,
      }],
    },
    async execute(args, exec) {
      const sid = dshSessionId(exec)
      const cwd = (args.cwd?.trim() || sessionCwd(exec, defaults.cwd)).trim()
      const runOnce = async () => {
        if (args.fresh) await sessions.clear(sid)

        let agent = sessions.getLive(sid)
        const meta = sessions.getMeta(sid)

        if (!agent && meta?.agentId && meta.cwd === cwd) {
          try {
            agent = await client.resumeAgent(meta.agentId, cwd)
            sessions.setLive(sid, agent, cwd, meta.lastRunId)
          } catch (err) {
            // Stale agent id / closed store → start fresh
            if (!isClosedDbError(err)) throw err
            await sessions.clear(sid)
          }
        }
        if (!agent) {
          agent = await client.createAgent({ cwd, name: `dsh:${sid.slice(0, 24)}` })
          sessions.setLive(sid, agent, cwd)
        }

        const { runId, result } = await client.send(agent, String(args.message))
        sessions.touchRun(sid, runId)
        sessions.setLive(sid, agent, cwd, runId)
        return client.formatResult(agent.agentId, runId, result)
      }
      try {
        return await runOnce()
      } catch (err) {
        if (isClosedDbError(err)) {
          try {
            await sessions.clear(sid)
            return await runOnce()
          } catch (err2) {
            return client.wrapStartupError(err2)
          }
        }
        return client.wrapStartupError(err)
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'cursor_followup',
    description:
      'Send a follow-up to the Cursor Agent already bound to this DSH session. '
      + 'Fails if cursor_ask was never used (or after cursor_close).',
    parameters: {
      message: { type: 'string', required: true, description: 'Follow-up message' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          agentId: { type: 'string', required: true },
          runId: { type: 'string', required: true },
          status: { type: 'string', required: true },
          text: { type: 'string', required: true },
          error: { type: 'string' },
          kind: { type: 'string', required: true },
        },
      },
      render: (_a, v) => [{
        type: 'text',
        text: v.kind === 'ok'
          ? `Cursor follow-up ${v.status}\n${v.text}`
          : `Cursor follow-up 失败 (${v.kind}): ${v.error ?? v.status}`,
      }],
    },
    async execute(args, exec) {
      const sid = dshSessionId(exec)
      try {
        let agent = sessions.getLive(sid)
        const meta = sessions.getMeta(sid)
        if (!agent && meta?.agentId) {
          try {
            agent = await client.resumeAgent(meta.agentId, meta.cwd)
            sessions.setLive(sid, agent, meta.cwd, meta.lastRunId)
          } catch (err) {
            if (isClosedDbError(err)) {
              await sessions.clear(sid)
              return {
                agentId: '',
                runId: '',
                status: 'session_reset',
                text: '',
                error: 'Cursor Agent 会话已失效（database closed），请改用 cursor_ask 重新开始',
                kind: 'startup_error',
              }
            }
            throw err
          }
        }
        if (!agent || !meta) {
          return {
            agentId: '',
            runId: '',
            status: 'no_session',
            text: '',
            error: '没有绑定的 Cursor Agent，请先调用 cursor_ask',
            kind: 'startup_error',
          }
        }
        const { runId, result } = await client.send(agent, String(args.message))
        sessions.touchRun(sid, runId)
        return client.formatResult(agent.agentId, runId, result)
      } catch (err) {
        if (isClosedDbError(err)) {
          await sessions.clear(sid)
          return {
            agentId: '',
            runId: '',
            status: 'session_reset',
            text: '',
            error: 'Cursor Agent 会话已失效（database closed），请改用 cursor_ask 重新开始',
            kind: 'startup_error',
          }
        }
        return client.wrapStartupError(err)
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'cursor_status',
    description: 'Show the Cursor Agent binding for this DSH session (agentId, cwd, last run).',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          bound: { type: 'boolean', required: true },
          live: { type: 'boolean', required: true },
          agentId: { type: 'string' },
          cwd: { type: 'string' },
          lastRunId: { type: 'string' },
          updatedAt: { type: 'number' },
        },
      },
      render: (_a, v) => [{
        type: 'text',
        text: v.bound
          ? `Cursor 已绑定 agentId=${v.agentId} cwd=${v.cwd} live=${v.live} lastRun=${v.lastRunId ?? '-'}`
          : '当前 DSH 会话未绑定 Cursor Agent',
      }],
    },
    async execute(_args, exec) {
      const sid = dshSessionId(exec)
      const meta = sessions.getMeta(sid)
      const live = Boolean(sessions.getLive(sid))
      if (!meta) return { bound: false, live: false }
      return {
        bound: true,
        live,
        agentId: meta.agentId,
        cwd: meta.cwd,
        lastRunId: meta.lastRunId,
        updatedAt: meta.updatedAt,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'cursor_close',
    description: 'Dispose the Cursor Agent bound to this DSH session and clear the binding.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          closed: { type: 'boolean', required: true },
          agentId: { type: 'string' },
        },
      },
      render: (_a, v) => [{
        type: 'text',
        text: v.closed
          ? `已关闭 Cursor Agent ${v.agentId ?? ''}`
          : '没有可关闭的 Cursor Agent',
      }],
    },
    async execute(_args, exec) {
      const sid = dshSessionId(exec)
      const meta = sessions.getMeta(sid)
      if (!meta && !sessions.getLive(sid)) return { closed: false }
      const agentId = meta?.agentId
      await sessions.clear(sid)
      return { closed: true, agentId }
    },
  }))
}
