/**
 * The site's time zone (10i): every date and hour shown, in /admin and to the members, is the
 * clock of France, never the server's (UTC on Vercel). A member's quartier may have its own
 * (launch_zones.timezone, the Parloir and the visits); this one is the default and the admin's.
 */
export const SITE_TIME_ZONE = "Europe/Paris";
