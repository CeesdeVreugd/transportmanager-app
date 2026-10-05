# Transport Manager — De Vreugd Transport

Versie 8 (8.0.0) · Node.js 22 · SQLite (`node:sqlite`) · Docker / Portainer

Huisstijl, inloggen en beheer zijn gelijk aan **WorkPortal** (De Vreugd
Productietechniek), met "Transport" in het logo en zonder payoff.

Compleet planning-, uitvoerings- en beheersysteem voor een transportbedrijf:
de planner plant ritten en routes, houdt klanten/tarieven/voertuigen bij en
ziet in één dashboard hoe het bedrijf ervoor staat; chauffeurs zien op hun
telefoon hun eigen dag, werken taken bij (onderweg/afgerond), uploaden
documenten (CMR, pakbon, foto's — desnoods rechtstreeks met de camera) en
zetten een digitale handtekening.

Gebouwd met zo min mogelijk externe packages — puur met de ingebouwde tools
van Node.js (`node:sqlite`, `node:http`, `node:crypto`). Er is precies één
bewuste uitzondering: het pakket `web-push`, nodig voor echte pushmeldingen
naar de telefoon van chauffeurs. In Docker wordt dat automatisch
geïnstalleerd tijdens het bouwen van de image.

## Mappen

```
TransportManager-App\
├── 1 Info\
├── 2 Oude versie's\
├── TransportManager\              <- hostmap = git-kopie van GitHub (niet zelf in werken)
├── transportmanager-app-V8.zip
└── transportmanager-app-V8\       <- uitgepakte zip (bestanden staan direct in de root)
    ├── publiceren.cmd             <- naar GitHub publiceren
    ├── Dockerfile
    ├── docker-compose.yml         <- stack voor Portainer
    ├── docker-entrypoint.sh
    ├── .env.example               <- overzicht omgevingsvariabelen
    ├── package.json
    ├── src\                       <- server (Node.js)
    ├── public\                    <- css, js, logo, iconen, service worker
    └── scripts\
```

GitHub: https://github.com/CeesdeVreugd/transportmanager-app

Alle gegevens (database `transport.db`, geüploade CMR's/pakbonnen/foto's/
handtekeningen in `uploads/`, back-ups in `backups/` en de OneDrive-koppeling)
staan in het Docker-volume `transportmanager-data` (in de container: `/data`).
Updaten via "Pull and redeploy" laat die gegevens staan. Databasewijzigingen
worden bij het opstarten automatisch en zonder dataverlies doorgevoerd.

## Installeren in Portainer (eerste keer)

1. Pak de zip uit in `TransportManager-App` (bijv.
   `TransportManager-App\transportmanager-app-V1`) en dubbelklik op
   **`publiceren.cmd`**. De eerste keer haalt het script de (lege)
   GitHub-repository op in de hostmap `TransportManager`, zet de bestanden
   erin en pusht naar GitHub.
2. Portainer → Stacks → Add stack → **Repository**:
   - Name: `transportmanager-app`
   - Repository URL: `https://github.com/CeesdeVreugd/transportmanager-app`
     (bij een privé-repo: Authentication aan, met GitHub-gebruikersnaam en
     een personal access token — zelfde als bij de andere stacks)
   - Repository reference: `refs/heads/main`
   - Compose path: `docker-compose.yml`
3. Environment variables invullen in de Portainer-UI. **Neem de waarden over
   uit de oude omgeving** (Railway → Variables) en voor mail dezelfde
   app-registratie als WorkPortal:

| Variabele | Uitleg |
|---|---|
| `APP_URL` | **Verplicht.** `https://transportmanager.devreugd-pt.nl`. Bepaalt ook of cookies Secure zijn |
| `ADMIN_EMAIL` / `ADMIN_NAME` | **Verplicht.** Eerste beheerder (Directie + Beheerder), wordt bij de start aangemaakt als dit account nog niet bestaat |
| `SECRET_KEY` | Lange willekeurige tekst (min. 40 tekens). Leeg = de app maakt er zelf een in `/data/secret_key`. Niet meer wijzigen: anders is iedereen uitgelogd |
| `GRAPH_TENANT_ID` / `GRAPH_CLIENT_ID` / `GRAPH_CLIENT_SECRET` | App-registratie Microsoft 365 (Mail.Send) — dezelfde als WorkPortal mag |
| `MAIL_FROM` | Mailbox waaruit verstuurd wordt (inlogcodes, welkomstmail, klant-e-mails) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Pushmeldingen. Gebruik **dezelfde** sleutels als in de oude omgeving |
| `VAPID_CONTACT_EMAIL` | Contactadres voor pushmeldingen, bijv. `info@devreugd-dt.nl` |
| `ORS_API_KEY` | OpenRouteService: automatische afstand, kaart, volgorde-optimalisatie |
| `RESEND_API_KEY` / `RESEND_AFZENDER` | Alternatief voor mail, alleen als `GRAPH_*` leeg is |
| `ONEDRIVE_CLIENT_ID` / `ONEDRIVE_TENANT_ID` | Back-ups ook naar OneDrive (tenant standaard `common`) |
| `TM_MEM_LIMIT` | Geheugengrens container, standaard `1g` |

4. Klik op **Deploy the stack**. Controle: in Portainer → Containers staat
   `transportmanager-app` op *healthy*; `https://<adres>/health` geeft
   `{"status":"ok"}`.
5. Nginx Proxy Manager → Proxy Host toevoegen:
   - Domain: `transportmanager.devreugd-pt.nl` (DNS moet naar het publieke IP wijzen)
   - Forward Hostname: `transportmanager-app`, Forward Port: `3000`, scheme `http`
   - **Websockets Support** mag uit; **Block Common Exploits** aan
   - SSL: Let's Encrypt, **Force SSL**, HTTP/2 aan (HTTPS is verplicht voor
     pushmeldingen, camera en "Zet op beginscherm")
   - Tabblad Advanced (voor grote foto-uploads en het terugzetten van de database):
     `client_max_body_size 500m;`
