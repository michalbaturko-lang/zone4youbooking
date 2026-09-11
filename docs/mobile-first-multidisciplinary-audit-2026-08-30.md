# Zone4You booking — mobile-first a multidisciplinární audit

**Datum:** 30. 8. 2026

**Rozsah:** omezený pilot všech položek `api/Lesson`, všechny sály včetně Reformeru, přesně 7 pražských kalendářních dnů, CZ/EN

**Aktuální verdikt:** **NO-GO pro živé rezervace**, **GO pro další lokální vývoj a read-only staging po doplnění infrastruktury**

## 1. Manažerské shrnutí

Základ produktu je technicky vyspělý: rozvrh, přihlášení, kredit, rezervace, storno, oblíbené, CZ/EN, bezpečné session, idempotence zápisů, read-only fallback, release gate a rollback kontrakt už existují. Demo feed obsahuje 24 výskytů, všechny tři sály a 3 Reformery v přesném sedmidenním rozsahu.

Audit našel a lokálně opravil šest důležitých mezer:

1. dotykové cíle 30–40 px byly zvětšeny na minimálně 44 × 44 px;
2. landscape 844 × 390 původně schoval celý rozvrh pod filtry; kompaktní landscape režim nyní ukáže tabulku už v prvním viewportu;
3. povinná angličtina měla české serverové chyby; anglický klient nyní používá bezpečné anglické texty podle kódu a nepropouští český upstream text;
4. bezplatný storno limit byl chybně použit jako úplné uzavření storna; nyní je oddělen bezplatný cutoff od samotné možnosti storna a UI umí pravdivě oznámit skutečný poplatek vrácený Luxartem;
5. dlouhá session-expiry hláška na 320px telefonu a nízkém landscape překrývala login dialog; při souběhu nyní dostane hláška vyhrazený horní prostor a dialog bezpečně scrolluje pod ní.
6. demo přenášelo půlnoční storno běžných lekcí i na Reformer; CZ/EN detail nyní jeho pravidlo výslovně označí za nepotvrzené a živý booking bez úplného profilu zůstává vypnutý.

Živý start stále blokují externí důkazy: přístup k Zone4You API, mapování sálů, povolený test rezervace/storna, výše pozdního storna a no-show, pravidlo Reformeru, rezervační okno, chování kreditu, pilotní uživatelé/support, produkční DNS/TLS, PostgreSQL, alerty, UAT a rollback drill.

## 2. Potvrzené a otevřené business podmínky

| Pravidlo | Stav | Aktuální zápis |
|---|---|---|
| Minimální kredit před rezervací | potvrzeno | 200 Kč |
| Bezplatné storno běžné lekce | potvrzeno s pracovní interpretací okamžiku | do začátku dne lekce, tedy do `00:00 Europe/Prague`; nejde o klouzavé X hodin |
| Pozdní storno po půlnoci | otevřeno | chybí částka a potvrzení, zda zůstává online storno povoleno až do začátku lekce |
| No-show | otevřeno | chybí částka |
| Reformer | otevřeno | chybí cutoff, pozdní poplatek, no-show a případné další odlišnosti |
| Rezervační okno | otevřeno | chybí otevření a uzavření rezervace |
| Kredit při rezervaci | otevřeno | chybí, zda se pouze kontroluje 200 Kč, nebo se částka blokuje/strhává |

`config/business-rules-profile.json` proto zůstává `provisional`. Zná půlnoc pro běžné lekce, ale neznámé hodnoty jsou explicitně `null`. Živý booking se bez úplného profilu, jeho přesného hashe a `BOOKING_RULES_CONFIRMED=true` nezapne.

## 3. Audit z různých úhlů

