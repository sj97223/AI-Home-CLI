import express from "express";
import http from "node:http";
import path from "node:path";
import { readFileSync } from "node:fs";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import multer from "multer";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import { Server } from "socket.io";
import { z } from "zod";
import { appConfig } from "./config.js";
import {
  addUser,
  authMiddleware,
  clearSessionCookie,
  destroyLoginSessionFromRequest,
  getLoginSession,
  getSocketSessionFromCookieHeader,
  hashPassword,
  issueLoginSession,
  issueSocketTicket,
  listUsers,
  removeUser,
  resolveCloudflareIdentity,
  setSessionCookie,
  verifyPassword,
  verifySocketTicket
} from "./auth.js";
import { ensureSafeDirectory, resolveSafePath } from "./file-policy.js";
import {
  captureSessionOutput,
  createSession,
  destroySession,
  getSession,
  keepAliveSession,
  listSessions,
  renameSession,
  resizeSession,
  restoreSessionsFromTmuxPrefix,
  sendInputToSession
} from "./session-manager.js";

const app = express();
const serverStartedAt = new Date().toISOString();
const appVersion = (() => {
  try {
    const pkgPath = path.join(process.cwd(), "package.json");
    const raw = readFileSync(pkgPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version || "dev";
  } catch {
    return "dev";
  }
})();
const buildId = (() => {
  const hash = createHash("sha1");
  hash.update(appVersion);
  const candidates = [
    path.join(process.cwd(), "dist", "src", "server.js"),
    path.join(process.cwd(), "public", "index.html")
  ];
  for (const filePath of candidates) {
    try {
      hash.update(readFileSync(filePath));
    } catch {
      hash.update(filePath);
    }
  }
  return hash.digest("hex").slice(0, 10);
})();

const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((item) => item.trim()).filter(Boolean)
  : false;

const startupTokenSchema = z.string().regex(/^[A-Za-z0-9_./:@%+=,-]+$/);
const startupCommandSchema = z.string().min(1).max(500);
const sshUserSchema = z.string().regex(/^[A-Za-z0-9._-]+$/);
const sshHostSchema = z.string().regex(/^[A-Za-z0-9.-]+$/);

function parseStartupArgs(raw: string | undefined): string[] | undefined {
  const text = raw?.trim();
  if (!text) return undefined;
  const safe = startupCommandSchema.parse(text);
  const tokens = safe.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    startupTokenSchema.parse(token);
  }
  return tokens.length ? tokens : undefined;
}

function buildSafeSshArgs(
  user: string | undefined,
  host: string | undefined,
  port: number | undefined
): string[] | undefined {
  if (!user) return undefined;
  const safeUser = sshUserSchema.parse(user.trim());
  const safeHost = sshHostSchema.parse((host || "127.0.0.1").trim());
  const args = ["ssh"];
  if (port) args.push("-p", String(port));
  args.push(`${safeUser}@${safeHost}`);
  return args;
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://cdn.jsdelivr.net", "https://cdn.socket.io"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      fontSrc: ["'self'", "data:", "https://cdn.jsdelivr.net"]
    }
  }
}));
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(morgan("tiny"));
app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(express.static(path.join(process.cwd(), "public")));

const upload = multer({
  limits: { fileSize: appConfig.maxUploadMB * 1024 * 1024 },
  storage: multer.diskStorage({
    destination: async (req, _file, cb) => {
      try {
        const p = String(req.body.path || "");
        const safe = await ensureSafeDirectory(p);
        cb(null, safe);
      } catch {
        cb(new Error("invalid_upload_path"), "");
      }
    },
    filename: (_req, file, cb) => cb(null, file.originalname)
  })
});

app.get("/api/healthz", (_req, res) => {
  res.json({ status: "ok", ts: new Date().toISOString() });
});

app.get("/api/meta", (_req, res) => {
  res.json({ version: appVersion, buildId, startedAt: serverStartedAt });
});

app.post("/api/login", (req, res) => {
  const schema = z.object({
    username: z.string().min(1),
    password: z.string().min(1)
  });
  try {
    const parsed = schema.parse(req.body);
    const result = verifyPassword(parsed.username, parsed.password);
    if (!result.valid) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }
    const cfEmail = resolveCloudflareIdentity(req);
    if (appConfig.requireCloudflareAccess && !cfEmail) {
      res.status(401).json({ error: "cloudflare_access_required" });
      return;
    }

    const sid = issueLoginSession(result.username, cfEmail || undefined);
    setSessionCookie(res, sid);
    res.json({ ok: true, username: result.username, email: cfEmail || null });
  } catch (err) {
    res.status(400).json({ error: "invalid_login_payload", detail: String(err) });
  }
});

