# Zone4You — Dotazy na funkcionalitu nového rezervačního systému

Před zahájením vývoje potřebujeme upřesnit, jaké funkce si přejete v novém rezervačním systému. Níže jsou oblasti, ke kterým potřebujeme vaše rozhodnutí.

---

## 1. Přihlášení a registrace

- **Přihlášení:** Aktuálně se klienti přihlašují přes memberzone.cz. V novém systému bude přihlášení přímo v novém rozhraní (login + heslo přes API Luxartu). Souhlasíte?
- **Registrace nových klientů:** Chcete umožnit registraci nových klientů přímo přes web, nebo se noví klienti stále registrují pouze na recepci / osobně?
- **Zapomenuté heslo:** Má být v novém rozhraní funkce "Zapomenuté heslo"? Pokud ano, jak se to řeší dnes — posílá se reset emailem?
- **Přihlášení kartou:** V API existuje možnost přihlášení číslem členské karty. Chcete tuto variantu nabízet i v online rozhraní, nebo je to pouze pro terminály v centru?

## 2. Kredit a platby

- **Zobrazení kreditu:** V novém rozhraní budeme zobrazovat aktuální zůstatek kreditu přihlášeného klienta. Souhlasíte se zobrazením v hlavičce stránky (vedle jména)?
- **Dobíjení kreditu online:** Chcete umožnit klientům dobíjet kredit přímo přes web platební kartou?
  - Pokud ano: **Jakou platební bránu** preferujete? (např. GoPay, Comgate, Stripe, jiná)
  - Chcete nastavit **minimální/maximální částku** pro dobití? Jaké?
  - Mají být předdefinované částky (např. 500 Kč, 1000 Kč, 2000 Kč), nebo volná částka?
- **Historie plateb / transakcí:** Chcete, aby si klient mohl prohlédnout historii svých plateb a dobití kreditu?

## 3. Rezervace lekcí

- **Rezervace s kreditem:** Strhává se kredit v momentě rezervace, nebo až po absolvování lekce?
- **Cena lekcí:** Jsou ceny lekcí různé (např. Reformer dražší než běžná lekce)? Mají se ceny zobrazovat u každé lekce?
- **Maximální počet rezervací:** Existuje limit, kolik lekcí si klient může najednou rezervovat (např. max 3 dopředu)?
- **Časový horizont rezervací:** Jak daleko dopředu se lze rezervovat? (1 týden, 2 týdny, měsíc?)
- **Zrušení rezervace:**
  - Jak dlouho před lekcí může klient zrušit rezervaci bez sankce? (např. 2 hodiny, 12 hodin, 24 hodin)
  - Existuje storno poplatek / penalizace za pozdní zrušení?
  - Vrací se kredit při včasném zrušení?
- **No-show (nedostavení se):** Je nějaký postih za neúčast bez zrušení rezervace?

## 4. Čekací listina (waiting list)

- **Chcete čekací listinu?** Když je lekce plná, má se klient moci zapsat na čekací listinu?
  - Pokud ano: Automatické zařazení při uvolnění místa, nebo notifikace klientovi, ať se zapíše?
  - Maximální počet lidí na čekací listině?

## 5. Profil klienta

- **Osobní údaje:** Má si klient moci prohlédnout/upravit své osobní údaje (jméno, email, telefon)?
- **Změna hesla:** Má být možná přímo v novém rozhraní?
- **Historie lekcí:** Chcete, aby si klient mohl prohlédnout historii navštívených lekcí (archiv)?

## 6. Rozvrh a zobrazení

- **Denní vs. týdenní pohled:** V designu jsou oba. Chcete oba ponechat?
- **Zobrazení instruktora:** U každé lekce zobrazujeme instruktora. Je to v pořádku? Chcete zobrazit i náhradního instruktora / zástup?
- **Obsazenost lekce:** Jaký formát zobrazení preferujete?
  - Přesný počet (např. "5 volných míst z 12")
  - Barevný indikátor (zelená = volno, oranžová = málo míst, červená = plno)
  - Obojí
- **Filtrování:** V designu jsou filtry podle sálu a typu lekce. Chcete přidat filtr podle instruktora?
- **Oblíbené lekce:** Chcete funkci "oblíbené", kde si klient označí lekce a dostane přehled?

## 7. Notifikace

- **E-mailové potvrzení:** Má systém posílat email při:
  - Úspěšné rezervaci?
  - Zrušení rezervace?
  - Uvolnění místa z čekací listiny?
  - Dobití kreditu?
- **Připomenutí lekce:** Chcete posílat připomínku před lekcí (např. 2h předem)? Emailem, SMS, nebo push notifikací?
- **Kdo odesílá emaily?** Má je odesílat naše aplikace (potřebujeme SMTP server / službu), nebo to řeší Luxart přes své API?

## 8. Speciální lekce

- **Reformer:** Reformer lekce mají typicky omezenější kapacitu a jinou cenu. Jsou pro Reformer jiná pravidla rezervací?
- **Soukromé lekce / PT:** Chcete v systému umožnit i rezervaci soukromých lekcí nebo personal training?
- **Jednorázový vstup:** Může si někdo bez stálého kreditu / členství zarezervovat jednorázovou lekci a zaplatit online?

## 9. Technické a provozní otázky

- **Doména:** Potvrzujete, že nový systém poběží na **booking.zone4you.cz**?
- **HTTPS:** Luxart doporučuje HTTPS na vašem serveru pro API. Je na vašem serveru certifikát, nebo ho potřebujete pomoci zprovoznit?
- **Mobilní aplikace:** Nový design je responzivní (funguje na mobilech v prohlížeči). Chcete i nativní mobilní aplikaci, nebo stačí webová verze?
- **Stávající memberzone.cz:** Bude starý systém (memberzone.cz/zone4you) po spuštění nového zrušen, nebo poběží paralelně?
- **Jazyky:** Pouze čeština, nebo i angličtina pro zahraniční klienty?

## 10. Administrace

- **Admin rozhraní:** Potřebujete administrační panel na webu, nebo vše spravujete přes Luxart software přímo v centru?
- **Správa rozvrhu:** Změny rozvrhu (přidání/zrušení lekcí, změna instruktora) děláte vždy v Luxart softwaru a nový web je jen zobrazuje?
- **Statistiky:** Chcete ve webovém rozhraní vidět statistiky (návštěvnost lekcí, oblíbenost, výnosy), nebo to řeší Luxart?

---

*Prosíme o zodpovězení výše uvedených bodů, abychom mohli připravit detailní specifikaci a harmonogram vývoje.*
