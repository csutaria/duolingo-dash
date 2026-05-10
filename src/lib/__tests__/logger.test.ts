import { getLogLevel, logger, shouldLog } from "../logger";

const originalNodeEnv = process.env.NODE_ENV;
const originalLogLevel = process.env.LOG_LEVEL;
const originalJwt = process.env.DUOLINGO_JWT;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  if (originalLogLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = originalLogLevel;
  if (originalJwt === undefined) delete process.env.DUOLINGO_JWT;
  else process.env.DUOLINGO_JWT = originalJwt;
  jest.restoreAllMocks();
});

describe("logger", () => {
  it("defaults to debug in development and info otherwise", () => {
    process.env.NODE_ENV = "development";
    delete process.env.LOG_LEVEL;
    expect(getLogLevel()).toBe("debug");

    process.env.NODE_ENV = "production";
    expect(getLogLevel()).toBe("info");
  });

  it("honors LOG_LEVEL", () => {
    process.env.LOG_LEVEL = "warn";
    expect(getLogLevel()).toBe("warn");
    expect(shouldLog("info")).toBe(false);
    expect(shouldLog("error")).toBe(true);
  });

  it("does not emit debug logs above debug level", () => {
    process.env.LOG_LEVEL = "info";
    const debug = jest.spyOn(console, "debug").mockImplementation(() => {});

    logger.debug("polling transition", { mode: "fast" });

    expect(debug).not.toHaveBeenCalled();
  });

  it("emits structured metadata without reading secrets", () => {
    process.env.LOG_LEVEL = "debug";
    const debug = jest.spyOn(console, "debug").mockImplementation(() => {});

    logger.debug("sync start", { cycleAll: true });

    expect(debug).toHaveBeenCalledWith("[duolingo-dash] sync start", { cycleAll: true });
  });

  it("does not read sensitive env values into log lines", () => {
    process.env.LOG_LEVEL = "info";
    process.env.DUOLINGO_JWT = "secret-jwt-value";
    const info = jest.spyOn(console, "info").mockImplementation(() => {});

    logger.info("polling start");

    expect(JSON.stringify(info.mock.calls)).not.toContain("secret-jwt-value");
  });
});