app.post("/api/logout", (req, res) => {
  destroyLoginSessionFromRequest(req);
  clearSessionCookie(res);
  res.status(204).send();
});

// User management APIs (admin only)
app.get("/api/admin/users", authMiddleware, (_req, res) => {
  const users = listUsers();
  res.json({ users });
});

app.post("/api/admin/users", authMiddleware, async (req, res) => {
  const schema = z.object({
    username: z.string().min(1),
    password: z.string().min(1)
  });
  try {
    const parsed = schema.parse(req.body);
    const passwordHash = hashPassword(parsed.password);
    if (addUser(parsed.username, passwordHash)) {
      // Save to users.json
      const fs = await import("node:fs");
      const pathModule = await import("node:path");
      const usersFile = pathModule.join(process.cwd(), "users.json");
      fs.writeFileSync(usersFile, JSON.stringify(appConfig.users, null, 2));
      res.json({ ok: true, username: parsed.username });
    } else {
      res.status(400).json({ error: "user_already_exists" });
    }
  } catch (err) {
    res.status(400).json({ error: "create_user_failed", detail: String(err) });
  }
});

app.delete("/api/admin/users/:username", authMiddleware, async (req, res) => {
  const username = String(req.params.username);
  // Prevent deleting the last user
  if (appConfig.users.length <= 1) {
    res.status(400).json({ error: "cannot_delete_last_user" });
    return;
  }
  if (removeUser(username)) {
    // Save to users.json
    const fs = await import("node:fs");
    const pathModule = await import("node:path");
    const usersFile = pathModule.join(process.cwd(), "users.json");
    fs.writeFileSync(usersFile, JSON.stringify(appConfig.users, null, 2));
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: "user_not_found" });
  }
});

// 修改密码
app.post("/api/admin/change-password", authMiddleware, async (req, res) => {
  const schema = z.object({
    newPassword: z.string().min(4)
  });
  try {
    const parsed = schema.parse(req.body);
    const newHash = hashPassword(parsed.newPassword);
    // 写入 .env 文件
    const fs = await import("node:fs");
    const path = await import("node:path");
    const envPath = path.join(process.cwd(), ".env");
    let envContent = fs.readFileSync(envPath, "utf8");
    // 更新密码哈希
    envContent = envContent.replace(/^ADMIN_PASSWORD_HASH=.*$/m, `ADMIN_PASSWORD_HASH=${newHash}`);
    // 同时清除明文密码
    envContent = envContent.replace(/^ADMIN_PASSWORD=.*$/m, "# ADMIN_PASSWORD= (使用哈希)");
    fs.writeFileSync(envPath, envContent);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: "change_password_failed", detail: String(err) });
  }
});

// 修改用户名
app.post("/api/admin/change-username", authMiddleware, async (req, res) => {
  const schema = z.object({
    newUsername: z.string().min(1)
  });
  try {
    const parsed = schema.parse(req.body);
    // 写入 .env 文件
    const fs = await import("node:fs");
    const pathModule = await import("node:path");
    const envPath = pathModule.join(process.cwd(), ".env");
    let envContent = fs.readFileSync(envPath, "utf8");
    // 更新用户名
    envContent = envContent.replace(/^ADMIN_USERNAME=.*$/m, `ADMIN_USERNAME=${parsed.newUsername}`);
    fs.writeFileSync(envPath, envContent);
    res.json({ ok: true, username: parsed.newUsername });
  } catch (err) {
    res.status(400).json({ error: "change_username_failed", detail: String(err) });
  }
});

app.get("/api/me", (req, res) => {
  const session = getLoginSession(req);
  if (!session) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  res.json({ username: session.username, email: session.email || null, expiresAt: session.expiresAt });
});

app.use("/api", authMiddleware);

app.get("/api/options", (_req, res) => {
  res.json({
    allowedRoots: appConfig.allowedRoots,
    defaultCwd: appConfig.allowedRoots[0] || process.cwd(),
    agentPresets: [
      { id: "shell", label: "Shell", command: null },
      { id: "claude", label: "Claude CLI", command: "claude" },
      { id: "codex", label: "Codex CLI", command: "codex" },
      { id: "gemini", label: "Gemini CLI", command: "gemini" },
      { id: "custom", label: "Custom Command", command: null }
    ]
  });
});

