import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { appConfig } from "./config.js";

interface LoginSession {
  username: string;
  email?: string;
  issuedAt: number;
  expiresAt: number;
}

const loginSessions = new Map<string, LoginSession>();

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function timingSafeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function parseScryptHash(encoded: string): { salt: string; hash: string } | null {
  const [kind, salt, hash] = encoded.split("$");
  if (kind !== "scrypt" || !salt || !hash) return null;
  return { salt, hash };
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(username: string, password: string): { valid: boolean; username: string } {
  // Check against users list
  for (const user of appConfig.users) {
    if (user.username !== username) continue;

    // Handle plain password (for development/testing)
    if (user.passwordHash.startsWith("plain:")) {
      const plainPassword = user.passwordHash.slice(6);
      if (timingSafeEqual(plainPassword, password)) {
        return { valid: true, username: user.username };
      }
      continue;
    }

    // Handle scrypt hash
    const parsed = parseScryptHash(user.passwordHash);
    if (!parsed) continue;
    const computed = crypto.scryptSync(password, parsed.salt, 64).toString("hex");
    if (timingSafeEqual(parsed.hash, computed)) {
      return { valid: true, username: user.username };
    }
  }
  return { valid: false, username: "" };
}

export function listUsers(): string[] {
  return appConfig.users.map(u => u.username);
}

export function addUser(username: string, passwordHash: string): boolean {
  // Check if user already exists
  if (appConfig.users.some(u => u.username === username)) {
    return false;
  }
  appConfig.users.push({ username, passwordHash });
  return true;
}

export function removeUser(username: string): boolean {
  const index = appConfig.users.findIndex(u => u.username === username);
  if (index === -1) return false;
  appConfig.users.splice(index, 1);
  return true;
}

function parseCookies(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = decodeURIComponent(part.slice(index + 1).trim());
    out[key] = value;
  }
  return out;
}

function getCookieSessionId(req: Request): string | null {
  const cookies = parseCookies(req.header("cookie"));
  return cookies[appConfig.sessionCookieName] || null;
}

export function issueLoginSession(username: string, email?: string): string {
  const sid = crypto.randomBytes(24).toString("base64url");
  const issuedAt = nowSeconds();
  loginSessions.set(sid, {
    username,
    email,
    issuedAt,
    expiresAt: issuedAt + appConfig.authTokenTtlSeconds
  });
  return sid;
}

export function destroyLoginSession(sessionId: string): void {
  loginSessions.delete(sessionId);
}

export function destroyLoginSessionFromRequest(req: Request): void {
  const sid = getCookieSessionId(req);
  if (!sid) return;
  loginSessions.delete(sid);
}

export function resolveCloudflareIdentity(req: Request): string | null {
  const email = req.header("CF-Access-Authenticated-User-Email")?.trim();
  return email || null;
}

export function setSessionCookie(res: Response, sid: string): void {
  const maxAgeMs = appConfig.authTokenTtlSeconds * 1000;
  const secureAttr = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const cookie = `${appConfig.sessionCookieName}=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Strict${secureAttr}; Max-Age=${appConfig.authTokenTtlSeconds}`;
  res.setHeader("Set-Cookie", cookie);
  res.setHeader("X-Session-Max-Age-Ms", String(maxAgeMs));
}

export function clearSessionCookie(res: Response): void {
  const secureAttr = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const cookie = `${appConfig.sessionCookieName}=; Path=/; HttpOnly; SameSite=Strict${secureAttr}; Max-Age=0`;
  res.setHeader("Set-Cookie", cookie);
}

export function getLoginSession(req: Request): LoginSession | null {
  const sid = getCookieSessionId(req);
  if (!sid) return null;
  const session = loginSessions.get(sid);
  if (!session) return null;
  if (session.expiresAt <= nowSeconds()) {
    loginSessions.delete(sid);
    return null;
  }
  return session;
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const session = getLoginSession(req);
  if (!session) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  (req as Request & { auth?: LoginSession }).auth = session;
  next();
}

export function getSocketSessionFromCookieHeader(cookieHeader: string | undefined): LoginSession | null {
  const cookies = parseCookies(cookieHeader);
  const sid = cookies[appConfig.sessionCookieName];
  if (!sid) return null;
  const session = loginSessions.get(sid);
  if (!session) return null;
  if (session.expiresAt <= nowSeconds()) {
    loginSessions.delete(sid);
    return null;
  }
  return session;
}

interface SocketTicketPayload {
  username: string;
  expiresAt: number;
}

function signPayload(payloadEncoded: string): string {
  const secret = appConfig.localBootstrapSecret || "change-me";
  return crypto.createHmac("sha256", secret).update(payloadEncoded).digest("base64url");
}

export function issueSocketTicket(username: string): string {
  const payload: SocketTicketPayload = {
    username,
    expiresAt: nowSeconds() + 120
  };
  const payloadEncoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = signPayload(payloadEncoded);
  return `${payloadEncoded}.${sig}`;
}

export function verifySocketTicket(ticket: string): SocketTicketPayload | null {
  const [payloadEncoded, sig] = ticket.split(".");
  if (!payloadEncoded || !sig) return null;
  if (!timingSafeEqual(signPayload(payloadEncoded), sig)) return null;
  const payload = JSON.parse(Buffer.from(payloadEncoded, "base64url").toString("utf8")) as SocketTicketPayload;
  if (!payload?.username) return null;
  if (payload.expiresAt <= nowSeconds()) return null;
  return payload;
}
