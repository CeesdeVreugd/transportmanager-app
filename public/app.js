// Zoals WorkPortal: klikbare tabelregels (tr[data-href]) en bevestigen via
// data-confirm op een formulier.
document.addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-href]');
  if (tr && !e.target.closest('a,button,input,select,label,td.chk')) window.location = tr.getAttribute('data-href');
});
document.addEventListener('submit', (e) => {
  const msg = e.target.getAttribute('data-confirm');
  if (msg && !window.confirm(msg)) e.preventDefault();
});

// Menu-dropdowns (details/summary in de topbalk) altijd sluiten zodra je
// ergens op klikt binnen het menu (een link naar een pagina) of daarbuiten -
// zonder dit bleven ze op sommige pagina's/apparaten openstaan.
document.querySelectorAll('.navgroup').forEach((details) => {
  details.querySelectorAll('a.navlink').forEach((link) => {
    link.addEventListener('click', () => details.removeAttribute('open'));
  });
});
document.addEventListener('click', (event) => {
  document.querySelectorAll('.navgroup[open]').forEach((details) => {
    if (!details.contains(event.target)) details.removeAttribute('open');
  });
});

// Kleine progressive-enhancement helper: rit-status direct bijwerken zonder
// volledige paginaherlading, met een gewone formulier-fallback als fetch faalt.
document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!form.matches('form[data-status-form]')) return;
  event.preventDefault();
  const knop = form.querySelector('button[type="submit"]');
  const oorspronkelijkeTekst = knop ? knop.textContent : null;
  if (knop) { knop.disabled = true; knop.textContent = 'Bezig...'; }
  try {
    const data = new URLSearchParams(new FormData(form));
    const resp = await fetch(form.action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: data,
    });
    if (resp.redirected) {
      window.location.href = resp.url;
    } else {
      window.location.reload();
    }
  } catch (err) {
    if (knop) { knop.disabled = false; knop.textContent = oorspronkelijkeTekst; }
    alert('Bijwerken is niet gelukt. Controleer je verbinding en probeer opnieuw.');
  }
});

// Live kostprijs/klantprijs-indicatie en automatische routeberekening op het
// ritformulier. Alles blijft ook zonder JavaScript werken (gewone invulvelden).
function formatteerEuro(bedrag) {
  const n = Number(bedrag) || 0;
  return '€ ' + n.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function initRitPrijsCalculator() {
  const form = document.querySelector('[data-rit-formulier]');
  if (!form) return;

  const afstandInput = form.querySelector('[name="afstand_km"]');
  const voertuigSelect = form.querySelector('[name="voertuig_id"]');
  const klantprijsInput = form.querySelector('[name="klantprijs"]');
  const kostprijsUitkomst = form.querySelector('[data-kostprijs-uitkomst]');
  const suggestieUitkomst = form.querySelector('[data-suggestie-uitkomst]');
  const suggestieKnop = form.querySelector('[data-gebruik-suggestie]');
  const margePercentage = parseFloat(form.dataset.margePercentage || '0') || 0;

  const tolCheckboxes = () => Array.from(form.querySelectorAll('input[name="tol_ids"]'));

  function huidigeKostprijsPerKm() {
    const optie = voertuigSelect && voertuigSelect.selectedOptions ? voertuigSelect.selectedOptions[0] : null;
    return optie ? parseFloat(optie.dataset.kostprijsPerKm || '0') || 0 : 0;
  }

  function huidigeTolSom() {
    return tolCheckboxes()
      .filter((c) => c.checked)
      .reduce((som, c) => som + (parseFloat(c.dataset.bedrag || '0') || 0), 0);
  }

  function berekenEnToon() {
    const afstand = parseFloat(afstandInput ? afstandInput.value : '0') || 0;
    const kostprijs = afstand * huidigeKostprijsPerKm() + huidigeTolSom();
    const suggestie = kostprijs * (1 + margePercentage / 100);
    if (kostprijsUitkomst) kostprijsUitkomst.textContent = formatteerEuro(kostprijs);
    if (suggestieUitkomst) suggestieUitkomst.textContent = formatteerEuro(suggestie);
    if (suggestieKnop) suggestieKnop.dataset.suggestieWaarde = suggestie.toFixed(2);
  }

  if (afstandInput) afstandInput.addEventListener('input', berekenEnToon);
  if (voertuigSelect) voertuigSelect.addEventListener('change', berekenEnToon);
  tolCheckboxes().forEach((c) => c.addEventListener('change', berekenEnToon));

  if (suggestieKnop) {
    suggestieKnop.addEventListener('click', () => {
      if (klantprijsInput && suggestieKnop.dataset.suggestieWaarde) {
        klantprijsInput.value = suggestieKnop.dataset.suggestieWaarde;
      }
    });
  }

  const berekenRouteKnop = form.querySelector('[data-bereken-route]');
  const routeStatus = form.querySelector('[data-route-status]');
  if (berekenRouteKnop) {
    berekenRouteKnop.addEventListener('click', async () => {
      const stopAdressen = Array.from(form.querySelectorAll('[name="stop_adres"]')).map((el) => el.value.trim()).filter(Boolean);
      const ophaal = stopAdressen.length ? stopAdressen[0] : (form.querySelector('[name="ophaal_adres"]') || {}).value?.trim();
      const aflever = stopAdressen.length ? stopAdressen[stopAdressen.length - 1] : (form.querySelector('[name="aflever_adres"]') || {}).value?.trim();
      if (!ophaal || !aflever) {
        if (routeStatus) routeStatus.textContent = 'Vul eerst beide adressen in.';
        return;
      }
      const oorspronkelijkeTekst = berekenRouteKnop.textContent;
      berekenRouteKnop.disabled = true;
      berekenRouteKnop.textContent = 'Bezig...';
      if (routeStatus) routeStatus.textContent = '';
      try {
        const resp = await fetch('/planner/route-berekenen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ophaal_adres: ophaal, aflever_adres: aflever }),
        });
        const data = await resp.json();
        if (!resp.ok || typeof data.afstand_km !== 'number') {
          if (routeStatus) routeStatus.textContent = data.fout || 'Route berekenen is niet gelukt. Vul de kilometers handmatig in.';
        } else {
          if (afstandInput) afstandInput.value = data.afstand_km;
          if (routeStatus) routeStatus.textContent = `Automatisch berekend: ${data.afstand_km} km.`;
          berekenEnToon();
        }
      } catch {
        if (routeStatus) routeStatus.textContent = 'Route berekenen is niet gelukt. Controleer je verbinding.';
      } finally {
        berekenRouteKnop.disabled = false;
        berekenRouteKnop.textContent = oorspronkelijkeTekst;
      }
    });
  }

  berekenEnToon();
}

