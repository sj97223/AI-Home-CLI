# Release Readiness Checklist

`scripts/release-check.ts` is the canonical gatekeeper before a deployment or hotfix. It exercises the running service end-to-end and prints a concise checklist table; any failed gate causes the script to exit with a non-zero code so the failure can be caught by CI or a deployer.

## Running the check
1. Build and start the service the same way you will ship it (e.g., `npm run build` and `npm run start`).
2. Provide the admin credentials (and optional Cloudflare header) via environment variables or CLI flags:
   * `ADMIN_PASSWORD` / `RELEASE_CHECK_PASSWORD`  **required**
   * `ADMIN_USERNAME` / `RELEASE_CHECK_USERNAME`  (default: `admin`)
   * `RELEASE_CHECK_CF_EMAIL` / `--cf-email`  if Cloudflare Access is enforced
   * `RELEASE_CHECK_BASE_URL` / `--base-url`  to point to a pre-existing host (otherwise use `--host`/`--port`/`--scheme` with `127.0.0.1:3000` defaults)
   * `RELEASE_CHECK_COOKIE_NAME` / `--cookie-name`  if the session cookie name is customized
   * `RELEASE_CHECK_TIMEOUT_MS` / `--timeout`  optional request timeout (default `8000` ms)
3. Invoke the script with `npx tsx scripts/release-check.ts` (it uses the existing `tsx` dev dependency).
4. Watch for the table printed at the end; the script exits `0` only if all gates pass.

Example:
```
RELEASE_CHECK_PASSWORD="${ADMIN_PASSWORD}" \ 
  RELEASE_CHECK_CF_EMAIL="deploy@example.com" \ 
  npx tsx scripts/release-check.ts --host 127.0.0.1 --port 3000 --timeout 10000
```

## Gate summary
Each gate is listed in the final table with its threshold and a short detail string.

| Gate | Threshold / expectation |
| --- | --- |
| Service health | `/api/healthz` responds `status=ok` and the timestamp is within 30 seconds. |
| Meta payload | `/api/meta` returns `version`, `buildId`, `startedAt`. |
| Meta version match | `meta.version` equals the local `package.json` version. |
| Meta buildId | `meta.buildId` matches the SHA-1 hash computed from `package.json`, `dist/src/server.js`, and `public/index.html`. |
| Meta startedAt | `meta.startedAt` is a valid ISO timestamp not more than 5 seconds in the future. |
| Login | `POST /api/login` returns `200` and `ok: true` (includes optional Cloudflare email header). |
| Authenticated identity | `/api/me` reports the logged-in username. |
| Options | `/api/options` returns an `allowedRoots` array with at least one entry. |
| Create session | `/api/sessions` returns `201` with an `id` for the new tmux session. |
| Terminal HTTP start/poll | `/terminal/http/start` replies `201`, and `/poll` returns JSON data (chunk count may be 0). |
| Terminal capture | `/terminal/capture` responds with an output string (length reported for diagnostics). |
| Terminal debug | `/terminal/debug/:sessionId` responds with runtime metadata for the created session. |
| Terminal HTTP stop | `/terminal/http/stop` returns `204` so the fallback pty can be cleaned up. |
| Delete session | `DELETE /api/sessions/:id` returns `204`, removing the tmux session. |
| Logout | `POST /api/logout` returns `204` and clears the cookie. |

## Interpreting failures
- **Health / meta gates fail**: the process is not healthy, the service did not start, or you are hitting the wrong port/url. Check logs, ensure the server is running, and verify the base URL. If the timestamp is stale (diff > 30s) the service may be hung.
- **Meta version / buildId mismatch**: you are pointing the checker at a version that was not built from the current tree. Rebuild (`npm run build`), ensure the binaries in `dist`/`public` are up to date, and rerun the script so the computed SHA matches the running service.
- **Meta startedAt too far in the future**: system clock drift or time zone misconfiguration. Compare `meta.startedAt` with `date` on the host.
- **Login or identity**: supply the correct admin password and (if required) the Cloudflare Access email. A 401 with `cloudflare_access_required` means the `CF-Access-Authenticated-User-Email` header is missing or invalid.
- **Options / session creation**: the server cannot list allowed roots (permissions issue) or tmux cannot spawn a session. Check `ALLOWED_ROOTS` and `tmux` availability.
- **Terminal HTTP start/poll**: tmux might be missing or the fallback endpoint is broken. Inspect the server logs for pty spawn errors.
- **Capture / debug**: if there is no runtime buffer or the debug metadata is missing, the WebSocket/pty layer is not holding sessions; investigate tmux state and any crashes.
- **Delete session / logout**: network issues or session race conditions. Manually delete the tmux session if it lingers.

## Build ID consistency
The script recalculates the build identifier exactly the same way the server does: it SHA-1 hashes
`package.json`'s version plus the contents (or paths, if missing) of `dist/src/server.js` and `public/index.html`, then truncates to 10 characters. A mismatched `meta.buildId` usually points to a stale build output or an arbitrary binary change that was not deployed. Rebuilding and redeploying the artifacts fixes the discrepancy.

If you find a gate failing repeatedly, rerun the script after addressing the corresponding section, and rely on the detail column in the printed table to see which HTTP request and payload failed.
The detail column always shows the HTTP status plus any error code or parsing output that the gate received.