6. Inloggen met `ADMIN_EMAIL` → code uit de mail → pincode instellen.
   Zonder mailinstellingen werkt de app in **testmodus**: de inlogcode staat
   dan in het containerlog (Portainer → Containers → `transportmanager-app` → Logs).

## Overzetten vanaf de oude omgeving (Railway)

Eenmalig, nadat de nieuwe omgeving draait. Doe dit op een rustig moment
(liefst als de chauffeurs niets invoeren), en laat de oude omgeving nog even
bestaan tot alles gecontroleerd is.

1. **Oude omgeving** → Back-ups → **Nu back-uppen** → download de nieuwste
   back-up (`transport-backup-....db`).
2. **Nieuwe omgeving** → log in met `ADMIN_EMAIL` (e-mailcode + pincode) →
   Back-ups → onderaan **Overzetten vanaf de oude omgeving** → Stap 1:
   kies het `.db`-bestand → **Database terugzetten**. De app herstart zichzelf
   (± 10 seconden) en gebruikt dan de oude database. De vorige (lege)
   database blijft bewaard als `backups/voor-herstel-....db`.
3. Log opnieuw in (e-mailcode + pincode). Alle gebruikers uit de oude
   omgeving zijn automatisch omgezet: planners → functierol **Planning** +
   **Beheerder** (dezelfde toegang als voorheen), chauffeurs → functierol
   **Chauffeur**. Iedereen logt voortaan in met zijn eigen e-mailadres;
   wachtwoorden en de oude chauffeurscodes vervallen.
4. Back-ups → Overzetten → Stap 2: vul het adres van de oude omgeving
   (bijv. `https://....up.railway.app`) en je **oude** planner-e-mail/wachtwoord in →
   **Bestanden ophalen**. De app haalt alle CMR's, pakbonnen, foto's en
   handtekeningen op die in de database staan. Ververs de pagina voor de
   voortgang; "Nu ontbreken er 0 bestand(en)" = compleet. Je kunt dit
   veilig vaker doen (al aanwezige bestanden worden overgeslagen).
