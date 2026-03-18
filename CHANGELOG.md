# Changelog

All notable changes to this project will be documented in this file.

## [1.12.0] - 2026-03-18

### Bug Fixes
- Fixed WebSocket attach contract mismatch (sessionId storage location)
- Fixed WebSocket message schema mismatch (input/resize/output events)
- Fixed login invalidation after password/username change
- Fixed tool preset missing "openclaw" in restore detection
- Fixed SSH auto mode sending invalid command to terminal

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
