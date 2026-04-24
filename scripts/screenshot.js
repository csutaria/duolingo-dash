#!/usr/bin/env node
/**
 * Takes screenshots for the README using Playwright.
 * Run after starting the demo server: DEMO_MODE=true npm run dev
 */

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const BASE = "http://localhost:3001";
const OUT = path.join(__dirname, "../docs/screenshots");

const pages = [
  { name: "overview",      url: "/",                            waitFor: "text=Total XP" },
  { name: "history",       url: "/history",                     waitFor: "text=History" },
  { name: "course-detail", url: "/course/DUOLINGO_ES_EN",      waitFor: "text=Completed" },
  { name: "vocabulary",    url: "/vocab",                       waitFor: "text=Total Words" },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.setViewportSize({ width: 1400, height: 860 });

  // Hide Next.js dev indicator
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

  for (const { name, url, waitFor } of pages) {
    console.log(`Capturing ${name}...`);
    await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800); // let charts render
    if (waitFor) await page.getByText(waitFor).first().waitFor({ timeout: 5000 }).catch(() => {});
    await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
    console.log(`  ✓ ${name}.png`);
  }

  await browser.close();
  console.log(`\nScreenshots saved to docs/screenshots/`);
})();
