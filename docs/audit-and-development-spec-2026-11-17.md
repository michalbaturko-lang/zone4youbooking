# Zone4you: audit a realizační zadání, 17. 11. 2026

## Konečný výsledek lokální etapy

Všech 12 potvrzených nálezů A01–A12 je opravených. Níže uvedené popisy zachycují stav před opravou a předepsaná kritéria; aktuální implementace a regresní testy jsou součástí stejné větve. Navazující zadání je v `docs/next-development-handoff-2026-11-17.md`.

Závěrečná regrese na Node.js 24.22.3: 262/262 unit a kontraktních testů, 6/6 integračních testů nad skutečným místním PostgreSQL, 68 prohlížečových scénářů prošlo a 13 kombinací bylo záměrně vynecháno. Typecheck a produkční build prošly. Produkční dependency audit: 0 zranitelností; první pokus selhal dostupností registry, opakovaný doběhl úspěšně. Scan souborů a Git historie bez nalezeného secretu; nejde o záruku absence všech tajných údajů.

A02 má novou cílenou prohlížečovou reprodukci kombinace změny jazyka, opožděného přihlášeného snapshotu a logoutu při chybě následného čtení. Běžný login a změna jazyka jsou v existující regresi; samostatný injektovaný souběh pro každou jejich permutaci se netestoval. A05 má upravené CI a lokálně provedené SQL testy; vzdálený GitHub job po pushi ještě neběžel.

Rozsah auditu: bezpečnost a spolehlivost kritických cest aplikace. Nejde o penetrační test klubové infrastruktury ani o zátěžový test skutečné produkce. Testovací PostgreSQL běžel výhradně na lokálním loopbacku v jednorázovém clusteru. Žádný zápis do klubového API ani nasazení neproběhly.

## Rozsah a autorita

Základ: recovery PR #2, `35f0f1b`, a lokální opravy `6e24ece`. Audit zahrnuje HTTP/BFF, klienta a session, REST adaptér/mapování, kredit/rezervaci/storno, databázové ledgery a limiter, launch/readiness a CI. Protokoluje ruční čtení, cílené reprodukce, skutečné místní PostgreSQL testy a regresi aplikace. Žádný lokální test není důkazem funkčnosti klubové instance.

Goal: dokončit maximum vývoje nezávislého na IT/Luxartu; žádné další emaily, placené služby, DNS/deploy ani živé API mutace. Paušál Static IPs není schválený. Provozní/business potvrzení nelze nahrazovat booleany či domyšlenými hodnotami.

## Potvrzené nálezy a zadání

### A01 / P1: timeout klienta nekryje tělo odpovědi

- Zdroj: `src/lib/bookingApiClient.ts`, `apiRequest`: timer a přenos signálu se uklízí bezprostředně po `fetch`; `response.json()` se provádí až potom.
- Dopad: server pošle hlavičky a zbytek těla nedokončí; UI může zůstat neomezeně zaneprázdněné, i když deklaruje limit 20/45 sekund.
- Zadání: limit zahrne hlavičky i celé tělo. Odliší konečné HTTP zamítnutí od nejisté booking mutace. Neúplná/nečitelná úspěšná odpověď mutace nesmí vést na potvrzení úspěchu nebo slepý retry. Doplnit omezení velikosti browser odpovědi, bezpečné chyby a zachování request ID.
- Soubory: klient, klientské testy; podle potřeby malý sdílený parser.
- Přijetí: řízený HTTP server pošle hlavičky a drží tělo; čtení skončí časovým limitem, mutace skončí reconciliation; prázdné/HTML/neplatné JSON 2xx nedává úspěch; normální chyby zůstávají lokalizované.

### A02 / P1: UI může přijmout starší snapshot po novější akci

- Zdroj: `src/app/page.tsx`, `refresh`: každá dokončená žádost bez pořadové kontroly přepisuje snapshot, rules a capabilities. Locale effect, retry a refresh po login/logout mohou běžet souběžně.
- Dopad: opožděná odpověď před logoutem může znovu zobrazit osobní data; starší anonymní odpověď může přepsat novější login; starý CS požadavek může přepsat EN.
- Zadání: poslední zahájený platný refresh má přednost; nepoužitelné odpovědi nezmění data, loading ani chybu. Při login/logout invalidovat předchozí čtení ještě před mutací. Při potvrzeném logoutu ihned vyčistit klientská data i při selhání následného čtení. Zachovat stávající nejistý booking stav.
- Přijetí: browser scénář se záměrně zpožděným předchozím snapshotem pro logout, login a změnu jazyka; žádné znovuzobrazení starého účtu.

### A03 / P2: webhook čte neomezené tělo před kontrolou limitu

- Zdroj: `src/app/api/payments/webhook/route.ts`: při chybějící/lživé Content-Length se používá `request.text()` a až pak měří 1 MiB.
- Zadání: streamovaný byte limit před celým uložením; zachovat přesný raw obsah pro Stripe podpis. Oversize vrátí 413 a nesmí volat constructEvent/processEvent. Stripe zůstává vypnutý.
- Přijetí: chunked payload přes limit, odlišná Content-Length, tampered podpis; test zrušení streamu bez načtení celé nekonečné části.

