# Magnum SSH Dash - 综合执行计划 v1.11.0

## 概述

结合 SWIFT PM 框架、WebSocket 重构方案和当前开发进度，制定本执行计划。

---

## 一、已识别问题 (From websocket-rearchitecture-plan.md)

### 核心问题
1. **Runtime/Session 紧耦合**: 终端运行时依赖瞬态 socket 上下文
2. **WebSocket 不稳定**: 立即断开、无法输入、需要回退到 HTTP
3. **状态机不统一**: 缺少明确定义的状态转换

### 根因分析需求
- 添加端到端 trace id
- 标准化错误分类
- 失败路径矩阵

---

## 二、执行计划 (查漏补缺)

### Phase 1: 根因分析与可观测性 (先行)

| 任务 | 文件 | 优先级 |
|------|------|--------|
| 添加终端状态 API | src/server.ts | P0 |
| 标准化错误码 | src/terminal-ws.ts | P0 |
| 添加 trace/log | 全部 | P1 |

### Phase 2: WebSocket 核心修复

| 任务 | 文件 | 优先级 |
|------|------|--------|
| 启用 WS 自动重连 | public/index.html, mobile.html | ✅ 已完成 |
| 延长超时时间 | 同上 | ✅ 已完成 |
| 状态机文档化 | 内存/注释 | P1 |

### Phase 3: 安全加固

| 任务 | 文件 | 优先级 |
|------|------|--------|
| 强制 scrypt 哈希 | src/auth.ts, config.ts | ✅ 已完成 |
| 密码强度验证 | src/server.ts | ✅ 已完成 |
| Cookie 安全配置 | src/server.ts | ❌ 缺失 |
| 速率限制 | src/server.ts | ❌ 缺失 |

### Phase 4: 移动端对齐

| 任务 | 文件 | 优先级 |
|------|------|--------|
| 文件下载 | public/mobile.html | ✅ 已完成 |
| 会话重命名 | public/mobile.html | ✅ 已完成 |
| 状态指示器 | public/mobile.html | ✅ 已完成 |

### Phase 5: PM 文档

| 任务 | 文件 | 优先级 |
|------|------|--------|
| SWIFT_SCOPE.md | docs/swift/ | ❌ 缺失 |
| SWIFT_TRACKER.md | docs/swift/ | ❌ 缺失 |
| SWIFT_VALIDATION.md | docs/swift/ | ❌ 缺失 |
| RELEASE_NOTES_DRAFT.md | docs/swift/ | ❌ 缺失 |

### Phase 6: 发布准备

| 任务 | 文件 | 优先级 |
|------|------|--------|
| 版本 1.11.0 | package.json | ✅ 已完成 |
| CHANGELOG.md | 根目录 | ✅ 已完成 |
| README 更新 | README.md | ✅ 已完成 |

---

## 三、Agent 协同执行方案

### 使用 TeamCreate + Agent 工具

```typescript
// 1. 创建团队
TeamCreate({
  team_name: "voltagent-core-dev",
  description: "Magnum SSH Dash v1.11.0 开发团队"
})

// 2. 创建任务
TaskCreate({ subject: "Agent-1: WebSocket 核心修复", ... })
TaskCreate({ subject: "Agent-2: 安全加固", ... })
TaskCreate({ subject: "Agent-3: PM 文档", ... })

// 3. 并行启动 Agent
Agent({
  name: "terminal-agent",
  subagent_type: "general-purpose",
  prompt: "..."
})

Agent({
  name: "security-agent",
  subagent_type: "general-purpose",
  prompt: "..."
})

Agent({
  name: "pm-agent",
  subagent_type: "general-purpose",
  prompt: "..."
})
```

### 推荐并行度

| 阶段 | Agent 数量 | 说明 |
|------|-----------|------|
| Phase 1-2 | 2-3 | WebSocket + 安全可并行 |
| Phase 3-4 | 1-2 | 移动端 + 文档 |
| Phase 5 | 1 | PM 文档串行 |

---

## 四、验收标准 (From websocket-rearchitecture-plan.md)

1. **新建会话**: 2秒内显示 shell 提示符，输入输出正常工作
2. **重连恢复**: 刷新/网络中断后 10 秒内通过 sessionId 恢复
3. **并发会话**: 3 个并发会话 (claude/codex/gemini) 独立运行 30 分钟无串台

---

## 五、关键文件清单

### 待修改
- `src/server.ts` - 终端状态 API, Cookie 安全, 速率限制
- `src/terminal-ws.ts` - 错误码标准化
- `public/mobile.html` - 状态机文档
- `docs/swift/SWIFT_SCOPE.md` - 新建
- `docs/swift/SWIFT_TRACKER.md` - 新建
- `docs/swift/SWIFT_VALIDATION.md` - 新建
- `docs/swift/RELEASE_NOTES_DRAFT.md` - 新建

### 已完成
- ✅ `public/index.html` - WS 优化 + 命令历史
- ✅ `public/mobile.html` - 功能对齐
- ✅ `src/auth.ts` - 密码安全
- ✅ `src/config.ts` - 哈希支持
- ✅ `package.json` - 1.11.0
- ✅ `CHANGELOG.md` - 新建

---

## 六、执行顺序

1. **首先**: 创建 PM 文档结构
2. **并行**: Agent-1 (WS 修复) + Agent-2 (安全)
3. **串行**: Agent-3 (PM 文档)
4. **最后**: 集成验证 + 发布
