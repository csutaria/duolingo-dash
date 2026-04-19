import { getScriptInfo, isLatinScript, isScriptSkill, classifySkillsByScript } from "../scripts";

describe("scripts", () => {
  describe("getScriptInfo", () => {
    it("returns script info for Japanese", () => {
      const info = getScriptInfo("ja");
      expect(info).not.toBeNull();
      expect(info!.scripts).toHaveLength(3);
      expect(info!.scripts.map((s) => s.name)).toEqual(["Hiragana", "Katakana", "Kanji"]);
      expect(info!.scripts.map((s) => s.type)).toEqual(["syllabary", "syllabary", "logographic"]);
    });

    it("returns script info for Korean", () => {
      const info = getScriptInfo("ko");
      expect(info).not.toBeNull();
      expect(info!.scripts[0].name).toBe("Hangul");
      expect(info!.scripts[0].type).toBe("featural");
    });

    it("returns script info for Ukrainian (Cyrillic)", () => {
      const info = getScriptInfo("uk");
      expect(info).not.toBeNull();
      expect(info!.scripts[0].name).toBe("Cyrillic");
      expect(info!.scripts[0].type).toBe("alphabet");
    });

    it("returns script info for Arabic", () => {
      const info = getScriptInfo("ar");
      expect(info).not.toBeNull();
      expect(info!.scripts[0].type).toBe("abjad");
    });

    it("returns script info for Hindi", () => {
      const info = getScriptInfo("hi");
      expect(info).not.toBeNull();
      expect(info!.scripts[0].type).toBe("abugida");
    });

    it("returns null for Latin-script languages", () => {
      expect(getScriptInfo("es")).toBeNull();
      expect(getScriptInfo("fr")).toBeNull();
      expect(getScriptInfo("de")).toBeNull();
    });

    it("returns null for unknown language codes", () => {
      expect(getScriptInfo("xx")).toBeNull();
    });
  });

  describe("isLatinScript", () => {
    it("identifies Latin-script languages", () => {
      expect(isLatinScript("es")).toBe(true);
      expect(isLatinScript("fr")).toBe(true);
      expect(isLatinScript("eo")).toBe(true);
    });

    it("identifies non-Latin languages", () => {
      expect(isLatinScript("ja")).toBe(false);
      expect(isLatinScript("ko")).toBe(false);
      expect(isLatinScript("ar")).toBe(false);
    });
  });

  describe("isScriptSkill", () => {
    it("identifies Hiragana/Katakana skills in Japanese", () => {
      expect(isScriptSkill("Hiragana 1", "ja")).toBe(true);
      expect(isScriptSkill("Katakana 2", "ja")).toBe(true);
      expect(isScriptSkill("Kanji", "ja")).toBe(true);
    });

    it("identifies Alphabet skills in Ukrainian", () => {
      expect(isScriptSkill("Alphabet 1", "uk")).toBe(true);
      expect(isScriptSkill("Alphabet 2", "uk")).toBe(true);
    });

    it("does not flag content skills as script skills", () => {
      expect(isScriptSkill("Animals", "ja")).toBe(false);
      expect(isScriptSkill("Food", "uk")).toBe(false);
      expect(isScriptSkill("Phrases", "ko")).toBe(false);
    });

    it("returns false for languages without script config", () => {
      expect(isScriptSkill("Alphabet 1", "es")).toBe(false);
    });
  });

  describe("classifySkillsByScript", () => {
    it("separates script skills from content skills", () => {
      const skills = [
        { name: "Hiragana 1", words: ["あ"] },
        { name: "Food", words: ["食べ物"] },
        { name: "Katakana 1", words: ["ア"] },
        { name: "Animals", words: ["猫"] },
      ];
      const { scriptSkills, contentSkills } = classifySkillsByScript(skills, "ja");
      expect(scriptSkills).toHaveLength(2);
      expect(contentSkills).toHaveLength(2);
      expect(scriptSkills.map((s) => s.name)).toEqual(["Hiragana 1", "Katakana 1"]);
    });

    it("returns all as content for Latin languages", () => {
      const skills = [
        { name: "Basics", words: ["hola"] },
        { name: "Food", words: ["comida"] },
      ];
      const { scriptSkills, contentSkills } = classifySkillsByScript(skills, "es");
      expect(scriptSkills).toHaveLength(0);
      expect(contentSkills).toHaveLength(2);
    });
  });
});
