const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian",
  pt: "Portuguese", nl: "Dutch", sv: "Swedish", nb: "Norwegian", da: "Danish",
  fi: "Finnish", pl: "Polish", ro: "Romanian", cs: "Czech", hu: "Hungarian",
  tr: "Turkish", id: "Indonesian", sw: "Swahili", cy: "Welsh", ga: "Irish",
  gd: "Scottish Gaelic", eo: "Esperanto", la: "Latin", hv: "High Valyrian",
  tlh: "Klingon", ca: "Catalan", eu: "Basque", ja: "Japanese", zh: "Chinese",
  ko: "Korean", ar: "Arabic", hi: "Hindi", he: "Hebrew", el: "Greek",
  ru: "Russian", uk: "Ukrainian", th: "Thai", vi: "Vietnamese", ka: "Georgian",
  zu: "Zulu", xh: "Xhosa", yi: "Yiddish", ht: "Haitian Creole",
};

const LANGUAGE_FLAGS: Record<string, string> = {
  en: "🇬🇧", es: "🇪🇸", fr: "🇫🇷", de: "🇩🇪", it: "🇮🇹", pt: "🇧🇷",
  nl: "🇳🇱", sv: "🇸🇪", nb: "🇳🇴", da: "🇩🇰", fi: "🇫🇮", pl: "🇵🇱",
  ro: "🇷🇴", cs: "🇨🇿", hu: "🇭🇺", tr: "🇹🇷", id: "🇮🇩", sw: "🇰🇪",
  cy: "🏴󠁧󠁢󠁷󠁬󠁳󠁿", ga: "🇮🇪", gd: "🏴󠁧󠁢󠁳󠁣󠁴󠁿", ja: "🇯🇵", zh: "🇨🇳",
  ko: "🇰🇷", ar: "🇸🇦", hi: "🇮🇳", he: "🇮🇱", el: "🇬🇷", ru: "🇷🇺",
  uk: "🇺🇦", th: "🇹🇭", vi: "🇻🇳", ka: "🇬🇪", zu: "🇿🇦", xh: "🇿🇦",
};

export function getLanguageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code.toUpperCase();
}

export function getLanguageFlag(code: string): string {
  return LANGUAGE_FLAGS[code] ?? "🌐";
}