5. Back-ups in de lijst die uit de oude omgeving komen zijn hier niet als
   bestand aanwezig; klik op **Nu back-uppen** voor een eerste nieuwe back-up.
6. OneDrive (indien gebruikt): opnieuw **Koppel OneDrive** in Back-ups.
7. **Chauffeurs**: het adres verandert, dus op de telefoon het oude icoon
   verwijderen, het nieuwe adres openen, opnieuw "Zet op beginscherm" en
   meldingen opnieuw toestaan.
8. Alles gecontroleerd? Dan kan de oude omgeving (Railway) uit.

## Publiceren / updaten

1. Pak de nieuwe zip uit in `TransportManager-App` (bijv.
   `TransportManager-App\transportmanager-app-V2`).
2. Dubbelklik op **`publiceren.cmd`** in die map. Het script:
   - haalt de eerste keer de repository
     `https://github.com/CeesdeVreugd/transportmanager-app.git` op in de
     hostmap `TransportManager-App\TransportManager`;
   - kopieert de nieuwe bestanden naar de hostmap (oude bestanden worden opgeruimd);
   - commit en pusht naar GitHub.
3. Portainer → stack `transportmanager-app` → **Pull and redeploy** (met
   "Re-pull image and redeploy"). Gegevens blijven staan.

## Lokaal draaien (ontwikkelen, zonder Docker)

```
npm install
node src/server.js
```

De app draait dan op http://localhost:3000 (of de poort uit `PORT`). De
data komt in de map `data/` (of in `DATA_DIR` als die is ingesteld). Node.js
22.5 of nieuwer is nodig.

## Huisstijl (gelijk aan WorkPortal)

Donkerblauw `#0A0A96` als basis, felblauw `#0080FF` als accent, lettertype
Ubuntu. Alle kleuren staan als variabelen bovenaan `public/styles.css` (dat
is de stylesheet van WorkPortal, met onderaan een laag die de bestaande
Transport-schermen dezelfde knoppen, kaarten, tabellen en velden geeft).

- Pc (breder dan 900 px): witte zijbalk met logo, label TRANSPORTMANAGER en
  menu per groep; witte bovenbalk met zoekveld, gebruiker en vergrendelknop.
- Telefoon: blauwe bovenbalk met het witte logo en een vaste onderbalk
  (Start, Ritten, Uren, Planning/Meldingen, Meer).
- Logo's in `public/img/` (`logo.png`, `logo-wit.png`): het WorkPortal-logo
  met "TRANSPORT" in plaats van "PRODUCTIETECHNIEK". Geen payoff.
- App-iconen gelijk aan WorkPortal: rond (`wp-round-*`) voor Android/pc,
  vierkant (`wp-app-*`) voor iPhone. Appnaam "TransportManager - DVT".
- De service worker cachet bewust niets: altijd de actuele versie.

## Inloggen

Zonder wachtwoord, zoals WorkPortal: e-mailadres → code van 6 cijfers per
mail (10 minuten geldig) → pincode per apparaat (4–8 cijfers). Daarna opent
de app direct het pinscherm. Elke 14 dagen opnieuw een e-mailcode
(instelbaar). Na 5 foute pincodes is weer een e-mailcode nodig. Na 12 uur
vergrendelt de app automatisch (instelbaar). Het slotje rechtsboven
vergrendelt; "Ander account" / "Dit apparaat vergeten" wist het apparaat.

## Rechten

Functierollen: **Administratie**, **Directie**, **Planning**, **Chauffeur**
(met de rolkleuren van WorkPortal). Per functierol en module:
**Geen · Lezen · Bewerken · Beheer** (Beheer = ook verwijderen). Een
gebruiker kan meerdere rollen hebben; per module geldt het hoogste recht.
Per gebruiker kunnen extra rechten worden gegeven. "Beheerder" = overal
alle rechten. Wie de rol Chauffeur heeft, kan aan ritten worden gekoppeld.

