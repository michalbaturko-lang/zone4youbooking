# Zone4You Booking

Řízený booking pilot pro Zone4You. Next.js aplikace obsahuje demo adapter i fail-closed reálnou Luxart vrstvu, PostgreSQL ochranu rezervací/storna, sdílený PostgreSQL rate limit pro multi-instance provoz, serverový Stripe Checkout, podepsaný webhook a samostatný platební ledger. Živé mutace zůstávají vypnuté do dokončení testovací integrace, UAT a výslovného cutover souhlasu.

Aktuální řízený launch plán, rozhodovací body, akceptační brány a E2E scénáře jsou v [`docs/launch-plan.md`](docs/launch-plan.md). Ověřený veřejný Luxart kontrakt je v [`docs/luxart-contract-findings-2026-08-29.md`](docs/luxart-contract-findings-2026-08-29.md) a jeho read-only kontrola z 11. 9. v [`docs/luxart-contract-refresh-2026-09-11.md`](docs/luxart-contract-refresh-2026-09-11.md). Stav hostingu a síťové varianty jsou v [`docs/hosting-readiness.md`](docs/hosting-readiness.md), požadavek pro IT v [`docs/zone4you-it-access-request.md`](docs/zone4you-it-access-request.md) a fail-closed vyhodnocení odpovědi o portu 9191 v [`docs/zone4you-it-response-intake.md`](docs/zone4you-it-response-intake.md).

## Spusteni

```bash
npm install
cp .env.example .env.local
npm run dev -- --port 3007
```

Demo URL:

```text
http://localhost:3007
```

Klientsky Vercel preview link je Shareable Link s tokenem v URL. Nepatri do verejneho repozitare; aktualni odkaz je soucasti handoff zpravy.

## Overeni

```bash
npm run quality
# Pouze proti izolovanému Vercel Preview, které samo prokáže demo/mock režim:
PLAYWRIGHT_EXTERNAL_DEMO_URL=https://zone4youbooking-...vercel.app/ \
PLAYWRIGHT_EXPECTED_DEMO_COMMIT=<přesný-40znakový-git-commit> npm run test:e2e
BOOKING_TEST_DATABASE_URL=postgresql:///postgres npm run test:booking-postgres
PAYMENT_TEST_DATABASE_URL=postgresql:///postgres npm run test:payments-postgres
RATE_LIMIT_TEST_DATABASE_URL=postgresql:///postgres npm run test:rate-limit-postgres
APP_BASE_URL=http://localhost:3007 npm run smoke:api
npm run check:launch
npm run verify:deployment-preflight
npm run probe:luxart-help
npm run verify:luxart-gateway-config
npm run verify:luxart-d1
npm run inspect:business-rules
npm run inspect:payment-product
# Po výběru staging alert kanálu a support vlastníka:
npm run verify:alert-delivery
# Bezprostředně před rollback drillem vytvoří owner-only startovní účtenku:
npm run start:readonly-rollback
# Ze živých JSON důkazů vytvoří pouze povinně NO-GO draft:
npm run prepare:pilot-release
# Až existují živé hashované důkazy a výslovný cutover souhlas:
npm run verify:pilot-release
# Až oprávněný správce podle zeleného dossieru přepne DNS:
npm run verify:production-cutover
```

`check:launch` v demo rezimu zamerne vraci `NO-GO`; produkce se nesmi spustit nad mock daty nebo nekompletnim Luxart adapterem. Ve fázi `booking_without_payments` označí čtyři infrastrukturní Stripe kontroly jako `SKIP`, ale současně vyžaduje `PAYMENT_MUTATIONS_ENABLED=false`; ve fázi `booking_with_stripe` jsou všechny platební kontroly povinné.

`verify:deployment-preflight` ověřuje vzájemnou shodu cíle, přesného commitu, fáze `read_only` / `booking_without_payments` / `booking_with_stripe`, capability přepínačů a runtime-only konfigurace. Výstup nikdy nevypisuje secrets ani upstream/databázové URL. Přesná staging/produkční matice je v [`docs/deployment-preflight.md`](docs/deployment-preflight.md).

`probe:luxart-help` je první bezpečný síťový test po získání přesné URL. Posílá jediný neautentizovaný `GET /Help`, zakazuje redirecty, omezuje čas i velikost odpovědi a do výsledku ukládá jen port, transport, HTTP stav a SHA-256 cíle/odpovědi. Rozliší nedostupnou síť, požadovanou gateway autentizaci a skutečnou Luxart dokumentaci, aniž by poslal klientské heslo.

