# SWIFT Scope - v1.11.0

## Goals
- Fix WebSocket stability
- Security hardening
- Mobile feature parity

## Completed Security Hardening

### Cookie Security Configuration
- `HttpOnly`: Prevents XSS attacks from accessing cookies
- `SameSite=Strict`: CSRF protection
- `Secure`: HTTPS-only cookie transmission
- `Max-Age`: Session expiration control
- Configurable via `COOKIE_SECURE` environment variable

### Rate Limiting
- Login attempts limited to 5 per 15-minute window
- IP-based tracking for brute force prevention
- HTTP 429 response with retry information

### Password Security
- Scrypt hashing with 16-byte random salt
- 64-byte hash output for strong collision resistance
- Timing-safe comparison to prevent timing attacks

## Risks
- WS reconnection edge cases
- Production cookie settings
