# Zone4You Booking — prováděcí a evaluační plán pilotu

Aktualizace: 2026-09-12

Pilotní termín: původní 2026-09-05 uplynul; nový cutover bude nejdříve D7 sedmidenního běhu zahájeného aktivním Luxart přístupem a musí jej potvrdit Zone4You

Řízení: Codex

Rozhodovací autorita a finální cutover: Michal / Zone4You

## 1. Neměnný výsledek pilotu

Pilot na `booking.zone4you.cz` zpřístupní všechny položky vrácené Luxart `api/Lesson`, bez whitelistu názvů, kategorií nebo sálů. Scope zahrnuje výpis lekcí, všechny sály a Reformer. Squash, stolní tenis a masáže jsou mimo tento pilot, protože používají jiné oblasti Luxart API.

Luxart zůstává zdrojem pravdy pro klienta, kredit, lekce a rezervace. Starý Memberzone zůstane během pilotu dostupný jako fallback. Žádný automatický test, zelený build ani dosažení termínu samo o sobě neopravňuje cutover.

## 2. Definice hotového pilotu

Pilot je `GO` pouze tehdy, když současně platí:

1. všechny automatické brány E0–E9 jsou zelené a mají uložený důkaz;
2. login, klient, kredit, rozvrh, vytvoření rezervace a storno byly ověřeny proti Luxart testovací databázi;
3. Luxart watchdog hlídání místa je buď živě ověřené, nebo je ve UI bezpečně vypnuté; původně popsaná pořadníková čekací listina není veřejným kontraktem doložena;
4. Stripe top-up je buď živě ověřený v test režimu včetně opakovaného webhooku, nebo je ve UI bezpečně skrytý;
5. UAT recepce a pilotních klientů nemá otevřený P0/P1 nález;
6. monitoring, support kontakt, pětiminutový aplikační rollback a přesný DNS rollback jsou připravené a vyzkoušené;
7. DNS/TLS a produkční secrets jsou nastavené mimo repozitář;
8. Michal / Zone4You výslovně schválí omezený pilotní cutover.

Pokud některá podmínka neplatí, výsledek je `NO-GO`, read-only rozvrh nebo pokračování přes starý Memberzone — nikdy předstíraný transakční úspěch.

## 3. Role a odpovědnosti

| Oblast | Odpovídá | Schvaluje / dodává |
|---|---|---|
| Projekt, kód, testy, evidence, browser QA, release doporučení | Codex | Michal |
| Business pravidla, pilotní uživatelé, support a launch okno | Zone4You | Michal / vedení Zone4You |
| Veřejný HTTPS origin a potvrzení překladu `9191 → 9759` na Zone4You REST API, aktivní přístup, test DB, auth a DNS | Zone4You IT + Luxart | Zone4You |
| API kontrakt, endpointy, `id_resource`, watchdog a emailové šablony | Luxart | Zone4You + Luxart |
| Stripe účet, test/live klíče a finanční pravidla | Zone4You | Michal / oprávněný správce Stripe |
| Finální cutover a případný rollback | Michal / Zone4You | výslovné schválení |

Codex smí samostatně upravovat projekt, přidávat testy, provádět read-only kontroly a lokální simulace. Bez nové výslovné autority neprovede produkční deploy, DNS změnu, živou rezervaci/platbu, nepřenese secrets a neodešle komunikaci třetí straně.

## 4. Sedmidenní kritická cesta

| Datum | Povinný výstup | Exit kritérium | Fallback při nesplnění |
|---|---|---|---|
| Dokončený D0 | scope, audit, IT požadavek, mapper všech lekcí, session, kontraktní simulace a veřejný demo Preview | E0, lokální část E1–E3 a prezentační smoke zelené | live brány zůstávají červené |
| Nový D1 | potvrzený `memberzone_rest_v1`, přesný HTTPS origin, živý login/User/Lesson a mapování sálů na `id_resource` | anonymizované fixtures a read-only live test | bez rozhodnutí kontraktu a přístupu se sedmidenní běh nespustí |
| D2 | kredit a všechny lekce na chráněném stagingu | 100 % Lesson položek se zobrazí bez pádu mapperu | read-only demo/fallback Memberzone |
| D3 | seznam, vytvoření a storno rezervace v test DB | E3 zelená včetně opakování a konzistence | rezervace v novém UI vypnutá |
| D4 | watchdog hlídání místa; Stripe pouze s klíči a potvrzeným Payment mappingem | E4 a případně E5 zelená | watchdog/top-up skrýt, core pilot pokračuje |
| D5 | bezpečnost, výpadky, mobil/desktop, accessibility a monitoring | E6–E9 bez P0/P1 | opravy P0/P1, žádný scope navíc |
| D6 | UAT recepce a pilotní skupiny, nacvičený rollback | podepsaný UAT checklist a rollback důkaz | NO-GO / Memberzone |
| D7 | DNS/TLS, produkční secrets, smoke a omezený pilot | všechny brány + výslovný cutover souhlas | read-only nebo odklad transakcí |

