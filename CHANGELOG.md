# Changelog

All notable changes to this project will be documented in this file.

## [1.13.2] - 2026-03-18

### Bug Fixes
- Fixed HTTP terminal stale loop by resetting seq after reconnect
- Removed inputCooldown that was blocking user input
- Added clearing of pending inputs in reconnect to prevent retry loop
- Modified sendInputForState to not retry input after reconnect triggers
- Fixed WebSocket attach sessionId in handshake.auth for HTTP fallback

### Features
- Added manual WS/HTTP mode switching buttons

### Architecture Refactoring
- Extracted routes to src/routes/ directory (auth, sessions, files, options)
- Added src/middleware/error-handler.ts with global error handling
- Added notFoundHandler middleware
- Phase 1 complete: server.ts reduced from ~1000 lines to ~720 lines
- Extracted HTTP terminal to src/services/terminal-http.ts
- server.ts further reduced to ~650 lines

### Performance
- Heartbeat interval increased from 2s to 5s to reduce tmux pressure

### Security
- Documented CSP unsafe-inline requirement (TODO: add nonce support)

## [1.13.1] - 2026-03-18

### Bug Fixes
- Fixed socket event log timestamp to use local timezone instead of UTC
- Fixed HTTP poll error spam when mode already switched
- Fixed input causing infinite reconnection loop when switching modes
- Added reconnecting flag and input cooldown to prevent reconnection storms
- Added 401 auth error handling to stop polling instead of retrying
- Added stale event skip when already reconnecting or in cooldown
- Split reconnectTerminal into reconnectWsTerminal and reconnectHttpTerminal
- Fixed WS stale triggering HTTP reconnect (now uses correct path)
- Added stale auto-recovery (auto reconnect after 1s without user input)
- Server now rejects duplicate attach with DUPLICATE_ATTACH error
- HTTP button now directly switches to HTTP mode without trying WS first

### Features
- Added WS switch button to manually switch back to WebSocket mode
- Added i18n support for SSH mode, quick create buttons, logged in status
- Added i18n support for SSH user placeholder, pin window, fullscreen, clear buttons

### Mobile Improvements
- Added same reconnect logic to mobile.html
- Added terminal:stale handler to mobile.html
- Added forceWs/forceHttp options to mobile openSessionTerminal

### Code Quality
- Added src/terminal-state.ts with TerminalState enum

## [1.13.0] - 2026-03-18

### Features
- Added English/Chinese language toggle
- Added Dark/Light theme toggle

### Terminal State Machine Improvements
- Added unified terminal state enum: idle -> connecting -> attached_ws/http -> stale -> reconnecting -> closed
- Added cleanup of old listeners before re-attaching (prevents duplicate handlers)
- Fixed stale event being sent to self (now excludes current socket)
- Added terminal:stale handler in frontend to properly update UI state
- Fixed HTTP poll 409 error handling to trigger reconnection
- Changed timeout to use lastActivityAt (input OR output) instead of just lastInputAt

### Bug Fixes (from v1.12.0)
- Fixed WebSocket attach contract mismatch
- Fixed WebSocket message schema mismatch
- Fixed login invalidation after password/username change
- Fixed tool preset missing "openclaw" in restore detection
- Fixed SSH auto mode sending invalid command to terminal

### Security
- Removed default weak value for LOCAL_BOOTSTRAP_SECRET

## [1.12.0] - 2026-03-18

### Bug Fixes
- Fixed WebSocket attach contract mismatch (sessionId storage location)
- Fixed WebSocket message schema mismatch (input/resize/output events)
- Fixed login invalidation after password/username change
- Fixed tool preset missing "openclaw" in restore detection
- Fixed SSH auto mode sending invalid command to terminal

### Terminal State Machine Improvements
- Added unified terminal state enum: idle -> connecting -> attached_ws/http -> stale -> reconnecting -> closed
- Added cleanup of old listeners before re-attaching (prevents duplicate handlers)
- Fixed stale event being sent to self (now excludes current socket)
- Added terminal:stale handler in frontend to properly update UI state
- Fixed HTTP poll 409 error handling to trigger reconnection
- Changed timeout to use lastActivityAt (input OR output) instead of just lastInputAt

### Security
- Removed default weak value for LOCAL_BOOTSTRAP_SECRET
- Fixed mobile settings API payload field names (newUsername/newPassword)

### Features
- Added HTTP/WebSocket mode switch button for terminal connection
- Improved HTTP/WebSocket mode switching with better state cleanup

## [1.11.0] - 2026-03-18

### WebSocket
- WebSocket optimization: enable automatic reconnection for stable terminal connections

### Terminal
- Added command history navigation with up/down arrow keys

### Mobile
- Added file download support for mobile devices
- Added session rename functionality
- Added status indicators for connection state

### Security
- Removed plaintext password support
- Enforced scrypt password hashing for all authentication

## [1.10.0] - (Previous Release)

- Initial release / Previous features
