import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { appConfig } from "./config.js";
import type { SessionSpec, ToolPreset } from "./types.js";

const execFileAsync = promisify(execFile);
const sessions = new Map<string, SessionSpec>();
const metadataEnvName =
  `${appConfig.sessionPrefix.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}_SESSION_SPEC`;

function tmuxNameFor(id: string): string {
  return `${appConfig.sessionPrefix}-${id}`;
}

function presetCmd(tool: ToolPreset): string[] | null {
  if (tool === "claude") return ["claude"];
  if (tool === "openclaw") return ["openclaw"];
  if (tool === "codex") return ["codex"];
  if (tool === "gemini") return ["gemini"];
  return null;
}

function isToolPreset(value: unknown): value is ToolPreset {
  return value === "shell" || value === "claude" || value === "codex" || value === "gemini";
}

async function persistSessionMetadata(session: SessionSpec): Promise<void> {
  try {
    const payload = Buffer.from(JSON.stringify(session)).toString("base64");
    await execFileAsync("tmux", [
      "set-environment",
      "-t",
      session.tmuxSession,
      metadataEnvName,
      payload
    ]);
  } catch (err) {
    // best-effort persistence; keep running but log for diagnostics
    // eslint-disable-next-line no-console
    console.error("persistSessionMetadata failed:", err);
  }
}

async function loadSessionMetadata(
  tmuxSession: string
): Promise<Partial<SessionSpec> | undefined> {
  try {
    const result = await execFileAsync("tmux", [
      "show-environment",
      "-t",
      tmuxSession,
      metadataEnvName
    ]);
    const stdout = typeof result === "string" ? result : result.stdout;
    const [, rawValue] = stdout.trim().split("=", 2);
    if (!rawValue) return undefined;
    const decoded = Buffer.from(rawValue, "base64").toString("utf8");
    return JSON.parse(decoded) as Partial<SessionSpec>;
  } catch {
    return undefined;
  }
}

export async function createSession(input: {
  name?: string;
  displayName?: string;
  tool: ToolPreset;
  cwd: string;
  startupArgs?: string[];
  sshUser?: string;
  sshHost?: string;
  sshPort?: number;
}): Promise<SessionSpec> {
  const id = randomUUID().slice(0, 8);
  const tmuxSession = tmuxNameFor(id);
  const cwd = path.resolve(input.cwd);
  await execFileAsync("tmux", [
    "new-session",
    "-d",
    "-s",
    tmuxSession,
    "-c",
    cwd,
    appConfig.shellPath
  ]);
  const starter = input.startupArgs || presetCmd(input.tool);
  if (starter && starter.length) {
    await execFileAsync("tmux", ["send-keys", "-t", tmuxSession, ...starter, "Enter"]);
  }
  const determinateName = input.name?.trim() || `${input.tool}-${id}`;
  const determinateDisplayName = input.displayName?.trim() || determinateName;
  const now = new Date().toISOString();
  const session: SessionSpec = {
    id,
    name: determinateName,
    displayName: determinateDisplayName,
    tool: input.tool,
    cwd,
    tmuxSession,
    sshUser: input.sshUser,
    sshHost: input.sshHost,
    sshPort: input.sshPort,
    createdAt: now,
    status: "active",
    restored: false,
    lastActiveAt: now
  };
  sessions.set(id, session);
  await persistSessionMetadata(session);
  return session;
}

export function listSessions(): SessionSpec[] {
  return [...sessions.values()].sort((a, b) =>
    b.lastActiveAt.localeCompare(a.lastActiveAt)
  );
}

export function getSession(id: string): SessionSpec | undefined {
  return sessions.get(id);
}

