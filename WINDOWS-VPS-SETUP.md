# Postawienie agenta na VPS z Windows Server

Cel: agent chodzi na serwerze sam, co noc, bez Twojej obecności.
Ścieżka: kod w repo Git → serwer instaluje narzędzia → klonuje repo →
konfiguruje sekrety → test ręczny → harmonogram co noc.

> Uwaga: na Windows nie ma „crona”. Odpowiednik to **Harmonogram zadań** (Task Scheduler).
> Robi dokładnie to samo — odpala agenta o wyznaczonej godzinie.

---

## Krok 0 — czego potrzebujesz pod ręką
- Dostęp do VPS przez **Pulpit zdalny (RDP)** (adres IP, login, hasło).
- **Klucz API Claude** — https://console.anthropic.com → API Keys (to płatne kredyty API, osobne od aplikacji).
- Login i hasło do panelu Shoper.
- Konto na **GitHub** lub **GitLab** (repozytorium może być prywatne).

---

## Krok 1 — wrzuć kod do repozytorium Git (na swoim komputerze)
Masz paczkę `bady-agent.zip`. Rozpakuj ją u siebie, potem:

```powershell
cd bady-agent
git init
git add .
git commit -m "Agent bady.pl -> Shoper"
# utwórz PRYWATNE repo na GitHub (np. bady-agent) i podłącz je:
git remote add origin https://github.com/TWOJ_LOGIN/bady-agent.git
git branch -M main
git push -u origin main
```

Plik `.env` NIE trafi do repo (jest w `.gitignore`) — i dobrze, tam są hasła.

---

## Krok 2 — połącz się z VPS i zainstaluj narzędzia
Zaloguj się przez **Podłączanie pulpitu zdalnego** (mstsc) na IP serwera.
Otwórz **PowerShell jako administrator** i zainstaluj Node.js i Git.

Jeśli serwer ma `winget` (Windows Server 2022/2025):
```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```

Jeśli nie ma `winget` — pobierz i zainstaluj ręcznie (kliknij „Dalej”):
- Node.js LTS: https://nodejs.org (wersja LTS, instalator .msi)
- Git: https://git-scm.com/download/win

Zamknij i otwórz PowerShell ponownie, sprawdź:
```powershell
node -v
npm -v
git --version
```

---

## Krok 3 — sklonuj repo na serwer
```powershell
cd C:\
git clone https://github.com/TWOJ_LOGIN/bady-agent.git
cd C:\bady-agent
```
Przy prywatnym repo Git poprosi o login — użyj **Personal Access Token** zamiast hasła
(GitHub → Settings → Developer settings → Personal access tokens → uprawnienie „repo”).

---

## Krok 4 — instalacja zależności i przeglądarki
```powershell
npm install
npx playwright install chromium
```
(Na Windows nie dajesz `--with-deps` — sterowniki są w paczce Playwrighta.)

---

## Krok 5 — konfiguracja sekretów (.env)
Skopiuj wzór i uzupełnij:
```powershell
copy .env.example .env
notepad .env
```
W `.env` wpisz: `ANTHROPIC_API_KEY`, `SHOPER_LOGIN`, `SHOPER_PASSWORD`,
oraz `HEADFUL=false` (serwer nie ma pulpitu do pokazywania okna — chodzi w tle).
Zostaw `MAX_PRODUCTS=3` na start.

---

## Krok 6 — test ręczny (zanim włączysz harmonogram)
```powershell
npm run once
```
To przetworzy **jeden** produkt. Obserwuj wypisywane logi. Częste potknięcia:
- **selektory panelu** (`TODO` w `src/panel.ts`) — jeśli agent nie trafia w pole,
  nagraj poprawne selektory: `npx playwright codegen https://sklep5452789.homesklep.pl/admin`;
- **logowanie z 2FA/CAPTCHA** — jeśli panel tego wymaga, automatyczny login się potknie;
  wtedy trzeba raz zapisać sesję (`storageState`) i ją wczytywać (napisz, dorobię).

Jak `npm run once` przejdzie i produkt pojawi się w panelu jako nieaktywny — gotowe do harmonogramu.

---

## Krok 7 — harmonogram co noc (Task Scheduler)
W repo jest `run.bat` — to on odpala agenta i zapisuje logi do `C:\bady-agent\logs`.

Najprościej z PowerShella (administrator). Zadanie o **3:00**, działa nawet gdy nikt niezalogowany:
```powershell
schtasks /Create ^
  /TN "BadyAgent" ^
  /TR "C:\bady-agent\run.bat" ^
  /SC DAILY /ST 03:00 ^
  /RU "NAZWA_UZYTKOWNIKA" /RP "HASLO_UZYTKOWNIKA" ^
  /RL HIGHEST /F
```
(`/RU` i `/RP` = konto Windows, na którym zadanie ma działać — dzięki temu odpala się
bez zalogowanej sesji.)

Albo klikając: **Harmonogram zadań → Utwórz zadanie** → Wyzwalacze: codziennie 3:00 →
Akcje: uruchom `C:\bady-agent\run.bat` → zaznacz „Uruchom niezależnie od tego, czy użytkownik jest zalogowany”.

Test zadania od razu (bez czekania do nocy):
```powershell
schtasks /Run /TN "BadyAgent"
```
Potem zajrzyj do `C:\bady-agent\logs\` — powinien być świeży log.

---

## Krok 8 — aktualizacje kodu w przyszłości
Gdy poprawimy agenta:
```powershell
cd C:\bady-agent
git pull
npm install
```

---

## Bezpieczeństwo (krótko)
- `.env` z hasłami zostaje TYLKO na serwerze, nigdy w repo.
- Klucz API i hasła traktuj jak hasła do banku — nie wklejaj ich w czat, maile, zrzuty.
- Trzymaj Windows i Node zaktualizowane; ogranicz dostęp RDP (firewall na zaufane IP).

---

## Od czego zacząć — skrót
1. Załóż prywatne repo i wypchnij kod (Krok 1).
2. Zdobądź klucz API Claude (Krok 0).
3. RDP na serwer → zainstaluj Node + Git (Krok 2).
4. `git clone` → `npm install` → `npx playwright install chromium` (Kroki 3–4).
5. `.env` z sekretami (Krok 5).
6. `npm run once` — test (Krok 6).
7. Task Scheduler na 3:00 (Krok 7).
