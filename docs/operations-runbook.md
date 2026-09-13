# Zone4You Booking — provozní a rollback runbook

Aktualizace: 2026-08-30

Tento runbook neuděluje oprávnění k deployi, DNS změně ani živé mutaci. Každý cutover a rollback provádí oprávněný správce až po výslovném rozhodnutí Zone4You.

## Provozní režimy

| Režim | `ZONE4YOU_DEPLOYMENT_PHASE` | `BOOKING_MUTATIONS_ENABLED` | `BOOKING_RULES_CONFIRMED` | `PAYMENT_MUTATIONS_ENABLED` | Chování |
|---|---|---:|---:|---:|---|
| Demo | nepoužije se | nepoužije se | nepoužije se | nepoužije se | lokální testování se simulovaným top-upem, bez Luxart produkce |
| Read-only fallback | `read_only` | `false` | může být `false` | `false` | anonymní rozvrh lze číst vždy; přihlášení, profil a kredit pouze přes HTTPS; rezervace, storno, watchdog a live top-up se bezpečně odmítnou |
| Booking pilot bez plateb | `booking_without_payments` | `true` | `true` | `false` | rezervace/storno po zelené E3 a písemném potvrzení pravidel; kredit dobíjí recepce |
| Pilot včetně Stripe | `booking_with_stripe` | `true` | `true` | `true` | pouze po zelené E3 i E5, aplikované migraci a výslovném cutover souhlasu |

Výchozí a rollback hodnoty jsou `BOOKING_MUTATIONS_ENABLED=false`, `BOOKING_RULES_CONFIRMED=false` a `PAYMENT_MUTATIONS_ENABLED=false`. `BOOKING_RULES_CONFIRMED=true` není technický bypass: profil `config/business-rules-profile.json` už zaznamenává bezplatné běžné storno do `00:00 Europe/Prague` na začátku dne lekce, ale musí být doplněn o pozdní/no-show částky, možnost pozdního online storna, Reformer, rezervační okno a kreditní mechaniku. Teprve potom se změní na `confirmed`, musí odpovídat implementaci a jeho přesný výstup `npm run inspect:business-rules` musí být schválen v `BOOKING_RULES_PROFILE_SHA256`. Jakákoli změna obsahu SHA zneplatní. Každé zapnutí je samostatná cutover akce, nikoli běžná konfigurace.

Reformer může být v potvrzeném profilu označen jako `same_as_group`, nebo mít vlastní `custom` cutoff `hours_before_start`, pozdní/no-show částky a příznak povoleného pozdního online storna. Server před každým živým stornem znovu dohledá výskyt v aktuálním schváleném feedu a pravidlo vyhodnotí; chybějící lekce, neplatný cutoff nebo uzavřené online storno skončí před Luxart `DELETE` zápisem.

## Povinné předstartovní důkazy

