# Zone4You Booking — staging a produkční preflight

Aktualizace: 2026-09-11

Preflight je fail-closed kontrola konfigurace přesného nasazovaného commitu. Neprovádí deploy, DNS změnu ani Luxart/Stripe mutaci. Jeho JSON výstup obsahuje pouze bezpečné režimy, commit, hash schválených profilů a názvy chybných proměnných; nevypisuje secrets, databázové URL ani Luxart URL.

## Povinné pořadí

1. Určit cílový commit a jeden režim z tabulky níže.
2. Vložit runtime konfiguraci a secrets přímo do schváleného secret store hostingu, ne do e-mailu nebo repozitáře.
3. V prostředí stejného buildu spustit `npm run verify:deployment-preflight`.
4. Po nasazení ověřit `/api/readiness`; v live režimu musí vrátit stejný `phase`, celý čtyřicetiznakový `commit` a systémový region `fra1`.
5. Spustit `APP_BASE_URL=<staging-origin> npm run probe:runtime` a uložit privacy-safe JSON důkaz.
6. Teprve po zelených příslušných gatech a výslovném souhlasu lze změnit fázi nebo provést cutover.

## Fáze

| `ZONE4YOU_DEPLOYMENT_PHASE` | Booking | Stripe | Povinné navíc |
|---|---:|---:|---|
| `read_only` | vypnutý | vypnutý | `LUXART_WAITLIST_ENABLED=false`; není vyžadovaný resource map ani potvrzený business-rule profil |
| `booking_without_payments` | zapnutý | vypnutý | potvrzený a hashovaný business-rule profil, úplný `LUXART_RESOURCE_MAP_JSON`, PostgreSQL booking ledger, `LUXART_WAITLIST_ENABLED=false` |
| `booking_with_stripe` | zapnutý | zapnutý | vše z booking fáze plus Stripe test/live režim a secrets, potvrzený payment profil, PostgreSQL payment ledger a potvrzené Luxart payment mapování |

Přepnutí fáze je release změna. Samotné nastavení boolean přepínače nestačí; preflight kontroluje vzájemnou shodu celé konfigurace.

## Společná runtime konfigurace

| Oblast | Požadavek |
|---|---|
| Cíl | `ZONE4YOU_DEPLOYMENT_TARGET=staging` nebo `production` |
| Commit | plný Git SHA v systémovém `VERCEL_GIT_COMMIT_SHA`, případně v `ZONE4YOU_DEPLOYMENT_COMMIT`; jsou-li oba, musí být stejné |
| Region | Vercel systémová hodnota `VERCEL_REGION` musí za běhu přesně odpovídat `fra1`; nenastavuje se ručně jako aplikační secret |
| Aplikační origin | čistý HTTPS kořen v `APP_BASE_URL`; produkce je přesně `https://booking.zone4you.cz/` |
| Staging origin | explicitní čistý HTTPS kořen v `ZONE4YOU_STAGING_APP_ORIGIN`, shodný s `APP_BASE_URL` a odlišný od produkce |
| Veřejné prostředí | `NEXT_PUBLIC_APP_ENV` musí přesně odpovídat cíli; žádný jiný `NEXT_PUBLIC_*` secret |
| Luxart | live režim, resort `1`, timeout 1–30 s, potvrzený gateway auth a HTTPS; testovací HTTP je možné pouze na stagingu s explicitní výjimkou |
| Luxart mapy | volitelné mapy názvů sálů a typů pro CS/EN musí používat kanonická nezáporná číselná ID a krátké neprázdné texty; booking fáze navíc vyžaduje úplnou mapu kladných `cislo_salu` → `id_resource` |
| Session | samostatný serverový secret nejméně 32 znaků, nerecyklovaný jako gateway nebo Stripe secret |
| Rate limit | PostgreSQL s TLS, nebo pouze u doložené single-instance topologie paměťový režim s výslovným potvrzením; na Vercelu se identita klienta bere pouze z validní platformní `x-vercel-forwarded-for` |
| Notifikace | `NOTIFICATION_PROVIDER=luxart` a `LUXART_NOTIFICATION_TEMPLATES_CONFIRMED=true` až po výslovném potvrzení aktivních Zone4You šablon; aplikace standardní Luxart e-maily neduplikuje |
| Watchdog | současný omezený pilot vyžaduje `LUXART_WAITLIST_ENABLED=false`; pozdější zapnutí vyžaduje potvrzený `watchdog_III`, bezpečné opakování create/delete a živý E4 důkaz Luxart notifikace |

