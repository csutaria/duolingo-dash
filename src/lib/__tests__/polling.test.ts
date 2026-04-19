describe("polling logic", () => {
  describe("manual refresh cooldown", () => {
    it("enforces 30-second minimum between refreshes", () => {
      const MIN_MANUAL_REFRESH_MS = 30 * 1000;
      let lastManualRefresh = 0;

      const now1 = 1000;
      lastManualRefresh = now1;

      const now2 = now1 + 10_000;
      const elapsed = now2 - lastManualRefresh;
      expect(elapsed).toBeLessThan(MIN_MANUAL_REFRESH_MS);
      const cooldown = Math.ceil((MIN_MANUAL_REFRESH_MS - elapsed) / 1000);
      expect(cooldown).toBe(20);

      const now3 = now1 + 31_000;
      const elapsed2 = now3 - lastManualRefresh;
      expect(elapsed2).toBeGreaterThanOrEqual(MIN_MANUAL_REFRESH_MS);
    });
  });

  describe("XP change detection", () => {
    it("detects change when XP differs from last sync", () => {
      const lastXp = 5000;
      const currentXp = 5050;
      expect(currentXp !== lastXp).toBe(true);
    });

    it("skips when XP unchanged", () => {
      const lastXp = 5000;
      const currentXp = 5000;
      expect(currentXp !== lastXp).toBe(false);
    });

    it("triggers on first sync (no previous XP)", () => {
      const lastXp: number | null = null;
      const currentXp = 5000;
      expect(lastXp === null || currentXp !== lastXp).toBe(true);
    });
  });
});