`verify:luxart-d1` je následná jediná read-only vstupní brána integračního týdne. Pevně vyžaduje `LUXART_API_CONTRACT=memberzone_rest_v1`, přesně schválený Zone4You HTTPS origin, stejný origin pro `/Help` i API, předem schválený SHA-256 otisk originu, explicitně potvrzený gateway režim, resort 1 a autentizovaný český i anglický feed včetně Reformeru. Port není identita kontraktu: odvodí se z podepsaného originu a musí souhlasit ve všech důkazech. Současný SOAP/WCF `Service1.svc` na `api.memberzone.online:9191` proto jako REST neprojde. Skript neprovádí rezervaci či jinou mutaci a release JSON zapíše pouze do předem vytvořeného owner-only adresáře mimo repozitář bez možnosti přepsání existujícího souboru. Soubor obsahuje strojově ověřitelnou D1 atestaci verze 3 pro REST kontrakt, transport, `/Help`, cílový otisk, gateway režim a přihlášené čtení; release dossier schématu 6 odmítne obyčejný výstup samostatného diagnostického `verify:luxart-readonly`.

Po D1 a doručení tabulky sálů spustí operátor `ZONE4YOU_LUXART_EVIDENCE_PATH=<owner-only D1 JSON> LUXART_RESOURCE_MAP_JSON=<serverová mapa> npm run verify:luxart-resource-map`. Mezibrána porovná mapu s přesnou množinou čísel sálů ve všech anonymních i personalizovaných CS/EN důkazech, odmítne chybějící i přidané číslo a zveřejní pouze kanonický SHA-256 mapy, nikdy interní `id_resource`. Úspěch není autoritou k mutaci ani cutoveru.

Externí Playwright regrese je fail-closed omezená na izolovaný Zone4You Vercel Preview. Před prvním browser scénářem načte pouze `/api/readiness` a pokračuje jen při přesném profilu `mode=demo`, `luxart=mock`, regionu `fra1`, shodě s explicitně očekávaným 40znakovým Git commitem, demo top-upech, povinné angličtině a vypnutém zapomenutém heslu. Produkční aliasy a `booking.zone4you.cz` odmítne dříve, než test odešle login nebo rezervaci. Veřejný běh je záměrně nízkoobjemový: v pěti Chromium viewpor-tech a samostatném mobilním WebKitu 390 × 844 ověří rozvrh, responzivitu, přístupnost, angličtinu a oblíbené lekce, ale přihlášení, rezervaci a storno provede pouze jednou na nejmenším Chromium telefonu. WebKit průchod záměrně neprovádí login ani mutace; autentizovaný iOS/Safari UAT zůstává stagingovým krokem. Plná autentizační matice zůstává lokální, aby automat sám neobcházel ani nezahltil limit pěti přihlášení za deset minut. Oblíbené lekce bezpečně omezují a validují načítaný lokální seznam; blokované nebo plné browser úložiště nesmí shodit booking a UI v takovém případě přizná pouze platnost změny pro aktuální relaci. Automat navíc žádá Vercel o vypnutí Preview Toolbaru; pokud platforma přesto vloží svůj feedback skript, toleruje pouze jeho přesně ohraničené CSP odmítnutí na ověřeném izolovaném Preview. Každá jiná konzolová nebo aplikační chyba test nadále shodí a aplikační CSP se kvůli toolbaru nerozšiřuje.

Celý demo stav, nejen oblíbené lekce, se před obnovením a odesláním validuje a omezuje na 60 KiB. Poškozený nebo nadlimitní stav se zahodí; pokud prohlížeč lokální úložiště zablokuje, přihlášení, rezervace a storno zůstanou funkční v paměti aktuální relace.

Všechny částky v Kč z Luxart odpovědí, demo stavu a uložených booking výsledků se navíc ověřují proti společnému vysokému technickému limitu. Patologická cena, kredit, historická částka nebo storno poplatek proto selže bezpečně a nemůže se uložit jako potvrzený výsledek.

`verify:luxart-gateway-config` bezpečně ověřuje pouze způsob serverového přístupu ke konfigurovanému Luxart API. E-mailová historie potvrzuje, že Zone4You objednalo REST API a Luxart je nasadil na serveru klienta na interním portu 9759 proti testovací databázi. IT dne 11. 9. 2026 potvrdilo zveřejnění portu 9191, ale nedodalo veřejný hostname/IP ani vazbu `9191 → 9759`. SOAP/WCF na `api.memberzone.online:9191` je jiný veřejný kontrakt a není důkazem této klientské cesty. IT proto musí dodat přesný šifrovaný REST origin, potvrzení přesměrování, testovací databáze a gateway režimu. Podporované auth režimy jsou `none`, `basic`, `bearer` a vlastní `X-*` hlavička; hodnoty credentials zůstávají jen v secret store a výstup je nikdy nezobrazuje. Gateway credentials nejsou totéž co testovací login klienta. Složená brána `verify:luxart-d1` po loginu znovu načte český i anglický rozvrh, odmítne chybějící nebo nebinární `user_posible` a dokáže, že personalizace žádnou položku anonymního sedmidenního feedu neschovala; ukládá pouze agregované počty a hashe.