| Module | Administratie | Directie | Planning | Chauffeur |
|---|---|---|---|---|
| Mijn werk (ritopdrachten, uren, meldingen) | Geen | Bewerken | Bewerken | Bewerken |
| Planning (dashboard & ritten) | Lezen | Beheer | Beheer | Geen |
| Weekoverzicht, financieel & prijscalculator | Beheer | Beheer | Bewerken | Geen |
| Wagenpark (voertuigen & incidenten) | Lezen | Beheer | Beheer | Geen |
| Relaties (klanten & tarieven) | Beheer | Beheer | Bewerken | Geen |
| Chauffeurs & uren | Bewerken | Beheer | Bewerken | Geen |
| Beheer (gebruikers, rechten & back-ups) | Beheer | Beheer | Geen | Geen |

**Gebruiker verwijderen** (Beheer → Gebruikers → gebruiker → *Gebruiker
verwijderen*, recht Beheer op de module Beheer): de gebruiker verdwijnt uit
Beheer en de keuzelijsten, wordt overal afgemeld en het e-mailadres is weer
vrij voor een nieuw account. Op de achtergrond blijft de naam bewaard, zodat
ritten, uren, incidenten en het logboek gewoon blijven kloppen. Jezelf
verwijderen kan niet; een beheerder kan alleen door een beheerder worden
verwijderd. Tijdelijk blokkeren = vinkje *Actief* uitzetten.

Aan te passen in **Beheer → Rechten per functierol**. Beheer heeft verder
de tabbladen Gebruikers (met apparaten afmelden), Instellingen (verifiëren,
vergrendelen, pincodelengte, testmail, status koppelingen), Back-ups en
Logboek.

## Chauffeursdashboard (Mijn dag)

Opgebouwd als het WorkPortal-dashboard: begroeting met datum en weeknummer,
een blauwe kaart *Vandaag* (status, sinds wanneer, voor welke opdrachtgever,
gewerkt / gereden / opdrachten vandaag), vier tegels (uren deze week met
balk t.o.v. 40 uur, gereden km deze week, geplande ritten, openstaand),
*Komende ritten & opdrachten* (ritten én openstaande stops uit routes) en
*Deze week* (staafjes per dag met uren en km, plus weektotaal).

Op de telefoon worden tabellen automatisch kaartjes (label links, waarde
rechts; lege waarden verborgen), staan formuliervelden en knoppen onder
elkaar over de volle breedte en hebben tussenkopjes vaste ruimte.

## Klant zoeken en direct aanmaken

Overal waar een klant / opdrachtgever gekozen wordt (rit,
urenregistratie, dagstaat) staat een zoekveld: typ een deel van de naam en
kies. Wie het recht **Bewerken op Relaties** heeft (standaard Directie,
Planning, Administratie en beheerders), ziet onderaan de lijst
*+ Nieuwe klant "…" aanmaken*: de klant wordt meteen aangemaakt en gekozen.
Adres, contactgegevens en tariefafspraken vul je later aan bij Klanten.
Chauffeurs kunnen wel zoeken, maar geen klanten aanmaken.

## Ritopdrachten voor de chauffeur (vanaf V7)

De chauffeur ziet zijn ritten onder **Ritten** met twee tabbladen:
**Actief** (lopende ritten en ritten van vandaag) en **Gepland** (komende
dagen). Elke rit is een kaart met Rit ID (oplopend ritnummer vanaf 1001),
naam, opdrachtgever, voertuig en aantal stops, een groene knop **Start met
de rit** en daaronder de genummerde stops (START, LADEN, LOSSEN) met adres,
tijdvenster en opmerking. De ronde blauwe pijl opent de navigatie
(Google Maps) naar die stop. Tijdens de rit rondt de chauffeur elke stop
af (per ongeluk afgerond? tik nogmaals om ongedaan te maken); de volgende
stop wordt gemarkeerd. Oude ritten met alleen een ophaal- en afleveradres
krijgen automatisch twee stops.

De module Sjablonen is in V7 verwijderd.

## Huidige locatie (pin-knop, vanaf V8)

