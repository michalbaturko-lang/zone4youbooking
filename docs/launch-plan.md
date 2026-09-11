# Zone4You Booking — launch project

Aktualizace: 2026-09-11

Řízení projektu: Codex ve spolupráci s Michalem Baturkem

Pracovní větev: `codex/zone4you-recovery-9191`

Detailní prováděcí plán, evaluační kritéria, severity a dlouhodobá řídicí smyčka jsou v `docs/pilot-execution-and-evaluation.md`.

## 1. Cíl a doporučený launch

Cílem je nahradit klientskou část `memberzone.cz/zone4you` moderním bookingem, zatímco Luxart/Member Pro zůstane zdrojem pravdy pro klienty, rozvrh, rezervace, kredit a administraci. Původní pevný termín 2026-09-05 uplynul bez živého Luxart přístupu a cutover proto správně neproběhl. Nový sedmidenní launch běh začne až dnem D1, kdy IT dodá přesnou aktivní URL na portu 9191 a povolí read-only test; konkrétní kalendářní cutover musí znovu potvrdit Zone4You.

Pilot na `booking.zone4you.cz` musí obsahovat všechny záznamy vrácené Luxart `api/Lesson`, bez whitelistu názvů, sálů nebo kategorií. To zahrnuje všechny skupinové lekce a Reformer. Squash, stolní tenis a masáže jsou v Luxart API samostatné oblasti `Courts`, `Services` a `Freetime`; do pilotu je nezahrnujeme, dokud klient výslovně nepotvrdí, že slovem „lekce“ myslí i tyto služby.

Starý Memberzone zůstane po dobu pilotu a stabilizace dostupný jako rollback cesta. Ostrý cutover nesmí proběhnout bez zelených akceptačních bran a výslovného schválení klienta.

## 2. Faktický audit současného Memberzone

Živě ověřeno 2026-08-29 na `https://memberzone.cz/zone4you/scheduler.aspx` na desktopu i mobilním viewportu.

- Systém běží na ASP.NET 4 / Microsoft IIS 10 a používá komponenty DevExpress/Luxart.
- Nabízí výpis lekcí, samostatné pohledy Sál 1–3 a Reformer, dále Squash, stolní tenis a masáže.
- Přihlášený klient má přehled účtu, kredit a historii.
- Lekce zobrazují čas, instruktora, kapacitu/počet rezervací a tlačítko rezervace.
- Desktopový týdenní pohled je velmi hustý. Na mobilu se do jedné obrazovky skládá mnoho sloupců; datum, název lekce a instruktor se stávají prakticky nečitelnými.
- Změna pohledu vyvolala chybu `radioButtonListViews is not defined`.
- Otevření detailu lekce vyvolalo chybu `createAppointmentImages is not a function`; detail se nejprve zobrazí jako `Načítám...` a až následně se doplní.
- Odpověď stránky neobsahovala HSTS, CSP, `X-Frame-Options` ani `X-Content-Type-Options`. Session cookie byla `HttpOnly; SameSite=Lax`, ale bez atributu `Secure`.
- HTML odpověď scheduleru měla přibližně 154 kB ještě před dalšími skripty a styly.

Poznámka: audit neprovedl vytvoření ani zrušení skutečné rezervace. Tyto kroky jsou reprezentativní akcí na živém účtu a budou provedeny až v domluveném testovacím účtu/scénáři.

## 3. Stav nového řešení

### Připraveno

