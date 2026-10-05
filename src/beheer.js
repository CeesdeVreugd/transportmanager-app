// Beheer (gebruikers, rechten per functierol, instellingen, logboek), Mijn
// account, het menu op de telefoon en zoeken — opgebouwd zoals WorkPortal.
import fs from 'node:fs';
import db, { DB_PATH, appInstelling, zetAppInstelling, nieuweId, hashWachtwoord } from './db.js';
import { randomBytes } from 'node:crypto';
import {
  MODULES,
  MODULE_LABELS,
  MODULE_GROEPEN,
  NIVEAU_NAMEN,
  kan,
  synchroniseerRolKolom,
  BEHEER,
  BEWERKEN,
} from './rechten.js';
import {
  logActie,
  meldAlleApparatenAf,
  verwijderApparaat,
  stuurWelkomstmail,
  verifyDagen,
  ontgrendelUren,
  pinMinLengte,
} from './inloggen.js';
import { mailMethode, verstuurMail } from './mail.js';
import { pushVapidGeconfigureerd, slaPushAbonnementOp, stuurPushNaarGebruiker } from './push.js';
import { routeBerekeningActief } from './routing.js';
import { oneDriveGeconfigureerd, oneDriveGekoppeld } from './onedrive.js';
import { lijstBackups } from './backup.js';
import { escapeHtml, icoon, menuPaginaInhoud } from './render.js';

const e = escapeHtml;

