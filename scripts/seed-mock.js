#!/usr/bin/env node
/**
 * Seed a mock SQLite database with realistic fake data for screenshots/demos.
 *
 * Usage:
 *   node scripts/seed-mock.js [output-path]   # CLI; default data/mock.db
 *   const { seed } = require("./seed-mock"); seed(outPath);
 *
 * Schema parity: this seed mirrors what `src/lib/db.ts initSchema()` would
 * create *plus all migrations*, and bumps `PRAGMA user_version = 1` so the
 * one-shot `migrateXpDailyDateLabels` wipe doesn't blow `xp_daily` away on
 * the first DEMO_MODE boot.
 */

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DEFAULT_OUT = path.join(__dirname, "../data/mock.db");

function seed(outPath = DEFAULT_OUT) {
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  // SQLite leaves -wal / -shm sidecars behind from an interrupted writer; if
  // the seed only deletes the main file, a stale WAL can resurrect old rows.
  for (const sfx of ["-wal", "-shm", "-journal"]) {
    const p = outPath + sfx;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const db = new Database(outPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  buildSchema(db);
  populate(db);

  // Skip `migrateXpDailyDateLabels` on first boot — the seed already writes
  // dates in the corrected (UTC-keyed) format and we don't want them wiped.
  db.pragma("user_version = 1");

  db.close();
  return outPath;
}

// ── Schema (must match src/lib/db.ts initSchema + all migrations) ────────────

function buildSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sync_time TEXT NOT NULL,
      sync_type TEXT NOT NULL,
      total_xp INTEGER,
      success INTEGER NOT NULL DEFAULT 1,
      error_message TEXT,
      duration_ms INTEGER,
      cycle_all INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS course_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_time TEXT NOT NULL,
      course_id TEXT NOT NULL,
      learning_language TEXT NOT NULL,
      from_language TEXT NOT NULL,
      title TEXT NOT NULL,
      xp INTEGER NOT NULL,
      crowns INTEGER NOT NULL,
      streak INTEGER NOT NULL,
      level INTEGER,
      mistake_count INTEGER
    );

    CREATE TABLE IF NOT EXISTS xp_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      gained_xp INTEGER NOT NULL,
      frozen INTEGER NOT NULL DEFAULT 0,
      streak_extended INTEGER NOT NULL DEFAULT 0,
      daily_goal_xp INTEGER NOT NULL,
      num_sessions INTEGER NOT NULL DEFAULT 0,
      total_session_time INTEGER NOT NULL DEFAULT 0,
      implied_freeze INTEGER NOT NULL DEFAULT 0,
      UNIQUE(date)
    );

    CREATE TABLE IF NOT EXISTS vocab_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_time TEXT NOT NULL,
      course_id TEXT NOT NULL,
      word TEXT NOT NULL,
      lexeme_id TEXT NOT NULL,
      strength_bars INTEGER NOT NULL,
      skill TEXT,
      pos TEXT,
      gender TEXT,
      last_practiced TEXT,
      first_seen TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS skill_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_time TEXT NOT NULL,
      course_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      skill_name TEXT NOT NULL,
      learned INTEGER NOT NULL DEFAULT 0,
      strength REAL NOT NULL DEFAULT 0,
      words_json TEXT,
      levels_finished INTEGER NOT NULL DEFAULT 0,
      coords_x INTEGER NOT NULL DEFAULT 0,
      coords_y INTEGER NOT NULL DEFAULT 0,
      dependencies_json TEXT,
      first_seen TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      name TEXT,
      picture TEXT,
      bio TEXT,
      streak INTEGER NOT NULL DEFAULT 0,
      current_streak_start TEXT,
      current_streak_length INTEGER,
      previous_streak_length INTEGER,
      total_xp INTEGER NOT NULL DEFAULT 0,
      xp_goal INTEGER NOT NULL DEFAULT 0,
      gems INTEGER NOT NULL DEFAULT 0,
      lingots INTEGER NOT NULL DEFAULT 0,
      has_plus INTEGER NOT NULL DEFAULT 0,
      creation_date INTEGER,
      current_course_id TEXT,
      learning_language TEXT,
      from_language TEXT,
      motivation TEXT,
      timezone TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS achievements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      achievement_id TEXT UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      tier INTEGER,
      is_completed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS streak_epochs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      streak_start_date TEXT NOT NULL UNIQUE,
      streak_end_date TEXT,
      streak_length INTEGER,
      detected_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      nightly_hour INTEGER,
      timezone_override TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT OR IGNORE INTO app_settings (id) VALUES (1);
  `);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const NOW = new Date();
const isoNow = () => NOW.toISOString();

function daysAgo(n) {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function dateStr(n) {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

function rand(a, b) {
  return a + Math.floor(Math.random() * (b - a + 1));
}

// Seedable PRNG so the seed is deterministic across runs (so screenshots
// don't drift). Mulberry32.
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(42);
const rrand = (a, b) => a + Math.floor(rng() * (b - a + 1));

// ── Demo data shape ──────────────────────────────────────────────────────────

const CURRENT_STREAK_DAYS = 247;
const CLOSED_EPOCH_START_DAYS_AGO = 510;
const CLOSED_EPOCH_END_DAYS_AGO = 280; // length 230 days
const HISTORY_DAYS = 365;

// Course definitions: latest XP, plus a multiplier curve indicating how the
// XP grew (`shape`) and how much of it predates tracking (`pretrack` is the
// fraction of total XP that existed at the earliest snapshot).
const COURSES = [
  // Spanish: dominant, long-running, recent burst. Has full skill tree.
  { id: "DUOLINGO_ES_EN", lang: "es", from: "en", title: "Spanish",          latestXp: 67340, shape: "veteran",     pretrack: 0.35 },
  // French: secondary, steady growth.
  { id: "DUOLINGO_FR_EN", lang: "fr", from: "en", title: "French",           latestXp: 28150, shape: "steady",      pretrack: 0.25 },
  // German: older, plateaued months ago.
  { id: "DUOLINGO_DE_EN", lang: "de", from: "en", title: "German",           latestXp: 18900, shape: "plateaued",   pretrack: 0.40 },
  // Japanese: relatively new, accelerating.
  { id: "DUOLINGO_JA_EN", lang: "ja", from: "en", title: "Japanese",         latestXp: 11200, shape: "accelerate",  pretrack: 0.05 },
  // Italian: dabbling.
  { id: "DUOLINGO_IT_EN", lang: "it", from: "en", title: "Italian",          latestXp:  6430, shape: "dabble",      pretrack: 0.15 },
  // Portuguese: very small, recent.
  { id: "DUOLINGO_PT_EN", lang: "pt", from: "en", title: "Portuguese",       latestXp:  2500, shape: "recent",      pretrack: 0.00 },
  // Korean: tiny exploratory.
  { id: "DUOLINGO_KO_EN", lang: "ko", from: "en", title: "Korean",           latestXp:   890, shape: "recent",      pretrack: 0.00 },
  // Mandarin: tiny exploratory.
  { id: "DUOLINGO_ZH_EN", lang: "zh", from: "en", title: "Mandarin Chinese", latestXp:   340, shape: "recent",      pretrack: 0.00 },
];

// Snapshot anchor offsets in days-ago. Latest snapshot (offset 0) is "now";
// the rest sit at coarser-grained points so the cumulative chart has shape.
const SNAPSHOT_OFFSETS = [365, 270, 180, 120, 90, 60, 30, 14, 7, 3, 1, 0];

function xpAtOffset(course, offsetDays) {
  // offsetDays = 0 → latest XP. >0 → walk backward.
  const t = Math.max(0, 1 - offsetDays / HISTORY_DAYS); // 0..1, 1 = today
  const pre = course.pretrack;
  let progress;
  switch (course.shape) {
    case "veteran":
      // Steady growth over the full window with mild acceleration.
      progress = pre + (1 - pre) * Math.pow(t, 0.85);
      break;
    case "steady":
      progress = pre + (1 - pre) * Math.pow(t, 1.0);
      break;
    case "plateaued":
      // Most growth in the first half of the window, then flat.
      progress = pre + (1 - pre) * Math.min(1, t * 1.6);
      break;
    case "accelerate":
      // S-curve weighted to the back half.
      progress = pre + (1 - pre) * Math.pow(t, 1.6);
      break;
    case "dabble":
      progress = pre + (1 - pre) * Math.pow(t, 1.2);
      break;
    case "recent":
    default:
      // Started in the last ~60 days.
      progress = t < (1 - 60 / HISTORY_DAYS) ? 0 : (t - (1 - 60 / HISTORY_DAYS)) / (60 / HISTORY_DAYS);
      break;
  }
  return Math.max(0, Math.round(course.latestXp * progress));
}

// ── Populate ─────────────────────────────────────────────────────────────────

function populate(db) {
  // ── User Profile ──────────────────────────────────────────────────────────
  // total_xp set above the sum of latest course XPs so the cumulative
  // History chart shows a `_pretrack` segment under the per-course stack.
  const sumLatest = COURSES.reduce((s, c) => s + c.latestXp, 0);
  const totalXp = sumLatest + 8500; // ~6% pretrack-style headroom
  db.prepare(`
    INSERT INTO user_profile (id, user_id, username, name, picture, bio, streak,
      current_streak_start, current_streak_length, previous_streak_length,
      total_xp, xp_goal, gems, lingots, has_plus, creation_date,
      current_course_id, learning_language, from_language, motivation,
      timezone, updated_at)
    VALUES (1, 999001, 'alexrivera', 'Alex Rivera', NULL,
      'Language enthusiast. 8 languages and counting.',
      ?, ?, ?, 230, ?, 50, 1240, 340, 1,
      1519776000, 'DUOLINGO_ES_EN', 'es', 'en', 'I want to travel more',
      'America/Los_Angeles', ?)
  `).run(
    CURRENT_STREAK_DAYS,
    dateStr(CURRENT_STREAK_DAYS),
    CURRENT_STREAK_DAYS,
    totalXp,
    isoNow(),
  );

  // ── Course snapshots (time series) ───────────────────────────────────────
  const snapshotStmt = db.prepare(`
    INSERT INTO course_snapshots (snapshot_time, course_id, learning_language, from_language, title, xp, crowns, streak, mistake_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSnaps = db.transaction(() => {
    for (const offset of SNAPSHOT_OFFSETS) {
      const ts = daysAgo(offset);
      for (const c of COURSES) {
        const xp = xpAtOffset(c, offset);
        if (offset > 0 && xp === 0) continue; // skip historical zeros to keep the chart clean
        // Crowns scale ~0.0046 per XP (eyeballed from the original seed).
        const crowns = Math.round(xp * 0.0046);
        const streak = offset === 0 ? CURRENT_STREAK_DAYS : Math.max(0, CURRENT_STREAK_DAYS - offset);
        // Only record mistake_count on the latest snapshot (matches live behavior:
        // mistakes are written via UPDATE on the most-recent snapshot row).
        const mistakes = offset === 0 ? rrand(3, 18) : null;
        snapshotStmt.run(ts, c.id, c.lang, c.from, c.title, xp, crowns, streak, mistakes);
      }
    }
  });
  insertSnaps();

  // ── xp_daily (full year) ─────────────────────────────────────────────────
  // Pattern: most days are practice (varied), some zero days, a few flagged
  // frozen, a few implied_freeze inside the current streak window.
  const xpStmt = db.prepare(`
    INSERT OR IGNORE INTO xp_daily (date, gained_xp, frozen, streak_extended, daily_goal_xp, num_sessions, total_session_time, implied_freeze)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Hand-pick a handful of "shield" days — explicit Duolingo-flagged frozen.
  // These fall OUTSIDE the current streak window (they're from the prior
  // closed epoch, so they don't conflict with implied_freeze coloring).
  const explicitFreezeDays = new Set([
    300, 305, 340, 360, 395, 430,
  ]);
  // Implied-freeze days inside the CURRENT streak window (zero XP, but the
  // streak survived → must have been a shield Duolingo didn't flag).
  // These are 50, 110, 175 days ago → all < CURRENT_STREAK_DAYS = 247.
  const impliedFreezeDays = new Set([50, 110, 175]);
  // Plain zero-practice days (no shield). Outside current streak window so
  // they don't break it. Show up gray on the streak chart.
  const lapseDays = new Set([
    260, 265, 271, 320, 322, 380,
  ]);

  const insertDaily = db.transaction(() => {
    for (let i = 0; i < HISTORY_DAYS; i++) {
      const date = dateStr(i);
      let gainedXp = 0;
      let frozen = 0;
      let streakExtended = 0;
      let impliedFreeze = 0;

      const isExplicitFreeze = explicitFreezeDays.has(i);
      const isImpliedFreeze = impliedFreezeDays.has(i);
      const isLapse = lapseDays.has(i);
      const insideCurrentStreak = i < CURRENT_STREAK_DAYS;

      if (isExplicitFreeze) {
        frozen = 1;
        gainedXp = 0;
      } else if (isImpliedFreeze) {
        impliedFreeze = 1;
        gainedXp = 0;
      } else if (isLapse) {
        gainedXp = 0;
      } else {
        // Practice day. Vary intensity by day-of-week-ish via index.
        const heavy = (i % 7 === 5) || (i % 7 === 6); // weekend bursts
        const light = (i % 7 === 1) || (i % 7 === 3);
        if (heavy) gainedXp = rrand(380, 720);
        else if (light) gainedXp = rrand(100, 220);
        else gainedXp = rrand(150, 380);
        // Inside the current streak, every practice day extends the streak;
        // outside, only some did (to keep it realistic without the chart
        // re-deriving the prior streak's coloring).
        streakExtended = insideCurrentStreak ? 1 : (rng() > 0.4 ? 1 : 0);
      }

      const sessions = gainedXp > 0 ? Math.max(1, Math.round(gainedXp / 120)) : 0;
      const sessionTime = sessions * (180 + rrand(0, 120));
      xpStmt.run(date, gainedXp, frozen, streakExtended, 50, sessions, sessionTime, impliedFreeze);
    }
  });
  insertDaily();

  // ── Streak epochs ────────────────────────────────────────────────────────
  // One closed epoch (longer history) + one ongoing epoch (current streak).
  const epochStmt = db.prepare(`
    INSERT INTO streak_epochs (streak_start_date, streak_end_date, streak_length, detected_at)
    VALUES (?, ?, ?, ?)
  `);
  epochStmt.run(
    dateStr(CLOSED_EPOCH_START_DAYS_AGO),
    dateStr(CLOSED_EPOCH_END_DAYS_AGO),
    CLOSED_EPOCH_START_DAYS_AGO - CLOSED_EPOCH_END_DAYS_AGO, // 230
    daysAgo(CLOSED_EPOCH_END_DAYS_AGO),
  );
  epochStmt.run(
    dateStr(CURRENT_STREAK_DAYS),
    null,
    null,
    daysAgo(CURRENT_STREAK_DAYS),
  );

  // ── Sync log ─────────────────────────────────────────────────────────────
  const syncStmt = db.prepare(`
    INSERT INTO sync_log (sync_time, sync_type, total_xp, success, duration_ms, cycle_all)
    VALUES (?, ?, ?, 1, ?, ?)
  `);
  syncStmt.run(daysAgo(0),     "full",  totalXp,      14_300, 1);
  syncStmt.run(daysAgo(0.01),  "quick", totalXp,      null,   0);
  syncStmt.run(daysAgo(0.18),  "full",  totalXp - 420, 9_800, 0);
  syncStmt.run(daysAgo(1),     "full",  totalXp - 840, 13_900, 1);
  syncStmt.run(daysAgo(2),     "full",  totalXp - 1320, 14_500, 1);

  // ── Skills (Spanish + a thin slice for French/Japanese) ──────────────────
  populateSpanishSkills(db);
  populateFrenchSkills(db);
  populateJapaneseSkills(db);

  // ── Vocabulary ──────────────────────────────────────────────────────────
  populateSpanishVocab(db);
  populateFrenchVocab(db);
}

function populateSpanishSkills(db) {
  const skills = [
    { id: "basics1",    name: "Basics 1",       levels: 5, x: 3, y: 0, deps: [] },
    { id: "basics2",    name: "Basics 2",       levels: 5, x: 3, y: 1, deps: ["basics1"] },
    { id: "phrases",    name: "Phrases",        levels: 5, x: 5, y: 1, deps: ["basics1"] },
    { id: "food1",      name: "Food",           levels: 5, x: 1, y: 2, deps: ["basics2"] },
    { id: "animals",    name: "Animals",        levels: 5, x: 3, y: 2, deps: ["basics2"] },
    { id: "plurals",    name: "Plurals",        levels: 5, x: 5, y: 2, deps: ["basics2"] },
    { id: "adj1",       name: "Adjectives 1",   levels: 4, x: 1, y: 3, deps: ["food1", "animals"] },
    { id: "verbs1",     name: "Verbs: Present", levels: 5, x: 3, y: 3, deps: ["animals", "plurals"] },
    { id: "travel",     name: "Travel",         levels: 3, x: 5, y: 3, deps: ["phrases", "plurals"] },
    { id: "family",     name: "Family",         levels: 5, x: 1, y: 4, deps: ["adj1"] },
    { id: "colors",     name: "Colors",         levels: 4, x: 3, y: 4, deps: ["adj1", "verbs1"] },
    { id: "numbers",    name: "Numbers",        levels: 5, x: 5, y: 4, deps: ["verbs1"] },
    { id: "verbs2",     name: "Verbs: Past",    levels: 2, x: 1, y: 5, deps: ["family", "colors"] },
    { id: "nature",     name: "Nature",         levels: 3, x: 3, y: 5, deps: ["colors", "numbers"] },
    { id: "sports",     name: "Sports",         levels: 1, x: 5, y: 5, deps: ["numbers"] },
    { id: "shopping",   name: "Shopping",       levels: 0, x: 1, y: 6, deps: ["verbs2"] },
    { id: "body",       name: "Body",           levels: 0, x: 3, y: 6, deps: ["nature"] },
    { id: "health",     name: "Health",         levels: 0, x: 5, y: 6, deps: ["sports"] },
    { id: "business",   name: "Business",       levels: 0, x: 3, y: 7, deps: ["shopping", "body", "health"] },
    { id: "culture",    name: "Culture",        levels: 0, x: 3, y: 8, deps: ["business"] },
  ];
  const words = {
    basics1: ["hola", "adiós", "por favor", "gracias", "sí", "no"],
    basics2: ["el", "la", "un", "una", "yo", "tú"],
    phrases: ["buenos días", "buenas noches", "¿cómo estás?", "bien", "mal"],
    food1:   ["el pan", "el agua", "la leche", "la manzana", "el café"],
    animals: ["el perro", "el gato", "el pájaro", "el pez", "el caballo"],
    plurals: ["los perros", "las gatas", "los libros", "las casas"],
    adj1:    ["grande", "pequeño", "bueno", "malo", "nuevo", "viejo"],
    verbs1:  ["ser", "estar", "tener", "hacer", "ir", "poder"],
    travel:  ["el hotel", "el aeropuerto", "el tren", "el billete"],
    family:  ["la madre", "el padre", "el hermano", "la hermana", "el hijo"],
    colors:  ["rojo", "azul", "verde", "amarillo", "negro", "blanco"],
    numbers: ["uno", "dos", "tres", "diez", "cien", "mil"],
    verbs2:  ["hablar", "comer", "vivir", "escribir", "leer"],
    nature:  ["el árbol", "la flor", "el río", "la montaña", "el mar"],
    sports:  ["el fútbol", "el tenis", "nadar", "correr"],
  };
  insertSkills(db, "DUOLINGO_ES_EN", skills, words);
}

function populateFrenchSkills(db) {
  // Smaller tree — enough to make the course-detail page non-empty if
  // someone navigates to French.
  const skills = [
    { id: "fr_basics1", name: "Basics 1",      levels: 5, x: 3, y: 0, deps: [] },
    { id: "fr_basics2", name: "Basics 2",      levels: 5, x: 3, y: 1, deps: ["fr_basics1"] },
    { id: "fr_food",    name: "Food",          levels: 4, x: 1, y: 2, deps: ["fr_basics2"] },
    { id: "fr_phrases", name: "Phrases",       levels: 5, x: 5, y: 2, deps: ["fr_basics2"] },
    { id: "fr_verbs1",  name: "Verbs: Present", levels: 3, x: 3, y: 3, deps: ["fr_phrases"] },
    { id: "fr_family",  name: "Family",        levels: 2, x: 1, y: 3, deps: ["fr_food"] },
    { id: "fr_travel",  name: "Travel",        levels: 1, x: 5, y: 3, deps: ["fr_phrases"] },
    { id: "fr_numbers", name: "Numbers",       levels: 3, x: 3, y: 4, deps: ["fr_verbs1"] },
    { id: "fr_colors",  name: "Colors",        levels: 0, x: 1, y: 4, deps: ["fr_family"] },
  ];
  const words = {
    fr_basics1: ["bonjour", "salut", "merci", "oui", "non"],
    fr_basics2: ["le", "la", "un", "une", "je", "tu"],
    fr_food:    ["le pain", "l'eau", "le café"],
    fr_phrases: ["s'il vous plaît", "comment ça va", "bien"],
    fr_verbs1:  ["être", "avoir", "aller"],
    fr_family:  ["la mère", "le père"],
    fr_travel:  ["l'hôtel"],
    fr_numbers: ["un", "deux", "trois"],
  };
  insertSkills(db, "DUOLINGO_FR_EN", skills, words);
}

function populateJapaneseSkills(db) {
  const skills = [
    { id: "ja_hira1",   name: "Hiragana 1",     levels: 5, x: 3, y: 0, deps: [] },
    { id: "ja_hira2",   name: "Hiragana 2",     levels: 5, x: 3, y: 1, deps: ["ja_hira1"] },
    { id: "ja_kata",    name: "Katakana",       levels: 3, x: 1, y: 1, deps: ["ja_hira1"] },
    { id: "ja_basics",  name: "Basics",         levels: 4, x: 5, y: 1, deps: ["ja_hira2"] },
    { id: "ja_intro",   name: "Introductions",  levels: 3, x: 3, y: 2, deps: ["ja_basics"] },
    { id: "ja_food",    name: "Food",           levels: 1, x: 1, y: 2, deps: ["ja_basics"] },
    { id: "ja_kanji1",  name: "Kanji 1",        levels: 0, x: 5, y: 2, deps: ["ja_basics"] },
  ];
  const words = {
    ja_hira1:  ["あ", "い", "う", "え", "お"],
    ja_hira2:  ["か", "き", "く", "け", "こ"],
    ja_kata:   ["ア", "イ", "ウ"],
    ja_basics: ["こんにちは", "さようなら", "ありがとう"],
    ja_intro:  ["はじめまして", "わたしは"],
    ja_food:   ["パン", "みず"],
  };
  insertSkills(db, "DUOLINGO_JA_EN", skills, words);
}

function insertSkills(db, courseId, skills, wordsByPrefixedId) {
  const stmt = db.prepare(`
    INSERT INTO skill_snapshots (snapshot_time, course_id, skill_id, skill_name, learned, strength,
      words_json, levels_finished, coords_x, coords_y, dependencies_json, first_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const s of skills) {
    const w = wordsByPrefixedId[s.id] ?? [];
    const firstSeen = daysAgo(rrand(30, 330));
    stmt.run(
      isoNow(),
      courseId,
      s.id,
      s.name,
      s.levels >= 1 ? 1 : 0,
      s.levels / 5,
      JSON.stringify(w),
      s.levels,
      s.x,
      s.y,
      JSON.stringify(s.deps),
      firstSeen,
    );
  }
}

function populateSpanishVocab(db) {
  const list = [
    { word: "hola",         skill: "Basics 1",       bars: 4 },
    { word: "adiós",        skill: "Basics 1",       bars: 4 },
    { word: "gracias",      skill: "Basics 1",       bars: 4 },
    { word: "por favor",    skill: "Basics 1",       bars: 3 },
    { word: "sí",           skill: "Basics 1",       bars: 4 },
    { word: "no",           skill: "Basics 1",       bars: 4 },
    { word: "el pan",       skill: "Food",           bars: 3 },
    { word: "el agua",      skill: "Food",           bars: 4 },
    { word: "la leche",     skill: "Food",           bars: 2 },
    { word: "la manzana",   skill: "Food",           bars: 3 },
    { word: "el café",      skill: "Food",           bars: 4 },
    { word: "el perro",     skill: "Animals",        bars: 4 },
    { word: "el gato",      skill: "Animals",        bars: 4 },
    { word: "el pájaro",    skill: "Animals",        bars: 2 },
    { word: "el pez",       skill: "Animals",        bars: 3 },
    { word: "grande",       skill: "Adjectives 1",   bars: 3 },
    { word: "pequeño",      skill: "Adjectives 1",   bars: 2 },
    { word: "bueno",        skill: "Adjectives 1",   bars: 4 },
    { word: "malo",         skill: "Adjectives 1",   bars: 3 },
    { word: "ser",          skill: "Verbs: Present", bars: 3 },
    { word: "estar",        skill: "Verbs: Present", bars: 2 },
    { word: "tener",        skill: "Verbs: Present", bars: 3 },
    { word: "hacer",        skill: "Verbs: Present", bars: 2 },
    { word: "ir",           skill: "Verbs: Present", bars: 4 },
    { word: "la madre",     skill: "Family",         bars: 4 },
    { word: "el padre",     skill: "Family",         bars: 4 },
    { word: "el hermano",   skill: "Family",         bars: 3 },
    { word: "la hermana",   skill: "Family",         bars: 3 },
    { word: "rojo",         skill: "Colors",         bars: 4 },
    { word: "azul",         skill: "Colors",         bars: 4 },
    { word: "verde",        skill: "Colors",         bars: 3 },
    { word: "amarillo",     skill: "Colors",         bars: 2 },
    { word: "uno",          skill: "Numbers",        bars: 4 },
    { word: "dos",          skill: "Numbers",        bars: 4 },
    { word: "cien",         skill: "Numbers",        bars: 3 },
    { word: "el árbol",     skill: "Nature",         bars: 2 },
    { word: "la flor",      skill: "Nature",         bars: 3 },
    { word: "el río",       skill: "Nature",         bars: 1 },
    { word: "el fútbol",    skill: "Sports",         bars: 2 },
    { word: "nadar",        skill: "Sports",         bars: 1 },
  ];
  insertVocab(db, "DUOLINGO_ES_EN", list);
}

function populateFrenchVocab(db) {
  const list = [
    { word: "bonjour",       skill: "Basics 1",      bars: 4 },
    { word: "merci",         skill: "Basics 1",      bars: 4 },
    { word: "oui",           skill: "Basics 1",      bars: 4 },
    { word: "non",           skill: "Basics 1",      bars: 4 },
    { word: "salut",         skill: "Basics 1",      bars: 3 },
    { word: "le pain",       skill: "Food",          bars: 3 },
    { word: "l'eau",         skill: "Food",          bars: 3 },
    { word: "le café",       skill: "Food",          bars: 4 },
    { word: "être",          skill: "Verbs: Present", bars: 2 },
    { word: "avoir",         skill: "Verbs: Present", bars: 2 },
    { word: "la mère",       skill: "Family",        bars: 3 },
    { word: "le père",       skill: "Family",        bars: 3 },
  ];
  insertVocab(db, "DUOLINGO_FR_EN", list);
}

function insertVocab(db, courseId, list) {
  const stmt = db.prepare(`
    INSERT INTO vocab_snapshots (snapshot_time, course_id, word, lexeme_id, strength_bars, skill, pos, gender, last_practiced, first_seen)
    VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)
  `);
  list.forEach((v, i) => {
    const firstSeen = daysAgo(rrand(10, 200));
    stmt.run(isoNow(), courseId, v.word, `${courseId}_lex_${i.toString().padStart(4, "0")}`, v.bars, v.skill, firstSeen);
  });
}

module.exports = { seed };

if (require.main === module) {
  const out = process.argv[2] ?? DEFAULT_OUT;
  const written = seed(out);
  // eslint-disable-next-line no-console
  console.log(`Mock database written to: ${written}`);
  // eslint-disable-next-line no-console
  console.log("To use: DEMO_MODE=true npm run dev");
}
