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
      .then((registratie) => initPushAbonnement(registratie))
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

async function initPushAbonnement(registratie) {
  try {
    const meta = document.querySelector('meta[name="vapid-public-key"]');
    if (!meta || !meta.content) return;
    toonIosInstallatieHint();
    if (!('PushManager' in window) || !('Notification' in window)) return;
    if (Notification.permission === 'denied') return;

    let permissie = Notification.permission;
    if (permissie === 'default') {
      permissie = await Notification.requestPermission();
    }
    if (permissie !== 'granted') return;

    let abonnement = await registratie.pushManager.getSubscription();
    if (!abonnement) {
      abonnement = await registratie.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(meta.content),
      });
    }
    await fetch('/chauffeur/push/abonneren', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(abonnement.toJSON()),
    });
  } catch {
    // Stil falen (bijv. geen toestemming, of niet-ondersteunde browser).
  }
}

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