Kritický externí deadline je přístup k Zone4You testovacímu API do konce D1. Každý další den prodlení ubírá celý den živému integračnímu a UAT testování.

## 5. Evaluační matice

### E0 — Scope a úplnost lekcí

| Kritérium | GO práh | Povinný důkaz |
|---|---|---|
| Úplnost `api/Lesson` | 100 % položek sedmidenní odpovědi resortu 1 je buď zobrazena, nebo explicitně označena jako nevalidní; žádný whitelist ani klientský override rozsahu/resortu | kontraktní test přímo ověří `date_start`, `pocet_dni_dopredu=7`, `id_kategorie=0` a `id_service=0` přes jarní i podzimní změnu času; živý důkaz porovná počet/ID proti anonymizované fixture |
| Personalizovaná rezervovatelnost | přihlášený CS i EN feed má shodný počet/hash jako anonymní feed; `user_posible=0` lekci neschová, ale zablokuje rezervaci; chybějící nebo nebinární hodnota nevytvoří Luxart POST | agregovaný `verify:luxart-d1` důkaz s povinnou D1 atestací `/Help`, schváleného originu a autentizovaného čtení + živá dvojice povolená/nepovolená lekce + request evidence |
| Sály a Reformer | známé mapování je správné; neznámý sál nesmí položku zahodit | test známého i neznámého `cislo_salu`, browser filtr |
| Scope mimo Lessons | Squash/masáže/stolní tenis nejsou omylem vydávány za lekce | scope checklist a UI kontrola |

### E1 — Luxart kontrakt a data

| Kritérium | GO práh | Povinný důkaz |
|---|---|---|
| Login/User/Lesson/kredit/Reservations | každý použitý endpoint odpovídá aktuálnímu `/Help` a živé test fixture | verzované anonymizované fixtures + kontraktní testy |
| Referenční REST drift | úplný sémantický otisk 11 veřejně dokumentovaných endpointů odpovídá schválenému baseline; změna skončí fail-closed | `verify:luxart-public-contract`, chyba `CONTRACT_DRIFT` |
| Klientský REST drift | D1 na schváleném Zone4You HTTPS originu před loginem ověří stejných 11 dokumentačních stránek a stejný sémantický baseline; odchylka nevytvoří evidence | D1 evidence verze 3 + finální dossier validace |
| Chybějící/nové pole | mapper nespadne; povinná nevalidní data mají bezpečný chybový stav | negativní testy |
| Secrets a osobní data | žádné heslo, hash, klíč ani neanonymizovaná odpověď v repozitáři/logu | diff scan + privacy review |
| Historie secrets | známé uniklé testovací Luxart údaje, privátní klíče a živé tokeny nejsou ani v předchozích Git objektech | `npm run scan:release-secrets` nad úplnou historií |
| Gateway autentizace | IT výslovně potvrdí `none`/Basic/Bearer/`X-*`; `verify:luxart-gateway-config` projde bez vypsání credentials | privacy-safe JSON + secret-store kontrola |

### E2 — Autentizace a session

| Kritérium | GO práh | Povinný důkaz |
|---|---|---|
| Session cookie | `HttpOnly`, `Secure` v pilotu, `SameSite=Lax`, omezená životnost | integrační test hlavičky `Set-Cookie` |
| Podvržení/expirace | změněný podpis a expirovaný token vždy skončí jako nepřihlášený | automatický test |
| Logout/refresh | refresh session zachová; důvěryhodný logout ji lokálně zneplatní i bez Luxartu/limiteru; cizí Origin ji nesmaže; chráněná API vrátí 401 | browser E2E + API test |
| CSRF/Origin | mutace z jiného nebo chybějícího originu skončí 403 | automatický test |

### E3 — Core rezervace

