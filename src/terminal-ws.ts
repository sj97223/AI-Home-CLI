import type { Server, Socket } from "socket.io";
import type { SessionSpec } from "./types.js";
import {
  captureSessionOutput,
  getSession,
  keepAliveSession,
  resizeSession,
  sendInputToSession
} from "./session-manager.js";

// Unified terminal state enum
export const TerminalState = {
  IDLE: "idle",
  CONNECTING: "connecting",
  ATTACHED_WS: "attached_ws",
  ATTACHED_HTTP: "attached_http",
  STALE: "stale",
  RECONNECTING: "reconnecting",
  CLOSED: "closed"
} as const;

export type TerminalStateType = typeof TerminalState[keyof typeof TerminalState];

// Standard error codes
export const TerminalErrorCode = {
  RUNTIME_NOT_FOUND: "RUNTIME_NOT_FOUND",
  WS_UPGRADE_FAILED: "WS_UPGRADE_FAILED",
  AUTH_COOKIE_MISSING: "AUTH_COOKIE_MISSING",
  PROXY_WS_BLOCKED: "PROXY_WS_BLOCKED",
  TERMINAL_STALE: "TERMINAL_STALE"
} as const;

export type TerminalErrorCodeType = typeof TerminalErrorCode[keyof typeof TerminalErrorCode];

export interface WsTerminalMessage {
  type: "input" | "resize" | "detach";
  data?: string;
  cols?: number;
  rows?: number;
}

export interface WsTerminalOutMessage {
  type: "output" | "error" | "connected";
  data?: string;
  message?: string;
}

export interface WsTerminalConnection {
  socket: Socket;
  sessionId: string;
  terminalId: string;
  attachedAt: number;
  lastInputAt: number | null;
  lastActivityAt: number; // Track both input and output for timeout
  cols: number;
  rows: number;
}

const wsTerminals = new Map<string, WsTerminalConnection>();

function generateTerminalId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function roomName(sessionId: string): string {
  return `terminal:${sessionId}`;
}

function createWsTerminalRuntime(socket: Socket, sessionId: string): WsTerminalConnection {
  const terminalId = generateTerminalId();
  return {
    socket,
    sessionId,
    terminalId,
    attachedAt: Date.now(),
    lastInputAt: null,
    lastActivityAt: Date.now(), // Initialize with attach time
    cols: 80,
    rows: 24
  };
}

// Cleanup existing terminal for a socket before re-attaching
function cleanupSocketTerminal(socketId: string): void {
  const existing = wsTerminals.get(socketId);
  if (existing) {
    existing.socket.leave(roomName(existing.sessionId));
    wsTerminals.delete(socketId);
  }
}

export function attachTerminalSocket(io: Server, socket: Socket): void {
  const sessionId = String(socket.handshake.query.sessionId || socket.handshake.auth.sessionId);
  const cols = Number(socket.handshake.query.cols || socket.handshake.auth.cols || 80);
  const rows = Number(socket.handshake.query.rows || socket.handshake.auth.rows || 24);

  if (!sessionId) {
    socket.emit("terminal:error", { type: "error", message: "session_id_required", code: "RUNTIME_NOT_FOUND" });
    socket.disconnect(true);
    return;
  }

  const session = getSession(sessionId);
  if (!session) {
    socket.emit("terminal:error", { type: "error", message: "session_not_found", code: "RUNTIME_NOT_FOUND" });
    socket.disconnect(true);
    return;
  }

  // Check for duplicate attach - reject if already connected
  const existing = wsTerminals.get(socket.id);
  if (existing && existing.sessionId === sessionId && socket.connected) {
    socket.emit("terminal:error", {
      type: "error",
      message: "duplicate_attach",
      code: "DUPLICATE_ATTACH"
    });
    return;
  }

  // P0 Fix: Cleanup old terminal before creating new one
  cleanupSocketTerminal(socket.id);

  const runtime = createWsTerminalRuntime(socket, sessionId);
  runtime.cols = cols;
  runtime.rows = rows;
  wsTerminals.set(socket.id, runtime);

  socket.join(roomName(sessionId));

  // P0 Fix: Only mark OTHER terminals as stale, not self
  markWsTerminalsStaleForSession(sessionId, "reconnected", socket.id);

  // Emit terminal:ready event to client (expected by WebSocket client)
  socket.emit("terminal:ready", {
    runtimeId: runtime.terminalId,
    sessionId: sessionId,
    cols: runtime.cols,
    rows: runtime.rows
  });

  // Also emit connected for backward compatibility
  socket.emit("terminal:output", { type: "connected", data: sessionId });

  console.log(`[WS] Terminal connected: sessionId=${sessionId}, terminalId=${runtime.terminalId}, socketId=${socket.id}`);

  void handleResize(session, cols, rows);
  void keepAliveSession(sessionId);

  socket.on("terminal:input", async (msg: unknown) => {
    const message = msg as WsTerminalMessage;
    if (message.type !== "input" || typeof message.data !== "string") {
      socket.emit("terminal:error", { type: "error", message: "invalid_message_format", code: "RUNTIME_NOT_FOUND" });
      return;
    }

    const terminal = wsTerminals.get(socket.id);
    if (!terminal || terminal.sessionId !== sessionId) {
      socket.emit("terminal:error", { type: "error", message: "terminal_not_found", code: "RUNTIME_NOT_FOUND" });
      return;
    }

    try {
      await sendInputToSession(sessionId, message.data);
      terminal.lastInputAt = Date.now();
      terminal.lastActivityAt = Date.now(); // Update both for timeout tracking
      void keepAliveSession(sessionId);
    } catch (err) {
      console.error(`[WS] Input error: sessionId=${sessionId}, error=${err}`);
      socket.emit("terminal:error", { type: "error", message: String(err), code: "RUNTIME_NOT_FOUND" });
    }
  });

  socket.on("terminal:resize", async (msg: unknown) => {
    const message = msg as WsTerminalMessage;
    if (message.type !== "resize" || typeof message.cols !== "number" || typeof message.rows !== "number") {
      socket.emit("terminal:error", { type: "error", message: "invalid_message_format", code: "RUNTIME_NOT_FOUND" });
      return;
    }

    const terminal = wsTerminals.get(socket.id);
    if (!terminal || terminal.sessionId !== sessionId) {
      socket.emit("terminal:error", { type: "error", message: "terminal_not_found", code: "RUNTIME_NOT_FOUND" });
      return;
    }

    try {
      await handleResize(session, message.cols, message.rows);
      terminal.cols = message.cols;
      terminal.rows = message.rows;
      void keepAliveSession(sessionId);
    } catch (err) {
      socket.emit("terminal:error", { type: "error", message: String(err) });
    }
  });

  socket.on("terminal:detach", () => {
    cleanupTerminal(socket.id);
    socket.emit("terminal:output", { type: "output", data: "" });
    socket.disconnect(true);
  });

  socket.on("disconnect", (reason) => {
    console.log(`[WS] Terminal disconnected: socketId=${socket.id}, sessionId=${sessionId}, reason=${reason}`);
    cleanupTerminal(socket.id);
  });

  // Log connection errors
  socket.on("connect_error", (err) => {
    console.error(`[WS] Socket connection error: socketId=${socket.id}, sessionId=${sessionId}, error=${err.message}`);
  });
}

