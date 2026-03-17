import path from "node:path";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3000;
const DEFAULT_SCHEME = "http";
const DEFAULT_TIMEOUT_MS = 8000;

interface ScriptConfig {
  baseUrl: URL;
  username: string;
  password: string;
  cfEmail?: string;
  timeoutMs: number;
  sessionCookieName: string;
}

type GateStatus = "PASS" | "FAIL";

interface GateResult {
  label: string;
  status: GateStatus;
  threshold?: string;
  detail: string;
}

interface MetaPayload {
  version: string;
  buildId: string;
  startedAt: string;
}

interface OptionsPayload {
  allowedRoots: string[];
  defaultCwd: string;
}

class CookieJar {
  private value: string | undefined;

  constructor(private readonly cookieName: string) {}

  setFromHeaders(headers: Headers): void {
    const rawHeaders = (headers as Headers & { raw?: () => Record<string, string[]> }).raw?.() ?? {};
    const cookies = rawHeaders["set-cookie"] ?? [];
    if (!cookies.length) {
      const single = headers.get("set-cookie");
      if (single) cookies.push(single);
    }
    for (const cookie of cookies) {
      const [pair] = cookie.split(";");
      if (!pair) continue;
      const index = pair.indexOf("=");
      if (index <= 0) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1);
      if (name !== this.cookieName) continue;
      if (value === "") {
        this.value = undefined;
      } else {
        this.value = decodeURIComponent(value);
      }
    }
  }

  get header(): string | undefined {
    if (!this.value) return undefined;
    return `${this.cookieName}=${this.value}`;
  }
}

class RunContext {
  readonly gates: GateResult[] = [];
  readonly cookieJar: CookieJar;
  hasAuth = false;
  needsLogout = false;
  loginError?: string;
  sessionId?: string;
  sessionDeleted = false;
  terminalId?: string;
  options?: OptionsPayload;
  meta?: MetaPayload;

  constructor(readonly config: ScriptConfig, readonly localVersion: string, readonly localBuildId: string) {
    this.cookieJar = new CookieJar(config.sessionCookieName);
  }

  addGate(label: string, status: GateStatus, detail: string, threshold?: string): void {
    this.gates.push({ label, status, detail, threshold });
  }

  get failedCount(): number {
    return this.gates.filter((gate) => gate.status === "FAIL").length;
  }

  async request(pathname: string, init: RequestInit = {}, opts: { timeoutMs?: number } = {}) {
    const target = new URL(pathname, this.config.baseUrl);
    const timeoutMs = opts.timeoutMs ?? this.config.timeoutMs;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resolvedHeaders = normalizeHeaders(init.headers);
      if (!resolvedHeaders["Accept"]) {
        resolvedHeaders["Accept"] = "application/json";
      }
      const cookieHeader = this.cookieJar.header;
      if (cookieHeader) {
        resolvedHeaders["Cookie"] = cookieHeader;
      }
      const response = await fetch(target.toString(), {
        ...init,
        headers: resolvedHeaders,
        signal: controller.signal
      });
      this.cookieJar.setFromHeaders(response.headers);
      const text = await response.text();
      let body: unknown = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = text;
        }
      }
      return { response, body, text };
    } finally {
      clearTimeout(timeout);
    }
  }

  async cleanup(): Promise<void> {
    if (this.terminalId && this.sessionId) {
      try {
        await this.request(`/api/sessions/${this.sessionId}/terminal/http/stop`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ terminalId: this.terminalId }) }, { timeoutMs: this.config.timeoutMs });
      } catch {
        // best-effort
      } finally {
        this.terminalId = undefined;
      }
    }
    if (this.sessionId && !this.sessionDeleted) {
      try {
        await this.request(`/api/sessions/${this.sessionId}`, { method: "DELETE" }, { timeoutMs: this.config.timeoutMs });
      } catch {
        // best-effort
      } finally {
        this.sessionId = undefined;
      }
    }
    if (this.needsLogout && this.hasAuth) {
      try {
        await this.request("/api/logout", { method: "POST" }, { timeoutMs: this.config.timeoutMs });
      } catch {
        // best-effort
      } finally {
        this.needsLogout = false;
      }
    }
  }

  printReport(): void {
    const header = ["Gate", "Status", "Threshold", "Details"];
    const columns = [
      Math.max(...this.gates.map((g) => g.label.length), header[0].length),
      header[1].length,
      Math.max(...this.gates.map((g) => g.threshold?.length ?? 0), header[2].length),
      Math.max(...this.gates.map((g) => g.detail.length), header[3].length)
    ];
    const line = columns.map((len) => "-".repeat(len)).join("-+-");
    const pad = (value: string, width: number) => value.padEnd(width);
    console.log("\nRelease readiness gates:");
    console.log(`${pad(header[0], columns[0])} | ${pad(header[1], columns[1])} | ${pad(header[2], columns[2])} | ${pad(header[3], columns[3])}`);
    console.log(line);
    for (const gate of this.gates) {
      console.log(`${pad(gate.label, columns[0])} | ${pad(gate.status, columns[1])} | ${pad(gate.threshold ?? "-", columns[2])} | ${pad(gate.detail, columns[3])}`);
    }
    const summary = this.failedCount === 0 ? `All gates passed (${this.gates.length}/${this.gates.length}).` : `${this.failedCount} gate(s) failed.`;
    console.log(`\n${summary}`);
  }
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const normalized: Record<string, string> = {};
  if (!headers) return normalized;
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    headers.forEach((value, key) => {
      normalized[key] = value;
    });
  } else if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      normalized[key] = value;
    }
  } else {
    for (const [key, value] of Object.entries(headers)) {
      if (value === undefined) continue;
      normalized[key] = String(value);
    }
  }
  return normalized;
}

