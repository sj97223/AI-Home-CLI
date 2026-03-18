## Magnum SSH Dash — Voltagent-Core-Dev Working Plan (SWIFT)

### Summary
目标是一次性完成 4 类交付：
1) 终端输入改为“终端原生编辑优先”，同时修复 WebSocket 主链路；
2) 账户/密码/会话按最佳实践重构（Single Admin）；
3) 全量回归（含 mobile）并发布新版本与 release 注释；
4) 用多 subagents 并行执行，PM 用 SWIFT 记录全程。

已确认决策：
- Auth 模型：Single Admin
- 终端 UX：Both Visible（终端输入 + 命令框并存）
- 范围：Desktop + Mobile 同步交付

---

### SWIFT Project Management（PM 主导）
定义 SWIFT：
- S Scope & Success：范围/验收标准冻结
- W Workstreams：按子团队并行拆分
- I Interfaces：接口契约冻结与变更控制
- F Flow：里程碑节奏与依赖管理
- T Tracking & Tests：进度与分段验证闭环

PM 产物（强制）：
1. docs/swift/SWIFT_SCOPE.md：目标、范围、验收、风险、回滚
2. docs/swift/SWIFT_TRACKER.md：任务状态看板（Owner/ETA/依赖/阻塞）
3. docs/swift/SWIFT_VALIDATION.md：每个 subagent 的分段校验记录
4. docs/swift/RELEASE_NOTES_DRAFT.md：候选发布说明（持续更新）

---

### Workstreams（Voltagent-Core-Dev Subagents）
1. Agent-A: Terminal Core（WS+编辑体验）
- 把 src/terminal-ws.ts 接入 src/server.ts，WS 从 placeholder 变为主链路。
- 保留 HTTP fallback，但状态机改为统一：connecting/ready/degraded/stale/closed。
- 前端 desktop+mobile 都改为：xterm 原生输入为主；命令框作为可见辅助输入。
- 增加连接模式指示（WS/Fallback）和自动重连策略（指数退避、上限、stale 恢复）。

2. Agent-B: Security/Auth Session
- Single Admin 安全化：仅允许哈希密码存储与验证；移除 plain 回退。
- 会话安全：Cookie Secure/HttpOnly/SameSite 策略按部署模式强制；会话 TTL/刷新策略统一。
- 账户管理 API 审核与加固（改用户名/改密码流程、重登录机制、速率限制、错误语义）。
- 校验 credentials.json 与 env 优先级，避免明文路径绕过。

3. Agent-C: Cross-Platform UI (Desktop/Mobile)
- public/index.html 与 public/mobile.html 对齐终端行为、连接状态、错误反馈。
- 保留“命令输入框”但改为辅助，不再作为主路径依赖。
- 清理/替换已移除端点引用，避免前端调用死 API。

4. Agent-D: QA/Release
- 更新测试：WS attach/input/resize/reconnect，HTTP fallback，auth/session 安全回归。
- 更新版本与文档：package.json, README.md, README.zh-CN.md, CHANGELOG.md。
- 出 release gate 报告并准备 git push checklist（分支、tag、回滚说明）。

---

### Public Interfaces / Contract Changes
1. 终端接口（统一契约）
- WS：terminal:attach/input/resize/output/ack/stale
- HTTP fallback：保留 start/poll/input/resize/stop/reconnect，字段对齐 seq/ack/cursor/events
- 新增（建议）GET /api/terminal/status/:sessionId（对外只暴露安全状态，不暴露内部敏感调试细节）

2. 安全接口
- 登录/改密/改用户名接口统一错误码与审计日志格式
- 生产默认强安全 cookie 策略，开发需显式降级开关

3. 版本与发布
- 版本从 1.10.0 升到 1.11.0
- 引入 CHANGELOG.md（本次 breaking/non-breaking 说明）

---

### Validation & Acceptance
分三层验收：
1. Agent 分段验收（每个 agent 两阶段）
- Stage-1: 静态契约/代码检查
- Stage-2: 功能链路验证（含失败恢复）
- 必须写入 SWIFT_VALIDATION.md

2. 集成验收（Main Agent）
- Desktop + Mobile: 登录 -> 创建会话 -> 终端输入 -> 重连 -> 文件操作
- WS 主链路可用，HTTP fallback 可降级可恢复
- 安全回归：密码更新后旧会话失效、重登成功、cookie 策略正确

3. 发布验收
- npm run build / npm test / release-check 通过
- 生成 release notes + git push checklist（含回滚步骤）

---

### Comparison vs .claude/plans/cached-tumbling-manatee.md
对方计划优点：
1. 结构清晰，覆盖了终端/安全/文档/多 agent 分工
2. 版本号与文档更新意识到位
3. 已识别 mobile 缺口与多端一致性需求

对方计划不足：
1. 偏任务罗列，缺少统一终端协议与状态机定义（实现时仍会临场决策）
2. WebSocket 方案只提“重连参数”，没有把 WS 从 placeholder 改为真实主链路的实现闭环
3. 安全部分缺少会话策略、错误语义、发布门禁的可执行验收标准
4. PM 跟踪没有标准化框架（缺少 SWIFT 的阶段门与证据要求）

本计划优势：
1. 决策更完整：已锁定 auth 模型、终端 UX 模式、desktop+mobile 范围
2. 可直接执行：给出 SWIFT 产物、子 agent 职责、接口契约、验收路径
3. 风险可控：把 WS 主链路、HTTP fallback、安全改造放入统一状态机与发布门禁
4. 交付可追溯：每个子 agent 强制分段校验并沉淀到统一记录文件
