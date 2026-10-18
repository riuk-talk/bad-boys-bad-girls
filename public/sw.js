// Service worker: Web Push only. No cache, no fetch handler (nothing of the site is stored).
// Registered from the members' area only, never on the landing page.
// The push carries only {t: type, u: internal path}; the texts live here and stay neutral
// (never a pseudo, a photo or a message: SPEC §7 quater). They are checked by a unit test.

// prettier-ignore
const TEXTS = /* TEXTS */ {
  "fr": {
    "request_received": ["Du courrier", "Une demande de visite t'attend."],
    "request_accepted": ["Bonne nouvelle", "Une de tes demandes de visite a été acceptée."],
    "request_dismissed": ["Une réponse", "Une de tes demandes de visite a reçu une réponse."],
    "slot_chosen": ["Visite programmée", "Une heure de visite a été choisie."],
    "visit_reminder_1h": ["Visite dans une heure", "Ta visite au Parloir commence dans une heure."],
    "visit_starting": ["C'est l'heure", "Ta visite au Parloir commence."],
    "visit_no_show": ["Visite manquée", "Une visite n'a pas eu lieu. Regarde la suite."],
    "visit_released": ["Permis permanent", "Le Parloir reste ouvert, sans horaire."],
    "visit_closed": ["Affaire classée", "Une affaire a été classée."],
    "message_received": ["Au Parloir", "Un nouveau message t'attend."],
    "promenade_open": ["La Promenade est ouverte", "Ta sélection du soir t'attend."],
    "permit_granted": ["Ton Permis est délivré", "Tu peux envoyer tes premières demandes."],
    "moderation_decision": ["Le Greffe a statué", "Va voir ta Fiche."],
    "default": ["Du nouveau", "Quelque chose t'attend."]
  },
  "en": {
    "request_received": ["Mail for you", "A visit request is waiting for you."],
    "request_accepted": ["Good news", "One of your visit requests has been accepted."],
    "request_dismissed": ["An answer", "One of your visit requests has been answered."],
    "slot_chosen": ["Visit scheduled", "A visiting time has been chosen."],
    "visit_reminder_1h": ["Visit in one hour", "Your visit in the visiting room starts in one hour."],
    "visit_starting": ["It's time", "Your visit in the visiting room is starting."],
    "visit_no_show": ["Missed visit", "A visit did not take place. See what comes next."],
    "visit_released": ["Permanent permit", "The visiting room stays open, with no set hours."],
    "visit_closed": ["Case closed", "A case has been closed."],
    "message_received": ["In the visiting room", "A new message is waiting for you."],
    "promenade_open": ["The Yard is open", "Tonight's selection is waiting for you."],
    "permit_granted": ["Your Permit is issued", "You can send your first requests."],
    "moderation_decision": ["The Registry has decided", "Have a look at your File."],
    "default": ["Something new", "Something is waiting for you."]
  }
} /* /TEXTS */;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Only same-site paths ("/x", never "//host" or a full URL).
function safePath(value) {
  return typeof value === "string" && /^\/(?![/\\])[a-z0-9/-]*$/.test(value) ? value : "/";
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const url = safePath(data.u);
  const texts = url === "/en" || url.startsWith("/en/") ? TEXTS.en : TEXTS.fr;
  const [title, body] = texts[data.t] || texts.default;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: typeof data.t === "string" ? data.t : "default",
      icon: "/brand/icon-192.png",
      badge: "/brand/icon-192.png",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = safePath(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
