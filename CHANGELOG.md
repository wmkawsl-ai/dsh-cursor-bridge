# Changelog

## Unreleased

- local Agent 改用 `JsonlLocalAgentStore`，避免默认 SQLite 出现 `database is not open`
- `cursor_ask` / `followup` 在库关闭时自动清会话并提示重开

## 0.1.0-preview.0

- 首版：DSH 工具 `cursor_ask` / `cursor_followup` / `cursor_status` / `cursor_close`
- 本机 local Cursor Agent（`@cursor/sdk`），`CURSOR_API_KEY` 鉴权
- 按 DSH session 绑定 agentId，落盘 `~/.dsh/cursor-bridge/sessions.json`
