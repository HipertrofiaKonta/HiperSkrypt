# HiperSkrypt — model danych (localStorage)

Wszystkie dane użytkownika żyją wyłącznie w `localStorage` przeglądarki.
Wyjątek: `winning-formats.json` — plik w repo, pobierany fetch-em przy starcie
(kopia lokalna + importy użytkownika trafiają do `hs_winningFormats`).

Wersja schematu: `1` (pole `_v` w każdym kluczu złożonym).

## Klucze localStorage

| Klucz               | Typ      | Opis |
|---------------------|----------|------|
| `hs_apiKey`         | string   | Klucz Google Gemini użytkownika (BYOK). Nigdy nie opuszcza przeglądarki poza wywołaniami do API Google. |
| `hs_settings`       | object   | Ustawienia aplikacji (patrz niżej). |
| `hs_scriptLibrary`  | object   | Biblioteka zapisanych skryptów. |
| `hs_winningFormats` | object   | Lokalna kopia biblioteki formatów (merge: repo + importy użytkownika). |
| `hs_draft`          | object   | Bieżący, niezapisany skrypt roboczy (autozapis edytora). |

## `hs_settings`

```json
{
  "_v": 1,
  "theme": "dark",            // "dark" | "light"
  "targetSeconds": 40,         // domyślna długość docelowa skryptu (s)
  "wps": 2.3                   // słów na sekundę dla języka polskiego
}
```

## Skrypt (element `hs_scriptLibrary.scripts[]` oraz `hs_draft.script`)

```json
{
  "_v": 1,
  "id": "s_k3j9x…",           // unikalny id
  "engine": "merytoryczny",    // "viral" | "merytoryczny" | "konwertujacy"
  "createdAt": "2026-07-08T10:00:00.000Z",
  "updatedAt": "2026-07-08T10:05:00.000Z",
  "status": "szkic",           // "szkic" | "nagrany" | "opublikowany" | "działa" | "nie działa"
  "title": "…",                // tytuł roboczy (np. temat z wywiadu)
  "interview": { },            // odpowiedzi z wywiadu danego silnika (kształt zależny od silnika)
  "targetSeconds": 40,
  "blocks": [
    { "id": "b_…", "type": "Hook", "text": "…" }
  ],
  "results": {                 // wyniki po publikacji — edytowalne w bibliotece
    "views": null,             // liczba wyświetleń
    "retention": null,         // retencja %
    "profileVisits": null,     // wejścia na profil
    "conversions": null        // konwersje (zapytania/klienci)
  },
  "final": null                // wynik kroku 3: { teleprompter, shotList, overlays } lub null
}
```

Typy bloków: `Hook`, `Primer`, `Super Hook`, `Tip`, `Rozwinięcie`, `Rehook`,
`Ekspert`, `CTA`, `Inny`.

### Pętla few-shot
Skrypty ze statusem `"działa"` są automatycznie doklejane jako przykłady
few-shot do promptów **tego samego silnika** przy kolejnych generacjach.

## `hs_scriptLibrary`

```json
{ "_v": 1, "scripts": [ /* Skrypt[] */ ] }
```

## `hs_winningFormats` (i plik `winning-formats.json`)

```json
{
  "_v": 1,
  "formats": [
    {
      "id": "f_…",
      "name": "Nazwa formatu",
      "structure": ["Hook", "Primer", "…"],   // struktura bloków
      "example": "…",                          // przykład użycia
      "retentionMechanic": "…",                // mechanika retencji
      "results": "…"                           // osiągane wyniki
    }
  ]
}
```

Przy starcie aplikacja robi `fetch('winning-formats.json')` i scala z kopią
lokalną (rekordy z repo nadpisują lokalne o tym samym `id`; importy/nadpisania
użytkownika z innymi `id` zostają).

## Stała modelu Gemini

Identyfikator modelu trzymany jest w **jednej** stałej `HS.GEMINI_MODEL`
w `core.js`. Aktualna wartość: `gemini-3.5-flash` — zweryfikowana 2026-07-08
z ai.google.dev/gemini-api/docs/models (stabilny model Flash, GA).
Wywołania: POST `/v1beta/models/{model}:generateContent`, klucz w nagłówku
`x-goog-api-key`, JSON mode przez `generationConfig.responseMimeType`
+ `responseSchema` (warstwa: `gemini.js`).