`npm run verify:luxart-soap-public-contract` bez credentials kontroluje veřejné WSDL a tři importované XSD dokumenty na kandidátu `Service1.svc`. Důkaz je pouze referenční: potvrzuje existenci osmi potřebných kandidátních operací a jejich zdokumentovaných polí, ale výslovně vrací `pilotCompatibility.status=unproven`. SOAP kontrakt totiž nedokumentuje samostatnou operaci `Lesson`, jazykový parametr, ekvivalent `user_posible`, watchdog, identitu Zone4You testovací databáze ani HTTPS. Skript proto nikdy neotevírá D1 nebo release sám o sobě.

Síťové rozhodnutí a důkaz, proč se čeká na veřejný Zone4You hostname místo použití `api.memberzone.online:9191`, jsou v `docs/luxart-rest-endpoint-decision-2026-09-11.md`.

`verify:booking-mutations` smí běžet jen nad výslovně potvrzenou testovací databází. Ještě před prvním zápisem vyžaduje přesnou shodu staging commitu a launch fáze z `/api/readiness`, region `fra1`, live Luxart a vypnutý waitlist; u pilotu bez plateb také vypnuté top-upy. Dále vyžaduje, aby vybranou lekci personalizovaný feed označil jako povolenou, měla autoritativní volné místo, platné číslo sálu s release mapováním, byla uvnitř potvrzeného rezervačního okna a šla bezpečně online stornovat s očekávaným poplatkem. Odpověď na storno sama nestačí: až následný Luxart snapshot smí potvrdit, že UAT rezervace zmizela. Současně se porovná přesná množina identit všech dříve aktivních rezervací klienta a do evidence se zahrnou korelační ID všech snapshotů. Jakýkoli nesoulad končí bez rezervačního POSTu nebo neúspěšným UAT důkazem.

Browserová vrstva nenechá požadavky viset bez omezení: čtení končí po 20 sekundách bezpečným retry stavem, rezervace/storno po 45 sekundách stavem vyžadujícím reconciliation. Zastaralý snapshot i ztracená odpověď booking mutace fyzicky vypnou zapisující ovládací prvky; uživatel není vybízen k opakování a u nejisté mutace dostane trvalou instrukci kontaktovat recepci. Potvrzený zápis současně nezměníme na falešné selhání jen proto, že selhalo následné obnovení dat.

`inspect:business-rules` ukáže verzovaný profil pravidel a jeho SHA-256. Dokud je profil `provisional`, živé rezervace ani platby nelze odemknout; samotné `BOOKING_RULES_CONFIRMED=true` nestačí.

`inspect:payment-product` ukáže potvrzený profil pěti CZK top-up částek a jeho SHA-256. Live Stripe vyžaduje přesnou shodu profilu s implementací i explicitní `PAYMENT_PRODUCT_CONFIRMED=true`.

`start:readonly-rollback` před změnou konfigurace vytvoří v chráněném adresáři mimo repozitář jednorázovou owner-only startovní účtenku. Existující soubor nepřepíše. `verify:readonly-rollback` pak přijme pouze přesný celý SHA-256 této účtenky a shodný cíl, commit, časový limit i drill ID, takže začátek pětiminutového měření nelze doplnit zpětně.

`verify:pilot-release` je poslední release pojistka. Pro přesný commit a aktivní launch okno ověřuje SHA-256 všech živých důkazů: Luxart CS/EN feed, úplnou shodu českých i anglických výskytů lekcí mezi Luxartem a stagingem, jejich oddělené lokalizované otisky statického obsahu (čas, texty, instruktor, kategorie, kapacita, cena a rezervační metadata), totožný interval přesně sedmi kalendářních dnů v `Europe/Prague`, mapování každého pozorovaného sálu a přesný anonymní otisk celé vazby `cislo_salu → id_resource`, booking UAT, rollback do pěti minut měřený od chráněné startovní účtenky do potvrzeného read-only stavu na stejném commitu, doručení alertu, nulové P0/P1, dostupný Memberzone fallback a výslovný cutover souhlas. Dossier schématu 6 váže rollback výsledek na účtenku jejím SHA-256 a drill ID. Reálný dossier a evidence patří mimo repozitář; bezpečná neaktivní šablona je v `config/pilot-release-dossier.template.json`.