1. `npm run quality` je zelené.
2. Veřejný referenční kontrakt projde `npm run verify:luxart-public-contract`; tento výsledek pouze odhaluje dokumentační drift a výslovně není živým Zone4You důkazem ani launch autoritou. Přesný build následně projde `npm run verify:deployment-preflight` podle matice v `docs/deployment-preflight.md`; výstup je uložený jako ne-secret důkaz.
3. IT potvrdilo gateway auth režim, případné hodnoty jsou v secret store a `npm run verify:luxart-gateway-config` projde bez vypsání credentials. Režim `none` musí být stejně explicitní jako Basic/Bearer/`X-*`.
4. Po písemném potvrzení REST kontraktu a potvrzení, že proxy/webserver/monitoring neukládají nebo redigují query string `/api/Login`, nastaví operátor `LUXART_API_CONTRACT=memberzone_rest_v1`, `LUXART_LOGIN_QUERY_LOGGING_CONFIRMED=true`, `LUXART_LOGIN_QUERY_LOGGING_CONFIRMED_BY=<skutečný člověk nebo provozní role>` a `LUXART_LOGIN_QUERY_LOGGING_CONFIRMED_AT=<čas písemného potvrzení>`, spustí neautentizovaný `npm run probe:luxart-help`, nechá odpovědnou osobu schválit přesný zobrazený SHA-256 otisk originu a vloží jej do jednorázové CLI proměnné `LUXART_APPROVED_ORIGIN_SHA256`. Identita a čas jsou pouze jednorázové operátorské vstupy; do runtime hostingu nepatří. Poté vytvoří mimo repozitář nový adresář s oprávněním `0700`, nastaví jedinečnou dosud neexistující cestu `ZONE4YOU_LUXART_EVIDENCE_OUTPUT_PATH` a spustí `npm run verify:luxart-d1`. Brána přijme pouze schválený čistý Zone4You HTTPS REST origin bez `/api` cesty, shodný otisk a stejný `/Help` a API origin, potvrzený gateway režim, auditovatelnou ochranu login query logů potvrzenou nejvýše 30 dní před D1, resort 1 a autentizovaný český i anglický read-only feed včetně Reformeru. Ještě před klientským loginem přes stejný HTTPS origin a případnou potvrzenou gateway autentizaci načte všech 11 používaných dokumentačních stránek a jejich úplný sémantický SHA-256 musí přesně odpovídat schválenému referenčnímu baseline. Port odvodí ze schváleného originu; samotné číslo 9191 ani SOAP `Service1.svc` nejsou důkazem REST kontraktu. HTTP, nechráněný adresář ani existující výstup nepřijme. Samostatný diagnostický `verify:luxart-readonly` smí přes výslovně povolené stagingové HTTP provést jen anonymní čtení bez gateway autentizace; klientský login, personalizovaná data a všechny mutace jsou v runtime před síťovým požadavkem blokované. Jakmile jsou v diagnostice přítomné gateway nebo testovací klientské credentials, skončí ještě před vytvořením adapteru a síťovým požadavkem. JSON důkaz uloží s oprávněním `0600`; neobsahuje credentials, osobní data ani syrový payload a uvnitř nese D1 atestaci REST kontraktu, sémantického baseline, `/Help`, originu, gateway, auditovatelné ochrany login query logů a autentizovaného čtení. Release dossier schématu 6 bez D1 evidence verze 5 selže, takže samostatný `verify:luxart-readonly` zůstává pouze diagnostický stavební blok a nelze jej omylem použít jako release důkaz.
   Po odpovědi s mapou sálů nastaví operátor cestu k tomuto owner-only D1 souboru v `ZONE4YOU_LUXART_EVIDENCE_PATH`, mapu pouze v serverovém `LUXART_RESOURCE_MAP_JSON` a spustí `npm run verify:luxart-resource-map`. Kontrola vyžaduje přesně všechna a pouze živě pozorovaná čísla sálů shodná v anonymním i personalizovaném CS/EN feedu, vypíše jen čísla sálů a SHA-256 mapy a nikdy interní `id_resource`. Výsledek je přípravná kontrola; sám nepovoluje mutaci ani cutover.
5. `npm run check:launch` nemá žádný automatický `FAIL` relevantní pro zvolený režim.
6. `APP_BASE_URL=<schválený staging/produkční origin> npm run probe:runtime` projde, readiness vrátí přesný `phase`, `commit`, systémový region `fra1`, `schedule=ready`, `booking`, `payments` a v booking fázi kanonický `resourceMapSha256`; readiness současně porovná aktuální živé sály s mapou a při jediné chybějící, přidané nebo nekladné položce vrátí 503 a `booking=resource_map_mismatch`. Česká i anglická `/api/lessons` route vrátí stejnou úplnou množinu výskytů a uloží se celý JSON výstup.
7. E0–E9 v prováděcím plánu jsou vyhodnocené; vypnutá funkce má doložený fallback.
8. UAT checklist nemá otevřený P0/P1.
9. Je známý support kontakt, pilotní skupina a osoba oprávněná rozhodnout rollback.

