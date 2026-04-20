import type { DuolingoClient } from "../duolingo";

type ServerStateModule = typeof import("../server-state");

/**
 * server-state.ts holds singletons at module scope (`client`, `userPaused`),
 * delegates timer lifecycle to ./polling, and client construction to ./duolingo.
 * Each test loads the module fresh via `jest.isolateModules` with both
 * collaborators mocked so no real timers start and no JWT is needed.
 */

type PollingMockState = {
  polling: boolean;
  startPolling: jest.Mock<void, [DuolingoClient]>;
  stopPolling: jest.Mock<void, []>;
  isPolling: jest.Mock<boolean, []>;
};

type DuolingoMockState = {
  initClient: jest.Mock<DuolingoClient, [string]>;
  client: DuolingoClient;
};

function setupMocks(): { polling: PollingMockState; duolingo: DuolingoMockState } {
  const pollingState: PollingMockState = {
    polling: false,
    startPolling: jest.fn(),
    stopPolling: jest.fn(),
    isPolling: jest.fn(),
  };
  // Wire start/stop to flip the flag, then let isPolling read it.
  pollingState.startPolling.mockImplementation(() => {
    pollingState.polling = true;
  });
  pollingState.stopPolling.mockImplementation(() => {
    pollingState.polling = false;
  });
  pollingState.isPolling.mockImplementation(() => pollingState.polling);

  const fakeClient = { __fake: true } as unknown as DuolingoClient;
  const duolingoState: DuolingoMockState = {
    initClient: jest.fn((_jwt: string): DuolingoClient => fakeClient),
    client: fakeClient,
  };

  jest.doMock("../polling", () => ({
    startPolling: pollingState.startPolling,
    stopPolling: pollingState.stopPolling,
    isPolling: pollingState.isPolling,
  }));
  jest.doMock("../duolingo", () => ({
    initClient: duolingoState.initClient,
  }));

  return { polling: pollingState, duolingo: duolingoState };
}

function loadServerState(): ServerStateModule {
  return require("../server-state") as ServerStateModule;
}

const originalJwt = process.env.DUOLINGO_JWT;

beforeEach(() => {
  jest.resetModules();
  jest.dontMock("../polling");
  jest.dontMock("../duolingo");
});

afterEach(() => {
  if (originalJwt === undefined) {
    delete process.env.DUOLINGO_JWT;
  } else {
    process.env.DUOLINGO_JWT = originalJwt;
  }
  jest.resetModules();
  jest.dontMock("../polling");
  jest.dontMock("../duolingo");
});

describe("isUserPaused", () => {
  it("defaults to false on a fresh module", () => {
    setupMocks();
    const mod = loadServerState();
    expect(mod.isUserPaused()).toBe(false);
  });
});

describe("pauseUserPolling", () => {
  it("sets paused and calls stopPolling", () => {
    const { polling } = setupMocks();
    const mod = loadServerState();

    mod.pauseUserPolling();

    expect(mod.isUserPaused()).toBe(true);
    expect(polling.stopPolling).toHaveBeenCalledTimes(1);
  });

  it("is safe to call when polling is already stopped", () => {
    const { polling } = setupMocks();
    const mod = loadServerState();

    expect(() => mod.pauseUserPolling()).not.toThrow();
    expect(polling.stopPolling).toHaveBeenCalledTimes(1);
    expect(mod.isUserPaused()).toBe(true);
  });
});

