# Zone4You Booking — UAT checklist omezeného pilotu

Datum: __________  Prostředí: __________  Build/commit: __________

Tester recepce: __________  Pilotní klient: __________  Řídí: __________

Každý bod označte `PASS`, `FAIL` nebo `N/A — funkce bezpečně vypnutá`. Ke každému `FAIL` patří závažnost P0–P3, screenshot/ID důkazu, vlastník a termín.

## Rozvrh a jazyky

- [ ] Všechny položky aktuální sedmidenní odpovědi `api/Lesson` jsou dohledatelné v UI.
- [ ] Přihlášený testovací klient obdrží u každé lekce binární `user_posible`; povolená lekce lze rezervovat a nepovolená zůstane viditelná, ale nevytvoří žádný Luxart POST.
- [ ] Privacy-safe request evidence potvrzuje `date_start` dnešního pražského dne, `pocet_dni_dopredu=7`, `id_kategorie=0`, `id_service=0` a resort 1.
- [ ] Výskyt s duplicitním occurrence ID, chybějícím zobrazovaným polem, neplatným časovým intervalem nebo na osmém pražském dni vyvolá bezpečný stav nedostupnosti; nesmí se potichu zobrazit ani zahodit jako údajně úplný feed.
- [ ] Čas bez explicitního `Z` / UTC offsetu a neexistující kalendářní datum v lekci, rezervaci, kreditu nebo watchdogu vyvolají bezpečný stav nedostupnosti; desktop, mobil ani hostingová časová zóna je nesmí interpretovat rozdílně.
- [ ] Všechny sály a Reformer jsou viditelné a filtrovatelné.
- [ ] Zobrazený počet volných míst i stav plno odpovídají přímo Luxart poli `volno`; test s rozdílem mezi `volno` a prostým `kapacita - obsazeno` nesmí použít dopočítanou hodnotu.
- [ ] Neznámý sál nebo typ lekce nezpůsobí zmizení lekce ani pád stránky.
- [ ] CS i EN mají srozumitelný rozvrh, detail, stav míst a instrukce.
- [ ] Oblíbená lekce přežije reload a nepřenese se k jinému klientovi na stejném zařízení.
- [ ] Mobil 390 × 844 a desktop 1440 × 900 nemají zakrytou kritickou akci ani horizontální scroll stránky.
- [ ] Detail lekce i přihlášení mají viditelný počáteční focus; `Tab` neopustí otevřený dialog, `Escape` jej zavře a focus se vrátí na původní tlačítko.

## Přihlášení a kredit

- [ ] Platný testovací klient se přihlásí stejnými údaji jako v Memberzone (příjmení, e-mail nebo login + heslo).
- [ ] Luxart potvrdí, zda je pro Zone4You vyžadované také číslo členské karty a jaký má vztah k heslu.
- [ ] Neplatné údaje neprozradí interní detail a nevytvoří session.
- [ ] Po neplatném loginu zůstane dialog otevřený, heslo se nikam neuloží a bezpečný kód požadavku lze předat podpoře.
- [ ] Logout zneplatní session i při nedostupném Luxartu nebo sdíleném limiteru; refresh platnou session zachová. Cizí Origin nesmí session smazat.
- [ ] Vypršená session odstraní z UI starého klienta, rezervace i kreditní historii a otevře prázdný přihlašovací formulář.
- [ ] Kredit v UI odpovídá Luxart autoritě.
- [ ] Při kreditu pod 200 Kč je rezervace odmítnuta podle potvrzeného pravidla.
- [ ] Zapomenuté heslo není v pilotním UI.

## Rezervace a storno

