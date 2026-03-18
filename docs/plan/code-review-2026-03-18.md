# Magnum SSH Dash Code Review

Date: 2026-03-18
Reviewer: Codex
Scope: Full code re-review after latest local updates

## Summary

Core terminal usability is currently blocked by WebSocket protocol mismatches between frontend and backend. Security/session consistency also has critical gaps that can cause login failure after username/password changes.

## Findings (Ordered by Severity)

### P0-1: WebSocket attach contract mismatch causes attach failure

- File: `src/server.ts:839`
- File: `src/terminal-ws.ts:68`
- Issue:
  - `server.ts` stores `sessionId` in `socket.data` when handling `terminal:attach`.
  - `attachTerminalSocket` reads `sessionId` from `handshake.query/auth` instead.
  - Result: attach may fail or disconnect immediately.
- Impact: Directly causes WebSocket terminal unusable state.

### P0-2: WebSocket message schema mismatch causes no input/no output

- File: `public/index.html:550`
- File: `public/index.html:433`
- File: `public/index.html:485`
- File: `src/terminal-ws.ts:102`
- File: `src/terminal-ws.ts:109`
- File: `src/terminal-ws.ts:132`
- Issue:
  - Frontend listens on `terminal:data`, backend emits `terminal:output`.
  - Frontend sends input `{ data, seq }`, backend expects `{ type: "input", data }`.
  - Frontend sends resize `{ c, r }`, backend expects `{ type: "resize", cols, rows }`.
- Impact: Terminal appears connected but cannot type or receive output correctly.

### P0-3: Username/password change flow breaks auth consistency

- File: `src/server.ts:287`
- File: `src/server.ts:313`
- File: `src/server.ts:323`
- File: `src/auth.ts:37`
- File: `src/config.ts:27`
- Issue:
  - Login verification reads in-memory `appConfig.users`.
  - Change-password/change-username endpoints write `credentials.json` but do not update in-memory users.
  - Re-login may fail until service restart.
  - `change-username` uses default object with `password` (plaintext field) instead of `passwordHash`.
- Impact: High risk of lockout and inconsistent credential behavior.

### P1-1: Socket ticket secret fallback is weak

- File: `src/config.ts:74`
- File: `src/auth.ts:172`
- Issue:
  - `LOCAL_BOOTSTRAP_SECRET` defaults to `change-me`.
  - Predictable secret undermines ticket signing trust.
- Impact: Potential ticket forgery risk if default left unchanged.

### P1-2: Mobile settings payloads do not match backend schema

- File: `public/mobile.html:923`
- File: `public/mobile.html:950`
- File: `src/server.ts:314`
- File: `src/server.ts:288`
- Issue:
  - Mobile sends `username/password`.
  - Backend expects `newUsername/newPassword`.
- Impact: Mobile username/password updates always fail.

### P2-1: Restored tool preset misses `openclaw`

- File: `src/session-manager.ts:26`
- Issue:
  - `isToolPreset` excludes `openclaw`.
  - Restored sessions can be downgraded to `shell` unexpectedly.
- Impact: Incorrect restored metadata and UX confusion.

### P2-2: Test coverage misses WS event contract and terminal E2E

- File: `test/server-api.test.ts:45`
- Issue:
  - Tests validate API basics but not WS attach/input/resize/output contract.
- Impact: Protocol regressions pass CI undetected.

## Repro Symptoms Mapping

- Symptom: "WebSocket connected but terminal cannot type"
  - Mapped to: P0-1 + P0-2
- Symptom: "No output even when session exists"
  - Mapped to: P0-2
- Symptom: "Password/username changed but login fails"
  - Mapped to: P0-3

## Recommended Plan Inputs for Next Agent

1. Unify WS protocol contract in one shared schema (server + all frontends).
2. Fix attach path to read `sessionId` from event payload or consistent runtime context.
3. Align terminal events (`terminal:data` vs `terminal:output`) and input/resize payload shape.
4. Refactor credential updates to update source-of-truth and in-memory state atomically.
5. Require non-default bootstrap secret in production.
6. Add WS integration tests and minimum browser-flow smoke tests.

## Validation Note

- Local automated tests executed: `npm test --silent`
- Result: `7 passed`, `3 skipped`
- Caveat: Current suite does not validate WebSocket terminal contract, so critical terminal issues still pass.
