# Transport Manager — De Vreugd Transport

Versie 1 (1.0.0) · Node.js 22 · SQLite (`node:sqlite`) · Docker / Portainer

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
├── transportmanager-app-V1.zip
└── transportmanager-app-V1\       <- uitgepakte zip (bestanden staan direct in de root)
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
   - Name: `transportmanager`
   - Repository URL: `https://github.com/CeesdeVreugd/transportmanager-app`
     (bij een privé-repo: Authentication aan, met GitHub-gebruikersnaam en
     een personal access token — zelfde als bij de andere stacks)
   - Repository reference: `refs/heads/main`
   - Compose path: `docker-compose.yml`
3. Environment variables invullen in de Portainer-UI. Alles is optioneel;
   **neem de waarden over uit de oude omgeving** (Railway → Variables):

| Variabele | Uitleg |
|---|---|
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Pushmeldingen. Gebruik **dezelfde** sleutels als in de oude omgeving |
| `VAPID_CONTACT_EMAIL` | Contactadres voor pushmeldingen, bijv. `info@devreugd-dt.nl` |
| `ORS_API_KEY` | OpenRouteService: automatische afstand, kaart, volgorde-optimalisatie |
| `RESEND_API_KEY` / `RESEND_AFZENDER` | E-mail naar de klant bij "onderweg"/"afgerond" |
| `ONEDRIVE_CLIENT_ID` / `ONEDRIVE_TENANT_ID` | Back-ups ook naar OneDrive (tenant standaard `common`) |
| `TM_MEM_LIMIT` | Geheugengrens container, standaard `1g` |

4. Klik op **Deploy the stack**. Controle: in Portainer → Containers staat
   `transportmanager-app` op *healthy*; `https://<adres>/health` geeft
   `{"status":"ok"}`.
5. Nginx Proxy Manager → Proxy Host toevoegen:
   - Domain: bijv. `transport.<jouwdomein>.nl` (DNS moet naar het publieke IP wijzen)
   - Forward Hostname: `transportmanager-app`, Forward Port: `3000`, scheme `http`
   - **Websockets Support** mag uit; **Block Common Exploits** aan
   - SSL: Let's Encrypt, **Force SSL**, HTTP/2 aan (HTTPS is verplicht voor
     pushmeldingen, camera en "Zet op beginscherm")
   - Tabblad Advanced (voor grote foto-uploads en het terugzetten van de database):
     `client_max_body_size 500m;`
6. Bij een **lege** database maakt de app één planner-account aan en zet de
   inloggegevens éénmalig in het log: Portainer → Containers →
   `transportmanager-app` → Logs. Ga je de gegevens overzetten (zie
   hieronder), dan is dit account alleen nodig om in te loggen voor het
   terugzetten.

## Overzetten vanaf de oude omgeving (Railway)

Eenmalig, nadat de nieuwe omgeving draait. Doe dit op een rustig moment
(liefst als de chauffeurs niets invoeren), en laat de oude omgeving nog even
bestaan tot alles gecontroleerd is.

1. **Oude omgeving** → Back-ups → **Nu back-uppen** → download de nieuwste
   back-up (`transport-backup-....db`).
2. **Nieuwe omgeving** → log in met het eenmalige account uit het log →
   Back-ups → onderaan **Overzetten vanaf de oude omgeving** → Stap 1:
   kies het `.db`-bestand → **Database terugzetten**. De app herstart zichzelf
   (± 10 seconden) en gebruikt dan de oude database. De vorige (lege)
   database blijft bewaard als `backups/voor-herstel-....db`.
3. Log opnieuw in, nu met je **eigen account uit de oude omgeving**.
4. Back-ups → Overzetten → Stap 2: vul het adres van de oude omgeving
   (bijv. `https://....up.railway.app`) en je planner-e-mail/wachtwoord in →
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
3. Portainer → stack `transportmanager` → **Pull and redeploy** (met
   "Re-pull image and redeploy"). Gegevens blijven staan.

## Lokaal draaien (ontwikkelen, zonder Docker)

```
npm install
node src/server.js
```

De app draait dan op http://localhost:3000 (of de poort uit `PORT`). De
data komt in de map `data/` (of in `DATA_DIR` als die is ingesteld). Node.js
22.5 of nieuwer is nodig.

## Wat de app allemaal doet

**Planner (navigatie boven in 4 groepen):**

- **Planning** — Dashboard, Ritten, Routes (met taken per route, kaart en
  automatische volgorde-optimalisatie), Sjablonen (vaste/terugkerende
  ritten met één klik opnieuw inplannen).
- **Overzichten** — Weekoverzicht (factureerbaar bedrag per opdrachtgever
  per week, met Excel/CSV-export), Financieel (kostprijs/klantprijs/marge
  per rit), Prijscalculator (kostprijs en voorstel-klantprijs berekenen).
- **Wagenpark** — Voertuigen (met automatische waarschuwingen bij
  verlopende APK/onderhoud/verzekering), Incidenten (meldingen met foto).
- **Relaties** — Klanten (met meerdere tariefafspraken per klant),
  Tarieven, Chauffeurs.

Daarnaast, rechtsboven: **Back-ups** (handmatig een back-up maken,
downloaden, en optioneel automatisch wegschrijven naar OneDrive — zie
verderop) en het eigen wachtwoord wijzigen.

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

Alle merkinstellingen staan in `src/branding.js` (bedrijfsnaam, kleuren).
Het logo staat in `public/logo.png`. Na een wijziging van de kleuren kun je
de app-iconen opnieuw genereren met:

```
NODE_PATH="$(npm root -g)" node scripts/generate-icons.cjs
```

(dit script gebruikt het pakket `sharp`; nodig is dat alleen tijdens
ontwikkelen, niet op de live server).

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
   Portainer-stack (Stacks → transportmanager → Environment variables →
   "Update the stack").
3. Klik in Portainer op "Update the stack" (herstart de app). Bij het inplannen van een rit verschijnt dan een werkende
   "Bereken automatisch"-knop, en op de routepagina verschijnt een kaart met
   alle taken plus een knop "Volgorde optimaliseren".

Zonder deze sleutel blijft alles gewoon werken — de knoppen tonen dan een
duidelijke melding en je vult/plant alles zelf.

## Klant-e-mails (optioneel)

Wil je dat de klant automatisch een e-mail krijgt zodra een rit "onderweg"
of "afgerond" wordt gezet? Dat kan via [Resend](https://resend.com)
(gratis voor een beperkt aantal e-mails per maand):

1. Maak een gratis account aan op resend.com en vraag een API-sleutel aan.
2. Zet die sleutel als omgevingsvariabele **`RESEND_API_KEY`** bij je
   Portainer-stack `transportmanager`. Optioneel: **`RESEND_AFZENDER`** voor een eigen
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
6. Zet in Portainer (stack `transportmanager`) de omgevingsvariabele
   **`ONEDRIVE_CLIENT_ID`** met die waarde, en klik "Update the stack".
7. Ga in de app naar "Back-ups" → klik op "Koppel OneDrive" → volg de
   code-instructies op het scherm (eenmalig, in een browser).

Zonder deze stappen blijft alles gewoon werken — lokale back-ups (en
downloaden) blijven altijd beschikbaar, ook zonder OneDrive.

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