In de urenregistratie (dag starten, aankomst bij een stop, opdracht
afsluiten, volgende opdracht) staat rechts in het plaatsveld een pin-knopje.
Tik erop: de telefoon geeft de GPS-positie door (eenmalig toestemming
geven), de app zoekt de plaats op en vult die in; het volledige adres staat
eronder ter controle. Opzoeken gaat via OpenRouteService (ORS_API_KEY) en
anders via OpenStreetMap. Werkt alleen via https (de echte app-URL).

## Wat de app allemaal doet

**Planner (menu links, in groepen):**

- **Planning** — Dashboard, Ritten (met naam, starttijd, startplaats en
  een lijst stops: laden/lossen/overig, per stop een adres, tijdvenster en
  opmerking voor de chauffeur), Routes (met taken per route, kaart en
  automatische volgorde-optimalisatie).
- **Overzichten** — Weekoverzicht (factureerbaar bedrag per opdrachtgever
  per week, met Excel/CSV-export), Financieel (kostprijs/klantprijs/marge
  per rit), Prijscalculator (kostprijs en voorstel-klantprijs berekenen).
- **Wagenpark** — Voertuigen (met automatische waarschuwingen bij
  verlopende APK/onderhoud/verzekering), Incidenten (meldingen met foto).
- **Relaties** — Klanten (met meerdere tariefafspraken per klant),
  Tarieven, Chauffeurs.

Daarnaast onder **Beheer**: Back-ups (handmatig een back-up maken,
downloaden, en optioneel automatisch wegschrijven naar OneDrive — zie
verderop).

**Chauffeur (mobiel-vriendelijk):**

Na inloggen komt de chauffeur op een **beginscherm** met een persoonlijke,
humoristische begroeting in het Betuws (afhankelijk van het tijdstip en de
dag), de eigen status (aan het werk sinds hoe laat, of niet), de gewerkte
uren deze week, de eerstvolgende rit(ten) en ongelezen meldingen. Links
bovenin zit een uitklapbaar **☰ Menu** met vier onderdelen:

- **Dashboard** — het beginscherm hierboven.
- **Ritopdrachten** — de eigen route(s) met alle taken in volgorde,
  inclusief kaart. Een taak wordt bijgewerkt (onderweg/afgerond, met
  waarschuwing bij een gemist tijdvenster), met bij het afronden: CMR,
  pakbon en eventueel een foto (rechtstreeks met de camera of uit de
  galerij) en een digitale handtekening op het scherm.
- **Urenregistratie** — vervangt het papieren rittenformulier volledig.
  Met "Nieuwe dag beginnen" start de chauffeur de dag (beginstand km,
  eventueel een opdrachtgever). Eén dag kan uit meerdere **opdrachten**
  bestaan — bijv. 's ochtends klant A, 's middags klant B: onderweg voegt de
  chauffeur per stop een regel toe (plaats, activiteit, tijd aankomst/
  vertrek, km-stand) bij de lopende opdracht, sluit die opdracht af zodra
  hij van opdrachtgever wisselt ("Opdracht afsluiten" → eindstand km), en
  kan meteen daarna een volgende opdracht starten ("+ Opdracht toevoegen").
  Pas als alle opdrachten van de dag klaar zijn, sluit hij de hele dag af
  ("Dag afsluiten"), waarbij optioneel het brandstofverbruik (liters) kan
  worden ingevuld voor een km/liter-overzicht. Een vergeten dag kan altijd
  achteraf in één keer worden toegevoegd (met net zoveel opdrachten als
  nodig), en alle velden — van zowel chauffeur als planner ingevoerd —
  blijven achteraf corrigeerbaar (geen audit-trail, dat hoefde niet). De
  chauffeur ziet de eigen historie van de laatste 2 weken; de planner ziet
  bij elke chauffeur ("Chauffeurs" → "Uren") de volledige historie én kan
  daar (in tegenstelling tot de chauffeur) ook per opdracht de
  tariefafspraak instellen — chauffeurs zien nooit tarieven of prijzen. Het
  weekoverzicht (Excel/CSV-export) groepeert per opdrachtgever en
  tariefafspraak, met daaronder alle losse dagen (datum, chauffeur, uren,
  km) die in dat bedrag meetellen.