- responzivní Next.js UI pro denní a týdenní rozvrh;
- rozvrh skupinových lekcí a Reformeru, filtry, hledání a detail lekce;
- UI flow pro login, kredit, rezervaci, storno, Luxart hlídání uvolněného místa, transakce a profil;
- přihlašovací formulář přijímá příjmení, e-mail nebo login a heslo v rozsahu 1–128 znaků; vztah hesla a čísla karty musí ještě potvrdit živý Luxart test;
- stabilní doménové rozhraní `LuxartAdapter`;
- oddělená fail-closed gateway autentizace k Luxart API: explicitní `none`, Basic, Bearer nebo vlastní `X-*` hlavička; credentials se nikdy neposílají browseru ani nevypisují a adapter odmítá HTTP redirect, aby autorizační hlavičku nepřenesl na jiný cíl;
- BFF API routy mezi prohlížečem a Luxart adapterem;
- podepsaná serverová session v produkční `HttpOnly`, `Secure`, `SameSite=Lax` cookie; Luxart `user_id` se neposílá klientovi jako autorita;
- ověřovač session přijme pouze kladné bezpečné celočíselné Luxart `user_id`, celočíselné časové hranice, životnost nejvýše osm hodin a token do 2 KiB; i správně podepsaná neplatná struktura fail-closed propadne na odhlášený stav;
- live login a následný refresh odmítnou neúplnou Luxart identitu: session vznikne pouze pro kladné celočíselné `user_id` a konečný stav kreditu; vadný upstream payload vrací privacy-safe `502` bez cookie;
- odpověď `GET User` při refreshi se navíc musí přesně shodovat s `user_id` v podepsané session; jiný klient se odmítne před vrácením profilu, kreditu nebo historie;
- živý výpis odmítne celý vadný Luxart feed místo tichého převodu chybějících nebo neplatných čísel na nulu; kontroluje zejména resort, kategorii, službu, délku, cenu, kapacitu, obsazenost a sál, ale zachová všechny platné neznámé sály a typy lekcí;
- seznam rezervací, historie kreditu a watchdog jsou stejně fail-closed: odmítnou nečíselná nebo nulová povinná ID, neplatná data a částky, cizí resort, watchdog jiného klienta, duplicitní výsledné identifikátory i odpověď, která není pole; chyba se normalizuje na privacy-safe `502` místo částečného účtu;
- live logout je lokální bezpečnostní operace nezávislá na Luxart endpointu a rate-limit databázi; důvěryhodný Origin cookie vždy smaže, cizí Origin dostane `403` bez změny session;
- živé mapování uživatele, kreditu, všech `api/Lesson` položek a seznamu/vytvoření/storna rezervace;
- kontrola původu mutačních požadavků a bezpečné normalizované chyby API;
- health/readiness endpointy a lokální end-to-end simulace dokumentovaného Luxart kontraktu;
- automatické Playwright E2E na 1440 × 900 a 390 × 844 včetně WCAG A/AA kontroly, řízeného počátečního focusu, uzavřeného Tab cyklu, `Escape` a návratu focusu u obou dialogů;
- přepínatelná a perzistentní CZ/EN lokalizace, která předává jazyk i Luxart API;
- serverem vlastněný sedmidenní interval v `Europe/Prague` a pevný resort 1; veřejné URL parametry nemohou změnit rozsah, resort ani zúžit povinný feed, adapter odmítá cizí resort v ID lekce i upstream odpovědi a kontraktní test přímo dokazuje `pocet_dni_dopredu=7` přes oba přechody letního času;
- oblíbené lekce perzistentní v prohlížeči a izolované podle přihlášeného klienta;
- bezpečnostní CSP/HSTS hlavičky, korelační `X-Request-ID` a sdílené omezení frekvence veřejného rozvrhu, účtových čtení, loginu i mutací;
- jednotný aplikační limit 64 KiB pro běžná JSON těla, který zastaví deklarované i streamované nadlimitní požadavky před parsováním; neplatný JSON ani jeho obsah se neodráží v live chybě, Stripe webhook má oddělený podepsaný raw-body limit 1 MiB;
- explicitní `no-store` pro všechny odchozí Luxart požadavky a streamovaný limit 4 MiB na jejich JSON odpovědi; nadlimitní nebo neplatná odpověď se nevypíše a u zápisové operace vyvolá ruční reconciliation bez automatického opakování;
- úspěšný zápis už nikdy nevytvoří náhodný lokální identifikátor při chybějícím Luxart `uuid`: rezervaci bez `uuid` musí jednoznačně potvrdit následný seznam; neúplná nebo nejednoznačná odpověď rezervace, storna, watchdogu či platby přejde do ruční reconciliation a syrový text Luxart chyby se neodráží klientovi;
- persistentní CS/EN outage/retry stav nezaměňuje nedostupný Luxart snapshot za prázdný rozvrh a ukazuje privacy-safe korelační ID; vypršená session fail-closed odstraní starého klienta a otevře prázdný login bez předvyplněných demo údajů;
- fail-closed live capability přepínače: produkční top-up je skrytý a `BOOKING_MUTATIONS_ENABLED=false` poskytuje okamžitý read-only rollback;
- verzovaný business-rule profil už zapisuje bezplatné běžné storno do `00:00 Europe/Prague` na začátku dne lekce a drží live rezervace vypnuté, dokud Zone4You písemně nepotvrdí pozdní/no-show částky, možnost pozdního online storna, Reformer, rezervační okno a kreditní mechaniku; aktivace vyžaduje shodu implementace, stav `confirmed`, `BOOKING_RULES_CONFIRMED=true` a SHA-256 přesného profilu;
- read-only UI nezobrazuje historické předpoklady 48 h / 4 h / 100 Kč jako fakta; demo je výslovně označuje jako ukázkové hodnoty;
- demo v CZ i EN odděluje nepotvrzené storno Reformeru od známé půlnoci běžných lekcí; Reformer proto nedostane falešný bezplatný cutoff a živé mutace bez úplného profilu neprojdou;
- perzistentní PostgreSQL booking ledger: `Idempotency-Key`, serializace mutací jednoho klienta, replay stejného výsledku a blokace slepého opakování po nejasném Luxart timeoutu;
- atomický PostgreSQL rate limit pro login a mutace sdílený mezi serverless/multi-instance procesy; při výpadku ochrany požadavek fail-closed odmítne a readiness přejde do `not_ready`;
- Vercel rate-limit klíč používá pouze validovanou platformní klientskou IP z `x-vercel-forwarded-for`; obecné podvržené proxy hlavičky se v hostovaném runtime ignorují;
- serverem vytvářený Stripe Checkout endpoint, ověření raw webhook podpisu, opětovné načtení Checkout Session ze Stripe, PostgreSQL event/session ledger a Luxart `POST api/Payment` sink podle veřejného payloadu;
- potvrzený a hashovaný platební produktový profil drží live Stripe vypnutý při jakémkoli driftu schválených částek 500 / 1 000 / 2 000 / 5 000 / 10 000 Kč;
- read-only runtime probe, provozní/rollback runbook a UAT checklist;
- automatický privacy-safe rollback drill ověřující do pěti minut rozvrh a fail-closed rezervaci, storno, watchdog i Stripe Checkout;
- provider-neutral test alertu s fingerprint potvrzením cíle a privacy-safe důkazem; skutečné doručení musí potvrdit support vlastník;
- finální release-dossier gate svazuje přesný commit a launch okno s hashovanými živými důkazy Luxartu, úplností feedu/sálů, UAT, alertu, pětiminutového aplikačního rollbacku, čerstvého přesného DNS rollback baseline, Memberzone fallbackem a výslovným cutover souhlasem;
- bezpečný dossier preparátor automatizuje pouze kontrolu souborů a SHA-256; výstup je vždy nepřepisovatelný NO-GO draft a finální brána odmítne placeholder schvalující osoby i nepotvrzený alert;
- owner-only DNS capture uloží před změnou přesné A/AAAA/CNAME hodnoty bez jejich vypsání do konzole a bez TTL falešného driftu; těsně před změnou jediná předcutover brána v jednom běhu ověří celý schválený dossier i nezměněný DNS fingerprint, zatímco post-cutover brána pevně ověří skutečnou produkční doménu, DNS/HTTPS, schválený commit a fázi, živý Luxart a úplný CS/EN sedmidenní feed před otevřením pilotní skupiny; při chybě vyžaduje návrat na uložené hodnoty;
- fail-closed deployment preflight odděluje read-only, booking bez plateb a booking se Stripe, odmítá CLI/test secrets v runtime prostředí a váže readiness i release dossier na přesný commit a fázi;
- Vercel hostingový kontrakt s evropským function regionem `fra1`; readiness, runtime probe, release dossier i post-cutover kontrola jiný region fail-closed odmítnou. Vznikl nový izolovaný demo/mock Preview pro klientskou prezentaci, ale má 0 live runtime secrets a záměrně není stagingovým ani release důkazem; historický produkční alias a cílová doména se nepoužívají;
- launch gate vyhodnocuje jen kontroly relevantní pro schválenou fázi: booking bez plateb explicitně přeskočí čtyři infrastrukturní Stripe gate, ale projde pouze s vypnutými platebními mutacemi; Stripe fáze je vyžaduje všechny;
- úplný mock scénář a API smoke test;
- produkční build a TypeScript kontrola;
- automatické bezpečnostní hlavičky a zákaz cachování API odpovědí;
- CI gate pro typecheck, build, dependency audit a API smoke.
- externí GitHub Actions jsou připnuté na neměnné plné commit SHA; automatický test odmítne pohyblivý tag a ruční legacy Pages workflow nemá nepoužívané OIDC oprávnění;
- read-only ověřovač veřejné Luxart dokumentace kontroluje 11 používaných endpointů a povinná pole, ale výslovně nevytváří živý Zone4You ani launch důkaz;
- původní statický GitHub Pages deploy je pouze ruční legacy náhled, ne produkční kanál.