app.get("/api/socket-ticket", (req, res) => {
  const auth = (req as { auth?: { username?: string } }).auth;
  if (!auth?.username) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  res.json({ ticket: issueSocketTicket(auth.username) });
});

app.get("/api/sessions", (_req, res) => {
  res.json({ sessions: listSessions() });
});

app.post("/api/sessions", async (req, res) => {
  const schema = z.object({
    displayName: z.string().optional(),
    cwd: z.string().min(1),
    tool: z.enum(["shell", "claude", "openclaw", "codex", "gemini"]).optional(),
    startupCommand: z.string().max(500).optional(),
    sshMode: z.enum(["auto", "manual"]).optional(),
    sshUser: z.string().optional(),
    sshHost: z.string().optional(),
    sshPort: z.coerce.number().int().positive().max(65535).optional()
  });
  try {
    const parsed = schema.parse(req.body);
    const safeCwd = await ensureSafeDirectory(parsed.cwd);
    const sshUser = parsed.sshUser?.trim();
    const sshHost = parsed.sshHost?.trim() || "127.0.0.1";
    const sshPort = parsed.sshPort;
    const sshMode = parsed.sshMode || (sshUser ? "auto" : "manual");
    const startupFromInput = parseStartupArgs(parsed.startupCommand);
    const tool = parsed.tool || "shell";
    const startupArgs =
      sshMode === "auto" && sshUser
        ? buildSafeSshArgs(sshUser, sshHost, sshPort)
        : startupFromInput;

    const created = await createSession({
      displayName: parsed.displayName,
      tool,
      cwd: safeCwd,
      startupArgs,
      sshUser,
      sshHost,
      sshPort
    });
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: "invalid_session_payload", detail: String(err) });
  }
});

app.patch("/api/sessions/:id", async (req, res) => {
  const schema = z.object({
    displayName: z.string().min(1).optional(),
    tool: z.enum(["shell", "claude", "openclaw", "codex", "gemini"]).optional(),
    sshUser: z.string().optional(),
    sshHost: z.string().optional(),
    sshPort: z.coerce.number().int().positive().max(65535).optional()
  });
  try {
    const parsed = schema.parse(req.body);
    const updated = await renameSession(
      req.params.id,
      parsed.displayName,
      parsed.tool,
      parsed.sshUser,
      parsed.sshHost,
      parsed.sshPort
    );
    if (!updated) {
      res.status(404).json({ error: "session_not_found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: "invalid_patch_payload", detail: String(err) });
  }
});

app.post("/api/sessions/:id/keepalive", async (req, res) => {
  const session = await keepAliveSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "session_not_found" });
    return;
  }
  touchHttpTerminalsForSession(session.id);
  res.json(session);
});

app.delete("/api/sessions/:id", async (req, res) => {
  await destroySession(req.params.id);
  res.status(204).send();
});

app.get("/api/sessions/:id/commands", (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "session_not_found" });
    return;
  }
  try {
    const sshArgs = buildSafeSshArgs(session.sshUser, session.sshHost, session.sshPort);
    const sshCommand = sshArgs ? sshArgs.join(" ") : "";
    const resumeCommand = `tmux attach -t ${session.tmuxSession}`;
    res.json({ sshCommand, resumeCommand });
  } catch {
    res.status(400).json({ error: "invalid_ssh_target" });
  }
});

// HTTP fallback terminal channel
app.post("/api/sessions/:id/terminal/http/start", async (req, res) => {
  const schema = z
    .object({
      cols: z.coerce.number().int().positive().optional(),
      rows: z.coerce.number().int().positive().optional()
    })
    .refine(
      (payload) =>
        (payload.cols === undefined && payload.rows === undefined) ||
        (payload.cols !== undefined && payload.rows !== undefined),
      { message: "cols_rows_pair_required" }
    );
  try {
    const session = getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: "session_not_found" });
      return;
    }
    const parsed = schema.parse(req.body || {});
    if (parsed.cols !== undefined && parsed.rows !== undefined) {
      await resizeSession(session.id, parsed.cols, parsed.rows);
    }
    markSessionTerminalsStale(session.id, "restarted");
    const runtime = createHttpTerminalRuntime(session.id);
    httpTerminals.set(runtime.terminalId, runtime);
    res.status(201).json({
      terminalId: runtime.terminalId,
      cursor: runtime.nextCursor,
      nextCursor: runtime.nextCursor
    });
  } catch (err) {
    if (isZodError(err)) {
      res.status(400).json({ error: "invalid_payload", detail: String(err) });
      return;
    }
    if (isSessionNotFoundError(err)) {
      res.status(404).json({ error: "session_not_found" });
      return;
    }
    res.status(502).json({ error: "tmux_send_failed", detail: String(err) });
  }
});

