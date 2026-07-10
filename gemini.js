/* =========================================================================
 * HiperSkrypt — gemini.js
 * Warstwa wywołań Google Gemini API (JSON mode / structured output).
 * Bezpośredni fetch z przeglądarki (BYOK), bez proxy.
 * Format zweryfikowany z ai.google.dev (2026-07):
 *   POST /v1beta/models/{model}:generateContent
 *   nagłówek x-goog-api-key; generationConfig.responseMimeType +
 *   responseSchema; thinkingConfig.thinkingLevel (modele Gemini 3.x).
 *
 * Odporność:
 *   - przejściowe błędy (503/5xx, 429, sieć) → automatyczne ponowienie,
 *   - uporczywe przeciążenie modelu → automatyczne przejście na model
 *     zapasowy (HS.GEMINI_FALLBACK_MODELS),
 *   - każdy błąd niesie PEŁNĄ odpowiedź Google (błąd nie jest maskowany).
 * ========================================================================= */
(function (global) {
  'use strict';

  var API_BASE = 'https://generativelanguage.googleapis.com/v1beta/';

  function HSApiError(message, kind, detail) {
    var e = new Error(message);
    e.name = 'HSApiError';
    e.kind = kind || 'generic';
    e.detail = detail || '';
    return e;
  }

  function googleDetail(bodyText) {
    try {
      var j = JSON.parse(bodyText);
      if (j.error && j.error.message) return j.error.message;
    } catch (e) { /* noop */ }
    return '';
  }

  function httpErrorMessage(status, bodyText, model) {
    var detail = googleDetail(bodyText);
    var suffix = detail ? ' Odpowiedź Google: „' + detail + '”.' : '';
    if (status === 401 || status === 403) {
      return HSApiError('Klucz API został odrzucony (' + status + ').' + suffix +
        ' Sprawdź klucz w ustawieniach i uruchom „Test połączenia”.', 'auth', detail);
    }
    if (status === 400) {
      return HSApiError('Google odrzuciło zapytanie (400).' + suffix, 'badrequest', detail);
    }
    if (status === 404) {
      return HSApiError('Model „' + model + '” niedostępny dla Twojego klucza (404).' + suffix +
        ' Uruchom „Test połączenia” w ustawieniach, żeby zobaczyć dostępne modele.', 'model', detail);
    }
    if (status === 429) {
      return HSApiError('Limit zapytań wyczerpany (429) dla modelu ' + model + '.' + suffix, 'quota', detail);
    }
    if (status >= 500) {
      return HSApiError('Model ' + model + ' jest przeciążony (' + status + ').' + suffix, 'server', detail);
    }
    return HSApiError('Błąd API (' + status + ').' + suffix, 'http', detail);
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

  /* Parsowanie JSON z tolerancją (płoty ```json, przedrostki tekstu). */
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

  function getFetch() {
    if (typeof fetch === 'function') return fetch;
    return global.fetch;
  }

  /* Jedno surowe wywołanie generateContent dla konkretnego modelu. */
  function rawGenerate(model, opts) {
    var body = {
      system_instruction: { parts: [{ text: opts.system || '' }] },
      contents: [{ role: 'user', parts: [{ text: opts.user || '' }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: (opts.temperature != null ? opts.temperature : 0.9),
        /* Gemini 3.x: poziom rozumowania. Domyślnie "medium" — pełna
         * jakość myślenia (składnia REST zweryfikowana:
         * ai.google.dev/gemini-api/docs/thinking). */
        thinkingConfig: { thinkingLevel: opts.thinkingLevel || 'medium' }
      }
    };
    if (opts.schema) body.generationConfig.responseSchema = opts.schema;

    var doFetch = getFetch();
    return doFetch(API_BASE + 'models/' + model + ':generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': opts.apiKey
      },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) { throw httpErrorMessage(r.status, t, model); });
      }
      return r.json();
    }, function () {
      throw HSApiError('Brak połączenia z internetem albo zapytanie zostało zablokowane w sieci. Sprawdź połączenie.', 'network');
    }).then(function (data) {
      return parseJsonLoose(extractText(data));
    });
  }

  /* Główne wywołanie z ponowieniami i fallbackiem modeli.
   * opts: { apiKey, system, user, schema, temperature?, model?,
   *         thinkingLevel?, onRetry? }
   * Kolejność prób: [wybrany model ×(1+retry)] → [zapasowy 1] → [zapasowy 2]
   * Zwraca Promise<object>; obiekt ma _hsModel (użyty model) gdy fallback. */
  function call(opts) {
    if (!opts || !opts.apiKey) {
      return Promise.reject(HSApiError('Brak klucza API — dodaj go w ustawieniach.', 'auth'));
    }
    if (typeof getFetch() !== 'function') {
      return Promise.reject(HSApiError('Brak obsługi sieci w tym środowisku.', 'env'));
    }

    var primary = opts.model || global.HS.GEMINI_MODEL;
    var models = [primary];
    (global.HS.GEMINI_FALLBACK_MODELS || []).forEach(function (m) {
      if (models.indexOf(m) === -1) models.push(m);
    });

    var notify = opts.onRetry || HSGemini.onRetry;
    function tell(info) {
      if (typeof notify === 'function') {
        try { notify(info); } catch (e) { /* noop */ }
      }
    }

    var mi = 0;          // indeks modelu
    var attemptNo = 0;   // licznik prób na bieżącym modelu

    function next(lastErr) {
      /* wyczerpane modele → oddaj ostatni błąd (z detalem Google) */
      if (mi >= models.length) {
        if (lastErr && lastErr.kind === 'server') {
          lastErr.message = 'Wszystkie modele Gemini odpowiadają przeciążeniem. ' +
            lastErr.message + ' Odczekaj 1-2 minuty albo uruchom „Test połączenia” w ustawieniach.';
        }
        return Promise.reject(lastErr);
      }
      var model = models[mi];
      attemptNo++;

      return rawGenerate(model, opts).then(function (result) {
        if (model !== primary && result && typeof result === 'object' && !Array.isArray(result)) {
          result._hsModel = model; // informacja dla UI: użyto modelu zapasowego
        }
        HSGemini.lastGoodModel = model;
        return result;
      }).catch(function (err) {
        var transient = err && (err.kind === 'server' || err.kind === 'network');
        var switchable = err && (err.kind === 'server' || err.kind === 'quota' || err.kind === 'model');

        /* 1) ponów na tym samym modelu (raz), jeśli błąd przejściowy */
        if (transient && attemptNo <= HSGemini.RETRIES_PER_MODEL) {
          var wait = HSGemini.RETRY_DELAY_MS;
          tell({ type: 'retry', model: model, attempt: attemptNo + 1, wait: wait, kind: err.kind });
          console.warn('[HS] ' + model + ': ' + err.kind + ' — ponawiam za ' + wait + ' ms');
          return new Promise(function (res) { setTimeout(res, wait); })
            .then(function () { return next(err); });
        }

        /* 2) przełącz na następny model, jeśli to ma sens */
        if (switchable && mi < models.length - 1) {
          mi++;
          attemptNo = 0;
          tell({ type: 'fallback', model: models[mi], from: model, kind: err.kind });
          console.warn('[HS] ' + model + ' niedostępny (' + err.kind + ') — przechodzę na ' + models[mi]);
          return next(err);
        }

        /* 3) koniec — pokaż błąd z pełnym detalem Google */
        mi = models.length;
        return next(err);
      });
    }

    return next(null);
  }

  /* ------------------------------------------------------------------ */
  /* Diagnostyka: co widzi Twój klucz i co odpowiada Google              */
  /* Zwraca Promise<{keyOk, models[], chosenAvailable, genOk, genError,   */
  /*                 usedModel}> — nigdy nie rzuca.                       */
  /* ------------------------------------------------------------------ */
  function diagnose(apiKey, model) {
    var out = {
      keyOk: false, models: [], chosenAvailable: false,
      genOk: false, genError: '', usedModel: model || global.HS.GEMINI_MODEL
    };
    var doFetch = getFetch();
    if (!apiKey) { out.genError = 'Brak klucza API.'; return Promise.resolve(out); }

    /* 1) lista modeli dostępnych dla klucza */
    return doFetch(API_BASE + 'models?pageSize=50', {
      headers: { 'x-goog-api-key': apiKey }
    }).then(function (r) {
      if (!r.ok) {
        return r.text().then(function (t) {
          out.genError = 'Lista modeli: HTTP ' + r.status +
            (googleDetail(t) ? ' — „' + googleDetail(t) + '”' : '');
          return out;
        });
      }
      return r.json().then(function (data) {
        out.keyOk = true;
        out.models = (data.models || []).map(function (m) {
          return String(m.name || '').replace('models/', '');
        }).filter(function (n) { return n.indexOf('gemini') === 0; });
        out.chosenAvailable = out.models.indexOf(out.usedModel) >= 0;

        /* 2) minimalna generacja na wybranym modelu */
        return rawGenerate(out.usedModel, {
          apiKey: apiKey,
          system: 'Odpowiadasz wyłącznie poprawnym JSON.',
          user: 'Zwróć dokładnie: {"ok": true}',
          temperature: 0,
          thinkingLevel: 'minimal'
        }).then(function () {
          out.genOk = true;
          return out;
        }, function (e) {
          out.genError = e.message;
          return out;
        });
      });
    }, function () {
      out.genError = 'Nie udało się połączyć z generativelanguage.googleapis.com — sprawdź internet / blokady sieci (firewall, adblock).';
      return out;
    });
  }

  var HSGemini = {
    call: call,
    diagnose: diagnose,
    RETRIES_PER_MODEL: 1,      // ile ponowień na modelu przy 503/sieci
    RETRY_DELAY_MS: 1500,      // odstęp między ponowieniami
    onRetry: null,             // globalny hak dla UI
    lastGoodModel: null,
    _parseJsonLoose: parseJsonLoose,
    _extractText: extractText
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = HSGemini;
  }
  global.HSGemini = HSGemini;
})(typeof window !== 'undefined' ? window : globalThis);
