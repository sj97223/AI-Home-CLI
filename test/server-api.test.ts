import http from "node:http";
import { describe, expect, it, vi, beforeAll } from "vitest";
import request from "supertest";
import { appConfig } from "../src/config.js";
import { destroyLoginSession, issueLoginSession } from "../src/auth.js";

process.env.NODE_ENV = "test";
const runNetworkTests = process.env.RUN_NETWORK_TESTS === "1";

const originalListen = (http.Server.prototype as any).listen;
(http.Server.prototype as any).listen = function (...args: any[]) {
  const normalizedArgs: unknown[] = [...args];
  if (!normalizedArgs.length) {
    normalizedArgs.push(0);
  }
  if (typeof normalizedArgs[1] !== "string") {
    normalizedArgs.splice(1, 0, "127.0.0.1");
  }
  return originalListen.apply(this, normalizedArgs);
};

const execFileMock = vi.fn((...args: unknown[]) => {
  const callback = args.find((arg) => typeof arg === "function") as
    | ((...cbArgs: unknown[]) => void)
    | undefined;
  if (typeof callback === "function") {
    callback(null, "", "");
  }
  return {};
});

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args)
}));

type ServerModule = typeof import("../src/server.js");

let app: ServerModule["app"];

beforeAll(async () => {
  const serverModule = await import("../src/server.js");
  app = serverModule.app;
});

(runNetworkTests ? describe : describe.skip)("server API", () => {
  it("exposes meta data without auth", async () => {
    const response = await request(app).get("/api/meta").expect(200);
    expect(response.body).toEqual({
      version: expect.any(String),
      buildId: expect.any(String),
      startedAt: expect.any(String)
    });
    expect(new Date(response.body.startedAt).toString()).not.toBe("Invalid Date");
    expect(response.body.buildId.length).toBeGreaterThanOrEqual(3);
  });

  it("blocks unauthenticated API access", async () => {
    const response = await request(app).get("/api/options").expect(401);
    expect(response.body).toEqual({ error: "unauthorized" });
  });

  it("returns 404 for missing terminal debug sessions even when authenticated", async () => {
    const sid = issueLoginSession("admin");
    const cookie = `${appConfig.sessionCookieName}=${encodeURIComponent(sid)}`;
    try {
      const response = await request(app)
        .get("/api/terminal/debug/nonexistent")
        .set("Cookie", cookie)
        .expect(404);
      expect(response.body).toEqual({ error: "session_not_found" });
    } finally {
      destroyLoginSession(sid);
    }
  });
});
