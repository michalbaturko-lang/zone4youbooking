# Zone4You — Specifikace funkcionality (na základě odpovědí klienta)

Datum: 2026-02-27
Verze: 1.1 (aktualizováno na základě upřesnění)

---

## 1. Přihlášení a registrace

| Požadavek | Rozhodnutí |
|-----------|-----------|
| Přihlášení přes nové rozhraní (login + heslo přes API Luxart) | **ANO** |
| Registrace nových klientů přes web | **NE** — registrace probíhá na recepci centra |
| Zapomenuté heslo — reset emailem | **ANO** — heslo se posílá mailem; přidat nápovědu |
| Přihlášení číslem karty v online rozhraní | **⚠️ UPŘESNIT** — vztah čísla karty a hesla není ještě zcela jasný |

### Poznámky k implementaci
- Login = email/jméno + heslo
- Fungování hesla ve vztahu k číslu karty — **nutné upřesnit s klientem**
- Funkce "Zapomenuté heslo" = odeslání stávajícího hesla na registrovaný email

---

## 2. Kredit a platby

| Požadavek | Rozhodnutí |
|-----------|-----------|
| Zobrazení kreditu v hlavičce (vedle jména) | **ANO** |
| Dobíjení kreditu online kartou | **ANO** |
| Platební brána | **Stripe** + Apple Pay + Google Pay |
| Kryptoplatby | **Fáze 2** |
| Minimální zůstatek pro rezervaci | **ANO** — musí mít dostatečný kredit (přesná částka — upřesnit) |
| Předdefinované částky | **ANO** — 500 Kč, 1 000 Kč, 2 000 Kč, 5 000 Kč, 10 000 Kč |
| Historie plateb / transakcí | **ANO** |

### Poznámky k implementaci
- Předdefinované částky jsou pevně dané v Kč: 500, 1 000, 2 000, 5 000, 10 000 Kč
- Stripe jako primární brána s podporou Apple Pay a Google Pay (jsou součástí Stripe)
- Krypto platby až ve Fázi 2
- **Čekáme na Stripe API klíče od klienta**

---

## 3. Rezervace lekcí

| Požadavek | Rozhodnutí |
|-----------|-----------|
| Strhávání kreditu | **Při rezervaci** — vrací se pouze při včasném zrušení |
| Ceny lekcí — zobrazovat u každé lekce | **ANO** — zobrazovat předem u každé lekce |
| Maximální počet rezervací najednou | **Není pevný limit** — omezeno dostatečným zůstatkem kreditu |
| Časový horizont rezervací | **48 hodin dopředu max** |
| Zrušení bez sankce | **Minimálně 4 hodiny před lekcí** |
| Storno poplatek za pozdní zrušení | **100 Kč** |
| Vrácení kreditu při včasném zrušení | **ANO** — plné vrácení |
| No-show (nedostavení se) | **⚠️ UPŘESNIT** — 100 Kč nebo 100 % ceny lekce? |

### Poznámky k implementaci
- Flow: Rezervace → stržení kreditu → pokud klient zruší min. 4 h předem → kredit zpět
- Pokud klient zruší méně než 4 h předem → poplatek 100 Kč
- No-show — **nutné vyjasnit s klientem**: 100 Kč nebo 100 % ceny lekce?
- Není limit na počet rezervací, ale klient musí mít dostatečný zůstatek kreditu

---

## 4. Čekací listina (waiting list)

| Požadavek | Rozhodnutí |
|-----------|-----------|
| Čekací listina | **ANO** |
| Chování při uvolnění místa | **Automatické zařazení** + notifikace emailem **a WhatsApp zprávou** |
| Max. počet lidí na čekací listině | **10** |

### Poznámky k implementaci
- Při uvolnění místa: automaticky přesunout prvního z čekací listiny → strhnout kredit → poslat email + WhatsApp
- WhatsApp zpráva je důležitá — uvolnění místa je časově kritické, email nemusí klient přečíst hned
- Pokud nemá dostatek kreditu, přeskočit na dalšího v pořadí

---

## 5. Profil klienta