Všechny běžné JSON mutation endpointy před parsováním zastaví tělo nad 64 KiB se stabilním `413 REQUEST_TOO_LARGE`; neplatný JSON vrací privacy-safe `400 INVALID_JSON`. Stripe webhook je záměrně oddělený, ověřuje nezměněné raw tělo a má vlastní limit 1 MiB.
10. Starý Memberzone je dostupný a jeho odkaz je připravený jako fallback. Operátor vytvoří nový adresář `0700` mimo repozitář, nastaví jedinečnou cestu `ZONE4YOU_MEMBERZONE_EVIDENCE_OUTPUT_PATH` a spustí `npm run verify:memberzone-fallback`; důkaz musí být mladší 24 hodin. Kontrola provede jediný anonymní GET přes přesnou HTTPS URL, vyžaduje neprázdný Zone4You rozvrh i Reformer a uloží jen metadata a SHA-256 s právy `0600`, nikdy HTML, názvy ani obsazenost.
11. Pro multi-instance/serverless hosting je přes schválený migrační proces aplikovaný `migrations/003_rate_limit.sql`, `npm run test:rate-limit-postgres` prošel proti staging databázi a readiness hlásí `rateLimit=postgres`. Test vedle souběžného limitu ověřuje i omezený úklid nejvýše 100 starých bucketů, zachování aktivních oken a bezpečnou obnovu právě používaného klíče. Paměťová alternativa vyžaduje doložený jediný proces a `RATE_LIMIT_SINGLE_INSTANCE=true`.
12. Pro E3 je přes schválený migrační proces aplikovaný `migrations/002_booking_mutation_ledger.sql`, `npm run test:booking-postgres` prošel proti staging databázi a readiness hlásí `booking=ready`.
13. Pro E5 je přes schválený migrační proces aplikovaný `migrations/001_payment_ledger.sql`, `npm run test:payments-postgres` prošel proti staging databázi a readiness hlásí `payments=ready`.
14. Platební produktový profil odpovídá schváleným částkám 500 / 1 000 / 2 000 / 5 000 / 10 000 Kč; aktivace vyžaduje `PAYMENT_PRODUCT_CONFIRMED=true` a přesný hash z `npm run inspect:payment-product` v `PAYMENT_PRODUCT_PROFILE_SHA256`.
15. Luxart výslovně potvrdí, že standardní Zone4You e-mailové šablony jsou aktivní; teprve potom se v runtime nastaví `NOTIFICATION_PROVIDER=luxart` a `LUXART_NOTIFICATION_TEMPLATES_CONFIRMED=true`. Stejnou skutečnost oprávněná osoba potvrdí jménem/rolí a časem v `approvals.luxartNotifications` finálního dossieru. Samotné vlastnictví notifikací ani runtime proměnná nejsou důkazem doručování. Runtime probe, release dossier i post-cutover kontrola musí shodně doložit `bookingNotifications=ready`.
16. Finální `npm run verify:pilot-release` projde pro přesný commit a aktivní launch okno. Validátor porovná SHA-256 uložených Luxart/runtime/UAT/aplikačního rollbacku/DNS rollback baseline/alert/Memberzone důkazů, vyžádá totožný interval přesně sedmi kalendářních dnů v `Europe/Prague` bez výskytu mimo rozsah, mapování každého živě pozorovaného sálu i shodný SHA-256 celé resource mapy mezi operátorským prostředím a staging readiness, shodu rate-limit režimu, fázi, commit i runtime capabilities, nulové P0/P1, ručně potvrzený alert event, technicky i lidsky potvrzený Memberzone fallback, jmenovité potvrzení aktivních Luxart e-mailových šablon a výslovný cutover souhlas. Současný omezený dossier vyžaduje `waitlistEnabled=false`; zapnutí watchdogu potřebuje samostatný živý důkaz a rozšíření release validátoru.

`probe:runtime` odmítne živý paměťový limiter, pokud není společně s doloženou single-instance topologií výslovně nastaveno `PROBE_ALLOW_SINGLE_INSTANCE=true`. Pro Vercel/serverless se používá `rateLimit=postgres`.

Ve fázi `booking_without_payments` vypíše `check:launch` čtyři Stripe infrastrukturní kontroly jako `SKIP` a nezahrne je do jmenovatele. Nejde o jejich splnění: gate současně vyžaduje `PAYMENT_MUTATIONS_ENABLED=false`, runtime capability skryje top-up a release dossier nesmí obsahovat Stripe launch mode. Ve fázi `booking_with_stripe` není žádná z těchto kontrol přeskočena.

### Finální release dossier

Do schváleného evidence úložiště mimo repozitář uložte nezměněné JSON výstupy `verify:luxart-d1`, `probe:runtime`, `verify:booking-mutations`, `start:readonly-rollback`, `verify:readonly-rollback`, `capture:production-domain-baseline`, `verify:alert-delivery` a `verify:memberzone-fallback`. Jejich cesty, přesný commit, staging/Luxart HTTPS origin a launch okno předejte jednorázovému operátorskému příkazu `npm run prepare:pilot-release`; startovní rollback účtenka se předává jako `ZONE4YOU_ROLLBACK_TIMER_EVIDENCE_PATH` a Memberzone cesta jako `ZONE4YOU_MEMBERZONE_FALLBACK_EVIDENCE_PATH`. Výstupní adresář dossieru musí být reálný owner-only adresář mimo repozitář. Příkaz přijme jen pravidelné úspěšné JSON soubory, vypočítá jejich celé SHA-256, odmítne přepsat existující dossier a nový soubor uloží s oprávněním pouze pro vlastníka; následné čtení dossieru stejná práva znovu vynutí. Finální validátor schématu 6 navíc zkontroluje v Luxart souboru povinnou D1 atestaci, owner-only a nepřepisovatelnou startovní rollback účtenku svázanou SHA-256 a drill ID s výsledkem rollbacku a v owner-only Memberzone souboru přesnou HTTPS URL, status, typ obsahu, omezenou velikost a všechny detekční příznaky; samostatný `verify:luxart-readonly` je pouze diagnostický a do dossieru nepatří.

`npm run check:launch` kontroluje nejen přítomnost runbooku a UAT checklistu, ale i přesné zapojení všech výše uvedených producentů důkazů, ověření DNS baseline, přípravy a validace dossieru a pre/post-cutover brány v `package.json`. Přejmenovaný, odpojený nebo chybějící příkaz proto nesmí projít jako kompletní operační řetězec.

