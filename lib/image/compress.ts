/**
 * Browser-side pre-compression (SPEC §11): re-drawing on a canvas drops every metadata block
 * (EXIF/GPS) and applies the orientation. Loaded with a dynamic import on the upload screen only.
 * The server re-encodes the result anyway (lib/image/process.ts).
 */
const MAX_SIDE = 1600;
const MAX_BYTES = 1_000_000;

export async function compressForUpload(
  file: File,
  { maxBytes = MAX_BYTES }: { maxBytes?: number } = {},
): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  let scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // WebP when the browser can encode it, JPEG otherwise (older Safari).
    for (const quality of [0.85, 0.75, 0.65]) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", quality),
      );
      const output =
        blob && blob.type === "image/webp"
          ? blob
          : await new Promise<Blob | null>((resolve) =>
              canvas.toBlob(resolve, "image/jpeg", quality),
            );
      if (output && output.size <= maxBytes) {
        bitmap.close();
        return output;
      }
    }
    scale *= 0.8;
  }
  bitmap.close();
  throw new Error("too_large");
}
