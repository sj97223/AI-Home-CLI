# WebSocket Re-architecture Plan (No-Execution)

Date: 2026-03-18
Project: Magnum SSH Dash
Scope: Planning only, no code execution

## 1) Executive Summary

Current failures (`websocket_runtime_unavailable_use_http_fallback`, immediate disconnect after connect, terminal not accepting input) strongly suggest a combined issue:

- Runtime/session state is tightly coupled to a transient socket context
- Proxy/tunnel WebSocket chain is not consistently aligned

Best practice is to stop patching symptom-by-symptom and do a transport/session decoupling redesign.

## 2) Target Architecture (Best Practice)

1. Terminal Runtime is an independent session service (tmux/pty manager), not dependent on any single socket attachment.
2. WebSocket Gateway is stateless and only handles bidirectional stream relay.
3. Session metadata is stored in shared storage (Redis/DB) for reconnect/resume reliability.
4. WebSocket is the primary interactive channel; HTTP fallback is read-only diagnostics/log stream.
5. Cloudflare Zero Trust handles edge access; app session/auth remains minimal and explicit.

## 3) Phased Plan

### Phase A: Root Cause + Observability

- Add end-to-end trace id: `create_session -> runtime_start -> ws_attach -> input -> output`
- For every attach, log: `sessionId`, `runtimeId`, `nodePid`, `adapterInstanceId`, `transport`
- Standardize error taxonomy:
  - `RUNTIME_NOT_FOUND`
  - `WS_UPGRADE_FAILED`
  - `AUTH_COOKIE_MISSING`
  - `PROXY_WS_BLOCKED`
- Deliverable: failure path matrix with reproducible scenarios

### Phase B: Session Layer Refactor (Core)

- Introduce `SessionRegistry` in shared storage
  - Mapping: `sessionId <-> runtimeId`
  - Runtime ownership + heartbeat + TTL policy
- Explicit state machine:
  - `CREATED -> STARTING -> RUNNING -> DETACHED -> CLOSED -> ERROR`
- Remove coupling: socket disconnect must not auto-destroy runtime
- Add resume contract: attach by `sessionId`, restore stream and buffered output

### Phase C: WebSocket Channel Governance

- Choose one protocol stack and keep it consistent (Socket.IO or native ws, not mixed)
- If Socket.IO retained:
  - First validate websocket-only mode
  - Re-enable polling only if required and verified
- Freeze namespace/path (example: `/terminal/ws`) and keep FE/BE/proxy identical
- Add heartbeat/reconnect/backoff with auto-resume by `sessionId`

### Phase D: Proxy + Cloudflare Alignment

- Validate `Upgrade` and `Connection` header passthrough
- Validate Access + cookie domain/path/SameSite/Secure interactions
- PM2 rollout strategy:
  - Single instance verification first
  - Multi-instance only with sticky session + Redis adapter
- Deliver two acceptance scripts:
  - Local direct access
  - Cloudflare tunnel path

### Phase E: Terminal UX Reliability

- Input model: true terminal editing (char stream + local echo + server ack)
- On attach: auto-focus + fit + prompt probe; if no output, show diagnostics panel
- Session create form includes: `host/user/port/cwd/shell`
- Session list supports: create, start, resume, close, metadata visibility

### Phase F: Security + Release Readiness

- Auth/session hardening:
  - strong hash (bcrypt/argon2)
  - bounded session lifetime
  - CSRF + rate limit + brute-force controls
- Regression matrix:
  - multi-tab concurrency
  - reconnect/resume
  - 30-minute keepalive
  - tunnel remote access
- Release artifacts:
  - version bump
  - release notes
  - rollback notes

## 4) Solution Options

### Option 1 (Recommended)

`Socket.IO + Redis adapter + tmux runtime`

Pros:
- Strong reconnect/resume behavior
- Better fit for long-lived CLI tabs and keepalive sessions
- Easier scale-out path

Tradeoff:
- More infra moving parts (Redis + adapter)

### Option 2

`Native WebSocket + custom multiplex protocol + pty`

Pros:
- Lower dependency surface
- Full protocol control

Tradeoff:
- Higher engineering complexity for reconnect and state recovery

## 5) Acceptance Criteria

1. New session shows shell prompt within 2 seconds; typing/input/output works immediately.
2. Refresh/network interruption can resume within 10 seconds by `sessionId`.
3. Under Cloudflare Tunnel, attach success rate > 99% across 100 attempts.
4. Three concurrent sessions (claude/codex/gemini) run independently for 30 minutes without stream crossover.

## 6) Non-Execution Statement

This document is planning-only and does not perform any implementation changes by itself.