Všech pět položek `approvals.*.approvedBy` a `ZONE4YOU_ALERT_SUPPORT_OWNER` musí uvádět skutečnou osobu nebo konkrétní provozní roli. Placeholdery jako `TBD`, `unknown`, `N/A`, `pending-human-approval`, všechny šablonové hodnoty začínající `replace-with-` nebo hodnoty s řídicími znaky launch brána odmítne.

### DNS rollback baseline před cutoverem

Před plánováním změny lze bezpečně spustit `npm run probe:production-domain`. Diagnostika pouze agreguje typy a fingerprint DNS záznamů, ověří přesné HTTP→HTTPS přesměrování, platný HTTPS shell, bezpečnostní hlavičky a `/api/health`; nevypisuje IP adresy, nic nemění a její `authorizesCutover=false` nelze použít jako release důkaz. DNS vrstva dotazuje A, AAAA a CNAME samostatně, aby obecná `ANY` odpověď nemohla vynechat IPv6 nebo alias. Skutečnou autoritu dávají až níže uvedené hashované baseline, dossier, pre-cutover a post-cutover brány.

Oprávněný operátor nejprve vytvoří mimo repozitář adresář s právy `0700` a zachytí přesné veřejné A/AAAA/CNAME záznamy cílové domény. Příkaz nic nemění, existující soubor nepřepíše a na standardní výstup nevypíše adresy:

```bash
ZONE4YOU_DNS_BASELINE_OUTPUT_PATH=/secure/release-evidence/production-dns-baseline.json \
ZONE4YOU_DNS_BASELINE_CAPTURE_CONFIRMATION=CAPTURE_ZONE4YOU_DNS_BASELINE:booking.zone4you.cz \
npm run capture:production-domain-baseline
```

Do finálního dossieru se cesta předá v `ZONE4YOU_DNS_BASELINE_EVIDENCE_PATH`. Bezprostředně před první DNS změnou musí operátor použít SHA-256 souboru z potvrzení capture a ověřit, že veřejný record set mezitím nedriftoval:

```bash
ZONE4YOU_DNS_BASELINE_EVIDENCE_PATH=/secure/release-evidence/production-dns-baseline.json \
ZONE4YOU_DNS_BASELINE_VERIFY_CONFIRMATION=VERIFY_ZONE4YOU_DNS_BASELINE:<sha256-souboru> \
npm run verify:production-domain-baseline
```

Samostatný příkaz je diagnostický. Autoritativní poslední brána před ruční změnou DNS musí ve stejném běhu znovu ověřit celý schválený release dossier i živou shodu baseline:

```bash
ZONE4YOU_DNS_BASELINE_EVIDENCE_PATH=/secure/release-evidence/production-dns-baseline.json \
ZONE4YOU_PRECUTOVER_CONFIRMATION=VERIFY_ZONE4YOU_PRECUTOVER:<sha256-dossieru> \
ZONE4YOU_PRECUTOVER_EVIDENCE_OUTPUT_PATH=/secure/release-evidence/precutover-<release-id>.json \
npm run verify:production-precutover
```

Příkaz přebírá ostatní proměnné finálního `verify:pilot-release`, nic nenasazuje ani nemění a jako jediný může vrátit `GO_TO_AUTHORIZED_DNS_CHANGE`. Výsledek zapíše bez možnosti přepsání do nového JSON souboru s právy `0600` v již existujícím adresáři `0700` mimo repozitář a vypíše SHA-256 tohoto souboru. Jakákoli odchylka znamená zastavit cutover, zjistit vlastníka změny a až po novém schválení zachytit nový baseline. DNS baseline obsahuje veřejné adresy potřebné pro přesný návrat, proto se rovněž drží owner-only mimo Git. Release validátor přijme baseline starý maximálně 24 hodin.

Vygenerovaný dossier je záměrně `draft: true`, `UAT=NO-GO`, alert receipt nepotvrzený, Memberzone fallback nedostupný, Luxart notifikační šablony nepotvrzené a cutover neschválený. Není launch autoritou. Až oprávněné osoby skutečně uzavřou UAT, potvrdí stejné alert event ID, fallback, aktivní Luxart šablony a cutover, doplní své jméno/roli a aktuální čas, lze nastavit `draft: false`. Schválení UAT, alertu, fallbacku a notifikací nesmí časově předcházet důkazům, ke kterým se vztahují; cutover musí následovat po všech artefaktech i předchozích schváleních. Tento čas se přenese do pre-cutover receipt a produkční brána vynutí `cutoverApprovedAt ≤ preCutoverCheckedAt ≤ production checkedAt`; budoucí receipt ani předčasná DNS autorizace se nepřijme. Řetězec `pending-human-approval` nebo obrácenou časovou posloupnost finální validátor odmítá. Poté se znovu spočítá SHA celého dossieru, nastaví `ZONE4YOU_RELEASE_DOSSIER_PATH`, `ZONE4YOU_RELEASE_COMMIT` a přesná potvrzovací fráze `VERIFY_ZONE4YOU_RELEASE_DOSSIER:<sha256-dossieru>`. Bez těchto živých lidských kroků `verify:pilot-release` vždy skončí NO-GO.

