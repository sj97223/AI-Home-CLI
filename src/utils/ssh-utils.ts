import { z } from "zod";

const startupTokenSchema = z.string().regex(/^[A-Za-z0-9_./:@%+=,-]+$/);
const startupCommandSchema = z.string().min(1).max(500);
const sshUserSchema = z.string().regex(/^[A-Za-z0-9._-]+$/);
const sshHostSchema = z.string().regex(/^[A-Za-z0-9.-]+$/);

export function parseStartupArgs(raw: string | undefined): string[] | undefined {
  const text = raw?.trim();
  if (!text) return undefined;
  const safe = startupCommandSchema.parse(text);
  const tokens = safe.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    startupTokenSchema.parse(token);
  }
  return tokens.length ? tokens : undefined;
}

export function buildSafeSshArgs(
  user: string | undefined,
  host: string | undefined,
  port: number | undefined
): string[] | undefined {
  if (!user) return undefined;
  const safeUser = sshUserSchema.parse(user.trim());
  const safeHost = sshHostSchema.parse((host || "127.0.0.1").trim());
  const args = ["ssh"];
  if (port) args.push("-p", String(port));
  args.push(`${safeUser}@${safeHost}`);
  return args;
}