- [ ] Jedna rezervace vytvoří právě jednu položku v Luxartu se správnou lekcí, klientem, kategorií a `id_resource`.
- [ ] Tři replaye stejného požadavku vrátí stejnou rezervaci a nevytvoří duplicitní aktivní rezervaci.
- [ ] Dva souběžné požadavky skončí jedním Luxart zápisem; druhý dostane bezpečný stav „zpracovává se“ nebo stejný výsledek.
- [ ] Storno zruší právě správnou rezervaci a UI odpovídá Luxart stavu.
- [ ] Storno/Reformer poplatek odpovídá písemně potvrzenému pravidlu.
- [ ] Při chybě Luxartu UI neukáže falešný úspěch.
- [ ] Timeout po odeslání Luxart mutace skončí jako `uncertain`, další pokus se zablokuje a projde ruční reconciliation drill.
- [ ] Guarded `verify:booking-mutations` proběhl pouze na schválené test DB, odmítl produkční origin a uložil privacy-safe JSON důkaz.
- [ ] Read-only režim zobrazí rozvrh, ale bezpečně zablokuje rezervaci, storno a watchdog hlídání místa.

## Waitlist a platby

- [ ] Pro současný omezený release dossier je watchdog v UI bezpečně nedostupný (`waitlistEnabled=false`); jeho budoucí zapnutí vyžaduje živě ověřenou Luxart notifikaci a samostatný release důkaz. UI nikdy nezobrazuje pořadí ani neslibuje automatickou rezervaci.
- [ ] Stripe top-up je buď celý ověřený podle E5, nebo v live UI skrytý.
- [ ] Žádný browserový požadavek neumí přímo připsat live kredit.
- [ ] Checkout vznikne pouze na serveru pro přihlášeného klienta, povolenou částku a přesnou HTTPS doménu.
- [ ] Neplatný nebo změněný Stripe podpis vrátí 400 a nevytvoří ledger ani kredit.
- [ ] Deset replayů stejného eventu i druhý event stejné Checkout Session připíší kredit právě jednou.
- [ ] Nejasný Luxart timeout skončí jako `uncertain`; aplikace platbu automaticky neopakuje.
- [ ] Návrat ze Stripe neslibuje připsaný kredit dříve než ověřený webhook.

## Provoz a rozhodnutí

- [ ] `verify:deployment-preflight` je zelený pro přesný staging commit a zvolenou fázi; JSON neobsahuje secrets ani interní URL.
- [ ] Runtime probe je zelený, česká i anglická aplikační route mají stejnou úplnou množinu výskytů lekcí a uložená evidence obsahuje skutečné `schedule`, `booking` a `payments` stavy.
- [ ] Výpadek úvodního snapshotu nikdy nevypadá jako prázdný rozvrh: zůstane viditelný bezpečný error stav, retry, Memberzone/recepce fallback a korelační ID.
- [ ] Readiness hlásí stejný plný `commit` a `phase` jako schválený build a release dossier.
- [ ] Readiness hlásí `schedule=ready` pouze pro validní neprázdný sedmidenní feed; celý prázdný či vadný feed vrátí 503.
- [ ] Readiness hlásí `rateLimit=postgres` a migrace `003` je aplikovaná; paměťový režim je přípustný jen s doloženou single-instance topologií.
- [ ] Souběžné požadavky přes dvě aplikační instance sdílejí jeden limit; při odpojené rate-limit databázi login a mutace selžou bezpečně bez volání Luxartu/Stripe.
- [ ] `verify:alert-delivery` vrátil HTTP 2xx a určený support kontakt ručně potvrdil stejné event ID.
- [ ] Rollback drill do read-only/Memberzone proběhl do 5 minut.
- [ ] `verify:readonly-rollback` doložil neprázdný rozvrh a kódy `BOOKING_READ_ONLY` / `PAYMENTS_DISABLED` pro všechny mutační cesty.
- [ ] Neexistuje otevřený P0/P1.
- [ ] Michal / Zone4You výslovně schválil cutover.
- [ ] `verify:pilot-release` prošel pro přesný nasazovaný commit, aktivní launch okno a nezměněné SHA-256 všech živých důkazů.

## Výsledek

Rozhodnutí: `GO` / `GO S VYPNUTOU FUNKCÍ` / `READ-ONLY` / `NO-GO`

Otevřené nálezy a vlastníci: ________________________________________________

Schválil Zone4You: ____________________  Čas: ____________________
