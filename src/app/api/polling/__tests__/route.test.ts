/**
 * Route handler test for POST /api/polling.
 *
 * Next.js App Router handlers are plain async functions over Request/Response
 * — no Next.js harness needed. We mock @/lib/server-state and @/lib/polling so
 * no real timers or client initialization runs, then call POST(request) directly.
 */

type PollingMock = {
  polling: boolean;
  isPolling: jest.Mock<boolean, []>;
};

type ServerStateMock = {
  paused: boolean;
  ensureClient: jest.Mock<unknown, []>;
  isUserPaused: jest.Mock<boolean, []>;
  pauseUserPolling: jest.Mock<void, []>;
  resumeUserPolling: jest.Mock<void, []>;
};

function setupMocks() {
  const polling: PollingMock = {
    polling: false,
    isPolling: jest.fn(),
  };
  polling.isPolling.mockImplementation(() => polling.polling);

  const server: ServerStateMock = {
    paused: false,
    ensureClient: jest.fn(() => ({ __fake: true })),
    isUserPaused: jest.fn(),
    pauseUserPolling: jest.fn(),
    resumeUserPolling: jest.fn(),
  };
  server.isUserPaused.mockImplementation(() => server.paused);
  server.pauseUserPolling.mockImplementation(() => {
    server.paused = true;
    polling.polling = false;
  });
  server.resumeUserPolling.mockImplementation(() => {
    server.paused = false;
    polling.polling = true;
  });

  jest.doMock("@/lib/polling", () => ({ isPolling: polling.isPolling }));
  jest.doMock("@/lib/server-state", () => ({
    ensureClient: server.ensureClient,
    isUserPaused: server.isUserPaused,
    pauseUserPolling: server.pauseUserPolling,
    resumeUserPolling: server.resumeUserPolling,
  }));

  return { polling, server };
}

function loadRoute() {
  return require("../route") as typeof import("../route");
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/polling", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.resetModules();
  jest.dontMock("@/lib/polling");
  jest.dontMock("@/lib/server-state");
});

afterEach(() => {
  jest.resetModules();
  jest.dontMock("@/lib/polling");
  jest.dontMock("@/lib/server-state");
});

describe("POST /api/polling", () => {
  describe("action: pause", () => {
    it("returns 200 with paused=true, polling=false and calls pauseUserPolling", async () => {
      const { polling, server } = setupMocks();
      polling.polling = true; // pretend polling was running before the pause
      const { POST } = loadRoute();

      const res = await POST(postRequest({ action: "pause" }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ paused: true, polling: false });
      expect(server.pauseUserPolling).toHaveBeenCalledTimes(1);
      expect(server.ensureClient).not.toHaveBeenCalled();
      expect(server.resumeUserPolling).not.toHaveBeenCalled();
    });
  });

  describe("action: resume", () => {
    it("returns 200 with paused=false, polling=true and calls ensureClient + resumeUserPolling", async () => {
      const { server } = setupMocks();
      server.paused = true; // the user was paused coming in
      const { POST } = loadRoute();

      const res = await POST(postRequest({ action: "resume" }));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ paused: false, polling: true });
      expect(server.ensureClient).toHaveBeenCalledTimes(1);
      expect(server.resumeUserPolling).toHaveBeenCalledTimes(1);
      // ensureClient must be called before resumeUserPolling so the singleton exists
      // when resumeUserPolling checks `if (client && !isPolling())`.
      const ensureCallOrder = server.ensureClient.mock.invocationCallOrder[0];
      const resumeCallOrder = server.resumeUserPolling.mock.invocationCallOrder[0];
      expect(ensureCallOrder).toBeLessThan(resumeCallOrder);
      expect(server.pauseUserPolling).not.toHaveBeenCalled();
    });
  });

  describe("invalid input", () => {
    it("returns 400 for an unknown action", async () => {
      const { server } = setupMocks();
      const { POST } = loadRoute();

      const res = await POST(postRequest({ action: "nope" }));
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body).toEqual({ error: "action must be 'pause' or 'resume'" });
      expect(server.pauseUserPolling).not.toHaveBeenCalled();
      expect(server.resumeUserPolling).not.toHaveBeenCalled();
      expect(server.ensureClient).not.toHaveBeenCalled();
    });

    it("returns 400 when action is missing", async () => {
      const { server } = setupMocks();
      const { POST } = loadRoute();

      const res = await POST(postRequest({}));
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toMatch(/pause|resume/);
      expect(server.pauseUserPolling).not.toHaveBeenCalled();
      expect(server.resumeUserPolling).not.toHaveBeenCalled();
    });

    it("treats invalid JSON as an empty body and returns 400", async () => {
      const { server } = setupMocks();
      const { POST } = loadRoute();

      const res = await POST(postRequest("not valid json"));
      expect(res.status).toBe(400);
      expect(server.pauseUserPolling).not.toHaveBeenCalled();
      expect(server.resumeUserPolling).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("returns 500 with the message when ensureClient throws during resume", async () => {
      const { server } = setupMocks();
      server.ensureClient.mockImplementation(() => {
        throw new Error("DUOLINGO_JWT environment variable is not set");
      });
      const { POST } = loadRoute();

      const res = await POST(postRequest({ action: "resume" }));
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.error).toBe("DUOLINGO_JWT environment variable is not set");
      expect(server.resumeUserPolling).not.toHaveBeenCalled();
    });
  });
});
