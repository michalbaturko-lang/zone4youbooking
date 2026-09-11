# Zone4You Booking - demo scénář pro klienta

Aktualizace: 2026-09-11

## Cíl prezentace

Ukázat klientovi, že nový booking má reálnou produktovou podobu: rozvrh všech `api/Lesson` položek, detail lekce, CZ/EN, přihlášení, kredit, rezervaci, storno, oblíbené lekce a Luxart hlídání uvolněného místa. Izolovaný veřejný Preview používá pouze demo data a je určený k prezentaci; pro transakční pilot IT potvrdilo dohodu o zveřejnění portu 9191, ale stále čekáme na přesnou URL, read-only důkaz a živé UAT.

## Před prezentací

1. Použít aktuální izolovaný Vercel Preview z handoff zprávy nebo lokální náhled. Produkční doménu, alias ani DNS bez výslovného schválení neměnit.
2. Otevřít náhled ideálně v Chrome v novém okně.
3. Kliknout na `Reset demo`, aby prezentace začínala v čistém stavu.
4. Ověřit, že úvodní stav je odhlášený a v horní liště je tlačítko `Přihlásit`.
5. Pro jistotu projít rychlý smoke: přihlášení demo klienta, jedna rezervace, kontrola kreditu.

## Aktuální ověřený stav

- Aplikace je připravená jako Next.js klient se serverovou integrační vrstvou.
- Frontend volá vlastní `/api` BFF routes, ne přímo mock adapter.
- Chrome smoke ověřil načtení aplikace, čistý odhlášený start, login demo klienta a vytvoření rezervace.
- Serverless demo stav je izolovaný: nový návštěvník nezačíná s předchozím testovacím stavem.
- Poslední lokální runtime probe ověřil 24 unikátních lekcí, Sál 1, Sál 2, Sál 3 a 3 položky Reformeru.
- Aktuální regrese 11. 9. prošla 167/167 integračními a jednotkovými testy, produkčním buildem a 54/54 provedenými lokálními browser scénáři v pěti viewpor-tech; jedna čistě mobilní kontrola se na desktopu záměrně nepouští. Stejný veřejný Preview prošel 20/20 nízkoobjemovými scénáři v pěti viewpor-tech; čtyři nadbytečné login průchody a desktopová mobilní ergonomie byly záměrně přeskočené. Další externí běh smí začít jen nad Preview, které samo vrátí očekávaný přesný Git commit a region `fra1`. Watchdog zůstává v omezeném pilotu vypnutý i na přímé API úrovni; jeho případné smazání navíc vyžaduje záznam patřící přihlášenému klientovi. Počet volných míst se v živém adapteru bere přímo z Luxart `volno`, takže členskou kvótu nepřepíše prostý dopočet z kapacity. Chybné názvové nebo rezervační mapování a nekonzistentní ID lekce se odmítnou ještě před zápisem. Stejně se nesmí jako úspěšná uložit ani přehrát rezervace s jiným klientem nebo výskytem, zápornou cenou či poplatkem, nebo bez explicitní časové zóny. Bezpečnostní audit závislostí hlásí 0 známých zranitelností. Starší detailní počty v následujícím bodu jsou archivní.
- Textové hodnoty z Luxartu jsou omezené podle použití; extrémní nebo řídicí obsah neshodí mobilní rozvrh a dlouhé legitimní profilové údaje se zalomí uvnitř karty.
- Reformer v demu záměrně neukazuje půlnoční storno běžných lekcí jako své pravidlo. Detail v češtině i angličtině pravdivě uvádí, že jeho storno podmínky čekají na potvrzení; rezervaci/storno v živém režimu brána do té doby nepovolí.
- Poslední automatická sada prošla 167/167 testy, samostatnými 1/1 booking, 1/1 payment a 1/1 rate-limit PostgreSQL souběžnými testy a 54/54 provedenými desktop/mobile browser scénáři v pěti viewports; runtime probe navíc porovnává českou a anglickou aplikační cestu a ukládá skutečný stav schedule/bookingu/plateb pro release dossier. Browser umí bezpečný persistentní výpadek/retry a vypršení session s kódem pro podporu. Samostatný session scénář dokazuje, že nepřihlášený klient neodešle rezervaci, login přežije reload a logout odstraní klientská data i přístup k chráněným rezervacím. Live logout smaže cookie i bez Luxartu/limiteru, zatímco cizí Origin ji změnit nesmí. Login i detail lekce mají WCAG scan a skutečně ověřený klávesnicový focus, Tab trap, `Escape` a návrat na původní ovládací prvek. Feed je uzamčený na sedm pražských kalendářních dnů a resort 1 bez možnosti přepsání z URL; kontraktní test navíc přímo dokazuje Luxart `pocet_dni_dopredu=7` a runtime odmítá neplatný časový interval, neúplnou lekci, duplicitní occurrence ID nebo osmý pražský den. Readiness vrátí `schedule=ready` pouze pro validní neprázdný sedmidenní feed. Sdílený limiter chrání i veřejná a účtová čtení. Reálné Luxart/UAT/rollback/alert producenty jsou přímo testované proti finálnímu release kontraktu; ten odmítne diagnostický Luxart důkaz bez testovacího loginu, rozdílný interval, lekci mimo sedm dnů, opakovaná request ID i alert bez support vlastníka. D1 váže cílový Luxart origin na výslovně schválený SHA-256 otisk bez toho, aby svévolně zakázal legitimní hostname, a dossier schématu 3 navíc vyžaduje přímo uloženou D1 atestaci; samostatný diagnostický read-only výstup už jako release důkaz neprojde. Bez nastavené launch fáze zůstává gate správně `NO-GO` (7/27); pro zamýšlený pilot `booking_without_payments` je aktuálně 9/23 a čtyři Stripe kontroly transparentně přeskakuje.

