# Zadání pro pokračování po lokálním auditu

## Výsledek lokálního cíle

Auditní nálezy A01-A12 byly implementované na `codex/zone4you-unblock-20261117`. Tato větev navazuje na recovery PR #2 a obsahuje i dřívější aktualizaci závislostí. Nejde o dokončený živý booking. Žádný merge, push, deploy, změna DNS, nová zpráva ani placená služba nejsou tímto předáním autorizované.

Původní odhad 7-12 člověkodnů není závazný rozpočet. Nový odhad lze sestavit až z potvrzené síťové varianty a prvního čtení skutečného API. Zvlášť je nutné ocenit případný přesun backendu.

## Co lze reprodukovat bez dodavatelů

- Node.js 24.x, `npm ci`, `npm test`, `npm run typecheck`, `npm run build`, `npm run test:e2e`, `npm audit --omit=dev`, `npm run scan:release-secrets`.
- `npm run test:postgres` spouští všechny `tests/*.integration.ts`. Potřebuje výhradně izolovanou místní/testovací PostgreSQL databázi ve třech proměnných `BOOKING_TEST_DATABASE_URL`, `PAYMENT_TEST_DATABASE_URL`, `RATE_LIMIT_TEST_DATABASE_URL`. Testy vytvářejí a mažou vlastní náhodná schémata; nesmějí mířit na klubovou/produkční DB.
- `npm run inspect:booking-ledger` pouze čte stav ledgeru a vrací agregace a otisky, nikdy osobní údaje či uložené response_json. Jednorázové připojení je `ZONE4YOU_LEDGER_INSPECTION_DATABASE_URL`; nepatří do hostingu.
- Není třeba aktivovat Static IPs ani hledat jiné dodavatele pro opakování těchto testů.

## E01 / P0 vstup: potvrdit síťovou architekturu

**Vlastník vstupu:** Pavel Šváb + Michal. **Naše práce začne:** až existuje konkrétní server/gateway/VPN, správce a vyčíslené náklady.

Požadované rozhodnutí má rozlišit:

1. Vercel aplikace zůstane ve Frankfurtu, před klubovým API vznikne schválená brána. Musí být známá povolená cesta z Vercelu, její autentizace a správa. Samotná zmínka „VPN“ nestačí; standardní funkce Vercelu nejsou dlouhodobý VPN klient.
2. Backend se skutečně přesune mimo Vercel. Dnešní runtime, preflight, readiness, probes i release důkazy vyžadují skutečný `VERCEL_REGION=fra1`. Tyto kontroly se nesmějí obejít ručně vyplněnou platformní proměnnou. Nejdříve navrhnout identitu nového hostingu, serverové secrets, stejný origin/session/CSRF model, síť, nasazení a monitoring; pak konzistentně upravit všechny kontroly a přidat testy cílového runtime.

**Nepovolená zkratka:** nezabezpečené HTTP, otevření API všem bez schválení, falešné fra1, použití inbound Vercel DNS jako odchozích IP.

**Dokončení:** konkrétní odsouhlasený síťový diagram, provozní vlastník, cena, správný origin a úspěšná anonymní kontrola skutečné cesty. Placené Vercel Static IPs nejsou schválené.

## E02 / P0 vstup: bezpečné první napojení Member Pro

**Vstup:** E01, přesná API + /Help URL, potvrzená test DB, REST memberzone_rest_v1/resort 1, autentizační režim a potvrzení redakce login/password/member_card_number ve všech vrstvách. Testovací údaje přímo do schváleného secret store nebo jednorázového operátorského procesu.

**Naše práce:** anonymní `verify:luxart-anonymous-candidate`; při úspěchu a povolení testu `verify:luxart-d1` pro stejný schválený origin. Ověřit login, User/kredit, všechny lekce CS/EN a personalizované oprávnění. Ukládat pouze bezpečnou evidenci. Z reálných odpovědí vytvořit anonymizované fixtures a opravit mappery, pokud se liší od referenčního kontraktu.

**Dokončení:** autentizovaný read-only důkaz správného testovacího klienta, stejných sedmi pražských dnů a všech sálů/Reformerů bez osobních dat ve výstupu. Žádná rezervace ještě neproběhne.