### Není produkční

- `RealLuxartAdapter` je implementovaný pro login, `User`, všechny `Lesson`, kreditní historii a `Reservations` včetně vytvoření a storna, ale zatím je ověřený jen proti lokální kontraktní simulaci, nikoli testovací databázi Zone4You;
- chybí potvrzené Zone4You mapování čísel sálů na Luxart `id_resource` a živé anonymizované fixtures;
- booking ledger prošel lokálním souběžným testem proti skutečnému PostgreSQL; není produkční, dokud nebude provisionovaná TLS databáze, aplikovaná migrace `002`, provedený fault-injection test proti Luxart test DB a ruční reconciliation drill;
- platební cesta je lokálně implementovaná a PostgreSQL ledger prošel skutečným souběžným integračním testem; není však produkční, dokud nebude provisionovaná TLS databáze, aplikovaná migrace, vložené Stripe secrets, registrovaný webhook a živě potvrzený Luxart `zpusob_uhrady` i upstream deduplikace;
- sdílený rate limit prošel skutečným 12vláknovým PostgreSQL testem a pustil přesně nakonfigurovaný počet požadavků; produkční readiness čeká na pooled TLS URL a aplikaci migrace `003`;
- aplikace záměrně neposílá duplicitní emailové/WhatsApp notifikace; pro watchdog se očekává Luxart notifikace, kterou je nutné ověřit na test DB;
- oblíbené lekce jsou perzistentní na zařízení a izolované podle klienta; případná synchronizace mezi zařízeními nemá potvrzené úložiště/požadavek;
- zapomenuté heslo je rozhodnutím klienta mimo pilot; chybí doplnění profilu a historie navštívených lekcí;
- anglická lokalizace je implementovaná lokálně; živé anglické Luxart texty je nutné ověřit proti Zone4You instanci na domluveném portu 9191;
- chybí datový model a UX pro Squash, stolní tenis a masáže;
- lokální i sdílený PostgreSQL rate limiting, privacy-safe korelační chyby, provozní runbook, rollback i alert ověřovač jsou hotové; chybí databázová konfigurace/migrace na hostingu, konkrétní alert kanál/support vlastník a provedení obou drillů na stagingu;
- release dossier má fail-closed validátor a bezpečnou šablonu, ale nemůže být potvrzený bez skutečných čerstvých staging důkazů a oprávněných schválení;
- Luxart email dodal testovací klienty a IT potvrdilo dohodu o zveřejnění portu 9191, nikoli přesnou URL nebo rozhodnutí o gateway autentizaci; režim a případné serverové credentials musí potvrdit IT před prvním probem;
- testy pokrývají demo API flow, mapování kontraktu, produkční atributy session cookie, refresh/logout a následný `401`, logout bez Luxart/limiter dostupnosti, zamítnutí cizího Originu bez smazání cookie, Origin ochranu, Luxart mutation timeout, idempotentní replay a souběh nad skutečným lokálním PostgreSQL; nepokrývají ještě živý Luxart test server.
- quality gate prochází aktuální soubory i úplnou Git historii, blokuje známé dříve zveřejněné Luxart testovací údaje podle jednosměrných otisků, privátní klíče a typické živé tokeny a v chybě nikdy nevypíše nalezenou hodnotu; CI proto checkoutuje celou historii.

