/* =========================================================================
 * Practice Hub (standalone) — core extracted from ihbb-simulator-web
 * Upload a JSON question set → filter → drill → local + DeepSeek grading
 * ========================================================================= */
'use strict';

(function () {
    /* ---------------- state ---------------- */
    const ERA_NAMES = {
        '01': '8000 BCE – 600 BCE', '02': '600 BCE – 600 CE', '03': '600 CE – 1450 CE',
        '04': '1450 CE – 1750 CE', '05': '1750 – 1914', '06': '1914 – 1991', '07': '1991 – Present'
    };
    const App = {
        set: null,               // { id, name, items: [{id,question,answer,aliases,meta}] }
        filters: { cats: [], eras: [], src: '' },
        size: 10, timer: 10, strict: false,
        pool: [], order: [], i: -1,
        correct: 0, answered: 0,
        curItem: null, phase: 'idle', // idle | typing | grading | graded
        cdIv: null, submitBusy: false,
        wrongLog: []
    };
    const LS_KEY = 'practice_hub_settings_v1';

    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const uid = () => `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    /* ---------------- JSON import (mirrors app.js parseJsonImport) ---------------- */
    const stringVal = (v) => (v === null || v === undefined) ? '' : String(v).trim();

    function toAliasArray(v) {
        if (Array.isArray(v)) return v.map(stringVal).filter(Boolean);
        if (typeof v === 'string' && v.trim()) return v.split(/[;|]/).map(stringVal).filter(Boolean);
        return [];
    }
    function normalizeMeta(raw) {
        const m = raw?.meta || raw?.metadata || {};
        return {
            category: stringVal(raw?.category ?? raw?.cat ?? raw?.region ?? m?.category ?? m?.cat ?? m?.region),
            era: stringVal(raw?.era ?? raw?.period ?? m?.era ?? m?.period),
            source: stringVal(raw?.source ?? raw?.src ?? m?.source ?? m?.src)
        };
    }
    function normalizeJsonItem(raw) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
        const q = stringVal(raw.question ?? raw.q ?? raw.prompt ?? raw.text ?? raw.body);
        const a = stringVal(raw.answer ?? raw.a ?? raw.response ?? raw.correct ?? raw.solution);
        if (!q || !a) return null;
        const aliases = [...toAliasArray(raw.aliases), ...toAliasArray(raw.accept),
            ...toAliasArray(raw.accepted), ...toAliasArray(raw.alts)];
        return { id: stringVal(raw.id) || uid(), question: q, answer: a, aliases, meta: normalizeMeta(raw) };
    }
    function extractQuestionArray(obj) {
        if (Array.isArray(obj)) return obj;
        if (!obj || typeof obj !== 'object') return null;
        const direct = ['items', 'questions', 'data', 'records', 'rows'];
        for (const k of direct) if (Array.isArray(obj[k])) return obj[k];
        const nested = ['set', 'questionSet', 'payload', 'result', 'results'];
        for (const k of nested) {
            const v = obj[k];
            if (!v || typeof v !== 'object') continue;
            for (const kk of direct) if (Array.isArray(v[kk])) return v[kk];
        }
        return null;
    }
    /** Returns {type:'set'|'library', set?|sets?} or null */
    function parseJsonImport(obj, fallbackName = 'Imported JSON') {
        if (!obj || typeof obj !== 'object') return null;
        if (Array.isArray(obj.sets)) {
            const sets = [];
            obj.sets.forEach((s, i) => {
                const items = (extractQuestionArray(s) || []).map(normalizeJsonItem).filter(Boolean);
                if (items.length) sets.push({ id: stringVal(s?.id) || uid(), name: stringVal(s?.name) || `Set ${i + 1}`, items });
            });
            if (sets.length) return { type: 'library', sets, activeSetId: stringVal(obj.activeSetId) || sets[0]?.id };
        }
        const items = (extractQuestionArray(obj) || []).map(normalizeJsonItem).filter(Boolean);
        if (!items.length) return null;
        return { type: 'set', set: { id: stringVal(obj.id) || uid(), name: stringVal(obj.name) || fallbackName, items } };
    }

    /* ---------------- upload flow ---------------- */
    function handleLoadedText(text, filename) {
        let obj;
        try { obj = JSON.parse(text); }
        catch (e) { return showParseResult(false, `Invalid JSON: ${e.message}`); }
        const parsed = parseJsonImport(obj, filename || 'Imported JSON');
        if (!parsed) return showParseResult(false, 'No valid questions found. Each question needs a "question" and "answer" field (aliases q/a/prompt/correct also work).');
        let chosen;
        if (parsed.type === 'library') {
            chosen = parsed.sets.find(s => s.id === parsed.activeSetId) || parsed.sets[0];
            if (parsed.sets.length > 1) {
                showParseResult(false, `Found a library with ${parsed.sets.length} sets; using "${chosen.name}" (${chosen.items.length} questions). Merge sets manually if you want them all.`);
            }
        } else chosen = parsed.set;
        App.set = chosen;
        App.filters = { cats: [], eras: [], src: '' };
        const eras = [...new Set(chosen.items.map(it => it.meta.era).filter(Boolean))];
        const cats = [...new Set(chosen.items.map(it => it.meta.category).filter(Boolean))];
        const extras = cats.length + eras.length ? '' : ' No category/era metadata detected — filters will be empty and every question matches.';
        showParseResult(true, `✓ Loaded “${esc(chosen.name)}” — <b>${chosen.items.length}</b> valid questions.` +
            (cats.length ? ` ${cats.length} region(s), ` : '') + (eras.length ? `${eras.length} era(s).` : '') + extras, () => {
            $('btn-new-set').hidden = false;
            buildSetupView();
            switchView('view-setup');
        });
    }
    function showParseResult(ok, html, onContinue) {
        const el = $('parse-result');
        el.hidden = false;
        el.className = 'parse-result' + (ok ? '' : ' error');
        el.innerHTML = `<div>${html}</div>` + (ok ? '<button class="btn primary" id="btn-continue" style="margin-top:10px;">Continue →</button>' : '');
        if (ok) $('btn-continue').onclick = onContinue;
    }
    function readFile(file) {
        const r = new FileReader();
        r.onload = () => handleLoadedText(String(r.result), file.name.replace(/\.json$/i, ''));
        r.onerror = () => showParseResult(false, 'Could not read the file.');
        r.readAsText(file);
    }

    /* ---------------- setup / filters ---------------- */
    function activeItems() { return App.set ? App.set.items : []; }

    function buildSetupView() {
        $('set-summary').textContent = App.set ? `${App.set.name} • ${App.set.items.length} questions` : '';
        const items = activeItems();
        const cats = [...new Set(items.map(it => it.meta.category).filter(Boolean))].sort();
        const eras = [...new Set(items.map(it => it.meta.era).filter(Boolean))].sort();
        const srcs = [...new Set(items.map(it => (it.meta.source || 'original').toLowerCase()).filter(Boolean))].sort();
        renderChips('cat-chips', cats, App.filters.cats, (v, on) => {
            App.filters.cats = on ? [...App.filters.cats, v] : App.filters.cats.filter(x => x !== v);
            updatePoolCount();
        });
        renderChips('era-chips', eras.map(e => `${e} — ${ERA_NAMES[e] || e}`), [], (v, on) => {
            const code = v.slice(0, 2);
            App.filters.eras = on ? [...App.filters.eras, code] : App.filters.eras.filter(x => x !== code);
            updatePoolCount();
        }, App.filters.eras.map(e => `${e} — ${ERA_NAMES[e] || e}`));
        renderChips('src-chips', srcs, [], (v, on) => {
            App.filters.src = on ? v : '';
            [...$('src-chips').querySelectorAll('.chip')].forEach(c => { if (c.textContent !== v) c.classList.remove('active'); });
            updatePoolCount();
        });
        // reset length chips to 10
        [...$('len-chips').querySelectorAll('.chip')].forEach(c => c.classList.toggle('active', c.dataset.n === '10'));
        $('len-custom').hidden = true;
        App.size = 10;
        updatePoolCount();
    }
    function renderChips(containerId, values, activeList, onToggle, activeLabels) {
        const box = $(containerId);
        box.innerHTML = '';
        if (!values.length) { box.innerHTML = '<span class="muted" style="font-size:13px;">None detected in this set</span>'; return; }
        values.forEach(v => {
            const b = document.createElement('button');
            b.className = 'chip';
            b.textContent = v;
            if (activeList.includes(v) || (activeLabels && activeLabels.includes(v))) b.classList.add('active');
            b.onclick = () => { b.classList.toggle('active'); onToggle(v, b.classList.contains('active')); };
            box.appendChild(b);
        });
    }
    function buildFilteredPool() {
        let arr = activeItems().slice();
        if (App.filters.cats.length) arr = arr.filter(it => App.filters.cats.includes(it.meta.category || ''));
        if (App.filters.eras.length) arr = arr.filter(it => App.filters.eras.includes(it.meta.era || ''));
        if (App.filters.src) arr = arr.filter(it => String(it.meta.source || 'original').toLowerCase() === App.filters.src);
        return arr;
    }
    function updatePoolCount() { $('pool-count').textContent = buildFilteredPool().length; }

    /* ---------------- session ---------------- */
    const shuffle = (n) => [...Array(n).keys()].sort(() => Math.random() - 0.5);
    function switchView(id) {
        ['view-upload', 'view-setup', 'view-session', 'view-results'].forEach(v => $(v).hidden = v !== id);
        window.scrollTo(0, 0);
    }
    function startSession() {
        App.pool = buildFilteredPool();
        if (!App.pool.length) { alert('No questions match the current filters. Loosen a filter and try again.'); return; }
        App.order = shuffle(App.pool.length);
        if (App.size !== 'all') App.order = App.order.slice(0, Math.min(App.pool.length, Number(App.size) || 10));
        App.i = -1; App.correct = 0; App.answered = 0; App.wrongLog = [];
        switchView('view-session');
        nextQuestion();
    }
    function updateHeader() {
        $('drill-progress').textContent = `${Math.max(0, App.i + 1)} / ${App.order.length}`;
        $('drill-correct').textContent = String(App.correct);
        $('drill-acc').textContent = App.answered ? Math.round(App.correct / App.answered * 100) + '%' : '—';
        $('barfill').style.width = (App.order.length ? (Math.max(0, App.i) / App.order.length * 100) : 0) + '%';
    }
    function metaPills(item) {
        const parts = [];
        if (item.meta.category) parts.push(`<span class="pill">${esc(item.meta.category)}</span>`);
        if (item.meta.era) parts.push(`<span class="pill">${esc(ERA_NAMES[item.meta.era] || item.meta.era)}</span>`);
        if (item.meta.source) parts.push(`<span class="pill">${esc(item.meta.source)}</span>`);
        return parts.join('') || '<span class="pill">Question</span>';
    }
    function nextQuestion() {
        App.i++;
        if (App.i >= App.order.length) return endSession();
        App.curItem = App.pool[App.order[App.i]];
        App.phase = 'typing'; App.submitBusy = false;
        $('q-meta').innerHTML = metaPills(App.curItem);
        $('q-text').textContent = App.curItem.question;
        $('answer').hidden = true; $('answer').className = 'answer-box'; $('answer').innerHTML = '';
        $('grade-row').hidden = true;
        $('status').textContent = '';
        $('typing-row').style.display = '';
        const inp = $('user-answer');
        inp.disabled = false; inp.value = ''; inp.focus();
        $('btn-submit-answer').disabled = false;
        updateHeader();
        startCountdown();
    }
    function startCountdown() {
        if (App.cdIv) { clearInterval(App.cdIv); App.cdIv = null; }
        const big = $('countdown-big'), small = $('countdown');
        if (!App.timer) { big.textContent = ''; small.textContent = '∞'; return; }
        let t = App.timer;
        big.textContent = t; small.textContent = t; big.classList.remove('urgent'); small.classList.remove('urgent');
        App.cdIv = setInterval(() => {
            t--;
            big.textContent = Math.max(t, 0); small.textContent = Math.max(t, 0);
            if (t <= 3) { big.classList.add('urgent'); small.classList.add('urgent'); }
            if (t <= 0) { clearInterval(App.cdIv); App.cdIv = null; big.textContent = ''; submitAnswer(true); }
        }, 1000);
    }

    /* ---------------- grading ---------------- */
    const normalize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    function basicMatch(u, gold, aliases) {
        const nu = normalize(u), ng = normalize(gold);
        if (nu && nu === ng) return true;
        for (const a of (aliases || [])) if (nu && nu === normalize(a)) return true;
        return false;
    }
    function lenientMatch(u, gold, aliases) {
        if (basicMatch(u, gold, aliases)) return true;
        const nu = normalize(u), targets = [normalize(gold), ...(aliases || []).map(normalize)].filter(Boolean);
        if (!nu) return false;
        const sim = (a, b) => {
            const d = levenshtein(a, b);
            return 1 - d / Math.max(a.length, b.length);
        };
        return targets.some(t => sim(nu, t) >= 0.84 || (t.length > 4 && t.includes(nu) && nu.length >= Math.floor(t.length * 0.7)));
    }
    function levenshtein(a, b) {
        const m = a.length, n = b.length;
        if (!m) return n; if (!n) return m;
        let prev = Array.from({ length: n + 1 }, (_, i) => i);
        for (let i = 1; i <= m; i++) {
            const cur = [i];
            for (let j = 1; j <= n; j++) {
                cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            }
            prev = cur;
        }
        return prev[n];
    }
    function getDeepSeekKey() {
        const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
        return stringVal(saved.apiKey) || stringVal(window.PRACTICE_HUB_CONFIG?.deepseekApiKey);
    }
    function getDeepSeekModel() {
        const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
        return stringVal(saved.model) || stringVal(window.PRACTICE_HUB_CONFIG?.deepseekModel) || 'deepseek-chat';
    }
    /** Ask the server proxy (uses DEEPSEEK_API_KEY env var) when available. */
    async function gradeViaProxy(payload) {
        const res = await fetch('/api/grade', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(`proxy ${res.status}`);
        return res.json();
    }
    /** Direct browser call — works only if the host/key permits it; falls back otherwise. */
    async function gradeViaDeepSeekDirect(payload) {
        const key = getDeepSeekKey();
        if (!key) throw new Error('no key');
        const model = getDeepSeekModel();
        const messages = [
            { role: 'system', content: [
                'You are an IHBB short-answer grader.',
                'Be lenient on spelling and minor phonetic variations when the intended answer is clear.',
                'If the student answer is understandable and the phonics line up with the expected answer, mark it correct instead of penalizing small spelling mistakes.',
                'Return only JSON: {"correct":boolean,"reason":string}.'
            ].join(' ') },
            { role: 'user', content: JSON.stringify({ question: payload.question, expected: payload.expected, aliases: payload.aliases, user_answer: payload.answer, strict: !!payload.strict }) }
        ];
        const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({ model, messages, response_format: { type: 'json_object' }, temperature: 0.0, max_tokens: 220 })
        });
        if (!res.ok) throw new Error(`deepseek ${res.status}`);
        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content?.trim();
        try { return JSON.parse(content); } catch { throw new Error('bad deepseek json'); }
    }

    async function submitAnswer(auto = false) {
        if (App.submitBusy || App.phase !== 'typing') return;
        App.submitBusy = true;
        if (App.cdIv) { clearInterval(App.cdIv); App.cdIv = null; }
        $('countdown-big').textContent = '';
        const inp = $('user-answer');
        const userAns = inp.value;
        inp.disabled = true; $('btn-submit-answer').disabled = true;
        const item = App.curItem || { question: '', answer: '', aliases: [] };
        App.phase = 'grading';
        $('status').textContent = auto ? 'Time! Grading…' : 'Grading…';
        const localCorrect = App.strict ? basicMatch(userAns, item.answer, item.aliases) : lenientMatch(userAns, item.answer, item.aliases);

        let correct = localCorrect, reason = '';
        const payload = {
            question: item.question, question_id: item.id, expected: item.answer,
            aliases: item.aliases || [], answer: userAns, user_answer: userAns, strict: App.strict
        };
        const useAI = !localCorrect; // only consult AI when local match failed
        if (useAI) {
            try {
                let out = null;
                try { out = await gradeViaProxy(payload); }           // 1) server proxy w/ env var
                catch { out = await gradeViaDeepSeekDirect(payload); } // 2) direct call w/ configured key
                if (out && typeof out.correct === 'boolean') {
                    correct = !!out.correct;
                    reason = String(out.reason || '');
                    if (!correct && !App.strict && /(spell|typo|phon|pronoun|misspell|capital)/i.test(reason) && lenientMatch(userAns, item.answer, item.aliases)) {
                        correct = true; reason = 'Accepted with lenient spelling matching.';
                    }
                }
            } catch (e) {
                reason = getDeepSeekKey() || true ? '' : '';
                if (String(e.message) !== 'no key') reason = '';
                // fall back silently to local verdict
            }
        }
        if (!reason) reason = localCorrect ? 'Matched locally.' : (correct ? 'Accepted by AI grader.' : 'No matching answer.');
        finishGrading(item, userAns, correct, reason, auto);
    }
    function finishGrading(item, userAns, correct, reason, auto) {
        App.phase = 'graded';
        App.answered++;
        if (correct) App.correct++;
        else App.wrongLog.push({ question: item.question, answer: item.answer, user: userAns || '(no answer)', meta: item.meta });
        App.submitted = { item, userAns, correct, reason, auto };
        const box = $('answer');
        box.hidden = false;
        box.className = 'answer-box ' + (correct ? 'correct' : 'wrong');
        const aliasTxt = item.aliases?.length ? `<div class="muted" style="margin-top:6px;font-size:13px;">Also accepted: ${esc(item.aliases.slice(0, 4).join(', '))}</div>` : '';
        box.innerHTML = `<div>${correct ? '✓' : '✗'} <span class="gold">${esc(item.answer)}</span> — ${esc(reason)}${auto && !userAns ? ' <span class="muted">(timed out)</span>' : ''}</div>${aliasTxt}`;
        $('typing-row').style.display = 'none';
        $('grade-row').hidden = false;
        $('btn-next').focus();
        $('status').textContent = '';
        updateHeader();
    }

    /* ---------------- results ---------------- */
    function endSession() {
        if (App.cdIv) { clearInterval(App.cdIv); App.cdIv = null; }
        App.phase = 'idle';
        const total = App.answered;
        $('results-summary').innerHTML =
            `You answered <b>${App.correct}</b> of <b>${total}</b> correctly — ` +
            `${total ? Math.round(App.correct / total * 100) : 0}% accuracy.`;
        const list = $('wrong-list');
        list.innerHTML = App.wrongLog.length ? '<h2>Missed questions</h2>' : '<h2>Perfect run — nothing missed! 🎉</h2>';
        App.wrongLog.forEach(w => {
            const d = document.createElement('div');
            d.className = 'wrong-item';
            const pills = [w.meta?.category, w.meta?.era && (ERA_NAMES[w.meta.era] || w.meta.era)].filter(Boolean).join(' • ');
            d.innerHTML = `<div class="q">${esc(w.question)}</div>` +
                (pills ? `<div class="muted" style="font-size:12px;margin-top:2px;">${esc(pills)}</div>` : '') +
                `<div class="a">Answer: ${esc(w.answer)}</div>` +
                `<div class="u">You: ${esc(w.user)}</div>`;
            list.appendChild(d);
        });
        switchView('view-results');
    }

    /* ---------------- settings dialog ---------------- */
    function openSettings() {
        const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
        $('api-key-input').value = saved.apiKey || '';
        $('model-input').value = saved.model || '';
        $('env-status').textContent = 'Tip: run "node server.js" with DEEPSEEK_API_KEY set to avoid storing a key in the browser. Current browser key: ' +
            (getDeepSeekKey() ? 'configured' : 'not set');
        $('settings-dialog').showModal();
    }

    /* ---------------- wiring ---------------- */
    document.addEventListener('DOMContentLoaded', () => {
        const dz = $('dropzone'), fi = $('file-input');
        dz.onclick = () => fi.click();
        dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('dragover'); };
        dz.ondragleave = () => dz.classList.remove('dragover');
        dz.ondrop = (e) => {
            e.preventDefault(); dz.classList.remove('dragover');
            const f = e.dataTransfer.files?.[0];
            if (f) readFile(f);
        };
        fi.onchange = () => { if (fi.files?.[0]) readFile(fi.files[0]); fi.value = ''; };
        $('btn-parse-paste').onclick = () => {
            const t = $('paste-area').value.trim();
            if (!t) return showParseResult(false, 'Paste some JSON first.');
            handleLoadedText(t, 'Pasted JSON');
        };
        $('btn-load-sample').onclick = () => {
            fetch('sample-questions.json').then(r => r.text()).then(t => handleLoadedText(t, 'Sample Uploaded Set'))
                .catch(() => showParseResult(false, 'Could not load sample-questions.json'));
        };
        $('btn-new-set').onclick = () => { $('parse-result').hidden = true; switchView('view-upload'); };

        $('len-chips').addEventListener('click', (e) => {
            const chip = e.target.closest('.chip'); if (!chip) return;
            [...$('len-chips').querySelectorAll('.chip')].forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            if (chip.dataset.n === 'custom') {
                $('len-custom').hidden = false; $('len-custom').focus();
                App.size = Math.max(1, Math.min(500, Number($('len-custom').value) || 10));
            } else {
                $('len-custom').hidden = true;
                App.size = chip.dataset.n === 'all' ? 'all' : Number(chip.dataset.n);
            }
        });
        $('len-custom').oninput = () => { App.size = Math.max(1, Math.min(500, Number($('len-custom').value) || 1)); };
        $('timer-select').onchange = (e) => { App.timer = Number(e.target.value); };
        $('strict-mode').onchange = (e) => { App.strict = e.target.checked; };

        $('btn-start').onclick = startSession;
        $('btn-submit-answer').onclick = () => submitAnswer(false);
        $('user-answer').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAnswer(false); });
        $('btn-give-up').onclick = () => {
            if (App.phase !== 'typing') return;
            $('user-answer').value = '';
            submitAnswer(true);
        };
        $('btn-next').onclick = () => { if (App.phase === 'graded') nextQuestion(); };
        $('btn-mark-right').onclick = () => {
            if (App.phase !== 'graded' || App.correcting) return;
            App.correcting = true;
            if (!App.submitted.correct) { App.correct++; App.wrongLog = App.wrongLog.filter(w => w.question !== App.submitted.item.question); }
            App.submitted.correct = true;
            updateHeader();
            $('answer').className = 'answer-box correct';
            $('status').textContent = 'Marked correct.';
            App.correcting = false;
        };
        $('btn-mark-wrong').onclick = () => {
            if (App.phase !== 'graded' || App.correcting) return;
            App.correcting = true;
            if (App.submitted.correct) { App.correct--; App.wrongLog.push({ question: App.submitted.item.question, answer: App.submitted.item.answer, user: App.submitted.userAns || '(no answer)', meta: App.submitted.item.meta }); }
            App.submitted.correct = false;
            updateHeader();
            $('answer').className = 'answer-box wrong';
            $('status').textContent = 'Marked wrong.';
            App.correcting = false;
        };
        $('btn-end').onclick = () => { if (confirm('End this session early and see results?')) endSession(); };
        $('btn-again-same').onclick = startSession;
        $('btn-back-setup').onclick = () => switchView('view-setup');

        $('btn-settings').onclick = openSettings;
        $('btn-settings-close').onclick = () => $('settings-dialog').close();
        $('btn-settings-save').onclick = () => {
            localStorage.setItem(LS_KEY, JSON.stringify({ apiKey: $('api-key-input').value.trim(), model: $('model-input').value.trim() }));
            $('settings-dialog').close();
        };
    });
})();
