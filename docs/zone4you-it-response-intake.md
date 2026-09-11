# Zone4You IT — příjem a vyhodnocení odpovědi

Aktualizace: 2026-09-11

Tento checklist slouží pouze k vyhodnocení technické odpovědi. Není souhlasem s deployem, DNS změnou ani živou Luxart mutací. Hesla, tokeny, privátní klíče a klientské přihlašovací údaje se do tohoto souboru ani do repozitáře nevkládají.

## 1. Záznam odpovědi bez tajných hodnot

| Položka | Přijatá odpověď | Stav |
|---|---|---|
| Datum a technický kontakt | 11. 9. 2026, odpověď Zone4You IT | přijato |
| API root a `/Help` URL | potvrzen pouze port `9191`; host, schéma a cesta chybí | blokuje test |
| Testovací databáze potvrzena | v odpovědi neuvedeno | nepotvrzeno |
| Síťová cesta | „s Luxartem je domluveno zveřejnění portu 9191“; není potvrzeno, zda je už otevřený ani odkud | částečné |
| Gateway autentizace | v odpovědi neuvedena; nelze z toho odvodit režim `none` | nepotvrzeno |
| Bezpečný kanál pro secrets | secret store / jiný schválený kanál | čeká se |
| Read-only test povolen | výslovně neuvedeno | nepotvrzeno |
| Jedna rezervace a storno povoleny | port je určen „kvůli rezervacím“, ale testovací mutace ani storno nejsou výslovně povoleny | nepotvrzeno |
| `cislo_salu` → `id_resource` | vlastník nebo úplná tabulka | čeká se |
| Watchdog a Luxart notifikace | endpointy a aktivní šablony potvrzeny / nepotvrzeny | čeká se |
| DNS vlastník | jméno/role, ne přístupové údaje | čeká se |
| Staging hostname | dostupný / návrh / nedostupný | čeká se |

## 2. Automatické rozhodnutí o dalším kroku

### Vyhodnocení odpovědi z 11. 9. 2026

- Je potvrzená dohoda Luxart ↔ Zone4You IT o zveřejnění nového portu `9191` pro rezervace.
- Historický port `9759` proto nelze dál automaticky považovat za externí vstupní port.
- Je možné, že `9191` bude jen veřejný překlad na interní `9759`, ale jde pouze o hypotézu; konfigurace ji nesmí předpokládat.
- Formulace „zveřejnění portu“ neprokazuje, že je port už otevřený, že používá HTTPS, že vede na testovací databázi ani že nevyžaduje gateway autentizaci.
- Neexistuje ještě sestavitelná URL. Bez hostname/IP a schématu nelze bezpečně provést ani `/Help` probe.

### A — lze spustit read-only Luxart ověření

Musí být současně známé:

- přesná API a `/Help` URL;
- bezpečná síťová cesta;
- explicitní gateway auth režim;
- potvrzení testovací databáze;
- výslovné povolení read-only testu;
- případné credentials jsou vložené mimo e-mail a repozitář.

Poté lze spustit pouze složenou read-only bránu `verify:luxart-d1`, která nejprve znovu ověří port 9191, HTTPS, `/Help`, potvrzený gateway režim a resort 1 a až potom provede autentizovaný CS/EN read-only test. Výstup smí obsahovat jen agregované počty, rozsah dat, čísla sálů a hashe množiny výskytů — nikdy osobní data nebo syrové odpovědi.

### B — lze připravit řízené rezervační UAT

K podmínkám A musí navíc existovat:

- výslovné povolení jedné testovací rezervace a jejího storna;
- určený testovací klient a bezpečná testovací lekce předané schváleným kanálem;
- úplné mapování každého pozorovaného `cislo_salu` na `id_resource`;
- potvrzená business pravidla a jejich schválený profil;
- PostgreSQL booking ledger a rate limiter na stagingu;
- připravený návrat testovacího klienta do původního stavu.

Dokud kterákoli podmínka chybí, booking mutace zůstávají vypnuté.

### C — odpověď není dostatečná

Read-only test se nespouští, pokud chybí síťová cesta, gateway režim, potvrzení test DB nebo read-only povolení. Nezabezpečený veřejný HTTP endpoint není produkční řešení; lze jej výslovně přijmout pouze pro dočasný stagingový test.

## 3. Co po přijetí odpovědi ověřit

1. Zkontrolovat, že URL neobsahuje username, heslo ani token.
2. Ověřit `/Help` a gateway konfiguraci bez klientského loginu.
3. Spustit český a anglický read-only feed pro přesně sedm pražských kalendářních dnů.
4. Porovnat počet a hash všech výskytů, sály a Reformer; neznámý sál se nesmí zahodit.
5. Získat úplné mapování všech skutečně pozorovaných čísel sálů.
6. Teprve po samostatné autoritě připravit staging, alert, rollback a jedno řízené UAT.
7. Produkční deploy, DNS a cutover zůstávají samostatně schvalované akce.

### Síťové pozorování 11. 9. 2026

- Neautentizovaný probe veřejné referenční dokumentace Luxartu na portu `9295` prošel: HTTP 200 a rozpoznaná stránka `API dokumentace`.
- Obvyklé veřejné Zone4You hostname varianty na portu `9191` při HTTP i HTTPS z tohoto vývojového připojení timeoutovaly.
- Toto pozorování nedokazuje, že je port obecně zavřený: IT může používat jiný hostname, VPN nebo allowlist. Dokazuje pouze, že bez přesné URL není z aktuálního připojení dosažitelná žádná zjevná veřejná varianta.
- Následný explicitní kandidátní test `api.memberzone.online:9191` ukázal jinou službu: HTTP kořen odpověděl 200 obecnou indexovou stránkou, ale `/Help` odpovědělo 404 a HTTPS selhalo, protože port mluví pouze prostým HTTP. Naproti tomu referenční `:9295/Help` ve stejném okamžiku znovu odpovědělo 200 a bylo rozpoznáno jako Luxart API dokumentace.
- Původní Luxart zpráva označuje `api.memberzone.online:9295` za referenční testovací API a současně uvádí, že API u klienta musí veřejně zpřístupnit jeho IT. Z toho plyne, že samotné doplnění `:9191` ke stejnému Luxart hostname není potvrzená ani funkční Zone4You URL.
- Nebyl odeslán login, heslo, cookie ani autorizační hlavička a nebyla provedena žádná API mutace.

## 4. Výsledek vyhodnocení

- Read-only integrace: `NEPOVOLENA` — chybí úplná URL, stav portu, test DB a auth režim
- Rezervační UAT: `NEPOVOLENO` — chybí read-only důkaz, explicitní testovací autorita, mapování sálů a úplná business pravidla
- Deployment: vždy `NEAUTORIZOVÁN`, dokud nevznikne samostatné schválení
- DNS/cutover: vždy `NEAUTORIZOVÁN`, dokud nevznikne samostatné schválení
- Nejbližší bezpečný krok: získat od IT veřejnou IP nebo DNS Zone4You, na které port `9191` skutečně zveřejnilo, spolu se schématem a potvrzením aktivního stavu; následně spustit pouze neautentizovaný `npm run probe:luxart-help`. Klientské přihlašovací údaje se použijí až po bezpečném transportním a gateway důkazu.
- Chybějící položky a vlastník: host/schéma/stav portu/test DB/auth — Zone4You IT + Luxart; mutační UAT a pravidla — Zone4You + Luxart.
