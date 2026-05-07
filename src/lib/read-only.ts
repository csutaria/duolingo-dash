/**
 * Read-only server mode.
 *
 * Set `DUOLINGO_READ_ONLY=1` (or `=true`) on a second instance pointing
 * at the same SQLite file so it can serve charts and tables without
 * mutating the DB or contending with the writer instance for the
 * Duolingo API. The read-only process:
 *
 *  - opens the SQLite handle with `readonly: true` (writes throw at
 *    the `better-sqlite3` layer),
 *  - skips JWT bootstrap and `startPolling` in `ensureClient`,
 *  - serves `GET /api/data` and `GET /api/status` normally,
 *  - returns `503 { error: "read-only" }` from any mutating route
 *    (`POST /api/sync`, `POST /api/sync-course`, `POST /api/polling`,
 *    and the future `POST /api/settings`),
 *  - reports `{ readOnly: true }` in `/api/status` so the UI can
 *    render a badge and disable write controls.
 *
 * The flag is read at process start (env vars don't change at
 * runtime), so `isReadOnlyMode()` is cheap and side-effect free.
 *
 * See `docs/architecture.md` § "Read-only mode" and
 * `README.md` § "Running a display-only second instance" for the
 * deployment story.
 */
import { getInstanceRole } from "./instance-role";

export function isReadOnlyMode(): boolean {
  return getInstanceRole() === "read-only";
}
