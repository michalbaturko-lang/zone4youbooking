# Zone4You Booking — připravenost hostingu

Aktualizace: 2026-09-11

Tento dokument odděluje bezpečnou přípravu hostingu od deploye, změny DNS a produkčního cutoveru. Samotná existence Vercel projektu ani zelený build není souhlas s publikací.

## Ověřený stav

Read-only kontrola propojeného Vercel projektu potvrdila:

- projekt `zone4youbooking` existuje v aktuálním Vercel týmu;
- projekt používá Node.js 24.x; repozitář deklaruje framework `nextjs` ve `vercel.json`;
- v projektu není nastavená žádná runtime environment variable;
- `booking.zone4you.cz` není k projektu připojená ani dostupná jako jeho alias;
- veřejné DNS pro `booking.zone4you.cz` i `staging.booking.zone4you.cz` už vrací A/AAAA na existující server mimo Vercel; HTTPS certifikát neplatí pro požadovaný hostname a HTTP vrací nginx 404;
- historický produkční alias je 84 dní starý a není důkazem současného buildu;
- 11. 9. vznikl nový izolovaný Vercel Preview pro klientskou prezentaci. Vrací HTTPS bezpečnostní hlavičky, `noindex`, zdravý `/api/health` a `/api/readiness`, který výslovně potvrzuje pouze `mode=demo`, `luxart=mock`, `schedule=mock` a paměťový rate limit;
- nový Preview prošel nízkoobjemovou browser regresí ve všech pěti viewports: 20/20 provedených scénářů včetně jediného přihlášení, rezervace a následného storna, 5 záměrných skipů kvůli login limiteru a desktopové duplicitě mobilní ergonomie;
- Preview nemá Luxart ani jiné runtime secrets a není live stagingem, UAT důkazem ani kandidátem pro release dossier.

Z toho plyne, že nový Preview lze bezpečně ukázat klientovi jako interaktivní demo, ale nelze jej použít jako stagingový ani produkční důkaz pro pilot. Současná cílová doména zůstává bez schváleného cutoveru nepoužitelná a žádný demo důkaz nesmí vstoupit do release dossieru.

## Umístění a přístup k Luxart API

Vercel Functions jinak standardně běží v `iad1` ve Washingtonu. Projekt proto deklaruje `fra1` (Frankfurt), tedy evropský region blízko předpokládaného českého Luxart serveru. Live `/api/readiness`, runtime probe, release dossier i produkční post-cutover kontrola nyní fail-closed odmítnou jiný nebo neznámý systémový `VERCEL_REGION`. Finální latenci a síťovou cestu je nutné potvrdit až proti skutečnému Zone4You endpointu.

Standardní odchozí IP Vercel Functions jsou dynamické. Pokud IT Zone4You vyžaduje IP allowlist, jsou bezpečné varianty:

1. Vercel Static IPs pro projekt v regionu `fra1` a povolení přidělených egress IP na Zone4You firewallu;
2. Vercel Secure Compute s privátním napojením/VPN, pokud je k dispozici odpovídající plán a infrastruktura;
3. veřejný HTTPS reverse proxy endpoint spravovaný Zone4You, chráněný síťově a samostatnou Basic/Bearer/vlastní gateway autentizací.

Samotná IP allowlist není autentizace. I při statické IP se preferuje samostatná gateway credential nebo jiná druhá vrstva, pokud ji IT umí dodat. Testovací klientské přihlašovací údaje se pro gateway nikdy nepoužijí.

Oficiální podklady:

- [Vercel: statické odchozí IP a Secure Compute](https://vercel.com/kb/guide/can-i-get-a-fixed-ip-address)
- [Vercel: konfigurace regionů funkcí](https://vercel.com/docs/functions/configuring-functions/region)
- [Vercel: seznam regionů](https://vercel.com/docs/regions)

## Povinné pořadí stagingu

| Brána | Akce | Důkaz | Stav |
|---|---|---|---|
| H0 Autorita | IT dodá host/HTTPS, gateway režim, síťovou cestu a povolení read-only testu | písemná odpověď | čeká se |
| H1 Síť | vybere se veřejné HTTPS, Static IPs nebo Secure Compute/VPN | spojení z `fra1`, žádné tajemství v URL/logu | čeká se |
| H2 Databáze | provisionovat pooled TLS PostgreSQL a aplikovat migrace `003` a pro booking fázi `002` | transakční testy + readiness | čeká se |
| H3 Konfigurace | vložit pouze runtime proměnné do Vercel secret store; žádné UAT účty ani operátorské fráze | `verify:deployment-preflight` | čeká se |
| H4 Read-only staging | nasadit přesný schválený commit s vypnutými booking/payment/watchdog mutacemi | readiness + runtime probe v `fra1` | čeká se |
| H5 Live integrace | porovnat přímý Luxart a stagingový CS/EN feed pro stejných sedm pražských dnů | hashované důkazy | čeká se |
| H6 Transakční staging | až po pravidlech, resource mapě a povolení test DB spustit jedno řízené UAT | obnovený stav + request ID | čeká se |
| H7 Doména/cutover | po identifikaci vlastníka nahradit existující A/AAAA, připojit doménu k Vercelu a vydat platný certifikát až po UAT, rollbacku, alertu, fallbacku a výslovném souhlasu; pilotní skupinu otevřít až po read-only kontrole skutečné produkční domény | zelený release dossier před změnou + zelený `verify:production-cutover` po změně | čeká se |

## Konfigurační hranice

- Veřejný prezentační Preview smí obsahovat jen mock data, žádné runtime secrets, musí hlásit přesný demo/mock profil a mít `noindex`. Live staging musí zůstat chráněný; operátorský runtime probe může použít jednorázový protection bypass mimo runtime prostředí aplikace.
- Vercel/serverless se považuje za multi-instance topologii, proto používá `RATE_LIMIT_MODE=postgres`; paměťový limiter není pro tento hosting produkční varianta.
- `BOOKING_MUTATIONS_ENABLED=false`, `PAYMENT_MUTATIONS_ENABLED=false` a `LUXART_WAITLIST_ENABLED=false` jsou výchozí i rollback hodnoty.
- Produkční doména, DNS, secrets ani deployment se nemění bez samostatného schválení.
- Existující A/AAAA a wildcard/subdomain chování se před cutoverem zdokumentuje a připraví se přesný návrat na původní hodnoty; současné záznamy se nyní nemění.
- Zelený release dossier autorizuje změnu, ale nedokládá výsledek DNS. Po přepnutí musí před otevřením pilotu projít `verify:production-cutover`; při chybě se bez dalšího experimentování vrátí zaznamenané původní DNS hodnoty.
- Přesná matice proměnných a zákaz CLI-only hodnot v runtime prostředí je v `docs/deployment-preflight.md`.

## Bezprostřední rozhodnutí po odpovědi IT

Pokud IT odpoví „povolíme konkrétní IP“, je nutné před stagingem rozhodnout, zda Zone4You schválí placené Vercel Static IPs, nebo poskytne bezpečný veřejný HTTPS endpoint s gateway autentizací. Dynamickou Vercel IP nelze předat jako stabilní allowlist údaj.

Pokud IT poskytne VPN-only přístup, standardní Vercel projekt se nepřipojí bez odpovídající privátní síťové vrstvy. Do vyřešení zůstává možný pouze lokální integrační test přes schválenou VPN a read-only veřejný pilot se nespouští.