| Scénář | GO práh | Povinný důkaz |
|---|---|---|
| Seznam rezervací | UI odpovídá Luxart test DB podle ID, času, stavu a ceny | před/po fixture + browser E2E |
| Předmutací UAT | vybraná lekce je pro testovacího klienta výslovně povolená, má autoritativní volné místo a mapovaný sál, je v potvrzeném rezervačním okně a lze ji bezpečně stornovat s očekávaným poplatkem; jinak nevznikne POST | privacy-safe UAT preflight důkaz + negativní testy bez zápisu |
| Nová rezervace | právě jedna Luxart rezervace, správný klient, lekce, kategorie a `id_resource` | test DB důkaz + request fixture |
| Opakovaný klik/retry | nikdy nevzniknou dvě aktivní rezervace stejné lekce; stejný klíč i čerstvý druhý browser klíč vrátí uložený výsledek | nejméně 3 opakování + souběh dvou klíčů + konflikt/stejný výsledek + ledger důkaz |
| Storno | správná rezervace je zrušena právě jednou; poplatek/kredit odpovídá pravidlu | test DB před/po + UI |
| Chyba Luxartu | UI neukáže úspěch a lokálně nevznikne falešný stav; nejasný timeout je `uncertain` a blokuje slepý retry | fault-injection test + reconciliation záznam |

### E4 — Hlídání uvolněného místa (Luxart watchdog)

| Scénář | GO práh | Povinný důkaz |
|---|---|---|
| Plná lekce | nabídne hlídání jen pokud je `watchdog_III` potvrzený na Zone4You API | API + browser E2E |
| Přihlášení/odhlášení | jeden watchdog záznam pro klienta a výskyt lekce; bezpečné opakování | test DB před/po |
| Uvolnění místa | Luxart odešle upozornění podle svého watchdog pravidla; UI neslibuje pořadí ani automatickou rezervaci | řízený test s Luxartem |
| Notifikace | jedna událost = nejvýše jedna Luxart notifikace; samotná volba Luxartu jako vlastníka nestačí bez výslovného potvrzení aktivních Zone4You šablon | Luxart log/šablona; `LUXART_NOTIFICATION_TEMPLATES_CONFIRMED=true` až po potvrzení; jméno/role a čas v `approvals.luxartNotifications`; runtime/release/post-cutover `bookingNotifications=ready`; aplikace neduplikuje |

Veřejný kontrakt neobsahuje pozici ve frontě; jde o hlídání místa, nikoli o pořadníkovou čekací listinu. Není-li E4 živě potvrzená, `LUXART_WAITLIST_ENABLED=false` a UI hlídání nenabízí.

### E5 — Stripe a připsání kreditu

| Scénář | GO práh | Povinný důkaz |
|---|---|---|
| Úspěšná test platba | Stripe potvrzen, Luxart `POST api/Payment` zavolán právě jednou | Stripe event + audit ledger + kredit před/po |
| Opakovaný webhook | 10 replayů stejného eventu nepřipíše další kredit | idempotency test |
| Neúspěch/timeout | žádný kredit a bezpečný stav pro opakování/reconciliation | test declined/timeout |
| Částka a klient | server používá povolenou částku a klienta ze session, ne z browseru | API/security test |

Není-li E5 zelená, top-up se v pilotu skryje. Platby nesmí blokovat bezpečný core booking pilot.

### E6 — Bezpečnost a soukromí

| Kritérium | GO práh | Povinný důkaz |
|---|---|---|
| Dependency audit | 0 critical a 0 high známých zranitelností | CI audit |
| Čtení, mutace a login | rate limit veřejného rozvrhu, účtových čtení, loginu a mutací je aktivní a sdílený mezi instancemi; bezpečné chybové odpovědi bez interních detailů | automatický fail-closed + PostgreSQL souběžný test |
| Browser security | TLS, HSTS, CSP/frame/content-type politika odpovídá nasazení | kontrola hlaviček staging/pilot |
| Logy | bez hesel, session tokenů, Stripe secrets a neomezených osobních dat | privacy-safe log review |

### E7 — Funkční regrese

| Kritérium | GO práh | Povinný důkaz |
|---|---|---|
| Unit/contract/integration | 100 % povinné sady zelené | CI výstup |
| Build/typecheck | bez chyby | CI výstup |
| Browser konzole | 0 neočekávaných errorů v kritických scénářích | desktop a mobil log |
| Kritické scénáře | 14/14 z launch plánu projde nebo je funkce bezpečně vypnutá podle fallbacku | E2E report |

### E8 — UX a accessibility

| Kritérium | GO práh | Povinný důkaz |
|---|---|---|
| Desktop | 1440 × 900 bez zakryté akce, nečitelnosti nebo horizontálního chaosu | screenshot + E2E |
| Mobil | 390 × 844 bez zakryté akce a horizontálního scrollu hlavní stránky | screenshot + E2E |
| Klávesnice/focus/labely | každý kritický flow dokončitelný klávesnicí; žádný critical/serious a11y nález | accessibility report |
| Stavy | loading, empty, full, error, logged-out a expired-session jsou srozumitelné | stavová matice + browser QA |

