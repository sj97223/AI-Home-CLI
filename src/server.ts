import express from "express";
import http from "node:http";
import path from "node:path";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import multer from "multer";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import { Server } from "socket.io";
import { z } from "zod";
import { appConfig, reloadUsers } from "./config.js";
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
import { attachTerminalSocket, startTerminalHeartbeat, TerminalErrorCode, TerminalState, getWsTerminalsForSession, type TerminalStateType } from "./terminal-ws.js";
import {
  createHttpTerminalRuntime,
  getHttpTerminal,
  setHttpTerminal,
  deleteHttpTerminal,
  markTerminalStale,
  markSessionTerminalsStale,
  touchHttpTerminalsForSession,
  cleanupStaleTerminals,
  type HttpTerminal,
  type HttpTerminalEvent
} from "./services/terminal-http.js";
import authRouter from "./routes/auth.js";
import sessionsRouter from "./routes/sessions.js";
import filesRouter from "./routes/files.js";
import { parseStartupArgs, buildSafeSshArgs } from "./utils/ssh-utils.js";
import optionsRouter from "./routes/options.js";
import { apiErrorHandler, notFoundHandler } from "./middleware/error-handler.js";

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

// Rate limiting for login attempts
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkLoginRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = loginAttempts.get(ip);

  if (!record || now > record.resetAt) {
    // Start new window
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }

  if (record.count >= MAX_LOGIN_ATTEMPTS) {
    return false;
  }

  record.count++;
  return true;
}

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // Note: 'unsafe-inline' is required because the frontend uses inline event handlers
      // TODO: Migrate to nonce-based CSP by generating nonce per request and adding to scripts
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

// 设备路由适配 - 根据 User-Agent 检测设备类型
app.get("/", (req, res, next) => {
  const userAgent = req.headers["user-agent"] || "";
  const force = req.query.force as string;

  let isMobile = force === "mobile";

  if (!isMobile && force !== "desktop") {
    // 检测移动设备
    const mobileKeywords = ["Android", "iPhone", "iPad", "iPod", "Mobile", "BlackBerry", "Windows Phone"];
    isMobile = mobileKeywords.some(keyword => userAgent.includes(keyword));
  }

  if (isMobile) {
    res.sendFile(path.join(process.cwd(), "public", "mobile.html"));
  } else {
    res.sendFile(path.join(process.cwd(), "public", "index.html"));
  }
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

// Use auth routes (includes login, logout, me, admin)
app.use("/api", authRouter);

// Use options route
app.use("/api/options", optionsRouter);

app.get("/api/socket-ticket", (req, res) => {
  const auth = (req as { auth?: { username?: string } }).auth;
  if (!auth?.username) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  res.json({ ticket: issueSocketTicket(auth.username) });
});

// Use sessions routes
app.use("/api/sessions", sessionsRouter);

// Terminal status API (part of sessions but needs wsTerminals)
app.get("/api/terminal/status/:sessionId", (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: "session_not_found" });
    return;
  }

  const wsTerminals = getWsTerminalsForSession(session.id);
  const hasWsTerminal = wsTerminals.length > 0;

  let terminalState: TerminalStateType = TerminalState.IDLE;
  if (hasWsTerminal) {
    terminalState = TerminalState.ATTACHED_WS;
  }

  res.json({
    sessionId: session.id,
    status: session.status,
    tool: session.tool,
    cwd: session.cwd,
    createdAt: session.createdAt,
    terminalState,
    hasWsTerminal
  });
});

// HTTP terminal routes will be refactored in next phase

// Use files routes
app.use("/api/files", filesRouter);

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
    setHttpTerminal(runtime.terminalId, runtime);
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
      const existing = getHttpTerminal(parsed.terminalId);
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
    setHttpTerminal(runtime.terminalId, runtime);
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
    const terminal = getHttpTerminal(parsed.terminalId);
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
    const terminal = getHttpTerminal(parsed.terminalId);
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
    const terminal = getHttpTerminal(parsed.terminalId);
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
    const terminal = getHttpTerminal(parsed.terminalId);
    if (!terminal || terminal.sessionId !== req.params.id) {
      res.status(404).json({ error: "terminal_not_found" });
      return;
    }
    if (terminal.stale) {
      res.status(409).json({ error: "terminal_stale" });
      return;
    }
    terminal.closed = true;
    deleteHttpTerminal(parsed.terminalId);
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
  if (!session) return next(new Error("AUTH_COOKIE_MISSING"));
  next();
});

io.on("connection", (socket) => {
  socket.on("terminal:attach", ({ sessionId, cols, rows }) => {
    const session = getSession(String(sessionId));
    if (!session) {
      socket.emit("terminal:error", { type: "error", message: "session_not_found", code: TerminalErrorCode.RUNTIME_NOT_FOUND });
      return;
    }
    // Put session info in handshake.auth so attachTerminalSocket can read it
    socket.handshake.auth.sessionId = sessionId;
    socket.handshake.auth.cols = cols || 80;
    socket.handshake.auth.rows = rows || 24;
    // Store session info on socket for reference
    socket.data.sessionId = sessionId;
    socket.data.cols = cols || 80;
    socket.data.rows = rows || 24;
    // Attach terminal using WebSocket runtime
    attachTerminalSocket(io, socket);
  });
});

function isSessionNotFoundError(err: unknown): boolean {
  return err instanceof Error && err.message === "session_not_found";
}

function isZodError(err: unknown): err is z.ZodError {
  return err instanceof z.ZodError;
}

setInterval(() => {
  cleanupStaleTerminals();
}, 30_000).unref();

// Error handling middleware (must be after all routes)
app.use(notFoundHandler);
app.use(apiErrorHandler);

async function bootstrap(): Promise<void> {
  await restoreSessionsFromTmuxPrefix();
  startTerminalHeartbeat(io);
  if (process.env.NODE_ENV !== "test") {
    httpServer.listen(appConfig.port, appConfig.host, () => {
      // eslint-disable-next-line no-console
      console.log(`Magnum SSH Dash running at http://${appConfig.host}:${appConfig.port}`);
    });
  }
}

void bootstrap();

export { app, httpServer };