function parseFlagArguments(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith("--")) continue;
    const [rawKey, rawValue] = token.slice(2).split("=", 2);
    const key = rawKey.trim();
    if (!key) continue;
    if (rawValue !== undefined) {
      flags[key] = rawValue;
      continue;
    }
    const next = args[i + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = "true";
    }
  }
  return flags;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "(unknown error)";
  }
}

function toMetaPayload(body: unknown): MetaPayload | null {
  if (typeof body !== "object" || body === null) return null;
  const payload = body as Record<string, unknown>;
  const version = typeof payload.version === "string" ? payload.version : "";
  const buildId = typeof payload.buildId === "string" ? payload.buildId : "";
  const startedAt = typeof payload.startedAt === "string" ? payload.startedAt : "";
  if (!version && !buildId && !startedAt) return null;
  return { version, buildId, startedAt };
}

function toOptionsPayload(body: unknown): OptionsPayload | null {
  if (typeof body !== "object" || body === null) return null;
  const payload = body as Record<string, unknown>;
  const roots = Array.isArray(payload.allowedRoots)
    ? payload.allowedRoots.filter((item) => typeof item === "string") as string[]
    : [];
  const defaultCwd = typeof payload.defaultCwd === "string" ? payload.defaultCwd : "";
  return { allowedRoots: roots, defaultCwd };
}

function computeLocalBuildId(version: string): string {
  const hash = createHash("sha1");
  hash.update(version);
  const candidates = [
    path.join(process.cwd(), "dist", "src", "server.js"),
    path.join(process.cwd(), "public", "index.html")
  ];
  for (const candidate of candidates) {
    try {
      const data = readFileSync(candidate);
      hash.update(data);
    } catch {
      hash.update(candidate);
    }
  }
  return hash.digest("hex").slice(0, 10);
}