### E9 — Provoz, rollback a pilot

| Kritérium | GO práh | Povinný důkaz |
|---|---|---|
| Health/readiness | health 200; readiness ověří neprázdný validní sedmidenní feed a hlásí `schedule=ready`; v booking fázi vrátí SHA-256 přesně nasazené resource mapy; při prázdném/vadném feedu, nedostupném Luxartu nebo neúplné live konfiguraci vrátí 503 | runtime test + probe JSON |
| Provenience buildu a sálů | preflight, readiness a release dossier mají stejnou schválenou fázi, celý Git SHA a stejný `resourceMapSha256` jako mapa použitá pro UAT | preflight + runtime JSON + dossier |
| Monitoring | privacy-safe `verify:alert-delivery` dostane 2xx a support ručně potvrdí stejné event ID; hosting monitor hlídá 5xx, Luxart timeout a neúspěšnou platbu | JSON důkaz + potvrzení supportu |
| Rollback | návrat do read-only je do 5 minut od owner-only startovní účtenky vytvořené příkazem `start:readonly-rollback` před změnou konfigurace automaticky ověřen `verify:readonly-rollback`; ověřený runtime má stejný commit, fázi `read_only` a region `fra1`; přesná HTTPS fallback URL Memberzone vrací neprázdný Zone4You rozvrh včetně Reformeru a dostupnost současně ručně potvrdí odpovědná osoba | privacy-safe owner-only JSON z `verify:memberzone-fallback`, celý SHA-256 startovní účtenky a svázaný časovaný rollback záznam se začátkem a okamžikem dosažení read-only; bez uloženého HTML nebo osobních údajů |
| UAT | 0 otevřených P0/P1; známé P2/P3 mají vlastníka a rozhodnutí | podepsaný checklist |
| Cutover | výslovné schválení Michala / Zone4You | zaznamenané rozhodnutí |
| Release dossier | přesný commit, aktivní launch okno, jmenovité potvrzení aktivních Luxart šablon a SHA-256 živých Luxart/runtime/UAT/rollback/alert/Memberzone důkazů projdou `verify:pilot-release`; žádné schválení nepředchází svému důkazu a cutover následuje po všech důkazech i schváleních | privacy-safe JSON výstup finálního gate s ověřenou chronologií |
| Příprava dossieru | `prepare:pilot-release` hashne pouze úspěšné pravidelné evidence soubory, nikdy je nepřepíše a vytvoří povinně NO-GO draft bez lidských schválení | nový soubor s `draft=true`, false/NO-GO approval poli a oprávněním jen pro vlastníka |
| Produkční doména po cutoveru | před otevřením pilotní skupiny `verify:production-cutover` do 60 s prokáže DNS, platné HTTPS hlavičky, schválený commit/fázi, živý Luxart, PostgreSQL rate limit, připravený booking a CS/EN feed přesně shodný se schváleným počtem, SHA-256 množiny výskytů, počtem Reformerů, sedmidenním pražským rozsahem, mezemi a dny | privacy-safe JSON svázaný s přesným owner-only pre-cutover souborem mladším 30 minut a stejným dossierem; vynechaná/přidaná lekce nebo nový pražský den vyžaduje nový důkaz; bez DNS adres, ID lekcí, secrets a osobních dat; chyba spouští DNS rollback |

## 6. Závažnost nálezů

| Úroveň | Definice | Dopad na launch |
|---|---|---|
| P0 | únik dat/secrets, nesprávná platba/kredit, cizí rezervace, úplný výpadek | okamžitý NO-GO / rollback |
| P1 | nelze se přihlásit, zobrazit všechny lekce, rezervovat nebo stornovat; falešný úspěch | NO-GO do opravy a retestu |
| P2 | funkční workaround, lokální UX/a11y problém bez finančního nebo datového dopadu | rozhodnutí před pilotem, vlastník a termín |
| P3 | kosmetika nebo zlepšení bez dopadu na dokončení flow | může do backlogu |

## 7. Provozní smyčka dlouhodobého úkolu

Codex opakuje pro každý pracovní balík tuto smyčku:

