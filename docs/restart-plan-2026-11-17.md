# Zone4You — pokračování od 17. 11. 2026

Tento plán nahrazuje staré termíny spuštění. Stav vychází z draft PR #2 (`35f0f1b`), komunikace do 22. 9. a kontroly preview/DNS/TLS 17. 11. Nejde o potvrzení živé integrace.

## Dokončeno v tomto kroku

- V1: vytvořena oddělená větev `codex/zone4you-unblock-20261117` z aktuálního PR #2; starší lokální kopie nebyla přepsána.
- V2: Next.js aktualizován na 16.4.6, sharp na 0.35.5 a source-map-js na 1.2.2. Audit před aktualizací hlásil tři zranitelné balíčky (1 critical, 2 high), po aktualizaci nula. Běh na Node 24.22.3: 251/251 testů, typecheck, produkční build, 62/62 provedených E2E scénářů; 13 kombinací záměrně vynecháno. Scan pracovních souborů i historie bez nálezu tajných hodnot.
- V3: složený anonymní probe nyní zachovává `networkCode`; přidán regresní test, že TLS chyba zastaví další načítání a nepovolí D1 ani credentials. Reálný anonymní běh 17. 11. vrátil `ERR_TLS_CERT_ALTNAME_INVALID`.
- V4: připraven přesný postup stagingu níže; externí PostgreSQL, IP a deployment zatím nejsou provisionované.
- Připraveny tři zprávy k odeslání: [IT, Luxart, Zone4You](restart-communications-2026-11-17.txt). Odeslání a náklad Static IPs čekají na odpověď uživatele.
- Změny jsou lokální. Nebyl proveden push, merge, deploy, změna DNS ani živý login/rezervace.

## Komunikace

| ID | Vlastník | Konkrétní výstup | Závislost |
|---|---|---|---|
| K1 | Michal + Pavel Šváb | potvrzená varianta HTTPS 443 + IP allowlist + Basic Auth, nebo přesné VPN podmínky; termín společného testu | umožní volbu hostingu |
| K2 | Michal | schválený náklad statických IP / zvolená jiná síťová cesta | K1; žádné vymyšlené IP pro firewall |
| K3 | Pavel Šváb | přesný HTTPS origin a /Help, platný certifikát, proxy na interní REST 9759/test DB, redigované proxy/webserver/APM logy, vypnutý directory listing | K1; allowlist po dodání IP |
| K4 | Josef Kocian / Luxart | odstranění/redakce loginu, password hashe a čísla karty ve všech vlastních logách, jméno/role a datum ověření | před klientským loginem |
| K5 | Luxart + Zone4You | resource mapa všech sálů, aktivní emailové šablony a vlastník API podpory | před rezervačním UAT |
| K6 | Zdeněk Treblík | rezervační okno, kreditní mechanika, storno/no-show/Reformer; testovací autorita, recepce a pilotní skupina; potvrzení první fáze bez plateb | před živými zápisy |

Návrhy tří zpráv jsou v doprovodném výstupu. Odeslání zatím neproběhlo. Cílem je odpověď s vlastníkem a termínem do dvou pracovních dnů od odeslání, nikoli slib spuštění do dvou dnů.

## Naše vývojářské úkoly

| ID | Úkol | Hotovo znamená | Kdy |
|---|---|---|---|
| V1 | sjednotit pracovní základ na zářijovou recovery větev | oddělená čistá větev z PR #2; starší lokální práci nepřepsat | ihned |
| V2 | obnovit technickou regresi a opravit zranitelné závislosti | jednotkové/integr. testy, typecheck, build, mobil/desktop/WebKit E2E a audit bez známých nálezů | ihned, bez API |
| V3 | zpřesnit diagnostiku příjmu API | anonymní složený probe zachová bezpečný síťový chybový kód; TLS chyba se neztratí v obecném reportu | ihned, bez loginu |
| V4 | připravit provozní konfiguraci | seznam runtime proměnných, PostgreSQL ledger + sdílený limiter, vypnuté živé zápisy; žádné secrets v repozitáři | lokální příprava ihned, provisionování po volbě hostingu |
| V5 | přidělit a předat odchozí IP | skutečné dvě IP pro fra1 z aktivované služby, nikoli inbound A záznamy Vercelu | K1–K2; externí placený krok |
| V6 | anonymně ověřit testovací API | platné TLS, správný origin, /Help a 11 částí REST kontraktu; nepoužít credentials | K3 |
| V7 | ověřit skutečný login/User/Lesson CS/EN | jeden řízený D1 read-only důkaz, všech sedm pražských dnů a všechny sály | K3–K4 + povolení a bezpečné údaje |
| V8 | zapracovat schválená pravidla a mapu sálů | pravidla odpovídají odpovědi, pokryté mezní stavy a Reformer | K5–K6 |
| V9 | provést rezervaci/storno UAT | test v každém sále, kontrola kreditu/notifikací/duplicit a návrat do původního stavu | V4, V7, V8 + konkrétní povolení testu |
| V10 | provozní ověření a pilot | funkční alert, rollback, recepční akceptace, finální dossier a samostatně odsouhlasené spuštění | V9 |