Automatický stav lze kdykoli zobrazit příkazem `npm run check:launch`. Gate záměrně vrací `NO-GO`, dokud nejsou produkční závislosti skutečně hotové.
**Aktualizace plné regrese 11. 9.:** obnovená bezpečná větev prošla 164/164 integračními a jednotkovými testy, produkčním sestavením a 54/54 provedenými lokálními Playwright scénáři na 320 × 568, 390 × 844, 768 × 1024, landscape 844 × 390 a 1440 × 900; jedna desktopová duplicita čistě mobilního ergonomického testu je záměrně přeskočena. Izolovaný veřejný Vercel Preview navíc prošel 20/20 nízkoobjemovými browser scénáři ve stejné matici, včetně jediného loginu a vytvoření/storna běžné lekce i Reformeru; 5 nadbytečných/nevhodných variant bylo záměrně přeskočeno, aby test neobcházel login rate limit. Externí běh je před prvním loginem vázaný na přesný 40znakový Git commit a systémový region `fra1`. Watchdog mutace mají samostatný fail-closed přepínač a omezený pilot je musí držet vypnuté; budoucí smazání navíc vyžaduje, aby se záznam znovu našel ve vlastním Luxart seznamu přihlášeného klienta. Mapy názvů sálů/typů i `cislo_salu` → `id_resource` používají společnou striktní validaci v preflightu, runtime a release dossieru; žádná chybná položka se tiše nezahodí ani nedostane do UI. Luxart ID se přijímají jen jako kanonická bezpečná celá čísla a payload rezervace/watchdogu musí přesně souhlasit s kategorií, službou a časem zakódovanými v ID výskytu. Adaptér odmítá duplicitní ID výskytu už při interním znovunačtení rozvrhu před rezervací, takže konfliktní Luxart řádky nemohou tiše vybrat chybný sál ani `id_resource` a nevznikne žádný zápis. Neznámý Luxart `success` kód, včetně `0` nebo jiné kladné hodnoty mimo povolené `1`/`2`, nemůže vyrobit falešné potvrzení storna rezervace ani watchdogu. Idempotentní ledger odmítne jako nejistý každý Luxart výsledek s jiným klientem nebo výskytem, nekonzistentní kategorií, časem bez zóny či zápornou cenou nebo poplatkem; bezpečné storno musí obsahovat i přesný identifikátor, zónovaný čas a poplatek včetně nuly. Veřejné JSON/XML příklady Luxartu dokládají čas s `Z` nebo číselným offsetem; adapter u lekcí, rezervací, kreditu i watchdogu odmítá čas bez zóny, neexistující datum a nepřípustný offset, aby výsledek nezávisel na časové zóně hostingu. Zobrazení i rezervační předkontrola používají přímo Luxart `volno`; členské kvóty nemůže přepsat prostý dopočet `kapacita - obsazeno` a nekonzistentní dostupnost zneplatní feed. D1 brána nezakazuje potenciálně legitimní hostname, ale vyžaduje výslovně schválený SHA-256 otisk přesného HTTPS originu a shodu transportního i autentizovaného důkazu. Její soubor nyní obsahuje samostatnou D1 atestaci a dossier schématu 3 ji povinně validuje, takže samostatný diagnostický read-only výstup nemůže obejít `/Help` a origin gate. Dependency audit hlásí 0 známých zranitelností. Zone4You IT potvrdilo dohodu o zveřejnění portu 9191, nikoli však přesný host, HTTPS, aktivní dostupnost, testovací databázi ani gateway auth. Přímé ověření 11. 9. ukázalo, že `api.memberzone.online:9295/Help` je Luxart API dokumentace, zatímco `api.memberzone.online:9191/Help` vrací 404 a kořen portu 9191 obsluhuje starý IIS/WCF adresář, nikoli dokumentované Zone4You API; žádný z odkazovaných souborů nebyl otevřen. Live integrace a cutover proto zůstávají `NO-GO`.
Texty profilu, lekcí, UUID a kreditní historie z Luxartu mají nyní explicitní typové, délkové a kontrolní-znakové limity. Víceřádkový popis je povolený, ale jediná extrémní hodnota nemůže zahltit mobilní UI; profilové hodnoty se zalamují uvnitř karty.
Personalizované `user_posible` se nyní zachová jako bezpečná rezervační způsobilost. Lekce se při zákazu klienta neschová, takže scope všech `api/Lesson` zůstává úplný; `0` však zablokuje akci a chybějící nebo nebinární hodnota v přihlášené mutační cestě zastaví zápis před Luxartem. Skutečný enum musí potvrdit Zone4You test DB.
Složená D1 brána nyní tuto podmínku měří ještě před UAT: po přihlášení porovná personalizovaný CS/EN rozvrh s celým anonymním feedem, vyžaduje známou binární hodnotu u každé lekce a do chráněného důkazu ukládá jen hashe a agregované počty povolených/nepovolených položek.
Řízené mutační UAT se nově zastaví ještě před prvním zápisem, pokud vybraná lekce nemá explicitní personalizované povolení, autoritativní volné místo, validní mapovaný sál, otevřené rezervační okno nebo bezpečně dostupné online storno se shodným očekávaným poplatkem. Tyto předpodmínky jsou součástí finálního release dossieru, nikoli jen operátorského checklistu.

