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
PLAYWRIGHT_EXTERNAL_DEMO_URL=https://zone4youbooking-...vercel.app/ npm run test:e2e
BOOKING_TEST_DATABASE_URL=postgresql:///postgres npm run test:booking-postgres
PAYMENT_TEST_DATABASE_URL=postgresql:///postgres npm run test:payments-postgres
RATE_LIMIT_TEST_DATABASE_URL=postgresql:///postgres npm run test:rate-limit-postgres
APP_BASE_URL=http://localhost:3007 npm run smoke:api
npm run check:launch
npm run verify:deployment-preflight
npm run probe:luxart-help
npm run verify:luxart-gateway-config
npm run inspect:business-rules
npm run inspect:payment-product
# Po výběru staging alert kanálu a support vlastníka:
npm run verify:alert-delivery
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

Externí Playwright regrese je fail-closed omezená na izolovaný Zone4You Vercel Preview. Před prvním browser scénářem načte pouze `/api/readiness` a pokračuje jen při přesném profilu `mode=demo`, `luxart=mock`, demo top-upech, povinné angličtině a vypnutém zapomenutém heslu. Produkční aliasy a `booking.zone4you.cz` odmítne dříve, než test odešle login nebo rezervaci. Veřejný běh je záměrně nízkoobjemový: ve všech pěti viewports ověří rozvrh, responzivitu, přístupnost, angličtinu a oblíbené lekce, ale přihlášení, rezervaci a storno provede pouze jednou na nejmenším telefonu. Plná autentizační matice zůstává lokální, aby automat sám neobcházel ani nezahltil limit pěti přihlášení za deset minut.

`verify:luxart-gateway-config` bezpečně ověřuje pouze způsob serverového přístupu ke konfigurovanému Luxart API. Zone4You IT dne 11. 9. 2026 potvrdilo dohodu s Luxartem o zveřejnění portu 9191, ale stále chybí přesný host, schéma a potvrzení, že je cesta už aktivní. Podporované auth režimy jsou `none`, `basic`, `bearer` a vlastní `X-*` hlavička; hodnoty credentials zůstávají jen v secret store a výstup je nikdy nezobrazuje. Gateway credentials nejsou totéž co testovací login klienta.

`inspect:business-rules` ukáže verzovaný profil pravidel a jeho SHA-256. Dokud je profil `provisional`, živé rezervace ani platby nelze odemknout; samotné `BOOKING_RULES_CONFIRMED=true` nestačí.

`inspect:payment-product` ukáže potvrzený profil pěti CZK top-up částek a jeho SHA-256. Live Stripe vyžaduje přesnou shodu profilu s implementací i explicitní `PAYMENT_PRODUCT_CONFIRMED=true`.

`verify:pilot-release` je poslední release pojistka. Pro přesný commit a aktivní launch okno ověřuje SHA-256 všech živých důkazů: Luxart CS/EN feed, úplnou shodu českých i anglických výskytů lekcí mezi Luxartem a stagingem, totožný interval přesně sedmi kalendářních dnů v `Europe/Prague`, mapování každého pozorovaného sálu, booking UAT, rollback do pěti minut, doručení alertu, nulové P0/P1, dostupný Memberzone fallback a výslovný cutover souhlas. Reálný dossier a evidence patří mimo repozitář; bezpečná neaktivní šablona je v `config/pilot-release-dossier.template.json`.

`verify:production-cutover` je druhá, čistě čtecí brána po schválené změně DNS. Je pevně omezená na `https://booking.zone4you.cz/` a přesnou potvrzovací frázi pro celý nasazený Git SHA. Ověří DNS, TLS bezpečnostní hlavičky, health/readiness, shodu commitu, fáze a Vercel regionu `fra1`, živý Luxart, PostgreSQL rate limit, booking/platební capability a totožný neprázdný CS/EN feed všech lekcí v přesném sedmidenním pražském rozsahu včetně Reformeru. Výstup neobsahuje DNS adresy, ID lekcí, secrets ani osobní údaje. Pilot se otevře až po zeleném výsledku; chyba znamená návrat DNS podle provozního runbooku.

Veřejné lesson API je záměrně uzamčené na resort 1 a sedm kalendářních dnů v `Europe/Prague`. URL parametry nemohou změnit resort, datum ani zúžit feed a timezone hostingu proto nemůže po pražské půlnoci vynechat poslední den rozvrhu. Luxart adapter navíc odmítá podvržené ID lekce i odpověď, které patří jinému resortu.

## Demo klient

- příjmení: `Nováková`
- čtyřmístné heslo: `2048`

V aplikaci je tlacitko `Reset demo`, ktere vrati mock data do cisteho startovniho stavu.

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

- přesná `https://<host>:9191/` a `/Help` URL, potvrzení aktivního přístupu, testovací databáze a gateway režimu
- mapování `cislo_salu` na `id_resource` a povolení bezpečných testovacích mutací
- potvrzení login flow, pozdního storna/no-show, Reformeru, rezervačního okna a kreditní mechaniky; bezplatný běžný storno cutoff o půlnoci už je známý
- živé ověření watchdog endpointů a Luxart notifikace
- pooled TLS PostgreSQL a migrace pro sdílený rate limit i booking ledger; Stripe test secrets, platební ledger, staging webhook a potvrzený Luxart `zpusob_uhrady`/deduplikace

Do té doby zůstává produkční release správně `NO-GO`; lokální vývoj, testy a read-only ověřování mohou pokračovat.
