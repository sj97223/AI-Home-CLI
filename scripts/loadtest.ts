import { writeFile } from "node:fs/promises";
import { setTimeout as wait } from "node:timers/promises";

type OperationName =
  | "login"
  | "options"
  | "createSession"
  | "keepAlive"
  | "deleteSession"
  | "healthCheck";

const OPERATION_NAMES: OperationName[] = [
  "login",
  "options",
  "createSession",
  "keepAlive",
  "deleteSession",
  "healthCheck"
];

interface LoadTestConfig {
  baseUrl: string;
  username: string;
  password: string;
  concurrency: number;
  durationSec: number;
  rampSec: number;
  reportPath?: string;
}

interface OperationStats {
  attempts: number;
  successes: number;
  failures: number;
  latenciesMs: number[];
  failureReasons: Record<string, number>;
}

interface OperationLatencySummary {
  p50: number | null;
  p95: number | null;
  samples: number;
}

interface OperationReport {
  name: OperationName;
  attempts: number;
  successes: number;
  failures: number;
  failureReasons: Record<string, number>;
  latency: OperationLatencySummary;
}

interface DebugIndicators {
  attempts: number;
  runtimeMissing: number;
  hasRuntimeFalse: number;
  closedTrue: number;
  attachedSocketsZero: number;
  lastErrorPresent: number;
}

interface LoadTestReport {
  name: "magnum-ssh-dash-load-test";
  timestamp: string;
  startTime: string;
  endTime: string;
  plannedDurationSec: number;
  actualDurationSec: number;
  config: Omit<LoadTestConfig, "password">;
  iterations: number;
  iterationFailures: number;
  iterationSuccesses: number;
  sessionCreates: number;
  sessionDeletes: number;
  operations: OperationReport[];
  debugIndicators: DebugIndicators;
}

interface OptionsResponse {
  allowedRoots: string[];
  defaultCwd: string;
}

interface CreateSessionResponse {
  id: string;
}

type Action = () => Promise<Response>;

class ApiClient {
  private readonly jar = new Map<string, string>();
  constructor(private readonly baseUrl: string) {}

  private buildHeaders(bodyProvided: boolean): HeadersInit {
    const headers: Record<string, string> = {
      Accept: "application/json"
    };
    if (bodyProvided) {
      headers["Content-Type"] = "application/json";
    }
    const cookieHeader = this.cookieHeader();
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }
    return headers;
  }

  private cookieHeader(): string | undefined {
    if (!this.jar.size) return undefined;
    return [...this.jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  private storeCookies(response: Response): void {
    const raw = response.headers.get("set-cookie");
    if (!raw) return;
    const lines = raw.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      const pair = line.split(";")[0];
      const [name, ...rest] = pair.split("=");
      if (!name) continue;
      this.jar.set(name.trim(), rest.join("=").trim());
    }
  }

  private buildUrl(path: string): string {
    return new URL(path, this.baseUrl).toString();
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    const url = this.buildUrl(path);
    const headers = this.buildHeaders(body !== undefined);
    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    this.storeCookies(response);
    return response;
  }

  get(path: string): Promise<Response> {
    return this.request("GET", path);
  }

  post(path: string, body?: unknown): Promise<Response> {
    return this.request("POST", path, body);
  }

  delete(path: string): Promise<Response> {
    return this.request("DELETE", path);
  }
}