`verify:production-precutover` ukládá autorizační výsledek do nového owner-only souboru mimo repozitář bez možnosti přepsání. Nese přesný schválený snapshot živého Luxart/staging feedu: počet lekcí, SHA-256 množiny výskytů, samostatné české a anglické SHA-256 lokalizovaného statického obsahu, SHA-256 vazeb výskyt → číslo sálu, SHA-256 celé resource mapy bez zveřejnění interních ID, množinu čísel sálů, počet Reformerů, sedmidenní pražský rozsah, časové meze a seznam dnů. `verify:production-cutover` je druhá, čistě čtecí brána po schválené změně DNS. Je pevně omezená na `https://booking.zone4you.cz/` a přijme pouze čerstvý pre-cutover soubor s přesným SHA-256 potvrzením a shodným release dossierem, commitem i fází. Ověří DNS, TLS bezpečnostní hlavičky, health/readiness, Vercel region `fra1`, živý Luxart, shodný otisk resource mapy, PostgreSQL rate limit, booking/platební capability a totožný CS/EN feed, který musí položku po položce odpovídat schválenému snapshotu včetně lokalizovaného času, názvu, popisu, instruktora, kategorie, kapacity, ceny, rezervačních metadat, čísla sálu a Reformeru. Vynechaná nebo přidaná lekce, změna jejího statického obsahu či Luxart sálu, změna resource mapy i přechod do nového pražského dne vynutí nové release důkazy a schválení. Výstup neobsahuje DNS adresy, ID lekcí, resource mapu, secrets ani osobní údaje. Pilot se otevře až po zeleném výsledku; chyba znamená návrat DNS podle provozního runbooku.

Veřejné lesson API je záměrně uzamčené na resort 1 a sedm kalendářních dnů v `Europe/Prague`. URL parametry nemohou změnit resort, datum ani zúžit feed a timezone hostingu proto nemůže po pražské půlnoci vynechat poslední den rozvrhu. Luxart adapter navíc odmítá podvržené ID lekce i odpověď, které patří jinému resortu.

## Demo klient

- příjmení: `Nováková`
- čtyřmístné heslo: `2048`

Pro čistou klientskou prezentaci otevřete veřejný Preview v novém anonymním okně; demo stav je uložený pouze pro daný prohlížeč a nikdy se nezapisuje do Memberzone.

## Architektura

- `src/lib/domain.ts` drzi stabilni datovy kontrakt.
- `src/lib/mockLuxart.ts` je in-memory demo provider.
- `src/lib/realLuxartAdapter.ts` mapuje zdokumentované Luxart login/User/Lesson/Reservations/watchdog/Payment kontrakty; živé ověření Zone4You instance stále chybí.
- `src/lib/bookingMutationLedger.ts` serializuje booking změny jednoho klienta, přehrává dokončený výsledek a při nejasném timeoutu vyžaduje reconciliation; schéma je v `migrations/002_booking_mutation_ledger.sql`.
- `src/lib/paymentLedger.ts` drží atomický PostgreSQL event/session ledger; schéma je v `migrations/001_payment_ledger.sql`.
- `src/lib/rateLimit.ts` používá v produkčním multi-instance režimu atomický PostgreSQL fixed-window limiter; schéma je v `migrations/003_rate_limit.sql`. Paměťový režim je povolen jen pro demo nebo výslovně potvrzený single-instance pilot.
- `src/lib/deploymentPreflight.ts` váže runtime konfiguraci na prostředí, fázi a celý Git commit; readiness a release dossier pak ověřují stejnou provenienci.
- `src/app/api/*` jsou serverové BFF handlery; browser nevolá Luxart ani nepřipisuje kredit přímo.
- `src/app/page.tsx` je klientsky booking dashboard pro prezentaci.

## API routes

- `GET /api/booking/snapshot`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/lessons`
- `GET /api/reservations`
- `POST /api/reservations`
- `DELETE /api/reservations/:reservationId`
- `GET /api/waitlist`
- `POST /api/waitlist`
- `DELETE /api/waitlist/:waitlistEntryId`
- `GET /api/credit/transactions`
- `POST /api/topups`
- `POST /api/payments/checkout`
- `POST /api/payments/webhook`
- `POST /api/demo/reset`

## Co chybí pro live pilot

- přesný veřejný HTTPS origin Zone4You, potvrzení překladu na interní REST port `9759`, dostupnost `/Help`, testovací databáze a gateway režim
- mapování `cislo_salu` na `id_resource` a povolení bezpečných testovacích mutací
- potvrzení login flow, pozdního storna/no-show, Reformeru, rezervačního okna a kreditní mechaniky; bezplatný běžný storno cutoff o půlnoci už je známý
- živé ověření watchdog endpointů a Luxart notifikace
- pooled TLS PostgreSQL a migrace pro sdílený rate limit i booking ledger; Stripe test secrets, platební ledger, staging webhook a potvrzený Luxart `zpusob_uhrady`/deduplikace

Do té doby zůstává produkční release správně `NO-GO`; lokální vývoj, testy a read-only ověřování mohou pokračovat.
