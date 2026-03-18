# SWIFT Tracker - v1.13.1

| Task | Owner | Status | ETA |
|------|-------|--------|-----|
| P0-1: WebSocket attach contract | - | completed | 2026-03-18 |
| P0-2: WebSocket message schema | - | completed | 2026-03-18 |
| P0-3: Change password/username reload | - | completed | 2026-03-18 |
| P1-1: Socket ticket secret | - | completed | 2026-03-18 |
| P1-2: Mobile settings payloads | - | completed | 2026-03-18 |
| P2-1: Openclaw preset missing | - | completed | 2026-03-18 |
| WebSocket Core | ws-agent | in_progress | - |
| Security | security-pm-agent | completed | 2026-03-18 |

## Code Review Fixes (2026-03-18)

### P0 Issues (Fixed)
- [x] P0-1: WebSocket attach sessionId in handshake.auth
- [x] P0-2: Message schema matches (input/resize/output)
- [x] P0-3: Password/username change reloads users

### P1 Issues (Fixed)
- [x] P1-1: Socket ticket secret - verified env var
- [x] P1-2: Mobile settings payloads match backend

### P2 Issues (Fixed)
- [x] P2-1: Openclaw preset in isToolPreset

### Verification
- [x] Build passes
- [x] Server starts successfully

## Additional Fix (2026-03-18)

### HTTP Manual Switch
- [x] Fixed switchModeBtn to force HTTP mode when clicked
- [x] Added forceHttp option to openSessionTerminal
- [x] Now directly switches to HTTP without trying WebSocket first

## Terminal Reconnection Refactor (2026-03-18)

### Phase 1: State Machine
- [x] Created `src/terminal-state.ts` with TerminalState enum

### Phase 2: Reconnect Path Split
- [x] Split reconnectTerminal into reconnectWsTerminal and reconnectHttpTerminal
- [x] WS stale now uses WS reconnect, not HTTP reconnect

### Phase 3: Listener Cleanup
- [x] Added cleanup in startWebSocketTerminal before creating new connection
- [x] Server rejects duplicate attach with DUPLICATE_ATTACH error

### Phase 4: Stale Auto-Recovery
- [x] terminal:stale event now triggers auto-reconnect after 1s
- [x] No longer waits for user input to trigger reconnect

### Phase 5-6: Build Verification
- [x] npm run build passes
- [x] Server starts successfully
