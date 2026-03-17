# Project Plan - Magnum SSH Dash

## 1. Goal
Build a web-based terminal control panel for macOS localhost to run multiple Claude/Codex CLI sessions concurrently, with secure file upload/download, and expose it via Cloudflare Zero Trust Tunnel.

## 2. Scope (v1)
- Localhost terminal/session management only (no remote host inventory)
- `tmux + node-pty` session runtime
- Browser terminal with Xterm.js
- Whitelisted file browser/upload/download
- Cloudflare Access + local bootstrap secret token flow
- macOS launchd deployment assets

## 3. Architecture
- Backend: Node.js + Express + Socket.io
- Terminal transport: WebSocket to PTY attached to tmux sessions
- Frontend: Static HTML + Tailwind + Xterm.js
- Auth: `POST /api/auth/token` -> short-lived HMAC token
- Files: path normalization + allowed roots enforcement

## 4. Delivery Phases
1. MVP terminal runtime and session APIs
2. File APIs and policy guards
3. UX improvements for quick-start agent sessions
4. Deployment bundle (launchd + cloudflared template)

## 5. Security Baseline
- Require Cloudflare Access identity header in production
- Require local bootstrap secret for token issuance
- Enforce allowed roots for all file operations
- Reject unauthorized WS and REST calls

## 6. Validation
- Unit tests for token verification and file path guard
- Manual e2e: create session, attach terminal, run command, upload/download file
