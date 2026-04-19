#!/usr/bin/env node
/**
 * Seed a mock SQLite database with realistic fake data for screenshots/demos.
 * Usage: node scripts/seed-mock.js [output-path]
 * Default output: data/mock.db
 */

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const OUT = process.argv[2] ?? path.join(__dirname, "../data/mock.db");

if (fs.existsSync(OUT)) fs.unlinkSync(OUT);
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const db = new Database(OUT);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ── Schema ────────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_time TEXT NOT NULL,
    sync_type TEXT NOT NULL,
    total_xp INTEGER,
    success INTEGER NOT NULL DEFAULT 1,
    error_message TEXT
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
`);

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── User Profile ──────────────────────────────────────────────────────────────

db.prepare(`
  INSERT INTO user_profile (id, user_id, username, name, picture, bio, streak,
    current_streak_start, current_streak_length, previous_streak_length,
    total_xp, xp_goal, gems, lingots, has_plus, creation_date,
    current_course_id, learning_language, from_language, motivation, updated_at)
  VALUES (1, 999001, 'alexrivera', 'Alex Rivera',
    'https://simg-ssl.duolingo.com/ssr-avatars/999001/mock/xlarge',
    'Language enthusiast. 8 languages and counting.',
    247, ?, 247, 180, 134520, 50, 1240, 340, 1,
    1519776000, 'DUOLINGO_ES_EN', 'es', 'en', 'I want to travel more', ?)
`).run(dateStr(247), isoNow());

// ── Courses ───────────────────────────────────────────────────────────────────

const courses = [
  { id: "DUOLINGO_ES_EN", lang: "es", from: "en", title: "Spanish",      xp: 67340, crowns: 312 },
  { id: "DUOLINGO_FR_EN", lang: "fr", from: "en", title: "French",       xp: 28150, crowns: 143 },
  { id: "DUOLINGO_DE_EN", lang: "de", from: "en", title: "German",       xp: 18900, crowns: 98  },
  { id: "DUOLINGO_JA_EN", lang: "ja", from: "en", title: "Japanese",     xp: 11200, crowns: 54  },
  { id: "DUOLINGO_IT_EN", lang: "it", from: "en", title: "Italian",      xp: 6430,  crowns: 31  },
  { id: "DUOLINGO_PT_EN", lang: "pt", from: "en", title: "Portuguese",   xp: 2500,  crowns: 12  },
  { id: "DUOLINGO_KO_EN", lang: "ko", from: "en", title: "Korean",       xp: 890,   crowns: 4   },
  { id: "DUOLINGO_ZH_EN", lang: "zh", from: "en", title: "Mandarin Chinese", xp: 340, crowns: 2 },
];

const snapshotStmt = db.prepare(`
  INSERT INTO course_snapshots (snapshot_time, course_id, learning_language, from_language, title, xp, crowns, streak)
  VALUES (?, ?, ?, ?, ?, ?, ?, 247)
`);
for (const c of courses) {
  snapshotStmt.run(isoNow(), c.id, c.lang, c.from, c.title, c.xp, c.crowns);
}

// ── XP Daily (90 days) ────────────────────────────────────────────────────────

const xpStmt = db.prepare(`
  INSERT OR IGNORE INTO xp_daily (date, gained_xp, frozen, streak_extended, daily_goal_xp, num_sessions, total_session_time)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const xpPattern = [
  // last 90 days — index 0 = today
  420, 310, 0, 185, 240, 680, 520,   // week 1
  290, 140, 210, 0, 195, 590, 445,   // week 2
  175, 260, 330, 210, 0, 720, 610,   // week 3
  200, 155, 0, 280, 190, 540, 480,   // week 4
  310, 220, 170, 0, 160, 490, 560,   // week 5
  140, 200, 250, 190, 0, 640, 580,   // week 6
  185, 165, 210, 230, 0, 510, 490,   // week 7
  240, 180, 0, 195, 170, 460, 530,   // week 8
  175, 200, 220, 0, 180, 580, 520,   // week 9
  310, 240, 190, 0, 210, 620, 575,   // week 10 (oldest)
  280, 200, 175, 0, 190, 500, 460,   // week 11
  165, 230, 245, 195, 0, 540, 495,   // week 12
  210, 180, 0, 200, 185, 0, 0,       // remainder
];

