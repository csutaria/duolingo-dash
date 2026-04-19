describe("sync XP summary mapping", () => {
  it("defaults null fields to safe values", () => {
    const rawSummaries = [
      { date: 1713398400, gainedXp: null, frozen: null, streakExtended: null, dailyGoalXp: null, numSessions: null, totalSessionTime: null },
      { date: 1713484800, gainedXp: 50, frozen: false, streakExtended: true, dailyGoalXp: 10, numSessions: 3, totalSessionTime: 600 },
      { date: null, gainedXp: 10, frozen: false, streakExtended: true, dailyGoalXp: 10, numSessions: 1, totalSessionTime: 120 },
    ];

    const mapped = rawSummaries
      .filter((s) => s.date != null)
      .map((s) => ({
        date: new Date((s.date ?? 0) * 1000).toISOString().split("T")[0],
        gainedXp: s.gainedXp ?? 0,
        frozen: s.frozen ?? false,
        streakExtended: s.streakExtended ?? false,
        dailyGoalXp: s.dailyGoalXp ?? 0,
        numSessions: s.numSessions ?? 0,
        totalSessionTime: s.totalSessionTime ?? 0,
      }));

    expect(mapped).toHaveLength(2);
    expect(mapped[0].gainedXp).toBe(0);
    expect(mapped[0].frozen).toBe(false);
    expect(mapped[0].numSessions).toBe(0);
    expect(mapped[1].gainedXp).toBe(50);
    expect(mapped[1].numSessions).toBe(3);
  });

  it("filters entries with null dates", () => {
    const rawSummaries = [
      { date: null, gainedXp: 10 },
      { date: undefined, gainedXp: 20 },
      { date: 1713398400, gainedXp: 30 },
    ];

    const filtered = rawSummaries.filter((s) => s.date != null);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].gainedXp).toBe(30);
  });
});

describe("avatar URL handling", () => {
  it("prepends https to protocol-relative URLs", () => {
    const picture = "//simg-ssl.duolingo.com/ssr-avatars/123/SSR-abc";
    const url = picture.replace(/^\/\//, "https://");
    expect(url).toBe("https://simg-ssl.duolingo.com/ssr-avatars/123/SSR-abc");
  });

  it("appends size suffix for accessible URL", () => {
    const picture = "//simg-ssl.duolingo.com/ssr-avatars/123/SSR-abc";
    const url = `${picture.replace(/^\/\//, "https://")}/xlarge`;
    expect(url).toBe("https://simg-ssl.duolingo.com/ssr-avatars/123/SSR-abc/xlarge");
  });

  it("does not double-prefix https URLs", () => {
    const picture = "https://simg-ssl.duolingo.com/ssr-avatars/123/SSR-abc";
    const url = picture.replace(/^\/\//, "https://");
    expect(url).toBe("https://simg-ssl.duolingo.com/ssr-avatars/123/SSR-abc");
  });
});