Validátor přijme pouze autentizovaný Luxart důkaz, unikátní korelační request ID z booking UAT a rollbacku a alert od skutečně nakonfigurovaného support vlastníka se správným UUID/fingerprintem. Každý vstupní JSON, samotný dossier, DNS baseline i pre-cutover receipt se otevírá jedním stabilním čtením bez následování symlinků, s kontrolou identity, velikosti, práv a změny před/po čtení; DNS rollback baseline, Memberzone fallback a pre-cutover receipt jsou přísně owner-only. Čerstvě zapsané kritické důkazy se navíc porovnají byte-for-byte s vygenerovaným obsahem. Bezpečná ruční kostra zůstává v `config/pilot-release-dossier.template.json`, ale i ta je povinně draft.

Režim `booking_without_payments` dovoluje bezpečný booking pilot se skrytým Stripe. Režim `booking_with_stripe` navíc povinně vyžaduje samostatný end-to-end Stripe UAT artefakt dokazující právě jedno připsání, ignorovaný duplicitní webhook, bezezměnný kredit po neúspěchu a uzavřenou reconciliation. Samotné vyplnění šablony nestačí: validátor odmítá změněný hash, starý důkaz, jiné prostředí, chybějící sál, launch mimo okno i neudělený cutover souhlas.

### Dvě oddělené cutover brány

Zelený `verify:pilot-release` spolu se zeleným `verify:production-precutover` je předcutoverový důkaz a pouze autorizuje oprávněného správce k přesně naplánované změně DNS. Ani jeden příkaz nic nepřepíná. Po změně DNS a vydání platného certifikátu, ale ještě před pozváním pilotní skupiny, musí během sledovaného launch okna projít druhá read-only brána:

```bash
ZONE4YOU_PRODUCTION_APP_URL=https://booking.zone4you.cz/ \
ZONE4YOU_PRODUCTION_EXPECTED_COMMIT="$ZONE4YOU_APPROVED_COMMIT" \
ZONE4YOU_PRODUCTION_EXPECTED_PHASE=booking_without_payments \
ZONE4YOU_PRECUTOVER_EVIDENCE_PATH=/secure/release-evidence/precutover-<release-id>.json \
ZONE4YOU_PRECUTOVER_MAX_AGE_MINUTES=30 \
ZONE4YOU_RELEASE_DOSSIER_CONFIRMATION=VERIFY_ZONE4YOU_RELEASE_DOSSIER:<sha256-dossieru> \
ZONE4YOU_PRODUCTION_CUTOVER_CONFIRMATION=VERIFY_ZONE4YOU_PRODUCTION_CUTOVER:<sha256-precutover-souboru> \
ZONE4YOU_PRODUCTION_CUTOVER_EVIDENCE_OUTPUT_PATH=/secure/release-evidence/production-cutover-<release-id>.json \
npm run verify:production-cutover
```

`ZONE4YOU_APPROVED_COMMIT` je celý 40znakový lowercase SHA přesně stejného commitu jako v release dossieru. Post-cutover brána přijme jen owner-only, nejvýše 30 minut starý pre-cutover soubor, jeho přesný hash v potvrzovací frázi a shodný dossier, commit i fázi; starý či změněný soubor fail-closed odmítne. Pre-cutover receipt současně přenáší schválený počet lekcí, SHA-256 množiny výskytů, samostatné CS/EN SHA-256 statického obsahu lekcí, SHA-256 vazeb výskyt → Luxart číslo sálu, SHA-256 celé resource mapy, seřazenou množinu čísel sálů, počet Reformerů, přesný sedmidenní pražský rozsah, časové meze a seznam dnů. Operátorské hodnoty jsou CLI-only a nesmějí se vložit do runtime prostředí aplikace. Skript neprovádí deploy, DNS změnu, login ani Luxart mutaci. Z veřejné produkční domény ověří DNS odpověď bez vypsání IP, bezpečnostní hlavičky, health/readiness, přesný commit, fázi a region `fra1`, živý Luxart, shodný otisk resource mapy, PostgreSQL rate limit, připravený booking, očekávaný platební stav a CS/EN feed přesně shodný s tímto schváleným snapshotem včetně lokalizovaného času, textů, instruktora, kategorie, kapacity, ceny, rezervačních metadat, sálů a Reformeru. Ve stejném běhu znovu anonymně načte přesnou HTTPS adresu původního Memberzone scheduleru a potvrdí neprázdný rozvrh i Reformer; do účtenky uloží pouze stav, velikost, příznaky a SHA-256, nikdy HTML, cookie nebo osobní data. Vynechaná či přidaná lekce, změna jejího statického obsahu, čísla sálu, resource mapy, přechod do nového pražského dne nebo nedostupný fallback znamená NO-GO a vyžaduje nápravu a nové release důkazy.