| Perspektiva | Verdikt | Důkaz / nález | Nutná další akce |
|---|---|---|---|
| Klient na mobilu | zelená lokálně | 320 × 568, 390 × 844, 768 × 1024 a 844 × 390: 0 page overflow, 24/24 lekcí v týdnu, ovládání ≥ 44 px, dialog uvnitř viewportu, scroll lock | zopakovat na stagingu v iOS Safari a Android Chrome |
| Klient na desktopu | zelená lokálně | 1440 × 900: 24/24 lekcí, týdenní tabulka, dialog bez overflow | staging smoke |
| Přístupnost | zelená automaticky, manuálně otevřeno | WCAG A/AA axe scan, focus trap, počáteční i vrácený focus, Escape, reduced-motion, 44px touch targets | krátký VoiceOver/TalkBack UAT se skutečným uživatelem |
| Angličtina | zelená lokálně | navigace, rozvrh, sály, login a klientské chyby jsou EN; serverová čeština se v EN režimu nepropustí | ověřit živé `lang=en` odpovědi Luxartu a všechny názvy sálů/služeb |
| Business správnost | červená pro launch | minimum 200 Kč a půlnoc známe; částky, Reformer, okno a kreditní mechanika chybí | písemné potvrzení Zone4You/Luxart |
| Luxart data | žlutá | validace odmítá prázdný feed, duplicity, neplatné časy, osmý den i jiný resort | živý 7denní CS/EN důkaz a mapování `cislo_salu → id_resource` |
| Rezervace/storno | žlutá lokálně, červená živě | server kontroluje login, kredit, kapacitu a okno; ledger brání duplicitě; storno čte skutečný `storno_poplatek` | povolená testovací mutace, replay/concurrency UAT a reconciliation důkaz |
| Bezpečnost a soukromí | zelená návrhem, žlutá provozně | HttpOnly HMAC session, Secure v produkci, SameSite Lax, exact-Origin kontrola, rate limit, délkové validace, žádné secrets v repu | produkční secret store, TLS PostgreSQL, Luxart gateway auth/allowlist a privacy review logů |
| Odolnost | zelená lokálně | fail-closed capabilities, persistentní outage stav, correlation ID, žádné slepé opakování nejisté mutace | staging outage test a skutečný rollback do 5 minut |
| Recepce/support | červená | UI odkazuje na recepci, ale není určen vlastník, kanál, služba ani reakční doba | jméno/on-call kontakt, postup eskalace a školení |
| Release/DNS | červená | cílová doména stále míří na cizí nginx, HTTPS hostname nesedí, Vercel nemá runtime konfiguraci | IT odpověď, vlastník DNS, staging deploy, certifikát a cutover approval |
| Výkon | žlutá | produkční build je statický shell; největší lokální JS chunk má cca 224 KiB a CSS cca 24 KiB nekomprimovaně | měřit staging na throttled mobile; splnit rozpočty P1–P4 níže |

## 4. Mobile-first browser evidence

| Viewport | Layout | Lekce v týdnu | Page overflow | Ovládání < 44 px | Dialog | Výsledek |
|---|---:|---:|---:|---:|---|---|
| 320 × 568 | mobilní seznam | 24/24 | 0 px | 0 | uvnitř, scrollovatelný, body lock | PASS |
| 390 × 844 | mobilní seznam | 24/24 | 0 px | 0 | uvnitř, scrollovatelný, body lock | PASS |
| 768 × 1024 | mobilní/tablet seznam | 24/24 | 0 px | 0 | uvnitř, bez nutnosti scrollu | PASS |
| 844 × 390 | kompaktní landscape tabulka | 24/24 | 0 px | 0 | uvnitř, scrollovatelný, body lock | PASS |
| 1440 × 900 | desktop tabulka | 24/24 | 0 px | 0 | uvnitř, bez nutnosti scrollu | PASS |

Horizontálně posuvné řady dnů a filtrů jsou záměrné lokální scrolly; dokument samotný se horizontálně neposouvá. Na 320 px je po optimalizaci vidět začátek první lekce nad pevnou spodní navigací. Na landscape je po opravě horní hrana tabulky přibližně 255 px, tedy uvnitř 390px viewportu.

## 5. Eval kritéria a launch gate

Všechna kritéria označená `MUST` musí být zelená. Jediný červený `MUST` znamená NO-GO.

### M — mobile first a přístupnost

