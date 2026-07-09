/* =========================================================================
 * HiperSkrypt — gemini.js
 * Warstwa wywołań Google Gemini API (JSON mode / structured output).
 * Bezpośredni fetch z przeglądarki (BYOK), bez proxy.
 * Format requestu zweryfikowany 2026-07-08/09 z ai.google.dev:
 *   POST /v1beta/models/{model}:generateContent
 *   header x-goog-api-key, generationConfig.responseMimeType +
 *   generationConfig.responseSchema.
 * ========================================================================= */
(function (global) {
  'use strict';

  var API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

  function HSApiError(message, kind) {
    var e = new Error(message);
    e.name = 'HSApiError';
    e.kind = kind || 'generic';
    return e;
  }

  function httpErrorMessage(status, bodyText) {
    if (status === 400 || status === 401 || status === 403) {
      return HSApiError('Klucz API został odrzucony przez Google. Sprawdź w ustawieniach, czy klucz jest poprawny i aktywny.', 'auth');
    }
    if (status === 404) {
      return HSApiError('Model „' + global.HS.GEMINI_MODEL + '” nie został znaleziony — identyfikator modelu wymaga aktualizacji (stała HS.GEMINI_MODEL w core.js).', 'model');
    }
    if (status === 429) {
      return HSApiError('Przekroczony limit zapytań do Gemini (darmowa pula). Odczekaj chwilę i spróbuj ponownie.', 'quota');
    }
    if (status >= 500) {
      return HSApiError('Model Gemini jest teraz przeciążony (' + status + ') — ponowiłem próbę automatycznie, bez skutku. Odczekaj 1-2 minuty i kliknij „Spróbuj ponownie”.', 'server');
    }
    var detail = '';
    try {
      var j = JSON.parse(bodyText);
      if (j.error && j.error.message) detail = ' Szczegóły: ' + j.error.message;
    } catch (e) { /* noop */ }
    return HSApiError('Błąd API (' + status + ').' + detail, 'http');
  }

  /* Wyciąga tekst odpowiedzi z surowej struktury generateContent. */
  function extractText(data) {
    if (data && data.promptFeedback && data.promptFeedback.blockReason) {
      throw HSApiError('Gemini zablokowało to zapytanie (powód: ' + data.promptFeedback.blockReason + '). Zmień treść wywiadu i spróbuj ponownie.', 'blocked');
    }
    var cand = data && data.candidates && data.candidates[0];
    if (!cand || !cand.content || !Array.isArray(cand.content.parts)) {
      throw HSApiError('Pusta odpowiedź modelu — spróbuj ponownie.', 'empty');
    }
    var text = cand.content.parts.map(function (p) { return p.text || ''; }).join('');
    if (!text.trim()) {
      throw HSApiError('Model zwrócił pustą treść — spróbuj ponownie.', 'empty');
    }
    return text;
  }

  /* Parsowanie JSON z tolerancją: czysty JSON → parse; w razie czego
   * odcinamy płoty ```json i szukamy pierwszego { / [ …ostatniego } / ].
   * Gdy nic z tego — czytelny błąd (nigdy crash na białym ekranie). */
  function parseJsonLoose(text) {
    try { return JSON.parse(text); } catch (e) { /* dalej */ }

    var t = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    try { return JSON.parse(t); } catch (e) { /* dalej */ }

    var starts = [t.indexOf('{'), t.indexOf('[')].filter(function (i) { return i >= 0; });
    if (starts.length) {
      var i0 = Math.min.apply(null, starts);
      var i1 = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
      if (i1 > i0) {
        try { return JSON.parse(t.slice(i0, i1 + 1)); } catch (e) { /* dalej */ }
      }
    }
    throw HSApiError('Odpowiedź AI nie była poprawnym JSON i nie dała się naprawić. Spróbuj ponownie (fragment: „' +
      text.slice(0, 120).replace(/\s+/g, ' ') + '…”).', 'parse');
  }

  /* Główne wywołanie.
   * opts: { apiKey, system, user, schema, temperature?, model? }
   * Zwraca Promise<object> (sparsowany JSON) lub rzuca HSApiError. */
  function call(opts) {
    if (!opts || !opts.apiKey) {
      return Promise.reject(HSApiError('Brak klucza API — dodaj go w ustawieniach.', 'auth'));
    }
    var model = opts.model || global.HS.GEMINI_MODEL;
    var body = {
      system_instruction: { parts: [{ text: opts.system || '' }] },
      contents: [{ role: 'user', parts: [{ text: opts.user || '' }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: (opts.temperature != null ? opts.temperature : 0.9),
        /* Gemini 3.x to modele "myślące" — domyślny poziom medium potrafi
         * myśleć dziesiątki sekund. Dla krótkich zadań kreatywnych "low"
         * jest szybkie i wystarczające (składnia REST: thinkingConfig).
         * Zweryfikowano 2026-07-09: ai.google.dev/gemini-api/docs/thinking */
        thinkingConfig: { thinkingLevel: opts.thinkingLevel || 'low' }
      }
    };
    if (opts.schema) body.generationConfig.responseSchema = opts.schema;

    var doFetch = (typeof fetch === 'function') ? fetch : global.fetch;
    if (typeof doFetch !== 'function') {
      return Promise.reject(HSApiError('Brak obsługi sieci w tym środowisku.', 'env'));
    }

    /* Przejściowe błędy (503 przeciążenie, 5xx, limit 429, zrywy sieci)
     * ponawiamy automatycznie z odczekaniem, zanim pokażemy błąd. */
    var delays = HSGemini.RETRY_DELAYS; // ms między próbami
    var maxAttempts = delays.length + 1;

    function attempt(n) {
      return doFetch(API_BASE + model + ':generateContent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': opts.apiKey
        },
        body: JSON.stringify(body)
      }).then(function (r) {
        if (!r.ok) {
          return r.text().then(function (t) { throw httpErrorMessage(r.status, t); });
        }
        return r.json();
      }, function () {
        throw HSApiError('Brak połączenia z internetem albo zapytanie zostało zablokowane. Sprawdź sieć i spróbuj ponownie.', 'network');
      }).then(function (data) {
        return parseJsonLoose(extractText(data));
      }).catch(function (err) {
        var retryable = err && (err.kind === 'server' || err.kind === 'quota' || err.kind === 'network');
        if (retryable && n < maxAttempts) {
          var wait = delays[n - 1];
          var notify = opts.onRetry || HSGemini.onRetry;
          if (typeof notify === 'function') {
            try { notify({ attempt: n + 1, max: maxAttempts, wait: wait, kind: err.kind }); } catch (e) { /* noop */ }
          }
          console.warn('[HS] Gemini ' + err.kind + ' — ponawiam próbę ' + (n + 1) + '/' + maxAttempts + ' za ' + wait + ' ms');
          return new Promise(function (resolve) { setTimeout(resolve, wait); })
            .then(function () { return attempt(n + 1); });
        }
        throw err;
      });
    }

    return attempt(1);
  }

  var HSGemini = {
    call: call,
    RETRY_DELAYS: [1500, 4000],        // odstępy automatycznych ponowień (ms)
    onRetry: null,                     // globalny hak: UI może pokazać "ponawiam…"
    _parseJsonLoose: parseJsonLoose,   // eksport do testów
    _extractText: extractText
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = HSGemini;
  }
  global.HSGemini = HSGemini;
})(typeof window !== 'undefined' ? window : globalThis);
