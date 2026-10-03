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