describe("resumeUserPolling", () => {
  it("clears paused but does not start polling when no client exists", () => {
    const { polling } = setupMocks();
    const mod = loadServerState();

    mod.pauseUserPolling();
    mod.resumeUserPolling();

    expect(mod.isUserPaused()).toBe(false);
    expect(polling.startPolling).not.toHaveBeenCalled();
  });

  it("restarts polling when a client exists and polling is not running", () => {
    process.env.DUOLINGO_JWT = "test-jwt";
    const { polling, duolingo } = setupMocks();
    const mod = loadServerState();

    mod.ensureClient(); // creates client; also kicks off polling (initial state: polling=false, userPaused=false)
    expect(polling.startPolling).toHaveBeenCalledTimes(1);

    mod.pauseUserPolling();
    expect(polling.polling).toBe(false);

    mod.resumeUserPolling();
    expect(mod.isUserPaused()).toBe(false);
    expect(polling.startPolling).toHaveBeenCalledTimes(2);
    expect(polling.startPolling).toHaveBeenLastCalledWith(duolingo.client);
  });

  it("does not double-start polling when it's already running", () => {
    process.env.DUOLINGO_JWT = "test-jwt";
    const { polling } = setupMocks();
    const mod = loadServerState();

    mod.ensureClient();
    expect(polling.startPolling).toHaveBeenCalledTimes(1);
    expect(polling.polling).toBe(true);

    mod.resumeUserPolling(); // not paused, polling already running
    expect(polling.startPolling).toHaveBeenCalledTimes(1);
  });
});

describe("ensureClient", () => {
  it("throws when DUOLINGO_JWT is not set", () => {
    delete process.env.DUOLINGO_JWT;
    setupMocks();
    const mod = loadServerState();

    expect(() => mod.ensureClient()).toThrow(/DUOLINGO_JWT/);
  });

  it("creates the client and starts polling on first call", () => {
    process.env.DUOLINGO_JWT = "test-jwt";
    const { polling, duolingo } = setupMocks();
    const mod = loadServerState();

    const client = mod.ensureClient();

    expect(duolingo.initClient).toHaveBeenCalledWith("test-jwt");
    expect(client).toBe(duolingo.client);
    expect(polling.startPolling).toHaveBeenCalledTimes(1);
  });

  it("returns the same singleton on subsequent calls without re-initializing", () => {
    process.env.DUOLINGO_JWT = "test-jwt";
    const { polling, duolingo } = setupMocks();
    const mod = loadServerState();

    const first = mod.ensureClient();
    const second = mod.ensureClient();

    expect(second).toBe(first);
    expect(duolingo.initClient).toHaveBeenCalledTimes(1);
    expect(polling.startPolling).toHaveBeenCalledTimes(1);
  });

  it("does NOT start polling when userPaused is true — regression guard", () => {
    process.env.DUOLINGO_JWT = "test-jwt";
    const { polling } = setupMocks();
    const mod = loadServerState();

    // Simulate the real sequence: user paused, then something triggers ensureClient
    // (e.g. the /api/polling resume handler, or any read path).
    mod.pauseUserPolling();
    mod.ensureClient();

    expect(polling.startPolling).not.toHaveBeenCalled();
    expect(mod.isUserPaused()).toBe(true);
  });

  it("does not call startPolling if polling is already running", () => {
    process.env.DUOLINGO_JWT = "test-jwt";
    const { polling } = setupMocks();
    polling.polling = true; // pretend something else already started it

    const mod = loadServerState();
    mod.ensureClient();

    expect(polling.startPolling).not.toHaveBeenCalled();
  });
});

describe("getClientOrNull", () => {
  it("returns null (not throw) when DUOLINGO_JWT is not set", () => {
    delete process.env.DUOLINGO_JWT;
    setupMocks();
    const mod = loadServerState();

    expect(mod.getClientOrNull()).toBeNull();
  });

  it("returns the singleton client when JWT is set", () => {
    process.env.DUOLINGO_JWT = "test-jwt";
    const { duolingo } = setupMocks();
    const mod = loadServerState();

    expect(mod.getClientOrNull()).toBe(duolingo.client);
  });
});

describe("resetClient", () => {
  it("stops polling and clears the client so the next ensureClient re-initializes", () => {
    process.env.DUOLINGO_JWT = "test-jwt";
    const { polling, duolingo } = setupMocks();
    const mod = loadServerState();

    mod.ensureClient();
    expect(duolingo.initClient).toHaveBeenCalledTimes(1);

    mod.resetClient();
    expect(polling.stopPolling).toHaveBeenCalledTimes(1);

    mod.ensureClient();
    expect(duolingo.initClient).toHaveBeenCalledTimes(2);
  });
});
