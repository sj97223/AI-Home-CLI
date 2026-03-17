# Load Testing Magnum SSH Dash

Everything in `scripts/` is standalone so you can exercise the HTTP APIs without touching the web UI. Follow the sections below to run a ramped load profile, emit a machine-readable report, and summarize it against sensible thresholds.

## Running the load test runner

The runner is `tsx scripts/loadtest.ts`. It uses the login/session/keepalive/debug/delete loop plus `/api/healthz` to keep a steady stream of requests across the configured concurrency window.

### Configuration

| Flag / Env var | Description | Default |
| --- | --- | --- |
| `--base-url` / `LOADTEST_BASE_URL` | Root URL for the Magnum SSH Dash instance | `http://127.0.0.1:3000` |
| `--username` / `LOADTEST_USERNAME` | Admin username for `/api/login` | *required* |
| `--password` / `LOADTEST_PASSWORD` | Admin password for `/api/login` | *required* |
| `--concurrency` / `LOADTEST_CONCURRENCY` | Number of simultaneous worker flows | `5` |
| `--duration-sec` / `LOADTEST_DURATION_SEC` | Total test duration | `60` |
| `--ramp-sec` / `LOADTEST_RAMP_SEC` | Seconds to ramp from zero to full concurrency | `15` |
| `--report-file` / `LOADTEST_REPORT_FILE` | Optional path to persist the JSON report | (none) |

The runner always emits the JSON report to `stdout`, so you can pipe it directly into `scripts/loadtest-report.ts` or tee it into a file. Example:

```bash
LOADTEST_USERNAME=admin \
LOADTEST_PASSWORD=foo \
tsx scripts/loadtest.ts --base-url https://dash.example.com \
  --concurrency 10 --duration-sec 120 --ramp-sec 30 \
  --report-file /tmp/magnum-load.json
```

If you omit `--report-file`, capture the JSON by piping it straight into the summarizer:

```bash
tsx scripts/loadtest.ts --username admin --password foo --duration-sec 90 \
  | tsx scripts/loadtest-report.ts --report -
```

## Summarizing a report

`tsx scripts/loadtest-report.ts --report <file>` interprets the JSON produced by the runner and prints a compact pass/fail summary. Built-in thresholds target a medium load profile so you can smoke-test new deployments quickly:

* Overall failure rate ≤ 5% unless overridden via `--max-total-failure-rate` / `LOADTEST_SUMMARY_MAX_FAILURE_RATE`.
* Health check failure rate ≤ 1% (`--max-health-failure-rate`).
* P95 latency thresholds (login: 1.2s, create-session: 2.0s, keepalive: 1.2s) via `--max-*-p95` or the matching `LOADTEST_SUMMARY_MAX_*` env vars.
* Any runtime-missing responses from `/api/terminal/debug/:sessionId` fail the summary unless you raise `--max-debug-runtime-missing`.

Example summary run:

```bash
tsx scripts/loadtest-report.ts --report /tmp/magnum-load.json
```

If the summary fails, the script exits with code `2` so it can be used in automation and CI.
