# Zone4You Booking - demo scénář pro klienta

Datum: 2026-06-18

## Cíl prezentace

Ukázat klientovi, že nový booking už má reálnou produktovou podobu: rozvrh, detail lekce, přihlášení, kredit, rezervaci, storno, čekací listinu a dobíjení kreditu. Backend Luxart zatím běží v mock režimu, protože čekáme na aktuální `/Help` dokumentaci k API na portu 9759.

## Před prezentací

1. Použít aktuální Vercel Shareable Link z handoff zprávy. Shareable token neukládat do veřejného repozitáře.
2. Otevřít link ideálně v Chrome v novém okně.
3. Kliknout na `Reset demo`, aby prezentace začínala v čistém stavu.
4. Ověřit, že úvodní stav je odhlášený a v horní liště je tlačítko `Přihlásit`.
5. Pro jistotu projít rychlý smoke: přihlášení demo klienta, jedna rezervace, kontrola kreditu.

## Aktuální ověřený stav

- Preview běží jako Next.js aplikace na Vercelu za Shareable Linkem.
- Frontend volá vlastní `/api` BFF routes, ne přímo mock adapter.
- Chrome smoke ověřil načtení aplikace, čistý odhlášený start, login demo klienta a vytvoření rezervace.
- Serverless demo stav je izolovaný: nový návštěvník nezačíná s předchozím testovacím stavem.
- API snapshot na preview vrací 15 lekcí.

## Doporučený průchod

1. Otevřít úvodní obrazovku.
   - Zdůraznit, že jde o skutečnou Next.js aplikaci, ne statický HTML prototyp.
   - Ukázat stavové boxy: Flow připravené, Čekáme na Luxart, Stripe skeleton.

2. Rozvrh lekcí.
   - Přepnout Den / Týden.
   - Vyzkoušet filtr podle místnosti a typu lekce.
   - Ukázat cenu, obsazenost, instruktora a indikaci 48h rezervačního okna.

3. Detail lekce.
   - Otevřít lekci.
   - Ukázat fotku instruktora, popis, cenu, čas, sál a storno pravidla.

4. Přihlášení.
   - Kliknout na Přihlásit.
   - Použít demo klienta.
   - Vysvětlit, že produkčně se tato část přepne na Luxart `api/Login`.

5. Rezervace.
   - Rezervovat lekci s volnou kapacitou.
   - Ukázat snížení kreditu a stav Rezervováno.

6. Moje rezervace.
   - Přejít do Rezervace.
   - Ukázat aktivní rezervaci a čekací listinu.
   - Zrušit rezervaci a ukázat vrácení kreditu podle pravidla 4 h / 100 Kč.

7. Čekací listina.
   - Otevřít plnou lekci.
   - Zapsat klienta na waiting list.
   - Ukázat pozici klienta a vysvětlit budoucí email/WhatsApp notifikaci.

8. Kredit a platby.
   - Přejít do Kredit.
   - Dobít 500 Kč.
   - Ukázat historii transakcí.
   - Vysvětlit, že v produkci Stripe webhook zavolá Luxart `POST api/Payment` s `Uuid=KREDIT`.

## Co říkat k Luxartu

- UI a flow jsou připravené proti adapteru.
- Nyní čekáme na aktuální dokumentaci a přístup k API na portu 9759.
- Jakmile Luxart pošle `/Help`, nemění se celé UI, ale implementuje se reálný `LuxartAdapter`.
- Potřebujeme potvrdit hlavně endpointy pro Lesson, Reservations, Cancel a Waitlist.

## Co neprezentovat jako hotové

- Není to produkční backend.
- Stripe je zatím mock/skeleton bez reálných klíčů.
- Emaily/WhatsApp nejsou zapnuté produkčně, dokud nebude potvrzené, zda je posílá Luxart nebo naše aplikace.
- Login používá demo klienta, produkční login čeká na aktuální Luxart API.