UAT se zároveň před loginem váže na přesný 40znakový commit, launch fázi a region `fra1` z živého `/api/readiness`. Release dossier tutéž provenienci znovu porovná se schvalovaným commitem a fází, takže úspěšný mutační test ze staršího deploye nebo jiného capability profilu nelze omylem znovu použít.

Po stornu UAT porovnává přesnou množinu identit všech dříve aktivních rezervací klienta. Stejný počet už nemůže skrýt nechtěné odstranění jiné rezervace a její nahrazení novým záznamem; finální dossier navíc vyžaduje privacy-safe otisky testované lekce i rezervace a explicitní potvrzení zachování původní množiny.

Storno odpověď už sama nevypíná cleanup. UAT rezervace je považována za bezpečně odstraněnou teprve po následném snapshotu; jeho korelační ID i ID všech ostatních read-after-write kontrol vstupují do release evidence. Nedostupný nebo rozcházející se snapshot tedy udrží fail-closed cleanup/reconciliation cestu.

Poslední úplný lokální běh 30. 8. prošel 100/100 integračními/jednotkovými testy, produkčním buildem, čistě všemi 16/16 Playwright běhy (osm scénářů ve dvou zobrazeních) a 0 známými dependency zranitelnostmi. Booking, platební a sdílený rate-limit ledger navíc samostatně prošly po 1/1 souběžném testu proti skutečnému PostgreSQL bez zbylých testovacích tabulek. Runtime probe ověřil českou i anglickou aplikační cestu nad stejnými 24 výskyty lekcí, 3 Reformery a všemi třemi místnostmi a reportuje fázi, commit, booking i platební stav. Hraniční testy dokazují sedm pražských kalendářních dnů přes letní i zimní půlnoc, nepřepsatelný resort 1 a fail-closed ochranu všech Luxart read cest při nedostupném sdíleném limiteru. Veřejný lesson feed i snapshot nyní fail-closed odmítnou neplatný čas, nekladný časový interval, neúplná zobrazovaná pole, duplicitní occurrence ID nebo jediný výskyt na osmém pražském dni, včetně správného zacházení s UTC časem krátce po pražské půlnoci. Readiness ověřuje celý sedmidenní interval, legitimně dovolí jednotlivý prázdný den, ale při celém prázdném či vadném feedu vrátí 503 a rozliší `schedule=empty`, `invalid` nebo `unavailable`; úspěch `schedule=ready` je svázán s runtime probem, release dossierem i post-cutover kontrolou. Luxart i staging evidence obsahují přesný pražský interval a meze výskytů; finální dossier odmítne rozdílný interval i jedinou lekci mimo něj. Skutečné Luxart/UAT/rollback/alert producenty jsou nyní přímo testované proti stejnému finálnímu kontraktu: release-grade Luxart běh musí použít testovací login, korelační ID musí být unikátní a alert musí pocházet z nakonfigurovaného support kanálu. Post-cutover ověřovač navíc před otevřením pilotu fail-closed porovná skutečnou produkční DNS/HTTPS cestu, commit, fázi a celý CS/EN feed bez vypsání DNS adres nebo ID lekcí. Samostatná desktopová a mobilní browser kontrola potvrdila 24 lekcí, sedm správných dnů, EN časy, persistentní error/retry a session-expiry stavy s korelačním ID, nepřihlášenou rezervaci bez zápisu, zachování session po reloadu, bezpečný logout s následným `401`, WCAG scan obou dialogů, počáteční/vrácený focus, Tab trap a `Escape`, nulový page overflow a žádnou neočekávanou aplikační konzolovou chybu. Route test navíc potvrzuje live logout bez Luxartu/limiteru a `403` bez smazání cookie pro cizí Origin. Bez nastavené launch fáze má gate 7/27 zelených automatických kontrol a zůstává správně `NO-GO`; zamýšlená fáze `booking_without_payments` má 9/23, přičemž čtyři Stripe gate explicitně vynechá. Release dossier navíc ověřuje, že runtime opravdu hlásí skrytý Stripe, vypnutý watchdog, povinnou angličtinu, oblíbené na zařízení a žádné zapomenuté heslo.