async function handleResize(session: SessionSpec, cols: number, rows: number): Promise<void> {
  if (cols > 0 && rows > 0) {
    await resizeSession(session.id, cols, rows);
  }
}

function cleanupTerminal(socketId: string): void {
  const terminal = wsTerminals.get(socketId);
  if (terminal) {
    console.log(`[WS] Cleanup terminal: socketId=${socketId}, sessionId=${terminal.sessionId}, terminalId=${terminal.terminalId}`);
    terminal.socket.leave(roomName(terminal.sessionId));
    wsTerminals.delete(socketId);
  }
}

function markWsTerminalsStaleForSession(sessionId: string, reason: string, excludeSocketId?: string): void {
  for (const terminal of wsTerminals.values()) {
    // P0 Fix: Exclude self from stale notification
    if (terminal.sessionId === sessionId && terminal.socket.connected && terminal.socket.id !== excludeSocketId) {
      terminal.socket.emit("terminal:stale", { reason });
    }
  }
}

export function broadcastTerminalOutput(io: Server, sessionId: string): void {
  const room = roomName(sessionId);
  const sockets = io.sockets.adapter.rooms.get(room);
  if (!sockets || sockets.size === 0) return;

  captureSessionOutput(sessionId)
    .then((output) => {
      for (const socketId of sockets) {
        const terminal = wsTerminals.get(socketId);
        const socket = io.sockets.sockets.get(socketId);
        if (socket && socket.connected && terminal) {
          socket.emit("terminal:output", { type: "output", data: output });
          // P1 Fix: Update lastActivityAt when sending output (not just input)
          terminal.lastActivityAt = Date.now();
        }
      }
    })
    .catch(() => {
      // Ignore capture errors
    });
}

export function startTerminalHeartbeat(io: Server): void {
  setInterval(() => {
    const now = Date.now();
    const staleTimeout = 5 * 60 * 1000; // 5 minutes

    for (const [socketId, terminal] of wsTerminals.entries()) {
      if (!terminal.socket.connected) {
        wsTerminals.delete(socketId);
        continue;
      }

      // P1 Fix: Use lastActivityAt instead of lastInputAt to track both input and output
      const timeSinceLastActivity = terminal.lastActivityAt ? now - terminal.lastActivityAt : now - terminal.attachedAt;
      if (timeSinceLastActivity > staleTimeout) {
        terminal.socket.emit("terminal:stale", { reason: "timeout" });
        terminal.socket.disconnect(true);
        wsTerminals.delete(socketId);
        continue;
      }

      // Broadcast terminal output periodically
      broadcastTerminalOutput(io, terminal.sessionId);
    }
  }, 2000).unref();
}

export function getWsTerminalCount(): number {
  return wsTerminals.size;
}

export function getWsTerminalsForSession(sessionId: string): WsTerminalConnection[] {
  const terminals: WsTerminalConnection[] = [];
  for (const terminal of wsTerminals.values()) {
    if (terminal.sessionId === sessionId) {
      terminals.push(terminal);
    }
  }
  return terminals;
}
