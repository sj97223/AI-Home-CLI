import { config as loadEnv } from "dotenv";
import { homedir } from "node:os";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

loadEnv();

function bool(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function num(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const defaultRoot = path.join(homedir(), "Documents");

// Load users from users.json if exists, otherwise use admin from env
interface User {
  username: string;
  passwordHash: string;
}

function loadUsers(): User[] {
  const usersFile = path.join(process.cwd(), "users.json");
  if (existsSync(usersFile)) {
    try {
      const content = readFileSync(usersFile, "utf8");
      return JSON.parse(content) as User[];
    } catch {
      // Fall back to admin user
    }
  }
  // Default: admin user from env
  const adminUsername = process.env.ADMIN_USERNAME || "admin";
  const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH || "";
  const adminPassword = process.env.ADMIN_PASSWORD || "";

  // If we have a hash, use it; otherwise use plain password
  if (adminPasswordHash) {
    return [{ username: adminUsername, passwordHash: adminPasswordHash }];
  } else if (adminPassword) {
    // For plain password, we'll handle it in auth.ts
    return [{ username: adminUsername, passwordHash: "plain:" + adminPassword }];
  }
  return [];
}

export const appConfig = {
  host: process.env.HOST || "127.0.0.1",
  port: num(process.env.PORT, 3000),
  shellPath: process.env.SHELL_PATH || "/bin/zsh",
  sessionPrefix: process.env.SESSION_PREFIX || "msd",
  maxUploadMB: num(process.env.MAX_UPLOAD_MB, 50),
  allowedRoots: (process.env.ALLOWED_ROOTS || defaultRoot)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  requireCloudflareAccess: bool(process.env.REQUIRE_CF_ACCESS, true),
  localBootstrapSecret: process.env.LOCAL_BOOTSTRAP_SECRET || "change-me",
  authTokenTtlSeconds: num(process.env.AUTH_TOKEN_TTL_SECONDS, 8 * 3600),
  sessionCookieName: process.env.SESSION_COOKIE_NAME || "msd_sid",
  users: loadUsers()
};
