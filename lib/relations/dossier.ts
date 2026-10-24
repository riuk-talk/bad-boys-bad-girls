/** A fixed tilt for each folder photo (from the profile id), -3° to 3°: the same at every render. */
export function tiltOf(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return (Math.abs(hash) % 7) - 3;
}
