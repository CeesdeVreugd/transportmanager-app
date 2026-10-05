import { escapeHtml, statusLabel } from './render.js';
import { huidigeTijd } from './tijd.js';

function optie(waarde, label, geselecteerd) {
  return `<option value="${escapeHtml(waarde)}"${waarde === geselecteerd ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

function formatDatum(iso) {
  if (!iso) return '';
  const [j, m, d] = iso.split('-');
  return `${d}-${m}-${j}`;
}

export function formatEuro(bedrag) {
  const n = Number(bedrag) || 0;
  return '€ ' + n.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function pagRittenOverzicht({ ritten, datumFilter }) {
  const rijen = ritten.length
    ? ritten
        .map(
          (r) => `<tr>
      <td>${formatDatum(r.datum)}</td>
      <td>${escapeHtml(r.klant_naam || '—')}</td>
      <td>${escapeHtml(r.ophaal_adres)} → ${escapeHtml(r.aflever_adres)}</td>
      <td>${escapeHtml(r.chauffeur_naam || 'Niet toegewezen')}</td>
      <td>${escapeHtml(r.kenteken || '—')}</td>
      <td>${r.afstand_km != null ? `${r.afstand_km} km` : '—'}</td>
      <td>${r.klantprijs != null ? formatEuro(r.klantprijs) : '—'}</td>
      <td><span class="badge badge-${r.status}">${statusLabel(r.status)}</span></td>
      <td class="knoppenrij">
        <a href="/planner/ritten/${r.id}/bewerken" class="knop knop-klein">Bewerken</a>
        <a href="/planner/sjablonen/nieuw?van_rit=${r.id}" class="knop knop-klein">Als sjabloon</a>
        <form method="post" action="/planner/ritten/${r.id}/verwijderen" class="inline-form" onsubmit="return confirm('Deze rit verwijderen?')">
          <button type="submit" class="knop knop-klein knop-gevaar">Verwijderen</button>
        </form>
      </td>
    </tr>`
        )
        .join('')
    : `<tr><td colspan="9" class="leeg">Geen ritten gevonden voor dit filter.</td></tr>`;

  return `
<div class="paginakop">
  <h1>Ritten</h1>
  <a href="/planner/ritten/nieuw" class="knop knop-primair">+ Nieuwe rit</a>
</div>
<div class="kaart">
  <form method="get" action="/planner" class="form-rij" style="max-width:none;align-items:flex-end;">
    <label>Datum
      <input type="date" name="datum" value="${escapeHtml(datumFilter || '')}">
    </label>
    <button type="submit" class="knop">Filteren</button>
    <a href="/planner" class="knop">Alle ritten</a>
  </form>
</div>
<div class="kaart tabel-wrap">
  <table>
    <thead><tr><th>Datum</th><th>Klant</th><th>Route</th><th>Chauffeur</th><th>Voertuig</th><th>Afstand</th><th>Klantprijs</th><th>Status</th><th></th></tr></thead>
    <tbody>${rijen}</tbody>
  </table>
</div>`;
}

export function pagRitFormulier({ rit, klanten, voertuigen, chauffeurs, toltarieven = [], geselecteerdeTolIds = [], margePercentage = 20, routeBerekeningActief = false, fout }) {
  const isNieuw = !rit;
  const actionUrl = isNieuw ? '/planner/ritten/nieuw' : `/planner/ritten/${rit.id}/bewerken`;

  const voertuigOpties = voertuigen
    .map(
      (v) =>
        `<option value="${escapeHtml(v.id)}" data-kostprijs-per-km="${v.kostprijs_per_km || 0}"${v.id === rit?.voertuig_id ? ' selected' : ''}>${escapeHtml(v.kenteken)}</option>`
    )
    .join('');

  const tolCheckboxes = toltarieven.length
    ? toltarieven
        .map((t) => {
          const checked = geselecteerdeTolIds.includes(t.id) ? ' checked' : '';
          return `<label class="tol-optie">
            <input type="checkbox" name="tol_ids" value="${escapeHtml(t.id)}" data-bedrag="${t.bedrag}"${checked}>
            ${escapeHtml(t.omschrijving)} (${formatEuro(t.bedrag)})
          </label>`;
        })
        .join('')
    : `<p class="leeg" style="padding:0;">Nog geen toltarieven vastgelegd. <a href="/planner/tarieven">Toltarief toevoegen</a>.</p>`;

  return `
<h1>${isNieuw ? 'Nieuwe rit' : 'Rit bewerken'}</h1>
${fout ? `<div class="melding melding-fout">${escapeHtml(fout)}</div>` : ''}
<div class="kaart">
  <form method="post" action="${actionUrl}" class="form" style="max-width:640px;" data-rit-formulier data-marge-percentage="${margePercentage}">
    <div class="form-rij">
      <label>Datum
        <input type="date" name="datum" required value="${escapeHtml(rit?.datum || '')}">
      </label>
      <label>Status
        <select name="status">
          ${['gepland', 'onderweg', 'afgerond', 'geannuleerd']
            .map((s) => optie(s, statusLabel(s), rit?.status || 'gepland'))
            .join('')}
        </select>
      </label>
    </div>
    <label>Ophaaladres
      <input type="text" name="ophaal_adres" required value="${escapeHtml(rit?.ophaal_adres || '')}">
    </label>
    <label>Afleveradres
      <input type="text" name="aflever_adres" required value="${escapeHtml(rit?.aflever_adres || '')}">
    </label>
    <div class="form-rij">
      <label>Klant
        <select name="klant_id">
          <option value="">— Geen —</option>
          ${klanten.map((k) => optie(k.id, k.naam, rit?.klant_id)).join('')}
        </select>
      </label>
      <label>Chauffeur
        <select name="chauffeur_id">
          <option value="">— Niet toegewezen —</option>
          ${chauffeurs.map((c) => optie(c.id, c.naam, rit?.chauffeur_id)).join('')}
        </select>
      </label>
      <label>Voertuig
        <select name="voertuig_id">
          <option value="">— Niet toegewezen —</option>
          ${voertuigOpties}
        </select>
      </label>
    </div>
    <label>Opmerkingen
      <textarea name="opmerkingen">${escapeHtml(rit?.opmerkingen || '')}</textarea>
    </label>

    <h2 style="margin-top:0.5rem;">Route &amp; prijs</h2>
    <div class="form-rij" style="align-items:flex-end;">
      <label>Afstand (km)
        <input type="number" step="0.1" min="0" name="afstand_km" value="${rit?.afstand_km != null ? rit.afstand_km : ''}">
      </label>
      <button type="button" class="knop" data-bereken-route${routeBerekeningActief ? '' : ' title="Nog niet ingesteld — zie Tarieven"'}>Bereken automatisch</button>
    </div>
    <div class="rit-meta" data-route-status>${routeBerekeningActief ? '' : 'Automatisch berekenen is nog niet ingesteld voor deze app — vul de kilometers handmatig in.'}</div>

    <label>Tol (selecteer wat van toepassing is)</label>
    <div class="tol-lijst">${tolCheckboxes}</div>

    <div class="prijs-overzicht">
      <div>Geschatte kostprijs: <strong data-kostprijs-uitkomst>${formatEuro(0)}</strong></div>
      <div>Voorstel klantprijs (marge ${margePercentage}%): <strong data-suggestie-uitkomst>${formatEuro(0)}</strong>
        <button type="button" class="knop knop-klein" data-gebruik-suggestie>Gebruik dit voorstel</button>
      </div>
    </div>

    <label>Klantprijs (€)
      <input type="number" step="0.01" min="0" name="klantprijs" value="${rit?.klantprijs != null ? rit.klantprijs : ''}">
    </label>

    <div class="knoppenrij">
      <button type="submit" class="knop knop-primair">${isNieuw ? 'Rit aanmaken' : 'Wijzigingen opslaan'}</button>
      <a href="/planner" class="knop">Annuleren</a>
    </div>
  </form>
</div>`;
}

// ==================== Vaste/terugkerende ritten-sjablonen ====================

function vandaagIsoDatum() {
  return new Date().toISOString().slice(0, 10);
}

export function pagSjablonenOverzicht({ sjablonen, fout, succes }) {
  const rijen = sjablonen.length
    ? sjablonen
        .map(
          (s) => `<tr>
      <td>${escapeHtml(s.naam)}</td>
      <td>${escapeHtml(s.klant_naam || '—')}</td>
      <td>${escapeHtml(s.ophaal_adres || '—')} → ${escapeHtml(s.aflever_adres || '—')}</td>
      <td>${escapeHtml(s.chauffeur_naam || '—')}</td>
      <td>${escapeHtml(s.kenteken || '—')}</td>
      <td>
        <form method="post" action="/planner/sjablonen/${s.id}/toepassen" class="form-rij" style="max-width:none;align-items:flex-end;flex-wrap:nowrap;">
          <label style="margin:0;">Datum
            <input type="date" name="datum" value="${vandaagIsoDatum()}" required>
          </label>
          <button type="submit" class="knop knop-primair knop-klein">Rit aanmaken</button>
        </form>
      </td>
      <td class="knoppenrij">
        <a href="/planner/sjablonen/${s.id}/bewerken" class="knop knop-klein">Bewerken</a>
        <form method="post" action="/planner/sjablonen/${s.id}/verwijderen" class="inline-form" onsubmit="return confirm('Dit sjabloon verwijderen?')">
          <button type="submit" class="knop knop-klein knop-gevaar">Verwijderen</button>
        </form>
      </td>
    </tr>`
        )
        .join('')
    : `<tr><td colspan="7" class="leeg">Nog geen sjablonen voor vaste/terugkerende ritten.</td></tr>`;

  return `
<div class="paginakop">
  <h1>Sjablonen — vaste ritten</h1>
  <a href="/planner/sjablonen/nieuw" class="knop knop-primair">+ Nieuw sjabloon</a>
</div>
<p class="rit-meta">Voor ritten die steeds terugkeren (bijv. iedere week dezelfde route voor dezelfde opdrachtgever): leg ze één keer vast als sjabloon en maak er daarna met één klik een nieuwe rit van voor de gewenste datum.</p>
${fout ? `<div class="melding melding-fout">${escapeHtml(fout)}</div>` : ''}
${succes ? `<div class="melding melding-succes">Opgeslagen.</div>` : ''}
<div class="kaart tabel-wrap">
  <table>
    <thead><tr><th>Naam</th><th>Klant</th><th>Route</th><th>Chauffeur</th><th>Voertuig</th><th>Rit aanmaken voor</th><th></th></tr></thead>
    <tbody>${rijen}</tbody>
  </table>
</div>`;
}

export function pagSjabloonFormulier({ sjabloon, klanten, voertuigen, chauffeurs, fout }) {
  const isNieuw = !sjabloon?.id;
  const actionUrl = isNieuw ? '/planner/sjablonen/nieuw' : `/planner/sjablonen/${sjabloon.id}/bewerken`;

  return `
<h1>${isNieuw ? 'Nieuw sjabloon' : 'Sjabloon bewerken'}</h1>
${fout ? `<div class="melding melding-fout">${escapeHtml(fout)}</div>` : ''}
<div class="kaart">
  <form method="post" action="${actionUrl}" class="form" style="max-width:640px;">
    <label>Naam van dit sjabloon
      <input type="text" name="naam" required placeholder="Bijv. Wekelijkse rit Rotterdam - Antwerpen" value="${escapeHtml(sjabloon?.naam || '')}">
    </label>
    <label>Ophaaladres
      <input type="text" name="ophaal_adres" required value="${escapeHtml(sjabloon?.ophaal_adres || '')}">
    </label>
    <label>Afleveradres
      <input type="text" name="aflever_adres" required value="${escapeHtml(sjabloon?.aflever_adres || '')}">
    </label>
    <div class="form-rij">
      <label>Klant
        <select name="klant_id">
          <option value="">— Geen —</option>
          ${klanten.map((k) => optie(k.id, k.naam, sjabloon?.klant_id)).join('')}
        </select>
      </label>
      <label>Chauffeur
        <select name="chauffeur_id">
          <option value="">— Niet toegewezen —</option>
          ${chauffeurs.map((c) => optie(c.id, c.naam, sjabloon?.chauffeur_id)).join('')}
        </select>
      </label>
      <label>Voertuig
        <select name="voertuig_id">
          <option value="">— Niet toegewezen —</option>
          ${voertuigen.map((v) => optie(v.id, v.kenteken, sjabloon?.voertuig_id)).join('')}
        </select>
      </label>
    </div>
    <label>Opmerkingen
      <textarea name="opmerkingen">${escapeHtml(sjabloon?.opmerkingen || '')}</textarea>
    </label>
    <div class="knoppenrij">
      <button type="submit" class="knop knop-primair">${isNieuw ? 'Sjabloon opslaan' : 'Wijzigingen opslaan'}</button>
      <a href="/planner/sjablonen" class="knop">Annuleren</a>
    </div>
  </form>
</div>`;
}

// ==================== Back-ups ====================

function formatGrootte(bytes) {
  if (!bytes) return '—';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toLocaleString('nl-NL', { maximumFractionDigits: 1 })} MB` : `${Math.round(bytes / 1024)} KB`;
}

function formatDatumTijd(iso) {
  if (!iso) return '—';
  return iso.replace('T', ' ').slice(0, 16);
}

function oneDriveStatusBadge(status) {
  if (status === 'ok') return `<span class="badge badge-afgerond">OneDrive ✓</span>`;
  if (status === 'mislukt') return `<span class="badge badge-geannuleerd">OneDrive mislukt</span>`;
  return `<span class="rit-meta">—</span>`;
}

export function pagBackups({
  backups,
  succes,
  fout,
  oneDriveGeconfigureerd = false,
  oneDriveGekoppeld = false,
  herstelGestart = false,
  ophaalStatus = null,
  ontbrekendeBestanden = 0,
  tabs = '',
}) {
  const rijen = backups.length
    ? backups
        .map(
          (b) => `<tr>
      <td>${formatDatumTijd(b.aangemaakt_op)}</td>
      <td>${escapeHtml(b.bestandsnaam)}</td>
      <td>${formatGrootte(b.grootte_bytes)}</td>
      <td>${oneDriveGekoppeld ? oneDriveStatusBadge(b.onedrive_status) : `<span class="rit-meta">—</span>`}</td>
      <td class="knoppenrij">
        <a href="/planner/backups/${encodeURIComponent(b.bestandsnaam)}/download" class="knop knop-klein">Downloaden</a>
        ${
          oneDriveGekoppeld
            ? `<form method="post" action="/planner/backups/${b.id}/onedrive-opnieuw" class="inline-form">
          <button type="submit" class="knop knop-klein">${b.onedrive_status === 'ok' ? 'Opnieuw uploaden' : 'Naar OneDrive'}</button>
        </form>`
            : ''
        }
      </td>
    </tr>`
        )
        .join('')
    : `<tr><td colspan="5" class="leeg">Nog geen back-ups gemaakt.</td></tr>`;

  const oneDriveSectie = !oneDriveGeconfigureerd
    ? `<div class="kaart">
    <h2 style="margin-top:0;">OneDrive-koppeling</h2>
    <p class="rit-meta">Back-ups kunnen automatisch ook naar OneDrive worden geüpload, zodat alles behouden blijft — ook als de server of deze app ooit uitvalt. Dit vraagt een eenmalige, gratis app-registratie bij Microsoft:</p>
    <ol class="rit-meta" style="padding-left:1.1rem;">
      <li>Ga naar <span class="mono">entra.microsoft.com</span> (of portal.azure.com) → "App-registraties" → "Nieuwe registratie".</li>
      <li>Naam: bijv. "De Vreugd Transport Back-ups". Bij "Ondersteunde accounttypen" kies: "Accounts in elke organisatiemap en persoonlijke Microsoft-accounts".</li>
      <li>Na aanmaken: ga naar "Verificatie" (Authentication) → zet "Sta openbare clientstromen toe" (Allow public client flows) op <strong>Ja</strong> → opslaan.</li>
      <li>Ga naar "API-machtigingen" → voeg Microsoft Graph-machtiging <span class="mono">Files.ReadWrite</span> en <span class="mono">offline_access</span> toe (delegated).</li>
      <li>Kopieer de "Toepassings-id (client)" (Application/client ID) van de overzichtspagina.</li>
      <li>Zet in Portainer (stack "transportmanager-app" → Environment variables) <span class="mono">ONEDRIVE_CLIENT_ID</span> met die waarde, en klik op "Update the stack".</li>
    </ol>
    <p class="rit-meta">Er is geen client secret of technische kennis verder nodig — na deze stap verschijnt hier een knop om te koppelen.</p>
  </div>`
    : !oneDriveGekoppeld
      ? `<div class="kaart">
    <h2 style="margin-top:0;">OneDrive-koppeling</h2>
    <p class="rit-meta">OneDrive is voorbereid maar nog niet gekoppeld aan een account.</p>
    <form method="post" action="/planner/backups/onedrive/koppelen" class="inline-form">
      <button type="submit" class="knop knop-primair">Koppel OneDrive</button>
    </form>
  </div>`
      : `<div class="kaart">
    <h2 style="margin-top:0;">OneDrive-koppeling</h2>
    <p class="rit-meta">✓ Gekoppeld. Nieuwe back-ups worden automatisch geüpload naar de map "Back-ups De Vreugd Transport" in OneDrive.</p>
    <form method="post" action="/planner/backups/onedrive/loskoppelen" class="inline-form" onsubmit="return confirm('OneDrive loskoppelen?')">
      <button type="submit" class="knop knop-klein knop-gevaar">Loskoppelen</button>
    </form>
  </div>`;

  return `
<div class="pagehead"><div><h1>Beheer</h1><p>Back-ups van de database</p></div>
  <div class="actions"><form method="post" action="/planner/backups/nu" class="inline-form">
    <button type="submit" class="btn primary">Nu back-uppen</button>
  </form></div>
</div>
${tabs}
<p class="rit-meta">De app maakt automatisch elke 24 uur een back-up van de volledige database, en bewaart de 14 meest recente. Download een back-up hier om die veilig op een andere plek te bewaren.</p>
${succes ? `<div class="melding melding-succes">Gelukt.</div>` : ''}
${fout ? `<div class="melding melding-fout">${escapeHtml(fout)}</div>` : ''}
${oneDriveSectie}
<div class="kaart tabel-wrap">
  <table>
    <thead><tr><th>Aangemaakt op</th><th>Bestand</th><th>Grootte</th><th>OneDrive</th><th></th></tr></thead>
    <tbody>${rijen}</tbody>
  </table>
</div>
${overzettenSectie({ herstelGestart, ophaalStatus, ontbrekendeBestanden })}`;
}