document.addEventListener('DOMContentLoaded', initRitPrijsCalculator);

// Tariefafspraak-formulier: toon alleen de tariefvelden die bij het gekozen
// type horen (bijv. alleen 'per uur' bij type "per_uur").
function initTariefFormulier() {
  const form = document.querySelector('[data-tarief-formulier]');
  if (!form) return;
  const typeSelect = form.querySelector('[data-tarief-type]');
  const velden = Array.from(form.querySelectorAll('[data-tarief-veld]'));

  function bijwerken() {
    const gekozen = typeSelect.value;
    velden.forEach((label) => {
      const types = label.dataset.tariefVeld.split(',');
      const zichtbaar = types.includes(gekozen);
      label.hidden = !zichtbaar;
      if (!zichtbaar) {
        const input = label.querySelector('input');
        if (input) input.value = '';
      }
    });
  }

  typeSelect.addEventListener('change', bijwerken);
  bijwerken();
}

document.addEventListener('DOMContentLoaded', initTariefFormulier);

// Prijscalculator: automatische afstandsberekening (zelfde endpoint als het
// ritformulier) en het overnemen van de kostprijs/km van een gekozen voertuig.
function initPrijscalculatorFormulier() {
  const form = document.querySelector('[data-prijscalculator-formulier]');
  if (!form) return;

  const voertuigSelect = form.querySelector('[data-prijscalc-voertuig]');
  const kostprijsInput = form.querySelector('[data-prijscalc-kostprijs]');
  if (voertuigSelect && kostprijsInput) {
    voertuigSelect.addEventListener('change', () => {
      const optie = voertuigSelect.selectedOptions[0];
      if (optie && optie.dataset.kostprijsPerKm) {
        kostprijsInput.value = optie.dataset.kostprijsPerKm;
      }
    });
  }

  const berekenRouteKnop = form.querySelector('[data-bereken-route]');
  const routeStatus = form.querySelector('[data-route-status]');
  const afstandInput = form.querySelector('[name="afstand_km"]');
  if (berekenRouteKnop) {
    berekenRouteKnop.addEventListener('click', async () => {
      const ophaal = (form.querySelector('[name="ophaal_adres"]') || {}).value?.trim();
      const aflever = (form.querySelector('[name="aflever_adres"]') || {}).value?.trim();
      if (!ophaal || !aflever) {
        if (routeStatus) routeStatus.textContent = 'Vul eerst beide adressen in.';
        return;
      }
      const oorspronkelijkeTekst = berekenRouteKnop.textContent;
      berekenRouteKnop.disabled = true;
      berekenRouteKnop.textContent = 'Bezig...';
      if (routeStatus) routeStatus.textContent = '';
      try {
        const resp = await fetch('/planner/route-berekenen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ophaal_adres: ophaal, aflever_adres: aflever }),
        });
        const data = await resp.json();
        if (!resp.ok || typeof data.afstand_km !== 'number') {
          if (routeStatus) routeStatus.textContent = data.fout || 'Route berekenen is niet gelukt. Vul de kilometers handmatig in.';
        } else {
          if (afstandInput) afstandInput.value = data.afstand_km;
          if (routeStatus) routeStatus.textContent = `Automatisch berekend: ${data.afstand_km} km (enkele reis).`;
        }
      } catch {
        if (routeStatus) routeStatus.textContent = 'Route berekenen is niet gelukt. Controleer je verbinding.';
      } finally {
        berekenRouteKnop.disabled = false;
        berekenRouteKnop.textContent = oorspronkelijkeTekst;
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', initPrijscalculatorFormulier);

// Handtekening-canvas (chauffeur: taak afronden). Werkt met muis en touch;
// bij het versturen van het formulier wordt de tekening als PNG (data-URL)
// in een verborgen veld gezet, zodat het gewoon meegaat met de normale
// multipart-formulierverzending (geen fetch/blob nodig).
function initHandtekeningCanvas() {
  const canvas = document.querySelector('[data-handtekening-canvas]');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.strokeStyle = '#0A0A96';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  let tekenen = false;
  let leeg = true;

  function positie(evt) {
    const rect = canvas.getBoundingClientRect();
    const punt = evt.touches && evt.touches.length ? evt.touches[0] : evt;
    return {
      x: ((punt.clientX - rect.left) / rect.width) * canvas.width,
      y: ((punt.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function start(evt) {
    tekenen = true;
    leeg = false;
    const { x, y } = positie(evt);
    ctx.beginPath();
    ctx.moveTo(x, y);
    evt.preventDefault();
  }

  function teken(evt) {
    if (!tekenen) return;
    const { x, y } = positie(evt);
    ctx.lineTo(x, y);
    ctx.stroke();
    evt.preventDefault();
  }

  function stop() {
    tekenen = false;
  }

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', teken);
  window.addEventListener('mouseup', stop);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', teken, { passive: false });
  canvas.addEventListener('touchend', stop);

  const wisKnop = document.querySelector('[data-handtekening-wissen]');
  if (wisKnop) {
    wisKnop.addEventListener('click', () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      leeg = true;
    });
  }

  const form = canvas.closest('form');
  if (form) {
    form.addEventListener('submit', () => {
      const hiddenInput = form.querySelector('[name="handtekening_data"]');
      if (hiddenInput && !leeg) {
        hiddenInput.value = canvas.toDataURL('image/png');
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', initHandtekeningCanvas);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/service-worker.js')
      .then(() => initPushAbonnement())
      .catch(() => {
        // Stil falen: de app werkt ook prima zonder offline-ondersteuning/push.
      });
  });
}

// Pushmeldingen (chauffeur): abonneert dit toestel op pushmeldingen zodra er
// een VAPID-sleutel beschikbaar is (server heeft push ingesteld) en de
// gebruiker toestemming geeft. Faalt overal stil - de rest van de app werkt
// dan gewoon door zonder pushmeldingen (dezelfde aanpak als de routedienst).
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const ruw = window.atob(base64);
  return Uint8Array.from([...ruw].map((c) => c.charCodeAt(0)));
}

// iPhones/iPads laten pushmeldingen alleen toe als de app eerst is
// "toegevoegd aan het beginscherm" en van daaruit wordt geopend (Apple staat
// de Push API niet toe in een gewone Safari-tab). Zonder deze melding lijkt
// het dan of er niets gebeurt: er komt geen toestemmingsvraag en ook geen
// foutmelding. Deze functie toont daarom een duidelijke uitleg zolang dat
// nog niet is gebeurd.
function toonIosInstallatieHint() {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
  if (!isIos || isStandalone) return;
  if (localStorage.getItem('iosInstallatieHintVerborgen') === '1') return;

  const balk = document.createElement('div');
  balk.className = 'melding melding-info';
  balk.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:0.75rem;';
  balk.innerHTML =
    '<span>Wil je pushmeldingen op je iPhone? Tik onderin Safari op het deel-icoon (vierkantje met pijl omhoog) en kies <strong>"Zet op beginscherm"</strong>. Open de app daarna vanaf dat icoon.</span>' +
    '<button type="button" class="link-knop" aria-label="Melding sluiten" style="font-size:1.1rem; line-height:1;">&times;</button>';
  balk.querySelector('button').addEventListener('click', () => {
    balk.remove();
    try {
      localStorage.setItem('iosInstallatieHintVerborgen', '1');
    } catch {
      // Geen localStorage beschikbaar: de melding komt dan bij een volgend bezoek terug, geen probleem.
    }
  });
  const inhoud = document.querySelector('main.inhoud');
  if (inhoud) inhoud.prepend(balk);
}

// Pushmeldingen (zoals WorkPortal): toestemming vragen mag een browser alleen
// na een klik van de gebruiker. Daarom: knop "Meldingen aanzetten" onder Mijn
// account (en een balk zolang ze nog uit staan). Bij het openen van de app
// wordt een bestaand abonnement alleen stil ververst.
window.TM = window.TM || {};
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isStandalone = () => window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
function vapidSleutel() {
  const meta = document.querySelector('meta[name="vapid-public-key"]');
  return meta && meta.content ? meta.content : '';
}
function pushOndersteund() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
async function stuurAbonnement(abonnement) {
  const resp = await fetch('/account/push/abonneren', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(abonnement.toJSON()),
  });
  if (!resp.ok) throw new Error('Opslaan van het abonnement mislukt.');
}
TM.pushStatus = async function () {
  if (!vapidSleutel()) return { tekst: 'Pushmeldingen zijn op de server nog niet ingesteld (VAPID-sleutels).', aan: false };
  if (isIos && !isStandalone()) return { tekst: 'Op iPhone/iPad werken meldingen alleen vanaf het beginscherm: tik in Safari op Deel → "Zet op beginscherm" en open de app vanaf dat icoon.', aan: false };
  if (!pushOndersteund()) return { tekst: 'Deze browser ondersteunt geen pushmeldingen.', aan: false };
  if (Notification.permission === 'denied') return { tekst: 'Meldingen zijn geblokkeerd voor deze site. Zet ze aan in de instellingen van de browser of telefoon en probeer opnieuw.', aan: false };
  const reg = await navigator.serviceWorker.ready;
  const abo = await reg.pushManager.getSubscription();
  return abo && Notification.permission === 'granted'
    ? { tekst: 'Meldingen staan aan op dit apparaat.', aan: true }
    : { tekst: 'Meldingen staan nog uit op dit apparaat.', aan: false };
};
TM.pushAan = async function (statusEl) {
  const zet = (t) => statusEl && (statusEl.textContent = t);
  try {
    const st = await TM.pushStatus();
    if (!vapidSleutel() || (isIos && !isStandalone()) || !pushOndersteund() || Notification.permission === 'denied') return zet(st.tekst);
    zet('Toestemming vragen…');
    const permissie = await Notification.requestPermission();
    if (permissie !== 'granted') return zet('Geen toestemming gegeven. Probeer het opnieuw en kies "Toestaan".');
    const reg = await navigator.serviceWorker.ready;
    let abo = await reg.pushManager.getSubscription();
    if (!abo) abo = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidSleutel()) });
    await stuurAbonnement(abo);
    zet('Meldingen staan aan op dit apparaat. Stuur gerust een testmelding.');
    document.querySelectorAll('.pushbalk').forEach((b) => b.remove());
  } catch (fout) {
    zet('Aanzetten mislukt: ' + (fout && fout.message ? fout.message : fout));
  }
};
TM.testPush = async function (statusEl) {
  const zet = (t) => statusEl && (statusEl.textContent = t);
  try {
    const resp = await fetch('/account/push/test', { method: 'POST', credentials: 'same-origin' });
    const data = await resp.json().catch(() => ({}));
    zet(data.bericht || (resp.ok ? 'Testmelding verstuurd.' : 'Testmelding mislukt.'));
  } catch {
    zet('Testmelding mislukt.');
  }
};
async function initPushAbonnement() {
  try {
    if (!vapidSleutel() || !pushOndersteund()) return;
    const reg = await navigator.serviceWorker.ready;
    const abo = await reg.pushManager.getSubscription();
    if (abo && Notification.permission === 'granted') {
      await stuurAbonnement(abo); // stil verversen
      return;
    }
    // Nog niet aan: een balk met een knop (een klik is nodig voor de toestemming).
    if (Notification.permission === 'denied' || location.pathname.startsWith('/account')) return;
    try {
      if (localStorage.getItem('pushbalkVerborgen') === '1') return;
    } catch {}
    const inhoud = document.querySelector('main.inhoud');
    if (!inhoud) return;
    const balk = document.createElement('div');
    balk.className = 'flash info pushbalk';
    const iosTekst = isIos && !isStandalone();
    balk.innerHTML = iosTekst
      ? '<span><b>Meldingen op je iPhone?</b> Tik in Safari op Deel → <b>Zet op beginscherm</b> en open de app vanaf dat icoon. Zet ze daarna aan via Mijn account.</span><button type="button" class="pushbalk-sluit" aria-label="Sluiten">×</button>'
      : '<span><b>Meldingen staan uit.</b> Zet ze aan om direct bericht te krijgen bij nieuwe of gewijzigde ritten.</span><button type="button" class="btn primary sm pushbalk-aan">Meldingen aanzetten</button><button type="button" class="pushbalk-sluit" aria-label="Sluiten">×</button>';
    const tekst = balk.querySelector('span');
    const aan = balk.querySelector('.pushbalk-aan');
    if (aan) aan.addEventListener('click', () => TM.pushAan(tekst));
    balk.querySelector('.pushbalk-sluit').addEventListener('click', () => {
      balk.remove();
      try { localStorage.setItem('pushbalkVerborgen', '1'); } catch {}
    });
    inhoud.prepend(balk);
  } catch {
    // Stil falen: de rest van de app werkt gewoon door.
  }
}

// Knoppen op Mijn account
document.addEventListener('DOMContentLoaded', async () => {
  const stat = document.getElementById('pushstat');
  if (!stat) return;
  try {
    const st = await TM.pushStatus();
    stat.textContent = st.tekst;
  } catch {}
  const aan = document.getElementById('push-aan');
  const test = document.getElementById('push-test');
  if (aan) aan.addEventListener('click', () => TM.pushAan(stat));
  if (test) test.addEventListener('click', () => TM.testPush(stat));
});

// ---- Urenregistratie: opdrachten (opdrachtgever-segmenten) en hun stops
// toevoegen/verwijderen in het ene grote dagformulier ("Dag toevoegen" / dag
// corrigeren). Alles gebeurt client-side in de DOM; pas het opslaan van het
// hele formulier maakt het definitief - er gaat dus geen apart verzoek per
// stop of opdracht meer naar de server. Elke opdracht-blok heeft zijn eigen
// stops-lijst (via klassen, want er kunnen meerdere blokken op de pagina
// staan); elke stop draagt een verborgen "stop_opdracht_index"-veld dat
// bijhoudt bij welk opdracht-blok (0-gebaseerd, in volgorde) hij hoort - dat
// wordt hier bijgewerkt zodra opdrachten worden toegevoegd/verwijderd.
function herNummerStopsInBlok(blok, opdrachtIndex) {
  const lijst = blok.querySelector('.stops-lijst');
  if (!lijst) return;
  lijst.querySelectorAll('.stop-rij').forEach((rij, i) => {
    const label = rij.querySelector('.stop-volgnummer');
    if (label) label.textContent = String(i + 1);
    const indexVeld = rij.querySelector('.stop-opdracht-index');
    if (indexVeld) indexVeld.value = String(opdrachtIndex);
  });
}

function herNummerOpdrachten() {
  document.querySelectorAll('.opdrachten-lijst .opdracht-blok').forEach((blok, i) => {
    const label = blok.querySelector('.opdracht-volgnummer');
    if (label) label.textContent = String(i + 1);
    herNummerStopsInBlok(blok, i);
  });
}

document.addEventListener('click', (event) => {
  const opdrachtToevoegKnop = event.target.closest('.opdracht-toevoegen-knop');
  if (opdrachtToevoegKnop) {
    const sjabloon = document.querySelector('.opdracht-blok-sjabloon');
    const lijst = document.querySelector('.opdrachten-lijst');
    if (sjabloon && lijst) {
      lijst.appendChild(sjabloon.content.cloneNode(true));
      herNummerOpdrachten();
    }
    return;
  }
  const opdrachtVerwijderKnop = event.target.closest('.opdracht-verwijderen-knop');
  if (opdrachtVerwijderKnop) {
    const blok = opdrachtVerwijderKnop.closest('.opdracht-blok');
    if (blok) {
      blok.remove();
      herNummerOpdrachten();
    }
    return;
  }
  const toevoegKnop = event.target.closest('.stop-toevoegen-knop');
  if (toevoegKnop) {
    const blok = toevoegKnop.closest('.opdracht-blok');
    if (!blok) return;
    const sjabloon = blok.querySelector('.stop-rij-sjabloon');
    const lijst = blok.querySelector('.stops-lijst');
    if (sjabloon && lijst) {
      lijst.appendChild(sjabloon.content.cloneNode(true));
      const opdrachtIndex = Array.from(document.querySelectorAll('.opdrachten-lijst .opdracht-blok')).indexOf(blok);
      herNummerStopsInBlok(blok, opdrachtIndex);
    }
    return;
  }
  const verwijderKnop = event.target.closest('.stop-verwijderen-knop');
  if (verwijderKnop) {
    const rij = verwijderKnop.closest('.stop-rij');
    const blok = verwijderKnop.closest('.opdracht-blok');
    if (rij) {
      rij.remove();
      if (blok) {
        const opdrachtIndex = Array.from(document.querySelectorAll('.opdrachten-lijst .opdracht-blok')).indexOf(blok);
        herNummerStopsInBlok(blok, opdrachtIndex);
      }
    }
  }
});

document.addEventListener('DOMContentLoaded', herNummerOpdrachten);

// ---------------------------------------------------------------------------
// Zoekveld bij het kiezen van een klant / opdrachtgever. Het gewone
// keuzemenu blijft (verborgen) bestaan voor het formulier; daaroverheen komt
// een zoekveld met een lijst. Wie klanten mag bewerken (meta
// tm-klant-aanmaken), kan vanuit dezelfde lijst direct een nieuwe klant
// aanmaken. Werkt ook voor opdrachtblokken die later worden toegevoegd.
// ---------------------------------------------------------------------------
(function () {
  const SELECTOR = 'select[name="klant_id"], select[name="opdracht_klant_id"]';
  const magAanmaken = !!document.querySelector('meta[name="tm-klant-aanmaken"]');
  const verwerkt = new WeakSet();

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function normaal(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  // Een nieuwe klant ook in alle andere klantkeuzes op de pagina zetten.
  function voegOveralToe(id, naam) {
    const lijsten = [...document.querySelectorAll(SELECTOR)];
    document.querySelectorAll('template').forEach((t) => lijsten.push(...t.content.querySelectorAll(SELECTOR)));
    lijsten.forEach((sel) => {
      if (![...sel.options].some((o) => o.value === id)) {
        const opt = new Option(naam, id);
        const na = [...sel.options].find((o) => o.value && o.text.localeCompare(naam, 'nl') > 0);
        sel.insertBefore(opt, na || null);
      }
    });
  }

  const ICOON = {
    zoek: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
    pijl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    wis: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    vink: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  };
  function initialen(naam) {
    const d = String(naam).trim().split(/\s+/);
    return ((d[0] || '')[0] || '').toUpperCase() + (d.length > 1 ? (d[d.length - 1][0] || '').toUpperCase() : '');
  }
  function markeerTekst(tekst, q) {
    if (!q) return esc(tekst);
    const i = normaal(tekst).indexOf(q);
    if (i < 0) return esc(tekst);
    return esc(tekst.slice(0, i)) + '<b>' + esc(tekst.slice(i, i + q.length)) + '</b>' + esc(tekst.slice(i + q.length));
  }

  function verbeter(select) {
    if (verwerkt.has(select) || select.closest('template')) return;
    verwerkt.add(select);
    select.style.display = 'none';

    const wrap = document.createElement('div');
    wrap.className = 'klantzoek';
    wrap.innerHTML =
      `<div class="klantzoek-veld"><span class="kz-ico">${ICOON.zoek}</span>` +
      '<input type="text" autocomplete="off" role="combobox" aria-expanded="false" spellcheck="false">' +
      `<button type="button" class="kz-wis" aria-label="Keuze wissen" hidden>${ICOON.wis}</button>` +
      `<span class="kz-pijl">${ICOON.pijl}</span></div>` +
      '<div class="klantzoek-lijst" role="listbox" hidden></div>';
    select.insertAdjacentElement('afterend', wrap);
    const invoer = wrap.querySelector('input');
    const lijst = wrap.querySelector('.klantzoek-lijst');
    const wis = wrap.querySelector('.kz-wis');
    const leegOptie = [...select.options].find((o) => !o.value);
    invoer.placeholder = leegOptie ? leegOptie.text.replace(/^—\s*|\s*—$/g, '') : 'Kies een klant';
    let actiefIndex = -1;
    let items = [];

    function toonGekozen() {
      const o = select.options[select.selectedIndex];
      const gekozen = !!(o && o.value);
      invoer.value = gekozen ? o.text : '';
      wrap.classList.toggle('heeft-waarde', gekozen);
      wis.hidden = !(gekozen && leegOptie);
    }
    function sluit() {
      lijst.hidden = true;
      wrap.classList.remove('open');
      invoer.setAttribute('aria-expanded', 'false');
      toonGekozen();
    }
    function kies(waarde) {
      select.value = waarde;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      sluit();
    }
    function bouw(zoekterm) {
      const ruw = (zoekterm === undefined ? invoer.value : zoekterm).trim();
      const q = normaal(ruw);
      const opties = [...select.options].filter((o) => o.value);
      const gevonden = q ? opties.filter((o) => normaal(o.text).includes(q)) : opties;
      items = [];
      let html = `<div class="kz-kop">${q ? `${gevonden.length} gevonden` : 'Klanten'}</div><div class="kz-items">`;
      if (leegOptie && !q) {
        items.push({ type: 'kies', waarde: '' });
        html += `<div class="klantzoek-item geen" data-i="0"><span class="kz-av kz-av-leeg">–</span><span class="kz-naam">${esc(leegOptie.text.replace(/^—\s*|\s*—$/g, ''))}</span></div>`;
      }
      gevonden.slice(0, 60).forEach((o) => {
        items.push({ type: 'kies', waarde: o.value });
        const gekozen = o.value === select.value;
        html += `<div class="klantzoek-item${gekozen ? ' gekozen' : ''}" data-i="${items.length - 1}" role="option" aria-selected="${gekozen}">` +
          `<span class="kz-av">${esc(initialen(o.text))}</span><span class="kz-naam">${markeerTekst(o.text, q)}</span>${gekozen ? `<span class="kz-vink">${ICOON.vink}</span>` : ''}</div>`;
      });
      if (!gevonden.length && q) html += `<div class="klantzoek-niets">Geen klant gevonden voor “${esc(ruw)}”.</div>`;
      html += '</div>';
      const exact = opties.some((o) => normaal(o.text) === q);
      if (magAanmaken && q && !exact) {
        items.push({ type: 'nieuw', naam: ruw });
        html += `<div class="klantzoek-item nieuw" data-i="${items.length - 1}"><span class="kz-plus">${ICOON.plus}</span>` +
          `<span class="kz-naam"><b>Nieuwe klant aanmaken</b><small>“${esc(ruw)}”</small></span></div>`;
      }
      lijst.innerHTML = html;
      actiefIndex = -1;
      lijst.hidden = false;
      wrap.classList.add('open');
      invoer.setAttribute('aria-expanded', 'true');
    }
    function markeer() {
      lijst.querySelectorAll('.klantzoek-item').forEach((el) => el.classList.toggle('actief', Number(el.dataset.i) === actiefIndex));
      const el = lijst.querySelector(`.klantzoek-item[data-i="${actiefIndex}"]`);
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
    async function maakAan(naam) {
      const knop = lijst.querySelector('.klantzoek-item.nieuw .kz-naam');
      if (knop) knop.innerHTML = '<b>Bezig met aanmaken…</b>';
      try {
        const resp = await fetch('/planner/klanten/snel', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ naam }),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || !data.id) throw new Error(data.fout || 'Aanmaken mislukt.');
        voegOveralToe(data.id, data.naam);
        kies(data.id);
      } catch (fout) {
        if (knop) knop.innerHTML = `<b>${esc(fout.message || 'Aanmaken mislukt.')}</b>`;
      }
    }
    function voerUit(item) {
      if (!item) return;
      if (item.type === 'nieuw') maakAan(item.naam);
      else kies(item.waarde);
    }

    invoer.addEventListener('focus', () => {
      invoer.select();
      bouw(''); // bij openen de hele lijst tonen; typen filtert
    });
    invoer.addEventListener('input', () => bouw());
    invoer.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (lijst.hidden) bouw(''); actiefIndex = Math.min(items.length - 1, actiefIndex + 1); markeer(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); actiefIndex = Math.max(0, actiefIndex - 1); markeer(); }
      else if (e.key === 'Enter') {
        if (!lijst.hidden) {
          e.preventDefault();
          const eerste = items.findIndex((i) => i.type === 'kies' && i.waarde);
          voerUit(items[actiefIndex >= 0 ? actiefIndex : eerste >= 0 ? eerste : 0]);
        }
      } else if (e.key === 'Escape') { sluit(); invoer.blur(); }
    });
    lijst.addEventListener('mousedown', (e) => {
      const el = e.target.closest('.klantzoek-item');
      e.preventDefault(); // focus in het zoekveld houden
      if (el) voerUit(items[Number(el.dataset.i)]);
    });
    wrap.querySelector('.kz-pijl').addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (lijst.hidden) invoer.focus(); else { sluit(); invoer.blur(); }
    });
    wis.addEventListener('mousedown', (e) => { e.preventDefault(); kies(''); });
    invoer.addEventListener('blur', () => setTimeout(() => { if (!wrap.contains(document.activeElement)) sluit(); }, 120));
    select.addEventListener('change', toonGekozen);
    toonGekozen();
  }

  function verbeterAlles(root) {
    (root.querySelectorAll ? root : document).querySelectorAll(SELECTOR).forEach(verbeter);
    if (root.matches && root.matches(SELECTOR)) verbeter(root);
  }
  document.addEventListener('DOMContentLoaded', () => {
    verbeterAlles(document);
    new MutationObserver((mut) => mut.forEach((m) => m.addedNodes.forEach((n) => n.nodeType === 1 && verbeterAlles(n)))).observe(document.body, {
      childList: true,
      subtree: true,
    });
  });
})();