app.post("/api/sessions/:id/terminal/http/reconnect", async (req, res) => {
  const schema = z
    .object({
      terminalId: z.string().min(1).optional(),
      cols: z.coerce.number().int().positive().optional(),
      rows: z.coerce.number().int().positive().optional()
    })
    .refine(
      (payload) =>
        (payload.cols === undefined && payload.rows === undefined) ||
        (payload.cols !== undefined && payload.rows !== undefined),
      { message: "cols_rows_pair_required" }
    );
  try {
    const session = getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: "session_not_found" });
      return;
    }
    const parsed = schema.parse(req.body || {});
    if (parsed.terminalId) {
      const existing = httpTerminals.get(parsed.terminalId);
      if (!existing || existing.sessionId !== session.id) {
        res.status(404).json({ error: "terminal_not_found" });
        return;
      }
      markTerminalStale(existing, "reconnected");
    } else {
      markSessionTerminalsStale(session.id, "reconnected");
    }
    if (parsed.cols !== undefined && parsed.rows !== undefined) {
      await resizeSession(session.id, parsed.cols, parsed.rows);
    }
    const runtime = createHttpTerminalRuntime(session.id);
    httpTerminals.set(runtime.terminalId, runtime);
    res.status(200).json({
      terminalId: runtime.terminalId,
      cursor: runtime.nextCursor,
      nextCursor: runtime.nextCursor
    });
  } catch (err) {
    if (isZodError(err)) {
      res.status(400).json({ error: "invalid_payload", detail: String(err) });
      return;
    }
    if (isSessionNotFoundError(err)) {
      res.status(404).json({ error: "session_not_found" });
      return;
    }
    res.status(502).json({ error: "tmux_send_failed", detail: String(err) });
  }
});

app.get("/api/sessions/:id/terminal/http/poll", async (req, res) => {
  const schema = z.object({
    terminalId: z.string().min(1),
    cursor: z.coerce.number().int().min(0).optional()
  });
  try {
    const parsed = schema.parse({
      terminalId: req.query.terminalId,
      cursor: req.query.cursor
    });
    const terminal = httpTerminals.get(parsed.terminalId);
    if (!terminal || terminal.sessionId !== req.params.id) {
      res.status(404).json({ error: "terminal_not_found" });
      return;
    }
    if (terminal.stale) {
      res.status(409).json({ error: "terminal_stale" });
      return;
    }
    const defaultCursor = terminal.nextCursor;
    const snapshot = await captureSessionOutput(req.params.id);
    if (snapshot !== terminal.lastSnapshot) {
      terminal.lastSnapshot = snapshot;
      terminal.events.push({
        cursor: terminal.nextCursor,
        type: "output",
        data: snapshot,
        createdAt: new Date().toISOString()
      });
      terminal.nextCursor += 1;
      if (terminal.events.length > 256) {
        terminal.events.splice(0, terminal.events.length - 256);
      }
    }
    const cursor = parsed.cursor ?? defaultCursor;
    if (cursor > terminal.nextCursor) {
      res.status(409).json({ error: "terminal_stale" });
      return;
    }
    terminal.updatedAt = Date.now();
    terminal.lastError = null;
    const events = terminal.events.filter((event) => event.cursor >= cursor);
    res.json({
      cursor,
      nextCursor: terminal.nextCursor,
      events,
      chunks: events.filter((event) => event.type === "output").map((event) => event.data),
      closed: terminal.closed
    });
  } catch (err) {
    if (isZodError(err)) {
      res.status(400).json({ error: "invalid_payload", detail: String(err) });
      return;
    }
    if (isSessionNotFoundError(err)) {
      res.status(404).json({ error: "session_not_found" });
      return;
    }
    res.status(502).json({ error: "tmux_send_failed", detail: String(err) });
  }
});