Pilot je veřejně otevřený až po zeleném JSON výsledku. Ověřovač jej povinně zapíše jako nový owner-only soubor mimo repozitář, existující soubor nepřepíše a po zápisu zkontroluje jeho obsah, práva i SHA-256; samotný výpis v terminálu tedy není launch důkaz. Jakákoli chyba, odlišný commit/fáze, neplatný certifikát, prázdný či rozdílný feed nebo překročení 60 sekund znamená neotevírat pilotní skupinu a okamžitě vrátit předem zaznamenané původní DNS hodnoty. Poté se ověří starý Memberzone a incident se uzavře podle části „Incident a rollback“. Opakovaný cutover vyžaduje nový aktuální release dossier, nový výstupní soubor a nové výslovné schválení.

### Řízený transakční UAT

`npm run verify:booking-mutations` se smí spustit až po výslovném povolení mutací v testovací databázi. Skript odmítá `https://booking.zone4you.cz`, vyžaduje přesný staging origin v potvrzovací frázi `ZONE4YOU_TEST_DB_ONLY:<origin>`, přesný 40znakový commit v `ZONE4YOU_UAT_EXPECTED_COMMIT`, launch fázi v `ZONE4YOU_UAT_EXPECTED_PHASE`, úplný `LUXART_RESOURCE_MAP_JSON`, přesné ID testovacího klienta a `ZONE4YOU_UAT_ROOM_SCENARIOS_JSON`. Tato JSON array musí pro každý klíč room mapy obsahovat právě jeden objekt `roomNumber`, `lessonId`, `lessonKind` (`standard` nebo `reformer`) a `expectedCancellationFeeKc`; výskyty i sály musí být unikátní a sada musí obsahovat alespoň jednu běžnou lekci a jeden Reformer. Ještě před loginem a prvním POSTem každého scénáře musí `/api/readiness` potvrdit stejný commit a fázi, region `fra1`, live Luxart, vypnutý waitlist, capability profil dané fáze a shodný `resourceMapSha256`; rozdíl skončí bez přihlášení a bez mutace. Personalizovaný snapshot musí u každého výskytu potvrdit požadovaný typ, přesné číslo sálu, `user_posible`, autoritativní volné místo, potvrzené rezervační okno, možnost online storna a shodu očekávaného poplatku s pravidlem konkrétního typu; jinak se scénář zastaví před mutací. Každý scénář musí obnovit původní stav dříve, než začne další sál. Finální release validátor znovu sváže všechny UAT výsledky s přesným commitem/fází dossieru a resource mapou, vyžaduje přesné jednorázové pokrytí všech sálů, oba typy lekcí, rozdílné otisky lekcí a rezervací a unikátní korelační ID napříč celou sadou. Přihlašovací údaje zůstávají pouze v environmentu a výstup obsahuje jen otisky ID, otisk mapy, čísla sálů a booleovské důkazy.

U běžné lekce i Reformeru skript samostatně ověří jeden zápis, tři replaye stejného klíče, dva paralelní klíče, jeden storno zápis, tři replaye storna, replay s jiným klíčem a návrat kreditu i přesné identity množiny všech dříve aktivních rezervací do výchozího stavu. Pouhá odpověď na storno ani shoda počtu rezervací nestačí: bezpečné dokončení každého scénáře vyžaduje následný snapshot bez jeho UAT rezervace. Pokud tento read-after-write důkaz chybí, cleanup zůstane aktivní a druhý scénář nemůže vytvořit platný suite důkaz. Důkaz obsahuje pouze krátké SHA-256 otisky obou UAT lekcí a rezervací a korelační ID všech kontrolních snapshotů; jejich formát, rozdílnost a minimální úplnost finální dossier znovu kontroluje. Po nejasném výsledku mutaci slepě neopakuje; booking se vypne a provede se reconciliation podle této příručky.

Browserové čtení má limit 20 sekund a po výpadku nabízí bezpečné opakování. Rezervace a storno mají limit 45 sekund; ztracená odpověď vždy přejde do `BOOKING_RECONCILIATION_REQUIRED`, zobrazí trvalou instrukci kontaktovat recepci a fyzicky vypne další booking akce. Selhání obnovy snapshotu označí poslední data jako zastaralá a rovněž vypne rezervaci, storno, waitlist i dobití do úspěšné obnovy. Pokud Luxart zápis už prokazatelně potvrdil a selže pouze následné čtení, UI musí zachovat potvrzený výsledek a nesmí uživatele vybídnout k opakování.