Produkce vždy vyžaduje `LUXART_ALLOW_INSECURE_TEST_HTTP=false` a `LUXART_API_CONTRACT=memberzone_rest_v1`. `LUXART_API_BASE_URL` musí být přesně schválený čistý HTTPS origin bez cesty; adapter si `/api/...` přidává sám. Port se nebere jako důkaz API kontraktu. Stejnou podmínku kontroluje runtime, takže SOAP/WCF cíl, chybná adresa nebo produkční HTTP selžou ještě před odesláním Luxart požadavku. Přesměrování autorizačních hlaviček na jiný host adapter odmítá. Všechny Luxart požadavky mají explicitní `no-store`; JSON odpověď je streamovaně omezená na 4 MiB. Nadlimitní čtení selže bezpečně a u mutace se zachová povinné ruční smíření místo slepého opakování zápisu.

Mapy `LUXART_ROOM_MAP_JSON`, `LUXART_ROOM_MAP_EN_JSON`, `LUXART_LESSON_TYPE_MAP_JSON` a `LUXART_LESSON_TYPE_MAP_EN_JSON` jsou volitelné, ale pokud jsou nastavené, preflight odmítne pole, nečíselné nebo nekanonické klíče (např. `"02"`), netextové/prázdné hodnoty, řídicí znaky, texty nad 120 znaků a mapy nad 256 položek. `LUXART_RESOURCE_MAP_JSON` je v booking fázi povinná a přijímá jen kanonická kladná čísla sálů a kladná bezpečná celočíselná `id_resource`. Stejný parser používá runtime i finální release dossier, takže neplatná položka se nikdy tiše nezahodí.

## Co do runtime prostředí nepatří

Do hostingu se nevkládají testovací klientská hesla, `LUXART_HELP_URL`, `LUXART_APPROVED_ORIGIN_SHA256`, žádné cesty k Luxart/runtime/UAT/rollback/alert/release důkazům, UAT a cutover potvrzovací fráze, DNS baseline, release ID ani release okno, lokální integrační databáze, `PROBE_*`, externí Playwright Preview ani Vercel protection-bypass hodnoty. Ty patří jen do jednorázového operátorského procesu. Preflight jejich neprázdnou přítomnost v runtime prostředí odmítne.

## Hodnocení výsledku

- `ok=true`: statická konfigurace daného buildu je konzistentní; nejde o důkaz dostupnosti Luxartu, databází ani o povolení cutoveru.
- `ok=false`: nasazení nebo změna fáze je `NO-GO`; `issues[].code` a `issues[].variables` určují bezpečný opravný seznam bez hodnot.
- `/api/readiness` 200: kromě konfigurace běží funkce v `fra1`, je dostupný Luxart a požadované PostgreSQL ledgery/rate limiter.
- `/api/readiness` 503: provozní systém nesmí přijímat pilotní traffic; odpověď nevypisuje interní konfiguraci.

Release dossier přijme runtime důkaz jen tehdy, když readiness fáze přesně odpovídá `launchMode`, readiness commit přesně odpovídá commitu dossieru a capability snapshot odpovídá omezenému pilotu. Pro `booking_without_payments` musí být Stripe i watchdog vypnuté; angličtina, oblíbené na zařízení a rezervace musí být aktivní a zapomenuté heslo vypnuté. Runtime probe musí přes CS i EN route doložit stejnou úplnou množinu Luxart výskytů a Reformerů. `booking_with_stripe` navíc vyžaduje `payments=ready`, `topupsEnabled=true` a `topupMode=stripe`.
