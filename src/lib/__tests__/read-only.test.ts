/**
 * `isReadOnlyMode()` is a thin env-var read but the values it accepts
 * are part of the contract documented in README + architecture, so
 * pin them down with a tiny truth table.
 */

import { isReadOnlyMode } from "../read-only";

const original = process.env.DUOLINGO_READ_ONLY;
const originalRole = process.env.DUOLINGO_INSTANCE_ROLE;

afterEach(() => {
  if (original === undefined) {
    delete process.env.DUOLINGO_READ_ONLY;
  } else {
    process.env.DUOLINGO_READ_ONLY = original;
  }
  if (originalRole === undefined) {
    delete process.env.DUOLINGO_INSTANCE_ROLE;
  } else {
    process.env.DUOLINGO_INSTANCE_ROLE = originalRole;
  }
});

describe("isReadOnlyMode", () => {
  it.each([
    ["1", true],
    ["true", true],
    ["TRUE", true],
    ["yes", true],
    ["", false],
    ["0", false],
    ["false", false],
    ["no", false],
    ["random", false],
  ])("DUOLINGO_READ_ONLY=%j → %s", (value, expected) => {
    if (value === "") {
      delete process.env.DUOLINGO_READ_ONLY;
    } else {
      process.env.DUOLINGO_READ_ONLY = value;
    }
    expect(isReadOnlyMode()).toBe(expected);
  });

  it("is false when the env var is unset entirely", () => {
    delete process.env.DUOLINGO_READ_ONLY;
    delete process.env.DUOLINGO_INSTANCE_ROLE;
    expect(isReadOnlyMode()).toBe(false);
  });
});
