// Automatische routeafstand via OpenRouteService (openrouteservice.org).
// Gebruikt alleen Node's ingebouwde fetch — geen extra package nodig.
//
// Vereist een gratis account + API-sleutel op openrouteservice.org, die als
// omgevingsvariabele ORS_API_KEY moet worden ingesteld. Zonder sleutel werkt
// de rest van de app gewoon door: de planner vult de kilometers dan zelf in.

const ORS_API_KEY = process.env.ORS_API_KEY;
const ORS_BASIS = 'https://api.openrouteservice.org';

export function routeBerekeningActief() {
  return Boolean(ORS_API_KEY);
}

async function fetchMetTimeout(url, opties = {}, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opties, signal: controller.signal });
  } catch (fout) {
    if (fout.name === 'AbortError') {
      throw new Error('De routedienst reageerde niet op tijd. Probeer het later opnieuw.');
    }
    throw fout;
  } finally {
    clearTimeout(timer);
  }
}

async function geocodeAdres(adres) {
  const url = new URL(`${ORS_BASIS}/geocode/search`);
  url.searchParams.set('api_key', ORS_API_KEY);
  url.searchParams.set('text', adres);
  url.searchParams.set('size', '1');
  const resp = await fetchMetTimeout(url);
  if (!resp.ok) {
    throw new Error(`Adres opzoeken mislukt (foutcode ${resp.status}).`);
  }
  const data = await resp.json();
  const feature = data.features?.[0];
  if (!feature) {
    throw new Error(`Adres niet gevonden: "${adres}". Controleer de schrijfwijze.`);
  }
  return feature.geometry.coordinates; // [lengtegraad, breedtegraad]
}

/**
 * Berekent de rijafstand in kilometers tussen twee adressen, met een
 * vrachtwagenprofiel (driving-hgv). Gooit een Error met een begrijpelijke
 * Nederlandse melding als het niet lukt.
 */
export async function berekenAfstandKm(ophaalAdres, aflevAdres) {
  if (!routeBerekeningActief()) {
    const fout = new Error('Automatische routeberekening is nog niet ingesteld voor deze app.');
    fout.code = 'GEEN_API_KEY';
    throw fout;
  }
  if (!ophaalAdres || !aflevAdres) {
    throw new Error('Vul eerst een ophaal- en afleveradres in.');
  }

  const [ophaalCoord, aflevCoord] = await Promise.all([
    geocodeAdres(ophaalAdres),
    geocodeAdres(aflevAdres),
  ]);

  const resp = await fetchMetTimeout(`${ORS_BASIS}/v2/directions/driving-hgv`, {
    method: 'POST',
    headers: {
      Authorization: ORS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ coordinates: [ophaalCoord, aflevCoord] }),
  });

  if (!resp.ok) {
    if (resp.status === 429) {
      throw new Error('Dagelijkse limiet van de routedienst is bereikt. Vul de kilometers voor nu handmatig in.');
    }
    throw new Error(`Route berekenen mislukt (foutcode ${resp.status}).`);
  }

  const data = await resp.json();
  const afstandMeter = data.routes?.[0]?.summary?.distance;
  if (typeof afstandMeter !== 'number') {
    throw new Error('Geen route gevonden tussen deze adressen.');
  }

  return Math.round((afstandMeter / 1000) * 10) / 10;
}

/**
 * Zoekt de coördinaten van een adres op, voor weergave op de kaart. Gooit een
 * Error met code GEEN_API_KEY als automatische routeberekening niet is
 * ingesteld — de aanroeper vangt dit stil af (de kaart toont dan gewoon geen
 * marker voor dat adres).
 */
export async function geocodeerCoordinaten(adres) {
  if (!routeBerekeningActief()) {
    const fout = new Error('Automatische adresherkenning is nog niet ingesteld voor deze app.');
    fout.code = 'GEEN_API_KEY';
    throw fout;
  }
  if (!adres) {
    throw new Error('Geen adres opgegeven.');
  }
  const [lon, lat] = await geocodeAdres(adres);
  return { lat, lon };
}