## 4. Kritická rozhodnutí a vstupy

| ID | Potřeba | Vlastník | Blokuje |
|---|---|---|---|
| D1 | **Potvrzeno:** pilot obsahuje všechny položky `api/Lesson`; služby mimo `Lesson` zatím ne | Zone4You + Michal | scope freeze |
| D2 | **Částečně potvrzeno 11. 9.:** Luxart a Zone4You IT se dohodli na zveřejnění portu `9191` kvůli rezervacím. Chybí přesný host a `/Help` URL, potvrzení že port je už aktivní, HTTP(S), test DB a gateway auth režim. Veřejné referenční `/Help` na portu 9295 je dostupné a datové endpointy bez credentials vracejí 401; nejde však o Zone4You instanci. `api.memberzone.online:9191/Help` aktuálně vrací 404 a kořen portu 9191 není dokumentované Luxart API, takže toto spojení nelze použít bez opravy nebo jiné adresy od IT. | Zone4You IT + Luxart | živý read-only test a celou live integraci |
| D3 | **Částečně potvrzeno:** společná dokumentace je dostupná; chybí živé odpovědi a Zone4You mappingy | Luxart | adapter a kontraktní testy |
| D4 | Testovací klienti byli dodáni, ale chybí serverový přístup a výslovné povolení mutačních testů | Zone4You | live QA |
| D5 | UI podporuje příjmení/e-mail/login a obecné heslo; potvrdit živý vztah login / heslo / číslo karty | Luxart + Zone4You | autentizaci |
| D6 | **Částečně potvrzeno:** minimální kredit je 200 Kč a běžné storno je bez pokuty do `00:00 Europe/Prague` na začátku dne lekce. Chybí pozdní poplatek/no-show, povolení pozdního online storna, Reformer, rezervační okno a kreditní mechanika. Připravený je [tříbodový rozhodovací požadavek](zone4you-business-rules-decision-request.md). | Zone4You | business rules |
| D7 | **Produktově potvrzeno:** Stripe top-up a částky 500 / 1 000 / 2 000 / 5 000 / 10 000 Kč; Vercel projekt existuje, ale má 0 runtime proměnných a chybí pooled TLS PostgreSQL pro rate limit, booking i platby, test/live klíče, webhook secret a registrace staging webhooku | Zone4You | bezpečný multi-instance provoz, booking mutace a platby |
| D8 | **Částečně potvrzeno:** cílová doména `booking.zone4you.cz` a evropský runtime region `fra1`; veřejné A/AAAA už ukazují na existující nginx mimo Vercel, ale HTTPS certifikát hostname nepokrývá a HTTP vrací 404. Doména není ve Vercelu připojená, aktuální launch commit není nasazený a zbývá vlastník stávajících DNS záznamů i rozhodnutí Static IPs vs. veřejný HTTPS/VPN přístup k Luxartu | Zone4You IT + release owner | staging a produkci |
| D9 | **Potvrzeno:** standardní emailové notifikace posílá Luxart; naše aplikace je nesmí duplikovat | Zone4You + Luxart | notifikace |
| D10 | Pilotní skupina klientů, kontaktní osoba recepce a launch okno | Zone4You | UAT a cutover |

