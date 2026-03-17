# Magnum SSH Dash v1.10

Web-based multi-session CLI/SSH control panel for macOS localhost.

[中文说明](./README.zh-CN.md)

## Features

- **Login Authentication**: Username/password authentication with cookie-based sessions
- **Change Credentials**: Change username and password after login
- **In-browser Terminal**: Full terminal emulation in browser with multi-session tabs
- **Multiple Agent Presets**: Support for shell, claude, openclaw, codex, gemini, and custom commands
- **Session Management**: Create, rename, detach to background, and kill sessions
- **Auto-restore**: Sessions automatically restored from tmux after backend restart
- **File Management**: List, upload, and download files within allowed directories
- **HTTP Polling Terminal**: Real-time terminal via HTTP long-polling (WebSocket fallback)
- **Security**: Scrypt password hashing, HttpOnly cookies, CSRF protection

## Quick Start

1. Copy env and edit credentials:
   ```bash
   cp .env.example .env
   ```

2. Start app:
   ```bash
   npm install
   npm run dev
   ```

3. Open `http://127.0.0.1:3000` (or your LAN IP for other devices)

4. Login with credentials from `.env`:
   - Default: username from `ADMIN_USERNAME`, password from `ADMIN_PASSWORD_HASH` (or `ADMIN_PASSWORD`)

## Change Credentials

After logging in:
1. Click **"改用户名"** to change your username
2. Click **"改密码"** to change your password
3. You will need to re-login after changing credentials

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `HOST` | Server bind address | `127.0.0.1` |
| `SHELL_PATH` | Path to shell | `/bin/zsh` |
| `SESSION_PREFIX` | tmux session prefix | `msd` |
| `MAX_UPLOAD_MB` | Max upload size (MB) | `50` |
| `ALLOWED_ROOTS` | Allowed directories for file ops | `~/Documents` |
| `REQUIRE_CF_ACCESS` | Require Cloudflare Access | `true` |
| `ADMIN_USERNAME` | Default admin username | `admin` |
| `ADMIN_PASSWORD` | Default admin password (plain) | - |
| `ADMIN_PASSWORD_HASH` | Scrypt hash (overrides password) | - |
| `SESSION_COOKIE_NAME` | Session cookie name | `msd_sid` |
| `AUTH_TOKEN_TTL_SECONDS` | Session lifetime | `28800` (8 hours) |
| `LOCAL_BOOTSTRAP_SECRET` | Secret for socket tickets | `change-me` |

## Generating Password Hash

You can generate a scrypt hash using the built-in function:

```bash
# Start the server and check the console for the hash
npm run dev
# Then use the /api/admin/change-password endpoint or generate manually
```

Or use Node.js directly:
```bash
node -e "const crypto = require('crypto'); const salt = crypto.randomBytes(16).toString('hex'); const hash = crypto.scryptSync('yourpassword', salt, 64).toString('hex'); console.log('scrypt\$' + salt + '\$' + hash);"
```

## API Endpoints

### Authentication
- `POST /api/login` - Login
- `POST /api/logout` - Logout
- `GET /api/me` - Get current user

### Admin
- `POST /api/admin/change-username` - Change username
- `POST /api/admin/change-password` - Change password

### Sessions
- `GET /api/sessions` - List sessions
- `POST /api/sessions` - Create session
- `PATCH /api/sessions/:id` - Update session
- `DELETE /api/sessions/:id` - Delete session
- `POST /api/sessions/:id/keepalive` - Keep session alive

### Terminal
- `POST /api/sessions/:id/terminal/http/start` - Start terminal
- `GET /api/sessions/:id/terminal/http/poll` - Poll terminal output
- `POST /api/sessions/:id/terminal/http/input` - Send input
- `POST /api/sessions/:id/terminal/http/resize` - Resize terminal
- `POST /api/sessions/:id/terminal/http/stop` - Stop terminal

### Files
- `GET /api/files/list` - List directory
- `POST /api/files/upload` - Upload file
- `GET /api/files/download` - Download file

## Requirements

- Node.js 18+
- tmux installed and available in PATH
- A modern web browser

## Security Notes

- Always use `ADMIN_PASSWORD_HASH` instead of plain `ADMIN_PASSWORD` in production
- Change the default `LOCAL_BOOTSTRAP_SECRET` value
- When deploying publicly, enable `REQUIRE_CF_ACCESS=true` and use Cloudflare Access
- The `.env` file is gitignored - never commit credentials

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Run tests
npm test
```

## License

ISC
