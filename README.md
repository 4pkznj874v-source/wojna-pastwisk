# Wojna Pastwisk v2

Gra 1v1 działająca na jednym ekranie TV/komputera i dwóch telefonach. Serwer Node.js synchronizuje grę przez Socket.IO.

## Najważniejsze zasady v2

- maksymalnie 20 jednostek na gracza,
- baza ma 4600 HP - poprzednie 1600 HP + 3000 HP,
- jednostki: koza, owca i baran,
- koza kosztuje połowę ceny owcy, nie daje wełny i zadaje 70% jej obrażeń,
- baran kosztuje dwa razy więcej, zadaje dwa razy więcej obrażeń i daje tyle samo wełny,
- masa każdej jednostki jest losowana w realistycznym zakresie,
- długość futra wpływa na masę i aerodynamikę,
- każda wystrzelona jednostka jest bezpowrotnie tracona,
- trafiona jednostka zamienia się na ekranie TV w chmurkę odlatującą do nieba,
- rzeczywisty kąt i siła strzału dostają losowe odchylenie od -10% do +10%,
- wiatr jest silny i zmienia się często,
- wszystkie ulepszenia mechaniczne mają 5 poziomów,
- katapulta i budynki mają 3 wyraźne poziomy wizualne,
- każdą jednostkę można indywidualnie ulepszyć do poziomu 5,
- Warsztat Naprawczy automatycznie naprawia bazę, zużywając wełnę.

## Chwała

- +8 za kupienie nowej jednostki,
- -8 za wystrzelenie i utratę jednostki,
- +12 za każde 100 HP odebrane bazie przeciwnika,
- po upływie czasu wygrywa gracz z większą Chwałą; kolejne kryteria to HP bazy i zadane obrażenia.

## Pliki graficzne i audio

```text
public/assets/tlo.png          statyczne tło pola gry
public/assets/start-screen.png zaakceptowany ekran startowy
public/assets/music.mp3        muzyka odtwarzana w pętli
```

Bazy, katapulty, budynki, jednostki, lot, pogoda, chmurki i efekty są rysowane i animowane bezpośrednio w kodzie Canvas.

## Uruchomienie lokalne

Wymagany Node.js 20 lub nowszy.

```bash
npm install
npm start
```

Następnie otwórz adres pokazany w konsoli. Na Windows można użyć `START_WINDOWS.bat`.

## Aktualizacja istniejącej publikacji Render

1. Usuń lub nadpisz stare pliki w repozytorium GitHub zawartością tej paczki.
2. Zachowaj strukturę katalogów - `package.json` i `server.js` muszą być w katalogu głównym repozytorium.
3. W Render wybierz **Manual Deploy -> Deploy latest commit** albo poczekaj na automatyczny deploy.
4. Po komunikacie **Your service is live** odśwież stronę z pominięciem pamięci podręcznej: `Ctrl+F5`.

Render używa:

```text
Build Command: npm install
Start Command: npm start
Health Check: /health
```

## Główne pliki

```text
server.js                 logika gry i synchronizacja
public/index.html         ekran początkowy
public/tv.html            ekran telewizora
public/tv.js              renderowanie i animacje Canvas
public/player.html        kontroler telefonu
public/player.js          obsługa telefonu
public/styles.css         cały interfejs
```
