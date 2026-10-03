// Service worker: installeerbaar als app + pushmeldingen. Er wordt bewust
// niets gecachet (net als WorkPortal), zodat je altijd de actuele versie en
// gegevens ziet. Oude caches van eerdere versies worden opgeruimd.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((namen) => Promise.all(namen.map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', () => {
  /* netwerk gaat gewoon door */
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
  const titel = data.titel || 'TransportManager';
  const opties = {
    body: data.tekst || '',
    icon: '/img/wp-round-192.png',
    badge: '/img/wp-round-192.png',
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
