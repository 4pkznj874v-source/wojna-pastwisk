# Wojna Pastwisk

Grywalna wersja 1v1:

- telewizor lub komputer pokazuje wspólną planszę,
- dwa telefony działają jako prywatne kontrolery,
- komunikacja odbywa się w czasie rzeczywistym przez Socket.IO,
- tło gry: `public/assets/tlo.png`,
- muzyka: `public/assets/music.mp3`.

## Szybkie uruchomienie na jednej sieci Wi-Fi

Wymagany jest Node.js 20 lub nowszy.

```bash
npm install
npm start
```

Serwer wyświetli adres lokalny, np.:

```text
http://192.168.1.20:3000
```

1. Otwórz ten adres na telewizorze lub komputerze.
2. Wybierz **Ekran TV**.
3. Kliknij **Nowa wojna**.
4. Zeskanuj kod QR dwoma telefonami.
5. Każdy gracz wybiera stado i klika **Gotowy**.
6. Na telewizorze kliknij **Rozpocznij wojnę**.

Wszystkie urządzenia muszą być w tej samej sieci Wi-Fi. Zapora systemowa musi pozwalać Node.js na połączenia przychodzące.

## Własna muzyka

W paczce znajduje się jednosekundowy, cichy plik techniczny. Zastąp go własnym utworem, zachowując dokładną nazwę:

```text
public/assets/music.mp3
```

Muzyka uruchamia się po kliknięciu przycisku na ekranie TV, zgodnie z ograniczeniami autoplay w przeglądarkach.

## Publikacja przez GitHub i Render

GitHub przechowuje kod, ale GitHub Pages nie uruchamia serwera Socket.IO. Najprostszy wariant:

1. Utwórz repozytorium GitHub i wgraj wszystkie pliki projektu.
2. W Render wybierz **New Web Service**.
3. Połącz repozytorium.
4. Render wykryje `render.yaml` albo ustaw:
   - Build Command: `npm install`
   - Start Command: `npm start`
5. Po wdrożeniu otwórz publiczny adres Render na telewizorze.

## Najważniejsze pliki

```text
server.js                 logika meczu i synchronizacja
public/tv.html            ekran telewizora
public/tv.js              renderowanie planszy i animacji
public/player.html        kontroler telefonu
public/player.js          sterowanie gracza
public/styles.css         wygląd gry
public/assets/tlo.png     statyczne tło planszy
public/assets/music.mp3   muzyka w pętli
```

## Regulacja meczu

Najważniejsze wartości znajdują się na początku `server.js` w obiekcie `CONFIG`:

- długość meczu,
- HP baz,
- produkcja trawy,
- koszt owiec,
- ceny ulepszeń,
- cooldown katapulty.

## Zasady

- Słońce wpływa na tempo wzrostu trawy.
- Za trawę kupuje się owce.
- Futro rośnie automatycznie.
- Strzyżenie daje wełnę.
- Długość futra zwiększa masę, ale pogarsza aerodynamikę.
- Masa, futro, wiatr, pogoda, kąt i siła wpływają na lot.
- Wełna finansuje miksturę do trawy, szampon, katapultę i fortyfikacje.
- Wygrywa gracz, który zniszczy bazę przeciwnika albo ma więcej HP po upływie czasu.
