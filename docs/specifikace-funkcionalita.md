# Zone4You — Specifikace funkcionality (na základě odpovědí klienta)

Datum: 2026-02-27

---

## 1. Přihlášení a registrace

| Požadavek | Rozhodnutí |
|-----------|-----------|
| Přihlášení přes nové rozhraní (login + heslo přes API Luxart) | **ANO** |
| Registrace nových klientů přes web | **NE** — registrace pouze z recepce (PC v centru) |
| Zapomenuté heslo — reset emailem | **ANO** — heslo je neměnné, posílá se mailem; přidat nápovědu |
| Přihlášení číslem karty v online rozhraní | **NE** — číslo karty slouží jako heslo, nepoužívá se jako samostatný login na webu |

### Poznámky k implementaci
- Login = email/jméno + heslo (číslo karty)
- Funkce "Zapomenuté heslo" = odeslání stávajícího hesla na registrovaný email
- Na přihlašovací stránce zobrazit nápovědu typu "Vaše heslo je číslo vaší členské karty"

---

## 2. Kredit a platby

| Požadavek | Rozhodnutí |
|-----------|-----------|
| Zobrazení kreditu v hlavičce (vedle jména) | **ANO** |
| Dobíjení kreditu online kartou | **ANO** |
| Platební brána | **Stripe** + Apple Pay + Google Pay + krypto |
| Minimální/maximální částka pro dobití | **⚠️ NEZODPOVĚZENO** |
| Předdefinované částky | **ANO** — 1 h, 5 h, 10 h (odpovídající hodinové sazby) |
| Historie plateb / transakcí | **ANO** |

### Poznámky k implementaci
- Předdefinované částky v hodinách (1 h, 5 h, 10 h) — nutné zjistit cenu za hodinu pro přepočet na Kč
- Stripe jako primární brána s podporou Apple Pay a Google Pay (jsou součástí Stripe)
- Krypto platby — nutné upřesnit, jaká řešení klient preferuje (např. Coinbase Commerce, BTCPay)

---

## 3. Rezervace lekcí

| Požadavek | Rozhodnutí |
|-----------|-----------|
| Strhávání kreditu | **Při rezervaci** — vrací se pouze při včasném zrušení |
| Ceny lekcí — zobrazovat u každé lekce | **ANO** — zobrazovat předem u každé lekce |
| Maximální počet rezervací najednou | **Není pevný limit** — omezeno aktivním členstvím |
| Časový horizont rezervací | **48 hodin dopředu max** (upřesnit dle typu členství) |
| Zrušení bez sankce | **⚠️ UPŘESNIT** — klient uvedl 4 h i 24 h |
| Storno poplatek za pozdní zrušení | **ANO — 100 %** (kredit se nevrací) |
| Vrácení kreditu při včasném zrušení | **ANO** |
| No-show (nedostavení se) | **100 % stržení** — kredit se nevrací |

### Poznámky k implementaci
- Flow: Rezervace → stržení kreditu → pokud klient zruší včas → kredit zpět
- Pokud klient zruší pozdě nebo se nedostaví → kredit propadá
- Nutné vyjasnit: 4 hodiny NEBO 24 hodin pro bezplatné zrušení

---

## 4. Čekací listina (waiting list)

| Požadavek | Rozhodnutí |
|-----------|-----------|
| Čekací listina | **ANO** |
| Chování při uvolnění místa | **Automatické zařazení** + notifikace emailem |
| Max. počet lidí na čekací listině | **10** |

### Poznámky k implementaci
- Při uvolnění místa: automaticky přesunout prvního z čekací listiny → strhnout kredit → poslat email
- Pokud nemá dostatek kreditu, přeskočit na dalšího v pořadí

---

## 5. Profil klienta

| Požadavek | Rozhodnutí |
|-----------|-----------|
| Osobní údaje | **Prohlížení + doplnění** (ne úprava stávajících) |
| Změna hesla na webu | **NE** — heslo = číslo karty, nemění se přes web |
| Historie lekcí (archiv) | **ANO** |

### Poznámky k implementaci
- Profil je převážně read-only, klient může doplnit chybějící údaje
- Změny klíčových údajů (jméno, email) se řeší na recepci

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
| Email — uvolnění z čekací listiny | **ANO** |
| Email — dobití kreditu | **ANO** |
| Připomenutí lekce (email/SMS/push) | **⚠️ NEROZHODNUTO** |
| Kdo odesílá emaily (naše app / Luxart) | **⚠️ NEROZHODNUTO** |

### Poznámky k implementaci
- 4 typy emailových notifikací jsou potvrzeny
- Odesílání emailů — pokud naše app, potřebujeme SMTP (např. Resend, Mailgun, SendGrid)

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
| Mobilní aplikace vs. responsivní web | **Responsivní web** (app by byla super, ale stačí web) |
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
1. **Lhůta pro bezplatné zrušení** — 4 hodiny nebo 24 hodin? (klient uvedl oba údaje)
2. **Odesílání emailů** — naše aplikace (potřebujeme SMTP) nebo Luxart API?

### Důležité (potřebné brzy)
3. **Doména** — potvrzení booking.zone4you.cz a nastavení DNS
4. **HTTPS certifikát** — je na serveru, nebo ho musíme řešit?
5. **Předdefinované částky v Kč** — jaká je hodinová sazba pro přepočet 1 h / 5 h / 10 h?
6. **Krypto platby** — jaké konkrétní řešení? (Coinbase Commerce, BTCPay, jiné)

### Nekritické (lze řešit později)
7. **Připomenutí lekce** — email / SMS / push? Kolik hodin předem?
8. **Reformer odlišnosti** — jaké přesně?
9. **Členství a jeho vliv na rezervace** — jak přesně ovlivňuje max počet / horizont?
