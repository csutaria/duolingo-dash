import { allowedDevOriginsFromEnv } from "../dev-origins";

describe("allowedDevOriginsFromEnv", () => {
  it("allows loopback hosts by default", () => {
    expect(allowedDevOriginsFromEnv(undefined)).toEqual(["127.0.0.1", "[::1]"]);
  });

  it("adds comma- and whitespace-separated hosts from NEXT_ALLOWED_DEV_ORIGINS", () => {
    expect(allowedDevOriginsFromEnv("dash.local, *.example.test other.local")).toEqual([
      "127.0.0.1",
      "[::1]",
      "dash.local",
      "*.example.test",
      "other.local",
    ]);
  });

  it("normalizes full origins to hostnames because Next compares host only", () => {
    expect(allowedDevOriginsFromEnv("http://Dash.Local:3000 https://example.test/path")).toEqual([
      "127.0.0.1",
      "[::1]",
      "dash.local",
      "example.test",
    ]);
  });

  it("deduplicates while preserving the first occurrence", () => {
    expect(allowedDevOriginsFromEnv("127.0.0.1 Dash.Local dash.local")).toEqual([
      "127.0.0.1",
      "[::1]",
      "dash.local",
    ]);
  });
});
