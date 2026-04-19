import type { LegacyLanguageData, LegacyUserData } from "./types";

/** Alternate top-level `language_data` keys for legacy `GET /users/{username}`. */
const LANGUAGE_DATA_ALIASES: Record<string, readonly string[]> = {
  nb: ["no"],
  no: ["nb"],
  zh: ["zs"],
  zs: ["zh"],
};

export type ResolvedLegacyLanguage = {
  key: string | null;
  data: LegacyLanguageData | undefined;
};

/** Match `language_data[?]` to a course `learningLanguage`; returns matched key + block. See `docs/api-map.md` §⑤. */
export function resolveLegacyLanguageEntry(
  legacy: LegacyUserData | undefined,
  learningLanguage: string,
): ResolvedLegacyLanguage {
  const ld = legacy?.language_data;
  if (!ld) {
    return { key: null, data: undefined };
  }

  const tryKey = (key: string): LegacyLanguageData | undefined => {
    const block = ld[key];
    return block !== undefined ? block : undefined;
  };

  let block = tryKey(learningLanguage);
  if (block) return { key: learningLanguage, data: block };

  const lower = learningLanguage.toLowerCase();
  if (lower !== learningLanguage) {
    block = tryKey(lower);
    if (block) return { key: lower, data: block };
  }

  for (const k of Object.keys(ld)) {
    const b = ld[k];
    if (b.language === learningLanguage || b.language === lower) {
      return { key: k, data: b };
    }
  }

  for (const alt of LANGUAGE_DATA_ALIASES[lower] ?? []) {
    block = tryKey(alt);
    if (block) return { key: alt, data: block };
  }

  const keys = Object.keys(ld);
  if (keys.length === 1) {
    const only = ld[keys[0]];
    return { key: keys[0], data: only };
  }

  return { key: null, data: undefined };
}

/** Same as `resolveLegacyLanguageEntry` but returns the block only. */
export function resolveLegacyLanguageData(
  legacy: LegacyUserData | undefined,
  learningLanguage: string,
): LegacyLanguageData | undefined {
  return resolveLegacyLanguageEntry(legacy, learningLanguage).data;
}
