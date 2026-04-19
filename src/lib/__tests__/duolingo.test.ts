import { DuolingoClient } from "../duolingo";

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = "fakesig";
  return `${header}.${body}.${sig}`;
}

describe("DuolingoClient", () => {
  describe("JWT parsing", () => {
    it("extracts numeric sub claim", () => {
      const jwt = makeJwt({ sub: 123456789 });
      const client = new DuolingoClient(jwt);
      expect(client.getUserId()).toBe(123456789);
    });

    it("extracts string sub claim", () => {
      const jwt = makeJwt({ sub: "123456789" });
      const client = new DuolingoClient(jwt);
      expect(client.getUserId()).toBe(123456789);
    });

    it("throws on missing sub claim", () => {
      const jwt = makeJwt({ foo: "bar" });
      expect(() => new DuolingoClient(jwt)).toThrow("valid 'sub' claim");
    });

    it("throws on invalid JWT format", () => {
      expect(() => new DuolingoClient("not-a-jwt")).toThrow("Invalid JWT format");
    });

    it("trims whitespace from JWT", () => {
      const jwt = makeJwt({ sub: 123 });
      const client = new DuolingoClient(`  ${jwt}  `);
      expect(client.getUserId()).toBe(123);
    });
  });

  describe("request error handling", () => {
    let client: DuolingoClient;

    beforeEach(() => {
      client = new DuolingoClient(makeJwt({ sub: 123 }));
    });

    it("throws on 401", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 401,
        ok: false,
        statusText: "Unauthorized",
      });
      await expect(client.getTotalXp()).rejects.toThrow("invalid or expired");
    });

    it("throws on 429", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 429,
        ok: false,
        statusText: "Too Many Requests",
      });
      await expect(client.getTotalXp()).rejects.toThrow("Rate limited");
    });

    it("throws on non-JSON content type", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Map([["content-type", "text/html; charset=UTF-8"]]),
      });
      await expect(client.getVocabulary()).rejects.toThrow("Expected JSON");
    });

    it("parses valid JSON response", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Map([["content-type", "application/json"]]),
        json: () => Promise.resolve({ totalXp: 5000 }),
      });
      const xp = await client.getTotalXp();
      expect(xp).toBe(5000);
    });
  });

  describe("legacy user endpoint", () => {
    it("uses username not numeric ID in URL", async () => {
      const client = new DuolingoClient(makeJwt({ sub: 123 }));
      const fetchMock = jest.fn()
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          headers: new Map([["content-type", "application/json"]]),
          json: () => Promise.resolve({
            id: 123, username: "testuser", name: "Test",
            courses: [], _achievements: [],
            streak: 0, streakData: {}, totalXp: 0,
            xpGoal: 0, xpGoalMetToday: false, weeklyXp: 0, monthlyXp: 0,
            gems: 0, lingots: 0, hasPlus: false, creationDate: 0,
            currentCourseId: "", learningLanguage: "en", fromLanguage: "en",
            motivation: "", picture: "", bio: "",
          }),
        })
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          headers: new Map([["content-type", "application/json"]]),
          json: () => Promise.resolve({ language_data: {}, languages: [] }),
        });
      global.fetch = fetchMock;

      await client.getLegacyUser();

      const legacyCall = fetchMock.mock.calls[1][0] as string;
      expect(legacyCall).toContain("/users/testuser?");
      expect(legacyCall).not.toContain("/users/123?");
    });

    it("uses provided username without extra API call", async () => {
      const client = new DuolingoClient(makeJwt({ sub: 123 }));
      const fetchMock = jest.fn().mockResolvedValue({
        status: 200,
        ok: true,
        headers: new Map([["content-type", "application/json"]]),
        json: () => Promise.resolve({ language_data: {}, languages: [] }),
      });
      global.fetch = fetchMock;

      await client.getLegacyUser("directuser");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect((fetchMock.mock.calls[0][0] as string)).toContain("/users/directuser?");
    });
  });
});