// Overzetten vanaf de oude (online) omgeving: database terugzetten en daarna
// de geüploade bestanden (CMR, pakbon, foto's, handtekeningen) ophalen.
function overzettenSectie({ herstelGestart, ophaalStatus, ontbrekendeBestanden }) {
  const st = ophaalStatus;
  const statusBlok = st
    ? `<div class="melding ${st.bezig ? 'melding-info' : st.fout || st.mislukt ? 'melding-fout' : 'melding-succes'}" style="margin-top:0.75rem;">
        <strong>${st.bezig ? 'Bezig…' : 'Laatste ophaalactie:'}</strong> ${escapeHtml(st.melding || '')}<br>
        ${st.totaal} bestanden in de database · ${st.opgehaald} opgehaald · ${st.overgeslagen} waren er al · ${st.mislukt} mislukt
        ${st.bezig ? '<br><a href="/planner/backups#overzetten">Ververs deze pagina</a> om de voortgang te zien.' : ''}
      </div>`
    : '';
  return `
<div class="kaart" id="overzetten" style="margin-top:1rem;">
  <h2 style="margin-top:0;">Overzetten vanaf de oude omgeving</h2>
  ${
    herstelGestart
      ? `<div class="melding melding-succes">De database is ontvangen. De app herstart nu en wisselt de database in (± 10 seconden). <a href="/login">Log daarna opnieuw in</a> met je gegevens uit de oude omgeving.</div>`
      : ''
  }
  <p class="rit-meta"><strong>Stap 1 — Database.</strong> Ga in de oude omgeving naar "Back-ups", klik op "Nu back-uppen" en download de nieuwste back-up (.db). Kies dat bestand hieronder. <strong>Let op:</strong> alle gegevens in déze omgeving worden vervangen (de huidige database wordt eerst nog als "voor-herstel-…" bewaard). Na het terugzetten log je in met je account uit de oude omgeving.</p>
  <form method="post" action="/planner/backups/herstellen" enctype="multipart/form-data" class="inline-form"
        onsubmit="return confirm('Alle gegevens in deze omgeving vervangen door deze back-up?')">
    <input type="file" name="database" accept=".db,.sqlite,application/octet-stream" required>
    <button type="submit" class="knop knop-gevaar">Database terugzetten</button>
  </form>

  <p class="rit-meta" style="margin-top:1.25rem;"><strong>Stap 2 — Bestanden.</strong> CMR's, pakbonnen, foto's en handtekeningen staan los van de database. Vul het adres van de oude omgeving en een planner-account in; de app haalt dan alle ontbrekende bestanden zelf op.
  Nu ontbreken er <strong>${ontbrekendeBestanden}</strong> bestand(en).</p>
  <form method="post" action="/planner/backups/bestanden-ophalen" class="form" style="max-width:480px;">
    <label>Adres oude omgeving <input type="text" name="oude_url" placeholder="https://....up.railway.app" required></label>
    <label>E-mailadres (planner) <input type="email" name="email" required></label>
    <label>Wachtwoord <input type="password" name="wachtwoord" required></label>
    <button type="submit" class="knop knop-primair"${st && st.bezig ? ' disabled' : ''}>Bestanden ophalen</button>
  </form>
  ${statusBlok}
</div>`;
}

export function pagOneDriveKoppelen({ userCode, verificatieUrl, nogNietVoltooid = false }) {
  return `
<div class="paginakop">
  <h1>OneDrive koppelen</h1>
</div>
${nogNietVoltooid ? `<div class="melding melding-fout">Nog niet voltooid — voer de code hieronder in en klik daarna opnieuw op "Ik heb dit gedaan".</div>` : ''}
<div class="kaart" style="max-width:480px;">
  <p>Ga op een computer of telefoon naar <a href="${escapeHtml(verificatieUrl)}" target="_blank" rel="noopener">${escapeHtml(verificatieUrl)}</a> en voer deze code in:</p>
  <p style="font-size:1.8rem;font-weight:700;letter-spacing:0.08em;text-align:center;margin:1rem 0;">${escapeHtml(userCode)}</p>
  <p class="rit-meta">Log daarna in met het Microsoft- of OneDrive-account waar de back-ups naartoe moeten. Klik hierna op de knop hieronder.</p>
  <form method="post" action="/planner/backups/onedrive/koppelen/controleren" class="inline-form">
    <button type="submit" class="knop knop-primair">Ik heb dit gedaan — controleren</button>
  </form>
</div>`;
}

export const HERINNERING_TYPE_LABEL = { apk: 'APK', onderhoud: 'Onderhoud', verzekering: 'Verzekering', overig: 'Overig' };

function aandachtBadge(status) {
  if (status === 'verlopen') return `<span class="badge badge-geannuleerd">Verlopen</span>`;
  if (status === 'binnenkort') return `<span class="badge badge-onderweg">Binnenkort</span>`;
  return `<span class="badge badge-afgerond">OK</span>`;
}

export function pagVoertuigen({ voertuigen, fout }) {
  const rijen = voertuigen.length
    ? voertuigen
        .map(
          (v) => `<tr>
      <td><a href="/planner/voertuigen/${v.id}">${escapeHtml(v.kenteken)}</a></td>
      <td>${escapeHtml(v.omschrijving || '—')}</td>
      <td>${formatEuro(v.kostprijs_per_km)} /km</td>
      <td>${v.actief ? 'Actief' : 'Inactief'}</td>
      <td>${aandachtBadge(v.aandacht_status)}${v.eerstvolgende_omschrijving ? `<div class="rit-meta">${escapeHtml(v.eerstvolgende_omschrijving)} ${formatDatum(v.eerstvolgende_vervaldatum)}</div>` : ''}</td>
      <td class="knoppenrij">
        <a href="/planner/voertuigen/${v.id}" class="knop knop-klein">Beheren</a>
        <form method="post" action="/planner/voertuigen/${v.id}/verwijderen" class="inline-form" onsubmit="return confirm('Voertuig verwijderen?')">
          <button type="submit" class="knop knop-klein knop-gevaar">Verwijderen</button>
        </form>
      </td>
    </tr>`
        )
        .join('')
    : `<tr><td colspan="6" class="leeg">Nog geen voertuigen toegevoegd.</td></tr>`;

  return `
<h1>Voertuigen</h1>
${fout ? `<div class="melding melding-fout">${escapeHtml(fout)}</div>` : ''}
<div class="kaart">
  <form method="post" action="/planner/voertuigen/nieuw" class="form-rij" style="align-items:flex-end;">
    <label>Kenteken
      <input type="text" name="kenteken" required placeholder="AB-123-C">
    </label>
    <label>Omschrijving
      <input type="text" name="omschrijving" placeholder="Bijv. bestelbus 3.5t">
    </label>
    <label>Kostprijs per km (€)
      <input type="number" step="0.01" min="0" name="kostprijs_per_km" placeholder="Bijv. 0,45">
    </label>
    <button type="submit" class="knop knop-primair">Toevoegen</button>
  </form>
</div>
<div class="kaart tabel-wrap">
  <table>
    <thead><tr><th>Kenteken</th><th>Omschrijving</th><th>Kostprijs</th><th>Status</th><th>Onderhoud/APK/verzekering</th><th></th></tr></thead>
    <tbody>${rijen}</tbody>
  </table>
</div>`;
}

export function pagVoertuigDetail({ voertuig, herinneringen, bezetting, van, tot, fout, succes }) {
  const herinneringRijen = herinneringen.length
    ? herinneringen
        .map(
          (h) => `<tr>
      <td>${HERINNERING_TYPE_LABEL[h.type] || h.type}</td>
      <td>${escapeHtml(h.omschrijving || '—')}</td>
      <td>${formatDatum(h.vervaldatum)}</td>
      <td>${aandachtBadge(h.status)}</td>
      <td>
        <form method="post" action="/planner/voertuigen/${voertuig.id}/herinneringen/${h.id}/verwijderen" class="inline-form" onsubmit="return confirm('Herinnering verwijderen?')">
          <button type="submit" class="knop knop-klein knop-gevaar">Verwijderen</button>
        </form>
      </td>
    </tr>`
        )
        .join('')
    : `<tr><td colspan="5" class="leeg">Nog geen herinneringen vastgelegd.</td></tr>`;

  return `
<div class="paginakop">
  <h1>${escapeHtml(voertuig.kenteken)}</h1>
  <a href="/planner/voertuigen" class="knop">← Alle voertuigen</a>
</div>
${fout ? `<div class="melding melding-fout">${escapeHtml(fout)}</div>` : ''}
${succes ? `<div class="melding melding-succes">Opgeslagen.</div>` : ''}
<div class="kaart">
  <div class="rit-meta">${escapeHtml(voertuig.omschrijving || 'Geen omschrijving')} · ${formatEuro(voertuig.kostprijs_per_km)}/km · ${voertuig.actief ? 'Actief' : 'Inactief'}</div>
</div>

<h2>Bezetting</h2>
<div class="kaart">
  <form method="get" action="/planner/voertuigen/${voertuig.id}" class="form-rij" style="max-width:none;align-items:flex-end;margin-bottom:1rem;">
    <label>Van
      <input type="date" name="van" value="${escapeHtml(van)}">
    </label>
    <label>Tot en met
      <input type="date" name="tot" value="${escapeHtml(tot)}">
    </label>
    <button type="submit" class="knop">Weergeven</button>
  </form>
  <div class="rit-meta">Kilometers gereden: <strong>${Math.round(bezetting.totaalKm)} km</strong> · Gewerkte tijd: <strong>${formatUren(bezetting.totaalUren)}</strong></div>
  <div class="rit-meta">Ingezet op ${bezetting.dagenIngezet} van de ${bezetting.dagenInPeriode} dagen in deze periode.</div>
</div>

<h2>Onderhoud, APK &amp; verzekering</h2>
<p class="sectie-sub" style="color:var(--kleur-subtekst);margin:0 0 0.75rem;">Leg vervaldatums vast — de app waarschuwt automatisch als een datum binnen 30 dagen valt of al verstreken is.</p>
<div class="kaart">
  <form method="post" action="/planner/voertuigen/${voertuig.id}/herinneringen/nieuw" class="form-rij" style="align-items:flex-end;">
    <label>Type
      <select name="type">
        ${Object.entries(HERINNERING_TYPE_LABEL).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
      </select>
    </label>
    <label>Omschrijving
      <input type="text" name="omschrijving" placeholder="Bijv. grote beurt">
    </label>
    <label>Vervaldatum
      <input type="date" name="vervaldatum" required>
    </label>
    <button type="submit" class="knop knop-primair">Toevoegen</button>
  </form>
</div>
<div class="kaart tabel-wrap">
  <table>
    <thead><tr><th>Type</th><th>Omschrijving</th><th>Vervaldatum</th><th>Status</th><th></th></tr></thead>
    <tbody>${herinneringRijen}</tbody>
  </table>
</div>`;
}

const TYPE_OPDRACHTGEVER_LABEL = { klant: 'Eigen klant', transporteur: 'Transporteur' };

export function pagKlanten({ klanten, fout }) {
  const rijen = klanten.length
    ? klanten
        .map(
          (k) => `<tr>
      <td><a href="/planner/klanten/${k.id}">${escapeHtml(k.naam)}</a></td>
      <td>${TYPE_OPDRACHTGEVER_LABEL[k.type] || k.type}</td>
      <td>${escapeHtml(k.adres || '—')}</td>
      <td>${escapeHtml(k.telefoon || '—')}</td>
      <td>${escapeHtml(k.email || '—')}</td>
      <td>${k.aantal_tarieven || 0}</td>
      <td class="knoppenrij">
        <a href="/planner/klanten/${k.id}" class="knop knop-klein">Beheren</a>
        <form method="post" action="/planner/klanten/${k.id}/verwijderen" class="inline-form" onsubmit="return confirm('Klant verwijderen?')">
          <button type="submit" class="knop knop-klein knop-gevaar">Verwijderen</button>
        </form>
      </td>
    </tr>`
        )
        .join('')
    : `<tr><td colspan="7" class="leeg">Nog geen opdrachtgevers toegevoegd.</td></tr>`;

  return `
<h1>Klanten &amp; opdrachtgevers</h1>
<p class="sectie-sub" style="color:var(--kleur-subtekst);margin:0 0 1rem;">Zowel je eigen klanten als transporteurs waarvoor je rijdt. Klik op een naam om tariefafspraken te beheren.</p>
${fout ? `<div class="melding melding-fout">${escapeHtml(fout)}</div>` : ''}
<div class="kaart">
  <form method="post" action="/planner/klanten/nieuw" class="form-rij" style="align-items:flex-end;">
    <label>Naam
      <input type="text" name="naam" required>
    </label>
    <label>Type
      <select name="type">
        <option value="klant">Eigen klant</option>
        <option value="transporteur">Transporteur</option>
      </select>
    </label>
    <label>Adres
      <input type="text" name="adres">
    </label>
    <label>Telefoon
      <input type="text" name="telefoon">
    </label>
    <label>E-mail
      <input type="email" name="email">
    </label>
    <button type="submit" class="knop knop-primair">Toevoegen</button>
  </form>
</div>
<div class="kaart tabel-wrap">
  <table>
    <thead><tr><th>Naam</th><th>Type</th><th>Adres</th><th>Telefoon</th><th>E-mail</th><th>Tarieven</th><th></th></tr></thead>
    <tbody>${rijen}</tbody>
  </table>
</div>`;
}

const TARIEF_TYPE_LABEL = {
  vast_per_rit: 'Vast per rit',
  per_uur: 'Per uur',
  per_km: 'Per km',
  per_uur_en_km: 'Per uur + per km',
  per_pallet: 'Per pallet/colli',
};

export function tariefLabel(t) {
  const delen = [];
  if (t.type === 'vast_per_rit') delen.push(formatEuro(t.tarief_vast) + ' per rit');
  if (t.type === 'per_uur' || t.type === 'per_uur_en_km') delen.push(formatEuro(t.tarief_per_uur) + '/uur');
  if (t.type === 'per_km' || t.type === 'per_uur_en_km') delen.push(formatEuro(t.tarief_per_km) + '/km');
  if (t.type === 'per_pallet') delen.push(formatEuro(t.tarief_per_pallet) + '/pallet');
  return `${t.naam} — ${delen.join(' + ')}`;
}

export function pagKlantDetail({ klant, tariefafspraken, fout, succes }) {
  const tariefRijen = tariefafspraken.length
    ? tariefafspraken
        .map(
          (t) => `<tr>
      <td>${escapeHtml(t.naam)}</td>
      <td>${TARIEF_TYPE_LABEL[t.type] || t.type}</td>
      <td>${escapeHtml(tariefLabel(t).split(' — ')[1] || '')}</td>
      <td>${t.actief ? 'Actief' : 'Inactief'}</td>
      <td>
        <form method="post" action="/planner/klanten/${klant.id}/tarieven/${t.id}/verwijderen" class="inline-form" onsubmit="return confirm('Tariefafspraak verwijderen?')">
          <button type="submit" class="knop knop-klein knop-gevaar">Verwijderen</button>
        </form>
      </td>
    </tr>`
        )
        .join('')
    : `<tr><td colspan="5" class="leeg">Nog geen tariefafspraken voor deze opdrachtgever.</td></tr>`;

  return `
<div class="paginakop">
  <h1>${escapeHtml(klant.naam)}</h1>
  <a href="/planner/klanten" class="knop">← Alle klanten</a>
</div>
${fout ? `<div class="melding melding-fout">${escapeHtml(fout)}</div>` : ''}
${succes ? `<div class="melding melding-succes">Opgeslagen.</div>` : ''}
<div class="kaart">
  <div class="rit-meta">${TYPE_OPDRACHTGEVER_LABEL[klant.type] || klant.type} · ${escapeHtml(klant.adres || 'geen adres')} · ${escapeHtml(klant.telefoon || 'geen telefoon')} · ${escapeHtml(klant.email || 'geen e-mail')}</div>
</div>

<h2>Tariefafspraken</h2>
<p class="sectie-sub" style="color:var(--kleur-subtekst);margin:0 0 0.75rem;">Eén opdrachtgever kan meerdere afspraken hebben — kies bij elke rit of werkdag welke van toepassing is.</p>
<div class="kaart">
  <form method="post" action="/planner/klanten/${klant.id}/tarieven/nieuw" class="form" style="max-width:640px;" data-tarief-formulier>
    <div class="form-rij">
      <label>Naam van de afspraak
        <input type="text" name="naam" required placeholder="Bijv. Standaard, Spoedrit, Palletvervoer">
      </label>
      <label>Type
        <select name="type" data-tarief-type>
          ${Object.entries(TARIEF_TYPE_LABEL).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
        </select>
      </label>
    </div>
    <div class="form-rij">
      <label data-tarief-veld="vast_per_rit">Vast bedrag per rit (€)
        <input type="number" step="0.01" min="0" name="tarief_vast">
      </label>
      <label data-tarief-veld="per_uur,per_uur_en_km">Tarief per uur (€)
        <input type="number" step="0.01" min="0" name="tarief_per_uur">
      </label>
      <label data-tarief-veld="per_km,per_uur_en_km">Tarief per km (€)
        <input type="number" step="0.01" min="0" name="tarief_per_km">
      </label>
      <label data-tarief-veld="per_pallet">Tarief per pallet/colli (€)
        <input type="number" step="0.01" min="0" name="tarief_per_pallet">
      </label>
    </div>
    <div class="knoppenrij">
      <button type="submit" class="knop knop-primair">Tariefafspraak toevoegen</button>
    </div>
  </form>
</div>
<div class="kaart tabel-wrap">
  <table>
    <thead><tr><th>Naam</th><th>Type</th><th>Tarief</th><th>Status</th><th></th></tr></thead>
    <tbody>${tariefRijen}</tbody>
  </table>
</div>`;
}