function parseConfig(): LoadTestConfig {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  const getFlag = (key: string): string | undefined => {
    const long = `--${key}`;
    const idx = rawArgs.indexOf(long);
    if (idx >= 0 && idx < rawArgs.length - 1) {
      return rawArgs[idx + 1];
    }
    return undefined;
  };

  const fromEnv = (key: string): string | undefined => process.env[key];

  const baseUrl = getFlag("base-url") ?? fromEnv("LOADTEST_BASE_URL") ?? "http://127.0.0.1:3000";
  const username = getFlag("username") ?? fromEnv("LOADTEST_USERNAME");
  const password = getFlag("password") ?? fromEnv("LOADTEST_PASSWORD");
  const concurrency = parsePositiveInt(getFlag("concurrency") ?? fromEnv("LOADTEST_CONCURRENCY"), 5);
  const durationSec = parsePositiveInt(getFlag("duration-sec") ?? fromEnv("LOADTEST_DURATION_SEC"), 60);
  const rampSec = parseNonNegativeInt(getFlag("ramp-sec") ?? fromEnv("LOADTEST_RAMP_SEC"), 15);
  const reportPath = getFlag("report-file") ?? fromEnv("LOADTEST_REPORT_FILE");

  if (!username || !password) {
    console.error("[loadtest] username and password are required via --username/--password or LOADTEST_USERNAME/LOADTEST_PASSWORD.");
    process.exit(1);
  }

  return {
    baseUrl,
    username,
    password,
    concurrency,
    durationSec,
    rampSec,
    reportPath
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  return fallback;
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return Math.floor(parsed);
  }
  return fallback;
}

function printUsage(): void {
  console.error(`Usage: tsx scripts/loadtest.ts [options]
Options:
  --base-url <url>           Base URL for Magnum SSH Dash (default: http://127.0.0.1:3000)
  --username <name>          Admin username (env LOADTEST_USERNAME)
  --password <secret>        Admin password (env LOADTEST_PASSWORD)
  --concurrency <count>      Number of concurrent workers (default: 5)
  --duration-sec <seconds>   Total duration of the run in seconds (default: 60)
  --ramp-sec <seconds>       Ramp-up duration before reaching full concurrency (default: 15)
  --report-file <path>       Optional file path to persist the JSON report
Environment variables prefixed with LOADTEST_ can provide the same values.`);
}

function createOperationStats(): Record<OperationName, OperationStats> {
  const stats: Record<OperationName, OperationStats> = {} as Record<OperationName, OperationStats>;
  for (const name of OPERATION_NAMES) {
    stats[name] = {
      attempts: 0,
      successes: 0,
      failures: 0,
      latenciesMs: [],
      failureReasons: {}
    };
  }
  return stats;
}

function computePercentile(values: number[], percentile: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((percentile / 100) * (sorted.length - 1)));
  return sorted[index];
}

async function safeJson<T>(response?: Response): Promise<T | undefined> {
  if (!response) return undefined;
  try {
    return (await response.json()) as T;
  } catch {
    return undefined;
  }
}