| Požadavek | Rozhodnutí |
|-----------|-----------|
| Osobní údaje | **Prohlížení + doplnění** (ne úprava stávajících) |
| Změna hesla na webu | **NE** — heslo se nemění přes web |
| Historie lekcí (archiv) | **ANO** |
| Gamifikace (odznáčky, motivace) | **ANO — Fáze 2** |

### Poznámky k implementaci
- Profil je převážně read-only, klient může doplnit chybějící údaje
- Změny klíčových údajů (jméno, email) se řeší na recepci
- Gamifikace (odznáčky za aktivitu, motivační zprávy) bude součástí Fáze 2

---

## 6. Rozvrh a zobrazení

| Požadavek | Rozhodnutí |
|-----------|-----------|
| Denní + týdenní pohled | **ANO** — oba pohledy |
| Zobrazení instruktora + zástup | **ANO** |
| Obsazenost lekce | **Obojí** — přesný počet + barevný indikátor |
| Filtr podle instruktora | **ANO** |
| Oblíbené lekce | **ANO** |

---

## 7. Notifikace

| Požadavek | Rozhodnutí |
|-----------|-----------|
| Email — úspěšná rezervace | **ANO** |
| Email — zrušení rezervace | **ANO** |
| Email + WhatsApp — uvolnění z čekací listiny | **ANO** |
| Email — dobití kreditu | **ANO** |
| Připomenutí lekce | **Fáze 2** |
| Motivační zprávy (gamifikace) | **Fáze 2** (email + WhatsApp) |
| Kdo odesílá emaily | **Naše aplikace** (emailová služba typu Resend, SendGrid) |

### Poznámky k implementaci
- 4 typy emailových notifikací potvrzeny pro Fázi 1
- WhatsApp pro čekací listinu (Fáze 1) a motivační zprávy (Fáze 2)
- Emaily odesílá naše aplikace — potřebujeme emailovou službu (Resend, SendGrid apod.)

---

## 8. Speciální lekce

| Požadavek | Rozhodnutí |
|-----------|-----------|
| Reformer — jiná pravidla | **Stejná pravidla** (s drobnými odlišnostmi — upřesnit) |
| Soukromé lekce / PT | **Zatím NE** — případně v budoucnu |
| Jednorázový vstup online | **NE** |

---

## 9. Technické a provozní otázky

| Požadavek | Rozhodnutí |
|-----------|-----------|
| Doména booking.zone4you.cz | **⚠️ NEPOTVRZENO** |
| HTTPS certifikát | **⚠️ NEPOTVRZENO** |
| Mobilní aplikace vs. responsivní web | **Velmi vyladěný responsivní web** (žádná nativní app) |
| Starý memberzone.cz | **Ponechat paralelně** (alespoň na přechodné období) |
| Jazyky | **Čeština + angličtina** |

---

## 10. Administrace

| Požadavek | Rozhodnutí |
|-----------|-----------|
| Admin rozhraní přes Luxart | **ANO** — žádný vlastní admin panel |
| Správa rozvrhu přes Luxart | **ANO** — web pouze zobrazuje |
| Statistiky přes Luxart | **ANO** |

### Poznámky k implementaci
- Nestavíme admin panel — veškerá správa probíhá v Luxart softwaru
- Naše aplikace je čistě klientské rozhraní (read + reserve + pay)

---

## Otevřené body — nutné vyjasnit s klientem

### Kritické (blokují vývoj)
1. **No-show penalizace** — je to 100 Kč (jako pozdní zrušení) nebo 100 % ceny lekce?
2. **Stripe přístupy** — čekáme na API klíče od klienta

### Důležité (potřebné brzy)
3. **Minimální zůstatek kreditu** pro rezervaci — jaká je minimální částka?
4. **Heslo a číslo karty** — jak přesně funguje vztah mezi nimi?
5. **Doména** — potvrzení booking.zone4you.cz a nastavení DNS
6. **HTTPS certifikát** — je na serveru, nebo ho musíme řešit?

### Nekritické (lze řešit později)
7. **Reformer odlišnosti** — jaké přesně?
8. **WhatsApp Business API** — přístup a nastavení
9. **Gamifikace** — přesná pravidla pro odznáčky (kolik lekcí = jaký odznak)