- **Meldingen** — hier meldt de chauffeur een incident of schade (met foto),
  los van de ritopdrachten, en ziet hij de eigen eerder gemelde incidenten.

**Pushmeldingen in plaats van een opstapelende lijst**: zodra een route
nieuw wordt toegewezen, gewijzigd, of van volgorde verandert, krijgt de
chauffeur een echte pushmelding op de telefoon (ook als de app niet open
staat). Een klik op de melding opent direct de betreffende route, waarna de
melding verdwijnt. Zie "Pushmeldingen instellen" hieronder om dit te
activeren.

**Automatisch, zonder dat iemand het hoeft te doen:**

- E-mail naar de klant zodra een rit op "onderweg" of "afgerond" wordt
  gezet (optioneel, zie "Klant-e-mails" hieronder).
- Dagelijkse back-up van de volledige database (en optioneel een kopie
  naar OneDrive, zie "Back-ups").
- Waarschuwingen op het voertuigen-overzicht bij een verlopende APK,
  onderhoudsbeurt of verzekering.

## Huisstijl aanpassen

Namen staan in `src/branding.js`, kleuren bovenaan `public/styles.css`,
logo's en iconen in `public/img/`.

## Prijsberekening (kostprijs & klantprijs)

Bij elke rit kun je automatisch een kostprijs en een voorstel-klantprijs
laten berekenen:

- **Voertuigen** → vul per voertuig een **kostprijs per km** in (dekt
  brandstof, onderhoud, bandenslijtage etc. in één bedrag per km).
- **Tarieven** → leg vaste **toltarieven** vast (bijv. per land of traject)
  en stel de **standaard marge** in die gebruikt wordt om een voorstel-
  klantprijs te berekenen (kostprijs + marge).
- Bij het aanmaken/bewerken van een rit: vink de van toepassing zijnde
  toltarieven aan, vul de kilometers in (of laat ze automatisch berekenen,
  zie hieronder), en de app toont meteen de geschatte kostprijs en een
  voorstel-klantprijs. De uiteindelijke klantprijs kun je altijd zelf
  aanpassen.
- **Financieel overzicht** en **Weekoverzicht** (in het menu) laten per
  periode zien wat de kostprijs, klantprijs en marge per rit/opdrachtgever
  was, met een totaalregel en Excel/CSV-export.
- Los van een rit kun je de **Prijscalculator** gebruiken om snel een
  losse prijsindicatie te maken zonder meteen een rit aan te maken.

### Automatische route-afstand, kaart en volgorde-optimalisatie (optioneel)

