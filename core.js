/* =========================================================================
 * HiperSkrypt — core.js  (v0.2 — Faza 2)
 * Czysta logika (bez DOM). Działa w przeglądarce (window.HS) i w Node
 * (module.exports). Model danych: patrz DATA_MODEL.md.
 * ========================================================================= */
(function (global) {
  'use strict';

  var HS = {};

  HS.VERSION = '0.5.0';
  HS.SCHEMA_V = 1;

  /* Identyfikator modelu Gemini — JEDNA stała do aktualizacji.
   * Zweryfikowano 2026-07-08 z ai.google.dev/gemini-api/docs/models:
   * aktualny, stabilny (GA) model Flash. */
  HS.GEMINI_MODEL = 'gemini-3.5-flash';

  /* Modele zapasowe: gdy główny model odpowiada uporczywym 503
   * (przeciążenie) lub 429, aplikacja automatycznie próbuje kolejnych.
   * Starsze modele Flash są mniej oblegane. */
  HS.GEMINI_FALLBACK_MODELS = ['gemini-3-flash-preview', 'gemini-2.5-flash'];

  /* ------------------------------------------------------------------ */

  HS.WPS_DEFAULT = 2.3;           // słów na sekundę (język polski)
  HS.SOFT_WARN_SECONDS = 55;      // miękkie ostrzeżenie licznika czasu
  HS.DEFAULT_TARGET_SECONDS = 40; // domyślna długość docelowa

  HS.STORAGE_KEYS = {
    apiKey:   'hs_apiKey',
    settings: 'hs_settings',
    library:  'hs_scriptLibrary',
    formats:  'hs_winningFormats',
    draft:    'hs_draft'
  };

  HS.ENGINES = {
    viral: {
      id: 'viral', name: 'Viral', icon: '🔥',
      desc: 'Maksymalny zasięg i wejścia na profil. AI adaptuje sprawdzony format z biblioteki do Twojej niszy.'
    },
    merytoryczny: {
      id: 'merytoryczny', name: 'Merytoryczny', icon: '🎓',
      desc: 'Edukacja, która trzyma uwagę. Stała struktura: Hook → Primer → Tipy z rozwinięciem → Rehooki → CTA.'
    },
    konwertujacy: {
      id: 'konwertujacy', name: 'Konwertujący', icon: '🎯',
      desc: 'Sprzedaż usługi obecnym obserwującym. Dwa frameworki sprzedażowe do wyboru.'
    }
  };

  HS.BLOCK_TYPES = [
    'Hook', 'Primer', 'Super Hook', 'Tip', 'Rozwinięcie',
    'Rehook', 'Ekspert', 'CTA', 'Inny'
  ];

  HS.SALES_BLOCK_TYPES = ['Problem', 'Agitacja', 'Mechanizm', 'Obiekcja', 'Reframe', 'Dowód', 'CTA'];

  HS.MERYT_BLOCK_ENUM = ['Hook', 'Primer', 'Super Hook', 'Tip', 'Rozwinięcie', 'Rehook', 'Ekspert', 'CTA'];

  HS.SCRIPT_STATUSES = ['szkic', 'nagrany', 'opublikowany', 'działa', 'nie działa'];

  /* ------------------------------------------------------------------ */
  /* Wywiady per silnik (krok 0)                                          */
  /* ------------------------------------------------------------------ */

  HS.INTERVIEWS = {
    merytoryczny: [
      { id: 'topic', label: 'Temat materiału', type: 'textarea', required: true,
        placeholder: 'Np. „Dlaczego trening siłowy 2× w tygodniu wystarczy po 40-tce”' },
      { id: 'level', label: 'Poziom wiedzy widza', type: 'select', required: true,
        options: ['początkujący', 'średniozaawansowany', 'zaawansowany'] },
      { id: 'takeaway', label: 'JEDNA rzecz, którą widz ma zapamiętać', type: 'textarea', required: true,
        placeholder: 'Np. „Konsekwencja bije intensywność”' }
    ],
    viral: [
      { id: 'niche', label: 'Twoja nisza', type: 'text', required: true,
        placeholder: 'Np. „trening personalny dla mężczyzn 40+”' },
      { id: 'angle', label: 'Temat / kąt materiału', type: 'textarea', required: true,
        placeholder: 'Np. „najczęstszy błąd na siłowni”' }
    ],
    konwertujacy: [
      { id: 'service', label: 'Usługa, którą sprzedajesz', type: 'text', required: true,
        placeholder: 'Np. „prowadzenie online z konsultacjami video”' },
      { id: 'avatar', label: 'Awatar klienta (do kogo mówisz)', type: 'textarea', required: true,
        placeholder: 'Np. „mężczyzna 35–45, pracuje za biurkiem, brak czasu”' },
      { id: 'objection', label: 'GŁÓWNA obiekcja blokująca zakup (obowiązkowe)', type: 'textarea', required: true,
        placeholder: 'Np. „nie mam czasu na treningi 4× w tygodniu”' },
      { id: 'framework', label: 'Framework sprzedażowy', type: 'select', required: true,
        options: ['problem → agitacja → mechanizm → CTA', 'obiekcja → reframe → dowód → CTA'] }
    ]
  };

  /* ------------------------------------------------------------------ */
  /* Narzędzia                                                           */
  /* ------------------------------------------------------------------ */

  HS.uid = function (prefix) {
    return (prefix || 'x') + '_' +
      Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  };

  HS.countWords = function (text) {
    if (!text || typeof text !== 'string') return 0;
    var m = text.trim().match(/\S+/g);
    return m ? m.length : 0;
  };

  HS.secondsForWords = function (words, wps) {
    var rate = (typeof wps === 'number' && wps > 0) ? wps : HS.WPS_DEFAULT;
    return words / rate;
  };

  HS.secondsForText = function (text, wps) {
    return HS.secondsForWords(HS.countWords(text), wps);
  };

  /* Do 120 s → "X s" (naturalne dla short-formów), powyżej → "m:ss". */
  HS.formatSeconds = function (seconds) {
    var s = Math.round(seconds || 0);
    if (s <= 120) return s + ' s';
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  };

  HS.scriptStats = function (blocks, wps) {
    var words = 0;
    (blocks || []).forEach(function (b) { words += HS.countWords(b.text); });
    return { words: words, seconds: HS.secondsForWords(words, wps) };
  };

  /* ------------------------------------------------------------------ */
  /* Fabryki obiektów                                                    */
  /* ------------------------------------------------------------------ */

  HS.defaultSettings = function () {
    return {
      _v: HS.SCHEMA_V,
      theme: 'dark',
      targetSeconds: HS.DEFAULT_TARGET_SECONDS,
      wps: HS.WPS_DEFAULT
    };
  };

  HS.newBlock = function (type, text) {
    return { id: HS.uid('b'), type: type || 'Inny', text: text || '' };
  };

  HS.newScript = function (engineId, targetSeconds) {
    return {
      _v: HS.SCHEMA_V,
      id: HS.uid('s'),
      engine: engineId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'szkic',
      title: '',
      interview: {},
      targetSeconds: targetSeconds || HS.DEFAULT_TARGET_SECONDS,
      blocks: [],
      results: { views: null, retention: null, profileVisits: null, conversions: null },
      final: null
    };
  };

  HS.emptyLibrary = function () { return { _v: HS.SCHEMA_V, scripts: [] }; };
  HS.emptyFormats = function () { return { _v: HS.SCHEMA_V, formats: [] }; };

  HS.mergeFormats = function (repoData, localData) {
    var out = HS.emptyFormats();
    var seen = {};
    var repo = (repoData && Array.isArray(repoData.formats)) ? repoData.formats : [];
    var local = (localData && Array.isArray(localData.formats)) ? localData.formats : [];
    repo.forEach(function (f) {
      if (f && f.id && !seen[f.id]) { seen[f.id] = true; out.formats.push(f); }
    });
    local.forEach(function (f) {
      if (f && f.id && !seen[f.id]) { seen[f.id] = true; out.formats.push(f); }
    });
    return out;
  };

  HS.looksLikeApiKey = function (key) {
    if (!key || typeof key !== 'string') return false;
    var k = key.trim();
    if (k.length < 20) return false;
    if (/\s/.test(k)) return false;
    if (/^https?:\/\//i.test(k)) return false;
    return true;
  };

  /* ------------------------------------------------------------------ */
  /* Walidacja struktury — silnik merytoryczny                            */
  /* ------------------------------------------------------------------ */

  HS.validateMerytoryczny = function (blocks) {
    var issues = [];
    var b = blocks || [];
    if (b.length === 0) { return ['Skrypt jest pusty.']; }

    var types = b.map(function (x) { return x.type; });

    if (types[0] !== 'Hook') {
      issues.push('Pierwszy blok powinien być Hookiem (jest: ' + types[0] + ').');
    }
    if (types.length > 1 && types[0] === 'Hook' && types[1] !== 'Primer') {
      issues.push('Po Hooku powinien być Primer (jest: ' + types[1] + ').');
    }
    if (types[types.length - 1] !== 'CTA') {
      issues.push('Ostatni blok powinien być CTA (jest: ' + types[types.length - 1] + ').');
    }
    if (types.indexOf('Tip') === -1) {
      issues.push('Brakuje bloków Tip — to serce skryptu merytorycznego.');
    }
    if (types.indexOf('Ekspert') === -1) {
      issues.push('Brakuje bloku Ekspert (walidacja: skąd to wiesz).');
    }

    types.forEach(function (t, i) {
      if (t === 'Super Hook' && types[i + 1] !== 'Primer') {
        issues.push('Super Hook (blok ' + (i + 1) + ') powinien być od razu podbity Primerem.');
      }
      if (t === 'Tip' && types[i + 1] !== 'Rozwinięcie') {
        issues.push('Tip (blok ' + (i + 1) + ') powinien mieć zaraz po sobie Rozwinięcie.');
      }
    });

    /* Kadencja rehooków: po każdych 2 tipach powinien pojawić się Rehook,
     * zanim zacznie się kolejny (3.) tip. */
    var tipsSinceRehook = 0;
    var totalTips = 0;
    types.forEach(function (t, i) {
      if (t === 'Tip') {
        totalTips++;
        tipsSinceRehook++;
        if (tipsSinceRehook > 2) {
          issues.push('Za długo bez Rehooka: przed tipem nr ' + totalTips +
            ' (blok ' + (i + 1) + ') powinien pojawić się Rehook (kadencja: co ~2 tipy).');
          tipsSinceRehook = 1;
        }
      }
      if (t === 'Rehook') tipsSinceRehook = 0;
    });

    var iEks = types.lastIndexOf('Ekspert');
    var iCta = types.lastIndexOf('CTA');
    if (iEks !== -1 && iCta !== -1 && iEks > iCta) {
      issues.push('Blok Ekspert powinien wystąpić przed końcowym CTA.');
    }

    return issues;
  };

  /* ------------------------------------------------------------------ */
  /* Teleprompter — deterministycznie z bloków                            */
  /* ------------------------------------------------------------------ */

  HS.blockLabels = function (blocks) {
    var counts = {};
    (blocks || []).forEach(function (b) { counts[b.type] = (counts[b.type] || 0) + 1; });
    var seen = {};
    return (blocks || []).map(function (b) {
      seen[b.type] = (seen[b.type] || 0) + 1;
      return b.type + (counts[b.type] > 1 ? ' ' + seen[b.type] : '');
    });
  };

  HS.buildTeleprompter = function (blocks) {
    var labels = HS.blockLabels(blocks);
    return (blocks || []).map(function (b, i) {
      return '//' + labels[i] + '\n' + (b.text || '').trim();
    }).join('\n\n');
  };

  /* ------------------------------------------------------------------ */
  /* Zakazane konstrukcje "AI-polszczyzny" (detektor — Faza 3)            */
  /* ------------------------------------------------------------------ */

  HS.BAN_LIST_TEXT = [
    '„w dzisiejszych czasach”',
    '„warto pamiętać”, „warto zauważyć” i inne „warto + bezokolicznik”',
    '„co więcej”',
    '„podsumowując”',
    'konstrukcja „nie tylko X, ale też/także Y”',
    '„kluczowy”, „kluczem jest”',
    '„zanurz się”, „odkryj”',
    'nadmiar pytań retorycznych (max 1 na cały skrypt)',
    'wielokrotnie złożone, ciągnące się zdania — pisz krótko, jak w mowie',
    'podejrzanie równoległe wyliczenia trzech elementów („szybko, tanio i skutecznie”)',
    'nadużywanie dwukropków i myślników',
    'zaczynanie kolejnych zdań tym samym schematem składniowym'
  ];

  /* ------------------------------------------------------------------ */
  /* Prompty i schematy JSON (Gemini structured output)                   */
  /* ------------------------------------------------------------------ */

  function banText() {
    return 'BEZWZGLĘDNY ZAKAZ konstrukcji brzmiących jak AI:\n- ' +
      HS.BAN_LIST_TEXT.join('\n- ');
  }

  function wordBudget(targetSeconds, wps) {
    var w = Math.round(targetSeconds * (wps || HS.WPS_DEFAULT));
    return 'Budżet długości: cały tekst mówiony ok. ' + w + ' słów (±10%), ' +
      'czyli ~' + targetSeconds + ' s przy tempie ' + (wps || HS.WPS_DEFAULT) + ' słowa/s.';
  }

  HS.PROMPTS = {

    system: function (engineId, targetSeconds, wps) {
      return [
        'Jesteś scenarzystą krótkich wideo (Instagram Reels / TikTok). Piszesz WYŁĄCZNIE po polsku.',
        'Piszesz tekst MÓWIONY — do przeczytania na głos do kamery. Krótkie zdania. Naturalny język.',
        'Styl neutralny tonalnie: bez osobowości, bez manier — ton i charakter doda człowiek przy nagraniu.',
        banText(),
        wordBudget(targetSeconds, wps),
        'Odpowiadasz WYŁĄCZNIE poprawnym JSON zgodnym z podanym schematem. Bez markdown, bez komentarzy.'
      ].join('\n\n');
    },

    merytHooksUser: function (interview) {
      return [
        'SILNIK: merytoryczny/edukacyjny. Cel: widz zostaje do końca i wynosi konkretną wiedzę.',
        'Temat: ' + interview.topic,
        'Poziom wiedzy widza: ' + interview.level,
        'Jedna rzecz do zapamiętania: ' + interview.takeaway,
        '',
        'Zadanie: napisz DOKŁADNIE 3 różne hooki otwierające wideo (każdy max 2 zdania, max ~15 słów).',
        'Każdy hook ma używać INNEJ mechaniki retencji (np. luka informacyjna, kontrowersja/odwrócenie przekonania, konkret liczbowy, błąd który popełnia widz).',
        'Do każdego hooka dodaj "rationale": 1 zdanie po polsku — jaka mechanika retencji i dlaczego zadziała na tę grupę.'
      ].join('\n');
    },

    merytHooksSchema: {
      type: 'object',
      properties: {
        hooks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              rationale: { type: 'string' }
            },
            required: ['text', 'rationale']
          }
        }
      },
      required: ['hooks']
    },

    merytScriptUser: function (interview, chosenHook, fewShots) {
      var out = [
        'SILNIK: merytoryczny/edukacyjny.',
        'Temat: ' + interview.topic,
        'Poziom wiedzy widza: ' + interview.level,
        'Jedna rzecz do zapamiętania (musi wybrzmieć w skrypcie): ' + interview.takeaway,
        '',
        'WYBRANY HOOK (użyj go jako pierwszego bloku "Hook"; możesz minimalnie wygładzić, nie zmieniaj sensu):',
        chosenHook,
        '',
        'STRUKTURA BLOKÓW — obowiązkowa, dokładnie w tej kolejności:',
        '1. Hook (wybrany wyżej)',
        '2. Primer (co widz zyska, jeśli zostanie — 1-2 zdania)',
        '3. opcjonalnie: Super Hook → Primer (możesz powtórzyć, jeśli temat tego wymaga)',
        '4. Tip → Rozwinięcie (każdy tip od razu rozwinięty: jak i dlaczego działa)',
        '5. Rehook po każdych 2 tipach (zatrzymuje widza: zapowiedź, że dalej jest więcej)',
        '6. Ekspert (walidacja: 1-2 zdania — skąd to wiesz / doświadczenie, bez chwalenia się)',
        '7. CTA (jedno konkretne wezwanie do działania) — ostatni blok',
        '',
        'Liczba tipów: dobierz do budżetu długości (zwykle 2-3 przy 40 s).'
      ];
      if (fewShots) {
        out.push('', 'PRZYKŁADY SKRYPTÓW, KTÓRE ZADZIAŁAŁY (wzoruj się na rytmie i konkrecie, nie kopiuj treści):', fewShots);
      }
      return out.join('\n');
    },

    merytScriptSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        blocks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: HS.MERYT_BLOCK_ENUM },
              text: { type: 'string' }
            },
            required: ['type', 'text']
          }
        }
      },
      required: ['blocks']
    },

    salesScriptUser: function (interview, fewShots) {
      var fw = interview.framework || '';
      var isPAMC = fw.indexOf('problem') === 0;
      var structure = isPAMC
        ? ['1. Problem (nazwij problem awatara jego językiem)',
           '2. Agitacja (co się dzieje, jeśli nic nie zmieni — konkretnie, bez straszenia)',
           '3. Mechanizm (jak Twoja usługa rozwiązuje problem — co jest inne)',
           '4. CTA (jedno wezwanie: napisz/umów się)']
        : ['1. Obiekcja (wypowiedz obiekcję widza wprost, jego słowami)',
           '2. Reframe (przestaw ramę: dlaczego ta obiekcja to złudzenie/błędne założenie)',
           '3. Dowód (konkret: przykład klienta, liczba, mechanizm — bez zmyślania nazwisk)',
           '4. CTA (jedno wezwanie do działania)'];
      var types = isPAMC ? 'Problem, Agitacja, Mechanizm, CTA' : 'Obiekcja, Reframe, Dowód, CTA';
      var out = [
        'SILNIK: konwertujący. Cel: sprzedaż usługi OBECNYM obserwującym (ciepła publiczność, nie zimna).',
        'Usługa: ' + interview.service,
        'Awatar klienta: ' + interview.avatar,
        'Główna obiekcja blokująca zakup: ' + interview.objection,
        'Framework: ' + fw,
        '',
        'STRUKTURA BLOKÓW (dokładnie w tej kolejności, typy: ' + types + '):',
        structure.join('\n'),
        '',
        'Obiekcja MUSI zostać zaadresowana wprost. Mów do jednej osoby (ty), nie do grupy.'
      ];
      if (fewShots) {
        out.push('', 'PRZYKŁADY SKRYPTÓW, KTÓRE ZADZIAŁAŁY (wzoruj się na rytmie, nie kopiuj):', fewShots);
      }
      return out.join('\n');
    },

    salesScriptSchema: function (framework) {
      var isPAMC = (framework || '').indexOf('problem') === 0;
      var en = isPAMC
        ? ['Problem', 'Agitacja', 'Mechanizm', 'CTA']
        : ['Obiekcja', 'Reframe', 'Dowód', 'CTA'];
      return {
        type: 'object',
        properties: {
          title: { type: 'string' },
          blocks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: en },
                text: { type: 'string' }
              },
              required: ['type', 'text']
            }
          }
        },
        required: ['blocks']
      };
    },

    regenBlockUser: function (script, blockIndex, wps) {
      var block = script.blocks[blockIndex];
      var labels = HS.blockLabels(script.blocks);
      var full = script.blocks.map(function (b, i) {
        return '[' + labels[i] + '] ' + b.text;
      }).join('\n');
      var wordCount = HS.countWords(block.text) || 15;
      return [
        'Oto pełny skrypt wideo (bloki w nawiasach):',
        full,
        '',
        'Zadanie: napisz DOKŁADNIE 3 alternatywne warianty bloku [' + labels[blockIndex] + '].',
        'Typ bloku: ' + block.type + '. Długość: ~' + wordCount + ' słów (±20%).',
        'Warianty mają pasować do reszty skryptu (nie zmieniaj innych bloków, nie powtarzaj ich treści).',
        'Każdy wariant ma być wyraźnie inny (inne otwarcie, inny konkret).'
      ].join('\n');
    },

    regenBlockSchema: {
      type: 'object',
      properties: {
        variants: { type: 'array', items: { type: 'string' } }
      },
      required: ['variants']
    },

    finalUser: function (script) {
      var labels = HS.blockLabels(script.blocks);
      var full = script.blocks.map(function (b, i) {
        return '[' + labels[i] + '] ' + b.text;
      }).join('\n');
      return [
        'Oto gotowy skrypt wideo (mówiony, do kamery):',
        full,
        '',
        'Zadanie — dla KAŻDEGO bloku (użyj dokładnie etykiet z nawiasów jako "block"):',
        '1. shotList: propozycja ujęcia — kadr, miejsce, co robi mówiący (1 zdanie, wykonalne telefonem).',
        '2. overlays: tekst na ekranie (napis) — max 6 słów, wzmacnia przekaz bloku, nie powtarza go 1:1.'
      ].join('\n');
    },

    finalSchema: {
      type: 'object',
      properties: {
        shotList: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              block: { type: 'string' },
              shot: { type: 'string' }
            },
            required: ['block', 'shot']
          }
        },
        overlays: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              block: { type: 'string' },
              text: { type: 'string' }
            },
            required: ['block', 'text']
          }
        }
      },
      required: ['shotList', 'overlays']
    }
  };

  /* ------------------------------------------------------------------ */
  /* Few-shot: skrypty ze statusem "działa" tego samego silnika           */
  /* ------------------------------------------------------------------ */

  HS.fewShotExamples = function (library, engineId, maxExamples) {
    var scripts = (library && Array.isArray(library.scripts)) ? library.scripts : [];
    var winners = scripts.filter(function (s) {
      return s.engine === engineId && s.status === 'działa' && s.blocks && s.blocks.length;
    }).slice(0, maxExamples || 2);
    if (!winners.length) return '';
    return winners.map(function (s, i) {
      return 'PRZYKŁAD ' + (i + 1) + (s.title ? ' („' + s.title + '”)' : '') + ':\n' +
        HS.buildTeleprompter(s.blocks);
    }).join('\n\n');
  };


  /* ------------------------------------------------------------------ */
  /* FAZA 3 — detektor zakazanych konstrukcji "AI-polszczyzny"            */
  /* Zwraca listę etykiet wykrytych problemów (pusta = tekst czysty).     */
  /* ------------------------------------------------------------------ */

  /* Uwaga: \b w JS nie działa przy polskich znakach (ć, ż, ę…),
   * dlatego granice słów robimy lookaroundami na \p{L}. */
  HS.BANNED_RULES = [
    { re: /w dzisiejszych czasach/iu, label: '„w dzisiejszych czasach”' },
    { re: /(?<!\p{L})warto\s+\p{L}+[cć](?!\p{L})/iu, label: '„warto + bezokolicznik” (warto pamiętać/zauważyć…)' },
    { re: /(?<!\p{L})co więcej(?!\p{L})/iu, label: '„co więcej”' },
    { re: /(?<!\p{L})podsumowując(?!\p{L})/iu, label: '„podsumowując”' },
    { re: /(?<!\p{L})nie\s+tylko(?!\p{L})[^.!?\n]{0,80}?(?<!\p{L})(ale|lecz)\s*,?\s*(też|także|również)(?!\p{L})/iu, label: '„nie tylko X, ale też Y”' },
    { re: /(?<!\p{L})(kluczow\p{L}*|kluczem\s+jest|klucz\s+to)(?!\p{L})/iu, label: '„kluczowy / kluczem jest”' },
    { re: /(?<!\p{L})zanurz\p{L}*\s+się(?!\p{L})/iu, label: '„zanurz się”' },
    { re: /(?<!\p{L})odkryj\p{L}*(?!\p{L})/iu, label: '„odkryj”' }
  ];

  function firstWordOf(sentence) {
    var m = sentence.trim().match(/^\p{L}+/u);
    return m ? m[0].toLowerCase() : '';
  }

  HS.detectBannedPatterns = function (text) {
    if (!text || typeof text !== 'string' || !text.trim()) return [];
    var found = [];
    function add(label) { if (found.indexOf(label) === -1) found.push(label); }

    HS.BANNED_RULES.forEach(function (r) {
      if (r.re.test(text)) add(r.label);
    });

    /* nadmiar pytań retorycznych (limit: 1 na skrypt, więc 2+ w bloku = na pewno za dużo) */
    var q = (text.match(/\?/g) || []).length;
    if (q >= 2) add('nadmiar pytań retorycznych');

    /* zdania wielokrotnie złożone / ciągnące się */
    var sentences = text.split(/[.!?…]+/).map(function (x) { return x.trim(); })
      .filter(function (x) { return x.length > 0; });
    for (var i = 0; i < sentences.length; i++) {
      var words = HS.countWords(sentences[i]);
      var commas = (sentences[i].match(/,/g) || []).length;
      if (words >= 30 || commas >= 4) { add('wielokrotnie złożone, ciągnące się zdanie'); break; }
    }

    /* podejrzanie równoległa trójka jednowyrazowa ("szybko, tanio i skutecznie") */
    var triple = text.match(/(?<!\p{L})(\p{L}{6,}),\s*(\p{L}{6,})\s+i\s+(\p{L}{6,})(?!\p{L})/u);
    if (triple) {
      var lens = [triple[1].length, triple[2].length, triple[3].length];
      var mx = Math.max(lens[0], lens[1], lens[2]);
      var mn = Math.min(lens[0], lens[1], lens[2]);
      if (mx - mn <= 3) add('podejrzanie równoległa trójka wyliczeniowa');
    }

    /* nadużycie dwukropków i myślników */
    var punct = (text.match(/:/g) || []).length + (text.match(/—/g) || []).length;
    if (punct >= 3) add('nadużycie dwukropków/myślników');

    /* kolejne zdania zaczynające się tym samym schematem */
    for (var j = 1; j < sentences.length; j++) {
      var a = firstWordOf(sentences[j - 1]);
      var b = firstWordOf(sentences[j]);
      if (a && a.length >= 2 && a === b) { add('kolejne zdania zaczynają się tak samo'); break; }
    }

    return found;
  };

  /* Audyt całego skryptu pod kątem zakazanych konstrukcji. */
  HS.auditBlocksForBanned = function (blocks) {
    var out = [];
    (blocks || []).forEach(function (b, i) {
      var issues = HS.detectBannedPatterns(b.text);
      if (issues.length) out.push({ index: i, issues: issues });
    });
    return out;
  };

  /* --- prompt: przepisanie flagowanego bloku (automatyczna regeneracja) --- */
  HS.PROMPTS.rewriteBlockUser = function (script, blockIndex, issues) {
    var block = script.blocks[blockIndex];
    var labels = HS.blockLabels(script.blocks);
    var full = script.blocks.map(function (b, i) {
      return '[' + labels[i] + '] ' + b.text;
    }).join('\n');
    var wordCount = HS.countWords(block.text) || 15;
    return [
      'Oto pełny skrypt wideo:',
      full,
      '',
      'Blok [' + labels[blockIndex] + '] zawiera ZAKAZANE konstrukcje brzmiące jak AI:',
      '- ' + issues.join('\n- '),
      '',
      'Przepisz TYLKO ten blok. Zachowaj sens, konkret i długość (~' + wordCount + ' słów, ±20%).',
      'Usuń wszystkie zakazane konstrukcje. Pisz krótkimi zdaniami, naturalnym językiem mówionym.',
      'Zwróć wyłącznie nowy tekst bloku w polu "text".'
    ].join('\n');
  };

  HS.PROMPTS.rewriteBlockSchema = {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text']
  };

  /* --- prompt: audyt retencji sekunda po sekundzie --- */
  HS.PROMPTS.auditUser = function (script, wps) {
    var labels = HS.blockLabels(script.blocks);
    var t = 0;
    var lines = script.blocks.map(function (b, i) {
      var dur = HS.secondsForText(b.text, wps);
      var from = Math.round(t);
      var to = Math.round(t + dur);
      t += dur;
      return '[' + labels[i] + ' | ' + from + '-' + to + ' s] ' + b.text;
    });
    return [
      'Jesteś bezlitosnym audytorem retencji krótkich wideo. Oto skrypt z osią czasu (sekundy od startu):',
      lines.join('\n'),
      '',
      'Przejdź przez skrypt sekunda po sekundzie, jak znudzony widz scrollujący telefon o 23:00.',
      'Dla KAŻDEGO bloku (w polu "block" użyj dokładnie etykiety z nawiasu kwadratowego, bez czasu):',
      '- "risk": ryzyko odpadnięcia widza w tym bloku, liczba 1-10 (10 = prawie pewny odpad),',
      '- "why": w której sekundzie i DLACZEGO widz odpada (konkretnie: nuda, oczywistość, zbyt wolno, brak obietnicy…),',
      '- "fix": jedna konkretna poprawka (1 zdanie).',
      'Na końcu "summary": 1-2 zdania — najsłabszy moment całego skryptu i co poprawić najpierw.'
    ].join('\n');
  };

  HS.PROMPTS.auditSchema = {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      blocks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            block: { type: 'string' },
            risk: { type: 'integer' },
            why: { type: 'string' },
            fix: { type: 'string' }
          },
          required: ['block', 'risk', 'why']
        }
      }
    },
    required: ['blocks']
  };

  /* ------------------------------------------------------------------ */


  /* ------------------------------------------------------------------ */
  /* FAZA 4 — silnik Viral: adaptacja formatu z biblioteki                */
  /* Twarda zasada: AI NIE wymyśla formatów — wybiera jeden z biblioteki  */
  /* winning-formats.json i adaptuje go do niszy użytkownika.             */
  /* ------------------------------------------------------------------ */

  HS.PROMPTS.viralScriptUser = function (interview, formats, fewShots) {
    var catalog = (formats || []).map(function (f, i) {
      return [
        'FORMAT ' + (i + 1) + ' (id: ' + f.id + '): ' + f.name,
        '  Struktura bloków: ' + (Array.isArray(f.structure) ? f.structure.join(' → ') : String(f.structure || '')),
        '  Mechanika retencji: ' + (f.retentionMechanic || '—'),
        '  Przykład: ' + (f.example || '—'),
        '  Osiągane wyniki: ' + (f.results || '—')
      ].join('\n');
    }).join('\n\n');
    var out = [
      'SILNIK: viral. Cel: maksymalny zasięg i wejścia na profil.',
      'Nisza twórcy: ' + interview.niche,
      'Temat / kąt materiału: ' + interview.angle,
      '',
      'BIBLIOTEKA SPRAWDZONYCH FORMATÓW:',
      catalog,
      '',
      'ZASADY (bezwzględne):',
      '1. Wybierz JEDEN format z biblioteki, który najlepiej pasuje do niszy i kątu.',
      '2. NIE WYMYŚLAJ nowego formatu ani nowej struktury — odwzoruj strukturę bloków',
      '   wybranego formatu jeden do jednego (te same typy bloków, ta sama kolejność).',
      '3. Zaadaptuj TREŚĆ każdego bloku do niszy i tematu, zachowując mechanikę retencji formatu.',
      '4. W polu "formatId" zwróć id wybranego formatu, w "formatName" jego nazwę.'
    ];
    if (fewShots) {
      out.push('', 'PRZYKŁADY SKRYPTÓW TWÓRCY, KTÓRE ZADZIAŁAŁY (rytm i konkret, nie kopiuj):', fewShots);
    }
    return out.join('\n');
  };

  HS.PROMPTS.viralScriptSchema = {
    type: 'object',
    properties: {
      formatId: { type: 'string' },
      formatName: { type: 'string' },
      title: { type: 'string' },
      blocks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string' },
            text: { type: 'string' }
          },
          required: ['type', 'text']
        }
      }
    },
    required: ['formatId', 'blocks']
  };

  /* ------------------------------------------------------------------ */


  /* ------------------------------------------------------------------ */
  /* FAZA 5 — biblioteka skryptów, eksport/import                         */
  /* ------------------------------------------------------------------ */

  /* Upsert po id: aktualizuje istniejący wpis albo dodaje nowy na początek. */
  HS.upsertScript = function (library, script) {
    var lib = library && Array.isArray(library.scripts) ? library : HS.emptyLibrary();
    var idx = -1;
    lib.scripts.forEach(function (s, i) { if (s.id === script.id) idx = i; });
    if (idx >= 0) lib.scripts[idx] = script;
    else lib.scripts.unshift(script);
    return lib;
  };

  HS.removeScript = function (library, scriptId) {
    var lib = library && Array.isArray(library.scripts) ? library : HS.emptyLibrary();
    lib.scripts = lib.scripts.filter(function (s) { return s.id !== scriptId; });
    return lib;
  };

  /* Filtrowanie + sortowanie (najnowsze zmiany na górze).
   * filters: { engine: 'all'|id, status: 'all'|status } */
  HS.filterScripts = function (scripts, filters) {
    var f = filters || {};
    return (scripts || []).filter(function (s) {
      if (f.engine && f.engine !== 'all' && s.engine !== f.engine) return false;
      if (f.status && f.status !== 'all' && s.status !== f.status) return false;
      return true;
    }).slice().sort(function (a, b) {
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });
  };

  /* Krótkie podsumowanie wyników do listy. */
  HS.resultsSummary = function (results) {
    if (!results) return '';
    var parts = [];
    function fmt(n) {
      if (n >= 1000000) return (Math.round(n / 100000) / 10) + ' mln';
      if (n >= 1000) return (Math.round(n / 100) / 10) + ' tys.';
      return String(n);
    }
    if (results.views != null) parts.push('👁 ' + fmt(results.views));
    if (results.retention != null) parts.push('⏱ ' + results.retention + '%');
    if (results.profileVisits != null) parts.push('👤 ' + fmt(results.profileVisits));
    if (results.conversions != null) parts.push('💬 ' + results.conversions);
    return parts.join(' · ');
  };

  /* --- Eksport --- */

  /* Pojedynczy skrypt: opakowany znacznikiem, żeby import go rozpoznał. */
  HS.exportScriptPayload = function (script) {
    return { hiperskrypt: 'script', _v: HS.SCHEMA_V, script: script };
  };

  /* Paczka formatów: DOKŁADNIE format pliku winning-formats.json,
   * gotowa do ręcznej kuracji i wrzucenia do repo. */
  HS.exportFormatsPayload = function (formatsObj) {
    var f = (formatsObj && Array.isArray(formatsObj.formats)) ? formatsObj.formats : [];
    return { _v: HS.SCHEMA_V, formats: f };
  };

  /* --- Import (rozpoznaje typ po kształcie JSON) --- */

  HS.parseImport = function (jsonText) {
    var obj;
    try {
      obj = JSON.parse(jsonText);
    } catch (e) {
      throw new Error('To nie jest poprawny plik JSON.');
    }
    if (obj && Array.isArray(obj.formats)) {
      var valid = obj.formats.filter(function (f) { return f && f.id && f.name; });
      return { kind: 'formats', data: { _v: HS.SCHEMA_V, formats: valid } };
    }
    var script = null;
    if (obj && obj.hiperskrypt === 'script' && obj.script) script = obj.script;
    else if (obj && obj.engine && Array.isArray(obj.blocks)) script = obj;
    if (script) {
      if (!script.id) script.id = HS.uid('s');
      if (!Array.isArray(script.blocks)) script.blocks = [];
      if (!script.results) script.results = { views: null, retention: null, profileVisits: null, conversions: null };
      if (!script.status) script.status = 'szkic';
      return { kind: 'script', data: script };
    }
    throw new Error('Nie rozpoznaję tego pliku — to nie jest ani skrypt, ani paczka formatów HiperSkryptu.');
  };

  /* ------------------------------------------------------------------ */

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = HS;
  }
  global.HS = HS;
})(typeof window !== 'undefined' ? window : globalThis);
