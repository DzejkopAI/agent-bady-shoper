# Start: Claude Code na VPS

Od tego momentu pracujesz z agentem przez **Claude Code** (terminal) bezpośrednio na VPS.
Node.js jest już zainstalowany, repo sklonowane w `C:\APP-JD\bady-agent`.

## 1. Zainstaluj Claude Code (raz)
W PowerShell:
```
npm install -g @anthropic-ai/claude-code
claude --version
```
(Alternatywnie natywny instalator Windows — patrz docs.claude.com/en/docs/claude-code/setup.)

## 2. Wgraj aktualny stan repo
Ten pakiet (`bady-agent.zip`) zawiera najnowszy kod (prawdziwe selektory panelu),
`CLAUDE.md` (pamięć projektu, którą Code czyta sam) i `CHANGELOG.md`.
Rozpakuj go **na VPS, nadpisując** zawartość `C:\APP-JD\bady-agent`
(albo zrób to na swoim komputerze, `git push`, a na VPS `git pull`).

## 3. Uruchom Claude Code w repo
```
cd C:\APP-JD\bady-agent
claude
```
Przy pierwszym uruchomieniu Code poprosi o zalogowanie (otworzy przeglądarkę —
zaloguj się na swoje konto Claude) albo użyje `ANTHROPIC_API_KEY` ze środowiska.
Code automatycznie wczyta `CLAUDE.md`.

## 4. Pierwszy prompt do wklejenia w Claude Code
> Przeczytaj CLAUDE.md — to pamięć tego projektu. Następnie:
> 1) zrób `git add -A && git commit -m "v0.1.1: prawdziwe selektory panelu + CLAUDE.md"` i `git push`;
> 2) w `.env` ustaw `MAX_PRODUCTS=1` i `HEADFUL=true`;
> 3) odpal `npm start`, przeanalizuj log i napraw pierwszy błąd. Najbardziej prawdopodobne
>    miejsce to rozwijane Producent/Kategoria (`#producer` / `#category`) — do dobrania
>    selektora użyj `npx playwright codegen https://sklep5452789.homesklep.pl/admin`;
> 4) iteruj, aż produkt doda się w panelu jako NIEAKTYWNY;
> 5) po każdej działającej zmianie: wpis do CHANGELOG.md (podbij wersję), commit, push.

## Uwaga
- Sekrety trzymaj tylko w `.env` (jest w `.gitignore`) — nigdy w repo ani w promptach.
- Historia zmian ma lustro w Notion: „Changelog — Agent BADY→Shoper" (aktualizuj przy bumpie wersji).