1. načte aktuální autoritu a stav projektu;
2. vybere nejbližší neblokovaný výstup na kritické cestě;
3. implementuje nejmenší bezpečný celek;
4. spustí unit/contract/integration testy, typecheck, build a audit podle rizika;
5. ověří kritický viditelný flow v prohlížeči;
6. uloží důkaz a aktualizuje gate/rizika/rozhodnutí;
7. pokračuje dalším neblokovaným bodem;
8. při externím blockeru připraví přesný požadavek a paralelně pokračuje jinou bezpečnou prací.

Práce se zastaví pouze před akcí, která vyžaduje novou autoritu (živá mutace, secrets, deploy, DNS, komunikace třetí straně nebo cutover), nebo pokud není možné bezpečně určit správný kontrakt.

## 8. Aktuální stav k 2026-08-30

### Zelené lokální důkazy

- scope všech `api/Lesson` položek je uzamčený;
- mapper zachová i neznámé sály a typy;
- podepsaná serverová session a Origin ochrana jsou implementované;
- User, kredit, Lessons a Reservations create/cancel jsou namapované podle veřejného kontraktu;
- lokální HTTP simulace prošla loginem, User, Lesson, kreditní historií, vytvořením a stornem;
- demo runtime smoke prošel 24 lekcemi;
- ruční desktopová kontrola angličtiny, Reformeru, sálů, kategorií a responsivity prošla bez konzolové chyby;
- CZ/EN přepínač přežije reload a live adapter předává Luxartu `lang=cz/en`;
- oblíbené lekce přežijí reload a jsou oddělené podle přihlášeného klienta;
- 320 × 568, 390 × 844, 768 × 1024, landscape 844 × 390 a desktop 1440 × 900 mají automatizované E2E pro 24 lekcí, Reformer, login, rezervaci, storno, WCAG A/AA, 44px touch targets, dialogy a horizontální overflow;
- kontrastní WCAG nálezy byly opravené bez potlačení pravidla;
- login a detail lekce mají automaticky ověřený počáteční a navrácený focus, uzavřený Tab cyklus, zavření přes `Escape`, viditelný focus ring a samostatný WCAG A/AA scan v desktopu i mobilu;
- login a mutace mají omezení frekvence a každá API odpověď korelační `X-Request-ID`.
- **Aktuální plná regrese 12. 9.:** obnovená větev prošla 205/205 integračními a jednotkovými testy, produkčním buildem, 58/58 provedenými lokálními Playwright scénáři v šesti projektech a dvou enginech, 1 záměrně přeskočenou desktopovou duplicitou čistě mobilního ergonomického testu a auditem s 0 známými dependency zranitelnostmi. Předchozí izolovaný veřejný Preview přesného commitu `ca5c085ed7a820ecb78c678a1ab6c661a8d81f46` a regionu `fra1` prošel 20/20 nízkoobjemovými scénáři v původních pěti Chromium viewpor-tech včetně vytvoření/storna běžné lekce i Reformeru; 5 variant bylo záměrně přeskočeno kvůli login limiteru a desktopové mobilní ergonomii. Jednorázový mobilní Lighthouse lab nad týmž Preview naměřil výkon 97/100, přístupnost 100/100, LCP 2,344 s, TBT 2 ms a CLS 0; produkční p75 a INP zůstávají staging/UAT důkazem. Samostatný mobilní WebKit 390 × 844 bez loginu a mutací ověřuje úplnost rozvrhu, ergonomii, WCAG/focus flow, angličtinu a oblíbené. Externí brána před browser testem vyžaduje shodu přesného 40znakového Git commitu a regionu `fra1`. Watchdog zápisy jsou pro omezený pilot samostatně uzamčené; před smazáním se záznam musí znovu najít ve vlastním Luxart seznamu přihlášeného klienta. Konfigurace názvů sálů/typů a rezervačních zdrojů se validuje shodně v preflightu, runtime i release dossieru; neplatná položka se nesmí tiše zahodit ani rozbít UI až po načtení živého rozvrhu. ID klienta, lekce, služby, kategorie, sálu a zdroje musí být bezpečná celá čísla a rezervační payload musí přesně souhlasit s identitou výskytu lekce. Ledger přijme nebo znovu přehraje úspěch jen pro stejného klienta a výskyt lekce, s explicitně zónovanými časy, shodnou kategorií a nezápornou cenou; storno navíc vyžaduje svůj přesný identifikátor, čas a nezáporný Luxart poplatek včetně nuly. Luxart časy u lekcí, rezervací, kreditu i watchdogu musí mít explicitní `Z` nebo číselný offset a existující kalendářní datum; jiný vstup selže bezpečně bez převodu podle hostingu. Dostupnost míst používá autoritativní Luxart `volno` a nekonzistentní kapacitu odmítne, takže členskou kvótu nepřepíše odvozený počet. Dossier schématu 6 přijme pouze výstup složené D1 brány s atestací `/Help`, schváleného originu, gateway režimu a autentizovaného čtení, samostatný čerstvý Memberzone fallback důkaz a owner-only startovní rollback účtenku svázanou SHA-256 s výsledkem drillu; samostatný diagnostický read-only soubor nestačí. Pre-cutover receipt nově přenáší přesný schválený snapshot lekcí a produkční brána odmítne jediný vynechaný či přidaný výskyt, změnu Reformerů i přechod do nového pražského dne. Všechny kritické release JSON vstupy včetně DNS baseline, rollback timeru a pre-cutover receipt se nyní čtou bez následování symlinků, s limitem velikosti, kontrolou oprávnění a detekcí změny identity nebo obsahu během čtení. Tento výsledek nahrazuje archivní počty v následujícím detailu.
- Luxart texty profilu, lekcí, UUID a kreditní historie mají typové, délkové a kontrolní-znakové limity. Běžné víceřádkové popisy zůstávají povolené a dlouhé profilové hodnoty se na mobilu bezpečně zalamují.
- 100/100 integračních/jednotkových testů a 16/16 Playwright běhů (osm scénářů ve dvou zobrazeních) prošlo na desktopu i mobilu včetně read-only fallbacku, serverového Stripe redirectu, třífázového deployment preflightu, fázově podmíněného launch gate, vazby runtime capabilities do release dossieru, dvojí CS/EN aplikační kontroly feedu, přesného sedmidenního pražského rozsahu, hranic pražské půlnoci, přímého Luxart parametru `pocet_dni_dopredu=7`, runtime odmítnutí osmého pražského dne, duplicitního occurrence ID, neúplné lekce a neplatného časového intervalu a readiness odmítnutí celého prázdného sedmidenního feedu, fail-closed ochrany read endpointů, produkčního post-cutover ověřovače, persistentního outage/session-expiry UI s korelačním ID a úplného session flow od nepřihlášené rezervace přes reload po logout a chráněné API `401`; runtime JSON nyní skutečně obsahuje `schedule`, `booking` a `payments`, které dossier vyžaduje. Reálný Luxart evidence producer je ověřen proti finálnímu kontraktu a výchozí release-grade běh odmítne chybějící testovací login. Booking UAT, rollback a alert producenty jsou rovněž přímo validované finálním dossierem; opakované request ID, chybějící rollback korelace nebo alert bez support vlastníka jsou NO-GO. Route test navíc dokazuje lokální live logout bez Luxartu/limiteru a odmítnutí cizího Originu bez smazání cookie. Bez zvolené launch fáze má gate 6/27 zelených kontrol a správně vrací `NO-GO`, zamýšlený pilot `booking_without_payments` má 8/23 a čtyři Stripe kontroly jsou explicitně mimo rozsah.
- lokální runtime probe ověřil security hlavičky, health/readiness a stejnou množinu 24 unikátních lekcí přes českou i anglickou aplikační route, včetně sálů 1/2/3 a 3 Reformerů;
- veřejná lesson a snapshot route ignorují pokusy z URL změnit resort, datum, místnost nebo typ; server vždy žádá úplný resort 1 na sedm kalendářních dnů v `Europe/Prague`, nezávisle na timezone hostingu, a adapter odmítne podvržený cizí resort i neočekávanou cizí upstream položku;
- live-mode simulace s nedostupným Luxartem prokázala, že kill switch vrací `BOOKING_READ_ONLY` a přímý browser top-up `TOPUPS_DISABLED` ještě před jakoukoli upstream mutací;
- serverový Stripe Checkout odmítá nepovolenou částku, HTTP návratovou URL a jinou než přesnou `checkout.stripe.com` doménu; webhook vyžaduje raw podpis, znovu načte session ze Stripe a neplacenou/mismatched session nepřipíše;
- schválené Stripe top-up částky 500 / 1 000 / 2 000 / 5 000 / 10 000 Kč mají verzovaný profil a přesný SHA-256 activation gate proti driftu implementace;
- PostgreSQL ledger s unikátním eventem, Checkout Session a PaymentIntent prošel skutečným lokálním transakčním a souběžným testem; stejnou platbu připíše jednou a nejasný Luxart výsledek uzamkne do ručního reconciliation stavu;
- Luxart `POST api/Payment` sink mapuje `KREDIT`, Stripe Checkout session, PaymentIntent a event ID podle veřejného kontraktu; hodnota `zpusob_uhrady` zůstává povinně konfigurovaná a živě nepotvrzená;
- vznikl read-only runtime probe, provozní/rollback runbook a konkrétní UAT checklist.
- živý Luxart read-only ověřovač je připravený pro CS/EN sedmidenní feed a volitelný login/User/kredit/rezervace; vypisuje pouze agregovanou, neosobní evidenci včetně přesného `Europe/Prague` intervalu a mezí výskytů, které release gate porovná se stagingem.
- řízený staging UAT ověřovač rezervace/storna je připravený, odmítá produkční origin, vyžaduje přesné povolení test DB a po nejasném výsledku neprovádí slepý retry.
- automatický rollback ověřovač bez loginu kontroluje do pěti minut neprázdný read-only rozvrh a fail-closed rezervaci, storno, watchdog i Stripe Checkout; skutečný staging drill zatím čeká na deployment a externí přístup.
- provider-neutral ověřovač alertu posílá jedinou privacy-safe testovací událost pouze po přesné fingerprint potvrzovací frázi; skutečné doručení čeká na webhook a support vlastníka.
- fail-closed release dossier vyžaduje pro přesný commit a aktivní launch okno čerstvé hashované živé důkazy, nulové P0/P1, technicky i lidsky potvrzený Memberzone fallback a výslovný cutover souhlas; fallback verifier uloží jen metadata a hash, ne HTML nebo osobní údaje, a neaktivní šablona nemůže projít.
- post-cutover ověřovač je pevně omezený na `booking.zone4you.cz`, čerstvý owner-only pre-cutover důkaz, stejný dossier, celý schválený commit a launch fázi; bez loginu nebo mutace kontroluje skutečné DNS/HTTPS, runtime provenienci a přesnou shodu CS/EN produkčního feedu se schváleným živým Luxart/staging snapshotem, přičemž do důkazu nevypíše DNS adresy ani ID lekcí. Jakákoli změna množiny výskytů nebo přechod do nového pražského dne je NO-GO do vytvoření nových důkazů.
- upstream gateway auth je oddělený od klientského loginu a podporuje potvrzené `none`, Basic, Bearer nebo vlastní `X-*`; nejednoznačné, injektovatelné a nepoužité secret konfigurace testy odmítají.
- PostgreSQL rate limit atomicky sdílí login/mutační limity mezi serverless instancemi, fail-closed odmítá požadavky při nedostupné ochraně a readiness i release dossier vážou důkaz na skutečně použitý režim; lokální 12vláknový souběžný test propustil přesně nastavený limit.
- deployment preflight bezpečně ověřuje read-only, booking bez plateb i booking se Stripe, zakazuje testovací/operátorské proměnné v runtime a nevypisuje secrets ani interní URL; runtime probe i release dossier nyní vyžadují přesný commit a fázi.
- browser při nedostupném snapshotu nezamění výpadek za prázdný rozvrh: zobrazí persistentní CS/EN error, retry, Memberzone/recepce fallback a bezpečné `X-Request-ID`; po 401 odstraní starého klienta a otevře prázdný login. Neplatný login už dialog nezavírá a demo údaje nejsou v klientském formuláři předvyplněné.
- produkční session cookie je automaticky ověřená jako `HttpOnly`, `Secure`, `SameSite=Lax`, osmihodinová a serverově čitelná; browser navíc dokazuje, že nepřihlášená rezervace neodešle zápis, přihlášení přežije reload a logout odstraní profil i přístup k rezervacím. Live logout není závislý na Luxart konfiguraci ani sdíleném limiteru, ale nadále vyžaduje důvěryhodný Origin; demo a live adapter shodně vracejí `401 AUTH_REQUIRED`.
- launch gate dovolí core pilot bez Stripe pouze jako `booking_without_payments`, ve kterém musí být platební mutace vypnuté; čtyři Stripe infrastrukturní kontroly jsou pak transparentně `SKIP`, nikoli falešně `PASS`.
- release dossier pro omezený pilot přijme jen runtime s aktivními rezervacemi, potvrzenými business pravidly, vypnutým Stripe a watchdogem, povinnou angličtinou, oblíbenými na zařízení a vypnutým zapomenutým heslem; Stripe launch naopak vyžaduje platební readiness a `topupMode=stripe`.
- business pravidla mají verzovaný profil a obsahový SHA-256 gate; současný profil potvrzuje pouze minimum 200 Kč, ostatní hodnoty jsou `null/provisional` a read-only UI je nevydává za fakta.

