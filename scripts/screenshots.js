#!/usr/bin/env node
/**
 * One-command screenshot pipeline for `docs/screenshots/*.png`.
 *
 * Steps:
 *   1. Verify Playwright + chromium are usable.
 *   2. (Re)seed `data/mock.db` from `scripts/seed-mock.js`.
 *   3. Spawn an isolated `next dev` on port 3001 with DEMO_MODE=true and a
 *      separate `.next-demo/` build cache so it cannot interfere with a
 *      concurrently-running real dev server (port 3000, real DB, real
 *      `.next/`).
 *   4. Wait for `/api/status` on the demo server to come up.
 *   5. Capture overview + three history variants + course + vocab via Playwright.
 *   6. Tear down the dev server and the browser, even on error.
 *
 * Run: `npm run screenshots`
 */

const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");

const PORT = 3001;
const DEMO_DIST_DIR = ".next-demo";
const REPO_ROOT = path.resolve(__dirname, "..");
const SCREENSHOTS_DIR = path.join(REPO_ROOT, "docs", "screenshots");
const MOCK_DB = path.join(REPO_ROOT, "data", "mock.db");
const STATUS_TIMEOUT_MS = 90_000;
const BASE = `http://localhost:${PORT}`;

const PAGES = [
  { name: "overview",      url: "/",                       waitFor: "text=Total XP" },
  { name: "course-detail", url: "/course/DUOLINGO_ES_EN",  waitFor: "text=Skills" },
  { name: "vocabulary",    url: "/vocab",                  waitFor: "text=Total Words" },
];