// ---------------------------------------------------------------------------
// Tabellen op de telefoon als kaartjes: elke cel krijgt het kopje van zijn
// kolom als label (data-label); de CSS toont op smalle schermen per regel
// "label … waarde". De eerste kolom is de titel van het kaartje.
// ---------------------------------------------------------------------------
function maakTabellenMobiel(root) {
  (root || document).querySelectorAll('main table:not(.calc-table):not([data-mobiel])').forEach((tabel) => {
    const koppen = [...tabel.querySelectorAll('thead th')].map((th) => th.textContent.trim());
    if (koppen.length < 3) return;
    tabel.setAttribute('data-mobiel', '1');
    tabel.classList.add('mobiel-kaarten');
    tabel.querySelectorAll('tbody tr, tfoot tr').forEach((tr) => {
      let kolom = 0;
      [...tr.children].forEach((td) => {
        const span = Number(td.getAttribute('colspan') || 1);
        if (span >= koppen.length - 1) td.classList.add('mk-breed');
        else td.setAttribute('data-label', koppen[kolom] || '');
        if (td.textContent.trim().length <= 10 && !td.querySelector('form,.knop,.btn')) td.classList.add('mk-kort');
        if (/^[—–-]?$/.test(td.textContent.trim()) && !td.querySelector('input,select,button,a,img')) td.classList.add('mk-leeg');
        kolom += span;
      });
    });
  });
}
document.addEventListener('DOMContentLoaded', () => maakTabellenMobiel(document));