### Červené / externě blokované brány

- `http://api.memberzone.online:9191/Service1.svc` je veřejně dostupná starší SOAP/WCF služba, ale e-mailová historie ji neváže k Zone4You; HTTPS není funkční a tento cíl se nesmí zaměnit za klientskou REST instanci;
- objednaný kontrakt je REST `memberzone_rest_v1`; chybí přesný veřejný hostname/IP, na kterém IT zpřístupnilo port `9191`, a potvrzení, že tato cesta vede na interní Zone4You REST port `9759` a testovací databázi;
- chybí rozhodnutí IT, zda gateway používá IP/VPN bez hlavičky, Basic, Bearer nebo vlastní `X-*` hlavičku; veřejný datový endpoint zatím vracel 401;
- chybí potvrzené mapování `cislo_salu` → `id_resource`;
- chybí povolení a důkaz živých mutací v Luxart test DB;
- veřejná dokumentace potvrzuje `watchdog_III` s jazykem, `watchdog_II/user` pro výpis a `DELETE Watchdog/{id}`; chybí živé ověření na Zone4You test DB;
- Stripe secrets, provisionovaný TLS PostgreSQL, aplikovaná staging migrace, registrovaný webhook a živě potvrzený Luxart payment sink/deduplikace chybí; lokální kód a databázový integrační test jsou hotové;
- chybí provisionovaný pooled TLS PostgreSQL a aplikace migrace `003` pro multi-instance rate limit (alternativně doložený jediný proces); chybí reálný alert kanál, provedené UAT a nacvičený rollback.
- finální release dossier zůstává nevyplněný, protože živé důkazy a oprávněná schválení zatím neexistují.

