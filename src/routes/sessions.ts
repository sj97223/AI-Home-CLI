import { Router } from "express";
import { z } from "zod";
import {
  createSession,
  destroySession,
  getSession,
  keepAliveSession,
  listSessions,
  renameSession
} from "../session-manager.js";
import { ensureSafeDirectory } from "../file-policy.js";
import { getWsTerminalsForSession, TerminalState, type TerminalStateType } from "../terminal-ws.js";
import { touchHttpTerminalsForSession } from "../services/terminal-http.js";
import { parseStartupArgs, buildSafeSshArgs } from "../utils/ssh-utils.js";

const router = Router();

// GET /api/sessions
router.get("/", (_req, res) => {
  res.json({ sessions: listSessions() });
});

// GET /api/terminal/status/:sessionId
router.get("/terminal/status/:sessionId", (req, res) => {
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

// POST /api/sessions
router.post("/", async (req, res) => {
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

    let startupArgs = startupFromInput;
    if (sshMode === "auto" && sshUser) {
      const sshArgs = buildSafeSshArgs(sshUser, sshHost, sshPort);
      if (sshArgs) {
        startupArgs = [sshArgs.join(" ")];
      }
    }

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

// PATCH /api/sessions/:id
router.patch("/:id", async (req, res) => {
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

// POST /api/sessions/:id/keepalive
router.post("/:id/keepalive", async (req, res) => {
  const session = await keepAliveSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "session_not_found" });
    return;
  }
  touchHttpTerminalsForSession(session.id);
  res.json(session);
});

// DELETE /api/sessions/:id
router.delete("/:id", async (req, res) => {
  await destroySession(req.params.id);
  res.status(204).send();
});

// GET /api/sessions/:id/commands
router.get("/:id/commands", (req, res) => {
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

export default router;