export function pagChauffeurs({ chauffeurs, fout, nieuweInloggegevens, nieuwWachtwoordVoor }) {
  const rijen = chauffeurs.length
    ? chauffeurs
        .map(
          (c) => `<tr>
      <td>${escapeHtml(c.naam)}</td>
      <td>${escapeHtml(c.email)}</td>
      <td>${c.actief ? 'Actief' : 'Inactief'}</td>
      <td class="knoppenrij">
        <a href="/planner/chauffeurs/${c.id}/uren" class="knop knop-klein">Uren</a>
        <form method="post" action="/planner/chauffeurs/${c.id}/apparaten-afmelden" class="inline-form" onsubmit="return confirm('Alle apparaten van ${escapeHtml(c.naam)} afmelden? De chauffeur logt daarna opnieuw in met een e-mailcode en kiest een nieuwe pincode.')">
          <button type="submit" class="knop knop-klein">Apparaten afmelden</button>
        </form>
        <form method="post" action="/planner/chauffeurs/${c.id}/deactiveren" class="inline-form" onsubmit="return confirm('${c.actief ? 'Chauffeur deactiveren' : 'Chauffeur activeren'}?')">
          <button type="submit" class="knop knop-klein">${c.actief ? 'Deactiveren' : 'Activeren'}</button>
        </form>
      </td>
    </tr>`
        )
        .join('')
    : `<tr><td colspan="4" class="leeg">Nog geen chauffeurs toegevoegd.</td></tr>`;

  return `
<div class="pagehead"><div><h1>Chauffeurs</h1><p>Chauffeurs zijn gebruikers met de functierol Chauffeur. Rollen en rechten beheer je in <a href="/beheer/gebruikers">Beheer</a>.</p></div></div>
${fout ? `<div class="melding melding-fout">${escapeHtml(fout)}</div>` : ''}
${
  nieuweInloggegevens
    ? `<div class="melding melding-succes">Account aangemaakt voor ${escapeHtml(nieuweInloggegevens.naam)} (${escapeHtml(nieuweInloggegevens.email)}).<br>
       Er is een welkomstmail verstuurd. De chauffeur logt in met dit e-mailadres: een code per mail en daarna een eigen pincode.</div>`
    : ''
}
${
  nieuwWachtwoordVoor
    ? `<div class="melding melding-succes">Alle apparaten van ${escapeHtml(nieuwWachtwoordVoor.naam)} zijn afgemeld. Bij de volgende keer inloggen krijgt de chauffeur een e-mailcode (${escapeHtml(nieuwWachtwoordVoor.email)}) en kiest een nieuwe pincode.</div>`
    : ''
}
<div class="kaart">
  <form method="post" action="/planner/chauffeurs/nieuw" class="form-rij" style="align-items:flex-end;">
    <label>Naam
      <input type="text" name="naam" required>
    </label>
    <label>E-mailadres
      <input type="email" name="email" required>
    </label>
    <button type="submit" class="knop knop-primair">Chauffeursaccount aanmaken</button>
  </form>
</div>
<div class="kaart tabel-wrap">
  <table>
    <thead><tr><th>Naam</th><th>E-mail</th><th>Status</th><th></th></tr></thead>
    <tbody>${rijen}</tbody>
  </table>
</div>`;
}

export function pagInstellingen({
  fout,
  succes,
  huidigEmail,
  emailFout,
  emailSucces,
  magPincode = false,
  heeftPincode = false,
  pincodeFout,
  pincodeSucces,
}) {
  const pincodeSectie = magPincode
    ? `<div class="kaart">
  <h2 style="margin-top:0;">Pincode</h2>
  <p class="rit-meta">${
    heeftPincode
      ? 'Je hebt al een persoonlijke code ingesteld. Hieronder kun je die wijzigen.'
      : 'Je hebt nog geen persoonlijke code. Stel er hier één in (4 tot 6 cijfers) om voortaan snel te kunnen inloggen zonder e-mail/wachtwoord.'
  }</p>
  ${pincodeFout ? `<div class="melding melding-fout">${escapeHtml(pincodeFout)}</div>` : ''}
  ${pincodeSucces ? `<div class="melding melding-succes">Je code is opgeslagen.</div>` : ''}
  <form method="post" action="/account/pincode" class="form">
    ${
      heeftPincode
        ? `<label>Huidige code
      <input type="password" inputmode="numeric" pattern="[0-9]*" name="huidige_code" required autocomplete="off">
    </label>`
        : ''
    }
    <label>Nieuwe code (4-6 cijfers)
      <input type="password" inputmode="numeric" pattern="[0-9]*" minlength="4" maxlength="6" name="nieuwe_code" required autocomplete="off">
    </label>
    <label>Nieuwe code herhalen
      <input type="password" inputmode="numeric" pattern="[0-9]*" minlength="4" maxlength="6" name="nieuwe_code_herhaald" required autocomplete="off">
    </label>
    <div class="knoppenrij">
      <button type="submit" class="knop knop-primair">Code opslaan</button>
    </div>
  </form>
</div>`
    : '';

  return `
<h1>Instellingen</h1>
<div class="kaart">
  <h2 style="margin-top:0;">E-mailadres wijzigen</h2>
  <p class="rit-meta">Huidig e-mailadres: <strong>${escapeHtml(huidigEmail || '')}</strong>. Dit is ook het adres waarmee je inlogt.</p>
  ${emailFout ? `<div class="melding melding-fout">${escapeHtml(emailFout)}</div>` : ''}
  ${emailSucces ? `<div class="melding melding-succes">E-mailadres bijgewerkt. Log vanaf nu in met je nieuwe e-mailadres.</div>` : ''}
  <form method="post" action="/account/email" class="form">
    <label>Nieuw e-mailadres
      <input type="email" name="nieuw_email" required autocomplete="email">
    </label>
    <label>Huidig wachtwoord (ter bevestiging)
      <input type="password" name="huidig_wachtwoord" required autocomplete="current-password">
    </label>
    <div class="knoppenrij">
      <button type="submit" class="knop knop-primair">E-mailadres opslaan</button>
    </div>
  </form>
</div>
<div class="kaart">
  <h2 style="margin-top:0;">Wachtwoord wijzigen</h2>
  ${fout ? `<div class="melding melding-fout">${escapeHtml(fout)}</div>` : ''}
  ${succes ? `<div class="melding melding-succes">Je wachtwoord is bijgewerkt.</div>` : ''}
  <form method="post" action="/account/wachtwoord" class="form">
    <label>Huidig wachtwoord
      <input type="password" name="huidig_wachtwoord" required autocomplete="current-password">
    </label>
    <label>Nieuw wachtwoord
      <input type="password" name="nieuw_wachtwoord" required minlength="8" autocomplete="new-password">
    </label>
    <label>Nieuw wachtwoord herhalen
      <input type="password" name="nieuw_wachtwoord_herhaald" required minlength="8" autocomplete="new-password">
    </label>
    <div class="knoppenrij">
      <button type="submit" class="knop knop-primair">Wachtwoord opslaan</button>
    </div>
  </form>
</div>
${pincodeSectie}`;
}

function formatMinuten(minuten) {
  const m = Math.max(0, Math.round(minuten || 0));
  const uren = Math.floor(m / 60);
  const rest = m % 60;
  return `${uren}u ${String(rest).padStart(2, '0')}min`;
}

function taakKaartVoorChauffeur(t, routeDatum) {
  const teLaat = taakIsTeLaat({ ...t, route_datum: routeDatum });
  const afgerond = t.status === 'afgerond';
  return `
      <div class="rit-kaart${teLaat ? ' taak-te-laat' : ''}">
        <div class="rit-meta">#${t.volgorde} · ${TAAK_TYPE_LABEL[t.type] || t.type} · <span class="badge badge-${afgerond ? 'afgerond' : 'gepland'}">${afgerond ? 'Afgerond' : 'Open'}</span>${teLaat ? ' · <strong style="color:var(--kleur-rood);">Tijdvenster verstreken</strong>' : ''}</div>
        <div class="rit-adressen">${escapeHtml(t.adres)}</div>
        <div class="rit-meta">${t.lading_omschrijving ? escapeHtml(t.lading_omschrijving) + ' · ' : ''}${t.aantal_pallets ? t.aantal_pallets + ' pallet(s) · ' : ''}${t.aantal_colli ? t.aantal_colli + ' colli · ' : ''}${t.gewicht_kg ? t.gewicht_kg + ' kg · ' : ''}${t.laadmeters ? t.laadmeters + ' ldm' : ''}</div>
        ${t.tijdvenster_van || t.tijdvenster_tot ? `<div class="rit-meta">Tijdvenster: ${escapeHtml(t.tijdvenster_van || '?')} – ${escapeHtml(t.tijdvenster_tot || '?')}</div>` : ''}
        ${t.telefoonnummer || t.laadnummer ? `<div class="rit-meta">${t.telefoonnummer ? 'Tel: ' + escapeHtml(t.telefoonnummer) + ' · ' : ''}${t.laadnummer ? 'Laadnr: ' + escapeHtml(t.laadnummer) : ''}</div>` : ''}
        ${t.extra_info ? `<div class="rit-meta">${escapeHtml(t.extra_info)}</div>` : ''}
        <div class="knoppenrij" style="margin-top:0.5rem;">
          <a href="/chauffeur/taken/${t.id}" class="knop knop-klein${afgerond ? '' : ' knop-primair'}">${afgerond ? 'Bekijken' : 'Afhandelen'}</a>
        </div>
      </div>`;
}