app.post("/api/sessions/:id/terminal/http/input", async (req, res) => {
  const schema = z.object({
    terminalId: z.string().min(1),
    data: z.string().min(1),
    seq: z.coerce.number().int().positive().optional()
  });
  try {
    const parsed = schema.parse(req.body || {});
    const terminal = httpTerminals.get(parsed.terminalId);
    if (!terminal || terminal.sessionId !== req.params.id) {
      res.status(404).json({ error: "terminal_not_found" });
      return;
    }
    if (terminal.stale || terminal.closed) {
      res.status(409).json({ error: "terminal_stale" });
      return;
    }
    const seq = parsed.seq ?? terminal.nextExpectedSeq;
    if (seq < terminal.nextExpectedSeq) {
      const seenData = terminal.acceptedInputs.get(seq);
      if (seenData !== undefined && seenData !== parsed.data) {
        terminal.lastError = "terminal_stale_conflicting_seq";
        terminal.updatedAt = Date.now();
        res.status(409).json({ error: "terminal_stale" });
        return;
      }
      terminal.updatedAt = Date.now();
      terminal.lastError = null;
      res.status(200).json({ acceptedSeq: seq });
      return;
    }
    if (seq > terminal.nextExpectedSeq) {
      terminal.lastError = "terminal_stale_seq_gap";
      terminal.updatedAt = Date.now();
      res.status(409).json({ error: "terminal_stale" });
      return;
    }
    await sendInputToSession(req.params.id, parsed.data);
    terminal.acceptedInputs.set(seq, parsed.data);
    if (terminal.acceptedInputs.size > 256) {
      for (const key of [...terminal.acceptedInputs.keys()].sort((a, b) => a - b).slice(0, terminal.acceptedInputs.size - 256)) {
        terminal.acceptedInputs.delete(key);
      }
    }
    terminal.nextExpectedSeq += 1;
    terminal.updatedAt = Date.now();
    terminal.lastInputAt = Date.now();
    terminal.lastError = null;
    touchHttpTerminalsForSession(req.params.id);
    void keepAliveSession(req.params.id);
    res.status(200).json({ acceptedSeq: seq });
  } catch (err) {
    if (isZodError(err)) {
      res.status(400).json({ error: "invalid_payload", detail: String(err) });
      return;
    }
    if (isSessionNotFoundError(err)) {
      res.status(404).json({ error: "session_not_found" });
      return;
    }
    res.status(502).json({ error: "tmux_send_failed", detail: String(err) });
  }
});

app.post("/api/sessions/:id/terminal/http/resize", async (req, res) => {
  const schema = z.object({
    terminalId: z.string().min(1),
    cols: z.coerce.number().int().positive(),
    rows: z.coerce.number().int().positive()
  });
  try {
    const parsed = schema.parse(req.body || {});
    const terminal = httpTerminals.get(parsed.terminalId);
    if (!terminal || terminal.sessionId !== req.params.id) {
      res.status(404).json({ error: "terminal_not_found" });
      return;
    }
    if (terminal.stale || terminal.closed) {
      res.status(409).json({ error: "terminal_stale" });
      return;
    }
    await resizeSession(req.params.id, parsed.cols, parsed.rows);
    terminal.updatedAt = Date.now();
    terminal.lastError = null;
    void keepAliveSession(req.params.id);
    res.status(204).send();
  } catch (err) {
    if (isZodError(err)) {
      res.status(400).json({ error: "invalid_payload", detail: String(err) });
      return;
    }
    if (isSessionNotFoundError(err)) {
      res.status(404).json({ error: "session_not_found" });
      return;
    }
    res.status(502).json({ error: "tmux_send_failed", detail: String(err) });
  }
});

app.post("/api/sessions/:id/terminal/http/stop", (req, res) => {
  const schema = z.object({ terminalId: z.string().min(1) });
  try {
    const parsed = schema.parse(req.body || {});
    const terminal = httpTerminals.get(parsed.terminalId);
    if (!terminal || terminal.sessionId !== req.params.id) {
      res.status(404).json({ error: "terminal_not_found" });
      return;
    }
    if (terminal.stale) {
      res.status(409).json({ error: "terminal_stale" });
      return;
    }
    terminal.closed = true;
    httpTerminals.delete(parsed.terminalId);
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: "invalid_payload", detail: String(err) });
  }
});

// Optional capture fallback for diagnostics
app.get("/api/sessions/:id/terminal/capture", async (req, res) => {
  try {
    const data = await captureSessionOutput(req.params.id);
    res.json({ output: data });
  } catch (err) {
    res.status(404).json({ error: "session_not_found", detail: String(err) });
  }
});

app.post("/api/sessions/:id/terminal/send", async (req, res) => {
  const schema = z.object({ data: z.string().min(1) });
  try {
    const parsed = schema.parse(req.body || {});
    await sendInputToSession(req.params.id, parsed.data);
    void keepAliveSession(req.params.id);
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: "invalid_terminal_send", detail: String(err) });
  }
});

