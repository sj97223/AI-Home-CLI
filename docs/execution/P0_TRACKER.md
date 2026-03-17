# P0 任务跟踪（执行中）

更新时间：2026-03-17
状态枚举：`NotStarted` / `InProgress` / `Blocked` / `Review` / `Done`

## 1. 任务拆解

| ID | 任务 | Owner | 状态 | 预计完成时间 | 依赖 | 验收标准 |
|---|---|---|---|---|---|---|
| P0-ARCH-01 | 定义 P0 协议与边界（seq/ack/cursor/reconnect） | ArchitectAgent | Done | 2026-03-17 | 无 | 形成可执行建议并被后端/前端采纳 |
| P0-BE-01 | input ack + seq 幂等 + 错误码映射 | BackendAgent | Done | 2026-03-17 | P0-ARCH-01 | input 返回 `acceptedSeq`，并区分 400/404/409/502 |
| P0-BE-02 | poll cursor/events/nextCursor（兼容 chunks） | BackendAgent | Done | 2026-03-17 | P0-BE-01 | poll 返回 `cursor,nextCursor,events`，旧字段兼容 |
| P0-BE-03 | reconnect 端点 + keepalive 刷新 runtime TTL | BackendAgent | Done | 2026-03-17 | P0-BE-01 | reconnect 可返回新 terminalId，keepalive 可延长 runtime |
| P0-BE-04 | resize 落地到 tmux | BackendAgent | Done | 2026-03-17 | P0-BE-01 | resize 调用触发 tmux resize-window |
| P0-FE-01 | 统一输入发送器 + seq/ack 消费 | FrontendAgent | Done | 2026-03-17 | P0-BE-01 | 输入路径统一，ack 可清理 pending seq |
| P0-FE-02 | poll 切 cursor/events 并保留 chunks 兜底 | FrontendAgent | Done | 2026-03-17 | P0-BE-02 | 前端能消费 events，兼容旧 chunks |
| P0-FE-03 | stale/not_found 自动 reconnect + 重试一次 | FrontendAgent | Done | 2026-03-17 | P0-BE-03 | 遇 409/404 相关错误可自动恢复 |
| P0-FE-04 | 修正 reconnect API 路径为 `/terminal/http/reconnect` | MainAgent | Done | 2026-03-17 | P0-FE-03 | 实际请求命中后端 reconnect 端点 |
| P0-DOC-01 | 落地 PLAN/TRACKER/VALIDATION 三文档 | MainAgent | Done | 2026-03-17 | 无 | docs/execution 三文件存在且内容可执行 |
| P0-VAL-01 | 分段校验记录回填（各 agent + 主集成） | MainAgent | Done | 2026-03-17 | 全部任务 | `P0_VALIDATION.md` 填写完整并可追溯 |

## 2. 当前阻塞/风险

| 日期 | 阻塞/风险 | 影响 | Owner | 处理动作 | 状态 |
|---|---|---|---|---|---|
| 2026-03-17 | 当前沙箱无法做真实 tmux I/O 端到端回放 | 无法在本沙箱证明实时输入回显 | MainAgent | 用 build/test + 协议静态验证 + 你本机验证脚本补齐 | InProgress |

## 3. 跟进事项（Next Follow-ups）

1. P1-FUP-01：实现 WS 真正输入输出链路（替代 placeholder attach）。
2. P1-FUP-02：新增 `terminal/status` 端点与更细粒度 runtime 指标。
3. P1-FUP-03：补 `test/session-manager.test.ts` 和 HTTP input/reconnect 集成测试。
4. P1-FUP-04：提供一键 smoke 脚本（创建会话->输入->重连->验证 ack）。
