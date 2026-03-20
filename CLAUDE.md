# Magnum SSH Dash — Project Context

## Overview
Web-based multi-session CLI/SSH control panel for macOS localhost with mobile support.

## Tech Stack
- **Backend:** Node.js, Express, Socket.IO, tmux
- **Frontend:** Vanilla JS, Tailwind CSS (CDN), xterm.js
- **Auth:** Cookie-based sessions with scrypt hashing

## Architecture
- `src/server.ts` — Main Express + Socket.IO server
- `src/routes/` — API routes (auth, sessions, files, options)
- `src/services/` — Business logic (terminal-http.ts)
- `src/middleware/` — Error handling
- `public/` — Static files (index.html, mobile.html)

## Design System
Always read DESIGN.md before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.

## Key Features
- WebSocket real-time terminal
- HTTP polling fallback
- Session management with tmux
- File upload/download
- Mobile-responsive UI
