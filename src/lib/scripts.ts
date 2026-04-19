export interface WritingSystem {
  name: string;
  type: "alphabet" | "syllabary" | "abugida" | "abjad" | "logographic" | "featural";
}

export interface LanguageScriptInfo {
  languageName: string;
  scripts: WritingSystem[];
  skillPatterns: RegExp[];
}

const LANGUAGE_SCRIPTS: Record<string, LanguageScriptInfo> = {
  ja: {
    languageName: "Japanese",
    scripts: [
      { name: "Hiragana", type: "syllabary" },
      { name: "Katakana", type: "syllabary" },
      { name: "Kanji", type: "logographic" },
    ],
    skillPatterns: [/hiragana/i, /katakana/i, /kanji/i, /characters?/i],
  },
  zh: {
    languageName: "Chinese",
    scripts: [{ name: "Hanzi", type: "logographic" }],
    skillPatterns: [/characters?/i, /radicals?/i, /hanzi/i],
  },
  ko: {
    languageName: "Korean",
    scripts: [{ name: "Hangul", type: "featural" }],
    skillPatterns: [/hangul/i, /alphabet/i, /characters?/i, /letters?/i],
  },
  ar: {
    languageName: "Arabic",
    scripts: [{ name: "Arabic", type: "abjad" }],
    skillPatterns: [/alphabet/i, /letters?/i, /script/i],
  },
  hi: {
    languageName: "Hindi",
    scripts: [{ name: "Devanagari", type: "abugida" }],
    skillPatterns: [/alphabet/i, /letters?/i, /script/i, /devanagari/i],
  },
  he: {
    languageName: "Hebrew",
    scripts: [{ name: "Hebrew", type: "abjad" }],
    skillPatterns: [/alphabet/i, /letters?/i, /script/i],
  },
  el: {
    languageName: "Greek",
    scripts: [{ name: "Greek", type: "alphabet" }],
    skillPatterns: [/alphabet/i, /letters?/i],
  },
  ru: {
    languageName: "Russian",
    scripts: [{ name: "Cyrillic", type: "alphabet" }],
    skillPatterns: [/alphabet/i, /letters?/i, /cyrillic/i],
  },
  uk: {
    languageName: "Ukrainian",
    scripts: [{ name: "Cyrillic", type: "alphabet" }],
    skillPatterns: [/alphabet/i, /letters?/i, /cyrillic/i],
  },
  th: {
    languageName: "Thai",
    scripts: [{ name: "Thai", type: "abugida" }],
    skillPatterns: [/alphabet/i, /letters?/i, /script/i, /thai/i],
  },
  vi: {
    languageName: "Vietnamese",
    scripts: [{ name: "Latin (Vietnamese)", type: "alphabet" }],
    skillPatterns: [/alphabet/i, /letters?/i],
  },
  ka: {
    languageName: "Georgian",
    scripts: [{ name: "Mkhedruli", type: "alphabet" }],
    skillPatterns: [/alphabet/i, /letters?/i, /script/i],
  },
};

const LATIN_LANGUAGES = new Set([
  "en", "es", "fr", "de", "it", "pt", "nl", "sv", "nb", "da", "fi",
  "pl", "ro", "cs", "hu", "tr", "id", "sw", "cy", "ga", "gd", "eo",
  "la", "hv", "tlh", "ca", "eu",
]);

export function getScriptInfo(languageCode: string): LanguageScriptInfo | null {
  return LANGUAGE_SCRIPTS[languageCode] ?? null;
}

export function isLatinScript(languageCode: string): boolean {
  return LATIN_LANGUAGES.has(languageCode);
}

export function isScriptSkill(skillName: string, languageCode: string): boolean {
  const info = LANGUAGE_SCRIPTS[languageCode];
  if (!info) return false;
  return info.skillPatterns.some((p) => p.test(skillName));
}

export function classifySkillsByScript(
  skills: Array<{ name: string; words: string[] }>,
  languageCode: string,
): { scriptSkills: typeof skills; contentSkills: typeof skills } {
  const scriptSkills: typeof skills = [];
  const contentSkills: typeof skills = [];

  for (const skill of skills) {
    if (isScriptSkill(skill.name, languageCode)) {
      scriptSkills.push(skill);
    } else {
      contentSkills.push(skill);
    }
  }

  return { scriptSkills, contentSkills };
}
