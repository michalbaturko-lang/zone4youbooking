# Scope of Work — Zone4You Online Booking System

**Projekt:** Nový rezervační systém pro Zone4You
**Klient:** Zone4You s.r.o.
**Dodavatel:** Michal Baturko
**Verze:** 1.1
**Datum:** 27. 2. 2026

---

## 1. Úvod a cíl projektu

Cílem projektu je vytvoření moderního online rezervačního systému pro fitness centrum Zone4You, který nahradí stávající řešení memberzone.cz. Nový systém bude napojen na stávající software Luxart a umožní klientům centra pohodlně si prohlížet rozvrh, rezervovat lekce, spravovat kredit a sledovat svou historii — vše v přehledném, velmi vyladěném responsivním webovém rozhraní dostupném z počítače i mobilního telefonu.

Důraz je kladen na kvalitní webový zážitek — systém nebude nativní mobilní aplikace, ale pečlivě navržený a optimalizovaný web, který bude fungovat bezchybně na všech zařízeních.

Systém bude dostupný v češtině a angličtině.

---

## 2. Fáze projektu

Projekt je rozdělen do dvou fází. **Fáze 1** pokrývá kompletní funkční rezervační systém. **Fáze 2** obsahuje rozšíření a doplňkové funkce (kryptoplatby, gamifikace, pokročilé notifikace).

---

## FÁZE 1 — Rezervační systém (MVP)

### Modul 1: Přihlášení a autentizace

**Co je možné vytvořit:**
- Přihlašovací stránku s loginem (email) a heslem napojenou na Luxart API
- Funkci "Zapomenuté heslo" — odeslání stávajícího hesla na registrovaný email
- Nápovědu na přihlašovací stránce (upřesníme po vyjasnění fungování hesla a čísla karty)
- Zabezpečenou session s automatickým odhlášením po nečinnosti
- Přepínání jazyka (CZ / EN)

**Otevřený bod:** Přesné fungování hesla ve vztahu k číslu karty — upřesníme s klientem.

**Termín:** Týden 1–2

---

### Modul 2: Rozvrh a zobrazení lekcí

**Co je možné vytvořit:**
- Denní pohled na rozvrh (výchozí zobrazení)
- Týdenní pohled na rozvrh
- Zobrazení detailu lekce: název, instruktor, čas, sál, cena, obsazenost
- Zobrazení náhradního instruktora / zástupu
- Indikátor obsazenosti — barevný (zelená/oranžová/červená) + přesný počet míst
- Filtrování podle sálu, typu lekce a instruktora
- Funkci "Oblíbené lekce" — klient si označí lekce a má k nim rychlý přístup

**Termín:** Týden 2–4

---

### Modul 3: Rezervace lekcí

**Co je možné vytvořit:**
- Rezervaci lekce jedním klikem z rozvrhu
- Stržení kreditu v momentě rezervace
- Kontrolu dostatečného zůstatku kreditu před rezervací (minimální zůstatek — upřesníme)
- Zrušení rezervace klientem s automatickým vrácením kreditu (při zrušení min. 4 hodiny předem)
- Poplatek za pozdní zrušení (méně než 4 hodiny předem) — **100 Kč**
- Penalizaci za no-show (nedostavení se) — **100 Kč**
- Omezení rezervací na 48 hodin dopředu
- Zobrazení seznamu aktivních rezervací klienta ("Moje rezervace")

**Termín:** Týden 3–5

---

### Modul 4: Čekací listina (Waiting List)

**Co je možné vytvořit:**
- Zápis na čekací listinu, když je lekce plně obsazena
- Automatické zařazení prvního čekajícího při uvolnění místa
- Automatické stržení kreditu při zařazení z čekací listiny
- Notifikaci o zařazení na lekci — **emailem i WhatsApp zprávou**
- Maximální kapacitu čekací listiny (10 osob)
- Zobrazení pozice klienta na čekací listině

**Termín:** Týden 5–6

---

### Modul 5: Kredit a platby (Stripe)

**Co je možné vytvořit:**
- Zobrazení aktuálního zůstatku kreditu v hlavičce stránky
- Předdefinované částky pro dobití: **500 Kč, 1 000 Kč, 2 000 Kč, 5 000 Kč, 10 000 Kč**
- Platební bránu Stripe s podporou platebních karet
- Platbu přes Apple Pay a Google Pay (součást Stripe)
- Historii transakcí a plateb (dobití, stržení za lekce, vrácení, storno poplatky)
- Zabezpečené platební flow (Stripe Checkout / Payment Intents)

**Termín:** Týden 5–7

---

### Modul 6: Profil klienta

**Co je možné vytvořit:**
- Zobrazení osobních údajů klienta (jméno, email, telefon, členství)
- Možnost doplnit chybějící údaje
- Historii navštívených lekcí (archiv)
- Přehled aktivního členství a jeho parametrů

**Termín:** Týden 6–7

---

### Modul 7: Notifikace (email + WhatsApp)

**Co je možné vytvořit:**
- Email při úspěšné rezervaci lekce
- Email při zrušení rezervace
- Email + WhatsApp při zařazení z čekací listiny na lekci
- Email při úspěšném dobití kreditu
- Profesionální emailové šablony v designu Zone4You (CZ + EN)
- WhatsApp zprávy pro časově kritické notifikace (čekací listina)

**Technické řešení:** Emaily odesílá naše aplikace (emailová služba typu Resend, SendGrid). WhatsApp přes WhatsApp Business API / Twilio.

**Termín:** Týden 7–8

---

