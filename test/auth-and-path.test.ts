import { describe, expect, it } from "vitest";
import {
  destroyLoginSessionFromRequest,
  getLoginSession,
  getSocketSessionFromCookieHeader,
  hashPassword,
  issueLoginSession
} from "../src/auth.js";
import { appConfig } from "../src/config.js";
import { resolveSafePath } from "../src/file-policy.js";

describe("auth login sessions", () => {
  it("creates cookie session and resolves it from request", () => {
    const sid = issueLoginSession("admin", "admin@example.com");
    const req = {
      header: (name: string) => (name.toLowerCase() === "cookie" ? `${appConfig.sessionCookieName}=${sid}` : undefined)
    } as any;

    const session = getLoginSession(req);
    expect(session?.username).toBe("admin");
    expect(session?.email).toBe("admin@example.com");

    destroyLoginSessionFromRequest(req);
    expect(getLoginSession(req)).toBeNull();
  });

  it("resolves socket session from cookie header", () => {
    const sid = issueLoginSession("admin");
    const session = getSocketSessionFromCookieHeader(`foo=bar; ${appConfig.sessionCookieName}=${sid}`);
    expect(session?.username).toBe("admin");
  });

  it("hashes password using scrypt format", () => {
    const hash = hashPassword("secret");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(hash.split("$").length).toBe(3);
  });
});

describe("file policy", () => {
  it("rejects path outside roots", async () => {
    await expect(resolveSafePath("/etc/passwd")).rejects.toThrowError();
  });
});
