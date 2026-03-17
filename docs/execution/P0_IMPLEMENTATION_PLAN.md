# P0 实施计划（已落地版）

更新时间：2026-03-17
范围级别：P0（终端输入稳定性止血）

## 1. 本轮范围

- 目标：恢复“可输入、可回显、可重连”的终端基础能力。
- 覆盖模块：
  - 后端：`src/server.ts`、`src/session-manager.ts`
  - 前端：`public/index.html`
  - 过程文档：`docs/execution/*`
- 不在本轮：完整 WS runtime（P1/P2）。

## 2. 本轮里程碑

1. M1（协议止血）
- HTTP input 支持 `seq` + `acceptedSeq` ack。
- 错误码标准化：`invalid_payload`/`terminal_not_found`/`session_not_found`/`terminal_stale`/`tmux_send_failed`。

2. M2（恢复能力）
- 新增 `POST /api/sessions/:id/terminal/http/reconnect`。
- keepalive 刷新 terminal runtime TTL。
- resize 落到 tmux 生效。

3. M3（前端集成）
- 前端输入统一走 `sendInputForState`。
- poll 使用 `cursor/events/nextCursor`，保留 `chunks` 兼容。
- terminal stale/not found 自动重连并重试一次。

## 3. 风险与缓解

- 风险：HTTP fallback 仍是主链路，交互体验上限有限。
- 缓解：P1 开始实现 WS 主链路，HTTP 保留降级。

- 风险：tmux 在部分环境权限受限导致输入失败。
- 缓解：debug 输出 `lastError/lastInputAt/stale` 并保留 reconnect。

- 风险：前后端协议字段升级导致旧客户端不兼容。
- 缓解：poll 保留 `chunks`，start/reconnect 同时返回 `cursor/nextCursor`。

## 4. 回滚策略

- 回滚粒度：按文件回滚。
- 快速回滚点：
  - 前端：`public/index.html`（恢复旧输入链路）
  - 后端：`src/server.ts`（恢复旧 HTTP 通道）
  - 会话层：`src/session-manager.ts`（恢复旧 resize/input 行为）

## 5. 验收标准

1. 协议验收
- `POST /terminal/http/input` 返回 `200 { acceptedSeq }`。
- seq 重放幂等：重复 seq 不重复执行。
- seq 跳号返回 `409 terminal_stale`。

2. 运行验收
- stale/not_found 时前端自动 reconnect + 重试一次输入。
- resize 调用后终端布局变化可观察。

3. 质量验收
- `npm run build` 通过。
- `npm test` 通过。
- 分段校验结果记录在 `P0_VALIDATION.md`。