## E03 / P0 vstup: pravidla a zdroje sálů

**Vstup od Zdeňka:** otevírání/uzavírání rezervace, kreditní mechanika, půlnoční cutoff, pozdní/no-show částky, možnost pozdního online storna a Reformer. **Od Luxartu:** úplná mapa `cislo_salu → id_resource` a které pravidlo už vynucuje API.

**Naše práce:** změnit `config/booking-rules-implementation.json` a potvrzený profil současně podle písemné odpovědi; doplnit testy časových hranic, kreditu, poplatků a všech sálů. Pokud odpověď vyžaduje kalendářní otevírání v konkrétní čas, dnešní model podporující jen klouzavé hodiny nestačí: rozšířit doménový typ, pravidla, profil, sdílený validátor, UI a testy změn času. Nepřevádět kalendářní dny automaticky na násobek 24 hodin.

**Dokončení:** profil confirmed s dohledatelným rozhodnutím, shoda hashe a implementace, mapování celého skutečného feedu a žádné převzaté pracovní hodnoty bez potvrzení. Schválení poplatku není souhlas s platební bránou.

## E04 / provozní staging

**Vstup:** E01-E02, schválené zdroje, hostname a provozní vlastník.

**Naše práce:** secrets odděleně, TLS PostgreSQL pro booking ledger a limiter, migrace a readiness. Booking DB musí mít doložený direct/session režim; transaction/statement pooling je neslučitelný. Nejprve `read_only`, teprve po odpovídajícím povolení transakční staging. Vercel multi-instance limiter musí být sdílený, nikoli paměťový. Ověřit pool outage, query timeout a korelaci nejistého zápisu na cílovém hostingu.

**Dokončení:** reálná readiness, přesný commit/runtime a nezměněný CS/EN feed; údaje o prostředí nesmějí pocházet z mocku. Žádné přepnutí produkční DNS.

## E05 / řízené transakční UAT

**Vstup:** E02-E04, recepční tester, bezpečný testovací účet/lekce pro každý sál a zvláštní povolení konkrétní rezervace a jejího storna. Luxart písemně potvrdí aktivní standardní šablony.

**Naše práce:** `verify:booking-mutations`, rezervace/storno/replay/souběh, porovnání kreditu a emailu, návrat všech původních rezervací a zůstatku, test plna, nedostatku kreditu, timeoutu a reconciliation. CS/EN, desktop a mobil, včetně Reformeru. Veškeré rozdíly opravovat nejprve z fixtures lokálně, potom opakovat příslušný testovací scénář.

**Dokončení:** podepsané přijetí recepcí, řádné důkazy pro každý sál, žádný P0/P1, žádný nedořešený nejistý zápis ani vedlejší změna klientova stavu. Email nesmí odeslat současně oba systémy.

## E06 / omezený pilot

**Vstup:** E05, pilotní klienti, support owner a explicitní schválení přesného spuštění.

**Naše práce:** reálné doručení alertu, ověřený návrat do read-only/Memberzone do 5 minut, návod recepce, release dossier, rollback baseline, teprve potom schválený cutover a read-only ověření produkční cesty. Připravit dohled během pilotu.

**Dokončení:** produkční kontrola konkrétního buildu a provozní převzetí. Zelený lokální build není tímto souhlasem.

## Další fáze mimo první pilot

Stripe dobití, watchdog a případný reset hesla zůstávají vypnuté. Mají vlastní závislosti na skutečném API/šablonách/údajích a samostatné akceptační zadání. Jejich kód ani lokální platební test není důkazem připravené živé platby.

## Před další prací

1. Přečíst auditní zadání a výsledný protokol. Ověřit HEAD a čistotu pracovní větve.
2. Přečíst nové odpovědi dodavatelů a zápis ze schůzky se Zdeňkem, pokud existují; současný chat žádné takové odpovědi ještě nemá.
3. Vybrat první E úkol se skutečně splněnými vstupy. Pokud chybí externí vstup, nevyrábět potvrzení ani „funkční“ screenshot z mocku jako náhradu.
4. Nové nálezy zaznamenat s reprodukcí, místem v kódu a regresním testem. Návrh zadání musí vzniknout před rozsáhlou implementací.