## Doporučený průchod

1. Otevřít úvodní obrazovku.
   - Zdůraznit, že jde o skutečnou Next.js aplikaci, ne statický HTML prototyp.
   - Vysvětlit, že transakce zůstávají vypnuté, dokud neprojdou živé Luxart a UAT brány.

2. Rozvrh lekcí.
   - Přepnout Den / Týden.
   - Vyzkoušet filtr podle místnosti a typu lekce.
   - Ukázat cenu, obsazenost, instruktora a indikaci 48h rezervačního okna.

3. Detail lekce.
   - Otevřít lekci.
   - Ukázat fotku instruktora, popis, cenu, čas, sál a viditelné označení, že storno/kreditní hodnoty jsou pouze demo, nikoli finální pravidla pilotu.

4. Přihlášení.
   - Kliknout na Přihlásit.
   - Použít demo klienta.
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
   - Produkčně musí být ověřena právě jedna Luxart notifikace. Naše aplikace ji nesmí duplikovat.

8. Kredit a platby.
   - Přejít do Kredit.
   - V mock režimu lze ukázat demo dobití a historii transakcí.
   - V live režimu zůstává top-up skrytý, dokud nebude lokálně hotová cesta nasazená na staging, ledger migrace aplikovaná a Luxart `POST api/Payment` mapping živě potvrzený.

## Co říkat k Luxartu

- UI a flow jsou připravené proti adapteru.
- Veřejná `/Help` dokumentace je dostupná a reálný adapter je lokálně namapovaný a kontraktně otestovaný.
- Port 9191 je s Luxartem domluvený ke zveřejnění; čekáme na přesnou URL a potvrzení aktivního přístupu, test DB a auth režimu. Dále chybí mapování sálů na `id_resource` a povolení bezpečných mutačních testů.
- Luxart musí živě potvrdit Reservations, storno, watchdog notifikaci a `zpusob_uhrady`/deduplikaci pro Payment.

## Co neprezentovat jako hotové

- Není to produkční backend.
- Stripe top-up není produkční: lokální Checkout/webhook/PostgreSQL kód je hotový, ale chybí staging databáze, secrets, registrace webhooku a živý Payment test.
- Standardní emailové notifikace má posílat Luxart; naše aplikace je záměrně neduplikuje.
- Login používá demo klienta; produkční login čeká na živé ověření proti Zone4You test API.