### A04 / P2: platební schema readiness počítá omezení namísto ověření jejich významu

- Zdroj: `src/lib/paymentLedger.ts`, `assertReady`: MAX(version) a nejméně tři PK/UNIQUE nejsou důkazem unikátního event/session/intent ani jediného řádku verze.
- Dopad: schema se třemi jinými UNIQUE může projít readiness, přestože se ztratila ochrana před duplicitním kreditem.
- Zadání: ověřit konkrétní PRIMARY KEY event a UNIQUE Checkout Session i Payment Intent a přesně jednu podporovanou verzi.
- Přijetí: skutečný PostgreSQL: původní migrace projde; odstranění libovolného required constraintu a přidání decoy UNIQUE neprojde; druhá verze neprojde; souběh/replay testy nadále projdou.

### A05 / P2: hlavní CI vynechává skutečné SQL testy

- Zdroj: `package.json` spouští jen `tests/**/*.test.ts`; tři postgres soubory končí `.integration.ts`; `.github/workflows/quality.yml` nemá postgres job ani službu.
- Zadání: samostatný postgres quality job s lokální testovací službou a všechny tři integrační sady; použít existující SHA-pinned Actions. Žádné produkční secrets. Přidat společný testovací příkaz a provozní návod pro lokální izolovaný běh.
- Přijetí: skutečný lokální běh všech tří sad; konfigurace CI je validní a test detekuje odstranění jednotlivé sady z quality jobu. GitHub běh po pushi zůstane neověřený, dokud push není proveden.

## Další auditní otázky před uzavřením

- B01: ověřit, zda generické 404 v seznamu rezervací může skrýt chybné směrování a dovolit zápis s předpokládaným prázdným seznamem. Bez doloženého kontraktu 404 nepovažovat za potvrzený prázdný stav. Cílený test musí rozhodnout, zda opravovat bezpečným selháním.
- B02: úplnost/validace business profilu, shoda kontrolního CLI s runtime pro vlastní Reformer policy. Neodsouhlasené hodnoty zůstanou beze změny.
- B03: konzistence limitů a typů ID v routách oproti REST mapperu a ledgeru; vadné JSON struktury nesmějí dojít k zápisu.
- B04: chybové stavy session/Origin/limiteru, redakce výstupů, současná bezpečnostní hlavičková konfigurace a citlivé browser storage.

## Pořadí implementace a důkazy

1. Reprodukce A01/A03/A04 před opravou; izolovaná databáze už zprovozněna pouze na loopbacku. Tři dosavadní postgres testy prošly.
2. Opravy A01/A03/A04, cílené regresní testy.
3. A02 s browser scénáři, A05 a lokální postgres ověření.
4. Rozhodnout B01-B04 podle zdrojů a reprodukcí; potvrzené nálezy doplnit do seznamu a opravit.
5. Jedna úplná regrese po poslední změně: unit/integration, PostgreSQL, typecheck, build, Chromium/WebKit, dependency audit, secret scan a diff kontrola. Zelené dílčí testy nejsou náhradou této závěrečné regrese.
6. Lokální commity, přenositelný patch a auditní výstup s přesným testovaným SHA; seznam externích vstupů. Nenasazovat ani nezveřejňovat.

## Externí hranice (zůstávají otevřené)

IT: skutečná síťová varianta, správný HTTPS origin, TLS/proxy/VPN a správce. Luxart + IT: logovací redakce, testovací API/DB, bezpečné údaje a povolený test. Zone4you: okno rezervací, kredit, storno/no-show, Reformer, tester a pilotní rozsah. Luxart: resource mapa a aktivní emaily. Teprve potom skutečný D1, staging UAT, alert/rollback a samostatně schválený pilot. Žádná z těchto položek se nesmí vykázat hotová z mocku.

## Rozšířené potvrzené nálezy

