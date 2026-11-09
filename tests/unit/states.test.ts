import { describe, expect, it } from "vitest";
import { canTransition, assertTransition } from "@/core/posts/states";

describe("машина состояний публикации", () => {
  it("публикация возможна только из approved и scheduled", () => {
    expect(canTransition("approved", "publishing")).toBe(true);
    expect(canTransition("scheduled", "publishing")).toBe(true);
    for (const s of ["draft", "review", "rejected", "failed", "archived", "publish_unknown"] as const) expect(canTransition(s, "publishing")).toBe(false);
  });
  it("черновик нельзя подтвердить, минуя проверку", () => {
    expect(canTransition("draft", "approved")).toBe(false);
    expect(canTransition("draft", "scheduled")).toBe(false);
  });
  it("published терминален", () => {
    expect(() => assertTransition("published", "draft")).toThrow();
    expect(() => assertTransition("published", "publishing")).toThrow();
  });
  it("publish_unknown нельзя повторить автоматически", () => {
    expect(canTransition("publish_unknown", "publishing")).toBe(false);
    expect(canTransition("publish_unknown", "approved")).toBe(false);
  });
});
