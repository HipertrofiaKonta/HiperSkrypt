/* =========================================================================
 * HiperSkrypt — app.js  (v0.2 — Faza 2)
 * Warstwa UI. Logika czysta: core.js (HS). API: gemini.js (HSGemini).
 * Przepływ: onboarding → wybór silnika → wywiad → hook → edycja → finał.
 * ========================================================================= */
(function () {
  'use strict';

  var store = {
    get: function (key, fallback) {
      try {
        var raw = localStorage.getItem(key);
        if (raw === null) return fallback;
        return JSON.parse(raw);
      } catch (e) {
        console.warn('[HS] Nie można odczytać', key, e);
        return fallback;
      }
    },
    set: function (key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        console.warn('[HS] Nie można zapisać', key, e);
        toast('Nie udało się zapisać danych (pełna pamięć przeglądarki?)');
        return false;
      }
    },
    remove: function (key) {
      try { localStorage.removeItem(key); } catch (e) { /* noop */ }
    }
  };

  var K = HS.STORAGE_KEYS;

  var state = {
    settings: null,
    apiKey: null,
    script: null,
    view: null,
    wizard: null
  };

  /* ------------------------------------------------------------------ */

  function $(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  function copyText(text, okMsg) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast(okMsg); }
      catch (e) { toast('Nie udało się skopiować — zaznacz tekst ręcznie.'); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(okMsg); }, fallback);
    } else { fallback(); }
  }

  /* ------------------------------------------------------------------ */

  var VIEWS = ['onboarding', 'picker', 'wizard', 'editor', 'final', 'library'];

  function showView(name) {
    state.view = name;
    VIEWS.forEach(function (v) { $('view-' + v).hidden = (v !== name); });
    $('topbar').hidden = (name === 'onboarding');
    $('btn-back').hidden = (name === 'picker' || name === 'onboarding');
    $('timerbar').hidden = (name !== 'editor');
    if (name === 'picker') renderPicker();
    if (typeof window.scrollTo === 'function') { try { window.scrollTo(0, 0); } catch (e) { /* noop */ } }
  }

  function setStep(step) {
    var chips = document.querySelectorAll('#stepper .step');
    chips.forEach(function (c) {
      c.classList.toggle('active', parseInt(c.dataset.step, 10) === step);
      c.classList.toggle('done', parseInt(c.dataset.step, 10) < step);
    });
  }

  function showWizardPane(pane) {
    ['wizard-interview', 'wizard-hooks', 'wizard-blocked', 'wizard-status'].forEach(function (id) {
      $(id).hidden = (id !== pane);
    });
  }

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', state.settings.theme || 'dark');
  }

  /* ------------------------------------------------------------------ */
  /* Onboarding (BYOK)                                                    */
  /* ------------------------------------------------------------------ */

  function initOnboarding() {
    $('btn-save-key').addEventListener('click', function () {
      var input = $('input-api-key');
      var err = $('api-key-error');
      var key = (input.value || '').trim();
      if (!HS.looksLikeApiKey(key)) {
        err.textContent = 'To nie wygląda na klucz API — sprawdź, czy skopiowany jest cały klucz (bez spacji).';
        err.hidden = false;
        return;
      }
      err.hidden = true;
      state.apiKey = key;
      store.set(K.apiKey, key);
      input.value = '';
      toast('Klucz zapisany w tej przeglądarce ✔');
      showView('picker');
    });
  }

  /* ------------------------------------------------------------------ */
  /* Wybór silnika                                                        */
  /* ------------------------------------------------------------------ */

  function renderPicker() {
    var grid = $('engine-grid');
    grid.innerHTML = '';
    Object.keys(HS.ENGINES).forEach(function (id) {
      var e = HS.ENGINES[id];
      var card = el('button', 'engine-card');
      card.type = 'button';
      card.appendChild(el('div', 'engine-icon', e.icon));
      card.appendChild(el('h3', null, e.name));
      card.appendChild(el('p', null, e.desc));
      card.addEventListener('click', function () { startWizard(id); });
      grid.appendChild(card);
    });

    var draft = store.get(K.draft, null);
    var resume = $('btn-resume-draft');
    var hint = resume.parentElement;
    if (draft && draft.script) {
      resume.hidden = false;
      hint.hidden = false;
      resume.onclick = function () {
        if (draft.script.blocks && draft.script.blocks.length) {
          openEditor(draft.script);
        } else {
          startWizard(draft.script.engine);
        }
      };
    } else {
      hint.hidden = true;
    }
  }

  /* ------------------------------------------------------------------ */
  /* KROK 0 — wywiad                                                      */
  /* ------------------------------------------------------------------ */

  function startWizard(engineId) {
    state.wizard = {
      engine: engineId,
      interview: {},
      targetSeconds: state.settings.targetSeconds,
      hooks: [],
      lastOp: null
    };
    showView('wizard');
    setStep(0);

    if (engineId === 'viral') {
      var formats = store.get(K.formats, HS.emptyFormats());
      if (!formats.formats || formats.formats.length === 0) {
        $('wizard-blocked-msg').textContent =
          'Biblioteka sprawdzonych formatów (winning-formats.json) jest jeszcze pusta. ' +
          'Silnik Viral adaptuje wyłącznie zweryfikowane formaty — nie wymyśla nowych. ' +
          'Uzupełnij bibliotekę, a ten silnik ożyje.';
        showWizardPane('wizard-blocked');
        return;
      }
    }

    renderInterview();
    showWizardPane('wizard-interview');
  }

  function renderInterview() {
    var wiz = state.wizard;
    var eng = HS.ENGINES[wiz.engine];
    $('interview-title').textContent = eng.icon + ' ' + eng.name + ' — wywiad';
    $('interview-error').hidden = true;

    var wrap = $('interview-fields');
    wrap.innerHTML = '';
    HS.INTERVIEWS[wiz.engine].forEach(function (q) {
      var label = el('label', 'field-label', q.label);
      label.htmlFor = 'q-' + q.id;
      wrap.appendChild(label);

      var input;
      if (q.type === 'select') {
        input = document.createElement('select');
        q.options.forEach(function (o) {
          var opt = document.createElement('option');
          opt.value = o; opt.textContent = o;
          input.appendChild(opt);
        });
      } else if (q.type === 'textarea') {
        input = document.createElement('textarea');
        input.rows = 2;
      } else {
        input = document.createElement('input');
        input.type = 'text';
      }
      input.className = 'input';
      input.id = 'q-' + q.id;
      if (q.placeholder) input.placeholder = q.placeholder;
      if (wiz.interview[q.id]) input.value = wiz.interview[q.id];
      wrap.appendChild(input);
    });

    $('interview-target').value = wiz.targetSeconds;
  }

  function collectInterview() {
    var wiz = state.wizard;
    var missing = [];
    HS.INTERVIEWS[wiz.engine].forEach(function (q) {
      var v = ($('q-' + q.id).value || '').trim();
      wiz.interview[q.id] = v;
      if (q.required && !v) missing.push(q.label);
    });
    var t = parseInt($('interview-target').value, 10);
    wiz.targetSeconds = (t >= 10 && t <= 600) ? t : state.settings.targetSeconds;
    return missing;
  }

  function initInterview() {
    document.querySelectorAll('.length-picker .chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        $('interview-target').value = chip.dataset.sec;
      });
    });

    $('btn-interview-next').addEventListener('click', function () {
      var missing = collectInterview();
      var err = $('interview-error');
      if (missing.length) {
        err.textContent = 'Uzupełnij: ' + missing.join('; ') + '.';
        err.hidden = false;
        return;
      }
      err.hidden = true;
      if (state.wizard.engine === 'merytoryczny') {
        generateHooks();
      } else if (state.wizard.engine === 'konwertujacy') {
        generateSalesScript();
      } else if (state.wizard.engine === 'viral') {
        generateViralScript();
      }
    });

    $('btn-skip-manual').addEventListener('click', function () {
      collectInterview();
      var s = HS.newScript(state.wizard.engine, state.wizard.targetSeconds);
      s.interview = state.wizard.interview;
      openEditor(s);
    });

    $('btn-blocked-back').addEventListener('click', function () { showView('picker'); });
  }

  /* ------------------------------------------------------------------ */
  /* Status generacji                                                     */
  /* ------------------------------------------------------------------ */

  function genLoading(message) {
    showWizardPane('wizard-status');
    $('gen-spinner').hidden = false;
    $('gen-message').textContent = message;
    $('btn-gen-retry').hidden = true;
    $('btn-gen-cancel').hidden = true;
  }

  function genError(error, retryFn, backPane) {
    showWizardPane('wizard-status');
    $('gen-spinner').hidden = true;
    $('gen-message').textContent = '😕 ' + (error && error.message ? error.message : 'Coś poszło nie tak.');
    var retry = $('btn-gen-retry');
    retry.hidden = false;
    retry.onclick = retryFn;
    var cancel = $('btn-gen-cancel');
    cancel.hidden = false;
    cancel.onclick = function () { showWizardPane(backPane || 'wizard-interview'); };
  }

  /* ------------------------------------------------------------------ */
  /* KROK 1 — hooki (merytoryczny)                                        */
  /* ------------------------------------------------------------------ */

  function generateHooks() {
    var wiz = state.wizard;
    setStep(1);
    genLoading('Piszę 3 hooki pod Twój temat…');
    wiz.lastOp = generateHooks;

    HSGemini.call({
      apiKey: state.apiKey,
      system: HS.PROMPTS.system('merytoryczny', wiz.targetSeconds, state.settings.wps),
      user: HS.PROMPTS.merytHooksUser(wiz.interview),
      schema: HS.PROMPTS.merytHooksSchema,
      temperature: 1.0
    }).then(function (data) {
      var hooks = (data && Array.isArray(data.hooks)) ? data.hooks.filter(function (h) {
        return h && h.text;
      }) : [];
      if (hooks.length < 3) {
        throw new Error('Model zwrócił ' + hooks.length + ' hooki zamiast 3 — spróbuj ponownie.');
      }
      wiz.hooks = hooks.slice(0, 3);
      var flagged = wiz.hooks.some(function (h) {
        return HS.detectBannedPatterns(h.text).length > 0;
      });
      if (flagged && !wiz.hookFilterRetried) {
        /* filtr anty-AI: jedna automatyczna regeneracja setu, bez pętli */
        wiz.hookFilterRetried = true;
        generateHooks();
        return;
      }
      renderHooks();
    }).catch(function (e) {
      genError(e, generateHooks, 'wizard-interview');
    });
  }

  function renderHooks() {
    setStep(1);
    showWizardPane('wizard-hooks');
    var wrap = $('hook-cards');
    wrap.innerHTML = '';
    state.wizard.hooks.forEach(function (h, i) {
      var card = el('button', 'hook-card');
      card.type = 'button';
      card.appendChild(el('div', 'hook-num', 'Hook ' + (i + 1)));
      card.appendChild(el('p', 'hook-text', h.text));
      card.appendChild(el('p', 'hook-rationale', '💡 ' + (h.rationale || '')));
      card.addEventListener('click', function () { generateFullScript(h.text); });
      wrap.appendChild(card);
    });
  }

  function initHooks() {
    $('btn-regen-hooks').addEventListener('click', function () {
      state.wizard.hookFilterRetried = false;
      generateHooks();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Generacja pełnego skryptu                                            */
  /* ------------------------------------------------------------------ */

  function coerceBlocks(rawBlocks) {
    return (rawBlocks || [])
      .filter(function (b) { return b && b.type && typeof b.text === 'string'; })
      .map(function (b) { return HS.newBlock(b.type, b.text.trim()); });
  }

  function generateFullScript(chosenHook) {
    var wiz = state.wizard;
    genLoading('Hook wybrany. Piszę pełny skrypt…');
    var op = function () { generateFullScript(chosenHook); };
    wiz.lastOp = op;

    var library = store.get(K.library, HS.emptyLibrary());
    var fewShots = HS.fewShotExamples(library, 'merytoryczny', 2);
    logFewShots('merytoryczny', fewShots);

    HSGemini.call({
      apiKey: state.apiKey,
      system: HS.PROMPTS.system('merytoryczny', wiz.targetSeconds, state.settings.wps),
      user: HS.PROMPTS.merytScriptUser(wiz.interview, chosenHook, fewShots),
      schema: HS.PROMPTS.merytScriptSchema,
      temperature: 0.9
    }).then(function (data) {
      var blocks = coerceBlocks(data.blocks);
      if (!blocks.length) throw new Error('Model nie zwrócił żadnych bloków — spróbuj ponownie.');
      var s = HS.newScript('merytoryczny', wiz.targetSeconds);
      s.interview = wiz.interview;
      s.title = data.title || wiz.interview.topic || '';
      s.blocks = blocks;
      finishGeneratedScript(s);
    }).catch(function (e) {
      genError(e, op, 'wizard-hooks');
    });
  }

  function generateSalesScript() {
    var wiz = state.wizard;
    setStep(1);
    genLoading('Piszę skrypt sprzedażowy pod Twoją obiekcję…');
    wiz.lastOp = generateSalesScript;

    var library = store.get(K.library, HS.emptyLibrary());
    var fewShots = HS.fewShotExamples(library, 'konwertujacy', 2);
    logFewShots('konwertujacy', fewShots);

    HSGemini.call({
      apiKey: state.apiKey,
      system: HS.PROMPTS.system('konwertujacy', wiz.targetSeconds, state.settings.wps),
      user: HS.PROMPTS.salesScriptUser(wiz.interview, fewShots),
      schema: HS.PROMPTS.salesScriptSchema(wiz.interview.framework),
      temperature: 0.9
    }).then(function (data) {
      var blocks = coerceBlocks(data.blocks);
      if (!blocks.length) throw new Error('Model nie zwrócił żadnych bloków — spróbuj ponownie.');
      var s = HS.newScript('konwertujacy', wiz.targetSeconds);
      s.interview = wiz.interview;
      s.title = data.title || wiz.interview.service || '';
      s.blocks = blocks;
      finishGeneratedScript(s);
    }).catch(function (e) {
      genError(e, generateSalesScript, 'wizard-interview');
    });
  }

  function generateViralScript() {
    var wiz = state.wizard;
    setStep(1);
    genLoading('Dobieram sprawdzony format i adaptuję go do Twojej niszy…');
    wiz.lastOp = generateViralScript;

    var formats = store.get(K.formats, HS.emptyFormats()).formats || [];
    var library = store.get(K.library, HS.emptyLibrary());
    var fewShots = HS.fewShotExamples(library, 'viral', 2);
    logFewShots('viral', fewShots);

    HSGemini.call({
      apiKey: state.apiKey,
      system: HS.PROMPTS.system('viral', wiz.targetSeconds, state.settings.wps),
      user: HS.PROMPTS.viralScriptUser(wiz.interview, formats, fewShots),
      schema: HS.PROMPTS.viralScriptSchema,
      temperature: 0.9
    }).then(function (data) {
      var blocks = coerceBlocks(data.blocks);
      if (!blocks.length) throw new Error('Model nie zwrócił żadnych bloków — spróbuj ponownie.');
      /* twarda zasada: format musi pochodzić z biblioteki */
      var used = formats.filter(function (f) { return f.id === data.formatId; })[0];
      if (!used) {
        throw new Error('Model nie wskazał formatu z biblioteki (id: ' +
          (data.formatId || 'brak') + ') — spróbuj ponownie.');
      }
      var s = HS.newScript('viral', wiz.targetSeconds);
      s.interview = wiz.interview;
      s.interview.formatUsed = { id: used.id, name: used.name };
      s.title = data.title || wiz.interview.angle || '';
      s.blocks = blocks;
      toast('Format z biblioteki: „' + used.name + '” 🔥');
      finishGeneratedScript(s);
    }).catch(function (e) {
      genError(e, generateViralScript, 'wizard-interview');
    });
  }

  /* ------------------------------------------------------------------ */
  /* FAZA 3 — filtr anty-AI: automatyczna regeneracja flagowanych bloków  */
  /* ------------------------------------------------------------------ */

  /* Przepisuje blok, dopóki nie będzie czysty (max 2 próby, bez pętli).
   * Przy błędzie API zostawia obecny tekst — nigdy nie blokuje przepływu. */
  function rewriteFlaggedBlock(script, index, attempt) {
    var issues = HS.detectBannedPatterns(script.blocks[index].text);
    if (!issues.length) return Promise.resolve(false);
    return HSGemini.call({
      apiKey: state.apiKey,
      system: HS.PROMPTS.system(script.engine, script.targetSeconds, state.settings.wps),
      user: HS.PROMPTS.rewriteBlockUser(script, index, issues),
      schema: HS.PROMPTS.rewriteBlockSchema,
      temperature: 0.8
    }).then(function (data) {
      if (data && typeof data.text === 'string' && data.text.trim()) {
        script.blocks[index].text = data.text.trim();
      }
      if (HS.detectBannedPatterns(script.blocks[index].text).length && attempt < 2) {
        return rewriteFlaggedBlock(script, index, attempt + 1);
      }
      return true;
    }).catch(function (e) {
      console.warn('[HS] Filtr anty-AI: nie udało się przepisać bloku', index, e.message);
      return false;
    });
  }

  /* Sekwencyjnie czyści wszystkie flagowane bloki świeżo wygenerowanego
   * skryptu, zanim użytkownik go zobaczy. */
  function applyAntiAiFilter(script) {
    var chain = Promise.resolve();
    var fixed = 0;
    script.blocks.forEach(function (b, i) {
      chain = chain.then(function () {
        if (!HS.detectBannedPatterns(script.blocks[i].text).length) return;
        return rewriteFlaggedBlock(script, i, 1).then(function (did) {
          if (did) fixed++;
        });
      });
    });
    return chain.then(function () { return { fixed: fixed }; });
  }

  function finishGeneratedScript(s) {
    var flaggedCount = HS.auditBlocksForBanned(s.blocks).length;
    if (!flaggedCount) { openEditor(s); return; }
    genLoading('Filtr anty-AI: przepisuję ' + flaggedCount + ' blok(i) brzmiące jak AI…');
    applyAntiAiFilter(s).then(function (res) {
      openEditor(s);
      if (res.fixed > 0) toast('Filtr anty-AI przepisał bloki: ' + res.fixed + ' ✔');
    });
  }

  /* ------------------------------------------------------------------ */
  /* KROK 2 — edytor bloków                                               */
  /* ------------------------------------------------------------------ */

  function openEditor(script) {
    state.script = script;
    var e = HS.ENGINES[script.engine] || { icon: '❓', name: script.engine };
    $('editor-engine-badge').textContent = e.icon + ' ' + e.name;
    $('editor-title').value = script.title || '';
    $('btn-audit').hidden = !canRegen();
    renderBlocks();
    showView('editor');
    setStep(2);
    updateTimer();
    saveDraft();
  }

  function saveDraft() {
    if (!state.script) return;
    state.script.updatedAt = new Date().toISOString();
    store.set(K.draft, { _v: HS.SCHEMA_V, script: state.script });
  }

  var draftTimer = null;
  function saveDraftDebounced() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 400);
  }

  function renderBlocks() {
    var list = $('block-list');
    list.innerHTML = '';
    var blocks = state.script.blocks;
    $('editor-empty').hidden = blocks.length > 0;

    blocks.forEach(function (block, i) {
      list.appendChild(renderBlock(block, i, blocks.length));
    });
    renderValidation();
    syncAuditPanel();
  }

  function renderBlock(block, index, count) {
    var wrap = el('div', 'block');
    wrap.dataset.blockId = block.id;

    var head = el('div', 'block-head');
    head.appendChild(el('span', 'block-type', block.type));
    var time = el('span', 'block-time');
    time.id = 'time-' + block.id;
    head.appendChild(time);

    var actions = el('div', 'block-actions');
    if (canRegen()) {
      var btnRegen = el('button', 'btn-icon', '↻');
      btnRegen.title = 'Wygeneruj warianty tego bloku';
      btnRegen.addEventListener('click', function () { regenBlock(index); });
      actions.appendChild(btnRegen);
    }
    var btnUp = el('button', 'btn-icon', '↑');
    btnUp.title = 'Przenieś wyżej';
    btnUp.disabled = index === 0;
    btnUp.addEventListener('click', function () { moveBlock(index, -1); });
    var btnDown = el('button', 'btn-icon', '↓');
    btnDown.title = 'Przenieś niżej';
    btnDown.disabled = index === count - 1;
    btnDown.addEventListener('click', function () { moveBlock(index, +1); });
    var btnDel = el('button', 'btn-icon', '✕');
    btnDel.title = 'Usuń blok';
    btnDel.addEventListener('click', function () { deleteBlock(index); });
    actions.appendChild(btnUp);
    actions.appendChild(btnDown);
    actions.appendChild(btnDel);
    head.appendChild(actions);
    wrap.appendChild(head);

    var ta = document.createElement('textarea');
    ta.value = block.text;
    ta.placeholder = placeholderFor(block.type);
    ta.rows = 2;
    ta.addEventListener('input', function () {
      block.text = ta.value;
      autoresize(ta);
      updateBlockTime(block);
      updateTimer();
      saveDraftDebounced();
    });
    wrap.appendChild(ta);

    requestAnimationFrame(function () { autoresize(ta); });
    setTimeout(function () { updateBlockTime(block); }, 0);

    return wrap;
  }

  function canRegen() {
    return !!state.apiKey && !!state.script;
  }

  function placeholderFor(type) {
    switch (type) {
      case 'Hook': return 'Pierwsze 1–2 zdania, które zatrzymują scroll…';
      case 'Primer': return 'Zapowiedz, co widz zyska, jeśli zostanie…';
      case 'Super Hook': return 'Mocniejsze podbicie ciekawości…';
      case 'Tip': return 'Konkretna wskazówka…';
      case 'Rozwinięcie': return 'Rozwiń tip: jak i dlaczego to działa…';
      case 'Rehook': return 'Zatrzymaj widza: „a to nie wszystko…”';
      case 'Ekspert': return 'Pokaż, skąd to wiesz (doświadczenie, wyniki)…';
      case 'CTA': return 'Co widz ma teraz zrobić?';
      default: return 'Treść bloku…';
    }
  }

  function autoresize(ta) {
    ta.style.height = 'auto';
    ta.style.height = (ta.scrollHeight + 2) + 'px';
  }

  function addBlock(type) {
    state.script.blocks.push(HS.newBlock(type));
    renderBlocks();
    updateTimer();
    saveDraft();
    var list = $('block-list');
    var last = list.lastElementChild;
    if (last) {
      var ta = last.querySelector('textarea');
      if (ta) ta.focus();
      if (typeof last.scrollIntoView === 'function') {
        last.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  function deleteBlock(index) {
    state.script.blocks.splice(index, 1);
    renderBlocks();
    updateTimer();
    saveDraft();
  }

  function moveBlock(index, delta) {
    var b = state.script.blocks;
    var j = index + delta;
    if (j < 0 || j >= b.length) return;
    var tmp = b[index]; b[index] = b[j]; b[j] = tmp;
    renderBlocks();
    saveDraft();
  }

  function initAddBlockMenu() {
    var btn = $('btn-add-block');
    var menu = $('add-block-menu');
    HS.BLOCK_TYPES.forEach(function (t) {
      var b = el('button', null, t);
      b.type = 'button';
      b.addEventListener('click', function () {
        menu.hidden = true;
        addBlock(t);
      });
      menu.appendChild(b);
    });
    btn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    document.addEventListener('click', function (ev) {
      if (!menu.hidden && !menu.contains(ev.target)) menu.hidden = true;
    });
  }

  function renderValidation() {
    var panel = $('validation-panel');
    if (!state.script || state.script.engine !== 'merytoryczny' || !state.script.blocks.length) {
      panel.hidden = true;
      return;
    }
    var issues = HS.validateMerytoryczny(state.script.blocks);
    panel.hidden = false;
    panel.innerHTML = '';
    if (!issues.length) {
      panel.className = 'validation-panel ok';
      panel.appendChild(el('p', null, '✅ Struktura skryptu jest zgodna z formatem merytorycznym.'));
    } else {
      panel.className = 'validation-panel bad';
      panel.appendChild(el('p', 'validation-title', '⚠️ Struktura odbiega od formatu (' + issues.length + '):'));
      issues.forEach(function (msg) {
        panel.appendChild(el('p', 'validation-issue', '• ' + msg));
      });
    }
  }

  function regenBlock(index) {
    var script = state.script;
    var block = script.blocks[index];
    var body = $('variants-body');
    $('variants-title').textContent = 'Warianty: ' + block.type;
    body.innerHTML = '<div class="gen-status"><div class="spinner"></div><p>Piszę 3 warianty…</p></div>';
    $('overlay-variants').hidden = false;

    HSGemini.call({
      apiKey: state.apiKey,
      system: HS.PROMPTS.system(script.engine, script.targetSeconds, state.settings.wps),
      user: HS.PROMPTS.regenBlockUser(script, index, state.settings.wps),
      schema: HS.PROMPTS.regenBlockSchema,
      temperature: 1.0
    }).then(function (data) {
      var variants = (data && Array.isArray(data.variants)) ? data.variants.filter(Boolean) : [];
      if (!variants.length) throw new Error('Model nie zwrócił wariantów — spróbuj ponownie.');
      body.innerHTML = '';
      variants.slice(0, 3).forEach(function (v, i) {
        var card = el('button', 'variant-card');
        card.type = 'button';
        card.appendChild(el('div', 'hook-num', 'Wariant ' + (i + 1)));
        card.appendChild(el('p', null, v));
        card.addEventListener('click', function () {
          block.text = v;
          $('overlay-variants').hidden = true;
          if (HS.detectBannedPatterns(v).length) {
            /* filtr anty-AI: wariant flagowany -> automatyczne przepisanie */
            toast('Filtr anty-AI poprawia wariant…');
            rewriteFlaggedBlock(script, index, 1).then(function () {
              renderBlocks();
              updateTimer();
              saveDraft();
              toast('Blok podmieniony (poprawiony przez filtr anty-AI) ✔');
            });
          } else {
            renderBlocks();
            updateTimer();
            saveDraft();
            toast('Blok podmieniony ✔');
          }
        });
        body.appendChild(card);
      });
      var keep = el('button', 'btn-link', 'zostaw oryginał');
      keep.addEventListener('click', function () { $('overlay-variants').hidden = true; });
      var p = el('p', 'center');
      p.appendChild(keep);
      body.appendChild(p);
    }).catch(function (e) {
      body.innerHTML = '';
      body.appendChild(el('p', 'field-error', '😕 ' + e.message));
      var retry = el('button', 'btn btn-secondary', '↻ Spróbuj ponownie');
      retry.addEventListener('click', function () { regenBlock(index); });
      body.appendChild(retry);
    });
  }

  /* ------------------------------------------------------------------ */
  /* FAZA 3 — audyt retencji (sekunda po sekundzie)                       */
  /* ------------------------------------------------------------------ */

  function syncAuditPanel() {
    var panel = $('audit-panel');
    if (!state.script || !state.script.audit ||
        state.script.audit.blocksHash !== blocksHash(state.script.blocks)) {
      panel.hidden = true;
      return;
    }
  }

  function runAudit() {
    var script = state.script;
    if (!script || !script.blocks.length) {
      toast('Skrypt jest pusty — nie ma czego audytować.');
      return;
    }
    var hash = blocksHash(script.blocks);
    if (script.audit && script.audit.blocksHash === hash) {
      renderAudit();
      return;
    }
    var panel = $('audit-panel');
    panel.hidden = false;
    panel.innerHTML = '<div class="gen-status"><div class="spinner"></div>' +
      '<p>Przechodzę skrypt sekunda po sekundzie…</p></div>';

    HSGemini.call({
      apiKey: state.apiKey,
      system: HS.PROMPTS.system(script.engine, script.targetSeconds, state.settings.wps),
      user: HS.PROMPTS.auditUser(script, state.settings.wps),
      schema: HS.PROMPTS.auditSchema,
      temperature: 0.4
    }).then(function (data) {
      script.audit = {
        blocksHash: hash,
        summary: data.summary || '',
        blocks: Array.isArray(data.blocks) ? data.blocks : []
      };
      saveDraft();
      renderAudit();
    }).catch(function (e) {
      panel.innerHTML = '';
      panel.appendChild(el('p', 'field-error', '😕 ' + e.message));
      var retry = el('button', 'btn btn-secondary', '↻ Spróbuj ponownie');
      retry.addEventListener('click', runAudit);
      panel.appendChild(retry);
    });
  }

  function renderAudit() {
    var panel = $('audit-panel');
    var a = state.script.audit;
    panel.hidden = false;
    panel.innerHTML = '';
    if (a.summary) panel.appendChild(el('p', 'audit-summary', '🔍 ' + a.summary));
    a.blocks.forEach(function (r) {
      var row = el('div', 'audit-row');
      var risk = parseInt(r.risk, 10) || 0;
      var cls = risk >= 7 ? 'high' : (risk >= 4 ? 'mid' : 'low');
      row.appendChild(el('span', 'audit-chip ' + cls, risk + '/10'));
      var body = el('div', 'audit-body');
      body.appendChild(el('div', 'final-row-label', '//' + r.block));
      if (r.why) body.appendChild(el('p', null, r.why));
      if (r.fix) body.appendChild(el('p', 'audit-fix', '💡 ' + r.fix));
      row.appendChild(body);
      panel.appendChild(row);
    });
  }

  function initAudit() {
    $('btn-audit').addEventListener('click', runAudit);
  }

  /* ------------------------------------------------------------------ */
  /* KROK 3 — finał                                                       */
  /* ------------------------------------------------------------------ */

  function blocksHash(blocks) {
    return blocks.map(function (b) { return b.type + '|' + b.text; }).join('~');
  }

  function finalize() {
    var script = state.script;
    if (!script || !script.blocks.length) {
      toast('Skrypt jest pusty — dodaj bloki przed finalizacją.');
      return;
    }
    var hash = blocksHash(script.blocks);
    var teleprompter = HS.buildTeleprompter(script.blocks);

    if (script.final && script.final.blocksHash === hash) {
      script.final.teleprompter = teleprompter;
      renderFinal();
      showView('final');
      setStep(3);
      return;
    }

    if (!state.apiKey) {
      script.final = { blocksHash: hash, teleprompter: teleprompter, shotList: [], overlays: [] };
      renderFinal();
      showView('final');
      setStep(3);
      return;
    }

    showView('wizard');
    setStep(3);
    genLoading('Składam finał: ujęcia i napisy…');

    HSGemini.call({
      apiKey: state.apiKey,
      system: HS.PROMPTS.system(script.engine, script.targetSeconds, state.settings.wps),
      user: HS.PROMPTS.finalUser(script),
      schema: HS.PROMPTS.finalSchema,
      temperature: 0.7
    }).then(function (data) {
      script.final = {
        blocksHash: hash,
        teleprompter: teleprompter,
        shotList: Array.isArray(data.shotList) ? data.shotList : [],
        overlays: Array.isArray(data.overlays) ? data.overlays : []
      };
      saveDraft();
      renderFinal();
      showView('final');
      setStep(3);
    }).catch(function (e) {
      genError(e, finalize, 'wizard-status');
      var cancel = $('btn-gen-cancel');
      cancel.hidden = false;
      cancel.onclick = function () { showView('editor'); };
    });
  }

  function renderFinal() {
    var f = state.script.final;
    $('final-teleprompter').textContent = f.teleprompter;

    var shots = $('final-shots');
    shots.innerHTML = '';
    if (!f.shotList.length) {
      shots.appendChild(el('p', 'muted', 'Brak shot listy (offline lub błąd generacji).'));
    }
    f.shotList.forEach(function (s) {
      var row = el('div', 'final-row');
      row.appendChild(el('div', 'final-row-label', '//' + s.block));
      row.appendChild(el('p', null, s.shot));
      shots.appendChild(row);
    });

    var ovs = $('final-overlays');
    ovs.innerHTML = '';
    if (!f.overlays.length) {
      ovs.appendChild(el('p', 'muted', 'Brak propozycji napisów.'));
    }
    f.overlays.forEach(function (o) {
      var row = el('div', 'final-row');
      row.appendChild(el('div', 'final-row-label', '//' + o.block));
      row.appendChild(el('p', null, o.text));
      ovs.appendChild(row);
    });
  }

  function initFinal() {
    $('btn-finalize').addEventListener('click', finalize);
    $('btn-back-editor').addEventListener('click', function () { showView('editor'); setStep(2); });

    document.querySelectorAll('.final-tabs .tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        document.querySelectorAll('.final-tabs .tab').forEach(function (t) {
          t.classList.toggle('active', t === tab);
        });
        ['teleprompter', 'shots', 'overlays'].forEach(function (p) {
          $('pane-' + p).hidden = (p !== tab.dataset.tab);
        });
      });
    });

    $('btn-copy-teleprompter').addEventListener('click', function () {
      copyText(state.script.final.teleprompter, 'Teleprompter skopiowany ✔');
    });
    $('btn-copy-shots').addEventListener('click', function () {
      var txt = state.script.final.shotList.map(function (s) {
        return '//' + s.block + '\n' + s.shot;
      }).join('\n\n');
      copyText(txt, 'Shot lista skopiowana ✔');
    });
    $('btn-copy-overlays').addEventListener('click', function () {
      var txt = state.script.final.overlays.map(function (o) {
        return '//' + o.block + '\n' + o.text;
      }).join('\n\n');
      copyText(txt, 'Napisy skopiowane ✔');
    });

    $('btn-close-variants').addEventListener('click', function () {
      $('overlay-variants').hidden = true;
    });
    $('overlay-variants').addEventListener('click', function (ev) {
      if (ev.target === $('overlay-variants')) $('overlay-variants').hidden = true;
    });
  }

  /* ------------------------------------------------------------------ */
  /* FAZA 5 — biblioteka skryptów, few-shot, eksport/import               */
  /* ------------------------------------------------------------------ */

  /* Log dowodowy pętli few-shot: widać w konsoli, że przykłady "działa"
   * naprawdę weszły do payloadu prompta. */
  function logFewShots(engineId, fewShots) {
    if (fewShots) {
      var count = (fewShots.match(/PRZYKŁAD \d+/g) || []).length;
      console.log('[HS] Few-shot (' + engineId + '): dołączam ' + count +
        ' skrypt(y) ze statusem "działa" do prompta.');
    } else {
      console.log('[HS] Few-shot (' + engineId + '): brak skryptów "działa" — prompt bez przykładów.');
    }
  }

  function getLibrary() { return store.get(K.library, HS.emptyLibrary()); }
  function setLibrary(lib) { store.set(K.library, lib); }

  function saveCurrentToLibrary() {
    if (!state.script || !state.script.blocks.length) {
      toast('Nie ma czego zapisać — skrypt jest pusty.');
      return;
    }
    state.script.updatedAt = new Date().toISOString();
    setLibrary(HS.upsertScript(getLibrary(), state.script));
    toast('Zapisano w bibliotece 📚');
  }

  var libFilters = { engine: 'all', status: 'all' };
  var libExpandedId = null;

  function renderLibrary() {
    var list = $('lib-list');
    list.innerHTML = '';
    var scripts = HS.filterScripts(getLibrary().scripts, libFilters);
    $('lib-empty').hidden = scripts.length > 0;
    scripts.forEach(function (script) {
      list.appendChild(renderLibCard(script));
    });
  }

  function renderLibCard(script) {
    var eng = HS.ENGINES[script.engine] || { icon: '❓', name: script.engine };
    var card = el('div', 'lib-card');

    var head = el('button', 'lib-card-head');
    head.type = 'button';
    head.appendChild(el('div', 'lib-card-title', script.title || '(bez tytułu)'));
    var meta = el('div', 'lib-card-meta');
    meta.appendChild(el('span', null, eng.icon + ' ' + eng.name));
    var badgeCls = script.status === 'działa' ? 'status-badge dziala'
      : (script.status === 'nie działa' ? 'status-badge niedziala' : 'status-badge');
    meta.appendChild(el('span', badgeCls, script.status));
    meta.appendChild(el('span', null, String(script.updatedAt || '').slice(0, 10)));
    var stats = HS.scriptStats(script.blocks, state.settings.wps);
    meta.appendChild(el('span', null, HS.formatSeconds(stats.seconds)));
    head.appendChild(meta);
    card.appendChild(head);

    var summary = HS.resultsSummary(script.results);
    if (summary) card.appendChild(el('div', 'lib-results', summary));

    var details = el('div', 'lib-details');
    details.hidden = script.id !== libExpandedId;
    buildLibDetails(details, script);
    card.appendChild(details);

    head.addEventListener('click', function () {
      libExpandedId = (libExpandedId === script.id) ? null : script.id;
      renderLibrary();
    });

    return card;
  }

  function buildLibDetails(wrap, script) {
    /* status */
    var stLabel = el('label', 'field-label', 'Status');
    var st = document.createElement('select');
    st.className = 'input';
    HS.SCRIPT_STATUSES.forEach(function (x) {
      var o = document.createElement('option');
      o.value = x; o.textContent = x;
      st.appendChild(o);
    });
    st.value = script.status;
    st.addEventListener('change', function () {
      script.status = st.value;
      script.updatedAt = new Date().toISOString();
      setLibrary(HS.upsertScript(getLibrary(), script));
      renderLibrary();
      if (st.value === 'działa') {
        toast('Skrypt trafi jako przykład do kolejnych generacji ' +
          (HS.ENGINES[script.engine] || {}).name + ' 🏆');
      }
    });
    wrap.appendChild(stLabel);
    wrap.appendChild(st);

    /* wyniki */
    var grid = el('div', 'results-grid');
    var fields = [
      { key: 'views', label: 'Wyświetlenia' },
      { key: 'retention', label: 'Retencja %' },
      { key: 'profileVisits', label: 'Wejścia na profil' },
      { key: 'conversions', label: 'Konwersje' }
    ];
    fields.forEach(function (f) {
      var cell = el('div');
      var lb = el('label', null, f.label);
      var inp = document.createElement('input');
      inp.type = 'number';
      inp.className = 'input';
      inp.min = '0';
      inp.id = 'res-' + f.key + '-' + script.id;
      if (script.results && script.results[f.key] != null) inp.value = script.results[f.key];
      inp.addEventListener('change', function () {
        var v = inp.value === '' ? null : parseFloat(inp.value);
        if (v != null && (isNaN(v) || v < 0)) v = null;
        script.results[f.key] = v;
        script.updatedAt = new Date().toISOString();
        setLibrary(HS.upsertScript(getLibrary(), script));
      });
      cell.appendChild(lb);
      cell.appendChild(inp);
      grid.appendChild(cell);
    });
    wrap.appendChild(grid);

    /* akcje */
    var actions = el('div', 'lib-actions');
    var btnOpen = el('button', 'btn btn-primary', '✏️ Otwórz w edytorze');
    btnOpen.addEventListener('click', function () {
      openEditor(JSON.parse(JSON.stringify(script)));
    });
    var btnExport = el('button', 'btn btn-secondary', '📤 Eksportuj JSON');
    btnExport.addEventListener('click', function () {
      var name = 'hiperskrypt-' + (script.title || script.id).toLowerCase()
        .replace(/[^a-z0-9ąćęłńóśźż]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) + '.json';
      download(name, JSON.stringify(HS.exportScriptPayload(script), null, 2));
    });
    var btnDel = el('button', 'btn btn-secondary btn-danger', 'Usuń');
    btnDel.addEventListener('click', function () {
      if (btnDel.dataset.confirm !== '1') {
        btnDel.dataset.confirm = '1';
        btnDel.textContent = 'Na pewno usunąć?';
        return;
      }
      setLibrary(HS.removeScript(getLibrary(), script.id));
      libExpandedId = null;
      renderLibrary();
      toast('Skrypt usunięty.');
    });
    actions.appendChild(btnOpen);
    actions.appendChild(btnExport);
    actions.appendChild(btnDel);
    wrap.appendChild(actions);
  }

  /* --- pobieranie pliku (z hakiem testowym) --- */
  function download(filename, text) {
    if (typeof window.__HS_TEST_DOWNLOAD === 'function') {
      window.__HS_TEST_DOWNLOAD(filename, text);
      return;
    }
    try {
      var blob = new Blob([text], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      toast('Pobieranie: ' + filename);
    } catch (e) {
      console.warn('[HS] download:', e);
      toast('Nie udało się pobrać pliku w tej przeglądarce.');
    }
  }

  /* --- import (skrypt lub paczka formatów, auto-rozpoznanie) --- */
  function importFromText(text) {
    var parsed;
    try {
      parsed = HS.parseImport(text);
    } catch (e) {
      toast('😕 ' + e.message);
      return;
    }
    if (parsed.kind === 'script') {
      setLibrary(HS.upsertScript(getLibrary(), parsed.data));
      renderLibrary();
      toast('Zaimportowano skrypt: „' + (parsed.data.title || 'bez tytułu') + '” 📚');
    } else {
      var local = store.get(K.formats, HS.emptyFormats());
      /* import użytkownika nadpisuje lokalne wpisy o tym samym id */
      store.set(K.formats, HS.mergeFormats(parsed.data, local));
      toast('Zaimportowano formaty: ' + parsed.data.formats.length + ' 🔥');
    }
  }

  function initLibrary() {
    /* filtry */
    var stSel = $('lib-filter-status');
    HS.SCRIPT_STATUSES.forEach(function (x) {
      var o = document.createElement('option');
      o.value = x; o.textContent = x;
      stSel.appendChild(o);
    });
    $('lib-filter-engine').addEventListener('change', function () {
      libFilters.engine = $('lib-filter-engine').value;
      renderLibrary();
    });
    stSel.addEventListener('change', function () {
      libFilters.status = stSel.value;
      renderLibrary();
    });

    /* zapis z edytora i finału */
    $('btn-save-library').addEventListener('click', saveCurrentToLibrary);
    $('btn-save-library-final').addEventListener('click', saveCurrentToLibrary);

    /* eksport paczki formatów (dokładnie format winning-formats.json) */
    $('btn-export-formats').addEventListener('click', function () {
      var payload = HS.exportFormatsPayload(store.get(K.formats, HS.emptyFormats()));
      download('winning-formats.json', JSON.stringify(payload, null, 2));
    });

    /* import z pliku */
    $('btn-import').addEventListener('click', function () { $('import-file').click(); });
    $('import-file').addEventListener('change', function () {
      var file = $('import-file').files && $('import-file').files[0];
      if (!file) return;
      file.text().then(importFromText, function () {
        toast('Nie udało się odczytać pliku.');
      });
      $('import-file').value = '';
    });
  }

  /* ------------------------------------------------------------------ */
  /* Licznik czasu                                                        */
  /* ------------------------------------------------------------------ */

  function updateBlockTime(block) {
    var n = $('time-' + block.id);
    if (!n) return;
    var sec = HS.secondsForText(block.text, state.settings.wps);
    n.textContent = HS.formatSeconds(sec);
  }

  function updateTimer() {
    if (!state.script) return;
    var stats = HS.scriptStats(state.script.blocks, state.settings.wps);
    var target = state.script.targetSeconds || state.settings.targetSeconds;

    $('timer-time').textContent = HS.formatSeconds(stats.seconds);
    $('timer-target').textContent = HS.formatSeconds(target);
    $('timer-words').textContent = stats.words + ' ' + wordsLabel(stats.words);

    var over = stats.seconds > HS.SOFT_WARN_SECONDS;
    $('timer-warning').hidden = !over;
    $('timerbar').classList.toggle('over', over);

    var pct = Math.min(100, (stats.seconds / target) * 100);
    $('timer-progress-fill').style.width = pct + '%';
  }

  function wordsLabel(n) {
    if (n === 1) return 'słowo';
    var d = n % 10, h = n % 100;
    if (d >= 2 && d <= 4 && !(h >= 12 && h <= 14)) return 'słowa';
    return 'słów';
  }

  /* ------------------------------------------------------------------ */
  /* Ustawienia                                                           */
  /* ------------------------------------------------------------------ */

  function openSettings() {
    $('set-theme').value = state.settings.theme;
    $('set-target').value = state.settings.targetSeconds;
    $('set-wps').value = state.settings.wps;
    var kp = $('set-key-preview');
    kp.textContent = state.apiKey
      ? 'Zapisany klucz: ' + state.apiKey.slice(0, 6) + '…' + state.apiKey.slice(-4)
      : 'Brak zapisanego klucza.';
    $('overlay-settings').hidden = false;
  }

  function closeSettings() { $('overlay-settings').hidden = true; }

  function initSettings() {
    $('btn-settings').addEventListener('click', openSettings);
    $('btn-close-settings').addEventListener('click', closeSettings);
    $('overlay-settings').addEventListener('click', function (ev) {
      if (ev.target === $('overlay-settings')) closeSettings();
    });

    $('btn-save-settings').addEventListener('click', function () {
      var t = parseInt($('set-target').value, 10);
      var w = parseFloat($('set-wps').value);
      state.settings.theme = $('set-theme').value === 'light' ? 'light' : 'dark';
      state.settings.targetSeconds = (t >= 10 && t <= 600) ? t : HS.DEFAULT_TARGET_SECONDS;
      state.settings.wps = (w >= 1 && w <= 5) ? w : HS.WPS_DEFAULT;
      store.set(K.settings, state.settings);
      applyTheme();
      updateTimer();
      closeSettings();
      toast('Ustawienia zapisane ✔');
    });

    $('btn-change-key').addEventListener('click', function () {
      closeSettings();
      state.apiKey = null;
      store.remove(K.apiKey);
      showView('onboarding');
    });
  }

  /* ------------------------------------------------------------------ */
  /* winning-formats.json                                                 */
  /* ------------------------------------------------------------------ */

  function loadWinningFormats() {
    var local = store.get(K.formats, HS.emptyFormats());
    if (typeof fetch !== 'function') {
      store.set(K.formats, local);
      return;
    }
    fetch('winning-formats.json', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (repo) {
        store.set(K.formats, HS.mergeFormats(repo, local));
      })
      .catch(function (e) {
        console.warn('[HS] Nie udało się pobrać winning-formats.json:', e.message);
        store.set(K.formats, local);
      });
  }

  /* ------------------------------------------------------------------ */
  /* Nawigacja górna                                                      */
  /* ------------------------------------------------------------------ */

  function initNav() {
    $('btn-back').addEventListener('click', function () {
      if (state.view === 'final') { showView('editor'); setStep(2); return; }
      if (state.view === 'editor') { saveDraft(); showView('picker'); return; }
      showView('picker');
    });
    $('brand').addEventListener('click', function () {
      if (state.view === 'editor') saveDraft();
      showView('picker');
    });
    $('btn-library').addEventListener('click', function () {
      if (state.view === 'editor') saveDraft();
      renderLibrary();
      showView('library');
    });
    $('editor-title').addEventListener('input', function () {
      if (state.script) {
        state.script.title = $('editor-title').value;
        saveDraftDebounced();
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Start                                                                */
  /* ------------------------------------------------------------------ */

  var booted = false;
  function init() {
    if (booted) return; // strażnik: init tylko raz (podwójny DOMContentLoaded)
    booted = true;
    state.settings = store.get(K.settings, null) || HS.defaultSettings();
    store.set(K.settings, state.settings);
    state.apiKey = store.get(K.apiKey, null);

    applyTheme();
    initOnboarding();
    initSettings();
    initNav();
    initAddBlockMenu();
    initInterview();
    initHooks();
    initFinal();
    initAudit();
    initLibrary();
    loadWinningFormats();

    if (!state.apiKey) {
      showView('onboarding');
    } else {
      showView('picker');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