export async function renameSession(
  id: string,
  displayName?: string,
  tool?: ToolPreset,
  sshUser?: string,
  sshHost?: string,
  sshPort?: number
): Promise<SessionSpec | undefined> {
  const session = sessions.get(id);
  if (!session) return undefined;
  if (displayName) {
    const trimmed = displayName.trim();
    if (trimmed) {
      session.displayName = trimmed;
    }
  }
  if (tool) {
    session.tool = tool;
  }
  if (sshUser !== undefined) session.sshUser = sshUser || undefined;
  if (sshHost !== undefined) session.sshHost = sshHost || undefined;
  if (sshPort !== undefined) session.sshPort = sshPort || undefined;
  session.lastActiveAt = new Date().toISOString();
  await persistSessionMetadata(session);
  return session;
}

export async function keepAliveSession(
  id: string
): Promise<SessionSpec | undefined> {
  const session = sessions.get(id);
  if (!session) return undefined;
  session.lastActiveAt = new Date().toISOString();
  session.status = "active";
  await persistSessionMetadata(session);
  return session;
}

export async function restoreSessionsFromTmuxPrefix(): Promise<SessionSpec[]> {
  const prefix = `${appConfig.sessionPrefix}-`;
  const listResult = await execFileAsync("tmux", [
    "list-sessions",
    "-F",
    "#{session_name}"
  ]).catch(() => ({ stdout: "", stderr: "" }));
  const listStdout =
    typeof listResult === "string" ? listResult : listResult.stdout;
  const names = listStdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => Boolean(line));
  const restored: SessionSpec[] = [];
  for (const sessionName of names) {
    if (!sessionName.startsWith(prefix)) continue;
    const id = sessionName.slice(prefix.length);
    if (!id || sessions.has(id)) continue;
    try {
      await execFileAsync("tmux", ["has-session", "-t", sessionName]);
    } catch {
      continue;
    }
    const metadata = await loadSessionMetadata(sessionName);
    const timeOfRestore = new Date().toISOString();
    const metadataTool = metadata && isToolPreset(metadata.tool) ? metadata.tool : "shell";
    const spec: SessionSpec = {
      id,
      name: metadata?.name ?? sessionName,
      displayName: metadata?.displayName ?? metadata?.name ?? sessionName,
      tool: metadataTool,
      cwd: metadata?.cwd ?? process.cwd(),
      tmuxSession: sessionName,
      createdAt: metadata?.createdAt ?? timeOfRestore,
      status: "active",
      restored: true,
      lastActiveAt: metadata?.lastActiveAt ?? timeOfRestore
    };
    sessions.set(id, spec);
    await persistSessionMetadata(spec);
    restored.push(spec);
  }
  return restored;
}

export async function destroySession(id: string): Promise<void> {
  const existing = sessions.get(id);
  if (!existing) return;
  existing.status = "dead";
  await execFileAsync("tmux", ["kill-session", "-t", existing.tmuxSession]).catch(() => undefined);
  sessions.delete(id);
}

export async function sendInputToSession(id: string, data: string): Promise<void> {
  const session = sessions.get(id);
  if (!session) throw new Error("session_not_found");
  const normalized = data.replace(/\r/g, "\n");
  const parts = normalized.split("\n");
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (part) {
      await execFileAsync("tmux", ["send-keys", "-t", session.tmuxSession, "-l", part]);
    }
    if (i < parts.length - 1) {
      await execFileAsync("tmux", ["send-keys", "-t", session.tmuxSession, "Enter"]);
    }
  }
}

export async function resizeSession(
  id: string,
  cols: number,
  rows: number
): Promise<void> {
  const session = sessions.get(id);
  if (!session) throw new Error("session_not_found");
  await execFileAsync("tmux", [
    "resize-window",
    "-t",
    session.tmuxSession,
    "-x",
    String(cols),
    "-y",
    String(rows)
  ]);
  session.lastActiveAt = new Date().toISOString();
  await persistSessionMetadata(session);
}

export async function captureSessionOutput(id: string): Promise<string> {
  const session = sessions.get(id);
  if (!session) throw new Error("session_not_found");
  const result = await execFileAsync("tmux", [
    "capture-pane",
    "-p",
    "-t",
    session.tmuxSession,
    "-S",
    "-200"
  ]);
  return typeof result === "string" ? result : result.stdout;
}
