# Rozhodnutí k pilotu Zone4You — rezervace, storno a Reformer

**Předmět:** Zone4You booking — prosba o potvrzení 3 pravidel do 24 hodin

Dobrý den,

pro spuštění nového bookingového pilotu potřebujeme písemně potvrdit zbývající provozní pravidla. Minimální kredit klienta pro rezervaci už máme potvrzený na **200 Kč**. U běžné lekce také víme, že storno bez pokuty je možné do půlnoci; technicky to zapisujeme jako začátek dne lekce `00:00 Europe/Prague`, nikoli klouzavý počet hodin. Prosíme o odpověď přímo pod body níže:

1. **Rezervační okno**
   - V kolik a kolik kalendářních dnů před lekcí se rezervace **otevře**?
   - Kdy se rezervace **uzavře**?
   - Počítáme čas vždy v českém čase `Europe/Prague`.

   Prosíme o odpověď ve tvaru například: „Otevírá se v 00:00 sedm dnů před lekcí, uzavírá se začátkem lekce.“ Uvedený příklad není návrh pravidla, jen požadovaný formát odpovědi.

2. **Kredit při rezervaci**
   - Stačí pouze ověřit, že klient má zůstatek alespoň 200 Kč?
   - Nebo se při rezervaci zároveň konkrétní částka blokuje či strhává? Pokud ano, kolik Kč a kdy se vrací?

3. **Pozdní storno a Reformer**
   - Potvrďte prosím, že bezplatný cutoff běžné lekce je `00:00` na začátku dne lekce v českém čase.
   - Lze po tomto cutoffu online stornovat až do začátku lekce?
   - Jaký je poplatek za pozdní storno a za no-show?
   - Liší se kterákoli z těchto hodnot u Reformeru? Pokud ano, prosíme uvést přesně jak.
   - Vynucuje tato pravidla už Luxart API, nebo je musí před odesláním storna hlídat i nový booking?

   U Reformeru stačí odpovědět jedním z těchto přesných způsobů: „stejné jako běžná lekce“, nebo například „bezplatně do 24 hodin před začátkem, poté online storno není dovoleno, pozdní storno X Kč, no-show Y Kč“. Uvedené hodnoty jsou pouze ukázkou formátu, nikoli návrhem pravidla.

Historický čtyřhodinový cutoff je nově překonaný potvrzenou půlnocí. Historické částky 100 Kč / 100 Kč zatím nepovažujeme za schválené pro pilot. Implementace umí pro Reformer bezpečně rozlišit stejné pravidlo jako u skupinových lekcí i vlastní počet hodin před začátkem, poplatky a zákaz/povolení pozdního online storna. Jakmile obdržíme odpověď, doplníme skutečné hodnoty, uzamkneme jejich přesný hash v release konfiguraci a otestujeme je proti Luxart testovací databázi.

Bez tohoto potvrzení může běžet pouze bezpečný read-only rozvrh; živé vytvoření a storno rezervace zůstane vypnuté.

Děkuji.