## Monitoring pilotu

| Signál | Varování | P1 / zásah |
|---|---:|---:|
| `/api/health` | 1 neúspěch | 2 po sobě jdoucí neúspěchy během 2 minut |
| `/api/readiness` | 1 neúspěch, `schedule` jiné než `ready` nebo Luxart pomalejší než 3 s | 2 neúspěchy během 2 minut |
| HTTP 5xx | více než 1 % za 5 minut | více než 3 % za 5 minut |
| Luxart timeout | 1 za 5 minut | 3 za 5 minut nebo 2 po sobě |
| Rezervace/storno | 1 `BOOKING_ALREADY_PROCESSING` nebo `BOOKING_RECONCILIATION_REQUIRED` | jakýkoli nejistý výsledek, chybějící/nejednoznačný Luxart identifikátor po zápisu, 3 selhání nebo falešný úspěch |
| Stripe | jakýkoli neověřený podpis | jakýkoli nejistý nebo duplicitní kredit |
| Logout | — | důvěryhodný požadavek nevrátí 200 nebo nesmaže lokální session cookie |

Logy smějí obsahovat pouze čas, typ události, stav, bezpečný chybový kód a `X-Request-ID`. Nesmějí obsahovat heslo, cookie, Stripe secret, celé Luxart payloady ani neomezené osobní údaje.

Logout je lokální bezpečnostní operace: po ověření Originu nesmí čekat na Luxart ani na rate-limit databázi. Jeho selhání je P1, protože klient nesmí zůstat přihlášený kvůli výpadku pomocné infrastruktury. Cizí nebo chybějící Origin se naopak odmítne bez změny cookie.

### Ověření doručení alertu

Po výběru alert kanálu a support vlastníka nejprve zjistěte bezpečný fingerprint cíle z chybové instrukce `verify:alert-delivery`, nastavte přesnou frázi `SEND_ZONE4YOU_TEST_ALERT:<fingerprint>` a spusťte test. Příklad proměnných bez skutečné adresy:

```bash
ZONE4YOU_ALERT_APP_URL=https://staging.booking.zone4you.cz/ \
ZONE4YOU_ALERT_WEBHOOK_URL=<HTTPS webhook ze secret store> \
ZONE4YOU_ALERT_SUPPORT_OWNER=<role nebo jméno podpory> \
ZONE4YOU_ALERT_CONFIRMATION=SEND_ZONE4YOU_TEST_ALERT:<fingerprint> \
npm run verify:alert-delivery
```

Skript odešle právě jednu událost se závažností `test`, bez klientských údajů, hesel a cookies. Výstup neobsahuje webhook URL ani bearer token, pouze fingerprint, stav a event ID. HTTP 2xx dokládá přijetí webhookem, nikoli doručení člověku: support vlastník musí ručně potvrdit stejný event ID. Teprve poté lze v release konfiguraci nastavit `ZONE4YOU_ALERT_DELIVERY_CONFIRMED=true`. Samotný skript ani tato proměnná nenahrazují průběžný monitor hostingu.

## Incident a rollback

1. Zapište čas, symptom, prostředí a `X-Request-ID`; neurčujte příčinu bez důkazu.
2. Při platebním P0 okamžitě nastavte `PAYMENT_MUTATIONS_ENABLED=false`; při booking P0 nastavte také `BOOKING_MUTATIONS_ENABLED=false`. Ověřte snapshot capability a readiness.
3. Při P1 vypněte transakce, pokud příčinu nelze během 10 minut bezpečně odstranit a znovu ověřit.
4. Spusťte read-only runtime probe. Rozvrh musí zůstat dostupný; jinak přesměrujte pilot na starý Memberzone podle schváleného DNS/hosting postupu.
5. Ověřte, že poslední živá rezervace/storno odpovídá Luxart test/produkční autoritě. Nikdy neopakujte nejistou mutaci naslepo.
6. U platby v nejistém stavu kredit automaticky neopakujte. Zastavte Stripe top-up a proveďte ruční reconciliation podle Stripe session ID, event ID a Luxart reference.
7. Obnovení transakcí vyžaduje opravu, opakování relevantních testů, runtime probe a nové výslovné schválení.

## Reconciliation rezervace nebo storna

1. Nastavte `BOOKING_MUTATIONS_ENABLED=false`; nejistou akci nikdy neposílejte znovu naslepo.
2. Podle `X-Request-ID`, času a klienta najděte řádek `zone4you_booking_mutations` ve stavu `uncertain`. Ledger neobsahuje heslo ani session cookie.
3. V Luxart autoritě ověřte před/po stav cílové lekce nebo rezervace, včetně kreditu a případného storno poplatku.
4. Pokud Luxart změnu provedl, uzavřete ledger pouze schváleným jednorázovým provozním postupem jako `applied` se skutečným výsledkem. Pokud ji prokazatelně neprovedl, uzavřete ji jako `rejected`; při nejednoznačnosti ponechte `uncertain`.
5. Teprve po druhé kontrole lze vytvořit nový požadavek s novým `Idempotency-Key`. Každá ruční změna ledgeru musí mít čas, důkaz a schvalující osobu.

