import { describe, expect, it } from "vitest";
import { deriveFormat } from "@/core/publishing/format";

describe("deriveFormat", () => {
  it("формат по вложениям", () => {
    expect(deriveFormat([])).toEqual({ ok: true, format: "text" });
    expect(deriveFormat(["image"])).toEqual({ ok: true, format: "photo" });
    expect(deriveFormat(["video"])).toEqual({ ok: true, format: "video" });
    expect(deriveFormat(["document"])).toEqual({ ok: true, format: "document" });
    expect(deriveFormat(["image", "video"])).toEqual({ ok: true, format: "album" });
    expect(deriveFormat(["document", "document"])).toEqual({ ok: true, format: "album" });
  });
  it("запрещённые сочетания", () => {
    expect(deriveFormat(["image", "document"]).ok).toBe(false);
    expect(deriveFormat(["voice"]).ok).toBe(false);
    expect(deriveFormat(Array(11).fill("image")).ok).toBe(false);
  });
});