// ---- Chauffeur: beginscherm ----
// ---- Chauffeur: dashboard ("Mijn dag") in de opbouw van het WorkPortal-dashboard ----
const DAG_KORT = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
const MAAND_KORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
function datumDelen(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  return { dag: d.getUTCDate(), maand: MAAND_KORT[d.getUTCMonth()], weekdag: DAG_KORT[(d.getUTCDay() + 6) % 7] };
}
function langeDatum(iso) {
  return new Intl.DateTimeFormat('nl-NL', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${iso}T12:00:00Z`));
}
function weekNummer(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  const dag = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dag + 3);
  const eersteDonderdag = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - eersteDonderdag) / 864e5 - 3 + ((eersteDonderdag.getUTCDay() + 6) % 7)) / 7);
}
function urenKort(min) {
  const m = Math.round(min || 0);
  return `${Math.floor(m / 60)}u ${String(m % 60).padStart(2, '0')}m`;
}
const kmTekst = (km) => `${Math.round(km || 0).toLocaleString('nl-NL')} km`;
const ICO = {
  klok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/></svg>',
  weg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 21L9 3M20 21L15 3M12 5v2M12 11v2M12 17v2"/></svg>',
  truck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 6h11v10H2zM13 9h4l4 4v3h-8"/><circle cx="6.5" cy="17.5" r="2"/><circle cx="17.5" cy="17.5" r="2"/></svg>',
  lijst: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  bel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  let: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/></svg>',
};
const TAAK_LABEL = { laden: 'Laden', lossen: 'Lossen', ophalen: 'Ophalen', afleveren: 'Afleveren', pauze: 'Pauze', tanken: 'Tanken' };

export function pagChauffeurDashboard({
  begroeting,
  datumVandaag,
  werkdag,
  totalenVandaag = {},
  aantalOpdrachtenVandaag = 0,
  openOpdracht = null,
  openOpdrachtKlant = null,
  weekDagen = [],
  urenDezeWeekMinuten = 0,
  kmDezeWeek = 0,
  dagenGewerkt = 0,
  ritten = [],
  openTaken = [],
  ongelezenMeldingen = [],
}) {
  // ---- Vandaag ----
  const bezig = werkdag && werkdag.status !== 'afgerond';
  const afgerond = werkdag && werkdag.status === 'afgerond';
  const statusTitel = bezig ? 'Aan het werk' : afgerond ? 'Dag afgerond' : 'Nog niet begonnen';
  const statusSub = bezig
    ? `Sinds ${escapeHtml(werkdag.start_tijd || '—')}${openOpdracht ? ` · bezig voor ${escapeHtml(openOpdrachtKlant || 'een opdracht')}` : ''}`
    : afgerond
      ? `Gestart om ${escapeHtml(werkdag.start_tijd || '—')}${werkdag.eind_tijd ? `, klaar om ${escapeHtml(werkdag.eind_tijd)}` : ''}`
      : 'Start je dag in de urenregistratie zodra je begint.';
  const actieKnop = bezig
    ? `<a class="btn hero-btn" href="/chauffeur/uren">${ICO.klok}Naar mijn dag</a>`
    : afgerond
      ? `<a class="btn hero-btn" href="/chauffeur/uren">Dag bekijken</a>`
      : `<a class="btn hero-btn" href="/chauffeur/uren">${ICO.plus}Nieuwe dag beginnen</a>`;
  const vandaagKaart = `<section class="hero">
  <div class="hero-hoofd">
    <div class="hero-label"><span class="hero-dot ${bezig ? 'aan' : afgerond ? 'klaar' : ''}"></span>Vandaag</div>
    <div class="hero-titel">${statusTitel}</div>
    <div class="hero-sub">${statusSub}</div>
    <div class="hero-actie">${actieKnop}</div>
  </div>
  <div class="hero-cijfers">
    <div><span>Gewerkt</span><b>${urenKort(totalenVandaag.nettoMinuten)}</b></div>
    <div><span>Gereden</span><b>${totalenVandaag.kmTotaal != null ? kmTekst(totalenVandaag.kmTotaal) : '—'}</b></div>
    <div><span>Opdrachten</span><b>${aantalOpdrachtenVandaag}</b></div>
  </div>
</section>`;

  // ---- Kerncijfers ----
  const geplandeRitten = ritten.filter((r) => r.status === 'gepland');
  const onderweg = ritten.filter((r) => r.status === 'onderweg');
  const aantalOpen = onderweg.length + openTaken.length + (openOpdracht ? 1 : 0);
  const eerstvolgende = geplandeRitten[0];
  const doelMinuten = 40 * 60;
  const pct = Math.min(100, Math.round((urenDezeWeekMinuten / doelMinuten) * 100));
  const kpis = `<div class="grid g4 chauffeur-kpis">
  <a class="card kpi" href="/chauffeur/weekoverzicht"><div class="kpi-ico">${ICO.klok}</div><div class="label">Uren deze week</div><div class="value">${urenKort(urenDezeWeekMinuten)}</div>
    <div class="kpi-balk"><div style="width:${pct}%"></div></div><div class="sub">${dagenGewerkt} ${dagenGewerkt === 1 ? 'dag' : 'dagen'} gewerkt</div></a>
  <a class="card kpi" href="/chauffeur/weekoverzicht"><div class="kpi-ico">${ICO.weg}</div><div class="label">Gereden deze week</div><div class="value">${kmTekst(kmDezeWeek)}</div>
    <div class="sub">${dagenGewerkt ? `gem. ${kmTekst(kmDezeWeek / dagenGewerkt)} per dag` : 'nog geen kilometers'}</div></a>
  <a class="card kpi" href="/chauffeur/ritopdrachten"><div class="kpi-ico">${ICO.truck}</div><div class="label">Geplande ritten</div><div class="value">${geplandeRitten.length}</div>
    <div class="sub">${eerstvolgende ? `eerstvolgende ${datumDelen(eerstvolgende.datum).weekdag} ${datumDelen(eerstvolgende.datum).dag} ${datumDelen(eerstvolgende.datum).maand}` : 'niets gepland'}</div></a>
  <a class="card kpi${aantalOpen ? ' kpi-let' : ''}" href="/chauffeur/ritopdrachten"><div class="kpi-ico">${ICO.lijst}</div><div class="label">Openstaand</div><div class="value">${aantalOpen}</div>
    <div class="sub">${[onderweg.length ? `${onderweg.length} onderweg` : '', openTaken.length ? `${openTaken.length} ${openTaken.length === 1 ? 'stop' : 'stops'}` : '', openOpdracht ? '1 lopende opdracht' : ''].filter(Boolean).join(' · ') || 'alles afgerond'}</div></a>
</div>`;

  // ---- Deze week (staafjes per dag) ----
  const maxMin = Math.max(8 * 60, ...weekDagen.map((d) => d.minuten));
  const weekKaart = `<section class="card">
  <div class="card-head"><h2>Deze week</h2><a class="small" href="/chauffeur/weekoverzicht">Weekoverzicht</a></div>
  <div class="weekbalk">${weekDagen
    .map((d) => {
      const dd = datumDelen(d.datum);
      const h = d.minuten ? Math.max(6, Math.round((d.minuten / maxMin) * 100)) : 0;
      return `<div class="wb-dag${d.vandaag ? ' vandaag' : ''}${d.minuten ? '' : ' leeg'}">
      <div class="wb-waarde">${d.minuten ? urenKort(d.minuten).replace(' ', '') : '–'}</div>
      <div class="wb-kolom"><div class="wb-staaf" style="height:${h}%"></div></div>
      <div class="wb-label">${dd.weekdag}</div>
      <div class="wb-km">${d.km ? Math.round(d.km) + ' km' : ''}</div>
    </div>`;
    })
    .join('')}</div>
  <div class="weektotaal">
    <div><span>Totaal gewerkt</span><b>${urenKort(urenDezeWeekMinuten)}</b></div>
    <div><span>Gereden</span><b>${kmTekst(kmDezeWeek)}</b></div>
    <div><span>Dagen</span><b>${dagenGewerkt}</b></div>
  </div>
</section>`;

  // ---- Komende ritten en openstaande stops ----
  const regels = [
    ...ritten.map((r) => ({
      datum: r.datum,
      href: '/chauffeur/ritopdrachten',
      titel: `${escapeHtml(r.ophaal_adres)} → ${escapeHtml(r.aflever_adres)}`,
      sub: [r.klant_naam, r.kenteken].filter(Boolean).map(escapeHtml).join(' · ') || 'Rit',
      badge: `<span class="badge badge-${r.status}">${statusLabel(r.status)}</span>`,
    })),
    ...openTaken.map((t) => ({
      datum: t.datum,
      href: `/chauffeur/taken/${t.id}`,
      titel: `${escapeHtml(TAAK_LABEL[t.type] || t.type || 'Stop')} · ${escapeHtml(t.adres)}`,
      sub: [t.klant_naam, t.tijdvenster_van ? `${t.tijdvenster_van}${t.tijdvenster_tot ? '–' + t.tijdvenster_tot : ''}` : ''].filter(Boolean).map(escapeHtml).join(' · ') || 'Stop uit route',
      badge: `<span class="badge b-blue">Stop</span>`,
    })),
  ].sort((x, y) => (x.datum < y.datum ? -1 : x.datum > y.datum ? 1 : 0));
  const lijstKaart = `<section class="card">
  <div class="card-head"><h2>Komende ritten &amp; opdrachten</h2><a class="small" href="/chauffeur/ritopdrachten">Alles</a></div>
  <div class="rows">${
    regels
      .slice(0, 8)
      .map((r) => {
        const dd = datumDelen(r.datum);
        return `<a class="rowitem" href="${r.href}">
      <div class="datumtegel${r.datum === datumVandaag ? ' vandaag' : ''}"><b>${dd.dag}</b><span>${dd.maand}</span></div>
      <div class="grow"><div class="t">${r.titel}</div><div class="s">${dd.weekdag}${r.datum === datumVandaag ? ' (vandaag)' : ''} · ${r.sub}</div></div>
      ${r.badge}
    </a>`;
      })
      .join('') || '<div class="empty">Geen geplande ritten of openstaande opdrachten.</div>'
  }</div>
</section>`;

  // ---- Meldingen ----
  const meldingenKaart = ongelezenMeldingen.length
    ? `<section class="card meldingen-kaart">
  <div class="card-head"><h2>${ICO.bel}Nieuwe meldingen</h2>
    <form method="post" action="/chauffeur/notificaties/alles-gelezen"><button class="btn ghost sm" type="submit">Alles gelezen</button></form></div>
  <div class="rows">${ongelezenMeldingen
    .map(
      (m) => `<div class="rowitem"><div class="grow"><div class="t">${escapeHtml(m.tekst)}</div><div class="s">${escapeHtml(formatDatumTijd(m.aangemaakt_op))}</div></div>
      <form method="post" action="/chauffeur/notificaties/${m.id}/gelezen"><button type="submit" class="btn sm">Gelezen</button></form></div>`
    )
    .join('')}</div>
</section>`
    : '';

  return `
<div class="pagehead">
  <div><h1>${begroeting}</h1><p>${escapeHtml(langeDatum(datumVandaag))} · week ${weekNummer(datumVandaag)}</p></div>
  <div class="actions">
    <a class="btn" href="/chauffeur/meldingen">${ICO.let}Schade melden</a>
    <a class="btn primary" href="/chauffeur/uren">${ICO.klok}Urenregistratie</a>
  </div>
</div>
${meldingenKaart}
${vandaagKaart}
${kpis}
<div class="grid g2 stack">
${lijstKaart}
${weekKaart}
</div>`;
}

// ---- Chauffeur: Ritopdrachten (losse ritten van de planner) ----
export function pagChauffeurRitopdrachten({ ritten = [] }) {
  const ritKaarten = ritten.length
    ? ritten
        .map((r) => {
          const volgendeStatus = { gepland: 'onderweg', onderweg: 'afgerond' }[r.status];
          const volgendeLabel = { onderweg: 'Markeer als onderweg', afgerond: 'Markeer als afgerond' }[volgendeStatus];
          return `
      <div class="rit-kaart">
        <div class="rit-meta">${formatDatum(r.datum)} · <span class="badge badge-${r.status}">${statusLabel(r.status)}</span></div>
        <div class="rit-adressen">${escapeHtml(r.ophaal_adres)} → ${escapeHtml(r.aflever_adres)}</div>
        <div class="rit-meta">${r.klant_naam ? `Klant: ${escapeHtml(r.klant_naam)} · ` : ''}${r.kenteken ? `Voertuig: ${escapeHtml(r.kenteken)}` : 'Geen voertuig toegewezen'}</div>
        ${r.opmerkingen ? `<div class="rit-meta">Opmerking: ${escapeHtml(r.opmerkingen)}</div>` : ''}
        ${
          volgendeStatus
            ? `<form method="post" action="/chauffeur/ritten/${r.id}/status" data-status-form class="inline-form" style="margin-top:0.6rem;">
                 <input type="hidden" name="status" value="${volgendeStatus}">
                 <button type="submit" class="knop knop-primair knop-klein">${volgendeLabel}</button>
               </form>`
            : ''
        }
      </div>`;
        })
        .join('')
    : `<div class="leeg">Geen losse ritten gepland.</div>`;

  return `
<div class="pagehead"><div><h1>Ritopdrachten</h1><p>Jouw geplande en lopende ritten</p></div></div>
${ritKaarten}`;
}

// ---- Chauffeur: Meldingen (incident/schade melden) ----
export function pagChauffeurMeldingen({ incidenten = [] }) {
  const rijen = incidenten.length
    ? incidenten
        .map(
          (i) => `<div class="rit-kaart">
        <div class="rit-meta">${formatDatumTijd(i.aangemaakt_op)} · <span class="badge badge-${i.status === 'opgelost' ? 'afgerond' : 'gepland'}">${i.status === 'opgelost' ? 'Opgelost' : 'Open'}</span></div>
        <div class="rit-adressen">${escapeHtml(i.omschrijving)}</div>
      </div>`
        )
        .join('')
    : `<div class="leeg">Nog geen incidenten of schade gemeld.</div>`;

  return `
<h1>Meldingen</h1>
<p class="sectie-sub" style="color:var(--kleur-subtekst);margin:0 0 0.75rem;">Meld hier een incident of schade — bijvoorbeeld aan het voertuig — dat niet bij één specifieke taak hoort.</p>
<div class="kaart">
  <form method="post" action="/chauffeur/meldingen/nieuw" enctype="multipart/form-data" class="form" style="max-width:480px;">
    <label>Omschrijving
      <textarea name="omschrijving" required></textarea>
    </label>
    <label>Foto (optioneel)
      <input type="file" name="foto" accept="image/*" capture="environment">
    </label>
    <div class="knoppenrij">
      <button type="submit" class="knop knop-primair">Melden</button>
    </div>
  </form>
</div>
<h2>Eerder gemeld</h2>
${rijen}`;
}

// ---- Chauffeur: eigen weekoverzicht (dezelfde dag-kaartjes als het
// beheerdersoverzicht, maar gefilterd op de eigen gereden dagen en zonder
// facturatiebedragen - die zijn alleen relevant voor de beheerder). ----
export function pagChauffeurWeekoverzicht({ dagen = [], totaalUren = 0, totaalKm = 0, van, tot }) {
  return `
<h1>Weekoverzicht</h1>
<div class="kaart">
  <form method="get" action="/chauffeur/weekoverzicht" class="form-rij" style="max-width:none;align-items:flex-end;">
    <label>Van
      <input type="date" name="van" value="${escapeHtml(van)}">
    </label>
    <label>Tot en met
      <input type="date" name="tot" value="${escapeHtml(tot)}">
    </label>
    <button type="submit" class="knop">Weergeven</button>
  </form>
</div>
<div class="kaart">
  <h2 style="margin-top:0;">Totaal deze periode</h2>
  <p style="margin:0;font-size:1.3rem;font-weight:700;color:var(--kleur-primair);">${formatUren(totaalUren)} · ${formatKm(totaalKm)}</p>
</div>
${weekoverzichtDagKaartenHtml(dagen)}`;
}

// ---- Urenregistratie: gedeelde weergave van één werkdag (stops-lijst +
// totalen), gebruikt voor zowel het live "vandaag"-blok als een losse
// dag-detailpagina (historie/correctie, chauffeur én planner). ----

// Vrij invulbare activiteit per stop (laden/lossen/pauze/tanken/koppelen/...):
// een tekstveld met klikbare suggesties, geen vaste keuzelijst. "pauze"
// (exact dat woord, hoofdletterongevoelig) telt mee in de urenberekening.
const ACTIVITEIT_SUGGESTIES = ['Laden', 'Lossen', 'Pauze', 'Tanken', 'Koppelen', 'Ontkoppelen', 'Wachten', 'Overig'];

function activiteitDatalistHtml() {
  return `<datalist id="activiteiten-lijst">${ACTIVITEIT_SUGGESTIES.map((a) => `<option value="${escapeHtml(a)}">`).join('')}</datalist>`;
}

// Genummerd START → stops → EIND-overzicht van één opdracht: alleen-lezen
// weergave, gebruikt zowel tijdens een lopende opdracht (dan ontbreekt de
// EIND-regel nog) als voor al afgesloten opdrachten (eerder vandaag of een
// historische dag). Geeft in één oogopslag weer waar en wanneer de dag/
// opdracht begon, welke stops daartussen zijn gemaakt, en waar/wanneer hij
// eindigde - in plaats van dat een toegevoegde stop ergens onopvallend
// tussen andere elementen verdwijnt.
function dagOverzichtRegelHtml(type, marker, titel, regel, extra = '') {
  return `<div class="dagoverzicht-item">
    <div class="dagoverzicht-marker dagoverzicht-marker-${type}">${marker}</div>
    <div class="dagoverzicht-inhoud">
      <div class="dagoverzicht-titel">${titel}</div>
      <div class="rit-meta">${regel}</div>
      ${extra}
    </div>
  </div>`;
}

// Kleine inline-correctie voor één stop (alleen zichtbaar/bruikbaar als de
// dag bewerkbaar is en van vandaag - zie stopBijwerkenMatch in server.js).
// Native <details> i.p.v. JS: kost niets, werkt overal.
function stopBewerkenToggleHtml(d, actiePrefix) {
  return `<details class="stop-bewerken">
    <summary>Wijzigen</summary>
    <form method="post" action="${actiePrefix}/stop/${d.id}/bijwerken" class="form-rij" style="margin-top:0.4rem;align-items:flex-end;flex-wrap:wrap;">
      <label>Plaats
        <input type="text" name="plaats" value="${escapeHtml(d.plaats || '')}">
      </label>
      <label>Activiteit
        <input type="text" name="activiteit" list="activiteiten-lijst" value="${escapeHtml(d.activiteit || '')}">
      </label>
      <label>Aankomst
        <input type="time" name="tijd_aankomst" value="${escapeHtml(d.tijd_aankomst || '')}">
      </label>
      <label>Vertrek
        <input type="time" name="tijd_vertrek" value="${escapeHtml(d.tijd_vertrek || '')}">
      </label>
      <label>Km-stand
        <input type="number" step="1" min="0" name="km_stand" value="${d.km_stand != null ? d.km_stand : ''}">
      </label>
      <button type="submit" class="knop knop-klein">Opslaan</button>
    </form>
  </details>`;
}

function dagOverzichtHtml(opdracht, dagregels = [], { bewerkbaar = false, actiePrefix = '' } = {}) {
  const startRegel = `${escapeHtml(opdracht.start_plaats || '—')} · ${escapeHtml(opdracht.start_tijd || '—')}${
    opdracht.start_km != null ? ' · ' + opdracht.start_km + ' km' : ''
  }`;
  const items = [dagOverzichtRegelHtml('start', '🏁', 'Start', startRegel)];
  dagregels.forEach((d, i) => {
    const regel = `${escapeHtml(d.activiteit || 'Doorgereden')} · aankomst ${escapeHtml(d.tijd_aankomst || '—')} · vertrek ${escapeHtml(d.tijd_vertrek || 'bezig')}${d.km_stand != null ? ' · ' + d.km_stand + ' km' : ''}`;
    items.push(
      dagOverzichtRegelHtml('stop', String(i + 1), escapeHtml(d.plaats || '—'), regel, bewerkbaar ? stopBewerkenToggleHtml(d, actiePrefix) : '')
    );
  });
  if (opdracht.status === 'afgerond') {
    const eindRegel = `${escapeHtml(opdracht.eind_plaats || '—')} · ${escapeHtml(opdracht.eind_tijd || '—')}${
      opdracht.eind_km != null ? ' · ' + opdracht.eind_km + ' km' : ''
    }`;
    items.push(dagOverzichtRegelHtml('eind', '🏁', 'Eind', eindRegel));
  }
  return `<div class="dagoverzicht">${items.join('')}</div>`;
}

// Bewerkbare stopregel: géén eigen <form> - dit is één rij binnen het grote
// dagformulier hieronder. "Verwijderen" haalt de rij client-side weg (zie
// app.js); pas het opslaan van het hele formulier maakt het definitief. Elke
// stop draagt via een verborgen veld bij tot welk opdracht-blok (0-gebaseerd)
// hij hoort, zodat één plat formulier meerdere opdrachten met elk hun eigen
// stops kan opslaan.
function stopRijHtml(d = {}, volgnummer = '', opdrachtIndex = 0) {
  return `<div class="kaart stop-rij" style="margin-bottom:0.6rem;padding:0.75rem;">
    <input type="hidden" name="stop_opdracht_index" value="${opdrachtIndex}" class="stop-opdracht-index">
    <div class="stop-koptekst" style="font-weight:600;color:var(--kleur-primair);margin-bottom:0.5rem;">Stop <span class="stop-volgnummer">${volgnummer}</span></div>
    <div class="form-rij" style="align-items:flex-end;">
      <label>Locatie
        <input type="text" name="stop_plaats" value="${escapeHtml(d.plaats || '')}" placeholder="Waar?">
      </label>
      <label>Activiteit
        <input type="text" name="stop_activiteit" list="activiteiten-lijst" value="${escapeHtml(d.activiteit || '')}" placeholder="Laden, pauze, tanken...">
      </label>
      <label>Aankomsttijd
        <input type="time" name="stop_aankomst" value="${escapeHtml(d.tijd_aankomst || '')}">
      </label>
      <label>Vertrektijd
        <input type="time" name="stop_vertrek" value="${escapeHtml(d.tijd_vertrek || '')}">
      </label>
      <label>Km-stand
        <input type="number" step="1" min="0" name="stop_km" value="${d.km_stand != null ? d.km_stand : ''}">
      </label>
      <button type="button" class="knop knop-klein knop-gevaar stop-verwijderen-knop">Verwijderen</button>
    </div>
  </div>`;
}

// opdrachtIndex bepaalt welk opdracht-blok deze stops-lijst bijhoudt (zie
// stopRijHtml hierboven). Klassen i.p.v. id's, want er kan meer dan één
// stops-lijst op de pagina staan (één per opdracht-blok).
function stopsEditorHtml(dagregels, opdrachtIndex = 0) {
  const rijen = dagregels.map((d, i) => stopRijHtml(d, i + 1, opdrachtIndex)).join('');
  return `
    <div class="stops-lijst">${rijen}</div>
    <button type="button" class="knop knop-klein stop-toevoegen-knop">+ Stop toevoegen</button>
    <template class="stop-rij-sjabloon">${stopRijHtml({}, '', opdrachtIndex)}</template>`;
}

// Eén opdracht-blok binnen het grote dagformulier: opdrachtgever/tarief,
// begin, stops en eind voor één opdrachtgever-segment van de dag. Meerdere
// van deze blokken samen vormen de hele dag (zie opdrachtenEditorHtml).
function opdrachtBlokHtml(opdracht = {}, index = 0, { klanten = [], tariefafspraken = [], magTariefZien } = {}) {
  const dagregels = opdracht.dagregels || [];
  return `<div class="kaart opdracht-blok" style="margin-bottom:1rem;padding:1rem;">
    <input type="hidden" name="opdracht_id" value="${escapeHtml(opdracht.id || '')}" class="opdracht-id-veld">
    <div class="stop-koptekst" style="font-weight:600;color:var(--kleur-primair);margin-bottom:0.5rem;">Opdracht <span class="opdracht-volgnummer">${index + 1}</span></div>
    <div class="form-rij">
      <label>Opdrachtgever
        <select name="opdracht_klant_id">
          <option value="">— Geen —</option>
          ${klanten.map((k) => optie(k.id, k.naam, opdracht.klant_id || '')).join('')}
        </select>
      </label>
      ${
        magTariefZien
          ? `<label>Tariefafspraak
        <select name="opdracht_tariefafspraak_id">
          <option value="">— Geen —</option>
          ${tariefafspraken.map((t) => optie(t.id, t.naam, opdracht.tariefafspraak_id || '')).join('')}
        </select>
      </label>`
          : ''
      }
    </div>

    <h3>Begin van de opdracht</h3>
    <div class="form-rij">
      <label>Begintijd
        <input type="time" name="opdracht_start_tijd" value="${escapeHtml(opdracht.start_tijd || '')}">
      </label>
      <label>Beginplaats
        <input type="text" name="opdracht_start_plaats" value="${escapeHtml(opdracht.start_plaats || '')}">
      </label>
      <label>Beginkilometerstand
        <input type="number" step="1" name="opdracht_start_km" value="${opdracht.start_km != null ? opdracht.start_km : ''}">
      </label>
    </div>

    <h3>Stops onderweg</h3>
    ${stopsEditorHtml(dagregels, index)}

    <h3>Einde van de opdracht</h3>
    <div class="form-rij">
      <label>Eindtijd
        <input type="time" name="opdracht_eind_tijd" value="${escapeHtml(opdracht.eind_tijd || '')}">
      </label>
      <label>Eindplaats
        <input type="text" name="opdracht_eind_plaats" value="${escapeHtml(opdracht.eind_plaats || '')}">
      </label>
      <label>Eindkilometerstand
        <input type="number" step="1" name="opdracht_eind_km" value="${opdracht.eind_km != null ? opdracht.eind_km : ''}">
      </label>
    </div>

    <div class="knoppenrij" style="margin-top:0.5rem;">
      <button type="button" class="knop knop-klein knop-gevaar opdracht-verwijderen-knop">Deze opdracht verwijderen</button>
    </div>
  </div>`;
}

// Alle opdracht-blokken van de dag samen, plus een knop om er nog één toe te
// voegen. Als er nog geen enkele opdracht is (nieuwe dag), begint het
// formulier met precies één leeg blok.
function opdrachtenEditorHtml(opdrachten = [], { klanten = [], tariefafspraken = [], magTariefZien } = {}) {
  const lijst = opdrachten.length ? opdrachten : [{}];
  const blokken = lijst.map((o, i) => opdrachtBlokHtml(o, i, { klanten, tariefafspraken, magTariefZien })).join('');
  return `
    <div class="opdrachten-lijst">${blokken}</div>
    <button type="button" class="knop opdracht-toevoegen-knop">+ Opdracht toevoegen</button>
    <template class="opdracht-blok-sjabloon">${opdrachtBlokHtml({}, 0, { klanten, tariefafspraken, magTariefZien })}</template>
    ${activiteitDatalistHtml()}`;
}

// Eén doorlopend formulier voor een complete dag: alle opdracht-blokken
// (elk met begin, stops en eind) na elkaar, plus het brandstofverbruik van
// de hele dag. Wordt gebruikt om zowel een nieuwe dag in één keer in te
// voeren ("Dag toevoegen") als een al bestaande dag (vandaag afgerond, of
// een historische dag) te corrigeren.
function volledigeDagFormHtml({ werkdag, opdrachten = [], klanten = [], tariefafspraken = [], magTariefZien, actiePrefix, isNieuw, toonDatum }) {
  const actie = isNieuw ? `${actiePrefix}/nieuw` : `${actiePrefix}/bijwerken`;
  return `
  <form method="post" action="${actie}" class="form">
    ${
      toonDatum
        ? `<label>Datum
      <input type="date" name="datum" required>
    </label>`
        : ''
    }

    ${opdrachtenEditorHtml(opdrachten, { klanten, tariefafspraken, magTariefZien })}

    <h3>Brandstofverbruik</h3>
    <div class="form-rij">
      <label>Liters verbruikt (hele dag)
        <input type="number" step="0.1" min="0" name="liters_verbruikt" value="${werkdag && werkdag.liters_verbruikt != null ? werkdag.liters_verbruikt : ''}">
      </label>
    </div>

    <h3>Ritnummer &amp; bijzonderheden</h3>
    <div class="form-rij">
      <label>Ritnummer (optioneel)
        <input type="text" name="ritnummer" value="${escapeHtml((werkdag && werkdag.ritnummer) || '')}">
      </label>
      <label style="flex:1;">Opmerkingen (optioneel)
        <input type="text" name="opmerkingen" value="${escapeHtml((werkdag && werkdag.opmerkingen) || '')}">
      </label>
    </div>

    <div class="knoppenrij" style="margin-top:1rem;">
      <button type="submit" class="knop knop-primair">${isNieuw ? 'Dag opslaan' : 'Wijzigingen opslaan'}</button>
      ${!isNieuw ? `<button type="submit" formaction="${actiePrefix}/verwijderen" class="knop knop-gevaar" onclick="return confirm('Deze hele dag verwijderen?')">Dag verwijderen</button>` : ''}
    </div>
  </form>`;
}

// Alleen-lezen weergave van een afgeronde opdracht (gebruikt in het live
// "vandaag"-blok voor al afgesloten opdrachten eerder op de dag).
function opdrachtSamenvattingHtml(opdracht, { bewerkbaar = false, actiePrefix = '' } = {}) {
  const totalen = opdracht.totalen || { kmTotaal: null, nettoMinuten: 0, pauzeMinuten: 0 };
  const regel = `${opdracht.start_tijd || '—'}–${opdracht.eind_tijd || '—'} · ${totalen.kmTotaal != null ? totalen.kmTotaal + ' km' : '—'} · ${formatMinuten(totalen.nettoMinuten)} netto`;
  const dagregels = opdracht.dagregels || [];
  return `<div class="rit-kaart">
    <div class="rit-meta"><strong>${escapeHtml(opdracht.klant_naam || 'Geen opdrachtgever')}</strong> · ${regel}</div>
    ${dagOverzichtHtml(opdracht, dagregels, { bewerkbaar, actiePrefix })}
  </div>`;
}

// werkdag mag null zijn (nog geen dag gestart/aangemaakt).
function werkdagBlokHtml(werkdag, opdrachten, totalen, opties) {
  const { vandaag, bewerkbaar, magTariefZien, klanten = [], tariefafspraken = [], standaardBeginplaats = null, actiePrefix, isNieuw, opgeslagen } = opties;

  if (!werkdag) {
    // Alleen relevant voor het live "vandaag"-blok: nog geen dag gestart.
    return `
    <h2 style="margin-top:0;">Nieuwe dag beginnen</h2>
    <form method="post" action="${actiePrefix}/dag/starten" class="form">
      <label>Beginplaats
        <input type="text" name="start_plaats" value="${escapeHtml(standaardBeginplaats || '')}" placeholder="Waar begin je?">
      </label>
      <label>Kilometerstand bij vertrek
        <input type="number" step="1" min="0" name="start_km" required>
      </label>
      <label>Opdrachtgever (optioneel als er een route is toegewezen)
        <select name="klant_id">
          <option value="">— Kies opdrachtgever —</option>
          ${klanten.map((k) => optie(k.id, k.naam, '')).join('')}
        </select>
      </label>
      <div class="knoppenrij">
        <button type="submit" class="knop knop-primair">Nieuwe dag beginnen</button>
      </div>
    </form>`;
  }

  const live = vandaag && werkdag.status === 'bezig';

  const kop = vandaag
    ? werkdag.status === 'bezig'
      ? `Dag bezig sinds ${escapeHtml(werkdag.start_tijd || '')}`
      : `Dag afgerond`
    : formatDatum(werkdag.datum);

  const opdrachtgevers = [...new Set((opdrachten || []).map((o) => o.klant_naam).filter(Boolean))].join(', ');
  const totalenRegel = `Km: ${totalen.kmTotaal != null ? totalen.kmTotaal + ' km' : '—'} · Diensttijd: ${formatMinuten(totalen.diensttijdMinuten)} · Netto gewerkt: ${formatMinuten(totalen.nettoMinuten)}${totalen.pauzeMinuten ? ` (${formatMinuten(totalen.pauzeMinuten)} pauze)` : ''}${totalen.literPerKm != null ? ` · ${totalen.literPerKm} km/liter` : ''}`;

  const opgeslagenMelding = opgeslagen ? `<div class="melding melding-succes">Opgeslagen.</div>` : '';

  if (live) {
    const openOpdracht = opdrachten.find((o) => o.status === 'bezig') || null;
    const afgeslotenOpdrachten = opdrachten.filter((o) => o.status !== 'bezig');
    const afgeslotenHtml = afgeslotenOpdrachten.length
      ? `<h3>Eerder vandaag</h3>${afgeslotenOpdrachten.map((o) => opdrachtSamenvattingHtml(o, { bewerkbaar, actiePrefix })).join('')}`
      : '';

    let huidigeOpdrachtHtml = '';
    if (openOpdracht) {
      const dagregels = openOpdracht.dagregels || [];
      const openRegel = dagregels.find((d) => !d.tijd_vertrek) || null;
      const stopsHtml = dagOverzichtHtml(openOpdracht, dagregels, { bewerkbaar, actiePrefix });

      // Geen permanent invoerformulier meer: aankomst vraagt kort de
      // gegevens van de nieuwe stop, vertrek is één druk op de knop (de
      // tijd wordt automatisch vastgelegd op het moment van indienen).
      const aankomstVertrekForm = bewerkbaar
        ? openRegel
          ? `<form method="post" action="${actiePrefix}/stop/vertrek" class="knoppenrij" style="margin:0.75rem 0;">
              <button type="submit" class="knop knop-primair">Vertrek</button>
            </form>`
          : `<form method="post" action="${actiePrefix}/stop/aankomst" class="form-rij" style="margin:0.75rem 0;align-items:flex-end;">
              <label>Plaats
                <input type="text" name="plaats" placeholder="Waar ben je nu?">
              </label>
              <label>Activiteit
                <input type="text" name="activiteit" list="activiteiten-lijst" placeholder="Laden, pauze, tanken...">
              </label>
              <label>Km-stand
                <input type="number" step="1" min="0" name="km_stand">
              </label>
              <button type="submit" class="knop knop-primair">Aankomst</button>
            </form>`
        : '';

      const afsluitenForm = bewerkbaar
        ? `<form method="post" action="${actiePrefix}/opdracht/afsluiten" class="form" style="margin-top:1rem;" onsubmit="return confirm('Deze opdracht afsluiten?')">
            <div class="form-rij" style="align-items:flex-end;">
              <label>Eindplaats
                <input type="text" name="eind_plaats" placeholder="Waar sluit je deze opdracht af?">
              </label>
              <label>Kilometerstand bij einde
                <input type="number" step="1" min="${openOpdracht.start_km || 0}" name="eind_km" required>
              </label>
            </div>
            <div class="knoppenrij" style="margin-top:0.75rem;">
              <button type="submit" class="knop knop-primair">Opdracht afsluiten</button>
            </div>
          </form>`
        : '';

      huidigeOpdrachtHtml = `
      <h3>Nu bezig: ${escapeHtml(openOpdracht.klant_naam || 'Geen opdrachtgever')}</h3>
      ${activiteitDatalistHtml()}
      ${stopsHtml}
      ${aankomstVertrekForm}
      ${afsluitenForm}`;
    } else if (bewerkbaar) {
      // Geen opdracht meer open: kies verder met een nieuwe opdrachtgever, of
      // rond de hele dag af.
      huidigeOpdrachtHtml = `
      <div class="form-rij" style="align-items:flex-start;flex-wrap:wrap;">
        <form method="post" action="${actiePrefix}/opdracht/toevoegen" class="form-rij" style="align-items:flex-end;margin:0;">
          <label>Nieuwe opdrachtgever
            <select name="klant_id">
              <option value="">— Kies opdrachtgever —</option>
              ${klanten.map((k) => optie(k.id, k.naam, '')).join('')}
            </select>
          </label>
          <label>Beginplaats
            <input type="text" name="start_plaats">
          </label>
          <label>Beginkilometerstand
            <input type="number" step="1" min="0" name="start_km" required>
          </label>
          <button type="submit" class="knop">+ Opdracht toevoegen</button>
        </form>
        <form method="post" action="${actiePrefix}/dag/afsluiten" class="form-rij" style="align-items:flex-end;margin:0;" onsubmit="return confirm('Dag afsluiten?')">
          <label>Brandstof verbruikt (liters, hele dag)
            <input type="number" step="0.1" min="0" name="liters_verbruikt">
          </label>
          <button type="submit" class="knop knop-primair">Dag afsluiten</button>
        </form>
      </div>`;
    }

    const ritnummerForm = bewerkbaar
      ? `<details class="stop-bewerken" style="margin-top:1rem;">
          <summary>Ritnummer / bijzonderheden</summary>
          <form method="post" action="${actiePrefix}/ritnummer" class="form-rij" style="margin-top:0.5rem;align-items:flex-end;">
            <label>Ritnummer (optioneel)
              <input type="text" name="ritnummer" value="${escapeHtml(werkdag.ritnummer || '')}">
            </label>
            <label style="flex:1;">Opmerkingen (optioneel)
              <input type="text" name="opmerkingen" value="${escapeHtml(werkdag.opmerkingen || '')}">
            </label>
            <button type="submit" class="knop knop-klein">Opslaan</button>
          </form>
        </details>`
      : '';

    return `
    <h2 style="margin-top:0;">${kop}</h2>
    <div class="rit-meta">${opdrachtgevers ? 'Opdrachtgever(s): ' + escapeHtml(opdrachtgevers) + ' · ' : ''}${totalenRegel}</div>
    ${opgeslagenMelding}
    ${huidigeOpdrachtHtml}
    ${afgeslotenHtml}
    ${ritnummerForm}`;
  }

  // Dag is niet (meer) live - vandaag maar afgerond, of een historische dag:
  // één doorlopend formulier met alle opdracht-blokken samen.
  return `
  <h2 style="margin-top:0;">${kop}</h2>
  <div class="rit-meta">${opdrachtgevers ? 'Opdrachtgever(s): ' + escapeHtml(opdrachtgevers) + ' · ' : ''}${totalenRegel}</div>
  ${opgeslagenMelding}
  ${
    bewerkbaar
      ? volledigeDagFormHtml({ werkdag, opdrachten, klanten, tariefafspraken, magTariefZien, actiePrefix, isNieuw: false, toonDatum: false })
      : opdrachten.map((o) => opdrachtSamenvattingHtml(o)).join('')
  }`;
}

// ---- Urenregistratie: hoofdpagina (vandaag + 2 weken historie) ----
export function pagUrenregistratie({
  vandaagWerkdag,
  vandaagOpdrachten = [],
  vandaagTotalen = { kmTotaal: null, diensttijdMinuten: 0, nettoMinuten: 0, pauzeMinuten: 0 },
  historie = [],
  klanten = [],
  standaardBeginplaats = null,
  actiePrefix = '/chauffeur/uren',
  fout,
  opgeslagen,
}) {
  const historieHtml = historie.length
    ? historie
        .map(
          ({ werkdag, kmTotaal, nettoMinuten }) => `<div class="rit-kaart">
        <div class="rit-meta">${formatDatum(werkdag.datum)}${werkdag.klant_naam ? ' · ' + escapeHtml(werkdag.klant_naam) : ''}</div>
        <div class="rit-meta">${kmTotaal != null ? kmTotaal + ' km' : '—'} · ${formatMinuten(nettoMinuten)} netto gewerkt</div>
        <div class="knoppenrij" style="margin-top:0.4rem;"><a href="${actiePrefix}/${werkdag.id}" class="knop knop-klein">Bekijken/corrigeren</a></div>
      </div>`
        )
        .join('')
    : `<div class="leeg">Geen dagen in de afgelopen 2 weken.</div>`;

  return `
<h1>Urenregistratie</h1>
${fout ? `<div class="melding melding-fout">${escapeHtml(fout)}</div>` : ''}
<div class="kaart">
  ${werkdagBlokHtml(vandaagWerkdag, vandaagOpdrachten, vandaagTotalen, {
    vandaag: true,
    bewerkbaar: true,
    magTariefZien: false,
    klanten,
    standaardBeginplaats,
    actiePrefix,
    opgeslagen,
  })}
</div>
<h2>Laatste 2 weken</h2>
<div class="knoppenrij" style="margin-bottom:0.75rem;"><a href="${actiePrefix}/nieuw" class="knop">+ Dag toevoegen</a></div>
${historieHtml}`;
}

// ---- Urenregistratie: detailpagina van één (historische) dag ----
export function pagWerkdagDetail({
  werkdag,
  opdrachten = [],
  totalen = { kmTotaal: null, diensttijdMinuten: 0, nettoMinuten: 0, pauzeMinuten: 0 },
  klanten = [],
  tariefafspraken = [],
  magTariefZien = false,
  actiePrefix,
  terugUrl,
  isNieuw = false,
  opgeslagen,
}) {
  return `
<div class="paginakop">
  <h1>${werkdag ? formatDatum(werkdag.datum) : 'Nieuwe dag'}</h1>
  <a href="${terugUrl}" class="knop">← Terug</a>
</div>
<div class="kaart">
  ${werkdagBlokHtml(werkdag, opdrachten, totalen, {
    vandaag: false,
    bewerkbaar: true,
    magTariefZien,
    klanten,
    tariefafspraken,
    actiePrefix,
    isNieuw,
    opgeslagen,
  })}
</div>`;
}

// ---- Dag toevoegen: een complete, al voorbije dag in één keer invoeren -
// zelfde opzet (begin, stops, einde) als het corrigeren van een bestaande
// dag, met daarboven alleen nog een datumveld. ----
export function pagWerkdagNieuw({ klanten = [], tariefafspraken = [], magTariefZien = false, actiePrefix, terugUrl, fout }) {
  return `
<div class="paginakop">
  <h1>Dag toevoegen</h1>
  <a href="${terugUrl}" class="knop">← Terug</a>
</div>
${fout ? `<div class="melding melding-fout">${escapeHtml(fout)}</div>` : ''}
<div class="kaart">
  ${volledigeDagFormHtml({
    werkdag: null,
    opdrachten: [],
    klanten,
    tariefafspraken,
    magTariefZien,
    actiePrefix,
    isNieuw: true,
    toonDatum: true,
  })}
</div>`;
}

export function pagTaakDetail({ taak, documenten = [], fout, succes }) {
  const afgerond = taak.status === 'afgerond';
  const documentenHtml = documenten.length
    ? `<div class="rit-meta">Documenten: ${documenten
        .map((d) => `<a href="/bestanden/${encodeURIComponent(d.bestandsnaam)}" target="_blank">${escapeHtml(DOCUMENT_TYPE_LABEL[d.type] || d.type)}</a>`)
        .join(', ')}</div>`
    : '';

  return `
<div class="paginakop">
  <h1>Taak: ${TAAK_TYPE_LABEL[taak.type] || taak.type}</h1>
  <a href="/chauffeur" class="knop">← Terug naar mijn dag</a>
</div>
${fout ? `<div class="melding melding-fout">${escapeHtml(fout)}</div>` : ''}
${succes ? `<div class="melding melding-succes">Opgeslagen.</div>` : ''}
<div class="kaart">
  <div class="rit-adressen">${escapeHtml(taak.adres)}</div>
  <div class="rit-meta">${taak.klant_naam ? 'Opdrachtgever: ' + escapeHtml(taak.klant_naam) + ' · ' : ''}<span class="badge badge-${afgerond ? 'afgerond' : 'gepland'}">${afgerond ? 'Afgerond' : 'Open'}</span></div>
  <div class="rit-meta">${taak.lading_omschrijving ? escapeHtml(taak.lading_omschrijving) + ' · ' : ''}${taak.aantal_pallets ? taak.aantal_pallets + ' pallet(s) · ' : ''}${taak.aantal_colli ? taak.aantal_colli + ' colli · ' : ''}${taak.gewicht_kg ? taak.gewicht_kg + ' kg · ' : ''}${taak.laadmeters ? taak.laadmeters + ' ldm' : ''}</div>
  ${taak.tijdvenster_van || taak.tijdvenster_tot ? `<div class="rit-meta">Tijdvenster: ${escapeHtml(taak.tijdvenster_van || '?')} – ${escapeHtml(taak.tijdvenster_tot || '?')}</div>` : ''}
  ${taak.telefoonnummer || taak.laadnummer ? `<div class="rit-meta">${taak.telefoonnummer ? 'Tel: ' + escapeHtml(taak.telefoonnummer) + ' · ' : ''}${taak.laadnummer ? 'Laadnr: ' + escapeHtml(taak.laadnummer) : ''}</div>` : ''}
  ${taak.extra_info ? `<div class="rit-meta">${escapeHtml(taak.extra_info)}</div>` : ''}
  ${taak.chauffeur_opmerking ? `<div class="rit-meta">Opmerking: ${escapeHtml(taak.chauffeur_opmerking)}</div>` : ''}
  ${documentenHtml}
</div>
${
  afgerond
    ? `<div class="kaart"><p style="margin:0;">Deze taak is afgerond${taak.afgerond_op ? ' op ' + escapeHtml(taak.afgerond_op) : ''}.</p></div>`
    : `
<div class="kaart">
  <h2 style="margin-top:0;">Taak afronden</h2>
  <form method="post" action="/chauffeur/taken/${taak.id}/afronden" enctype="multipart/form-data" class="form" style="max-width:520px;">
    <label>CMR (foto of bestand)
      <input type="file" name="cmr" accept="image/*,.pdf" capture="environment">
    </label>
    <label>Pakbon (foto of bestand)
      <input type="file" name="pakbon" accept="image/*,.pdf" capture="environment">
    </label>
    <label>Foto schade (optioneel)
      <input type="file" name="foto" accept="image/*" capture="environment">
    </label>
    <label>Opmerking
      <textarea name="chauffeur_opmerking"></textarea>
    </label>
    <label>Incident/schade melden (optioneel — verschijnt in het incidentenoverzicht)
      <textarea name="incident_omschrijving" placeholder="Omschrijf wat er is gebeurd..."></textarea>
    </label>
    <label>Handtekening voor ontvangst
      <canvas data-handtekening-canvas width="400" height="150" style="border:1px solid var(--kleur-rand);border-radius:6px;touch-action:none;background:#fff;max-width:100%;"></canvas>
    </label>
    <input type="hidden" name="handtekening_data" value="">
    <button type="button" class="knop knop-klein" data-handtekening-wissen style="align-self:flex-start;">Handtekening wissen</button>
    <div class="knoppenrij" style="margin-top:0.5rem;">
      <button type="submit" class="knop knop-primair">Taak afronden</button>
    </div>
  </form>
</div>`
}`;
}

export function pagTarieven({
  toltarieven,
  tolLandtarieven = [],
  margePercentage,
  kostprijsInstellingen = {},
  kostprijsPerKm = 0,
  kostprijsPerUur = 0,
  fout,
  succes,
  routeBerekeningActief,
  emailNotificatiesActief,
}) {
  const landRijen = tolLandtarieven.length
    ? tolLandtarieven
        .map(
          (t) => `<tr>
      <td>${escapeHtml(t.land)}</td>
      <td>${t.cent_per_km} cent/km</td>
      <td>${t.actief ? 'Actief' : 'Inactief'}</td>
      <td>
        <form method="post" action="/planner/tarieven/tolland/${t.id}/verwijderen" class="inline-form" onsubmit="return confirm('Toltarief verwijderen?')">
          <button type="submit" class="knop knop-klein knop-gevaar">Verwijderen</button>
        </form>
      </td>
    </tr>`
        )
        .join('')
    : `<tr><td colspan="4" class="leeg">Nog geen toltarieven per land toegevoegd.</td></tr>`;

  const rijen = toltarieven.length
    ? toltarieven
        .map(
          (t) => `<tr>
      <td>${escapeHtml(t.omschrijving)}</td>
      <td>${formatEuro(t.bedrag)}</td>
      <td>${t.actief ? 'Actief' : 'Inactief'}</td>
      <td>
        <form method="post" action="/planner/tarieven/tol/${t.id}/verwijderen" class="inline-form" onsubmit="return confirm('Toltarief verwijderen?')">
          <button type="submit" class="knop knop-klein knop-gevaar">Verwijderen</button>
        </form>
      </td>
    </tr>`
        )
        .join('')
    : `<tr><td colspan="4" class="leeg">Nog geen toltarieven toegevoegd.</td></tr>`;

  return `
<h1>Tarieven</h1>
${fout ? `<div class="melding melding-fout">${escapeHtml(fout)}</div>` : ''}
${succes ? `<div class="melding melding-succes">Opgeslagen.</div>` : ''}

<h2 style="margin-top:0;">Kostprijs &amp; nacalculatie</h2>
<p class="sectie-sub" style="color:var(--kleur-subtekst);margin:0 0 0.75rem;">Wat een gereden kilometer en een gewerkt uur je écht kosten. De app gebruikt dit om automatisch per dag en per opdrachtgever te berekenen wat een rit werkelijk oplevert (in de urenregistratie en het weekoverzicht) — ook als je voor een ander transportbedrijf rijdt.</p>
<div class="kaart">
  <form method="post" action="/planner/tarieven/kostprijs">
    <p class="rit-meta" style="margin:0 0 0.5rem;font-weight:600;">Per kilometer</p>
    <div class="form-rij">
      <label>Brandstof (€/km)
        <input type="number" step="0.001" min="0" name="brandstof_per_km" value="${kostprijsInstellingen.brandstof_per_km ?? 0}">
      </label>
      <label>Bandenslijtage (€/km)
        <input type="number" step="0.001" min="0" name="banden_per_km" value="${kostprijsInstellingen.banden_per_km ?? 0}">
      </label>
      <label>Onderhoud/reparatie (€/km)
        <input type="number" step="0.001" min="0" name="onderhoud_per_km" value="${kostprijsInstellingen.onderhoud_per_km ?? 0}">
      </label>
      <label>Afschrijving (€/km)
        <input type="number" step="0.001" min="0" name="afschrijving_per_km" value="${kostprijsInstellingen.afschrijving_per_km ?? 0}">
      </label>
    </div>
    <p class="rit-meta" style="margin:0.75rem 0 0.5rem;font-weight:600;">Per uur / vaste lasten</p>
    <div class="form-rij">
      <label>Eigen uurloon (€/uur)
        <input type="number" step="0.01" min="0" name="uurloon" value="${kostprijsInstellingen.uurloon ?? 0}">
      </label>
      <label>Verzekering (€/maand)
        <input type="number" step="0.01" min="0" name="verzekering_per_maand" value="${kostprijsInstellingen.verzekering_per_maand ?? 0}">
      </label>
      <label>Wegenbelasting (€/maand)
        <input type="number" step="0.01" min="0" name="wegenbelasting_per_maand" value="${kostprijsInstellingen.wegenbelasting_per_maand ?? 0}">
      </label>
      <label>Overige vaste kosten (€/maand)
        <input type="number" step="0.01" min="0" name="overige_kosten_per_maand" value="${kostprijsInstellingen.overige_kosten_per_maand ?? 0}">
      </label>
      <label>Verwachte werkuren per maand
        <input type="number" step="1" min="1" name="verwachte_uren_per_maand" value="${kostprijsInstellingen.verwachte_uren_per_maand ?? 160}">
      </label>
    </div>
    <div class="knoppenrij" style="margin-top:0.75rem;">
      <button type="submit" class="knop knop-primair">Opslaan</button>
    </div>
  </form>
  <p class="rit-meta" style="margin:0.75rem 0 0;">Huidige kostprijs: <strong>${formatEuro(kostprijsPerKm)}</strong> per km en <strong>${formatEuro(kostprijsPerUur)}</strong> per uur.</p>
</div>

<h2>Standaard marge</h2>
<p class="sectie-sub" style="color:var(--kleur-subtekst);margin:0 0 0.75rem;">Wordt gebruikt om bij het inplannen van een rit een voorstel-klantprijs te berekenen (kostprijs + marge). Je kunt de prijs per rit altijd zelf aanpassen.</p>
<div class="kaart">
  <form method="post" action="/planner/tarieven/marge" class="form-rij" style="align-items:flex-end;">
    <label>Marge (%)
      <input type="number" step="0.1" min="0" name="marge_percentage" value="${margePercentage}">
    </label>
    <button type="submit" class="knop knop-primair">Opslaan</button>
  </form>
</div>

<h2>Toltarieven per land</h2>
<p class="sectie-sub" style="color:var(--kleur-subtekst);margin:0 0 0.75rem;">Stel per land een tarief in centen per km in. Dit tarief wordt gebruikt bij de prijscalculator om de tolkosten van een rit te berekenen.</p>
<div class="kaart">
  <form method="post" action="/planner/tarieven/tolland/nieuw" class="form-rij" style="align-items:flex-end;">
    <label>Land
      <input type="text" name="land" required placeholder="Bijv. Duitsland">
    </label>
    <label>Cent per km
      <input type="number" step="0.1" min="0" name="cent_per_km" required placeholder="Bijv. 21,8">
    </label>
    <button type="submit" class="knop knop-primair">Toevoegen</button>
  </form>
</div>
<div class="kaart tabel-wrap">
  <table>
    <thead><tr><th>Land</th><th>Tarief</th><th>Status</th><th></th></tr></thead>
    <tbody>${landRijen}</tbody>
  </table>
</div>

<h2>Toltarieven (vast bedrag, voor de prijscalculator)</h2>
<p class="sectie-sub" style="color:var(--kleur-subtekst);margin:0 0 0.75rem;">Leg vaste tolbedragen vast (bijv. per traject). Bij het maken van een prijscalculatie vink je aan welke van toepassing zijn — de app telt ze automatisch mee in de kostprijs.</p>
<div class="kaart">
  <form method="post" action="/planner/tarieven/tol/nieuw" class="form-rij" style="align-items:flex-end;">
    <label>Omschrijving
      <input type="text" name="omschrijving" required placeholder="Bijv. Duitsland - Maut A1">
    </label>
    <label>Bedrag (€)
      <input type="number" step="0.01" min="0" name="bedrag" required placeholder="Bijv. 35,00">
    </label>
    <button type="submit" class="knop knop-primair">Toevoegen</button>
  </form>
</div>
<div class="kaart tabel-wrap">
  <table>
    <thead><tr><th>Omschrijving</th><th>Bedrag</th><th>Status</th><th></th></tr></thead>
    <tbody>${rijen}</tbody>
  </table>
</div>

<h2>Automatische routeberekening</h2>
<div class="kaart">
  ${
    routeBerekeningActief
      ? `<p style="margin:0;">✓ Actief — bij het inplannen van een rit kan de afstand automatisch berekend worden.</p>`
      : `<p style="margin:0 0 0.5rem;">Nog niet ingesteld. De kilometers per rit vul je nu zelf in, wat prima werkt. Wil je dit automatiseren?</p>
         <p class="rit-meta" style="margin:0;">Maak gratis een account op <strong>openrouteservice.org</strong>, vraag een API-sleutel aan, en zet die als omgevingsvariabele <span class="mono">ORS_API_KEY</span> bij je hosting-omgeving (Portainer → Stacks → transportmanager-app → Environment variables, daarna "Update the stack").</p>`
  }
</div>

<h2>Klant e-mailnotificaties</h2>
<div class="kaart">
  ${
    emailNotificatiesActief
      ? `<p style="margin:0;">✓ Actief — klanten met een e-mailadres krijgen automatisch bericht als hun rit "onderweg" is of is afgeleverd.</p>`
      : `<p style="margin:0 0 0.5rem;">Nog niet ingesteld. Klanten krijgen nu geen automatisch bericht.</p>
         <p class="rit-meta" style="margin:0;">Maak gratis een account op <strong>resend.com</strong>, vraag een API-sleutel aan, en zet die als omgevingsvariabele <span class="mono">RESEND_API_KEY</span> bij je hosting-omgeving (Portainer → Stacks → transportmanager-app → Environment variables, daarna "Update the stack"). Optioneel: <span class="mono">RESEND_AFZENDER</span> voor een eigen afzenderadres.</p>`
  }
</div>`;
}

export function pagFinancieelOverzicht({ ritten, vanDatum, totDatum, totalen }) {
  const rijen = ritten.length
    ? ritten
        .map(
          (r) => `<tr>
      <td>${formatDatum(r.datum)}</td>
      <td>${escapeHtml(r.klant_naam || '—')}</td>
      <td>${escapeHtml(r.ophaal_adres)} → ${escapeHtml(r.aflever_adres)}</td>
      <td>${r.afstand_km != null ? `${r.afstand_km} km` : '—'}</td>
      <td>${formatEuro(r.kostprijs)}</td>
      <td>${r.klantprijs != null ? formatEuro(r.klantprijs) : '—'}</td>
      <td class="${(r.klantprijs || 0) - r.kostprijs >= 0 ? '' : 'melding-fout'}">${r.klantprijs != null ? formatEuro(r.klantprijs - r.kostprijs) : '—'}</td>
      <td>
        <form method="post" action="/planner/ritten/${r.id}/gefactureerd" class="inline-form">
          <button type="submit" class="knop knop-klein${r.gefactureerd ? '' : ' knop-primair'}">${r.gefactureerd ? 'Gefactureerd ✓' : 'Markeer gefactureerd'}</button>
        </form>
      </td>
    </tr>`
        )
        .join('')
    : `<tr><td colspan="8" class="leeg">Geen ritten gevonden voor deze periode.</td></tr>`;

  return `
<div class="paginakop">
  <h1>Financieel overzicht</h1>
</div>
<div class="kaart">
  <form method="get" action="/planner/financieel" class="form-rij" style="max-width:none;align-items:flex-end;">
    <label>Van
      <input type="date" name="van" value="${escapeHtml(vanDatum || '')}">
    </label>
    <label>Tot en met
      <input type="date" name="tot" value="${escapeHtml(totDatum || '')}">
    </label>
    <button type="submit" class="knop">Filteren</button>
    <a href="/planner/financieel" class="knop">Alle ritten</a>
  </form>
</div>
<div class="kaart tabel-wrap">
  <table>
    <thead><tr><th>Datum</th><th>Klant</th><th>Route</th><th>Afstand</th><th>Kostprijs</th><th>Klantprijs</th><th>Marge</th><th>Facturatie</th></tr></thead>
    <tbody>${rijen}</tbody>
    <tfoot>
      <tr style="font-weight:700;">
        <td colspan="4">Totaal (${totalen.aantal} ${totalen.aantal === 1 ? 'rit' : 'ritten'})</td>
        <td>${formatEuro(totalen.kostprijs)}</td>
        <td>${formatEuro(totalen.klantprijs)}</td>
        <td>${formatEuro(totalen.marge)}</td>
        <td></td>
      </tr>
    </tfoot>
  </table>
</div>`;
}

// ==================== Week-uitdraai (factureerbaar) ====================

function formatUren(u) {
  return (Number(u) || 0).toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' u';
}

function formatKm(k) {
  return Math.round(Number(k) || 0) + ' km';
}

// Kaartjes per datum: operationeel overzicht van wat er die dag is gedaan
// (per opdracht: klant, chauffeur, uren, km) - los van de financiële tabel
// hieronder (die blijft bestaan voor de facturatiestatus per opdrachtgever).
// Al voorbereid op meerdere chauffeurs: elke regel toont altijd wie de
// opdracht heeft gereden, ook nu dat nog steeds dezelfde ene chauffeur is.
function weekoverzichtDagKaartenHtml(perDag = []) {
  if (!perDag.length) return `<div class="leeg">Geen afgeronde opdrachten gevonden voor deze periode.</div>`;
  return `<div class="dagkaarten-grid">${perDag
    .map((d) => {
      const opdrachtenHtml = d.opdrachten
        .map(
          (o) => `<div class="dagkaart-opdracht">
        <div>${escapeHtml(o.klant_naam)}</div>
        <div class="rit-meta">${o.chauffeur_naam ? escapeHtml(o.chauffeur_naam) + ' · ' : ''}${formatUren(o.uren)}${o.km != null ? ' · ' + formatKm(o.km) : ''}</div>
      </div>`
        )
        .join('');
      return `<div class="dagkaart">
        <div class="dagkaart-datum">${formatDatum(d.datum)}</div>
        ${opdrachtenHtml}
      </div>`;
    })
    .join('')}</div>`;
}

export function pagWeekUitdraai({ overzicht, perDag = [], van, tot, klanten = [] }) {
  const totaalGeneraal = overzicht.reduce(
    (acc, k) => {
      acc.uren += k.uren;
      acc.km += k.km;
      acc.bedrag += k.bedrag;
      acc.kosten += k.kosten || 0;
      acc.winst += k.winst != null ? k.winst : k.bedrag - (k.kosten || 0);
      return acc;
    },
    { uren: 0, km: 0, bedrag: 0, kosten: 0, winst: 0 }
  );

  const rijen = overzicht.length
    ? overzicht
        .map((k) => {
          const subrijen =
            k.afspraken.length > 1
              ? k.afspraken
                  .map(
                    (a) => `<tr>
      <td style="padding-left:1.5rem;color:var(--kleur-subtekst);">${escapeHtml(a.tarief_naam || 'Geen tariefafspraak')}</td>
      <td>${formatUren(a.uren)}</td>
      <td>${formatKm(a.totaalKm)}</td>
      <td>${a.totaalPallets || a.totaalColli || '—'}</td>
      <td>${formatEuro(a.bedrag)}</td>
      <td></td>
      <td></td>
      <td>${a.aantalGefactureerd >= a.aantalWerkdagen ? 'Gefactureerd' : `${a.aantalGefactureerd}/${a.aantalWerkdagen}`}</td>
    </tr>`
                  )
                  .join('')
              : '';
          const volledigGefactureerd = k.aantalGefactureerd >= k.aantalWerkdagen;
          const winst = k.winst != null ? k.winst : k.bedrag - (k.kosten || 0);
          return `<tr>
      <td><strong>${escapeHtml(k.klant_naam)}</strong></td>
      <td>${formatUren(k.uren)}</td>
      <td>${formatKm(k.km)}</td>
      <td>${k.pallets || k.colli || '—'}</td>
      <td><strong>${formatEuro(k.bedrag)}</strong></td>
      <td>${formatEuro(k.kosten || 0)}</td>
      <td style="color:${winst < 0 ? 'var(--kleur-gevaar, #c0392b)' : 'inherit'};"><strong>${formatEuro(winst)}</strong></td>
      <td>
        ${
          volledigGefactureerd
            ? `<span class="badge badge-afgerond">Gefactureerd</span>`
            : `<form method="post" action="/planner/week-uitdraai/gefactureerd" class="inline-form">
                 <input type="hidden" name="klant_id" value="${escapeHtml(k.klant_id || '')}">
                 <input type="hidden" name="van" value="${escapeHtml(van)}">
                 <input type="hidden" name="tot" value="${escapeHtml(tot)}">
                 <button type="submit" class="knop knop-klein knop-primair">Markeer gefactureerd (${k.aantalGefactureerd}/${k.aantalWerkdagen})</button>
               </form>`
        }
      </td>
    </tr>${subrijen}`;
        })
        .join('')
    : `<tr><td colspan="8" class="leeg">Geen afgeronde werkdagen gevonden voor deze periode.</td></tr>`;

  return `
<div class="paginakop">
  <h1>Weekoverzicht</h1>
  <a href="/planner/week-uitdraai/csv?van=${encodeURIComponent(van)}&tot=${encodeURIComponent(tot)}" class="knop knop-primair">Exporteer als Excel/CSV</a>
</div>
<p class="sectie-sub" style="color:var(--kleur-subtekst);margin:0 0 1rem;">Gebaseerd op afgeronde werkdagen: uren, kilometers en pallets per opdrachtgever, berekend met de gekozen tariefafspraken. Losse ritten met een vaste klantprijs staan al in het <a href="/planner/financieel">financieel overzicht</a>.</p>
<div class="kaart">
  <form method="get" action="/planner/week-uitdraai" class="form-rij" style="max-width:none;align-items:flex-end;">
    <label>Van
      <input type="date" name="van" value="${escapeHtml(van)}">
    </label>
    <label>Tot en met
      <input type="date" name="tot" value="${escapeHtml(tot)}">
    </label>
    <button type="submit" class="knop">Weergeven</button>
  </form>
</div>

<h2>Dagstaat voor een klant</h2>
<p class="sectie-sub" style="color:var(--kleur-subtekst);margin:0 0 0.75rem;">Download een dagstaat (urenlijst met stops) als PDF, om rechtstreeks naar een klant te sturen.</p>
<div class="kaart">
  <form method="get" action="/planner/dagstaat.pdf" class="form-rij" style="max-width:none;align-items:flex-end;">
    <label>Van
      <input type="date" name="van" value="${escapeHtml(van)}" required>
    </label>
    <label>Tot en met
      <input type="date" name="tot" value="${escapeHtml(tot)}" required>
    </label>
    <label>Opdrachtgever
      <select name="klant_id">
        <option value="">— Alle opdrachtgevers —</option>
        ${klanten.map((k) => optie(k.id, k.naam, '')).join('')}
      </select>
    </label>
    <button type="submit" class="knop knop-primair">Dagstaat downloaden (PDF)</button>
  </form>
</div>

<h2>Per dag</h2>
${weekoverzichtDagKaartenHtml(perDag)}
<h2>Per opdrachtgever</h2>
<div class="kaart tabel-wrap">
  <table>
    <thead><tr><th>Opdrachtgever</th><th>Uren</th><th>Km</th><th>Pallets/colli</th><th>Te factureren</th><th>Kosten</th><th>Winst</th><th>Facturatie</th></tr></thead>
    <tbody>${rijen}</tbody>
    <tfoot>
      <tr style="font-weight:700;">
        <td>Totaal</td>
        <td>${formatUren(totaalGeneraal.uren)}</td>
        <td>${formatKm(totaalGeneraal.km)}</td>
        <td></td>
        <td>${formatEuro(totaalGeneraal.bedrag)}</td>
        <td>${formatEuro(totaalGeneraal.kosten)}</td>
        <td style="color:${totaalGeneraal.winst < 0 ? 'var(--kleur-gevaar, #c0392b)' : 'inherit'};">${formatEuro(totaalGeneraal.winst)}</td>
        <td></td>
      </tr>
    </tfoot>
  </table>
</div>`;
}

// ==================== Routes & taken ====================

const TAAK_TYPE_LABEL = { laden: 'Laden', lossen: 'Lossen' };
const DOCUMENT_TYPE_LABEL = { cmr: 'CMR', pakbon: 'Pakbon', foto_schade: 'Foto schade', handtekening: 'Handtekening' };

function taakIsTeLaat(taak) {
  if (taak.status === 'afgerond' || !taak.tijdvenster_tot) return false;
  const nu = new Date();
  const vandaag = nu.toISOString().slice(0, 10);
  // Alleen relevant als de route van vandaag (of eerder) is — anders geen zinvolle vergelijking.
  return `${taak.route_datum}T${taak.tijdvenster_tot}` < `${vandaag}T${nu.toTimeString().slice(0, 5)}` && taak.route_datum <= vandaag;
}

// ==================== Incidentenoverzicht ====================

export function pagIncidenten({ incidenten, statusFilter, fout, succes }) {
  const rijen = incidenten.length
    ? incidenten
        .map((i) => {
          const context = i.taak_adres
            ? `Taak: ${escapeHtml(i.taak_adres)}${i.route_datum ? ' (' + formatDatum(i.route_datum) + ')' : ''}`
            : i.werkdag_datum
              ? `Werkdag ${formatDatum(i.werkdag_datum)}`
              : '—';
          return `<tr>
      <td>${formatDatum(i.aangemaakt_op.slice(0, 10))}</td>
      <td>${escapeHtml(i.chauffeur_naam || '—')}</td>
      <td>${context}</td>
      <td>${escapeHtml(i.omschrijving)}</td>
      <td>${i.foto_bestandsnaam ? `<a href="/bestanden/${encodeURIComponent(i.foto_bestandsnaam)}" target="_blank">Foto</a>` : '—'}</td>
      <td><span class="badge badge-${i.status === 'afgehandeld' ? 'afgerond' : 'onderweg'}">${i.status === 'afgehandeld' ? 'Afgehandeld' : 'Open'}</span></td>
      <td>
        <form method="post" action="/planner/incidenten/${i.id}/status" class="inline-form">
          <input type="hidden" name="status" value="${i.status === 'afgehandeld' ? 'open' : 'afgehandeld'}">
          <button type="submit" class="knop knop-klein">${i.status === 'afgehandeld' ? 'Heropenen' : 'Afhandelen'}</button>
        </form>
      </td>
    </tr>`;
        })
        .join('')
    : `<tr><td colspan="7" class="leeg">Geen incidenten gevonden.</td></tr>`;

  return `
<div class="paginakop">
  <h1>Incidenten</h1>
</div>
${fout ? `<div class="melding melding-fout">${escapeHtml(fout)}</div>` : ''}
${succes ? `<div class="melding melding-succes">Opgeslagen.</div>` : ''}
<div class="kaart">
  <form method="get" action="/planner/incidenten" class="form-rij" style="max-width:none;align-items:flex-end;">
    <label>Status
      <select name="status">
        <option value="">Alle</option>
        <option value="open"${statusFilter === 'open' ? ' selected' : ''}>Open</option>
        <option value="afgehandeld"${statusFilter === 'afgehandeld' ? ' selected' : ''}>Afgehandeld</option>
      </select>
    </label>
    <button type="submit" class="knop">Filteren</button>
  </form>
</div>
<div class="kaart tabel-wrap">
  <table>
    <thead><tr><th>Datum</th><th>Chauffeur</th><th>Context</th><th>Omschrijving</th><th>Foto</th><th>Status</th><th></th></tr></thead>
    <tbody>${rijen}</tbody>
  </table>
</div>`;
}

// ==================== Beheerdersdashboard ====================

function verschilIndicator(huidig, vorig, hogerIsBeter = true) {
  const verschil = huidig - vorig;
  if (Math.abs(verschil) < 0.005 && vorig === 0) return `<span class="rit-meta">—</span>`;
  const percentage = vorig !== 0 ? (verschil / Math.abs(vorig)) * 100 : 100;
  const pijl = verschil > 0.005 ? '▲' : verschil < -0.005 ? '▼' : '—';
  const stijging = verschil > 0.005;
  const daling = verschil < -0.005;
  const goedeRichting = hogerIsBeter ? stijging : daling;
  const slechteRichting = hogerIsBeter ? daling : stijging;
  const kleur = goedeRichting ? 'var(--kleur-groen)' : slechteRichting ? 'var(--kleur-rood)' : 'var(--kleur-subtekst)';
  return `<span style="color:${kleur};font-size:0.85rem;">${pijl} ${Math.abs(percentage).toFixed(0)}%</span>`;
}

function renderTrendChart(periodes) {
  const breedte = 700;
  const hoogte = 240;
  const padLinks = 10;
  const padRechts = 10;
  const padBoven = 15;
  const padOnder = 30;
  const grafiekBreedte = breedte - padLinks - padRechts;
  const grafiekHoogte = hoogte - padBoven - padOnder;
  const maxWaarde = Math.max(1, ...periodes.flatMap((p) => [Math.abs(p.omzet), Math.abs(p.marge)]));
  const basisY = padBoven + grafiekHoogte;
  const groepBreedte = grafiekBreedte / Math.max(1, periodes.length);
  const barBreedte = Math.min(20, groepBreedte / 2.6);

  const staven = periodes
    .map((p, i) => {
      const groepX = padLinks + i * groepBreedte + groepBreedte / 2;
      const omzetHoogte = (Math.abs(p.omzet) / maxWaarde) * grafiekHoogte;
      const margeHoogte = (Math.abs(p.marge) / maxWaarde) * grafiekHoogte;
      const margeKleur = p.marge >= 0 ? '#0080FF' : '#9B1C12';
      return `
      <rect x="${(groepX - barBreedte - 2).toFixed(1)}" y="${(basisY - omzetHoogte).toFixed(1)}" width="${barBreedte.toFixed(1)}" height="${omzetHoogte.toFixed(1)}" fill="#0A0A96" rx="2"></rect>
      <rect x="${(groepX + 2).toFixed(1)}" y="${(p.marge >= 0 ? basisY - margeHoogte : basisY).toFixed(1)}" width="${barBreedte.toFixed(1)}" height="${margeHoogte.toFixed(1)}" fill="${margeKleur}" rx="2"></rect>
      <text x="${groepX.toFixed(1)}" y="${hoogte - 12}" text-anchor="middle" font-size="10" fill="#5A5F80">${escapeHtml(p.label)}</text>`;
    })
    .join('');

  return `
<svg viewBox="0 0 ${breedte} ${hoogte}" width="100%" style="max-width:700px;display:block;" role="img" aria-label="Trend omzet en marge">
  <line x1="${padLinks}" y1="${basisY}" x2="${breedte - padRechts}" y2="${basisY}" stroke="#E1E5F0" stroke-width="1"></line>
  ${staven}
</svg>
<div class="rit-meta"><span style="color:#0A0A96;">■</span> Omzet &nbsp; <span style="color:#0080FF;">■</span> Marge &nbsp; <span style="color:#9B1C12;">■</span> Marge (verlies)</div>`;
}

export function pagDashboard({
  periodeType,
  huidig,
  vorig,
  cijfersHuidig,
  cijfersVorig,
  verliesRitten,
  voertuigenMetAandacht,
  openIncidenten,
  risicoTaken,
  opdrachtenZonderTarief = [],
  topOpdrachtgevers,
  voertuigenBezetting,
  nogTeFactureren,
  trend,
}) {
  const periodeLabel = periodeType === 'maand' ? 'maand' : 'week';

  const aandachtItems = [];
  if (verliesRitten.length) {
    aandachtItems.push(
      `<li><strong>${verliesRitten.length}</strong> ${verliesRitten.length === 1 ? 'verlies-rit' : 'verlies-ritten'} (klantprijs lager dan kostprijs) — <a href="/planner/financieel">bekijk financieel overzicht</a>.</li>`
    );
  }
  if (voertuigenMetAandacht.length) {
    aandachtItems.push(
      `<li><strong>${voertuigenMetAandacht.length}</strong> ${voertuigenMetAandacht.length === 1 ? 'voertuig heeft' : 'voertuigen hebben'} een verlopen of binnenkort verlopende APK/onderhoud/verzekering: ${voertuigenMetAandacht
        .map((v) => `<a href="/planner/voertuigen/${v.id}">${escapeHtml(v.kenteken)}</a>`)
        .join(', ')}.</li>`
    );
  }
  if (openIncidenten.length) {
    aandachtItems.push(
      `<li><strong>${openIncidenten.length}</strong> open ${openIncidenten.length === 1 ? 'incident' : 'incidenten'} — <a href="/planner/incidenten?status=open">bekijk incidentenoverzicht</a>.</li>`
    );
  }
  if (risicoTaken.length) {
    const verlopen = risicoTaken.filter((t) => t.risico === 'verlopen').length;
    const binnenkort = risicoTaken.length - verlopen;
    aandachtItems.push(
      `<li><strong>${risicoTaken.length}</strong> ${risicoTaken.length === 1 ? 'taak heeft' : 'taken hebben'} een tijdvenster dat ${verlopen ? `al is verstreken (${verlopen})` : ''}${verlopen && binnenkort ? ' of ' : ''}${binnenkort ? `bijna verstrijkt (${binnenkort})` : ''} — controleer de <a href="/planner/routes">routes</a>.</li>`
    );
  }
  if (opdrachtenZonderTarief.length) {
    const klanten = [...new Set(opdrachtenZonderTarief.map((o) => o.klant_naam))];
    aandachtItems.push(
      `<li><strong>${opdrachtenZonderTarief.length}</strong> afgeronde ${opdrachtenZonderTarief.length === 1 ? 'opdracht heeft' : 'opdrachten hebben'} geen tariefafspraak, waardoor er geen bedrag voor kan worden berekend (${klanten.map((k) => escapeHtml(k)).join(', ')}) — wijs de juiste tariefafspraak toe via de dagregistratie bij <a href="/planner/chauffeurs">Chauffeurs</a>.</li>`
    );
  }
  const aandachtHtml = aandachtItems.length
    ? `<ul style="margin:0;padding-left:1.25rem;display:flex;flex-direction:column;gap:0.4rem;">${aandachtItems.join('')}</ul>`
    : `<p style="margin:0;color:var(--kleur-groen);">✓ Geen openstaande aandachtspunten.</p>`;

  const topRijen = topOpdrachtgevers.length
    ? topOpdrachtgevers
        .map(
          (k) => `<tr>
      <td>${escapeHtml(k.klant_naam)}</td>
      <td>${formatEuro(k.omzet)}</td>
      <td>${formatEuro(k.kosten)}</td>
      <td class="${k.marge >= 0 ? '' : 'melding-fout'}">${formatEuro(k.marge)}</td>
    </tr>`
        )
        .join('')
    : `<tr><td colspan="4" class="leeg">Nog geen omzet in deze periode.</td></tr>`;

  const vlootRijen = voertuigenBezetting.length
    ? voertuigenBezetting
        .map(
          (v) => `<tr>
      <td><a href="/planner/voertuigen/${v.id}">${escapeHtml(v.kenteken)}</a></td>
      <td>${aandachtBadge(v.aandacht_status)}</td>
      <td>${Math.round(v.bezetting.totaalKm)} km</td>
      <td>${formatUren(v.bezetting.totaalUren)}</td>
      <td>${v.bezetting.dagenIngezet}/${v.bezetting.dagenInPeriode} dagen</td>
    </tr>`
        )
        .join('')
    : `<tr><td colspan="5" class="leeg">Nog geen voertuigen toegevoegd.</td></tr>`;

  return `
<div class="paginakop">
  <h1>Dashboard</h1>
  <div class="knoppenrij">
    <a href="/planner/dashboard?periode=week" class="knop${periodeType === 'week' ? ' knop-primair' : ''}">Per week</a>
    <a href="/planner/dashboard?periode=maand" class="knop${periodeType === 'maand' ? ' knop-primair' : ''}">Per maand</a>
  </div>
</div>

<div class="kaart">
  <h2 style="margin-top:0;">Deze ${periodeLabel} vs. vorige ${periodeLabel}</h2>
  <div class="tabel-wrap">
  <table>
    <thead><tr><th></th><th>Deze ${periodeLabel}</th><th>Vorige ${periodeLabel}</th><th>Verschil</th></tr></thead>
    <tbody>
      <tr><td>Omzet</td><td><strong>${formatEuro(cijfersHuidig.omzet)}</strong></td><td>${formatEuro(cijfersVorig.omzet)}</td><td>${verschilIndicator(cijfersHuidig.omzet, cijfersVorig.omzet)}</td></tr>
      <tr><td>Kosten</td><td>${formatEuro(cijfersHuidig.kosten)}</td><td>${formatEuro(cijfersVorig.kosten)}</td><td>${verschilIndicator(cijfersHuidig.kosten, cijfersVorig.kosten, false)}</td></tr>
      <tr><td>Marge</td><td class="${cijfersHuidig.marge >= 0 ? '' : 'melding-fout'}"><strong>${formatEuro(cijfersHuidig.marge)}</strong></td><td>${formatEuro(cijfersVorig.marge)}</td><td>${verschilIndicator(cijfersHuidig.marge, cijfersVorig.marge)}</td></tr>
      <tr><td>Gewerkte uren</td><td>${formatUren(cijfersHuidig.uren)}</td><td>${formatUren(cijfersVorig.uren)}</td><td>${verschilIndicator(cijfersHuidig.uren, cijfersVorig.uren)}</td></tr>
      <tr><td>Aantal ritten</td><td>${cijfersHuidig.aantalRitten}</td><td>${cijfersVorig.aantalRitten}</td><td>${verschilIndicator(cijfersHuidig.aantalRitten, cijfersVorig.aantalRitten)}</td></tr>
    </tbody>
  </table>
  </div>
</div>

<div class="kaart" style="border-color:var(--kleur-accent);">
  <h2 style="margin-top:0;">Aandachtspunten</h2>
  ${aandachtHtml}
</div>

<div class="kaart">
  <h2 style="margin-top:0;">Nog te factureren</h2>
  <p style="margin:0;font-size:1.4rem;font-weight:700;color:var(--kleur-primair);">${formatEuro(nogTeFactureren)}</p>
  <p class="rit-meta" style="margin:0.35rem 0 0;">Som van alle afgeronde, nog niet als "gefactureerd" gemarkeerde ritten en werkdagen — zie <a href="/planner/financieel">Financieel</a> en <a href="/planner/week-uitdraai">Weekoverzicht</a>.</p>
</div>

<h2>Trend: omzet &amp; marge</h2>
<div class="kaart">
  ${renderTrendChart(trend)}
</div>

<h2>Top opdrachtgevers (deze ${periodeLabel})</h2>
<div class="kaart tabel-wrap">
  <table>
    <thead><tr><th>Opdrachtgever</th><th>Omzet</th><th>Kosten</th><th>Marge</th></tr></thead>
    <tbody>${topRijen}</tbody>
  </table>
</div>

<h2>Vlootoverzicht (deze ${periodeLabel})</h2>
<div class="kaart tabel-wrap">
  <table>
    <thead><tr><th>Voertuig</th><th>Onderhoud</th><th>Km</th><th>Uren</th><th>Bezetting</th></tr></thead>
    <tbody>${vlootRijen}</tbody>
  </table>
</div>`;
}

// ==================== Prijscalculator ====================

export function pagPrijscalculator({
  voertuigen,
  toltarieven,
  margePercentage,
  routeBerekeningActief,
  v = {},
  geselecteerdeTolIds = [],
  resultaat,
  geschiedenis = [],
  fout,
}) {
  const voertuigOpties = voertuigen
    .map(
      (voertuig) =>
        `<option value="${escapeHtml(voertuig.id)}" data-kostprijs-per-km="${voertuig.kostprijs_per_km || 0}"${voertuig.id === v.voertuig_id ? ' selected' : ''}>${escapeHtml(voertuig.kenteken)}</option>`
    )
    .join('');

  const tolCheckboxes = toltarieven.length
    ? toltarieven
        .map((t) => {
          const checked = geselecteerdeTolIds.includes(t.id) ? ' checked' : '';
          return `<label class="tol-optie">
            <input type="checkbox" name="tol_ids" value="${escapeHtml(t.id)}"${checked}>
            ${escapeHtml(t.omschrijving)} (${formatEuro(t.bedrag)})
          </label>`;
        })
        .join('')
    : `<p class="leeg" style="padding:0;">Nog geen toltarieven vastgelegd. <a href="/planner/tarieven">Toltarief toevoegen</a>.</p>`;

  const resultaatHtml = resultaat
    ? `
<div class="kaart" style="border-color:var(--kleur-primair);">
  <h2 style="margin-top:0;">Resultaat</h2>
  <div class="tabel-wrap">
  <table>
    <tbody>
      <tr><td>Totale afstand (incl. lege retour-km)</td><td>${resultaat.totaalKm} km</td></tr>
      <tr><td>Basiskosten (km × kostprijs/km)</td><td>${formatEuro(resultaat.basisKosten)}</td></tr>
      <tr><td>Tol${resultaat.tolOmschrijvingen.length ? ' (' + escapeHtml(resultaat.tolOmschrijvingen.join(', ')) + ')' : ''}</td><td>${formatEuro(resultaat.tolkosten)}</td></tr>
      ${resultaat.adr ? `<tr><td>ADR-toeslag (${resultaat.adrPercentage}%)</td><td>${formatEuro(resultaat.adrToeslag)}</td></tr>` : ''}
      ${resultaat.koel ? `<tr><td>Koeltransport-toeslag (${resultaat.koelPercentage}%)</td><td>${formatEuro(resultaat.koelToeslag)}</td></tr>` : ''}
      ${resultaat.wachttijdUren ? `<tr><td>Wachttijd/laad-lostijd (${resultaat.wachttijdUren} u × ${formatEuro(resultaat.wachttijdTarief)})</td><td>${formatEuro(resultaat.wachttijdToeslag)}</td></tr>` : ''}
      ${resultaat.aantalOvernachtingen ? `<tr><td>Chauffeursvergoeding/overnachting (${resultaat.aantalOvernachtingen}×)</td><td>${formatEuro(resultaat.overnachtingToeslag)}</td></tr>` : ''}
      <tr style="font-weight:700;"><td>Totale kostprijs</td><td>${formatEuro(resultaat.totaleKostprijs)}</td></tr>
      <tr style="font-weight:700;color:var(--kleur-primair);"><td>Voorgestelde klantprijs (marge ${resultaat.margePercentage}%)</td><td>${formatEuro(resultaat.voorgesteldeKlantprijs)}</td></tr>
    </tbody>
  </table>
  </div>
  <div class="rit-meta" style="margin-top:0.75rem;">Geschatte rijtijd: ${resultaat.rijtijdUren} u bij ${resultaat.gemiddeldeSnelheid} km/u · verplichte pauzes (45 min/4,5u rijden): ${resultaat.aantalPauzes} · geschatte rijdagen: ${resultaat.rijdagen} (rusttijd van 11 uur per overnachting) · totale geschatte reisduur: ${resultaat.geschatteReisduurUren} u.</div>
  <p class="rit-meta" style="margin:0.35rem 0 0;">Deze berekening is opgeslagen in de geschiedenis hieronder.</p>
</div>`
    : '';

  const geschiedenisRijen = geschiedenis.length
    ? geschiedenis
        .map(
          (b) => `<tr>
      <td>${formatDatum(b.aangemaakt_op.slice(0, 10))}</td>
      <td>${escapeHtml(b.ophaal_adres || '—')} → ${escapeHtml(b.aflever_adres || '—')}</td>
      <td>${b.afstand_km + b.leeg_km} km</td>
      <td>${formatEuro(b.totale_kostprijs)}</td>
      <td>${formatEuro(b.voorgestelde_klantprijs)}</td>
      <td>
        <form method="post" action="/planner/prijscalculator/${b.id}/verwijderen" class="inline-form" onsubmit="return confirm('Berekening verwijderen?')">
          <button type="submit" class="knop knop-klein knop-gevaar">Verwijderen</button>
        </form>
      </td>
    </tr>`
        )
        .join('')
    : `<tr><td colspan="6" class="leeg">Nog geen berekeningen gemaakt.</td></tr>`;

  return `
<div class="paginakop">
  <h1>Prijscalculator</h1>
</div>
<p class="sectie-sub" style="color:var(--kleur-subtekst);margin:0 0 1rem;">Bereken een complete kostprijs en klantprijs voor een (internationale) rit: afstand, reistijd inclusief verplichte EU-rusttijden, tol, ADR, koeltransport, wachttijd en chauffeursvergoeding. Vignetten worden hier bewust niet meegenomen.</p>
${fout ? `<div class="melding melding-fout">${escapeHtml(fout)}</div>` : ''}
<div class="kaart">
  <form method="post" action="/planner/prijscalculator" class="form" style="max-width:640px;" data-prijscalculator-formulier>
    <h2 style="margin-top:0;">Route</h2>
    <div class="form-rij">
      <label>Ophaaladres
        <input type="text" name="ophaal_adres" value="${escapeHtml(v.ophaal_adres || '')}">
      </label>
      <label>Afleveradres
        <input type="text" name="aflever_adres" value="${escapeHtml(v.aflever_adres || '')}">
      </label>
    </div>
    <div class="form-rij" style="align-items:flex-end;">
      <label>Afstand (km, enkele reis)
        <input type="number" step="0.1" min="0" name="afstand_km" required value="${v.afstand_km != null ? escapeHtml(v.afstand_km) : ''}">
      </label>
      <button type="button" class="knop" data-bereken-route${routeBerekeningActief ? '' : ' title="Nog niet ingesteld — zie Tarieven"'}>Bereken automatisch</button>
      <label>Lege retour-km (optioneel)
        <input type="number" step="0.1" min="0" name="leeg_km" value="${v.leeg_km != null ? escapeHtml(v.leeg_km) : '0'}">
      </label>
    </div>
    <div class="rit-meta" data-route-status>${routeBerekeningActief ? '' : 'Automatisch berekenen is nog niet ingesteld — vul de kilometers handmatig in.'}</div>

    <h2>Kostprijs</h2>
    <div class="form-rij">
      <label>Voertuig (voor kostprijs/km)
        <select name="voertuig_id" data-prijscalc-voertuig>
          <option value="">— Handmatig invoeren —</option>
          ${voertuigOpties}
        </select>
      </label>
      <label>Kostprijs per km (€)
        <input type="number" step="0.01" min="0" name="kostprijs_per_km" data-prijscalc-kostprijs value="${v.kostprijs_per_km != null ? escapeHtml(v.kostprijs_per_km) : ''}">
      </label>
    </div>
    <label>Tol (selecteer wat van toepassing is)</label>
    <div class="tol-lijst">${tolCheckboxes}</div>

    <h2>Toeslagen</h2>
    <div class="form-rij">
      <label class="tol-optie">
        <input type="checkbox" name="adr" value="1"${v.adr ? ' checked' : ''}>
        ADR-lading (gevaarlijke stoffen)
      </label>
      <label>ADR-toeslag (% van basiskosten)
        <input type="number" step="1" min="0" name="adr_percentage" value="${v.adr_percentage != null ? escapeHtml(v.adr_percentage) : '15'}">
      </label>
    </div>
    <div class="form-rij">
      <label class="tol-optie">
        <input type="checkbox" name="koeltransport" value="1"${v.koeltransport ? ' checked' : ''}>
        Koeltransport
      </label>
      <label>Koeltransport-toeslag (% van basiskosten)
        <input type="number" step="1" min="0" name="koel_percentage" value="${v.koel_percentage != null ? escapeHtml(v.koel_percentage) : '10'}">
      </label>
    </div>
    <div class="form-rij">
      <label>Wachttijd/laad-lostijd (uren)
        <input type="number" step="0.25" min="0" name="wachttijd_uren" value="${v.wachttijd_uren != null ? escapeHtml(v.wachttijd_uren) : '0'}">
      </label>
      <label>Tarief per uur wachttijd (€)
        <input type="number" step="0.01" min="0" name="wachttijd_tarief" value="${v.wachttijd_tarief != null ? escapeHtml(v.wachttijd_tarief) : '40'}">
      </label>
    </div>

    <h2>Reistijd &amp; overnachtingen</h2>
    <div class="form-rij">
      <label>Gemiddelde snelheid (km/u, incl. grenzen/verkeer)
        <input type="number" step="1" min="1" name="gemiddelde_snelheid" value="${v.gemiddelde_snelheid != null ? escapeHtml(v.gemiddelde_snelheid) : '70'}">
      </label>
      <label>Aantal overnachtingen (leeg = automatisch schatten)
        <input type="number" step="1" min="0" name="aantal_overnachtingen" value="${v.aantal_overnachtingen != null ? escapeHtml(v.aantal_overnachtingen) : ''}">
      </label>
      <label>Vergoeding per overnachting (€)
        <input type="number" step="0.01" min="0" name="vergoeding_per_overnachting" value="${v.vergoeding_per_overnachting != null ? escapeHtml(v.vergoeding_per_overnachting) : '50'}">
      </label>
    </div>
    <p class="rit-meta" style="margin:0 0 0.5rem;">Schatting op basis van EU-regels: max. 4,5 uur rijden per pauze (45 min) en max. 9 uur rijden per dag; bij meerdere rijdagen wordt automatisch een overnachting geteld.</p>

    <h2>Marge</h2>
    <label>Marge (%)
      <input type="number" step="0.1" min="0" name="marge_percentage" value="${v.marge_percentage != null ? escapeHtml(v.marge_percentage) : margePercentage}">
    </label>
    <label>Opmerkingen (optioneel)
      <textarea name="opmerkingen">${escapeHtml(v.opmerkingen || '')}</textarea>
    </label>

    <div class="knoppenrij">
      <button type="submit" class="knop knop-primair">Bereken &amp; bewaar</button>
    </div>
  </form>
</div>
${resultaatHtml}

<h2>Geschiedenis</h2>
<div class="kaart tabel-wrap">
  <table>
    <thead><tr><th>Datum</th><th>Route</th><th>Km</th><th>Kostprijs</th><th>Klantprijs</th><th></th></tr></thead>
    <tbody>${geschiedenisRijen}</tbody>
  </table>
</div>`;
}
