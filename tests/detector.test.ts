import { describe, it, expect } from "vitest";
import { RateLimitDetector } from "../src/detector.js";

describe("RateLimitDetector", () => {
  const det = new RateLimitDetector([
    "rate limit",
    "you've reached your weekly",
    "5-hour limit",
    "quota exceeded",
  ]);

  it("matches default rate-limit phrasings", () => {
    expect(det.test("Error: rate limit reached, please retry")).toBe(true);
    expect(det.test("Sorry, you've reached your weekly cap")).toBe(true);
    expect(det.test("You hit the 5-hour limit")).toBe(true);
    expect(det.test("OpenAI: quota exceeded for this account")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(det.test("RATE LIMIT exceeded")).toBe(true);
    expect(det.test("Quota Exceeded")).toBe(true);
  });

  it("ignores unrelated output", () => {
    expect(det.test("everything is fine")).toBe(false);
    expect(det.test("editing file src/foo.ts")).toBe(false);
    expect(det.test("")).toBe(false);
  });

  it("returns the matched pattern source", () => {
    const m = det.match("hit rate limit on api");
    expect(m).toBe("rate limit");
  });

  it("supports custom patterns", () => {
    const custom = new RateLimitDetector(["overloaded", "try again later"]);
    expect(custom.test("Server overloaded")).toBe(true);
    expect(custom.test("please try again later")).toBe(true);
    expect(custom.test("rate limit")).toBe(false);
  });
});