Žádné heslo, API klíč ani osobní data se neposílají e-mailem nebo do repozitáře. Tajné hodnoty patří přímo do schváleného secret store hostingu.

## 5. Pracovní proudy

### W0 — Scope a autorita

- uzavřít D1–D10;
- určit, zda je `/Help` dostupný jen přes VPN/allowlist;
- uložit anonymizované API fixtures a verzi kontraktu;
- definovat zdroj pravdy pro každou operaci a notifikaci.

Výstup: schválený scope, kontakty, testovací účet a integrační přístup.

### W1 — Luxart kontrakt a bezpečná session

- namapovat `User_data` a vytvořit serverovou session v `HttpOnly`, `Secure`, `SameSite=Lax` cookie;
- nedržet heslo ani číslo karty v browser storage;
- mapovat rozvrh, kapacitu, cenu, instruktora, zástup a rezervovatelnost;
- mapovat seznam/vytvoření/storno rezervace a `watchdog_III` hlídání místa včetně výpisu a odebrání;
- normalizovat Luxart chyby na bezpečné aplikační kódy;
- přidat timeout, omezené retry pouze pro bezpečné čtení a korelační ID;
- kontraktní testy z anonymizovaných odpovědí.

Výstup: end-to-end login a booking proti testovací databázi Luxartu.

### W2 — Produktové mezery MVP

- perzistentní oblíbené lekce;
- historie klienta a doplnění chybějících profilových údajů;
- povinná CZ/EN lokalizace;
- jasný hybridní odkaz na Squash/masáže, pokud nejsou ve scope pilotu;
- potvrzovací obrazovky před rezervací, stornem a platbou.

Výstup: schválená kompletní klientská cesta pro pilotní scope.

### W3 — Platby a notifikace

- Stripe Checkout/Payment Intent vytváří pouze server;
- webhook se ověřuje podpisem a stejný event nesmí připsat kredit dvakrát;
- po potvrzené platbě se volá Luxart `POST api/Payment` s potvrzeným mappingem;
- vést trvalý idempotency/audit ledger mimo browser;
- implementovat schválené emaily a případně WhatsApp;
- zajistit, aby jednu událost neposílal současně Luxart i naše aplikace.

Výstup: testovací platba od browseru po kredit v Luxartu právě jednou.

### W4 — Kvalita, bezpečnost a provoz

- testy business pravidel, API kontraktů, session, autorizace a idempotence; rezervace/storno používají před Luxart zápisem perzistentní claim a nejasný výsledek přechází do ruční reconciliation;
- E2E test desktopu a mobilu pro všechny kritické scénáře;
- accessibility kontrola klávesnicí, focus, labely a kontrast;
- rate limiting loginu a mutací, CSRF/Origin kontrola a bezpečné chybové odpovědi;
- CSP po ověření všech potřebných Stripe a mediálních domén;
- health/readiness endpoint, error monitoring, privacy-safe logy a alerty;
- záloha/rollback, incident kontakty a provozní runbook.

Výstup: release candidate s dohledatelnými důkazy všech gateů.

## 6. Akceptační brány