const tx = db.transaction(() => {
  for (let i = 0; i < xpPattern.length; i++) {
    const xp = xpPattern[i];
    const frozen = xp === 0 && i < 85 ? 1 : 0;
    const extended = xp > 0 ? 1 : 0;
    const sessions = xp > 0 ? Math.max(1, Math.round(xp / 120)) : 0;
    const sessionTime = sessions * (180 + Math.floor(Math.random() * 120));
    xpStmt.run(dateStr(i), xp, frozen, extended, 50, sessions, sessionTime);
  }
});
tx();

// ── Sync Log ──────────────────────────────────────────────────────────────────

const syncStmt = db.prepare(`
  INSERT INTO sync_log (sync_time, sync_type, total_xp, success) VALUES (?, ?, ?, 1)
`);
syncStmt.run(daysAgo(0),   "full",  134520);
syncStmt.run(daysAgo(0.01),"quick", 134520);
syncStmt.run(daysAgo(0.17),"full",  134100);
syncStmt.run(daysAgo(1),   "full",  133680);

// ── Spanish Skills ────────────────────────────────────────────────────────────

const spanishSkills = [
  { id: "basics1",      name: "Basics 1",       levels: 5, x: 3, y: 0,  deps: [] },
  { id: "basics2",      name: "Basics 2",       levels: 5, x: 3, y: 1,  deps: ["basics1"] },
  { id: "phrases",      name: "Phrases",        levels: 5, x: 5, y: 1,  deps: ["basics1"] },
  { id: "food1",        name: "Food",           levels: 5, x: 1, y: 2,  deps: ["basics2"] },
  { id: "animals",      name: "Animals",        levels: 5, x: 3, y: 2,  deps: ["basics2"] },
  { id: "plurals",      name: "Plurals",        levels: 5, x: 5, y: 2,  deps: ["basics2"] },
  { id: "adj1",         name: "Adjectives 1",   levels: 4, x: 1, y: 3,  deps: ["food1", "animals"] },
  { id: "verbs1",       name: "Verbs: Present", levels: 5, x: 3, y: 3,  deps: ["animals", "plurals"] },
  { id: "travel",       name: "Travel",         levels: 3, x: 5, y: 3,  deps: ["phrases", "plurals"] },
  { id: "family",       name: "Family",         levels: 5, x: 1, y: 4,  deps: ["adj1"] },
  { id: "colors",       name: "Colors",         levels: 4, x: 3, y: 4,  deps: ["adj1", "verbs1"] },
  { id: "numbers",      name: "Numbers",        levels: 5, x: 5, y: 4,  deps: ["verbs1"] },
  { id: "verbs2",       name: "Verbs: Past",    levels: 2, x: 1, y: 5,  deps: ["family", "colors"] },
  { id: "nature",       name: "Nature",         levels: 3, x: 3, y: 5,  deps: ["colors", "numbers"] },
  { id: "sports",       name: "Sports",         levels: 1, x: 5, y: 5,  deps: ["numbers"] },
  { id: "shopping",     name: "Shopping",       levels: 0, x: 1, y: 6,  deps: ["verbs2"] },
  { id: "body",         name: "Body",           levels: 0, x: 3, y: 6,  deps: ["nature"] },
  { id: "health",       name: "Health",         levels: 0, x: 5, y: 6,  deps: ["sports"] },
  { id: "business",     name: "Business",       levels: 0, x: 3, y: 7,  deps: ["shopping", "body", "health"] },
  { id: "culture",      name: "Culture",        levels: 0, x: 3, y: 8,  deps: ["business"] },
];

