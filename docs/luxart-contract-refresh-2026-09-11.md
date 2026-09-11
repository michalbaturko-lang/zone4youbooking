# Luxart API — read-only kontrola kontraktu 11. 9. 2026

Tento záznam je pouze neosobní read-only evidence veřejné referenční dokumentace. Není důkazem dostupnosti Zone4You instance na portu `9191`, souhlasem s mutací ani autoritou k deployi.

## Zjištění

- Referenční `http://api.memberzone.online:9295/Help` odpovědělo HTTP 200.
- Neautentizovaný `GET /api/Lesson` odpověděl 401; žádné přihlašovací údaje ani osobní data nebyly odeslány.
- Dokumentace uvádí potřebné kontrakty pro login, všechny `Lesson` položky, seznam/vytvoření/storno rezervace a watchdog.
- Automatický `verify:luxart-public-contract` ověřuje 11 používaných endpointů podle jejich HTTP metody, přesného titulku a povinných polí. Výstup je vždy `referenceOnly=true`, `launchAuthority=false` a neobsahuje cílový hostname ani syrové HTML.
- Aktuální dokumentace rozlišuje dvě podoby členské karty: odpověď `POST api/Login` uvádí `member_card`, zatímco `GET api/User` uvádí také `member_card_number`. Adaptér přijímá obě varianty a při jejich současné přítomnosti dává přednost `member_card_number`.
- Storno odpověď obsahuje `storno_poplatek`; UI proto nesmí částku domýšlet a ukazuje hodnotu vrácenou Luxartem.
- `Lesson_data` obsahuje mimo jiné datum a čas, službu, cenu, název, popis, kapacity/obsazenost, `cislo_salu`, instruktora a příznak rezervovatelnosti. To odpovídá pilotnímu rozsahu všech lekcí, všech sálů a Reformeru.
- Runtime validace nyní pokrývá i celé seznamy rezervací, watchdogu a historie kreditu. Cizí resort, watchdog jiného klienta, neplatná povinná ID/data/částky, duplicitní výsledné identifikátory nebo objekt místo očekávaného pole způsobí bezpečné odmítnutí celé odpovědi; adaptér nevytvoří ani neschová částečný falešný stav účtu.
- Stejná ochrana platí přímo uvnitř adaptéru pro seznam lekcí. Pokud Luxart vrátí dvě položky se stejným ID výskytu, interní předrezervační načtení skončí bezpečnou chybou ještě před vytvořením payloadu; konfliktní sál nebo resource se proto nemůže vyřešit pořadím řádků.
- Po mutaci se validuje objekt, celočíselný stav a povinné výsledné hodnoty. Rezervace bez Luxart `uuid` je úspěšná jen tehdy, když ji následný seznam jednoznačně potvrdí; chybějící potvrzení, vadný storno poplatek, prázdná/mnohonásobná delete odpověď nebo neplatné `id_mp` po platbě přechází do stavu nejistého výsledku pro ruční reconciliation. Adaptér negeneruje náhradní náhodné ID a klientovi nevrací syrový `messaget` z upstreamu.
- Nový automatický `probe:luxart-help` na referenčním portu `9295` v 12:43 CEST prošel s HTTP 200 a klasifikací `ready`; bezpečný výstup neobsahuje hostname ani credentials.
- Stejný probe na zjevné veřejné Zone4You variantě s portem `9191` skončil connect timeoutem. Host ale nebyl IT potvrzen, proto jde pouze o negativní kandidátní pozorování, nikoli o definitivní stav portu.
- Samostatný kandidátní test stejného Luxart hostname na portu `9191` v 16:17 CEST dosáhl HTTP služby, ale `/Help` vrátilo 404, HTTPS nebylo podporováno a kořen byl pouze obecný HTML index. Současný referenční `:9295/Help` přitom znovu prošel s HTTP 200 a klasifikací `ready`. `api.memberzone.online:9191` proto není doložený ani použitelný Zone4You API root.
- Původní Luxart zpráva z 1. 4. 2026 potvrzuje API na serveru Zone4You na interním portu `9759` a testovací databázi. Port `9191` je proto pravděpodobný veřejný překlad na tuto službu, nikoli port referenčního Luxart hostu; přesný NAT/reverse-proxy vztah musí potvrdit IT.
- Následný neautentizovaný IPv4 probe běžných Zone4You hostname variant na portech `9191` i `9759` skončil connect timeoutem přes HTTP i HTTPS. To je konzistentní s neaktivním pravidlem, jiným hostem, VPN nebo allowlistem, ale samo o sobě žádnou variantu nepotvrzuje.
- Kořen služby `api.memberzone.online:9191` zveřejňuje directory listing s názvy aplikačních adresářů a konfiguračních souborů. Žádný odkaz ani soubor nebyl otevřen; službu dál nezkoumáme a doporučujeme správci výpis adresáře vypnout.

## Aktuální automatický důkaz kontraktu

Spuštěno v 16:21 CEST:

```bash
npm run verify:luxart-public-contract
```

- výsledek: `ok=true`;
- ověřeno: `11/11` endpointů;
- chybějící pole nebo neočekávaný dokument: `0`;
- sémantický SHA-256 nad názvy endpointů a jejich dokumentovanými poli: `869beb3af67e648854462982b15f099aad622992dbbc81c2ec5bb4c9afc7bf20`.

Sémantický otisk záměrně ignoruje CSS, bundlované asset URL a další prezentační HTML. Při změně názvu endpointu nebo datových polí se naopak změní a povinné pole použité adaptérem způsobí `NO-GO` výsledek.

## Release dopad

Adaptér lze dál vyvíjet a lokálně testovat proti tomuto kontraktu. Živý read-only gate se otevře až po získání přesné Zone4You URL na portu `9191`, potvrzení testovací databáze a gateway režimu. Rezervační zápisy zůstanou vypnuté až do samostatně povoleného UAT, mapování všech pozorovaných sálů, PostgreSQL ledgeru, úplných business pravidel, rollbacku a výslovného cutover schválení.