function loadPackageVersion(): string {
  try {
    const raw = readFileSync(path.join(process.cwd(), "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "dev";
  } catch {
    return "dev";
  }
}

async function performHealthCheck(ctx: RunContext): Promise<void> {
  const label = "Service health";
  const threshold = "status=ok; ts within 30s";
  try {
    const { response, body } = await ctx.request("/api/healthz", { method: "GET" });
    const payload = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const status = typeof payload.status === "string" ? payload.status : "missing";
    const tsRaw = typeof payload.ts === "string" ? payload.ts : "";
    const timestamp = Date.parse(tsRaw);
    const diff = Number.isNaN(timestamp) ? NaN : Math.abs(Date.now() - timestamp);
    const passed = status === "ok" && !Number.isNaN(diff) && diff <= 30_000 && response.status === 200;
    const detail = `status=${status} tsDiff=${Number.isNaN(diff) ? "invalid" : `${diff}ms`} http=${response.status}`;
    ctx.addGate(label, passed ? "PASS" : "FAIL", detail, threshold);
  } catch (error) {
    ctx.addGate(label, "FAIL", `request error ${extractErrorMessage(error)}`, threshold);
  }
}

async function fetchMeta(ctx: RunContext): Promise<void> {
  const label = "Meta payload";
  const threshold = "version/buildId/startedAt present";
  try {
    const { response, body } = await ctx.request("/api/meta", { method: "GET" });
    const payload = toMetaPayload(body);
    const ok = response.status === 200 && payload !== null;
    const detail = payload
      ? `version=${payload.version} buildId=${payload.buildId} startedAt=${payload.startedAt}`
      : "invalid payload";
    if (ok && payload) {
      ctx.meta = payload;
      ctx.addGate(label, "PASS", detail, threshold);
    } else {
      ctx.addGate(label, "FAIL", detail + ` http=${response.status}`, threshold);
    }
  } catch (error) {
    ctx.addGate(label, "FAIL", `request error ${extractErrorMessage(error)}`, threshold);
  }
}

async function validateMetaVersion(ctx: RunContext): Promise<void> {
  const label = "Meta version match";
  const threshold = "matches local package version";
  if (!ctx.meta) {
    ctx.addGate(label, "FAIL", "missing meta payload", threshold);
    return;
  }
  const passed = ctx.meta.version === ctx.localVersion;
  const detail = `remote=${ctx.meta.version} local=${ctx.localVersion}`;
  ctx.addGate(label, passed ? "PASS" : "FAIL", detail, threshold);
}

async function validateMetaBuildId(ctx: RunContext): Promise<void> {
  const label = "Meta buildId";
  const threshold = "matches local dist/public hash";
  if (!ctx.meta) {
    ctx.addGate(label, "FAIL", "missing meta payload", threshold);
    return;
  }
  const passed = ctx.meta.buildId === ctx.localBuildId;
  const detail = `remote=${ctx.meta.buildId} local=${ctx.localBuildId}`;
  ctx.addGate(label, passed ? "PASS" : "FAIL", detail, threshold);
}

async function validateMetaStartedAt(ctx: RunContext): Promise<void> {
  const label = "Meta startedAt";
  const threshold = "not more than 5s in future";
  if (!ctx.meta) {
    ctx.addGate(label, "FAIL", "missing meta payload", threshold);
    return;
  }
  const parsed = Date.parse(ctx.meta.startedAt);
  const passed = !Number.isNaN(parsed) && parsed <= Date.now() + 5_000;
  const detail = Number.isNaN(parsed)
    ? "invalid timestamp"
    : `startedAt=${ctx.meta.startedAt}`;
  ctx.addGate(label, passed ? "PASS" : "FAIL", detail, threshold);
}

async function performLogin(ctx: RunContext): Promise<void> {
  const label = "Login";
  const threshold = "HTTP 200 with valid credentials (+CF header)";
  const payload = { username: ctx.config.username, password: ctx.config.password };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ctx.config.cfEmail) {
    headers["CF-Access-Authenticated-User-Email"] = ctx.config.cfEmail;
  }
  try {
    const { response, body } = await ctx.request(
      "/api/login",
      {
        method: "POST",
        headers,
        body: JSON.stringify(payload)
      }
    );
    const serverBody = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const ok = response.status === 200 && serverBody.ok === true;
    const errorCode = typeof serverBody.error === "string" ? serverBody.error : undefined;
    const detail = `http=${response.status}` + (errorCode ? ` error=${errorCode}` : "");
    if (ok) {
      ctx.hasAuth = true;
      ctx.needsLogout = true;
      ctx.loginError = undefined;
      ctx.addGate(label, "PASS", detail, threshold);
    } else {
      ctx.loginError = detail;
      ctx.addGate(label, "FAIL", detail, threshold);
    }
  } catch (error) {
    const message = extractErrorMessage(error);
    ctx.loginError = message;
    ctx.addGate(label, "FAIL", `request error ${message}`, threshold);
  }
}

async function checkMe(ctx: RunContext): Promise<void> {
  const label = "Authenticated identity";
  const threshold = "/api/me returns matched username";
  if (!ctx.hasAuth) {
    ctx.addGate(label, "FAIL", ctx.loginError ? `skipped because login failed (${ctx.loginError})` : "skipped because login missing", threshold);
    return;
  }
  try {
    const { response, body } = await ctx.request("/api/me", { method: "GET" });
    const payload = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const username = typeof payload.username === "string" ? payload.username : "";
    const detail = `http=${response.status} username=${username}`;
    const passed = response.status === 200 && username === ctx.config.username;
    ctx.addGate(label, passed ? "PASS" : "FAIL", detail, threshold);
  } catch (error) {
    ctx.addGate(label, "FAIL", `request error ${extractErrorMessage(error)}`, threshold);
  }
}

async function checkOptions(ctx: RunContext): Promise<void> {
  const label = "Options";
  const threshold = "allowedRoots list >= 1";
  if (!ctx.hasAuth) {
    ctx.addGate(label, "FAIL", "skipped because login failed", threshold);
    return;
  }
  try {
    const { response, body } = await ctx.request("/api/options", { method: "GET" });
    const payload = toOptionsPayload(body);
    const count = payload ? payload.allowedRoots.length : 0;
    const detail = `http=${response.status} roots=${count}`;
    const passed = response.status === 200 && payload !== null && count > 0;
    if (passed && payload) {
      ctx.options = payload;
      ctx.addGate(label, "PASS", detail, threshold);
    } else {
      ctx.addGate(label, "FAIL", detail, threshold);
    }
  } catch (error) {
    ctx.addGate(label, "FAIL", `request error ${extractErrorMessage(error)}`, threshold);
  }
}

async function runSessionLifecycle(ctx: RunContext): Promise<void> {
  await createSessionGate(ctx);
  await terminalHttpGate(ctx);
  await terminalCaptureGate(ctx);
  await terminalDebugGate(ctx);
  await terminalStopGate(ctx);
  await deleteSessionGate(ctx);
}

async function createSessionGate(ctx: RunContext): Promise<void> {
  const label = "Create session";
  const threshold = "returns HTTP 201 and session id";
  if (!ctx.hasAuth) {
    ctx.addGate(label, "FAIL", ctx.loginError ? `login failed (${ctx.loginError})` : "login missing", threshold);
    return;
  }
  const root = ctx.options?.allowedRoots[0];
  if (!root) {
    ctx.addGate(label, "FAIL", "no allowed root reported", threshold);
    return;
  }
  try {
    const { response, body } = await ctx.request(
      "/api/sessions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: root, displayName: "release-check" })
      }
    );
    const payload = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const sessionId = typeof payload.id === "string" ? payload.id : undefined;
    const detail = `http=${response.status} id=${sessionId ?? "missing"}`;
    const passed = response.status === 201 && Boolean(sessionId);
    if (passed && sessionId) {
      ctx.sessionId = sessionId;
      ctx.addGate(label, "PASS", detail, threshold);
    } else {
      ctx.addGate(label, "FAIL", detail, threshold);
    }
  } catch (error) {
    ctx.addGate(label, "FAIL", `request error ${extractErrorMessage(error)}`, threshold);
  }
}