Konkrétní opravný SQL příkaz není záměrně součástí automatického běhu: musí vzniknout až pro přesně identifikovaný řádek a projít schválením, aby nehrozilo hromadné nebo chybné přepsání auditu.

Čerstvá potvrzená rezervace se po dobu dvou minut bezpečně přehrává i pro jiný browserový klíč; storno stejného ID se přehrává trvale. Potvrzené storno v ledgeru ochranu lekce uvolní, takže ji lze znovu rezervovat. Zrušení provedené mimo nový booking je proto před opakovanou rezervací potřeba nechat propsat do Luxartu a po uplynutí krátkého ochranného okna načíst nový stav.

## Časovaný rollback drill

Před pilotem proveďte na stagingu:

1. bezprostředně před změnou vytvořit mimo repozitář owner-only startovní účtenku měření;
2. `BOOKING_MUTATIONS_ENABLED=false`;
3. `PAYMENT_MUTATIONS_ENABLED=false`;
4. potvrzení, že lekce se načítají, ale rezervace/storno vrací `BOOKING_READ_ONLY` a Checkout `PAYMENTS_DISABLED`;
5. potvrzení dostupnosti starého Memberzone;
6. ukončení měření a záznam výsledku.

GO práh: bezpečný read-only stav do 5 minut, žádná nechtěná Luxart mutace a zdokumentovaný vlastník dalšího kroku.

Před změnou vytvořte nový adresář s oprávněním `0700` mimo repozitář. První běh bez potvrzení vypíše požadovaný fingerprint; druhý běh s přesnou frází vytvoří jednorázovou startovní účtenku `0600` a existující soubor nikdy nepřepíše:

```bash
ZONE4YOU_ROLLBACK_APP_URL=https://staging.booking.zone4you.cz/ \
ZONE4YOU_ROLLBACK_EXPECTED_COMMIT=<přesný-40znakový-git-commit> \
ZONE4YOU_ROLLBACK_TIMER_OUTPUT_PATH=/bezpecne-uloziste/readonly-rollback-timer.json \
ZONE4YOU_ROLLBACK_TIMER_CAPTURE_CONFIRMATION=START_ZONE4YOU_READ_ONLY_ROLLBACK:<zobrazený-fingerprint> \
npm run start:readonly-rollback
```

Ihned potom nastavte `BOOKING_MUTATIONS_ENABLED=false`, `PAYMENT_MUTATIONS_ENABLED=false`, fázi `read_only` a nasaďte tentýž commit. Po přepnutí spusťte bez přihlašovacích údajů; plný SHA-256 účtenky převezměte pouze z výstupu startovního příkazu:

```bash
ZONE4YOU_ROLLBACK_APP_URL=https://staging.booking.zone4you.cz/ \
ZONE4YOU_ROLLBACK_CONFIRMATION=READ_ONLY_ROLLBACK:https://staging.booking.zone4you.cz \
ZONE4YOU_ROLLBACK_EXPECTED_COMMIT=<přesný-40znakový-git-commit> \
ZONE4YOU_ROLLBACK_TIMER_EVIDENCE_PATH=/bezpecne-uloziste/readonly-rollback-timer.json \
ZONE4YOU_ROLLBACK_TIMER_VERIFY_CONFIRMATION=VERIFY_ZONE4YOU_ROLLBACK_TIMER:<plný-sha256-účtenky> \
npm run verify:readonly-rollback
```

Ověřovač nepřijme ručně dopsaný čas: vyžaduje chráněnou startovní účtenku, její celý SHA-256 a shodu cíle, commitu, limitu i drill ID. Ověří `health`, živé read-only `readiness`, fázi `read_only`, commit, region `fra1`, neprázdný rozvrh a bezpečné odmítnutí vytvoření rezervace, storna, watchdogu a Stripe Checkout. Nepoužívá login, cookie ani reálné ID lekce/rezervace; záměrně posílá sentinelové hodnoty, které musí být odmítnuty dříve, než se zavolá Luxart nebo Stripe. Celý privacy-safe JSON výstup s `X-Request-ID`, otiskem startovní účtenky, začátkem rollbacku, časem dosažení read-only a oběma odvozenými délkami uložte jako časovaný rollback důkaz. Skript skončí ještě před sentinelovými požadavky při nesprávném commitu/fázi nebo pokud od nezměnitelného začátku do ověřeného read-only stavu uplynulo více než pět minut.