// ---------------------------------------------------------------------------
// Ritformulier: stops toevoegen, verwijderen en in volgorde zetten.
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  const lijst = document.querySelector('[data-ritstops]');
  if (!lijst) return;
  const sjabloon = document.querySelector('template[data-ritstop-sjabloon]');
  const nummer = () => lijst.querySelectorAll('[data-ritstop]').forEach((rij, i) => {
    const nr = rij.querySelector('[data-ritstop-nr]');
    if (nr) nr.textContent = String(i + 1);
  });
  nummer();
  const knopToevoegen = document.querySelector('[data-ritstop-toevoegen]');
  if (knopToevoegen && sjabloon) {
    knopToevoegen.addEventListener('click', () => {
      lijst.appendChild(sjabloon.content.cloneNode(true));
      nummer();
      const nieuw = lijst.lastElementChild && lijst.lastElementChild.querySelector('[name="stop_naam"]');
      if (nieuw) nieuw.focus();
    });
  }
  lijst.addEventListener('click', (e) => {
    const rij = e.target.closest('[data-ritstop]');
    if (!rij) return;
    if (e.target.closest('[data-ritstop-weg]')) {
      if (lijst.querySelectorAll('[data-ritstop]').length > 1) rij.remove();
      else rij.querySelectorAll('input:not([type=hidden])').forEach((el) => (el.value = ''));
    } else if (e.target.closest('[data-ritstop-op]') && rij.previousElementSibling) {
      lijst.insertBefore(rij, rij.previousElementSibling);
    } else if (e.target.closest('[data-ritstop-neer]') && rij.nextElementSibling) {
      lijst.insertBefore(rij.nextElementSibling, rij);
    } else return;
    nummer();
  });
});

// Urenregistratie: activiteit kiezen met één tik (vult het veld Activiteit).
document.addEventListener('click', (e) => {
  const knop = e.target.closest('[data-zet-activiteit]');
  if (!knop) return;
  const form = knop.closest('form');
  const veld = form && form.querySelector('input[name="activiteit"]');
  if (!veld) return;
  veld.value = knop.getAttribute('data-zet-activiteit');
  form.querySelectorAll('[data-zet-activiteit]').forEach((b) => b.classList.toggle('active', b === knop));
  const plaats = form.querySelector('input[name="plaats"]');
  if (plaats && !plaats.value) plaats.focus();
});