async function terminalHttpGate(ctx: RunContext): Promise<void> {
  const label = "Terminal HTTP start/poll";
  const threshold = "start returns 201, poll returns JSON";
  if (!ctx.sessionId) {
    ctx.addGate(label, "FAIL", "session missing", threshold);
    return;
  }
  try {
    const { response: startResp, body: startBody } = await ctx.request(
      `/api/sessions/${ctx.sessionId}/terminal/http/start`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cols: 80, rows: 24 })
      }
    );
    const data = typeof startBody === "object" && startBody !== null ? (startBody as Record<string, unknown>) : {};
    const terminalId = typeof data.terminalId === "string" ? data.terminalId : undefined;
    const startDetail = `start http=${startResp.status} id=${terminalId ?? "missing"}`;
    const startPassed = startResp.status === 201 && Boolean(terminalId);
    if (!startPassed || !terminalId) {
      ctx.addGate(label, "FAIL", startDetail, threshold);
      return;
    }
    ctx.terminalId = terminalId;
    const { response: pollResp, body: pollBody } = await ctx.request(
      `/api/sessions/${ctx.sessionId}/terminal/http/poll?terminalId=${encodeURIComponent(terminalId)}`,
      { method: "GET" }
    );
    const pollPayload = typeof pollBody === "object" && pollBody !== null ? (pollBody as Record<string, unknown>) : {};
    const chunks = Array.isArray(pollPayload.chunks) ? pollPayload.chunks : [];
    const closed = Boolean(pollPayload.closed);
    const pollDetail = `poll http=${pollResp.status} chunks=${chunks.length} closed=${closed}`;
    const pollPassed = pollResp.status === 200;
    if (pollPassed) {
      ctx.addGate(label, "PASS", `${startDetail}; ${pollDetail}`, threshold);
    } else {
      ctx.addGate(label, "FAIL", `${startDetail}; ${pollDetail}`, threshold);
    }
  } catch (error) {
    ctx.addGate(label, "FAIL", `request error ${extractErrorMessage(error)}`, threshold);
  }
}

