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
  // First try credentials.json
  const credFile = path.join(process.cwd(), "credentials.json");
  if (existsSync(credFile)) {
    try {
      const content = readFileSync(credFile, "utf8");
      const cred = JSON.parse(content) as { username: string; passwordHash: string };
      if (cred.username && cred.passwordHash) {
        // Validate scrypt hash format
        if (!cred.passwordHash.startsWith("scrypt$")) {
          console.error("Invalid password hash format in credentials.json. Please use scrypt hash format.");
          console.error("Run: node -e \"const crypto=require('crypto');const salt=crypto.randomBytes(16).toString('hex');const hash=crypto.scryptSync(process.argv[1], salt, 64).toString('hex');console.log('scrypt$'+salt+'$'+hash)\" <password>");
          process.exit(1);
        }
        return [{ username: cred.username, passwordHash: cred.passwordHash }];
      }
    } catch {
      // Fall back to env
    }
  }
  // Fall back to env (only supports ADMIN_PASSWORD_HASH for security)
  const adminUsername = process.env.ADMIN_USERNAME || "admin";
  const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH || "";

  if (adminPasswordHash) {
    if (!adminPasswordHash.startsWith("scrypt$")) {
      console.error("Invalid ADMIN_PASSWORD_HASH format. Please use scrypt hash format.");
      console.error("Run: node -e \"const crypto=require('crypto');const salt=crypto.randomBytes(16).toString('hex');const hash=crypto.scryptSync(process.argv[1], salt, 64).toString('hex');console.log('scrypt$'+salt+'$'+hash)\" <password>");
      process.exit(1);
    }
    return [{ username: adminUsername, passwordHash: adminPasswordHash }];
  }
  return [];
}

// Export reloadUsers function to allow reloading users after credentials.json changes
export function reloadUsers(): void {
  appConfig.users = loadUsers();
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
  cookieSecure: bool(process.env.COOKIE_SECURE, true),
  localBootstrapSecret: process.env.LOCAL_BOOTSTRAP_SECRET ||
    (() => { throw new Error("LOCAL_BOOTSTRAP_SECRET must be set"); })(),
  authTokenTtlSeconds: num(process.env.AUTH_TOKEN_TTL_SECONDS, 8 * 3600),
  sessionCookieName: process.env.SESSION_COOKIE_NAME || "msd_sid",
  users: loadUsers()
};