/** Three captures: 30d Change (delta), All time Total (cumulative), Streak Details chart. */
async function captureHistoryScreenshots(page) {
  const hidePortal = async () => {
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  };

  log("Capturing history-change, history-total, history-streak (/history)");
  await page.goto(`${BASE}/history`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    try {
      window.localStorage.removeItem("duolingo-dash.xpWindow");
      window.localStorage.removeItem("duolingo-dash.historyAllView");
    } catch {
      /* ignore */
    }
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  await page.getByRole("button", { name: "30d", exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByText("XP gained per language").first().waitFor({ timeout: 15_000 });
  await hidePortal();
  const changePath = path.join(SCREENSHOTS_DIR, "history-change.png");
  await page.screenshot({ path: changePath, fullPage: false });
  log(`  saved ${path.relative(REPO_ROOT, changePath)}`);

  await page.getByRole("button", { name: "All time" }).click();
  await page.waitForTimeout(600);
  await page.getByText("Cumulative XP per language").first().waitFor({ timeout: 15_000 });
  await hidePortal();
  const totalPath = path.join(SCREENSHOTS_DIR, "history-total.png");
  await page.screenshot({ path: totalPath, fullPage: false });
  log(`  saved ${path.relative(REPO_ROOT, totalPath)}`);

  await page.getByRole("button", { name: "30d", exact: true }).click();
  await page.waitForTimeout(600);
  const streakHeading = page.getByRole("heading", { name: /Streak Details/ });
  await streakHeading.waitFor({ timeout: 15_000 });
  const streakBlock = streakHeading.locator("..").locator("..");
  await streakBlock.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await hidePortal();
  const streakPath = path.join(SCREENSHOTS_DIR, "history-streak.png");
  await streakBlock.screenshot({ path: streakPath });
  log(`  saved ${path.relative(REPO_ROOT, streakPath)}`);
}

async function main() {
  // ── 1. Playwright sanity check ─────────────────────────────────────────
  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch (err) {
    fail(
      "Playwright is not installed.\n" +
        "Run: npm install (and then `npx playwright install chromium`).",
      err,
    );
  }
  // chromium.executablePath() throws if the browser binary isn't present.
  try {
    chromium.executablePath();
  } catch (err) {
    fail(
      "Playwright Chromium isn't installed.\n" +
        "Run: npx playwright install chromium",
      err,
    );
  }

  // ── 2. Reseed the mock DB ──────────────────────────────────────────────
  log("Seeding mock DB at " + path.relative(REPO_ROOT, MOCK_DB));
  const { seed } = require("./seed-mock");
  seed(MOCK_DB);

  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  // ── 3. Spawn the isolated demo dev server ──────────────────────────────
  log(`Starting demo server on :${PORT} (DIST=${DEMO_DIST_DIR})`);
  const demoEnv = {
    ...process.env,
    DEMO_MODE: "true",
    PORT: String(PORT),
    NEXT_DIST_DIR: DEMO_DIST_DIR,
    // Strip any inherited JWT — DEMO_MODE doesn't need one and we don't want
    // an accidental real-API call from a demo render.
    DUOLINGO_JWT: "",
    // Disable any real timezone override so the demo uses the seeded
    // `app_settings.timezone_override` (America/Los_Angeles).
    DUOLINGO_TZ: "",
    BROWSER: "none",
  };
  const child = spawn(
    "npx",
    ["next", "dev", "--port", String(PORT)],
    {
      cwd: REPO_ROOT,
      env: demoEnv,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (b) => process.stdout.write(prefix("[demo] ", b)));
  child.stderr.on("data", (b) => process.stderr.write(prefix("[demo] ", b)));

  let exited = false;
  const exitPromise = new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      exited = true;
      resolve({ code, signal });
    });
  });

  // ── 4. Wait for /api/status to respond 200 ─────────────────────────────
  try {
    log("Waiting for demo server to be ready...");
    await waitForStatus(`${BASE}/api/status`, STATUS_TIMEOUT_MS, () => exited);

    // ── 5. Capture screenshots ──────────────────────────────────────────
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.setViewportSize({ width: 1400, height: 860 });
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

      for (const { name, url, waitFor } of PAGES) {
        log(`Capturing ${name} (${url})`);
        await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(800); // let Recharts settle
        if (waitFor) {
          await page
            .getByText(waitFor.replace(/^text=/, ""))
            .first()
            .waitFor({ timeout: 5_000 })
            .catch(() => {});
        }
        await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
        const out = path.join(SCREENSHOTS_DIR, `${name}.png`);
        await page.screenshot({ path: out, fullPage: false });
        log(`  saved ${path.relative(REPO_ROOT, out)}`);
      }

      await captureHistoryScreenshots(page);


      // ── 6a. Remove legacy filenames if present ─────────────────────────
      for (const name of ["xp-history.png", "history.png"]) {
        const legacy = path.join(SCREENSHOTS_DIR, name);
        if (fs.existsSync(legacy)) {
          fs.unlinkSync(legacy);
          log(`  removed legacy ${path.relative(REPO_ROOT, legacy)}`);
        }
      }
    } finally {
      await browser.close();
    }
  } finally {
    // ── 6b. Always tear down the dev server ────────────────────────────
    if (!exited) {
      log("Stopping demo server...");
      child.kill("SIGTERM");
      const result = await Promise.race([
        exitPromise,
        sleep(5_000).then(() => "timeout"),
      ]);
      if (result === "timeout") {
        log("SIGTERM did not exit in 5s, sending SIGKILL");
        child.kill("SIGKILL");
        await exitPromise;
      }
    }
  }

  log("Done.");
}

function waitForStatus(url, timeoutMs, isDeadCheck) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (isDeadCheck && isDeadCheck()) {
        reject(new Error("Demo server exited before becoming ready."));
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(`Demo server did not respond on ${url} within ${timeoutMs}ms.`));
        return;
      }
      const req = http.get(url, (res) => {
        // Drain so the socket can be reused.
        res.resume();
        if (res.statusCode === 200) {
          resolve();
        } else {
          setTimeout(tick, 500);
        }
      });
      req.on("error", () => setTimeout(tick, 500));
      req.setTimeout(2_000, () => req.destroy());
    };
    tick();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function prefix(p, buf) {
  const s = buf.toString();
  return s
    .split("\n")
    .map((l, i, arr) => (i === arr.length - 1 && l === "" ? "" : p + l))
    .join("\n");
}

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[screenshots] ${msg}`);
}

function fail(msg, err) {
  // eslint-disable-next-line no-console
  console.error(`[screenshots] ${msg}`);
  if (err && err.message) {
    // eslint-disable-next-line no-console
    console.error(`  cause: ${err.message}`);
  }
  process.exit(1);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[screenshots] failed:", err && err.stack ? err.stack : err);
  process.exit(1);
});