Standaard vul je de kilometers per rit zelf in — dat werkt prima. Wil je dat
de app de afstand automatisch berekent, een kaart van de route toont, en de
volgorde van taken optimaliseert? Dat kan via
[OpenRouteService](https://openrouteservice.org) (gratis):

1. Maak een gratis account aan op openrouteservice.org en vraag een
   API-sleutel aan ("Dashboard" → "Request a token").
2. Zet die sleutel als omgevingsvariabele **`ORS_API_KEY`** bij je
   Portainer-stack (Stacks → transportmanager-app → Environment variables →
   "Update the stack").
3. Klik in Portainer op "Update the stack" (herstart de app). Bij het inplannen van een rit verschijnt dan een werkende
   "Bereken automatisch"-knop, en op de routepagina verschijnt een kaart met
   alle taken plus een knop "Volgorde optimaliseren".

Zonder deze sleutel blijft alles gewoon werken — de knoppen tonen dan een
duidelijke melding en je vult/plant alles zelf.

## Klant-e-mails (optioneel)

Wil je dat de klant automatisch een e-mail krijgt zodra een rit "onderweg"
of "afgerond" wordt gezet? Dat gaat via dezelfde mailinstelling als de
inlogcodes (Microsoft 365: `GRAPH_*` + `MAIL_FROM`). Als alternatief kan
[Resend](https://resend.com):

1. Maak een gratis account aan op resend.com en vraag een API-sleutel aan.
2. Zet die sleutel als omgevingsvariabele **`RESEND_API_KEY`** bij je
   Portainer-stack `transportmanager-app`. Optioneel: **`RESEND_AFZENDER`** voor een eigen
   afzenderadres (anders wordt een standaard Resend-testadres gebruikt).
3. Klik in Portainer op "Update the stack" (herstart de app). Zorg dat er een e-mailadres bij de klant is ingevuld.

Zonder deze sleutel blijft alles gewoon werken — er wordt dan simpelweg
geen e-mail verstuurd.

## Back-ups

De app maakt automatisch elke 24 uur een back-up van de volledige database
(en houdt de 14 meest recente bij), en je kunt op elk moment handmatig een
back-up maken via "Back-ups" rechtsboven in de app. Elke back-up kun je
daar ook downloaden.

### Back-ups ook naar OneDrive (optioneel)

Voor extra zekerheid — bijvoorbeeld als de server of de app ooit uitvalt —
kunnen back-ups automatisch ook naar OneDrive worden geüpload. Dit vraagt
een eenmalige, gratis app-registratie bij Microsoft (geen technische kennis
nodig, geen client secret):

1. Ga naar `entra.microsoft.com` (of portal.azure.com) → "App-registraties"
   → "Nieuwe registratie".
2. Naam: bijv. "De Vreugd Transport Back-ups". Bij "Ondersteunde
   accounttypen" kies: "Accounts in elke organisatiemap en persoonlijke
   Microsoft-accounts".
3. Na aanmaken: ga naar "Verificatie" (Authentication) → zet "Sta openbare
   clientstromen toe" (Allow public client flows) op **Ja** → opslaan.
4. Ga naar "API-machtigingen" → voeg Microsoft Graph-machtiging
   `Files.ReadWrite` en `offline_access` toe (delegated).
5. Kopieer de "Toepassings-id (client)" van de overzichtspagina.
6. Zet in Portainer (stack `transportmanager-app`) de omgevingsvariabele
   **`ONEDRIVE_CLIENT_ID`** met die waarde, en klik "Update the stack".
7. Ga in de app naar "Back-ups" → klik op "Koppel OneDrive" → volg de
   code-instructies op het scherm (eenmalig, in een browser).

Zonder deze stappen blijft alles gewoon werken — lokale back-ups (en
downloaden) blijven altijd beschikbaar, ook zonder OneDrive.

## VAPID-sleutels en ORS_API_KEY overnemen

Neem beide over uit de oude omgeving (Railway → service → **Variables**):
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, (`VAPID_CONTACT_EMAIL`) en
`ORS_API_KEY`. Zet ze in Portainer bij de stack `transportmanager-app` →
*Update the stack*. Controle: Beheer → Instellingen → Pushmeldingen en
Routeberekening staan op *Ingesteld*. De routeberekening gebruikt het
vrachtwagenprofiel van OpenRouteService (`driving-hgv`, heel Europa).

## Meldingen aanzetten (per apparaat)

Een browser vraagt alleen toestemming na een klik. Daarom (zoals WorkPortal):
**Mijn account → Meldingen aanzetten** en **Testmelding sturen**. Zolang de
meldingen op een apparaat uit staan, staat bovenaan de app een balk met de
knop *Meldingen aanzetten* (wegklikbaar). Werkt voor iedereen, niet alleen
chauffeurs. iPhone/iPad: eerst *Zet op beginscherm* en de app vanaf dat icoon
openen.

## Pushmeldingen instellen

Chauffeurs krijgen een echte pushmelding op hun telefoon zodra er een
nieuwe of gewijzigde route is (zie hierboven). Dit werkt via de open
webstandaard Web Push en kost niets, maar vraagt eenmalig een sleutelpaar
(VAPID-sleutels):

1. Genereer eenmalig een sleutelpaar (kan lokaal, met Node.js — er is geen
   account of website voor nodig):
   ```
   node src/push.js --genereer-sleutels
   ```
   Dit print twee regels met een publieke en een privésleutel.
2. Zet beide als omgevingsvariabelen in de Portainer-stack
   `transportmanager`: **`VAPID_PUBLIC_KEY`** en
   **`VAPID_PRIVATE_KEY`**, met de zojuist gegenereerde waarden.
3. Klik in Portainer op "Update the stack" (herstart de app).
4. Elke chauffeur die inlogt krijgt (eenmalig) een verzoek van de telefoon/
   browser om meldingen toe te staan — na akkoord ontvangt die chauffeur
   voortaan pushmeldingen.

**Op een iPhone**: pushmeldingen werken alleen als de app eerst via Safari
is "toegevoegd aan het beginscherm" (deel-knop → "Zet op beginscherm") en
vervolgens vanaf dat icoon wordt geopend — rechtstreeks in Safari werkt
Apple's pushondersteuning niet. Op Android werkt het gewoon vanuit de
browser, een toevoeging aan het beginscherm is daar niet nodig maar wel
prettig.

Zonder deze sleutels blijft de app gewoon volledig werken — er wordt dan
alleen geen pushmelding verstuurd (de melding staat dan alsnog klaar in de
app zelf, op het beginscherm en bij Ritopdrachten).

## Volgende mogelijke uitbreidingen

Deze versie dekt zo goed als de volledige dagelijkse praktijk: planning,
ritbeheer, routes met kaart en documentafhandeling, prijsberekening,
klantcommunicatie, voertuigbeheer, rapportages en back-ups. Wat nog niet
is meegenomen (bewust, op verzoek): een koppeling met een boekhoudpakket
zoals Exact of Reeleezee (nu werkt export naar Excel/CSV) en vignetten in
de prijscalculator. Beide kunnen als latere, losse uitbreiding worden
toegevoegd.

**Dieseltoeslag (openstaand, wacht op gegevens):** Huisman Transport heeft
een dieseltoeslag-regeling, maar om dit goed in de prijscalculator/facturatie
in te bouwen zijn ook de exacte rekenformules van de ándere klanten met een
dieseltoeslag-afspraak nodig (tarief, welke referentieprijs als basis, op
welk moment/welke dag die wordt afgelezen, de precieze formule, en het
beleid bij een negatieve toeslag). Zodra die gegevens er zijn, kan dit
gebouwd worden.

**Meerdaagse ritten (bewust niet aangepast):** een rit die middenin de nacht
over meerdere kalenderdagen loopt (bijv. vrijdag 03:30 tot zaterdag 13:00)
kan het beste als twee losse werkdagen worden ingevoerd, gesplitst rond
middernacht — de tijdregistratie rekent namelijk per kalenderdag. Dit is
op verzoek niet verder aangepast.

### Ritopdrachten met duidelijke, stap-voor-stap uitvoering (openstaand)

De chauffeur gaf duidelijke feedback (met voorbeeldfoto's van een andere
transportplanner-app) dat "Ritopdrachten" overzichtelijker en duidelijker
mag: een chauffeur wil tijdens het rijden in één oogopslag zien welke stop
nu aan de beurt is en wat daar te doen staat. Concreet, voor een latere
uitbreiding:

- Een genummerde stoplijst per rit (Start, Stop 1, Stop 2, ..., Eind) met
  per stop een duidelijk label van de activiteit (LADEN, LOSSEN, PAUZE,
  TANKEN, etc.) en een geschatte aankomsttijd (ETA).
- Eén druk op de knop om vanaf de huidige locatie naar de volgende stop te
  navigeren (rechtstreeks naar Google Maps/Apple Maps).
- Tabs "ACTIEF" / "GEPLAND" zodat de chauffeur meteen ziet welke rit nu
  loopt en welke nog moeten komen.
- Eén grote, duidelijke knop "Start met de rit" om een geplande rit te
  starten.

Dit is bewust losgekoppeld van de urenregistratie (die inmiddels wel al in
deze duidelijke, stap-voor-stap stijl is gebouwd) en wordt als los,
vervolg-onderwerp opgepakt.
