import { getInstanceRole, isBackgroundSyncEnabled } from "../instance-role";

const originalReadOnly = process.env.DUOLINGO_READ_ONLY;
const originalRole = process.env.DUOLINGO_INSTANCE_ROLE;

afterEach(() => {
  if (originalReadOnly === undefined) delete process.env.DUOLINGO_READ_ONLY;
  else process.env.DUOLINGO_READ_ONLY = originalReadOnly;

  if (originalRole === undefined) delete process.env.DUOLINGO_INSTANCE_ROLE;
  else process.env.DUOLINGO_INSTANCE_ROLE = originalRole;
});

describe("instance role parsing", () => {
  it("defaults to writer with background sync enabled", () => {
    delete process.env.DUOLINGO_READ_ONLY;
    delete process.env.DUOLINGO_INSTANCE_ROLE;

    expect(getInstanceRole()).toBe("writer");
    expect(isBackgroundSyncEnabled()).toBe(true);
  });

  it("supports manual mode without background sync", () => {
    delete process.env.DUOLINGO_READ_ONLY;
    process.env.DUOLINGO_INSTANCE_ROLE = "manual";

    expect(getInstanceRole()).toBe("manual");
    expect(isBackgroundSyncEnabled()).toBe(false);
  });

  it("supports read-only role", () => {
    delete process.env.DUOLINGO_READ_ONLY;
    process.env.DUOLINGO_INSTANCE_ROLE = "read-only";

    expect(getInstanceRole()).toBe("read-only");
    expect(isBackgroundSyncEnabled()).toBe(false);
  });

  it("keeps DUOLINGO_READ_ONLY compatibility and lets it win", () => {
    process.env.DUOLINGO_READ_ONLY = "1";
    process.env.DUOLINGO_INSTANCE_ROLE = "writer";

    expect(getInstanceRole()).toBe("read-only");
    expect(isBackgroundSyncEnabled()).toBe(false);
  });
});
