import path from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { appConfig } from "../src/config.js";

const defaultUuid = "00112233-4455-6677-8899-aabbccddeeff";

const execFileMock = vi.fn((...args: any[]) => {
  const callback = args.find((arg) => typeof arg === "function");
  if (typeof callback === "function") {
    callback(null, "", "");
  }
  return {};
});

const randomUUIDMock = vi.fn(() => defaultUuid);

vi.mock("node:child_process", () => ({
  execFile: (...args: any[]) => execFileMock(...args)
}));

vi.mock("node:crypto", async () => {
  const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
  return {
    ...actual,
    randomUUID: () => randomUUIDMock()
  };
});

describe("session manager", () => {
  beforeEach(() => {
    vi.resetModules();
    execFileMock.mockReset();
    randomUUIDMock.mockReset();
    randomUUIDMock.mockImplementation(() => defaultUuid);
  });

  it("spawns tmux session and runs gemini preset", async () => {
    const sessionManager = await import("../src/session-manager.js");
    const cwd = "/tmp/magnum-test";
    const session = await sessionManager.createSession({ tool: "gemini", cwd, name: "special" });

    expect(session.id).toBe(defaultUuid.slice(0, 8));
    expect(session.tool).toBe("gemini");
    expect(session.cwd).toBe(path.resolve(cwd));

    const tmuxSession = `${appConfig.sessionPrefix}-${session.id}`;
    expect(execFileMock.mock.calls[0][1]).toEqual([
      "new-session",
      "-d",
      "-s",
      tmuxSession,
      "-c",
      path.resolve(cwd),
      appConfig.shellPath
    ]);
    expect(execFileMock.mock.calls.some((call) => call[1][0] === "send-keys" && call[1][3] === "gemini")).toBe(true);
    expect(execFileMock.mock.calls.some((call) => call[1][0] === "set-environment")).toBe(true);
  });

  it("renames and keepalive updates session metadata", async () => {
    const sessionManager = await import("../src/session-manager.js");
    const session = await sessionManager.createSession({ tool: "shell", cwd: "/tmp/magnum" });

    const renamed = await sessionManager.renameSession(session.id, "Renamed", "codex");
    expect(renamed?.displayName).toBe("Renamed");
    expect(renamed?.tool).toBe("codex");

    const previous = renamed?.lastActiveAt;
    const alive = await sessionManager.keepAliveSession(session.id);
    expect((alive?.lastActiveAt || "") >= (previous || "")).toBe(true);
  });

  it("restores sessions from tmux prefix metadata", async () => {
    const metadata = {
      id: "abc12345",
      name: "restored-shell",
      displayName: "Restored",
      tool: "claude",
      cwd: "/tmp/restored",
      tmuxSession: `${appConfig.sessionPrefix}-abc12345`,
      createdAt: new Date().toISOString(),
      status: "active",
      restored: false,
      lastActiveAt: new Date().toISOString()
    };
    const encoded = Buffer.from(JSON.stringify(metadata)).toString("base64");

    execFileMock.mockImplementation((...args: any[]) => {
      const callback = args.find((arg) => typeof arg === "function");
      const commandArgs: string[] = args[1] || [];
      let stdout = "";
      if (commandArgs[0] === "list-sessions") {
        stdout = `${appConfig.sessionPrefix}-abc12345\nother-session\n`;
      }
      if (commandArgs[0] === "show-environment") {
        const envName = `${appConfig.sessionPrefix.toUpperCase()}_SESSION_SPEC`;
        stdout = `${envName}=${encoded}\n`;
      }
      if (typeof callback === "function") callback(null, stdout, "");
      return {};
    });

    const sessionManager = await import("../src/session-manager.js");
    const restored = await sessionManager.restoreSessionsFromTmuxPrefix();
    expect(restored.length).toBe(1);
    expect(restored[0]?.id).toBe("abc12345");
    expect(restored[0]?.restored).toBe(true);
  });
});
