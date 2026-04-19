import { getLanguageName, getLanguageFlag } from "../language-names";

describe("language-names", () => {
  describe("getLanguageName", () => {
    it("returns known language names", () => {
      expect(getLanguageName("uk")).toBe("Ukrainian");
      expect(getLanguageName("ja")).toBe("Japanese");
      expect(getLanguageName("zh")).toBe("Chinese");
      expect(getLanguageName("ko")).toBe("Korean");
      expect(getLanguageName("es")).toBe("Spanish");
      expect(getLanguageName("hi")).toBe("Hindi");
    });

    it("returns uppercased code for unknown languages", () => {
      expect(getLanguageName("xx")).toBe("XX");
      expect(getLanguageName("nv")).toBe("NV");
    });
  });

  describe("getLanguageFlag", () => {
    it("returns flags for known languages", () => {
      expect(getLanguageFlag("ja")).toBe("🇯🇵");
      expect(getLanguageFlag("ko")).toBe("🇰🇷");
      expect(getLanguageFlag("uk")).toBe("🇺🇦");
    });

    it("returns globe emoji for unknown languages", () => {
      expect(getLanguageFlag("xx")).toBe("🌐");
    });
  });
});