function datumTijd(waarde) {
  if (!waarde) return '';
  const d = new Date(String(waarde).includes('T') ? waarde : String(waarde).replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return e(waarde);
  return new Intl.DateTimeFormat('nl-NL', {
    timeZone: 'Europe/Amsterdam',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function rolPil(r) {
  return `<span class="rolepill role-${e(r.sleutel)}"><i></i>${e(r.naam)}</span>`;
}

function flashUitUrl(url) {
  const ok = url.searchParams.get('ok');
  const fout = url.searchParams.get('fout');
  return (ok ? `<div class="flash ok">${e(ok === '1' ? 'Opgeslagen.' : ok)}</div>` : '') + (fout ? `<div class="flash error">${e(fout)}</div>` : '');
}

/** Tabbladen bovenaan Beheer (ook gebruikt door de Back-ups-pagina). */
export function beheerTabs(actief) {
  const tabs = [
    ['/beheer/gebruikers', 'Gebruikers', 'gebruikers'],
    ['/beheer/rechten', 'Rechten per functierol', 'rechten'],
    ['/beheer/instellingen', 'Instellingen', 'instellingen'],
    ['/planner/backups', 'Back-ups', 'backups'],
    ['/beheer/logboek', 'Logboek', 'logboek'],
  ];
  return `<div class="tabs">${tabs.map(([href, label, k]) => `<a href="${href}" class="${k === actief ? 'active' : ''}">${label}</a>`).join('')}</div>`;
}

function alleRollen() {
  return db.prepare('SELECT * FROM functierollen ORDER BY volgorde, id').all();
}

// ---------------------------------------------------------------- gebruikers
function pagGebruikers(url) {
  const gebruikers = db
    .prepare(
      `SELECT g.*, (SELECT COUNT(*) FROM apparaten a WHERE a.gebruiker_id = g.id) AS n_apparaten
       FROM gebruikers g WHERE g.verwijderd = 0 ORDER BY g.actief DESC, g.naam`
    )
    .all();
  const rollenPer = {};
  for (const r of db
    .prepare('SELECT gr.gebruiker_id, f.* FROM gebruiker_rollen gr JOIN functierollen f ON f.id = gr.rol_id ORDER BY f.volgorde')
    .all()) {
    (rollenPer[r.gebruiker_id] ||= []).push(r);
  }
  const rijen = gebruikers
    .map(
      (u) => `<tr class="link" data-href="/beheer/gebruiker/${e(u.id)}">
    <td><b>${e(u.naam)}</b>${u.is_beheerder ? ' <span class="badge b-dark">Beheerder</span>' : ''}</td><td>${e(u.email)}</td>
    <td><div class="rolepills">${(rollenPer[u.id] || []).map(rolPil).join('') || '<span class="muted">–</span>'}</div></td>
    <td class="hide-m">${u.laatst_ingelogd ? datumTijd(u.laatst_ingelogd) : 'Nog nooit'}</td><td class="num hide-m">${u.n_apparaten}</td>
    <td><span class="badge ${u.actief ? 'b-ok' : 'b-bad'}">${u.actief ? 'Actief' : 'Uitgeschakeld'}</span></td></tr>`
    )
    .join('');
  return `<div class="pagehead"><div><h1>Beheer</h1><p>${gebruikers.length} gebruiker(s)</p></div>
  <div class="actions"><a class="btn primary" href="/beheer/gebruiker">${icoon('plus')}Nieuwe gebruiker</a></div></div>
${beheerTabs('gebruikers')}
${flashUitUrl(url)}
<div class="card flush tablewrap"><table class="table">
  <thead><tr><th>Naam</th><th>E-mail</th><th>Functierollen</th><th class="hide-m">Laatst ingelogd</th><th class="num hide-m">Apparaten</th><th>Status</th></tr></thead>
  <tbody>${rijen}</tbody>
</table></div>`;
}

function pagGebruiker({ u, ik, fout = '', url }) {
  const rollen = alleRollen();
  const gekozen = new Set(u.id ? db.prepare('SELECT rol_id FROM gebruiker_rollen WHERE gebruiker_id = ?').all(u.id).map((r) => r.rol_id) : u.rolIds || []);
  const extra = Object.fromEntries(
    u.id ? db.prepare('SELECT module, niveau FROM gebruiker_rechten WHERE gebruiker_id = ?').all(u.id).map((r) => [r.module, r.niveau]) : []
  );
  const apparaten = u.id ? db.prepare('SELECT * FROM apparaten WHERE gebruiker_id = ? ORDER BY laatst_gebruikt DESC').all(u.id) : [];
  return `<div class="crumbs"><a href="/beheer/gebruikers">Beheer</a> / gebruiker</div>
<h1>${u.id ? e(u.naam) : 'Nieuwe gebruiker'}</h1>
${fout ? `<div class="flash error">${e(fout)}</div>` : ''}${url ? flashUitUrl(url) : ''}
<form method="post" action="/beheer/gebruiker${u.id ? '/' + e(u.id) : ''}" class="form" style="max-width:900px">
  <section class="card form">
    <div class="fgrid">
      <label class="f">Naam *<input type="text" name="naam" value="${e(u.naam || '')}" required></label>
      <label class="f">E-mailadres *<input type="email" name="email" value="${e(u.email || '')}" required></label>
      <div class="f full"><span class="small muted" style="font-weight:500">Functierollen</span>
        <div class="rolepick">${rollen
          .map(
            (r) =>
              `<label class="rolechip role-${e(r.sleutel)}"><input type="checkbox" name="rol_ids" value="${r.id}" ${gekozen.has(r.id) ? 'checked' : ''}><span><i></i>${e(r.naam)}</span></label>`
          )
          .join('')}</div>
        <span class="hint">Meerdere rollen mogelijk; per module geldt het hoogste recht van de gekozen rollen. Wie de rol Chauffeur heeft, kan aan ritten worden gekoppeld.</span></div>
      <div style="display:flex;flex-direction:column;gap:10px;justify-content:flex-end">
        <label class="check"><input type="checkbox" name="actief" value="1" ${u.actief || !u.id ? 'checked' : ''}> Actief</label>
        ${ik.is_beheerder ? `<label class="check"><input type="checkbox" name="is_beheerder" value="1" ${u.is_beheerder ? 'checked' : ''}> Beheerder (alle rechten)</label>` : ''}
        ${!u.id ? '<label class="check"><input type="checkbox" name="welkom" value="1" checked> Welkomstmail sturen</label>' : ''}
      </div>
    </div>
  </section>
  <section class="card form">
    <h2>Extra rechten (bovenop de functierollen)</h2>
    <p class="hint">Alleen invullen voor uitzonderingen. Het hoogste niveau van rol en extra recht geldt.</p>
    <div class="fgrid">
    ${MODULES.map(
      ([m, label]) =>
        `<label class="f">${e(label)}<select name="extra_${m}">${[0, 1, 2, 3]
          .map((n) => `<option value="${n}" ${(extra[m] || 0) === n ? 'selected' : ''}>${n === 0 ? '– (volgens rol)' : NIVEAU_NAMEN[n]}</option>`)
          .join('')}</select></label>`
    ).join('')}
    </div>
  </section>
  <div class="actions"><button class="btn primary">Opslaan</button></div>
</form>
${
  u.id
    ? `<section class="card" style="max-width:900px">
  <h2>Apparaten (${apparaten.length})</h2>
  <div class="rows">${
    apparaten
      .map(
        (d) =>
          `<div class="rowitem"><div class="grow"><div class="s">${e((d.user_agent || '').slice(0, 90))}</div><div class="small">Laatst gebruikt ${datumTijd(d.laatst_gebruikt) || '–'} · pincode ${d.pin_hash ? 'ingesteld' : 'niet ingesteld'}</div></div></div>`
      )
      .join('') || '<div class="empty">Geen apparaten.</div>'
  }</div>
  <form method="post" action="/beheer/gebruiker/${e(u.id)}/apparaten-afmelden" data-confirm="Alle apparaten van deze gebruiker afmelden?" style="margin-top:12px"><button class="btn danger sm">Alle apparaten afmelden (pincode vergeten / telefoon kwijt)</button></form>
</section>
${
  u.id !== ik.id && kan(ik, 'beheer', BEHEER) && (!u.is_beheerder || ik.is_beheerder)
    ? `<section class="card" style="max-width:900px">
  <h2>Gebruiker verwijderen</h2>
  <p class="muted">De gebruiker verdwijnt uit Beheer en uit de keuzelijsten, kan niet meer inloggen en het e-mailadres ${e(u.email)} is daarna weer vrij voor een nieuw account.
  Op de achtergrond blijft de naam bewaard, zodat ritten, uren en incidenten van deze persoon gewoon zichtbaar blijven.</p>
  <form method="post" action="/beheer/gebruiker/${e(u.id)}/verwijderen" data-confirm="${e(u.naam)} verwijderen? Dit kan niet ongedaan worden gemaakt (je kunt wel een nieuw account aanmaken met hetzelfde e-mailadres).">
    <button class="btn danger">${icoon('trash')}Gebruiker verwijderen</button>
  </form>
</section>`
    : ''
}`
    : ''
}`;
}

async function slaGebruikerOp(v, ik, bestaandId) {
  const naam = (v.naam || '').trim();
  const email = (v.email || '').trim().toLowerCase();
  const rolIds = (v._raw ? v._raw.getAll('rol_ids') : []).map(Number).filter(Boolean);
  if (!naam || !email || !email.includes('@')) return { fout: 'Vul een naam en een geldig e-mailadres in.' };
  const dubbel = db.prepare('SELECT id FROM gebruikers WHERE lower(email) = ? AND id != ?').get(email, bestaandId || '');
  if (dubbel) return { fout: 'Er is al een gebruiker met dit e-mailadres.' };

  const bestaand = bestaandId ? db.prepare('SELECT * FROM gebruikers WHERE id = ?').get(bestaandId) : null;
  let actief = v.actief === '1' ? 1 : 0;
  let isBeheerder = bestaand ? bestaand.is_beheerder : 0;
  if (ik.is_beheerder) isBeheerder = v.is_beheerder === '1' ? 1 : 0;
  if (bestaand && bestaand.id === ik.id) {
    // Jezelf geen beheerrechten afnemen en jezelf niet op inactief zetten.
    actief = 1;
    if (ik.is_beheerder) isBeheerder = 1;
  }

  let id = bestaandId;
  if (bestaand) {
    db.prepare('UPDATE gebruikers SET naam = ?, email = ?, actief = ?, is_beheerder = ? WHERE id = ?').run(naam, email, actief, isBeheerder, id);
    if (!actief && bestaand.actief) meldAlleApparatenAf(id); // direct van al zijn apparaten afgemeld
  } else {
    id = nieuweId();
    db.prepare(
      "INSERT INTO gebruikers (id, naam, email, wachtwoord_hash, rol, actief, is_beheerder) VALUES (?, ?, ?, ?, 'planner', ?, ?)"
    ).run(id, naam, email, hashWachtwoord(randomBytes(24).toString('hex')), actief, isBeheerder);
  }
  db.prepare('DELETE FROM gebruiker_rollen WHERE gebruiker_id = ?').run(id);
  const insRol = db.prepare('INSERT OR IGNORE INTO gebruiker_rollen (gebruiker_id, rol_id) VALUES (?, ?)');
  rolIds.forEach((r) => insRol.run(id, r));
  db.prepare('DELETE FROM gebruiker_rechten WHERE gebruiker_id = ?').run(id);
  const insRecht = db.prepare('INSERT INTO gebruiker_rechten (gebruiker_id, module, niveau) VALUES (?, ?, ?)');
  for (const [m] of MODULES) {
    const n = Math.min(3, Math.max(0, parseInt(v[`extra_${m}`], 10) || 0));
    if (n > 0) insRecht.run(id, m, n);
  }
  synchroniseerRolKolom(id);
  logActie(ik, bestaand ? 'Gebruiker opgeslagen' : 'Gebruiker aangemaakt', 'gebruiker', id, `${naam} <${email}>`);
  if (!bestaand && v.welkom === '1') await stuurWelkomstmail({ naam, email });
  return { id };
}

/**
 * Verwijdert een gebruiker "zacht": niet meer zichtbaar, niet meer in te loggen
 * en het e-mailadres weer vrij — maar de rij blijft bestaan, zodat ritten, uren,
 * incidenten en het logboek de naam blijven tonen.
 */
export function verwijderGebruiker(u, door) {
  meldAlleApparatenAf(u.id);
  db.prepare('DELETE FROM login_codes WHERE gebruiker_id = ?').run(u.id);
  db.prepare('DELETE FROM push_abonnementen WHERE gebruiker_id = ?').run(u.id);
  db.prepare('DELETE FROM gebruiker_rechten WHERE gebruiker_id = ?').run(u.id);
  db.prepare(
    `UPDATE gebruikers SET verwijderd = 1, actief = 0, is_beheerder = 0, verwijderd_op = ?, verwijderd_email = email, email = ?
     WHERE id = ?`
  ).run(new Date().toISOString(), `verwijderd-${u.id}@verwijderd.invalid`, u.id);
  logActie(door, 'Gebruiker verwijderd', 'gebruiker', u.id, `${u.naam} <${u.email}>`);
}

// ---------------------------------------------------------------- rechten
function pagRechten(url) {
  const rollen = alleRollen();
  const matrix = {};
  for (const r of db.prepare('SELECT * FROM rol_rechten').all()) matrix[`${r.rol_id}_${r.module}`] = r.niveau;
  const actief = Number(url.searchParams.get('rol')) || (rollen[0] && rollen[0].id);
  return `<div class="pagehead"><div><h1>Beheer</h1><p>Rechten per functierol. Vink aan wat een rol mag; een hoger recht omvat de lagere.</p></div></div>
${beheerTabs('rechten')}
${flashUitUrl(url)}
<form method="post" action="/beheer/rechten" class="rights" id="rightsform">
  <input type="hidden" name="active_role" id="active_role" value="${actief}">
  <nav class="rights-roles" aria-label="Functierollen">
    <div class="navhead" style="padding-top:0">Functierollen</div>
    ${rollen
      .map(
        (r) => `<button type="button" class="rolebtn role-${e(r.sleutel)} ${r.id === actief ? 'active' : ''}" data-role="${r.id}">
      <span class="rolename"><i class="roledot"></i>${e(r.naam)}</span>
      <span class="small rolecount" data-count="${r.id}"></span>
    </button>`
      )
      .join('')}
  </nav>
  <div class="rights-panel">
    ${rollen
      .map(
        (r) => `<section class="card rolepanel ${r.id === actief ? '' : 'hidden'}" data-panel="${r.id}">
      <div class="card-head"><h2><span class="rolepill role-${e(r.sleutel)} lg"><i></i>${e(r.naam)}</span></h2><span class="small muted">Lezen · Bewerken · Beheer (ook verwijderen)</span></div>
      ${MODULE_GROEPEN.map(
        ([groep, mods]) => `<div class="rights-group">
        <div class="navhead">${e(groep)}</div>
        ${mods
          .map((m) => {
            const lvl = matrix[`${r.id}_${m}`] || 0;
            return `<div class="rights-row" data-row>
          <div class="rights-mod">${e(MODULE_LABELS[m])}</div>
          <div class="rights-checks">
            ${[
              [1, 'Lezen'],
              [2, 'Bewerken'],
              [3, 'Beheer'],
            ]
              .map(([n, l]) => `<label class="tick"><input type="checkbox" name="${r.id}_${m}" value="${n}" data-lvl="${n}" ${lvl >= n ? 'checked' : ''}><span>${l}</span></label>`)
              .join('')}
          </div>
        </div>`;
          })
          .join('')}
      </div>`
      ).join('')}
    </section>`
      )
      .join('')}
    <div class="actions"><button class="btn primary">Rechten opslaan</button><span class="hint">Opslaan bewaart de wijzigingen van alle rollen.</span></div>
  </div>
</form>
<script>
(function(){
  var form = document.getElementById('rightsform');
  function count(){
    document.querySelectorAll('[data-count]').forEach(function(el){
      var p = document.querySelector('[data-panel="'+el.getAttribute('data-count')+'"]');
      var n = 0; p.querySelectorAll('[data-row]').forEach(function(row){ if (row.querySelector('input:checked')) n++; });
      el.textContent = n + ' module' + (n === 1 ? '' : 's');
    });
  }
  document.querySelectorAll('.rolebtn').forEach(function(b){
    b.addEventListener('click', function(){
      var id = b.getAttribute('data-role');
      document.querySelectorAll('.rolebtn').forEach(function(x){ x.classList.toggle('active', x === b); });
      document.querySelectorAll('.rolepanel').forEach(function(p){ p.classList.toggle('hidden', p.getAttribute('data-panel') !== id); });
      document.getElementById('active_role').value = id;
    });
  });
  form.addEventListener('change', function(e){
    var cb = e.target; if (!cb.hasAttribute('data-lvl')) return;
    var lvl = +cb.getAttribute('data-lvl'), row = cb.closest('[data-row]');
    row.querySelectorAll('input[data-lvl]').forEach(function(o){
      var l = +o.getAttribute('data-lvl');
      if (cb.checked && l < lvl) o.checked = true;
      if (!cb.checked && l > lvl) o.checked = false;
    });
    count();
  });
  count();
})();
</script>`;
}

// ---------------------------------------------------------------- instellingen
function pagInstellingenBeheer(url) {
  const backups = lijstBackups().slice(0, 3);
  let dbGrootte = 0;
  try {
    dbGrootte = fs.statSync(DB_PATH).size;
  } catch {
    // geen database-bestand
  }
  const badge = (ok, tekstOk, tekstNiet) => `<span class="badge ${ok ? 'b-ok' : 'b-warn'}">${ok ? tekstOk : tekstNiet}</span>`;
  const methode = mailMethode();
  return `<div class="pagehead"><div><h1>Beheer</h1><p>Instellingen en koppelingen</p></div></div>
${beheerTabs('instellingen')}
${flashUitUrl(url)}
<div class="grid g2 stack">
  <form method="post" action="/beheer/instellingen" class="card form">
    <h2>Instellingen</h2>
    <div class="fgrid">
      <label class="f">Opnieuw verifiëren met e-mailcode (dagen)<input type="number" min="1" name="verify_days" value="${verifyDagen()}"></label>
      <label class="f">Automatisch vergrendelen na (uren)<input type="number" min="1" name="unlock_hours" value="${ontgrendelUren()}"></label>
      <label class="f">Minimale lengte pincode<input type="number" min="4" max="8" name="pin_min_length" value="${pinMinLengte()}"></label>
    </div>
    <div><button class="btn primary">Opslaan</button></div>
  </form>
  <section class="card">
    <h2>Koppelingen &amp; status</h2>
    <dl class="dl">
      <dt>App-adres</dt><dd>${e(process.env.APP_URL || 'APP_URL niet ingesteld')}</dd>
      <dt>E-mail</dt><dd>${badge(!!methode, e(methode || ''), 'Niet ingesteld – codes in containerlog')}</dd>
      <dt>Pushmeldingen</dt><dd>${badge(pushVapidGeconfigureerd(), 'Ingesteld', 'Niet ingesteld (VAPID-sleutels)')}</dd>
      <dt>Routeberekening</dt><dd>${badge(routeBerekeningActief(), 'Ingesteld', 'Niet ingesteld (ORS_API_KEY)')}</dd>
      <dt>OneDrive-back-ups</dt><dd>${badge(oneDriveGekoppeld(), 'Gekoppeld', oneDriveGeconfigureerd() ? 'Niet gekoppeld' : 'Niet ingesteld')}</dd>
      <dt>Database</dt><dd>${(dbGrootte / 1024 / 1024).toLocaleString('nl-NL', { maximumFractionDigits: 1 })} MB</dd>
      <dt>Laatste back-ups</dt><dd style="font-weight:400">${backups.map((b) => e(b.bestandsnaam)).join('<br>') || 'Nog geen (elke 24 uur automatisch)'}</dd>
    </dl>
    <div class="actions" style="margin-top:14px">
      <form method="post" action="/beheer/testmail"><button class="btn sm">Testmail naar mij</button></form>
      <a class="btn sm" href="/planner/backups">${icoon('download')}Back-ups</a>
    </div>
  </section>
</div>`;
}

// ---------------------------------------------------------------- logboek
function pagLogboek() {
  const rijen = db.prepare('SELECT * FROM logboek ORDER BY id DESC LIMIT 500').all();
  return `<div class="pagehead"><div><h1>Beheer</h1><p>Laatste 500 acties</p></div></div>
${beheerTabs('logboek')}
<div class="card flush tablewrap"><table class="table">
  <thead><tr><th>Wanneer</th><th>Wie</th><th>Actie</th><th>Onderdeel</th><th>Details</th></tr></thead>
  <tbody>${
    rijen
      .map(
        (r) =>
          `<tr><td class="nowrap">${datumTijd(r.aangemaakt_op)}</td><td>${e(r.wie || 'Systeem')}</td><td>${e(r.actie)}</td><td>${e(r.onderdeel || '')}</td><td class="small">${e(r.details || '')}</td></tr>`
      )
      .join('') || '<tr><td colspan="5" class="empty">Nog geen acties.</td></tr>'
  }</tbody>
</table></div>`;
}

// ---------------------------------------------------------------- mijn account
function pagAccount(gebruiker, url) {
  const apparaten = db.prepare('SELECT * FROM apparaten WHERE gebruiker_id = ? ORDER BY laatst_gebruikt DESC').all(gebruiker.id);
  const abonnementen = db.prepare('SELECT COUNT(*) AS n FROM push_abonnementen WHERE gebruiker_id = ?').get(gebruiker.id).n;
  const ditApparaat = gebruiker.apparaat ? gebruiker.apparaat.id : null;
  return `<div class="pagehead"><div><h1>Mijn account</h1><p>${e(gebruiker.email)} · ${e(gebruiker.rolNamen || 'Geen functierol')}${gebruiker.is_beheerder ? ' · Beheerder' : ''}</p></div></div>
${flashUitUrl(url)}
<div class="grid g2 stack">
  <section class="card">
    <h2>Pushmeldingen op dit apparaat</h2>
    <p class="muted">Chauffeurs krijgen een melding bij een nieuwe of gewijzigde route. Op iPhone werkt dit alleen als de app op het beginscherm staat (Deel → Zet op beginscherm).</p>
    <p class="small">Actieve apparaten met meldingen: <b>${abonnementen}</b></p>
    <div class="actions">
      <button class="btn primary" type="button" id="push-aan">${icoon('bell')}Meldingen aanzetten</button>
      <button class="btn" type="button" id="push-test">Testmelding sturen</button>
    </div>
    <p id="pushstat" class="small" style="margin-top:12px"></p>
  </section>
  <section class="card">
    <h2>Mijn apparaten</h2>
    <p class="muted small">Elk apparaat heeft een eigen pincode. Verwijder apparaten die je niet meer gebruikt.</p>
    <div class="rows">
    ${apparaten
      .map(
        (d) => `<div class="rowitem"><div class="grow"><div class="t">${d.id === ditApparaat ? 'Dit apparaat' : 'Apparaat #' + d.id}</div>
        <div class="s">${e((d.user_agent || '').slice(0, 70))}<br>Laatst gebruikt ${datumTijd(d.laatst_gebruikt) || '–'} · geverifieerd ${datumTijd(d.geverifieerd_op) || '–'}</div></div>
        ${
          d.id !== ditApparaat
            ? `<form method="post" action="/account/apparaat/${d.id}/verwijderen" data-confirm="Apparaat verwijderen?"><button class="iconbtn" aria-label="Verwijderen">${icoon('trash')}</button></form>`
            : ''
        }
      </div>`
      )
      .join('')}
    </div>
    <form method="post" action="/apparaat-vergeten" data-confirm="Dit apparaat vergeten? Je moet daarna opnieuw inloggen met een e-mailcode." style="margin-top:12px"><button class="btn danger sm">Dit apparaat vergeten</button></form>
  </section>
</div>`;
}

// ---------------------------------------------------------------- zoeken
function pagZoeken(gebruiker, q) {
  const term = `%${q.toLowerCase()}%`;
  const groepen = [];
  if (q.length >= 2) {
    if (kan(gebruiker, 'planning')) {
      const ritten = db
        .prepare(
          `SELECT r.id, r.datum, r.ophaal_adres, r.aflever_adres, r.status, k.naam AS klant FROM ritten r
           LEFT JOIN klanten k ON k.id = r.klant_id
           WHERE lower(r.ophaal_adres) LIKE ? OR lower(r.aflever_adres) LIKE ? OR lower(IFNULL(k.naam,'')) LIKE ? OR lower(IFNULL(r.opmerkingen,'')) LIKE ?
           ORDER BY r.datum DESC LIMIT 25`
        )
        .all(term, term, term, term);
      groepen.push([
        'Ritten',
        'truck',
        ritten.map((r) => [`/planner/ritten/${r.id}/bewerken`, `${r.ophaal_adres} → ${r.aflever_adres}`, `${r.datum}${r.klant ? ' · ' + r.klant : ''} · ${r.status}`]),
      ]);
    }
    if (kan(gebruiker, 'relaties')) {
      const klanten = db
        .prepare(`SELECT * FROM klanten WHERE lower(naam) LIKE ? OR lower(IFNULL(adres,'')) LIKE ? OR lower(IFNULL(email,'')) LIKE ? ORDER BY naam LIMIT 25`)
        .all(term, term, term);
      groepen.push(['Klanten', 'klanten', klanten.map((k) => [`/planner/klanten/${k.id}`, k.naam, [k.adres, k.telefoon, k.email].filter(Boolean).join(' · ')])]);
    }
    if (kan(gebruiker, 'wagenpark')) {
      const voertuigen = db
        .prepare(`SELECT * FROM voertuigen WHERE lower(kenteken) LIKE ? OR lower(IFNULL(omschrijving,'')) LIKE ? ORDER BY kenteken LIMIT 25`)
        .all(term, term);
      groepen.push(['Voertuigen', 'truck', voertuigen.map((v) => [`/planner/voertuigen/${v.id}`, v.kenteken, v.omschrijving || ''])]);
    }
    if (kan(gebruiker, 'chauffeurs')) {
      const mensen = db
        .prepare(`SELECT * FROM gebruikers WHERE rol = 'chauffeur' AND verwijderd = 0 AND (lower(naam) LIKE ? OR lower(email) LIKE ?) ORDER BY naam LIMIT 25`)
        .all(term, term);
      groepen.push(['Chauffeurs', 'stuur', mensen.map((c) => [`/planner/chauffeurs/${c.id}/uren`, c.naam, c.email])]);
    }
  }
  const resultaten = groepen.filter(([, , items]) => items.length);
  return `<div class="pagehead"><div><h1>Zoeken</h1>${q ? `<p>Resultaten voor “${e(q)}”</p>` : ''}</div></div>
<form class="search" action="/zoeken" method="get" role="search">${icoon('search')}<input type="search" name="q" value="${e(q)}" placeholder="Zoek rit, klant, kenteken of chauffeur" autofocus></form>
${
  q.length >= 2 && !resultaten.length
    ? '<div class="card"><div class="empty">Niets gevonden.</div></div>'
    : resultaten
        .map(
          ([titel, ico, items]) => `<section class="card zoekgroep"><h2>${icoon(ico)}${titel}</h2><div class="rows">${items
            .map(([href, t, s]) => `<a class="rowitem" href="${href}"><div class="grow"><div class="t">${e(t)}</div><div class="s">${e(s)}</div></div></a>`)
            .join('')}</div></section>`
        )
        .join('')
}`;
}

/**
 * Routes voor Beheer, Mijn account, menu en zoeken. Geeft true terug als
 * afgehandeld. h = { leesFormulier, stuurHtml, redirect, layout }
 */
export async function behandelBeheer(req, res, url, gebruiker, h) {
  const { pathname } = url;
  const methode = req.method;
  const toon = (titel, actief, inhoud, status = 200) => h.stuurHtml(res, status, h.layout({ titel, actief, gebruiker, inhoud }));

  if (pathname === '/menu' && methode === 'GET') return toon('Menu', 'menu', menuPaginaInhoud(gebruiker)), true;

  if (pathname === '/zoeken' && methode === 'GET') {
    return toon('Zoeken', 'zoeken', pagZoeken(gebruiker, (url.searchParams.get('q') || '').trim())), true;
  }

  // ---- Mijn account ----
  if ((pathname === '/account' || pathname === '/account/instellingen') && methode === 'GET') {
    return toon('Mijn account', 'account', pagAccount(gebruiker, url)), true;
  }
  // ---- Pushmeldingen: abonneren en testen (iedereen, voor het eigen apparaat) ----
  if (pathname === '/account/push/abonneren' && methode === 'POST') {
    const abonnement = await h.leesJson(req).catch(() => null);
    if (!abonnement || !abonnement.endpoint || !abonnement.keys) return h.stuurJson(res, 400, { fout: 'Ongeldig abonnement.' }), true;
    slaPushAbonnementOp(gebruiker.id, abonnement);
    return h.stuurJson(res, 200, { ok: true }), true;
  }
  if (pathname === '/account/push/test' && methode === 'POST') {
    if (!pushVapidGeconfigureerd()) return h.stuurJson(res, 400, { bericht: 'Pushmeldingen zijn op de server nog niet ingesteld (VAPID-sleutels).' }), true;
    const n = db.prepare('SELECT COUNT(*) AS n FROM push_abonnementen WHERE gebruiker_id = ?').get(gebruiker.id).n;
    if (!n) return h.stuurJson(res, 400, { bericht: 'Er staan nog geen meldingen aan. Klik eerst op "Meldingen aanzetten".' }), true;
    await stuurPushNaarGebruiker(gebruiker.id, { titel: 'Testmelding TransportManager', tekst: `Hallo ${gebruiker.naam.split(' ')[0]}, de meldingen werken.`, url: '/account' });
    return h.stuurJson(res, 200, { bericht: `Testmelding verstuurd naar ${n} apparaat/apparaten. Komt hij niet binnen, kijk dan of meldingen voor deze app aan staan in de telefooninstellingen.` }), true;
  }

  const apparaatMatch = pathname.match(/^\/account\/apparaat\/(\d+)\/verwijderen$/);
  if (apparaatMatch && methode === 'POST') {
    const d = db.prepare('SELECT * FROM apparaten WHERE id = ? AND gebruiker_id = ?').get(Number(apparaatMatch[1]), gebruiker.id);
    if (d) verwijderApparaat(d.id);
    return h.redirect(res, '/account?ok=' + encodeURIComponent('Apparaat verwijderd.')), true;
  }

  if (!pathname.startsWith('/beheer')) return false;
  // (De toegang tot /beheer is al gecontroleerd via de module "beheer".)

  if (pathname === '/beheer' || pathname === '/beheer/gebruikers') {
    return toon('Beheer', 'beheer', pagGebruikers(url)), true;
  }

  const gebruikerMatch = pathname.match(/^\/beheer\/gebruiker(?:\/([^/]+))?$/);
  if (gebruikerMatch) {
    const id = gebruikerMatch[1];
    const u = id ? db.prepare('SELECT * FROM gebruikers WHERE id = ? AND verwijderd = 0').get(id) : { actief: 1 };
    if (!u) return h.redirect(res, '/beheer/gebruikers'), true;
    if (methode === 'GET') return toon('Gebruiker', 'beheer', pagGebruiker({ u, ik: gebruiker, url })), true;
    if (methode === 'POST') {
      const v = await h.leesFormulier(req);
      const r = await slaGebruikerOp(v, gebruiker, id);
      if (r.fout) {
        const terug = { ...u, naam: v.naam, email: v.email, rolIds: (v._raw ? v._raw.getAll('rol_ids') : []).map(Number) };
        return toon('Gebruiker', 'beheer', pagGebruiker({ u: terug, ik: gebruiker, fout: r.fout }), 400), true;
      }
      return h.redirect(res, '/beheer/gebruikers?ok=' + encodeURIComponent('Gebruiker opgeslagen.')), true;
    }
  }

  const verwijderMatch = pathname.match(/^\/beheer\/gebruiker\/([^/]+)\/verwijderen$/);
  if (verwijderMatch && methode === 'POST') {
    const u = db.prepare('SELECT * FROM gebruikers WHERE id = ? AND verwijderd = 0').get(verwijderMatch[1]);
    if (!u) return h.redirect(res, '/beheer/gebruikers'), true;
    if (u.id === gebruiker.id) {
      return h.redirect(res, `/beheer/gebruiker/${u.id}?fout=` + encodeURIComponent('Je kunt jezelf niet verwijderen.')), true;
    }
    if (u.is_beheerder && !gebruiker.is_beheerder) {
      return h.redirect(res, `/beheer/gebruiker/${u.id}?fout=` + encodeURIComponent('Alleen een beheerder kan een beheerder verwijderen.')), true;
    }
    verwijderGebruiker(u, gebruiker);
    return h.redirect(res, '/beheer/gebruikers?ok=' + encodeURIComponent(`${u.naam} is verwijderd. Het e-mailadres ${u.email} is weer beschikbaar.`)), true;
  }

  const afmeldenMatch = pathname.match(/^\/beheer\/gebruiker\/([^/]+)\/apparaten-afmelden$/);
  if (afmeldenMatch && methode === 'POST') {
    meldAlleApparatenAf(afmeldenMatch[1]);
    logActie(gebruiker, 'Apparaten afgemeld', 'gebruiker', afmeldenMatch[1]);
    return h.redirect(res, `/beheer/gebruiker/${afmeldenMatch[1]}?ok=` + encodeURIComponent('Alle apparaten zijn afgemeld.')), true;
  }

  if (pathname === '/beheer/rechten') {
    if (methode === 'GET') return toon('Rechten', 'beheer-rechten', pagRechten(url)), true;
    if (methode === 'POST') {
      const v = await h.leesFormulier(req);
      const ins = db.prepare('INSERT OR REPLACE INTO rol_rechten (rol_id, module, niveau) VALUES (?, ?, ?)');
      for (const r of alleRollen()) {
        for (const [m] of MODULES) {
          const niveaus = (v._raw ? v._raw.getAll(`${r.id}_${m}`) : []).map(Number);
          ins.run(r.id, m, niveaus.length ? Math.max(...niveaus) : 0);
        }
      }
      logActie(gebruiker, 'Rechten gewijzigd', 'rechten');
      return h.redirect(res, `/beheer/rechten?rol=${encodeURIComponent(v.active_role || '')}&ok=` + encodeURIComponent('Rechten opgeslagen.')), true;
    }
  }

  if (pathname === '/beheer/instellingen') {
    if (methode === 'GET') return toon('Instellingen', 'beheer-instellingen', pagInstellingenBeheer(url)), true;
    if (methode === 'POST') {
      const v = await h.leesFormulier(req);
      const getal = (x, min, max) => Math.min(max, Math.max(min, parseInt(x, 10) || min));
      zetAppInstelling('verify_days', getal(v.verify_days, 1, 365));
      zetAppInstelling('unlock_hours', getal(v.unlock_hours, 1, 24 * 30));
      zetAppInstelling('pin_min_length', getal(v.pin_min_length, 4, 8));
      logActie(gebruiker, 'Instellingen gewijzigd', 'instellingen', null, `verify_days=${verifyDagen()}, unlock_hours=${ontgrendelUren()}, pin_min_length=${pinMinLengte()}`);
      return h.redirect(res, '/beheer/instellingen?ok=1'), true;
    }
  }

  if (pathname === '/beheer/testmail' && methode === 'POST') {
    const ok = await verstuurMail({
      naar: gebruiker.email,
      onderwerp: 'Testmail TransportManager',
      tekst: `Hallo ${gebruiker.naam},\n\nDit is een testmail. Als je dit leest, werkt het versturen van mail.`,
    });
    return h.redirect(res, '/beheer/instellingen?' + (ok ? 'ok=' + encodeURIComponent(`Testmail verstuurd naar ${gebruiker.email}.`) : 'fout=' + encodeURIComponent('Testmail versturen mislukt. Zie het containerlog.'))), true;
  }

  if (pathname === '/beheer/logboek' && methode === 'GET') return toon('Logboek', 'beheer-logboek', pagLogboek()), true;

  return false;
}

export { BEHEER, BEWERKEN, appInstelling };
