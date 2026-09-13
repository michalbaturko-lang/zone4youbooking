# Zone4You Booking - demo scénář pro klienta

Aktualizace: 2026-09-13

## Cíl prezentace

Ukázat klientovi, že nový booking má reálnou produktovou podobu: rozvrh všech `api/Lesson` položek, detail lekce, CZ/EN, přihlášení, kredit, rezervaci, storno, oblíbené lekce a Luxart hlídání uvolněného místa. Izolovaný veřejný Preview používá pouze demo data a je určený k prezentaci; pro transakční pilot stále čekáme na přesný šifrovaný veřejný origin Zone4You REST instance, potvrzení překladu na interní port `9759`, read-only důkaz a živé UAT.

## Před prezentací

1. Použít ověřený izolovaný Vercel Preview `https://zone4youbooking-58efsjlv6-mbos-projects-220653ae.vercel.app/`. Produkční doménu, alias ani DNS bez výslovného schválení neměnit.
2. Otevřít náhled ideálně v novém anonymním okně Chrome, aby prezentace začínala v čistém stavu.
3. Ověřit viditelné označení ukázkové verze a informaci, že rezervace ani kredit se neukládají do Memberzone.
4. Ověřit, že úvodní stav je odhlášený a v horní liště je tlačítko `Přihlásit se`.
5. Pro jistotu projít rychlý smoke: přihlášení demo klienta, jedna rezervace, kontrola kreditu.

## Aktuální ověřený stav

- Aplikace je připravená jako Next.js klient se serverovou integrační vrstvou.
- Frontend volá vlastní `/api` BFF routes, ne přímo mock adapter.
- Chrome smoke ověřil načtení aplikace, čistý odhlášený start, login demo klienta a vytvoření rezervace.
- Serverless demo stav je izolovaný: nový návštěvník nezačíná s předchozím testovacím stavem.
- Poslední lokální runtime probe ověřil 24 unikátních lekcí, Sál 1, Sál 2, Sál 3 a 3 položky Reformeru.
- Autoritativní regrese 13. 9.: aktuální větev prošla 246/246 jednotkovými a integračními testy, produkčním sestavením a 62/62 lokálními browser scénáři; poslední dokončený veřejný Preview běh prošel 24/24 nízkoobjemovými scénáři. Přesný HEAD commit a URL se berou z draft PR, ne z této statické prezentace. Chromium i WebKit pokrývají mobile-first rozvrh, CS/EN, přihlášení, rezervaci a storno běžné lekce i Reformeru proti izolovanému mocku; 13 lokálních a 5 veřejných nevhodných kombinací je záměrně přeskočeno. Runtime potvrzuje 24 lekcí, všechny tři sály, 3 Reformery, sedm pražských dnů a region `fra1`. Bezpečnostní audit závislostí i celé Git historie je čistý. Živé UAT musí otestovat každý mapovaný sál a používá jeden ověřený login pro celou sadu; demo tento důkaz nenahrazuje.
- Následující technické body popisují vlastnosti ověřené v průběžných regresích; starší mezipočty už nejsou aktuální release evidence.
- Extrémní finanční hodnota z poškozeného Luxart nebo demo payloadu se nezobrazí ani neuloží jako úspěšná rezervace; technický limit je oddělený od obchodních pravidel Zone4You.
- Textové hodnoty z Luxartu jsou omezené podle použití; extrémní nebo řídicí obsah neshodí mobilní rozvrh a dlouhé legitimní profilové údaje se zalomí uvnitř karty.
- Reformer v demu záměrně neukazuje půlnoční storno běžných lekcí jako své pravidlo. Detail v češtině i angličtině pravdivě uvádí, že jeho storno podmínky čekají na potvrzení; rezervaci/storno v živém režimu brána do té doby nepovolí.
- Aktuální launch gate je záměrně `NO-GO`: pro `booking_without_payments` prochází 6/24 relevantních kontrol a čtyři Stripe kontroly jsou správně mimo rozsah. Autoritou je vždy čerstvý výstup `npm run check:launch`, nikoli historický počet v dokumentaci.

## Doporučený průchod

1. Otevřít úvodní obrazovku.
   - Zdůraznit, že jde o skutečnou Next.js aplikaci, ne statický HTML prototyp.
   - Vysvětlit, že transakce zůstávají vypnuté, dokud neprojdou živé Luxart a UAT brány.

2. Rozvrh lekcí.
   - Přepnout Den / Týden.
   - Vyzkoušet filtr podle místnosti a typu lekce.
   - Ukázat cenu, obsazenost a instruktora. Případné časové omezení v demu výslovně označit jako ukázkové, protože živé rezervační okno ještě není potvrzené.

3. Detail lekce.
   - Otevřít lekci.
   - Ukázat fotku instruktora, popis, cenu, čas, sál a viditelné označení, že storno/kreditní hodnoty jsou pouze demo, nikoli finální pravidla pilotu.

4. Přihlášení.
   - Kliknout na Přihlásit.
   - Použít demo klienta: `Nováková` / `2048`.
   - Vysvětlit, že produkčně se tato část přepne na Luxart `api/Login`.

5. Rezervace.
   - Rezervovat lekci s volnou kapacitou.
   - Ukázat snížení kreditu a stav Rezervováno.

6. Moje rezervace.
   - Přejít do Rezervace.
   - Ukázat aktivní rezervaci a případné hlídání uvolněného místa.
   - Zrušit demo rezervaci a vysvětlit, že finální storno pravidlo včetně Reformeru musí potvrdit Zone4You/Luxart.

7. Hlídání uvolněného místa.
   - Otevřít plnou lekci.
   - Zapnout a znovu vypnout hlídání místa.
   - Zdůraznit, že veřejný Luxart watchdog kontrakt neobsahuje pořadí ani automatickou rezervaci; aplikace je proto neslibuje.
   - Produkčně musí být ověřena právě jedna Luxart notifikace. Naše aplikace ji nesmí duplikovat a release dossier vyžaduje samostatné jmenovité potvrzení aktivních šablon.

8. Kredit a platby.
   - Přejít do Kredit.
   - V mock režimu lze ukázat demo dobití a historii transakcí.
   - V live režimu zůstává top-up skrytý, dokud nebude lokálně hotová cesta nasazená na staging, ledger migrace aplikovaná a Luxart `POST api/Payment` mapping živě potvrzený.

## Co říkat k Luxartu

- UI a flow jsou připravené proti adapteru.
- Veřejná `/Help` dokumentace je dostupná a reálný adapter je lokálně namapovaný a kontraktně otestovaný.
- Nejpravděpodobnější zamýšlený host je `api.memberzone.online:9191`, ale aktuálně je port navázaný na jinou SOAP/WCF aplikaci: veřejný kořen má directory listing a REST `/Help` vrací 404. Čekáme na opravu překladu na interní Zone4You REST port 9759, přesný HTTPS origin, test DB a auth režim. Dále chybí mapování sálů na `id_resource` a povolení bezpečných mutačních testů.
- Luxart musí živě potvrdit Reservations, storno, watchdog notifikaci a `zpusob_uhrady`/deduplikaci pro Payment.

## Co neprezentovat jako hotové

- Není to produkční backend.
- Stripe top-up není produkční: lokální Checkout/webhook/PostgreSQL kód je hotový, ale chybí staging databáze, secrets, registrace webhooku a živý Payment test.
- Standardní emailové notifikace má posílat Luxart; naše aplikace je záměrně neduplikuje.
- Login používá demo klienta; produkční login čeká na živé ověření proti Zone4You test API.
