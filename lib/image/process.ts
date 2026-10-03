import "server-only";
import sharp from "sharp";

/** Final sizes stored for every photo (SPEC §11, decision Phase 0 n° 1). */
export const PHOTO_SIZES = {
  large: { side: 1200, maxBytes: 180_000 },
  small: { side: 400, maxBytes: 30_000 },
} as const;

export const MAX_UPLOAD_BYTES = 2_000_000;
const MIN_SIDE = 400;
const QUALITIES = [80, 72, 64, 56, 48, 40];

export class PhotoError extends Error {
  constructor(
    public readonly reason: "too_large" | "unreadable" | "too_small" | "cannot_compress",
  ) {
    super(reason);
  }
}

async function encode(input: Buffer, side: number, maxBytes: number): Promise<Buffer> {
  for (const quality of QUALITIES) {
    // sharp drops every metadata block (EXIF incl. GPS, XMP, IPTC) unless asked to keep it.
    const output = await sharp(input)
      .resize({ width: side, height: side, fit: "inside", withoutEnlargement: true })
      .webp({ quality, effort: 4 })
      .toBuffer();
    if (output.length <= maxBytes) return output;
  }
  throw new PhotoError("cannot_compress");
}

/**
 * Server-side control of an uploaded photo: decodes it (any common format), applies the EXIF
 * orientation, re-encodes two WebP sizes without any metadata.
 */
export async function processPhoto(input: Buffer) {
  if (input.length > MAX_UPLOAD_BYTES) throw new PhotoError("too_large");
  let oriented: Buffer;
  let width: number;
  let height: number;
  try {
    const { data, info } = await sharp(input, { failOn: "error", limitInputPixels: 50_000_000 })
      .rotate()
      .toBuffer({ resolveWithObject: true });
    oriented = data;
    width = info.width;
    height = info.height;
  } catch {
    throw new PhotoError("unreadable");
  }
  if (Math.min(width, height) < MIN_SIDE) throw new PhotoError("too_small");

  const large = await encode(oriented, PHOTO_SIZES.large.side, PHOTO_SIZES.large.maxBytes);
  const small = await encode(oriented, PHOTO_SIZES.small.side, PHOTO_SIZES.small.maxBytes);
  const meta = await sharp(large).metadata();
  return { large, small, width: meta.width ?? 0, height: meta.height ?? 0 };
}

/** True if a WebP file carries an EXIF or XMP chunk (RIFF container scan, no decoding). */
export function webpHasMetadata(file: Buffer): boolean {
  if (
    file.length < 12 ||
    file.toString("ascii", 0, 4) !== "RIFF" ||
    file.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return true;
  }
  let offset = 12;
  while (offset + 8 <= file.length) {
    const chunk = file.toString("ascii", offset, offset + 4);
    if (chunk === "EXIF" || chunk === "XMP ") return true;
    const size = file.readUInt32LE(offset + 4);
    offset += 8 + size + (size % 2);
  }
  return false;
}