Online platby, watchdog a zapomenuté heslo se nezapínají jako náhrada za dokončení základního pilotu. Původní Memberzone musí zůstat dostupný jako návratová cesta.

## Hostingové rozhodnutí

Doporučená návaznost na poslední mail: Vercel Functions `fra1` → statické odchozí IP → HTTPS reverse proxy Zone4You → interní REST 9759; Basic Auth zůstává druhou vrstvou. Potvrzení IT zatím chybí.

Oficiální [Vercel Static IPs](https://vercel.com/docs/networking/static-ips) k 17. 11.: Pro/Enterprise, 100 USD měsíčně za projekt plus Private Data Transfer; sdílené páry odchozích IP. Nejde o vyhrazenou privátní VPN. Před aktivací ověřit cenu v účtu a souhlas s nákladem. Alternativa gateway/VPN na existujícím serveru vyžaduje nejprve potvrdit server, správce a údržbu; nelze ji nyní slíbit jako beznákladovou.

## Pořadí

1. Paralelně K1–K6 a V1–V4.
2. Po schválení síťové varianty V5; IT dokončí přístup.
3. V6 → V7 → V8 → V9 → V10. Testy konfigurace ani demo nejsou náhradou za skutečnou API integraci.
4. Odhad termínu vydání aktualizovat až po V7 a potvrzení pravidel. Dokud není zpřístupněné API, kalendářní termín nelze odpovědně potvrdit.

## Připravený postup stagingu (V4)

- Výchozí fáze je `read_only`; `BOOKING_MUTATIONS_ENABLED=false`, `PAYMENT_MUTATIONS_ENABLED=false`, `LUXART_WAITLIST_ENABLED=false`. Žádný z těchto přepínačů nyní neměnit na true.
- Region funkcí je již v `vercel.json` nastavený na `fra1`. `VERCEL_REGION` se nevkládá ručně; kontroluje se skutečný runtime.
- Potřebné vstupy od IT: schválený HTTPS origin, Basic Auth a potvrzená redakce logů. Přesný původ API se zatím nesmí vyplnit podle navrženého hostname bez potvrzení IT.
- Potřebné provozní vstupy od nás: schválený staging hostname, cílový commit, samostatný session secret a pooled TLS PostgreSQL pro sdílený rate limiter. Migrace jsou v `migrations/003_rate_limit.sql`; booking fáze navíc potřebuje `002_booking_mutation_ledger.sql`. Platební ledger není podmínkou první fáze bez plateb.
- Runtime proměnné, jejich vzájemné kontroly a zákaz operátorských/testovacích údajů v runtime vyjmenovává [deployment preflight](deployment-preflight.md). Stávající `.env.example` je společný katalog, nikoli soubor k hromadnému importu do Vercelu.
- Před nasazením `npm run verify:deployment-preflight`; po schváleném nasazení skutečné `/api/readiness` a `npm run probe:runtime`. Bez skutečného API/DB je readiness důkaz nedostupný, nikoliv splněný.
- Před prvním klientským loginem `npm run verify:luxart-d1`; potvrzení redakce musí obsahovat skutečného potvrzujícího a datum maximálně 30 dnů staré. Nevyplňovat potvrzovací booleany odhadem.
- Anonymní kontrola kandidáta: `LUXART_HELP_URL=https://booking-api.zone4you.cz/Help LUXART_EXPECTED_PORT=443 npm run verify:luxart-anonymous-candidate`. Jde výhradně o navržený kandidát a nepoužívá credentials; k 17. 11. vrací `ERR_TLS_CERT_ALTNAME_INVALID` a zastaví před čtením kontraktu.
- Lokálně dokončená příprava neznamená provisionovanou databázi, aktivní IP ani vydaný staging. Tyto externí kroky zůstávají závislé na schválené síťové a hostingové variantě.
