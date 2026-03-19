import { Router } from "express";
import { z } from "zod";
import {
  addUser,
  authMiddleware,
  clearSessionCookie,
  destroyLoginSessionFromRequest,
  getLoginSession,
  hashPassword,
  issueLoginSession,
  listUsers,
  removeUser,
  resolveCloudflareIdentity,
  setSessionCookie,
  verifyPassword
} from "../auth.js";
import { appConfig, reloadUsers } from "../config.js";

const router = Router();

// Check login rate limit (defined in server.ts)
declare function checkLoginRateLimit(clientIp: string): boolean;

export function setLoginRateLimiter(fn: (clientIp: string) => boolean): void {
  (router as typeof router & { checkLoginRateLimit: typeof checkLoginRateLimit }).checkLoginRateLimit = fn;
}

// POST /api/login
router.post("/login", (req, res) => {
  const clientIp = req.ip || req.socket.remoteAddress || "unknown";
  const checkRateLimit = (router as typeof router & { checkLoginRateLimit?: (clientIp: string) => boolean }).checkLoginRateLimit;
  if (checkRateLimit && !checkRateLimit(clientIp)) {
    res.status(429).json({ error: "too_many_login_attempts", message: "Please try again later" });
    return;
  }

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

// POST /api/logout
router.post("/logout", (req, res) => {
  destroyLoginSessionFromRequest(req);
  clearSessionCookie(res);
  res.status(204).send();
});

// GET /api/me
router.get("/me", (req, res) => {
  const session = getLoginSession(req);
  if (!session) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  res.json({ username: session.username, email: session.email || null, expiresAt: session.expiresAt });
});

// GET /api/admin/users (admin only)
router.get("/admin/users", authMiddleware, (_req, res) => {
  const users = listUsers();
  res.json({ users });
});

// POST /api/admin/users (admin only)
router.post("/admin/users", authMiddleware, async (req, res) => {
  const schema = z.object({
    username: z.string().min(1),
    password: z.string().min(1)
  });
  try {
    const parsed = schema.parse(req.body);
    const passwordHash = hashPassword(parsed.password);
    if (addUser(parsed.username, passwordHash)) {
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

// DELETE /api/admin/users/:username (admin only)
router.delete("/admin/users/:username", authMiddleware, async (req, res) => {
  const username = String(req.params.username);
  if (appConfig.users.length <= 1) {
    res.status(400).json({ error: "cannot_delete_last_user" });
    return;
  }
  if (removeUser(username)) {
    const fs = await import("node:fs");
    const pathModule = await import("node:path");
    const usersFile = pathModule.join(process.cwd(), "users.json");
    fs.writeFileSync(usersFile, JSON.stringify(appConfig.users, null, 2));
    res.json({ ok: true });
  } else {
    res.status(404).json({ error: "user_not_found" });
  }
});

// POST /api/admin/change-password (admin only)
router.post("/admin/change-password", authMiddleware, async (req, res) => {
  const schema = z.object({
    newPassword: z.string().min(8, "Password must be at least 8 characters")
  });
  try {
    const parsed = schema.parse(req.body);
    const session = getLoginSession(req);
    if (!session) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const passwordHash = hashPassword(parsed.newPassword);
    const fs = await import("node:fs");
    const pathModule = await import("node:path");
    const credPath = pathModule.join(process.cwd(), "credentials.json");
    const cred = { username: session.username, passwordHash: passwordHash };
    fs.writeFileSync(credPath, JSON.stringify(cred, null, 2));
    reloadUsers();
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: "change_password_failed", detail: String(err) });
  }
});

// POST /api/admin/change-username (admin only)
router.post("/admin/change-username", authMiddleware, async (req, res) => {
  const schema = z.object({
    newUsername: z.string().min(1)
  });
  try {
    const parsed = schema.parse(req.body);
    const fs = await import("node:fs");
    const pathModule = await import("node:path");
    const { existsSync } = await import("node:fs");
    const credPath = pathModule.join(process.cwd(), "credentials.json");
    let cred: { username: string; passwordHash?: string } = { username: "admin" };
    if (existsSync(credPath)) {
      try {
        cred = JSON.parse(fs.readFileSync(credPath, "utf8"));
      } catch { /* ignore */ }
    }
    if (!cred.passwordHash) {
      const session = getLoginSession(req);
      cred.passwordHash = hashPassword(session?.username === cred.username ? "admin" : "admin");
    }
    cred.username = parsed.newUsername;
    fs.writeFileSync(credPath, JSON.stringify(cred, null, 2));
    reloadUsers();
    res.json({ ok: true, username: parsed.newUsername });
  } catch (err) {
    res.status(400).json({ error: "change_username_failed", detail: String(err) });
  }
});

export default router;