app.get("/api/files/list", async (req, res) => {
  try {
    const target = await ensureSafeDirectory(String(req.query.path || ""));
    const entries = await readdir(target, { withFileTypes: true });
    res.json({
      path: target,
      entries: entries.map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? "dir" : "file"
      }))
    });
  } catch (err) {
    res.status(400).json({ error: "invalid_path", detail: String(err) });
  }
});

app.post("/api/files/upload", upload.single("file"), (req, res) => {
  res.status(201).json({ ok: true, file: req.file?.originalname });
});

app.get("/api/files/download", async (req, res) => {
  try {
    const safe = await resolveSafePath(String(req.query.path || ""));
    res.setHeader("Content-Disposition", `attachment; filename="${path.basename(safe)}"`);
    createReadStream(safe).pipe(res);
  } catch (err) {
    res.status(400).json({ error: "invalid_download_path", detail: String(err) });
  }
});

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: corsOrigins, credentials: true },
  transports: ["websocket", "polling"]
});

io.use((socket, next) => {
  const ticket = String(socket.handshake.auth?.ticket || "");
  if (ticket) {
    const payload = verifySocketTicket(ticket);
    if (payload) return next();
  }
  const session = getSocketSessionFromCookieHeader(socket.handshake.headers.cookie);
  if (!session) return next(new Error("unauthorized"));
  next();
});

io.on("connection", (socket) => {
  socket.on("terminal:attach", ({ sessionId }) => {
    const session = getSession(String(sessionId));
    if (!session) {
      socket.emit("terminal:error", "session_not_found");
      return;
    }
    socket.emit("terminal:error", "websocket_runtime_unavailable_use_http_fallback");
  });
});

interface HttpTerminalEvent {
  cursor: number;
  type: "output";
  data: string;
  createdAt: string;
}

interface HttpTerminal {
  terminalId: string;
  sessionId: string;
  lastSnapshot: string;
  closed: boolean;
  stale: boolean;
  staleReason: string | null;
  updatedAt: number;
  lastInputAt: number | null;
  lastError: string | null;
  nextExpectedSeq: number;
  acceptedInputs: Map<number, string>;
  nextCursor: number;
  events: HttpTerminalEvent[];
}

const httpTerminals = new Map<string, HttpTerminal>();

function createHttpTerminalRuntime(sessionId: string): HttpTerminal {
  return {
    terminalId: randomUUID().slice(0, 12),
    sessionId,
    lastSnapshot: "",
    closed: false,
    stale: false,
    staleReason: null,
    updatedAt: Date.now(),
    lastInputAt: null,
    lastError: null,
    nextExpectedSeq: 1,
    acceptedInputs: new Map<number, string>(),
    nextCursor: 0,
    events: []
  };
}

function markTerminalStale(terminal: HttpTerminal, reason: string): void {
  terminal.stale = true;
  terminal.staleReason = reason;
  terminal.updatedAt = Date.now();
}

function markSessionTerminalsStale(sessionId: string, reason: string): void {
  for (const terminal of httpTerminals.values()) {
    if (terminal.sessionId !== sessionId || terminal.closed || terminal.stale) continue;
    markTerminalStale(terminal, reason);
  }
}

function touchHttpTerminalsForSession(sessionId: string): void {
  const now = Date.now();
  for (const terminal of httpTerminals.values()) {
    if (terminal.sessionId !== sessionId || terminal.closed || terminal.stale) continue;
    terminal.updatedAt = now;
  }
}

function isSessionNotFoundError(err: unknown): boolean {
  return err instanceof Error && err.message === "session_not_found";
}

function isZodError(err: unknown): err is z.ZodError {
  return err instanceof z.ZodError;
}

setInterval(() => {
  const now = Date.now();
  for (const [terminalId, terminal] of httpTerminals.entries()) {
    if (terminal.closed || now - terminal.updatedAt > 5 * 60 * 1000) {
      httpTerminals.delete(terminalId);
    }
  }
}, 30_000).unref();

async function bootstrap(): Promise<void> {
  await restoreSessionsFromTmuxPrefix();
  if (process.env.NODE_ENV !== "test") {
    httpServer.listen(appConfig.port, appConfig.host, () => {
      // eslint-disable-next-line no-console
      console.log(`Magnum SSH Dash running at http://${appConfig.host}:${appConfig.port}`);
    });
  }
}

void bootstrap();

export { app, httpServer };