- **A06 / P1 - chybějící seznam rezervací zaměněný za prázdný.** `realLuxartAdapter.getReservations` převáděl libovolné HTTP 404 na `[]`, ačkoliv přítomnost existující rezervace kontroluje před novým zápisem. Reprodukce chybného endpointu prokázala falešný prázdný seznam. Oprava: 404 je chyba upstreamu; nový zápis se neprovede. Totéž platí pro požadované kolekce kreditu a watchdogu. Prázdný seznam vyžaduje úspěšnou platnou JSON odpověď, případnou odlišnou skutečnou konvenci musí dodat Luxart.
- **A07 / P2 - rozdílná launch/runtime pravidla.** CLI vyžadovalo `lateCancellationAllowed=true` a Reformer `same_as_group`, zatímco runtime podporuje i zákaz pozdního storna a vlastní Reformer policy. Oprava: jeden sdílený čistý validátor pro oba spotřebitele; testy vlastního Reformeru, zakázaného pozdního storna, nesouladu i neplatných hodnot. Aktuální profil se neschvaluje ani nemění.
- **A08 / P1 - neurčený režim databázového poolu.** Booking ledger používá session-level advisory lock po dobu více dotazů a Luxart operace. Transakční/statement pooling tuto vlastnost nezajišťuje; předchozí obecné zadání „pooled TLS PostgreSQL“ bylo nedostatečné. Oprava: runtime/preflight i launch vyžadují `BOOKING_DATABASE_POOL_MODE=direct|session`, dokumentace a template vylučují transaction/statement. Skutečný režim poskytovatele musí potvrdit vlastník hostingu; deklarace není síťový důkaz. Zdroj: https://www.pgbouncer.org/features.html (session-level advisory locks: transaction pooling Never).
- **A09 / P2 - nevalidovaná úspěšná snapshot odpověď.** Typový cast přijal JSON `{}` nebo vadná vnořená data a předal je renderu. Oprava: runtime validace BFF snapshotu před změnou UI a demo storage; neplatný obsah způsobí řízenou retry chybu s request ID. Stejná validační hranice odmítá vadné potvrzení rezervace/storna.
- **A10 / P2 - korelace nejistého zápisu nebyla dohledatelná podle příručky.** API vytvářelo request ID až při odeslání chyby, ledger jej neukládá a 409 se standardně nelogovalo. Příručka přesto slibovala dohledání podle tohoto ID. Oprava: procesor při nejistém výsledku vytvoří bezpečný korelační log a ID předá až do klientské odpovědi; log obsahuje jen otisky pro dohledání ledgeru. Nový `inspect:booking-ledger` provádí pouze čtení a vypisuje stejné otisky neuzavřených stavů. Žádný automatický retry/uzavření nejisté operace.
- **A11 / P2 - nekonzistentní hranice vstupů.** JSON null/array/scalar a netextové lesson ID neměly stabilní validační chybu; storno route povolovala jen 128 znaků, ale ledger a mapper podporují identifikátory delší. Oprava: BFF vyžaduje JSON objekt, textový lesson ID do 256 bez kontrolních znaků a storno identifikátor do 320 podle ledgeru. Testy ověřují chybu před specifickým zpracováním.

## Přezkoumané oblasti bez samostatného potvrzeného nálezu

- Podpis a TTL session, duplicitní cookie, oddělení klientské/gateway autentizace, Origin kontrola a bezpečný logout.
- No-store HTTP hlavičky už jsou v `next.config.ts`; audit je nezavedl znovu jako domněle chybějící ochranu.
- REST adaptér má timeout i přes tělo odpovědi, limit 4 MiB a odmítá redirect autorizačních hlaviček. Browser měl odlišné chování opravené v A01.
- Resource mapa, personalizovaná způsobilost, serverové čtení aktuální kapacity a zůstatku před booking zápisem, ruční smíření nejistých výsledků.
- Platební event/session/intent deduplikace a rate-limit souběh: skutečné SQL testy původně prošly, rozšířené testy zachytily slabou schema readiness A04.
- CS/EN katalogy, mobilní/desktopové scénáře a přístupnost jsou součástí regrese; nové schválení business pravidel z nich nelze odvodit.

## Rozsah mapy a hranice důkazu

Graphify strukturálně zpracovalo 61 zdrojových souborů; mapa má 537 uzlů a 1608 hran. Je navigační pomůckou, nikoli důkazem bezpečnosti: JSON katalogy nevytvořily AST uzly, 47 odkazů nemá rozpoznaný koncový uzel a 16 dvojic hran bylo sloučeno. Kritické cesty byly proto čteny a reprodukovány přímo. Audit není jen hledání TODO ani přepis předchozí dokumentace. Netvrdí však manuální přečtení každého řádku historických prezentačních HTML, cizích knihoven nebo kontrolu nedostupné klubové infrastruktury.

- **A12 / P2 - neobsloužené idle chyby a neomezené databázové dotazy.** Všechny tři produkční pooly měly pouze timeout navázání spojení. Chyběl listener pool `error`, takže výpadek idle spojení mohl ukončit proces, a již zahájené SQL mohlo čekat bez query limitu. Oprava: sdílená továrna nastaví serverový statement timeout 5 s, klientský limit 6 s a PII-safe pool event. Testy ověřují emitovanou idle chybu bez pádu a skutečné PostgreSQL zrušení pomalého dotazu kódem 57014 i další použitelnost poolu. Zdroj: https://node-postgres.com/features/pooling .

## Nález při skutečném nasazení

**A13 / P1 - readiness neodpovídala produkčnímu adapter guardu.** Staged produkční build revize cca183a vracel readiness ready/demo, ale `/api/lessons` vracel 400, protože adapter zakazoval jakýkoliv mock na Vercel production. Hlavní adresa se nepřepnula. Dva nové testy nad původním kódem reprodukovaly nesoulad. Oprava sdílí rozhodnutí mezi adapterem a readiness: produkční hosting přijme demo pouze při obou výslovných hodnotách `LUXART_MOCK=true` a `NEXT_PUBLIC_APP_ENV=demo`; readiness jinak vrací 503. Skutečná aplikace `NEXT_PUBLIC_APP_ENV=production` stále mock odmítá. Výsledek novějšího nasazení a CI je v samostatném protokolu, původní lokální výsledky výše zachycují etapu před A13.
