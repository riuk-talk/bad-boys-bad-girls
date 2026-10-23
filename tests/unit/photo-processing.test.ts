import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { PHOTO_SIZES, PhotoError, processPhoto, webpHasMetadata } =
  await import("@/lib/image/process");

async function photoWithGps(width = 2400, height = 1800) {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .withExif({
      IFD0: { Make: "TestCam" },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "43/1 7/1 0/1",
        GPSLongitudeRef: "E",
        GPSLongitude: "5/1 55/1 0/1",
      },
    })
    .toBuffer();
}

describe("processPhoto", () => {
  it("the source really carries EXIF and GPS (sanity check)", async () => {
    const meta = await sharp(await photoWithGps()).metadata();
    expect(meta.exif).toBeDefined();
    expect(meta.orientation).toBe(6);
  });

  it("outputs two WebP files without any EXIF/XMP, within size limits", async () => {
    const result = await processPhoto(await photoWithGps());
    for (const [file, limits] of [
      [result.large, PHOTO_SIZES.large],
      [result.small, PHOTO_SIZES.small],
    ] as const) {
      const meta = await sharp(file).metadata();
      expect(meta.format).toBe("webp");
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(webpHasMetadata(file)).toBe(false);
      expect(file.length).toBeLessThanOrEqual(limits.maxBytes);
      expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(limits.side);
    }
  });

  it("applies the EXIF orientation before dropping it (portrait stays portrait)", async () => {
    const result = await processPhoto(await photoWithGps(2400, 1800));
    expect(result.height).toBeGreaterThan(result.width);
  });

  it("refuses unreadable and tiny images", async () => {
    await expect(processPhoto(Buffer.from("not an image"))).rejects.toBeInstanceOf(PhotoError);
    const tiny = await sharp({
      create: { width: 200, height: 200, channels: 3, background: "#000" },
    })
      .png()
      .toBuffer();
    await expect(processPhoto(tiny)).rejects.toMatchObject({ reason: "too_small" });
  });

  it("detects metadata chunks in a WebP container", async () => {
    const withExif = await sharp(await photoWithGps())
      .webp()
      .withExif({ IFD0: { Make: "X" } })
      .toBuffer();
    expect(webpHasMetadata(withExif)).toBe(true);
  });
});

describe("processPhoto and cut-out photos (version B, 2026-10-23)", () => {
  /** A person-like opaque block in the middle of a transparent 900 × 1200 picture. */
  async function cutoutPng() {
    const person = await sharp({
      create: {
        width: 500,
        height: 900,
        channels: 4,
        background: { r: 60, g: 40, b: 30, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    return sharp({
      create: { width: 900, height: 1200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: person, left: 200, top: 300 }])
      .png()
      .toBuffer();
  }

  it("keeps the transparency of a cut-out pose, in WebP, within the size limits", async () => {
    const result = await processPhoto(await cutoutPng(), { keepCutout: true });
    expect(result.cutout).toBe(true);
    for (const [file, limit] of [
      [result.large, PHOTO_SIZES.large.maxBytes],
      [result.small, PHOTO_SIZES.small.maxBytes],
    ] as const) {
      const meta = await sharp(file).metadata();
      expect(meta.format).toBe("webp");
      expect(meta.hasAlpha).toBe(true);
      expect(file.length).toBeLessThanOrEqual(limit);
      expect(file.length).toBeLessThanOrEqual(262_144);
    }
  });

  it("flattens any transparency on the wall colour where a cut-out is not expected", async () => {
    const result = await processPhoto(await cutoutPng());
    expect(result.cutout).toBe(false);
    expect((await sharp(result.large).metadata()).hasAlpha).toBe(false);
    const { data } = await sharp(result.large)
      .extract({ left: 5, top: 5, width: 1, height: 1 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([...data].slice(0, 3).map((v) => Math.round(v / 8))).toEqual(
      [189, 183, 172].map((v) => Math.round(v / 8)),
    );
  });

  it("an opaque photo is never marked as cut out", async () => {
    const result = await processPhoto(await photoWithGps(), { keepCutout: true });
    expect(result.cutout).toBe(false);
    expect((await sharp(result.large).metadata()).hasAlpha).toBe(false);
  });
});
