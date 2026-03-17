# Magnum SSH Dash

基于 Web 的 macOS 本地多会话 CLI/SSH 控制面板。

[English](./README.md)

## 功能特性

- **登录认证**: 用户名/密码认证，基于 Cookie 的会话管理
- **修改凭据**: 登录后可修改用户名和密码
- **浏览器终端**: 浏览器内完整终端模拟，支持多会话标签
- **多种 Agent 预设**: 支持 shell、claude、openclaw、codex、gemini 及自定义命令
- **会话管理**: 创建、重命名、后台挂起、终止会话
- **自动恢复**: 后端重启后自动从 tmux 恢复会话
- **文件管理**: 在允许的目录内列出、上传、下载文件
- **HTTP 长轮询终端**: 通过 HTTP 长轮询实现实时终端（WebSocket 回退）
- **安全**: Scrypt 密码哈希、HttpOnly Cookie、CSRF 保护

## 快速开始

1. 复制环境配置文件:
   ```bash
   cp .env.example .env
   ```

2. 启动应用:
   ```bash
   npm install
   npm run dev
   ```

3. 打开 `http://127.0.0.1:3000`（其他设备可使用局域网 IP）

4. 使用 `.env` 中的凭据登录:
   - 用户名: `ADMIN_USERNAME`
   - 密码: `ADMIN_PASSWORD_HASH`（或 `ADMIN_PASSWORD`）

## 修改凭据

登录后:
1. 点击 **"改用户名"** 修改用户名
2. 点击 **"改密码"** 修改密码
3. 修改后需要重新登录

## 环境变量

| 变量 | 描述 | 默认值 |
|------|------|--------|
| `PORT` | 服务器端口 | `3000` |
| `HOST` | 服务器绑定地址 | `127.0.0.1` |
| `SHELL_PATH | 终端路径 | `/bin/zsh` |
| `SESSION_PREFIX` | tmux 会话前缀 | `msd` |
| `MAX_UPLOAD_MB` | 最大上传大小 (MB) | `50` |
| `ALLOWED_ROOTS` | 允许文件操作的目录 | `~/Documents` |
| `REQUIRE_CF_ACCESS` | 需要 Cloudflare Access | `true` |
| `ADMIN_USERNAME` | 默认管理员用户名 | `admin` |
| `ADMIN_PASSWORD` | 默认管理员密码（明文） | - |
| `ADMIN_PASSWORD_HASH` | Scrypt 哈希（优先） | - |
| `SESSION_COOKIE_NAME` | 会话 Cookie 名称 | `msd_sid` |
| `AUTH_TOKEN_TTL_SECONDS` | 会话有效期 | `28800` (8小时) |
| `LOCAL_BOOTSTRAP_SECRET` | Socket 票据密钥 | `change-me` |

## 生成密码哈希

可以使用内置函数生成 scrypt 哈希:

```bash
# 启动服务器后使用 /api/admin/change-password 接口
# 或手动生成
node -e "const crypto = require('crypto'); const salt = crypto.randomBytes(16).toString('hex'); const hash = crypto.scryptSync('yourpassword', salt, 64).toString('hex'); console.log('scrypt\$' + salt + '\$' + hash);"
```

## API 接口

### 认证
- `POST /api/login` - 登录
- `POST /api/logout` - 登出
- `GET /api/me` - 获取当前用户

### 管理员
- `POST /api/admin/change-username` - 修改用户名
- `POST /api/admin/change-password` - 修改密码

### 会话
- `GET /api/sessions` - 会话列表
- `POST /api/sessions` - 创建会话
- `PATCH /api/sessions/:id` - 更新会话
- `DELETE /api/sessions/:id` - 删除会话
- `POST /api/sessions/:id/keepalive` - 保持会话

### 终端
- `POST /api/sessions/:id/terminal/http/start` - 启动终端
- `GET /api/sessions/:id/terminal/http/poll` - 轮询终端输出
- `POST /api/sessions/:id/terminal/http/input` - 发送输入
- `POST /api/sessions/:id/terminal/http/resize` - 调整终端大小
- `POST /api/sessions/:id/terminal/http/stop` - 停止终端

### 文件
- `GET /api/files/list` - 列出目录
- `POST /api/files/upload` - 上传文件
- `GET /api/files/download` - 下载文件

## 环境要求

- Node.js 18+
- tmux 已安装并在 PATH 中
- 现代网页浏览器

## 安全注意事项

- 生产环境请务必使用 `ADMIN_PASSWORD_HASH` 而不是明文密码
- 请修改默认的 `LOCAL_BOOTSTRAP_SECRET` 值
- 公开部署时，启用 `REQUIRE_CF_ACCESS=true` 并使用 Cloudflare Access
- `.env` 文件已加入 .gitignore - 切勿提交凭据到 Git

## 开发

```bash
# 安装依赖
npm install

# 开发模式运行
npm run dev

# 生产构建
npm run build

# 运行测试
npm test
```

## 许可证

ISC
