// Minimale service worker: cachet alleen statische bestanden (CSS/JS/iconen)
// zodat de app-shell sneller laadt. Pagina's met ritgegevens gaan altijd over
// het netwerk, zodat chauffeurs en planners nooit verouderde data zien.
const CACHE_NAAM = 'transport-app-static-v3';
const STATISCHE_BESTANDEN = ['/styles.css', '/app.js', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAAM).then((cache) => cache.addAll(STATISCHE_BESTANDEN))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((namen) =>
      Promise.all(namen.filter((n) => n !== CACHE_NAAM).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// Pushmeldingen: toont een systeemmelding met de data die de server meestuurt
// ({ titel, tekst, url, meldingId }). Werkt ook als de app niet open staat.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { tekst: event.data ? event.data.text() : '' };
  }
  const titel = data.titel || 'Transportplanning';
  const opties = {
    body: data.tekst || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/chauffeur', meldingId: data.meldingId || null },
  };
  event.waitUntil(self.registration.showNotification(titel, opties));
});

// Klik op de melding: meld 'm als gelezen (zodat hij niet blijft opstapelen)
// en navigeer naar de bijbehorende pagina - of focus een al open tabblad.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/chauffeur';
  const meldingId = event.notification.data && event.notification.data.meldingId;

  const afhandelen = async () => {
    if (meldingId) {
      try {
        await fetch(`/chauffeur/notificaties/${meldingId}/gelezen`, { method: 'POST', credentials: 'include' });
      } catch {
        // Geen netwerk of sessie verlopen: negeren, de melding wordt dan
        // gewoon nog als ongelezen getoond in de app.
      }
    }
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientsList) {
      if ('focus' in client) {
        client.navigate(url);
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  };

  event.waitUntil(afhandelen());
});

// Netwerk-eerst (met cache als terugval): een nieuwe versie van app.js/styles.css
// die na een update op de server staat, wordt zo altijd meteen opgehaald zodra
// er internet is - een chauffeur ziet nooit een verouderde, "kapotte" knop
// alleen omdat de vorige versie nog in de cache stond. De cache dient alleen
// als terugval wanneer er geen netwerk is (offline-gebruik).
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isStatisch = STATISCHE_BESTANDEN.includes(url.pathname) || url.pathname.startsWith('/icons/');
  if (!isStatisch || event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((resp) => {
        const kopie = resp.clone();
        caches.open(CACHE_NAAM).then((cache) => cache.put(event.request, kopie));
        return resp;
      })
      .catch(() => caches.match(event.request))
  );
});
