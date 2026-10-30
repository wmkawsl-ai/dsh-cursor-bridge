# dsh-cursor-bridge

让 **DSH 里的 AI** 通过工具呼叫本机 **Cursor Agent**（[`@cursor/sdk`](https://cursor.com/docs/sdk/typescript)）。

这不是 Cursor IDE 聊天窗口同步，而是 SDK 起的 local Agent（对着某个 `cwd` 干活）。

## 能力

| 工具 | 作用 |
|------|------|
| `cursor_ask` | 新建或复用绑定 Agent，发一条消息 |
| `cursor_followup` | 对已绑定 Agent 追问 |
| `cursor_status` | 查看绑定状态 |
| `cursor_close` | dispose 并解绑 |

## 要求

- Node ≥ 24.9（与 harness 一致）
- DeepSeek Harness（Cordis 插件加载）
- **Cursor API Key**：[Dashboard → Integrations](https://cursor.com/dashboard/integrations)

```bash
export CURSOR_API_KEY='cursor_...'
```

本包装有依赖：在插件目录执行过 `npm install`（已含 `@cursor/sdk`）。

## 加载

**推荐**：日常用启动器默认组合 [`dsh-boot-launcher/cordis.default.yml`](../dsh-boot-launcher/cordis.default.yml)（engram + drive + 本插件）。  
仅要「记忆 + Cursor 桥、不要 drive」时用本目录的 `cordis.with-engram.yml`：

```bash
export CURSOR_API_KEY='cursor_...'
bash /home/tssh/test/Memory/dsh-boot-launcher/start.sh
```

仅 bridge / 手动 patch：

```bash
cd /home/tssh/work/deepseek-harness
export CURSOR_API_KEY='cursor_...'
pnpm dsh web --patch /home/tssh/test/Memory/dsh-cursor-bridge/cordis.yml --no-open
# 或合并：
pnpm dsh web --patch /home/tssh/test/Memory/dsh-cursor-bridge/cordis.with-engram.yml --no-open
```

启动日志应出现：`[dsh-cursor-bridge] ready — tools: cursor_ask/followup/status/close`。

## 配置（`cordis.yml`）

| 项 | 默认 | 说明 |
|----|------|------|
| `apiKey` | `''` | 空则读 `CURSOR_API_KEY` |
| `cwd` | `''` | 空则 session cwd / `process.cwd()` |
| `model` | `composer-2.5` | local 必填 |
| `timeoutMs` | `600000` | 单次 run 等待上限 |
| `maxReplyChars` | `8000` | 回灌 DSH 的文本截断 |
| `stateDir` | `''` | 空 → `~/.dsh/cursor-bridge` |

## Smoke

1. 设好 `CURSOR_API_KEY`，`--patch` 启动，确认日志 `ready` 且 `apiKey=set`。
2. 在 DSH 说：「用 cursor_ask 问 Cursor：用一句话列出当前 cwd 顶层有什么」。
3. 期望工具返回 `status=finished` 与非空正文；再追问一次应走 `cursor_followup`。
4. `cursor_close` 后再 followup 应提示没有绑定。

## 目录

```text
dsh-cursor-bridge/
├── src/
│   ├── index.ts      # Cordis 插件入口
│   ├── client.ts     # Agent create/resume/send
│   ├── session.ts    # DSH session ↔ agentId
│   └── tools.ts
├── cordis.yml
├── cordis.example.yml
├── cordis.with-engram.yml
└── README.md
```
