# HiperSkrypt

Aplikacja do pisania skryptów na Reels i TikToki — z pomocą AI (Google Gemini),
na Twoim własnym, darmowym kluczu API. Bez konta, bez serwera: wszystkie dane
zostają w Twojej przeglądarce.

> **Status:** wersja kompletna (Fazy 1–5). Trzy silniki skryptów, filtr
> anty-AI z automatyczną regeneracją, audyt retencji, biblioteka skryptów
> z wynikami i pętlą few-shot oraz eksport/import JSON.

---

## Jak wrzucić aplikację do internetu (GitHub Pages) — krok po kroku

Nie musisz umieć programować. Potrzebujesz tylko darmowego konta na GitHub.

### 1. Załóż konto na GitHub
1. Wejdź na [github.com](https://github.com) i kliknij **Sign up**.
2. Przejdź rejestrację (e-mail, hasło, nazwa użytkownika).

### 2. Utwórz repozytorium (czyli folder na pliki)
1. Po zalogowaniu kliknij zielony przycisk **New** (albo plus ➕ w prawym górnym rogu → **New repository**).
2. W polu **Repository name** wpisz np. `hiperskrypt`.
3. Zaznacz **Public**.
4. Kliknij **Create repository**.

### 3. Wgraj pliki aplikacji
1. Na stronie nowego repozytorium kliknij link **uploading an existing file**
   (albo **Add file → Upload files**).
2. Przeciągnij **wszystkie pliki z tego folderu** (m.in. `index.html`,
   `styles.css`, `app.js`, `core.js`, `winning-formats.json`) w okno przeglądarki.
3. Na dole kliknij zielony przycisk **Commit changes**.

### 4. Włącz GitHub Pages
1. W repozytorium kliknij zakładkę **Settings** (⚙️, na górze).
2. W menu po lewej wybierz **Pages**.
3. W sekcji **Build and deployment** → **Source** wybierz **Deploy from a branch**.
4. Poniżej wybierz branch **main** i folder **/(root)**, kliknij **Save**.
5. Po 1–2 minutach na górze pojawi się adres Twojej aplikacji, np.
   `https://twojanazwa.github.io/hiperskrypt/`. Gotowe! 🎉

---

## Jak zdobyć klucz Gemini API (darmowy, 2 minuty)

1. Wejdź na [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
   i zaloguj się swoim kontem Google.
2. Kliknij **Create API key**.
3. Skopiuj klucz (długi ciąg znaków).
4. Otwórz HiperSkrypt — przy pierwszym uruchomieniu aplikacja poprosi
   o wklejenie klucza. Wklej go i kliknij **Zapisz klucz i zaczynamy**.

**Prywatność:** klucz i wszystkie Twoje skrypty są zapisywane wyłącznie
w Twojej przeglądarce (localStorage). Nie ma żadnego serwera aplikacji —
klucz jest wysyłany tylko bezpośrednio do API Google, gdy generujesz tekst.

> Uwaga: jeśli wyczyścisz dane przeglądarki, klucz i zapisane skrypty znikną.
> Klucz zawsze możesz podejrzeć/utworzyć ponownie w Google AI Studio.

---

## Pliki w tym projekcie

| Plik                   | Do czego służy |
|------------------------|----------------|
| `index.html`           | Strona aplikacji (otwierasz ją w przeglądarce). |
| `styles.css`           | Wygląd (ciemny motyw domyślnie). |
| `core.js`              | Logika: liczenie czasu, walidacja struktury, prompty. |
| `gemini.js`            | Wywołania Google Gemini API (JSON mode). |
| `app.js`               | Obsługa interfejsu. |
| `winning-formats.json` | Biblioteka sprawdzonych formatów viralowych (uzupełniana ręcznie). |
| `DATA_MODEL.md`        | Dokumentacja techniczna modelu danych. |
| `tests/`               | Testy automatyczne (nie są potrzebne do działania aplikacji). |

## Jak uzupełniać bibliotekę formatów viralowych

1. W aplikacji: **Biblioteka → 📥 Importuj** — wskaż plik JSON z formatami.
2. Ręcznie: edytuj `winning-formats.json` w repo (schemat w `DATA_MODEL.md`),
   a przycisk **📤 Formaty** w bibliotece wyeksportuje aktualną paczkę
   dokładnie w tym formacie — gotową do wrzucenia z powrotem do repo.
3. Skrypty, którym w bibliotece ustawisz status **„działa”**, są automatycznie
   dodawane jako przykłady do kolejnych generacji tego samego silnika.