async function runLoadTest(config: LoadTestConfig): Promise<LoadTestReport> {
  const stats = createOperationStats();
  const debugIndicators: DebugIndicators = {
    attempts: 0,
    runtimeMissing: 0,
    hasRuntimeFalse: 0,
    closedTrue: 0,
    attachedSocketsZero: 0,
    lastErrorPresent: 0
  };
  const counters = {
    iterations: 0,
    iterationFailures: 0,
    iterationSuccesses: 0,
    sessionCreates: 0,
    sessionDeletes: 0
  };

  const startAt = Date.now();
  const runUntil = startAt + config.durationSec * 1000;

  const workerPromises: Promise<void>[] = [];

  for (let workerIndex = 0; workerIndex < config.concurrency; workerIndex++) {
    workerPromises.push(runWorker(workerIndex));
  }

  await Promise.all(workerPromises);

  const endAt = Date.now();

  const operations: OperationReport[] = OPERATION_NAMES.map((name) => {
    const { attempts, successes, failures, failureReasons, latenciesMs } = stats[name];
    return {
      name,
      attempts,
      successes,
      failures,
      failureReasons,
      latency: {
        p50: computePercentile(latenciesMs, 50),
        p95: computePercentile(latenciesMs, 95),
        samples: latenciesMs.length
      }
    };
  });

  debugIndicators.attempts = 0;

  return {
    name: "magnum-ssh-dash-load-test",
    timestamp: new Date().toISOString(),
    startTime: new Date(startAt).toISOString(),
    endTime: new Date(endAt).toISOString(),
    plannedDurationSec: config.durationSec,
    actualDurationSec: (endAt - startAt) / 1000,
    config: {
      baseUrl: config.baseUrl,
      username: config.username,
      concurrency: config.concurrency,
      durationSec: config.durationSec,
      rampSec: config.rampSec,
      reportPath: config.reportPath
    },
    iterations: counters.iterations,
    iterationFailures: counters.iterationFailures,
    iterationSuccesses: counters.iterationSuccesses,
    sessionCreates: counters.sessionCreates,
    sessionDeletes: counters.sessionDeletes,
    operations,
    debugIndicators
  };

  function runWorker(index: number): Promise<void> {
    return (async () => {
      const rampDenominator = Math.max(1, config.concurrency - 1);
      const startDelay = Math.round((config.rampSec * 1000 * index) / rampDenominator);
      if (startDelay > 0) {
        await wait(startDelay);
      }
      while (Date.now() < runUntil) {
        await runIteration(index);
      }
    })();
  }

  async function runIteration(workerIndex: number): Promise<void> {
    const client = new ApiClient(config.baseUrl);
    let sessionId: string | undefined;
    let sessionCreated = false;

    try {
      const loginResult = await performOperation("login", () =>
        client.post("/api/login", { username: config.username, password: config.password })
      );
      if (!loginResult.ok) {
        counters.iterationFailures++;
        return;
      }

      const optionsResult = await performOperation("options", () => client.get("/api/options"));
      if (!optionsResult.ok) {
        counters.iterationFailures++;
        return;
      }
      const optionsPayload = await safeJson<OptionsResponse>(optionsResult.response);
      const cwd = selectCwd(optionsPayload);

      const createResult = await performOperation("createSession", () =>
        client.post("/api/sessions", { tool: "shell", cwd })
      );
      if (!createResult.ok) {
        counters.iterationFailures++;
        return;
      }
      const sessionPayload = await safeJson<CreateSessionResponse>(createResult.response);
      if (!sessionPayload?.id) {
        counters.iterationFailures++;
        return;
      }
      sessionId = sessionPayload.id;
      sessionCreated = true;
      counters.sessionCreates++;
      counters.iterationSuccesses++;
      await performOperation("keepAlive", () => client.post(`/api/sessions/${sessionId}/keepalive`));

    } catch (error) {
      counters.iterationFailures++;
      console.error(
        `[loadtest] worker ${workerIndex} iteration error: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      if (sessionId) {
        counters.sessionDeletes++;
        await performOperation("deleteSession", () => client.delete(`/api/sessions/${sessionId}`));
      }
      await performOperation("healthCheck", () => client.get("/api/healthz"));
      counters.iterations++;
    }
  }

  async function performOperation(name: OperationName, action: Action) {
    const stat = stats[name];
    stat.attempts++;
    const start = Date.now();
    try {
      const response = await action();
      const duration = Date.now() - start;
      stat.latenciesMs.push(duration);
      if (response.ok) {
        stat.successes++;
      } else {
        stat.failures++;
        registerFailure(name, `http:${response.status}`);
      }
      return { response, ok: response.ok };
    } catch (err) {
      const duration = Date.now() - start;
      stat.latenciesMs.push(duration);
      stat.failures++;
      const reason = err instanceof Error ? err.message : String(err);
      registerFailure(name, `exception:${reason}`);
      return { ok: false, error: reason };
    }
  }

  function registerFailure(name: OperationName, reason: string): void {
    const record = stats[name].failureReasons;
    record[reason] = (record[reason] ?? 0) + 1;
  }

  function selectCwd(payload?: OptionsResponse): string {
    if (payload?.allowedRoots?.length) {
      return payload.allowedRoots[0];
    }
    if (payload?.defaultCwd) {
      return payload.defaultCwd;
    }
    return "/tmp";
  }

}

async function main(): Promise<void> {
  const config = parseConfig();
  console.error(
    `[loadtest] starting with concurrency=${config.concurrency}, duration=${config.durationSec}s, ramp=${config.rampSec}s`
  );
  const report = await runLoadTest(config);
  const payload = JSON.stringify(report, null, 2);
  process.stdout.write(`${payload}\n`);
  if (config.reportPath) {
    try {
      await writeFile(config.reportPath, payload + "\n");
      console.error(`[loadtest] report saved to ${config.reportPath}`);
    } catch (error) {
      console.error(`[loadtest] failed to write report: ${
        error instanceof Error ? error.message : String(error)
      }`);
    }
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`[loadtest] failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