/**
 * Zet GPS-coördinaten om naar een plaats/adres (voor de pin-knop "huidige
 * locatie"). Eerst via OpenRouteService (als ORS_API_KEY is ingesteld),
 * anders via OpenStreetMap Nominatim. Geeft { plaats, adres } terug.
 */
export async function plaatsBijCoordinaten(lat, lon) {
  if (routeBerekeningActief()) {
    try {
      const url = new URL(`${ORS_BASIS}/geocode/reverse`);
      url.searchParams.set('api_key', ORS_API_KEY);
      url.searchParams.set('point.lat', String(lat));
      url.searchParams.set('point.lon', String(lon));
      url.searchParams.set('size', '1');
      const resp = await fetchMetTimeout(url, {}, 7000);
      if (resp.ok) {
        const p = (await resp.json()).features?.[0]?.properties;
        if (p) {
          const plaats = p.locality || p.localadmin || p.county || p.region || '';
          const straat = p.street ? `${p.street}${p.housenumber ? ' ' + p.housenumber : ''}` : p.name || '';
          if (plaats || straat) return { plaats: plaats || straat, adres: [straat, [p.postalcode, plaats].filter(Boolean).join(' ')].filter(Boolean).join(', ') };
        }
      }
    } catch {
      /* val terug op Nominatim */
    }
  }
  const url = new URL('https://nominatim.openstreetmap.org/reverse');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  url.searchParams.set('zoom', '18');
  url.searchParams.set('accept-language', 'nl');
  const resp = await fetchMetTimeout(url, { headers: { 'User-Agent': 'TransportManager-DVT/1.0 (devreugd-pt.nl)' } }, 7000);
  if (!resp.ok) throw new Error('Locatie opzoeken mislukt.');
  const a = (await resp.json()).address || {};
  const plaats = a.city || a.town || a.village || a.hamlet || a.municipality || '';
  const straat = a.road ? `${a.road}${a.house_number ? ' ' + a.house_number : ''}` : a.industrial || '';
  if (!plaats && !straat) throw new Error('Geen plaats gevonden op deze locatie.');
  return { plaats: plaats || straat, adres: [straat, [a.postcode, plaats].filter(Boolean).join(' ')].filter(Boolean).join(', ') };
}

/**
 * Stelt een geoptimaliseerde volgorde voor om een lijst taken (met bekende
 * coördinaten) af te werken, via de OpenRouteService Optimization-API
 * (VROOM). Geeft de taak-id's terug in de voorgestelde volgorde. Vertrekpunt
 * is het eerste punt in de lijst (geen apart magazijnadres nodig).
 */
export async function optimaliseerTaakVolgorde(taken) {
  if (!routeBerekeningActief()) {
    const fout = new Error('Automatische routeoptimalisatie is nog niet ingesteld voor deze app.');
    fout.code = 'GEEN_API_KEY';
    throw fout;
  }
  if (!Array.isArray(taken) || taken.length < 2) {
    throw new Error('Minimaal twee taken met een herkend adres nodig om te optimaliseren.');
  }

  const jobs = taken.map((t, i) => ({ id: i + 1, location: [t.lon, t.lat] }));
  const vertrek = [taken[0].lon, taken[0].lat];
  const vehicle = { id: 1, profile: 'driving-hgv', start: vertrek };

  const resp = await fetchMetTimeout(
    `${ORS_BASIS}/optimization`,
    {
      method: 'POST',
      headers: {
        Authorization: ORS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jobs, vehicles: [vehicle] }),
    },
    15000
  );

  if (!resp.ok) {
    if (resp.status === 429) {
      throw new Error('Dagelijkse limiet van de routedienst is bereikt. Probeer het later opnieuw.');
    }
    throw new Error(`Route optimaliseren mislukt (foutcode ${resp.status}).`);
  }

  const data = await resp.json();
  const stappen = (data.routes?.[0]?.steps || []).filter((s) => s.type === 'job');
  if (!stappen.length) {
    throw new Error('Geen geoptimaliseerde volgorde gevonden.');
  }
  return stappen.map((s) => taken[s.job - 1].id);
}
