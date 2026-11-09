import { describe, expect, it } from "vitest";
import { stripJpegMetadata } from "@/core/storage/files";

describe("stripJpegMetadata", () => {
  it("удаляет сегмент APP1 (EXIF) и сохраняет остальное", () => {
    const soi = Buffer.from([0xff, 0xd8]);
    const exif = Buffer.concat([Buffer.from([0xff, 0xe1, 0x00, 0x0b]), Buffer.from("Exif\0\0GPS")]);
    const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x01, 0x02]);
    const sos = Buffer.from([0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9]);
    const out = stripJpegMetadata(Buffer.concat([soi, exif, app0, sos]));
    expect(out.includes(Buffer.from("GPS"))).toBe(false);
    expect(out.equals(Buffer.concat([soi, app0, sos]))).toBe(true);
  });
});