const skillStmt = db.prepare(`
  INSERT INTO skill_snapshots (snapshot_time, course_id, skill_id, skill_name, learned, strength,
    words_json, levels_finished, coords_x, coords_y, dependencies_json, first_seen)
  VALUES (?, 'DUOLINGO_ES_EN', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const skillWords = {
  basics1:  ["hola", "adiós", "por favor", "gracias", "sí", "no"],
  basics2:  ["el", "la", "un", "una", "yo", "tú"],
  phrases:  ["buenos días", "buenas noches", "¿cómo estás?", "bien", "mal"],
  food1:    ["el pan", "el agua", "la leche", "la manzana", "el café"],
  animals:  ["el perro", "el gato", "el pájaro", "el pez", "el caballo"],
  plurals:  ["los perros", "las gatas", "los libros", "las casas"],
  adj1:     ["grande", "pequeño", "bueno", "malo", "nuevo", "viejo"],
  verbs1:   ["ser", "estar", "tener", "hacer", "ir", "poder"],
  travel:   ["el hotel", "el aeropuerto", "el tren", "el billete"],
  family:   ["la madre", "el padre", "el hermano", "la hermana", "el hijo"],
  colors:   ["rojo", "azul", "verde", "amarillo", "negro", "blanco"],
  numbers:  ["uno", "dos", "tres", "diez", "cien", "mil"],
  verbs2:   ["hablar", "comer", "vivir", "escribir", "leer"],
  nature:   ["el árbol", "la flor", "el río", "la montaña", "el mar"],
  sports:   ["el fútbol", "el tenis", "nadar", "correr"],
};

for (const s of spanishSkills) {
  const words = skillWords[s.id] ?? [];
  const firstSeen = daysAgo(Math.floor(Math.random() * 300 + 30));
  skillStmt.run(
    isoNow(), s.id, s.name,
    s.levels >= 1 ? 1 : 0,
    s.levels / 5,
    JSON.stringify(words),
    s.levels,
    s.x, s.y,
    JSON.stringify(s.deps),
    firstSeen,
  );
}

// ── Spanish Vocabulary ────────────────────────────────────────────────────────

const vocabWords = [
  { word: "hola",          skill: "Basics 1",  bars: 4 },
  { word: "adiós",         skill: "Basics 1",  bars: 4 },
  { word: "gracias",       skill: "Basics 1",  bars: 4 },
  { word: "por favor",     skill: "Basics 1",  bars: 3 },
  { word: "sí",            skill: "Basics 1",  bars: 4 },
  { word: "no",            skill: "Basics 1",  bars: 4 },
  { word: "el pan",        skill: "Food",      bars: 3 },
  { word: "el agua",       skill: "Food",      bars: 4 },
  { word: "la leche",      skill: "Food",      bars: 2 },
  { word: "la manzana",    skill: "Food",      bars: 3 },
  { word: "el café",       skill: "Food",      bars: 4 },
  { word: "el perro",      skill: "Animals",   bars: 4 },
  { word: "el gato",       skill: "Animals",   bars: 4 },
  { word: "el pájaro",     skill: "Animals",   bars: 2 },
  { word: "el pez",        skill: "Animals",   bars: 3 },
  { word: "grande",        skill: "Adjectives 1", bars: 3 },
  { word: "pequeño",       skill: "Adjectives 1", bars: 2 },
  { word: "bueno",         skill: "Adjectives 1", bars: 4 },
  { word: "malo",          skill: "Adjectives 1", bars: 3 },
  { word: "ser",           skill: "Verbs: Present", bars: 3 },
  { word: "estar",         skill: "Verbs: Present", bars: 2 },
  { word: "tener",         skill: "Verbs: Present", bars: 3 },
  { word: "hacer",         skill: "Verbs: Present", bars: 2 },
  { word: "ir",            skill: "Verbs: Present", bars: 4 },
  { word: "la madre",      skill: "Family",    bars: 4 },
  { word: "el padre",      skill: "Family",    bars: 4 },
  { word: "el hermano",    skill: "Family",    bars: 3 },
  { word: "la hermana",    skill: "Family",    bars: 3 },
  { word: "rojo",          skill: "Colors",    bars: 4 },
  { word: "azul",          skill: "Colors",    bars: 4 },
  { word: "verde",         skill: "Colors",    bars: 3 },
  { word: "amarillo",      skill: "Colors",    bars: 2 },
  { word: "uno",           skill: "Numbers",   bars: 4 },
  { word: "dos",           skill: "Numbers",   bars: 4 },
  { word: "cien",          skill: "Numbers",   bars: 3 },
  { word: "el árbol",      skill: "Nature",    bars: 2 },
  { word: "la flor",       skill: "Nature",    bars: 3 },
  { word: "el río",        skill: "Nature",    bars: 1 },
  { word: "el fútbol",     skill: "Sports",    bars: 2 },
  { word: "nadar",         skill: "Sports",    bars: 1 },
];

const vocabStmt = db.prepare(`
  INSERT INTO vocab_snapshots (snapshot_time, course_id, word, lexeme_id, strength_bars, skill, pos, gender, last_practiced, first_seen)
  VALUES (?, 'DUOLINGO_ES_EN', ?, ?, ?, ?, NULL, NULL, NULL, ?)
`);

for (let i = 0; i < vocabWords.length; i++) {
  const v = vocabWords[i];
  const firstSeen = daysAgo(Math.floor(Math.random() * 200 + 10));
  vocabStmt.run(isoNow(), v.word, `lexeme_${i.toString().padStart(4, "0")}`, v.bars, v.skill, firstSeen);
}

db.close();
console.log(`✓ Mock database written to: ${OUT}`);
console.log(`\nTo use: DEMO_MODE=true npm run dev`);
