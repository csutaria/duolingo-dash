describe("sync-state", () => {
  // Module has top-level `let currentSync` — reset between tests for isolation.
  let mod: typeof import("../sync-state");

  beforeEach(() => {
    jest.resetModules();
    mod = require("../sync-state") as typeof import("../sync-state");
  });

  it("is null on first load", () => {
    expect(mod.getCurrentSync()).toBeNull();
  });

  it("setCurrentSync populates type and a fresh startedAtMs", () => {
    const before = Date.now();
    mod.setCurrentSync("single");
    const after = Date.now();

    const snap = mod.getCurrentSync();
    expect(snap).not.toBeNull();
    expect(snap!.type).toBe("single");
    expect(snap!.startedAtMs).toBeGreaterThanOrEqual(before);
    expect(snap!.startedAtMs).toBeLessThanOrEqual(after);
  });

  it("setCurrentSync accepts 'cycle'", () => {
    mod.setCurrentSync("cycle");
    expect(mod.getCurrentSync()?.type).toBe("cycle");
  });

  it("clearCurrentSync resets to null", () => {
    mod.setCurrentSync("cycle");
    expect(mod.getCurrentSync()).not.toBeNull();

    mod.clearCurrentSync();
    expect(mod.getCurrentSync()).toBeNull();
  });

  it("clearCurrentSync is safe to call when already null", () => {
    expect(() => mod.clearCurrentSync()).not.toThrow();
    expect(mod.getCurrentSync()).toBeNull();
  });

  it("second setCurrentSync overwrites — last-write-wins", () => {
    mod.setCurrentSync("single");
    const first = mod.getCurrentSync()!;

    // Small delay so the second startedAtMs is measurably different.
    const waitMs = 5;
    const until = Date.now() + waitMs;
    // eslint-disable-next-line no-empty
    while (Date.now() < until) {}

    mod.setCurrentSync("cycle");
    const second = mod.getCurrentSync()!;

    expect(second.type).toBe("cycle");
    expect(second.startedAtMs).toBeGreaterThanOrEqual(first.startedAtMs);
  });

  it("state is isolated across fresh module loads", () => {
    mod.setCurrentSync("cycle");
    expect(mod.getCurrentSync()).not.toBeNull();

    jest.resetModules();
    const reloaded = require("../sync-state") as typeof import("../sync-state");
    expect(reloaded.getCurrentSync()).toBeNull();
  });
});