| ID | Kritérium | Typ | Důkaz |
|---|---|---|---|
| M1 | 320/390/768/844 landscape/1440 bez globálního horizontálního overflow | MUST | automat + browser screenshot |
| M2 | každý viditelný button/input na dotykových profilech minimálně 44 × 44 px | MUST | DOM measurement |
| M3 | první obsah rozvrhu je vidět nad spodní navigací nebo uvnitř landscape viewportu | MUST | bounding-box assertion |
| M4 | dialog je celý uvnitř viewportu, interně scrolluje, body je zamčené | MUST | DOM measurement + interakce |
| M5 | Axe WCAG A/AA bez violation; Tab, Shift+Tab, Escape a návrat focusu | MUST | Playwright + axe |
| M6 | jeden manuální průchod VoiceOver nebo TalkBack bez P1 nálezu | MUST před veřejným rozšířením pilotu | podepsané UAT |

### F — funkce a data

| ID | Kritérium | Typ |
|---|---|---|
| F1 | přesně sedm pražských kalendářních dnů, žádný osmý den | MUST |
| F2 | všechny neprázdné položky `api/Lesson`, všechny sály a Reformer; žádný lokální allowlist lekcí | MUST |
| F3 | CS a EN vrací stejnou množinu occurrence ID a stejný interval | MUST |
| F4 | login → user/kredit → rezervace → reload → storno → logout projde proti test DB | MUST |
| F5 | opakování stejného idempotency key nevytvoří druhý zápis; nejistý výsledek vede k reconciliation | MUST |
| F6 | oblíbené přežijí reload na zařízení; zapomenuté heslo nikde není | MUST |

### B — business pravidla

| ID | Kritérium | Typ |
|---|---|---|
| B1 | minimum 200 Kč ověřené serverem těsně před Luxart zápisem | MUST |
| B2 | free cutoff `00:00 Europe/Prague` otestovaný v zimě, létě i přes DST | MUST |
| B3 | pozdní storno, no-show, Reformer, rezervační okno a kreditní mechanika písemně potvrzeny | MUST |
| B4 | potvrzený profil odpovídá implementaci a schválenému SHA-256 | MUST |
| B5 | UI po stornu ukazuje skutečný poplatek z Luxart odpovědi a neslibuje vrácení kreditu bez důkazu | MUST |

### S — bezpečnost, soukromí a provoz

| ID | Kritérium | Typ |
|---|---|---|
| S1 | produkce je `LUXART_MOCK=false`; booking zůstane vypnutý při chybějícím DB/rules/auth | MUST |
| S2 | Secure HttpOnly cookie, silný secret, exact Origin, rate limit a PostgreSQL mutation ledger | MUST |
| S3 | žádné heslo, klíč, osobní data nebo plná Luxart ID v release důkazech/logu | MUST |
| S4 | alert dorazí určenému support vlastníkovi; rollback do read-only do 5 minut | MUST |
| S5 | DNS, HTTPS, commit, region `fra1`, capabilities a CS/EN feed projdou post-cutover ověřovačem | MUST |

### P — výkonové rozpočty pro staging

Toto jsou projektové rozpočty, nikoli tvrzení o současné produkci:

| ID | Kritérium na reprezentativním mobilním profilu | Typ |
|---|---|---|
| P1 | LCP p75 ≤ 2,5 s | MUST |
| P2 | INP p75 ≤ 200 ms | MUST |
| P3 | CLS p75 ≤ 0,10 | MUST |
| P4 | počáteční komprimovaný přenos aplikace ≤ 1 MiB bez obrázku instruktora | SHOULD |
| P5 | změna dne/filtru má viditelnou odezvu ≤ 100 ms na středním telefonu | SHOULD |

## 6. Co přesně ještě potřebujeme

1. odpověď Zone4You IT podle `zone4you-it-access-request.md` a vyplnění `zone4you-it-response-intake.md`;
2. výši pozdního storna a no-show pro běžnou lekci;
3. potvrzení, zda lze po půlnoci online stornovat až do začátku lekce;
4. úplné pravidlo Reformeru;
5. otevření/uzavření rezervací a přesnou kreditní mechaniku;
6. pilotní seznam, support vlastníka a launch okno;
7. staging infrastrukturu, tajné hodnoty přímo v secret store, povolenou testovací mutaci a UAT;
8. explicitní cutover approval až po zeleném release dossieru.

Dokud body 1–7 nejsou doložené, lze bezpečně pokračovat ve vývoji, lokálním testování a přípravě read-only stagingu, ale nelze zapnout živé rezervace.