### Modul 8: Lokalizace (CZ + EN)

**Co je možné vytvořit:**
- Kompletní rozhraní v češtině (výchozí jazyk)
- Kompletní rozhraní v angličtině
- Přepínání jazyka v hlavičce stránky
- Lokalizované emaily a WhatsApp zprávy v obou jazycích

**Termín:** Průběžně (paralelně s ostatními moduly)

---

### Shrnutí Fáze 1

| Modul | Obsah | Termín |
|-------|-------|--------|
| Modul 1 | Přihlášení a autentizace | Týden 1–2 |
| Modul 2 | Rozvrh a zobrazení lekcí | Týden 2–4 |
| Modul 3 | Rezervace lekcí | Týden 3–5 |
| Modul 4 | Čekací listina | Týden 5–6 |
| Modul 5 | Kredit a platby (Stripe) | Týden 5–7 |
| Modul 6 | Profil klienta | Týden 6–7 |
| Modul 7 | Notifikace (email + WhatsApp) | Týden 7–8 |
| Modul 8 | Lokalizace (CZ + EN) | Průběžně |

**Odhadovaná délka Fáze 1: 8 týdnů**

---

## FÁZE 2 — Rozšíření a doplňkové funkce

### Modul 9: Kryptoplatby

**Co je možné vytvořit:**
- Integraci platební brány pro kryptoměny (Bitcoin, Ethereum a další)
- Napojení na službu typu Coinbase Commerce nebo BTCPay Server
- Automatické přepočítání na Kč a připsání kreditu

**Termín:** Týden 9–10

---

### Modul 10: Gamifikace a motivační systém

**Co je možné vytvořit:**
- Systém odznáčků v profilu klienta (bronz / stříbro / zlato podle aktivity)
- Pravidla: např. 3 lekce za týden = bronzový odznak, 5 lekcí = stříbrný atd.
- Zobrazení aktuálního progressu v profilu ("Tento týden: 2/3 lekcí pro bronz")
- Proaktivní motivační zprávy (email, WhatsApp) typu:
  - "Máš tento týden 2 lekce, stačí ještě jedna na odznak!"
  - "Na zítřejší Spinning v 18:00 jsou ještě 3 volná místa — přidáš se?"
- Historii získaných odznáčků
- Nastavení preferencí (možnost vypnout motivační zprávy)

**Termín:** Týden 10–12

---

### Modul 11: Připomenutí lekcí

**Co je možné vytvořit:**
- Automatické připomenutí lekce emailem (např. 2 h nebo 24 h předem)
- WhatsApp připomenutí
- Nastavení preferencí připomenutí v profilu klienta

**Termín:** Týden 12–13

---

### Modul 12: Optimalizace a vyladění webu

**Co je možné vytvořit:**
- PWA (Progressive Web App) — možnost "přidat na plochu" telefonu
- Offline zobrazení rozvrhu (cache)
- Pokročilé statistiky pro klienta (počet návštěv za měsíc, oblíbené lekce, nejčastější instruktor)
- Optimalizace výkonu na základě reálného provozu

**Termín:** Týden 13–14

---

### Shrnutí Fáze 2

| Modul | Obsah | Termín |
|-------|-------|--------|
| Modul 9 | Kryptoplatby | Týden 9–10 |
| Modul 10 | Gamifikace a motivační systém | Týden 10–12 |
| Modul 11 | Připomenutí lekcí | Týden 12–13 |
| Modul 12 | Optimalizace a vyladění webu | Týden 13–14 |

**Odhadovaná délka Fáze 2: 6 týdnů**

---

## 3. Co NENÍ součástí projektu

- Administrační panel — veškerá správa (rozvrh, lekce, instruktoři, klienti) probíhá v softwaru Luxart
- Registrace nových klientů přes web — registrace probíhá na recepci centra
- Nativní mobilní aplikace (iOS / Android) — místo toho stavíme velmi vyladěný responsivní web
- Soukromé lekce / Personal Training — případně v budoucí fázi
- Jednorázové vstupy bez členství

---

## 4. Předpoklady a součinnost klienta

Pro úspěšnou realizaci projektu je potřeba součinnost klienta v těchto oblastech:

1. **Luxart API** — čekáme na přístup k API na portu 9759 a aktuální `/Help` dokumentaci
2. **Stripe účet** — API klíče (testovací i produkční) — **čekáme na klienta**
3. **Doména** — potvrzení a nastavení DNS pro booking.zone4you.cz
4. **HTTPS certifikát** — na serveru, kde poběží aplikace
5. **Grafické podklady** — logo, barvy, fonty (zajištěno z designu)
6. **Testování** — klient provede akceptační testování před spuštěním každé fáze
7. **Odpovědi na doplňující dotazy** — viz dokument s otevřenými body
8. **WhatsApp Business API** — přístup pro odesílání WhatsApp zpráv

---

## 5. Způsob dodání

- Zdrojový kód v Git repozitáři
- Nasazení na dohodnutý server / hosting
- Předání dokumentace k nasazení a provozu
- Zaškolení obsluhy (pokud bude potřeba)

---

## 6. Stávající systém (memberzone.cz)

Stávající systém memberzone.cz bude po dobu vývoje a přechodného období fungovat paralelně s novým systémem. Po úspěšném otestování a stabilizaci nového systému je možné starý systém odstavit — po dohodě s klientem.

---

*Tento dokument definuje rozsah prací na projektu Zone4You Online Booking System. Případné změny nebo rozšíření budou řešeny dodatkem k tomuto dokumentu.*