async function terminalCaptureGate(ctx: RunContext): Promise<void> {
  const label = "Terminal capture";
  const threshold = "GET returns output string";
  if (!ctx.sessionId) {
    ctx.addGate(label, "FAIL", "session missing", threshold);
    return;
  }
  try {
    const { response, body } = await ctx.request(`/api/sessions/${ctx.sessionId}/terminal/capture`, { method: "GET" });
    const payload = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const output = typeof payload.output === "string" ? payload.output : "";
    const detail = `http=${response.status} size=${output.length}`;
    const passed = response.status === 200;
    ctx.addGate(label, passed ? "PASS" : "FAIL", detail, threshold);
  } catch (error) {
    ctx.addGate(label, "FAIL", `request error ${extractErrorMessage(error)}`, threshold);
  }
}

async function terminalDebugGate(ctx: RunContext): Promise<void> {
  const label = "Terminal debug";
  const threshold = "GET returns runtime metadata";
  if (!ctx.sessionId) {
    ctx.addGate(label, "FAIL", "session missing", threshold);
    return;
  }
  try {
    const { response, body } = await ctx.request(`/api/terminal/debug/${ctx.sessionId}`, { method: "GET" });
    const payload = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : "";
    const hasRuntime = Boolean(payload.hasRuntime);
    const detail = `http=${response.status} session=${sessionId} runtime=${hasRuntime}`;
    const passed = response.status === 200 && sessionId === ctx.sessionId;
    ctx.addGate(label, passed ? "PASS" : "FAIL", detail, threshold);
  } catch (error) {
    ctx.addGate(label, "FAIL", `request error ${extractErrorMessage(error)}`, threshold);
  }
}

async function terminalStopGate(ctx: RunContext): Promise<void> {
  const label = "Terminal HTTP stop";
  const threshold = "POST returns 204";
  if (!ctx.sessionId || !ctx.terminalId) {
    ctx.addGate(label, "FAIL", "terminal not started", threshold);
    return;
  }
  try {
    const { response } = await ctx.request(
      `/api/sessions/${ctx.sessionId}/terminal/http/stop`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terminalId: ctx.terminalId })
      }
    );
    const detail = `http=${response.status}`;
    const passed = response.status === 204;
    ctx.addGate(label, passed ? "PASS" : "FAIL", detail, threshold);
  } catch (error) {
    ctx.addGate(label, "FAIL", `request error ${extractErrorMessage(error)}`, threshold);
  } finally {
    ctx.terminalId = undefined;
  }
}

async function deleteSessionGate(ctx: RunContext): Promise<void> {
  const label = "Delete session";
  const threshold = "HTTP 204";
  if (!ctx.sessionId) {
    ctx.addGate(label, "FAIL", "session missing", threshold);
    return;
  }
  try {
    const { response } = await ctx.request(`/api/sessions/${ctx.sessionId}`, { method: "DELETE" });
    const detail = `http=${response.status}`;
    const passed = response.status === 204;
    if (passed) {
      ctx.sessionDeleted = true;
      ctx.sessionId = undefined;
    }
    ctx.addGate(label, passed ? "PASS" : "FAIL", detail, threshold);
  } catch (error) {
    ctx.addGate(label, "FAIL", `request error ${extractErrorMessage(error)}`, threshold);
  }
}

