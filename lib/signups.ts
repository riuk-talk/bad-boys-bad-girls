import "server-only";
import { isSignupsOpen } from "./signups-flag";

/** Whether new accounts may be created: closed by default, see isSignupsOpen. */
export function signupsOpen(): boolean {
  return isSignupsOpen(process.env.SIGNUPS_OPEN);
}