| Gate | GO podmínka |
|---|---|
| G0 Scope | D1–D10 mají vlastníka a rozhodnutí; pilotní scope je zmrazený |
| G1 Contract | `/Help`, test účet a anonymizované fixtures jsou dostupné; kontraktní testy jsou zelené |
| G2 Core booking | Login, rozvrh, kredit, rezervace, storno a watchdog hlídání místa prošly v Luxart test DB nebo je watchdog bezpečně vypnutý |
| G3 Payments | Stripe test platba připíše kredit právě jednou; duplicitní webhook nic nepřidá |
| G4 Quality | CI, bezpečnostní kontrola, mobil/desktop E2E a accessibility nemají kritický nález |
| G5 Pilot | Schválení klienta, paralelní provoz, support/monitoring a rollback jsou připravené a mají hashované čerstvé důkazy |
| G6 Production | platný release dossier s výslovným cutover schválením před DNS změnou; po změně platný TLS a zelený `verify:production-cutover` pro skutečný commit/fázi/feed před otevřením pilotu |

Automatický `check:launch`, zelený build ani zelené CI samy o sobě neopravňují produkční cutover.

## 7. Povinné end-to-end scénáře

1. Nepřihlášený klient vidí rozvrh, ale nemůže provést rezervaci bez loginu.
2. Login načte správného klienta a kredit; refresh zachová bezpečnou session.
3. Rozvrh odpovídá Luxartu podle ID lekce, času, sálu, kapacity, ceny a instruktora.
4. Rezervace volného místa se propíše do Luxartu a kredit se změní právě jednou.
5. Duplicitní klik/retry nevytvoří dvě rezervace.
6. Rezervaci nelze vytvořit mimo písemně potvrzené rezervační okno nebo bez minimálního kreditu 200 Kč.
7. Storno, případný poplatek a no-show respektují písemně potvrzené obecné i Reformer pravidlo; do jeho potvrzení zůstávají živé mutace vypnuté.
8. Plná lekce nabídne hlídání uvolněného místa pouze při aktivním Luxart watchdogu; UI nezobrazuje smyšlenou pozici.
9. Uvolnění místa vyvolá právě jednu Luxart notifikaci; aplikace neslibuje automatickou rezervaci.
10. Stripe úspěch připíše kredit; duplicitní webhook je idempotentní; neúspěšná platba nepřipíše nic.
11. Logout zneplatní session a chráněné endpointy vrátí 401.
12. Mobil 390 × 844 a desktop 1440 × 900 jsou čitelné bez zakrytých akcí a horizontálního chaosu.
13. Výpadek Luxartu zobrazí bezpečnou hlášku, nevytvoří falešný úspěch a lze jej dohledat podle korelačního ID.
14. Starý Memberzone zůstane během pilotu dostupný a rollback je ověřený.

## 8. Sedmidenní kritická cesta

Sedmidenní termín je dosažitelný pouze jako přísně řízený pilot všech `api/Lesson` položek. Přesná URL a přístup na domluvený port 9191 i bezpečný testovací účet musí být funkční v D1; každý další den prodlení přímo ubírá den z integračního testování.

| Den | Povinný výstup |
|---|---|
| D0 | IT požadavek, potvrzený scope, veřejný `/Help`, kontraktní mapper všech lekcí |
| D1 | Přístup na Zone4You test API, živý login/User/Lesson fixture, potvrzené mapování sálů a kategorií |
| D2 | Serverová session, všechny lekce a kredit na stagingu |
| D3 | Vytvoření/seznam/storno rezervace proti test DB, bez duplicit |
| D4 | Watchdog hlídání místa, chybové stavy, Luxart emailové šablony; Stripe staging test jen s klíči, databází a webhookem |
| D5 | Mobilní/desktopové E2E, accessibility, bezpečnost, výpadek Luxartu a monitoring |
| D6 | UAT recepce a pilotní skupiny, opravy pouze P0/P1, ověřený rollback |
| D7 | DNS/TLS, produkční secrets, smoke, omezený pilot a aktivní dohled |

Pokud nebude do konce D1 dostupný Luxart test server, není bezpečné slíbit transakční launch v D7. Lze spustit pouze read-only rozvrh nebo zachovat Memberzone jako booking fallback. Platby nesmějí blokovat core pilot: bez živě zelené E5 se dobití kreditu skryje a klient použije stávající kredit/recepci.

## 9. Nejbližší řízený krok

1. Od IT Zone4You získat přesnou `http(s)://<host>:9191/Help` URL a potvrzení aktivního přístupu, test DB a auth režimu; termín v D1.
2. **Scope je potvrzený:** všechny `api/Lesson` položky včetně všech sálů a Reformeru; Squash/masáže zatím mimo pilot.
3. Klient potvrdí D6, D7 a D10: finální pravidla, Stripe test klíče a pilotní tým/launch okno.
4. Po zpřístupnění API živě ověřit hotovou cestu login/session → User/kredit → Lessons → Reservations → storno a lokálně namapovaný `watchdog_III`; následně potvrdit notifikaci a Payment.
5. Každá funkce projde nejprve kontraktním testem, potom lokálním browser flow, stagingem a teprve pak pilotem.
