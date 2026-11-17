# Demo s reálným veřejným rozvrhem

Uživatel požádal o převzetí aktuálních lekcí 1:1. Zdroj je veřejný přehled lekcí `https://memberzone.cz/zone4you/scheduler.aspx`, na který odkazuje web Zone4you. Bez přihlášení byly přečtené pouze rozvrhy pro Sál 1, Sál 2, Sál 3 a Reformer. Žádná akce Rezervovat se v originálu neprovedla.

`config/public-schedule-snapshot.json` obsahuje 149 zveřejněných termínů 17.-29. listopadu 2026, zdrojovou adresu, časy načtení obou týdnů a SHA-256 zdrojových odpovědí. Z nich aplikace zobrazuje standardních sedm pražských kalendářních dnů; při převzetí 17.-23. 11. jde o 76 lekcí. Zkopírované jsou skutečné názvy, termíny, přesná délka, uvedené jméno instruktora, umístění, kapacita a zveřejněný počet rezervací. Datum se neposouvá na dnešek podle offsetu jako u syntetického datasetu.

DevExpress zdroj uvádí dvě délky: skutečnou AddAppointment duration a zaokrouhlenou AddVerticalAppointment výšku v tabulce. Import používá skutečnou duration, nikoli výšku položky. Anonymní callback druhého týdne obsahuje více vrstev escapování; parsovala se data, žádný stažený JavaScript se nespouštěl importérem. Mapa veřejných resource IDs slouží jen k pojmenování sálů a není potvrzením živé REST resource mapy pro zápis.

## Zapnutí a omezení

- `LUXART_MOCK=true`, `NEXT_PUBLIC_APP_ENV=demo`, `ZONE4YOU_DEMO_SCHEDULE=public_snapshot` v daném demo deploymentu. Původní syntetický dataset zůstává pro deterministické regresní testy a bez výslovné volby se produkční demo na jiný zdroj samo nepřepne.
- Readiness přizná `schedule=public_snapshot` a metadata zdroje, snapshot je předá UI. Viditelný odkaz a čas uvádějí, že nejde o živou synchronizaci. Počet rezervací se může v Memberzone dále měnit.
- Zdroj ceny, fotografie ani kategorie cvičení nezveřejňuje. Ceny a neověřené fotografie se nezobrazí; kategorie je pouze obecná Lekce / Reformer. Interní nulová cenová hodnota není nabídka bezplatné lekce: `pricePublished=false` ji skrývá i v detailu a seznamu demo rezervací.
- Osobní účet a kredit jsou nadále ukázkové. Pro veřejný snapshot nejsou nasazené vymyšlené úvodní rezervace, čekací listina ani kreditní transakce. Starý browser state z jiného datasetu se odmítne podle verze, aby nevnášel staré rezervace či obsazenost.
- Demo booking a storno upravují jen lokální demo stav. Samotný zdrojový JSON se nemění. Živé API ani business pravidla se touto úpravou neschvalují.
- Nejde o automatický scraping/synchronizaci. Pro úplné sedmidenní okno musí být snapshot obnoven nejpozději 24. 11.; readiness pak odmítne neúplné pokrytí a UI upozorní na nutnou obnovu; minulá data se nesmí posunout na budoucí datum.

## Ověření a nasazení

`npm run verify:public-demo-schedule` porovná každou nasazenou lekci s JSON zdrojem pro aktuálních sedm pražských dnů. Vyžaduje `APP_BASE_URL` a na veřejném cíli také přesný `ZONE4YOU_EXPECTED_DEMO_COMMIT`. Nejdříve prokáže demo/mock a public_snapshot; teprve potom čte snapshot s prázdným browser state. Na živém cíli se zastaví. Původní externí Playwright guard pro syntetických 24 lekcí zůstává beze změny a nemá se obcházet.

Vedle standardních regresí provést porovnání všech polí a skutečné browser ověření desktop/mobil/menší mobil/WebKit: dnešní čtyři skutečné lekce, týdenní výpis, zdrojová poznámka, skryté neověřené ceny, detail bez cizí fotografie a jeden řízený booking/storno výhradně nad mock stavem. Stejný produkční build po ověření propagovat na hlavní Vercel adresu. Postup `demo-deployment-2026-11-17.md` nadále platí.