Aktuální release stav: `NO-GO`. To je očekávané a správné, dokud nejsou živé brány doložené.

## 9. Rozhodnutí a otázky, které je nutné dodat

### Blokuje zahájení nového D1

1. Zone4You IT: dodat přesný veřejný HTTPS origin a potvrdit, že zveřejněný port `9191` směruje na interní Zone4You REST API na portu `9759` připojené k testovací databázi.
2. Zone4You IT: dodat bezpečný šifrovaný přístup k vybranému kontraktu, jeho auth režim a případný allowlist/VPN; testovací credentials nebudou odeslány přes prosté HTTP.
3. Zone4You IT/Luxart: tabulka `cislo_salu` → `id_resource` pro všechny sály a Reformer.
4. Zone4You/Luxart: výslovné povolení vytvořit a zrušit rezervaci na dodaném testovacím klientovi a určení bezpečné test lekce.
5. Luxart: potvrdit, že Zone4You REST instance používá `POST Reservations/watchdog_III`, `GET watchdog_II/user` a `DELETE Watchdog/{id}` a že notifikace jsou zapnuté. Veřejný kontrakt neobsahuje pořadí.

### Blokuje finální business akceptaci

5. **Rozhodnuto:** minimální kredit před rezervací je 200 Kč.
6. **Částečně rozhodnuto:** běžná lekce je bez storno pokuty do půlnoci, pracovně `00:00 Europe/Prague` na začátku dne lekce. Chybí pozdní poplatek, no-show, potvrzení pozdního online storna a pravidlo Reformeru.
7. Chybí samostatné otevření a uzavření rezervačního okna; půlnoc se týká bezplatného storna, nikoli otevření rezervací.
8. Kdo tvoří pilotní skupinu, kdo je support kontakt recepce a jaké je nové launch okno?

### Blokuje Stripe, ale ne core booking

9. Kdo bezpečně vloží Stripe test klíče a webhook secret do hostingu a provisionuje TLS PostgreSQL pro payment ledger?
10. **Částky jsou rozhodnuté:** 500 / 1 000 / 2 000 / 5 000 / 10 000 Kč. Jak se mapuje Stripe payment ID do Luxart `id_payment_shop`/platebních polí?
11. Má se při vrácení/chargebacku kredit automaticky odečíst, nebo se první pilot řeší ručně?

### Doporučené scope rozhodnutí

12. **Rozhodnuto:** angličtina je povinná pro pilot.
13. **Rozhodnuto:** zapomenuté heslo do pilotu nepatří; perzistentní oblíbené lekce jsou povinné.

## 10. Reporting

Každý stavový report obsahuje pouze:

- co bylo dokončeno a jakým důkazem;
- která gate změnila stav;
- nejbližší neblokovaný krok;
- externí blocker s vlastníkem a deadline;
- aktuální doporučení `GO`, `GO s vypnutou funkcí`, `READ-ONLY`, nebo `NO-GO`.