async function performLogout(ctx: RunContext): Promise<void> {
  const label = "Logout";
  const threshold = "HTTP 204";
  if (!ctx.hasAuth) {
    ctx.addGate(label, "FAIL", "skipped because login failed", threshold);
    return;
  }
  try {
    const { response } = await ctx.request("/api/logout", { method: "POST" });
    const detail = `http=${response.status}`;
    const passed = response.status === 204;
    if (passed) {
      ctx.needsLogout = false;
      ctx.hasAuth = false;
    }
    ctx.addGate(label, passed ? "PASS" : "FAIL", detail, threshold);
  } catch (error) {
    ctx.addGate(label, "FAIL", `request error ${extractErrorMessage(error)}`, threshold);
  }
}

function buildScriptConfig(): ScriptConfig {
  const flags = parseFlagArguments(process.argv.slice(2));
  if (flags.help) {
    printHelp();
    process.exit(0);
  }
  const baseUrlFlag = flags["base-url"] ?? process.env.RELEASE_CHECK_BASE_URL;
  const scheme = (flags.scheme ?? process.env.RELEASE_CHECK_SCHEME ?? DEFAULT_SCHEME).toLowerCase();
  const host = flags.host ?? process.env.RELEASE_CHECK_HOST ?? DEFAULT_HOST;
  const portRaw = flags.port ?? process.env.RELEASE_CHECK_PORT;
  const port = portRaw ? Number(portRaw) : DEFAULT_PORT;
  const username = flags.username ?? process.env.RELEASE_CHECK_USERNAME ?? process.env.ADMIN_USERNAME ?? "admin";
  const password = flags.password ?? process.env.RELEASE_CHECK_PASSWORD ?? process.env.ADMIN_PASSWORD;
  if (!password) {
    throw new Error("ADMIN_PASSWORD or RELEASE_CHECK_PASSWORD must be set");
  }
  const cfEmail = flags["cf-email"] ?? process.env.RELEASE_CHECK_CF_EMAIL;
  const timeoutMs = flags.timeout ? Number(flags.timeout) : DEFAULT_TIMEOUT_MS;
  if (!baseUrlFlag && Number.isNaN(port)) {
    throw new Error("Invalid port");
  }
  const baseUrl = baseUrlFlag
    ? new URL(baseUrlFlag)
    : new URL(`${scheme}://${host}:${port}`);
  return {
    baseUrl,
    username,
    password,
    cfEmail,
    timeoutMs: Number.isNaN(timeoutMs) ? DEFAULT_TIMEOUT_MS : timeoutMs,
    sessionCookieName: flags["cookie-name"] ?? process.env.RELEASE_CHECK_COOKIE_NAME ?? "msd_sid"
  };
}

function printHelp(): void {
  console.log(`usage: release-check.ts [--base-url=<url>] [--host=<host>] [--port=<port>] [--scheme=http|https] [--username=<user>] [--password=<pwd>] [--cf-email=<email>] [--timeout=<ms>]`);
  console.log(`Variables fall back to RELEASE_CHECK_* or ADMIN_* env vars; password is required.`);
}

async function main(): Promise<void> {
  try {
    const config = buildScriptConfig();
    const localVersion = loadPackageVersion();
    const localBuildId = computeLocalBuildId(localVersion);
    const ctx = new RunContext(config, localVersion, localBuildId);
    await performHealthCheck(ctx);
    await fetchMeta(ctx);
    await validateMetaVersion(ctx);
    await validateMetaBuildId(ctx);
    await validateMetaStartedAt(ctx);
    await performLogin(ctx);
    await checkMe(ctx);
    await checkOptions(ctx);
    await runSessionLifecycle(ctx);
    await performLogout(ctx);
    await ctx.cleanup();
    ctx.printReport();
    process.exit(ctx.failedCount > 0 ? 1 : 0);
  } catch (error) {
    console.error("fatal error", extractErrorMessage(error));
    process.exit(1);
  }
}

void main();
