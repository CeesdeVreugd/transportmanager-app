// Tijdzone-hulpfuncties. De server draait (in Docker) mogelijk op UTC, maar alle
// datums/tijden in de app moeten kloppen met de Nederlandse wandklok — dus
// consequent omrekenen naar Europe/Amsterdam, met automatische zomer-/
// wintertijd (nooit een vast urenverschil hardcoden, dat loopt anders elk
// najaar/voorjaar weer een uur fout).

const ZONE = 'Europe/Amsterdam';

// Geeft "HH:MM" in Nederlandse tijd, voor een gegeven moment (standaard nu).
export function huidigeTijd(moment = new Date()) {
  return new Intl.DateTimeFormat('nl-NL', {
    timeZone: ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(moment);
}

// Geeft "YYYY-MM-DD" in Nederlandse tijd, voor een gegeven moment (standaard nu).
export function huidigeDatum(moment = new Date()) {
  // en-CA geeft altijd YYYY-MM-DD formaat.
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(moment);
}

// Dag van de week in Nederlandse tijd: 1 = maandag ... 7 = zondag.
export function huidigeDagVanWeek(moment = new Date()) {
  const label = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, weekday: 'short' }).format(moment);
  const volgorde = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return volgorde[label] || 1;
}

// Rekent "HH:MM" om naar minuten sinds middernacht.
export function tijdNaarMinuten(hhmm) {
  if (!hhmm || typeof hhmm !== 'string' || !hhmm.includes(':')) return null;
  const [u, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(u) || Number.isNaN(m)) return null;
  return u * 60 + m;
}

// Verschil in minuten tussen twee "HH:MM"-tijden op dezelfde (of opeenvolgende) dag.
// Als eind < start wordt aangenomen dat het over middernacht heen gaat.
export function minutenTussen(vanTijd, totTijd) {
  const van = tijdNaarMinuten(vanTijd);
  const tot = tijdNaarMinuten(totTijd);
  if (van === null || tot === null) return 0;
  let verschil = tot - van;
  if (verschil < 0) verschil += 24 * 60;
  return verschil;
}

// Telt `n` dagen op bij een "YYYY-MM-DD"-datum (n mag negatief zijn). Puur
// kalenderrekenwerk op de datumonderdelen zelf (via Date.UTC), dus geen
// tijdzone-onzekerheid — dit is geen wandklok-moment, alleen een kalenderdag.
export function addDagen(datumIso, n) {
  const [j, m, d] = datumIso.split('-').map(Number);
  const basis = new Date(Date.UTC(j, m - 1, d));
  basis.setUTCDate(basis.getUTCDate() + n);
  return basis.toISOString().slice(0, 10);
}

// Dag-van-de-week (1 = maandag ... 7 = zondag) voor een "YYYY-MM-DD"-datum.
export function dagVanWeekVoorDatum(datumIso) {
  const [j, m, d] = datumIso.split('-').map(Number);
  const basis = new Date(Date.UTC(j, m - 1, d));
  const dag = basis.getUTCDay(); // 0 = zondag
  return dag === 0 ? 7 : dag;
}

// Maandag t/m zondag van de week waar `datumIso` in valt.
export function weekBereikVanDatum(datumIso) {
  const dagNummer = dagVanWeekVoorDatum(datumIso);
  const maandag = addDagen(datumIso, -(dagNummer - 1));
  const zondag = addDagen(maandag, 6);
  return { van: maandag, tot: zondag };
}

// Eerste en laatste dag van de maand `offset` maanden t.o.v. de maand van
// `datumIso` (offset 0 = dezelfde maand, -1 = vorige maand, enz.).
export function maandBereikVanDatum(datumIso, offset = 0) {
  const [j, m] = datumIso.split('-').map(Number);
  const eersteDag = new Date(Date.UTC(j, m - 1 + offset, 1));
  const laatsteDag = new Date(Date.UTC(j, m + offset, 0));
  return { van: eersteDag.toISOString().slice(0, 10), tot: laatsteDag.toISOString().slice(0, 10) };
}

export default {
  huidigeTijd,
  huidigeDatum,
  huidigeDagVanWeek,
  tijdNaarMinuten,
  minutenTussen,
  addDagen,
  dagVanWeekVoorDatum,
  weekBereikVanDatum,
  maandBereikVanDatum,
};
