// livebee.js — Live Bee Room: real-time multiplayer buzzer
document.addEventListener('DOMContentLoaded', async () => {
    const sb = window.supabaseClient;
    const guard = document.getElementById('auth-guard');
    if (!sb) { if (guard) guard.remove(); return; }

    // ==================== AUTH ====================
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { window.location.replace('login.html'); return; }
    const uid = session.user.id;

    const { data: profile } = await sb.from('profiles').select('role, display_name').eq('id', uid).single();
    if (!profile || !profile.role) { window.location.replace('onboarding.html'); return; }
    if (guard) guard.remove();

    const isHost = profile.role === 'teacher';
    const myName = profile.display_name || (isHost ? 'Teacher' : 'Student');

    // Back button
    document.getElementById('btn-back').href = isHost ? 'teacher.html' : 'student.html';
    document.getElementById('btn-back-dashboard').href = isHost ? 'teacher.html' : 'student.html';

    // ==================== HELPERS ====================
    const $ = id => document.getElementById(id);
    function showView(id) {
        document.querySelectorAll('.bee-view').forEach(v => v.classList.remove('active'));
        const el = $(id); if (el) el.classList.add('active');
    }
    function showAlert(msg, type = 'error') {
        const el = $('alert-box');
        el.textContent = msg; el.className = `alert ${type}`; el.classList.remove('hidden');
        setTimeout(() => el.classList.add('hidden'), 4000);
    }
    function waitForSubscription(ch) {
        return new Promise((resolve, reject) => {
            let done = false;
            ch.subscribe(status => {
                if (done) return;
                if (status === 'SUBSCRIBED') {
                    done = true;
                    resolve();
                    return;
                }
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                    done = true;
                    reject(new Error('Realtime channel status: ' + status));
                }
            });
        });
    }
    function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
    function genCode() { return Math.random().toString(36).substring(2, 8).toUpperCase(); }

    // ==================== SOUND EFFECTS ====================
    let audioCtx = null;
    function getAudioCtx() {
        if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { } }
        return audioCtx;
    }
    function playTone(freq, dur, type = 'sine') {
        const ctx = getAudioCtx(); if (!ctx) return;
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.frequency.value = freq; o.type = type;
        g.gain.setValueAtTime(0.0001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
        o.start(); o.stop(ctx.currentTime + dur);
    }
    function dingCorrect() { playTone(880, 0.15); setTimeout(() => playTone(1320, 0.2), 120); }
    function buzzWrong() { playTone(150, 0.35, 'sawtooth'); }
    function buzzInSound() { playTone(660, 0.08); }

    // ==================== TTS ====================
    const VOICE_PREF = [/Microsoft .* Online .*Natural/i, /Google US English/i, /en[-_]?US/i];
    function getBestVoice() {
        const all = speechSynthesis.getVoices();
        const eng = all.filter(v => /^en(-|_)?/i.test(v.lang) || /English/i.test(v.name));
        for (const p of VOICE_PREF) { const m = eng.find(v => p.test(v.name) || p.test(v.lang || '')); if (m) return m; }
        return eng[0] || all[0] || null;
    }
    function ttsSpeak(text) {
        return new Promise(resolve => {
            try { speechSynthesis.cancel(); } catch { }
            const u = new SpeechSynthesisUtterance(text);
            const v = getBestVoice(); if (v) u.voice = v;
            u.rate = 1.0;
            let done = false;
            const finish = () => { if (done) return; done = true; resolve(); };
            const t = setTimeout(() => { try { speechSynthesis.cancel(); } catch { } finish(); }, 30000);
            u.onend = () => { clearTimeout(t); finish(); };
            u.onerror = () => { clearTimeout(t); finish(); };
            speechSynthesis.speak(u);
        });
    }
    function ttsStop() { try { speechSynthesis.cancel(); } catch { } }
    function ttsSentences(text) {
        return (text.replace(/\s+/g, ' ').match(/[^.!?;—]+[.!?;—]?/g) || [text]).map(s => s.trim()).filter(Boolean);
    }

    // ==================== QUESTIONS ====================
    let allQuestions = [];
    let selectedQuestions = [];
    try {
        const res = await fetch('questions.json');
        const json = await res.json();
        allQuestions = Array.isArray(json) ? json : (json.items || json.questions || json.sets?.[0]?.items || []);
    } catch { console.warn('Could not load questions.json'); }

    const ERA_LABELS = {
        "01": "8000 BCE – 600 BCE", "02": "600 BCE – 600 CE", "03": "600 CE – 1450 CE",
        "04": "1450 CE – 1750 CE", "05": "1750 – 1914", "06": "1914 – 1991", "07": "1991 – Present"
    };

    // ==================== GAME STATE ====================
    let room = null;         // { id, code, host_id, status }
    let channel = null;      // Supabase Realtime channel
    let players = {};        // { [userId]: { name, score } }
    let gameQuestions = [];   // Array of { question, answer, aliases, meta }
    let questionIndex = -1;
    let buzzQueue = [];       // Ordered by arrival at host
    let currentBuzzer = null; // userId of who's currently answering
    let answerTimeout = null;
    let ttsAborted = false;
    let isReading = false;
    let activeRoundId = null;

    // ==================== LOBBY ====================
    if (isHost) {
        $('lobby-host').classList.remove('hidden');
    } else {
        $('lobby-join').classList.remove('hidden');
    }

    // Teacher: Create Room
    $('btn-create-room')?.addEventListener('click', async () => {
        const code = genCode();
        const { data, error } = await sb.from('bee_rooms').insert({ code, host_id: uid, status: 'waiting' }).select().single();
        if (error) { showAlert('Failed to create room: ' + error.message); return; }
        room = data;
        players[uid] = { name: myName, score: 0 };
        await sb.from('bee_participants').insert({ room_id: room.id, user_id: uid, display_name: myName, score: 0 });
        enterWaitingRoom();
    });

    // Student: Join Room
    $('btn-join-room')?.addEventListener('click', async () => {
        const code = ($('join-code').value || '').trim().toUpperCase();
        if (!code || code.length < 4) { showAlert('Please enter a valid room code.'); return; }

        const { data: r } = await sb.from('bee_rooms').select('*').eq('code', code).single();
        if (!r) { showAlert('Room not found. Check the code.'); return; }
        if (r.status === 'finished') { showAlert('This room has already ended.'); return; }

        // Check capacity
        const { data: parts } = await sb.from('bee_participants').select('user_id').eq('room_id', r.id);
        if (parts && parts.length >= 8) { showAlert('Room is full (max 8 players).'); return; }

        // Join
        const { error } = await sb.from('bee_participants').insert({ room_id: r.id, user_id: uid, display_name: myName, score: 0 });
        if (error && error.code === '23505') { /* already in */ }
        else if (error) { showAlert('Failed to join: ' + error.message); return; }

        room = r;
        enterWaitingRoom();
    });

    // ==================== WAITING ROOM ====================
    async function enterWaitingRoom() {
        showView('view-waiting');
        $('room-code-display').textContent = room.code;
        $('btn-leave').classList.remove('hidden');

        if (isHost) {
            $('host-controls').classList.remove('hidden');
            $('waiting-status').textContent = 'Set up questions, then start when ready.';
            setupHostQuestionUI();
        }

        // Subscribe to Realtime channel
        channel = sb.channel('bee:' + room.code, { config: { broadcast: { self: true } } });

        channel.on('broadcast', { event: 'player_join' }, ({ payload }) => {
            players[payload.userId] = { name: payload.name, score: 0 };
            renderPlayerList();
        });

        channel.on('broadcast', { event: 'player_leave' }, ({ payload }) => {
            delete players[payload.userId];
            renderPlayerList();
        });

        channel.on('broadcast', { event: 'game_start' }, ({ payload }) => {
            gameQuestions = payload.questions || [];
            questionIndex = -1;
            showView('view-game');
            updateGameProgress();
            renderScoreboard();
        });

        channel.on('broadcast', { event: 'question' }, ({ payload }) => {
            handleNewQuestion(payload);
        });

        channel.on('broadcast', { event: 'buzz_ack' }, ({ payload }) => {
            handleBuzzAck(payload);
        });

        channel.on('broadcast', { event: 'your_turn' }, ({ payload }) => {
            handleYourTurn(payload);
        });

        channel.on('broadcast', { event: 'answer_show' }, ({ payload }) => {
            handleAnswerShow(payload);
        });

        channel.on('broadcast', { event: 'result' }, ({ payload }) => {
            handleResult(payload);
        });

        channel.on('broadcast', { event: 'result_update' }, ({ payload }) => {
            handleResultUpdate(payload);
        });

        channel.on('broadcast', { event: 'scores' }, ({ payload }) => {
            Object.entries(payload.scores).forEach(([id, s]) => {
                if (players[id]) players[id].score = s;
            });
            renderScoreboard();
        });

        channel.on('broadcast', { event: 'reveal' }, ({ payload }) => {
            handleReveal(payload);
        });

        channel.on('broadcast', { event: 'game_end' }, ({ payload }) => {
            handleGameEnd(payload);
        });

        channel.on('broadcast', { event: 'tts_stop' }, () => {
            ttsStop();
            ttsAborted = true;
        });

        if (isHost) {
            channel.on('broadcast', { event: 'buzz' }, ({ payload }) => {
                handleHostBuzz(payload);
            });

            channel.on('broadcast', { event: 'answer_submit' }, ({ payload }) => {
                void handleHostAnswerSubmit(payload);
            });
        }

        try {
            await waitForSubscription(channel);
        } catch {
            showAlert('Realtime connection failed. Please refresh and rejoin the room.');
            return;
        }

        // Announce presence
        channel.send({ type: 'broadcast', event: 'player_join', payload: { userId: uid, name: myName } });

        // Load current participants from DB
        const { data: parts } = await sb.from('bee_participants').select('user_id, display_name, score').eq('room_id', room.id);
        (parts || []).forEach(p => { players[p.user_id] = { name: p.display_name || 'Player', score: p.score || 0 }; });
        renderPlayerList();

        // If room is already active (late join)
        if (room.status === 'active') {
            showView('view-game');
            renderScoreboard();
        }
    }

    function renderPlayerList() {
        const el = $('player-list');
        const entries = Object.entries(players);
        if (!entries.length) { el.innerHTML = '<p class="muted">Waiting for players...</p>'; return; }
        el.innerHTML = entries.map(([id, p]) => {
            const isMe = id === uid;
            const badge = id === room?.host_id ? ' 👑' : '';
            return `<div class="score-entry">
                <span class="score-name" style="${isMe ? 'color: var(--accent);' : ''}">${esc(p.name)}${badge}${isMe ? ' (You)' : ''}</span>
            </div>`;
        }).join('');
        // Update start button
        const btn = $('btn-start-bee');
        if (btn) btn.disabled = selectedQuestions.length === 0;
    }

    // Leave room
    $('btn-leave')?.addEventListener('click', async () => {
        if (channel) {
            channel.send({ type: 'broadcast', event: 'player_leave', payload: { userId: uid } });
            sb.removeChannel(channel); channel = null;
        }
        if (room) {
            await sb.from('bee_participants').delete().eq('room_id', room.id).eq('user_id', uid);
            if (isHost) { await sb.from('bee_rooms').delete().eq('id', room.id); }
        }
        window.location.href = isHost ? 'teacher.html' : 'student.html';
    });

    // ==================== HOST: QUESTION SELECTION ====================
    let hostFilterCats = [];
    let hostFilterEras = [];

    function setupHostQuestionUI() {
        // Mode switching
        document.querySelectorAll('.bee-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.bee-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                document.querySelectorAll('.bee-mode-panel').forEach(p => p.classList.add('hidden'));
                const panel = $('bee-mode-' + btn.dataset.mode);
                if (panel) panel.classList.remove('hidden');
            });
        });

        // Random
        $('btn-bee-random')?.addEventListener('click', () => {
            const n = Math.max(1, Math.min(200, parseInt($('bee-random-count').value) || 10));
            const shuffled = [...allQuestions].sort(() => Math.random() - 0.5);
            selectedQuestions = shuffled.slice(0, Math.min(n, allQuestions.length));
            updatePreview();
        });

        // Filter chips
        const cats = [...new Set(allQuestions.map(q => q.meta?.category || q.category || '').filter(Boolean))].sort();
        const eras = [...new Set(allQuestions.map(q => q.meta?.era || q.era || '').filter(Boolean))].sort();
        renderFilterChips('bee-filter-cats', cats, hostFilterCats, v => { hostFilterCats = v; });
        renderFilterChips('bee-filter-eras', eras, hostFilterEras, v => { hostFilterEras = v; }, e => ERA_LABELS[e] || e);

        $('btn-bee-filter')?.addEventListener('click', () => {
            const n = Math.max(1, Math.min(200, parseInt($('bee-filter-count').value) || 10));
            const catSet = new Set(hostFilterCats);
            const eraSet = new Set(hostFilterEras);
            const pool = allQuestions.filter(q => {
                if (catSet.size && !catSet.has(q.meta?.category || q.category || '')) return false;
                if (eraSet.size && !eraSet.has(q.meta?.era || q.era || '')) return false;
                return true;
            });
            if (!pool.length) { showAlert('No questions match filters.'); return; }
            selectedQuestions = [...pool].sort(() => Math.random() - 0.5).slice(0, Math.min(n, pool.length));
            updatePreview();
        });

        // Hand pick
        let pickTimer;
        $('bee-pick-search')?.addEventListener('input', e => {
            clearTimeout(pickTimer);
            pickTimer = setTimeout(() => {
                const q = e.target.value.toLowerCase().trim();
                if (!q || q.length < 2) { $('bee-pick-results').innerHTML = ''; return; }
                const matches = allQuestions.filter(item => {
                    const ans = (item.answer || item.a || '').toLowerCase();
                    const ques = (item.question || item.q || '').toLowerCase();
                    return ans.includes(q) || ques.includes(q);
                }).slice(0, 40);
                $('bee-pick-results').innerHTML = matches.map((item, i) => {
                    const picked = selectedQuestions.some(s => (s.answer || s.a) === (item.answer || item.a) && (s.question || s.q) === (item.question || item.q));
                    return `<div class="pick-item ${picked ? 'selected' : ''}" data-idx="${i}">
                        <input type="checkbox" ${picked ? 'checked' : ''}>
                        <strong>${esc(item.answer || item.a || '')}</strong>
                        <span class="muted" style="flex:1">${esc((item.question || item.q || '').substring(0, 60))}…</span>
                    </div>`;
                }).join('');
                document.querySelectorAll('#bee-pick-results .pick-item').forEach(el => {
                    const idx = parseInt(el.dataset.idx);
                    const item = matches[idx];
                    el.addEventListener('click', evt => {
                        if (evt.target.matches('input[type=checkbox]')) return;
                        const cb = el.querySelector('input[type=checkbox]');
                        cb.checked = !cb.checked;
                        togglePick(item, cb.checked, el);
                    });
                    el.querySelector('input[type=checkbox]').addEventListener('change', evt => {
                        togglePick(item, evt.target.checked, el);
                    });
                });
            }, 300);
        });

        function togglePick(item, add, el) {
            if (add) { selectedQuestions.push(item); }
            else { selectedQuestions = selectedQuestions.filter(s => !((s.answer || s.a) === (item.answer || item.a) && (s.question || s.q) === (item.question || item.q))); }
            if (el) el.classList.toggle('selected', add);
            updatePreview();
        }

        $('btn-bee-clear')?.addEventListener('click', () => { selectedQuestions = []; updatePreview(); });

        // Start
        $('btn-start-bee')?.addEventListener('click', startBee);
    }

    function renderFilterChips(containerId, values, selected, onUpdate, labelFn) {
        const wrap = $(containerId); if (!wrap) return;
        wrap.innerHTML = '';
        const all = document.createElement('div');
        all.className = 'chip' + (selected.length ? '' : ' active');
        all.textContent = 'All';
        all.addEventListener('click', () => { onUpdate([]); renderFilterChips(containerId, values, [], onUpdate, labelFn); });
        wrap.appendChild(all);
        values.forEach(v => {
            const chip = document.createElement('div');
            chip.className = 'chip' + (selected.includes(v) ? ' active' : '');
            chip.textContent = labelFn ? labelFn(v) : v;
            chip.addEventListener('click', () => {
                const s = new Set(selected);
                if (s.has(v)) s.delete(v); else s.add(v);
                const next = Array.from(s);
                onUpdate(next);
                renderFilterChips(containerId, values, next, onUpdate, labelFn);
            });
            wrap.appendChild(chip);
        });
    }

    function updatePreview() {
        const area = $('bee-preview');
        if (!selectedQuestions.length) { area.classList.add('hidden'); $('btn-start-bee').disabled = true; return; }
        area.classList.remove('hidden');
        $('bee-preview-count').textContent = selectedQuestions.length;
        $('bee-preview-list').innerHTML = selectedQuestions.slice(0, 30).map(q =>
            `<div class="p-item"><strong>${esc(q.answer || q.a || '')}</strong> — ${esc((q.question || q.q || '').substring(0, 80))}…</div>`
        ).join('');
        $('btn-start-bee').disabled = false;
    }

    // ==================== HOST: START BEE ====================
    async function startBee() {
        if (!selectedQuestions.length) return;

        // Normalize questions
        gameQuestions = selectedQuestions.map(q => ({
            question: q.question || q.q || '',
            answer: q.answer || q.a || '',
            aliases: q.aliases || [],
            meta: q.meta || {}
        }));

        // Update room status
        await sb.from('bee_rooms').update({ status: 'active' }).eq('id', room.id);

        // Broadcast game start
        channel.send({
            type: 'broadcast', event: 'game_start',
            payload: { questions: gameQuestions }
        });

        showView('view-game');
        questionIndex = -1;
        updateGameProgress();
        renderScoreboard();
        setTimeout(() => hostNextQuestion(), 500);
    }

    // ==================== HOST: QUESTION FLOW ====================
    async function hostNextQuestion() {
        questionIndex++;
        if (questionIndex >= gameQuestions.length) { endBee(); return; }

        const q = gameQuestions[questionIndex];
        buzzQueue = [];
        currentBuzzer = null;
        ttsAborted = false;
        activeRoundId = `${questionIndex}:${Date.now()}`;
        clearTimeout(answerTimeout);

        // Broadcast question
        channel.send({
            type: 'broadcast', event: 'question',
            payload: { index: questionIndex, total: gameQuestions.length, question: q.question, roundId: activeRoundId }
        });

        updateGameProgress();

        // Host: read via TTS
        isReading = true;
        const sentences = ttsSentences(q.question);
        for (const s of sentences) {
            if (ttsAborted) break;
            await ttsSpeak(s);
        }
        isReading = false;

        // If nobody buzzed during reading, start a 5-second countdown then reveal
        if (!ttsAborted && buzzQueue.length === 0) {
            $('game-status').textContent = 'Time is running out...';
            answerTimeout = setTimeout(() => {
                revealAnswer();
            }, 5000);
        }
    }

    // ==================== HANDLING INCOMING EVENTS (ALL CLIENTS) ====================

    function handleNewQuestion(payload) {
        questionIndex = payload.index;
        buzzQueue = [];
        currentBuzzer = null;
        ttsAborted = false;
        activeRoundId = payload.roundId || `${payload.index}:fallback`;

        // Reset UI
        $('game-qi').textContent = payload.index + 1;
        $('game-qt').textContent = payload.total;
        $('game-barfill').style.width = ((payload.index + 1) / payload.total * 100) + '%';
        $('game-status').textContent = 'Listening...';
        $('buzz-queue').classList.add('hidden');
        $('answer-area').classList.add('hidden');
        $('answer-display').classList.add('hidden');
        $('correct-answer-reveal').classList.add('hidden');
        $('host-game-controls').classList.add('hidden');
        $('bee-answer-input').value = '';
        clearInterval(answerTimerInterval);
        $('answer-timer').textContent = '';

        // Enable buzz for students
        const buzzBtn = $('bee-buzz');
        if (!isHost) {
            buzzBtn.disabled = false;
            buzzBtn.classList.remove('disabled');
            buzzBtn.classList.add('pulse');
        }

        // Students: also read TTS
        if (!isHost) {
            isReading = true;
            ttsAborted = false;
            const sentences = ttsSentences(payload.question);
            (async () => {
                for (const s of sentences) {
                    if (ttsAborted) break;
                    await ttsSpeak(s);
                }
                isReading = false;
            })();
        }
    }

    function handleBuzzAck(payload) {
        // payload: { queue: [{userId, name}], currentBuzzer: userId }
        if (payload.roundId && activeRoundId && payload.roundId !== activeRoundId) return;
        buzzQueue = Array.isArray(payload.queue) ? payload.queue : [];
        currentBuzzer = payload.currentBuzzer || null;

        // Stop TTS for everyone
        ttsStop();
        ttsAborted = true;

        renderBuzzQueue();

        const buzzBtn = $('bee-buzz');
        // Disable buzz for everyone
        buzzBtn.disabled = true;
        buzzBtn.classList.add('disabled');
        buzzBtn.classList.remove('pulse');

        // If I'm the current buzzer, show answer input
        if (currentBuzzer === uid) {
            $('game-status').textContent = 'You buzzed! Type your answer:';
            $('answer-area').classList.remove('hidden');
            $('bee-answer-input').focus();
            startAnswerTimer(10);
        } else {
            const buzzerName = players[currentBuzzer]?.name || 'Someone';
            $('game-status').textContent = `${buzzerName} buzzed in!`;
            // Show "Your Turn" potential
            const myPos = buzzQueue.findIndex(b => b.userId === uid);
            if (myPos > 0) {
                $('game-status').textContent += ` (You're ${ordinal(myPos + 1)} in queue)`;
            }
        }
    }

    function handleYourTurn(payload) {
        if (payload.roundId && activeRoundId && payload.roundId !== activeRoundId) return;
        if (payload.userId !== uid) return;
        currentBuzzer = uid;
        $('game-status').innerHTML = '<div class="your-turn-banner">🔔 Your Turn! Type your answer:</div>';
        $('answer-area').classList.remove('hidden');
        $('answer-display').classList.add('hidden');
        $('bee-answer-input').value = '';
        $('bee-answer-input').focus();
        startAnswerTimer(10);
        buzzInSound();
    }

    function handleAnswerShow(payload) {
        // Show the answer a player typed to everyone
        const display = $('answer-display');
        display.classList.remove('hidden', 'answer-correct', 'answer-incorrect', 'answer-grading');
        display.classList.add('answer-grading');
        $('answer-player-name').textContent = payload.name + ' answered:';
        $('answer-text').textContent = payload.text;
        $('answer-verdict').textContent = '⏳ Grading...';
    }

    function handleResult(payload) {
        // payload: { userId, correct, reason, answer }
        const display = $('answer-display');
        display.classList.remove('answer-grading', 'answer-correct', 'answer-incorrect');
        clearInterval(answerTimerInterval);
        $('answer-timer').textContent = '';

        if (payload.correct) {
            display.classList.add('answer-correct');
            $('answer-verdict').textContent = '✅ Correct!';
            $('game-status').textContent = 'Correct answer!';
            dingCorrect();
            // Update local scores
            if (players[payload.userId]) players[payload.userId].score += 10;
            renderScoreboard();
        } else {
            display.classList.add('answer-incorrect');
            $('answer-verdict').textContent = payload.reason === 'Time ran out' ? '⏱ Time ran out' : '❌ Incorrect';
            $('game-status').textContent = payload.reason === 'Time ran out'
                ? `${players[payload.userId]?.name || 'Player'} ran out of time.`
                : 'Incorrect.';
            buzzWrong();
        }

        $('answer-area').classList.add('hidden');

        // Host: handle next in queue or show controls
        if (isHost) {
            if (payload.correct) {
                // Broadcast updated scores
                broadcastScores();
                // Show next question controls
                showHostControls();
            } else {
                // Try next in queue
                advanceQueue();
            }
        }
    }

    function handleResultUpdate(payload) {
        // DeepSeek overrode the quick-match verdict to correct
        if (payload.correct) {
            const display = $('answer-display');
            display.classList.remove('answer-incorrect');
            display.classList.add('answer-correct');
            $('answer-verdict').textContent = '✅ Correct! (confirmed by AI)';
            dingCorrect();
            if (players[payload.userId]) players[payload.userId].score += 10;
            renderScoreboard();
            if (isHost) {
                broadcastScores();
                showHostControls();
            }
        }
    }

    function handleReveal(payload) {
        const el = $('correct-answer-reveal');
        el.classList.remove('hidden');
        el.textContent = '📖 Answer: ' + payload.answer;
        if (isHost) showHostControls();
    }

    function handleGameEnd(payload) {
        ttsStop();
        showView('view-results');
        // Render final scoreboard
        const sorted = Object.entries(players)
            .filter(([id]) => id !== room?.host_id)
            .sort((a, b) => b[1].score - a[1].score);
        $('final-scoreboard').innerHTML = sorted.map(([id, p], i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
            const isMe = id === uid;
            return `<div class="score-entry" style="${isMe ? 'background: rgba(96,165,250,0.1); border-radius: 12px;' : ''}">
                <span class="score-rank">${medal}</span>
                <span class="score-name" style="${isMe ? 'color: var(--accent);' : ''}">${esc(p.name)}${isMe ? ' (You)' : ''}</span>
                <span class="score-points">${p.score} pts</span>
            </div>`;
        }).join('') || '<p class="muted">No players scored.</p>';
    }

    // ==================== BUZZ SYSTEM ====================
    function handleHostBuzz(payload) {
        if (!isHost || !payload?.userId) return;
        if (payload.roundId && activeRoundId && payload.roundId !== activeRoundId) return;
        // Lock after first accepted buzz.
        if (currentBuzzer) return;

        const name = payload.name || players[payload.userId]?.name || 'Player';
        buzzQueue = [{ userId: payload.userId, name }];
        currentBuzzer = payload.userId;

        clearTimeout(answerTimeout);
        channel.send({ type: 'broadcast', event: 'tts_stop', payload: {} });
        channel.send({
            type: 'broadcast',
            event: 'buzz_ack',
            payload: { queue: buzzQueue, currentBuzzer, roundId: activeRoundId }
        });
        startHostAnswerTimeout();
    }

    // Student: click buzz
    $('bee-buzz')?.addEventListener('click', () => {
        if (isHost || $('bee-buzz').disabled || !activeRoundId) return;
        // Send buzz to host for ordering and lockout.
        channel.send({
            type: 'broadcast',
            event: 'buzz',
            payload: { userId: uid, name: myName, roundId: activeRoundId }
        });
        buzzInSound();
        $('bee-buzz').disabled = true;
        $('bee-buzz').classList.add('disabled');
        $('bee-buzz').classList.remove('pulse');
    });

    // Keyboard: space to buzz
    document.addEventListener('keydown', e => {
        if (e.code === 'Space' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
            e.preventDefault();
            const buzzBtn = $('bee-buzz');
            if (buzzBtn && !buzzBtn.disabled && $('view-game')?.classList.contains('active')) {
                buzzBtn.click();
            }
        }
    });

    function startHostAnswerTimeout() {
        clearTimeout(answerTimeout);
        answerTimeout = setTimeout(() => {
            // Current buzzer timed out
            if (isHost) {
                channel.send({
                    type: 'broadcast', event: 'result',
                    payload: { userId: currentBuzzer, correct: false, reason: 'Time ran out' }
                });
                // advance queue handled by result handler
            }
        }, 12000); // 12 seconds (10 visible + 2 network buffer)
    }

    // ==================== ANSWER SUBMISSION ====================
    $('btn-submit-bee-answer')?.addEventListener('click', submitBeeAnswer);
    $('bee-answer-input')?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); submitBeeAnswer(); }
    });

    function submitBeeAnswer() {
        if (uid !== currentBuzzer || !activeRoundId) return;
        const text = ($('bee-answer-input').value || '').trim();
        if (!text) return;
        clearTimeout(answerTimeout);
        $('answer-area').classList.add('hidden');
        $('game-status').textContent = 'Answer submitted. Waiting for grading...';

        // Broadcast the answer text to everyone
        channel.send({
            type: 'broadcast', event: 'answer_submit',
            payload: { userId: uid, name: myName, text, roundId: activeRoundId }
        });
    }

    async function handleHostAnswerSubmit(payload) {
        if (!isHost || !payload?.userId) return;
        if (payload.roundId && activeRoundId && payload.roundId !== activeRoundId) return;
        if (payload.userId !== currentBuzzer) return;

        const text = String(payload.text || '').trim();
        if (!text) return;

        clearTimeout(answerTimeout);
        const q = gameQuestions[questionIndex];
        if (!q) return;

        // Show the typed answer to everyone immediately.
        channel.send({
            type: 'broadcast',
            event: 'answer_show',
            payload: {
                userId: payload.userId,
                name: payload.name || players[payload.userId]?.name || 'Player',
                text
            }
        });

        // Phase 1: fast local match.
        const quickCorrect = quickMatch(text, q.answer, q.aliases || []);
        if (quickCorrect) {
            channel.send({
                type: 'broadcast', event: 'result',
                payload: { userId: payload.userId, correct: true, reason: 'Exact match' }
            });
            return;
        }

        // Phase 2: DeepSeek grading.
        let deepseekResult = false;
        try {
            const resp = await fetch('/api/grade', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question: q.question,
                    answer: text,
                    expected: q.answer,
                    aliases: q.aliases || [],
                    strict: false
                })
            });
            const data = await resp.json();
            deepseekResult = !!data.correct;
        } catch { /* API failed, keep as wrong */ }

        channel.send({
            type: 'broadcast',
            event: 'result',
            payload: {
                userId: payload.userId,
                correct: deepseekResult,
                reason: deepseekResult ? 'Confirmed by AI' : 'Incorrect'
            }
        });
    }

    // Quick string match (case-insensitive, punctuation-stripped)
    function quickMatch(userAnswer, expected, aliases) {
        const norm = s => String(s || '').trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
        const u = norm(userAnswer);
        if (!u) return false;
        if (u === norm(expected)) return true;
        for (const a of aliases || []) { if (u === norm(a)) return true; }
        return false;
    }

    // ==================== QUEUE MANAGEMENT (HOST) ====================
    function advanceQueue() {
        // Remove current buzzer from queue
        buzzQueue = buzzQueue.filter(b => b.userId !== currentBuzzer);

        if (buzzQueue.length > 0) {
            // Next player in queue
            currentBuzzer = buzzQueue[0].userId;
            channel.send({ type: 'broadcast', event: 'your_turn', payload: { userId: currentBuzzer, roundId: activeRoundId } });
            channel.send({ type: 'broadcast', event: 'buzz_ack', payload: { queue: buzzQueue, currentBuzzer, roundId: activeRoundId } });
            startHostAnswerTimeout();
        } else {
            // No more buzzers — reveal answer
            revealAnswer();
        }
    }

    function revealAnswer() {
        const q = gameQuestions[questionIndex];
        if (!q) return;
        channel.send({ type: 'broadcast', event: 'reveal', payload: { answer: q.answer } });
    }

    function showHostControls() {
        if (isHost) {
            $('host-game-controls').classList.remove('hidden');
            $('btn-next-question').textContent = (questionIndex >= gameQuestions.length - 1) ? 'Finish Bee' : 'Next Question →';
        }
    }

    $('btn-next-question')?.addEventListener('click', () => {
        if (questionIndex >= gameQuestions.length - 1) { endBee(); }
        else { hostNextQuestion(); }
    });

    $('btn-end-bee')?.addEventListener('click', endBee);

    async function endBee() {
        // Save final scores to DB
        for (const [id, p] of Object.entries(players)) {
            try {
                await sb.from('bee_participants').update({ score: p.score }).eq('room_id', room.id).eq('user_id', id);
            } catch { }
        }
        await sb.from('bee_rooms').update({ status: 'finished' }).eq('id', room.id);

        channel.send({ type: 'broadcast', event: 'game_end', payload: {} });
    }

    function broadcastScores() {
        const scores = {};
        Object.entries(players).forEach(([id, p]) => { scores[id] = p.score; });
        channel.send({ type: 'broadcast', event: 'scores', payload: { scores } });
    }

    // ==================== UI HELPERS ====================
    function updateGameProgress() {
        $('game-qi').textContent = questionIndex + 1;
        $('game-qt').textContent = gameQuestions.length;
        $('game-barfill').style.width = ((questionIndex + 1) / gameQuestions.length * 100) + '%';
    }

    function renderBuzzQueue() {
        const el = $('buzz-queue');
        if (!buzzQueue.length) { el.classList.add('hidden'); return; }
        el.classList.remove('hidden');
        el.innerHTML = buzzQueue.map((b, i) => {
            const isCurrent = b.userId === currentBuzzer;
            const isMe = b.userId === uid;
            const label = i === 0 ? '🔴 Buzzer' : ordinal(i + 1);
            return `<div class="queue-badge ${isCurrent ? 'buzzer' : 'waiting'}" style="${isMe ? 'border-color: var(--accent);' : ''}">
                ${label}: ${esc(b.name)}${isMe ? ' (You)' : ''}
            </div>`;
        }).join('');
    }

    function renderScoreboard() {
        const el = $('scoreboard');
        const sorted = Object.entries(players)
            .filter(([id]) => id !== room?.host_id)
            .sort((a, b) => b[1].score - a[1].score);
        if (!sorted.length) { el.innerHTML = '<p class="muted">No players yet.</p>'; return; }
        el.innerHTML = sorted.map(([id, p], i) => {
            const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
            const isMe = id === uid;
            return `<div class="score-entry">
                <span class="score-rank ${rankClass}">${i + 1}</span>
                <span class="score-name" style="${isMe ? 'color: var(--accent);' : ''}">${esc(p.name)}${isMe ? ' (You)' : ''}</span>
                <span class="score-points">${p.score}</span>
            </div>`;
        }).join('');
    }

    let answerTimerInterval = null;
    function startAnswerTimer(seconds) {
        clearInterval(answerTimerInterval);
        let remaining = seconds;
        const el = $('answer-timer');
        el.textContent = `⏱ ${remaining}s`;
        answerTimerInterval = setInterval(() => {
            remaining--;
            el.textContent = remaining > 0 ? `⏱ ${remaining}s` : '';
            if (remaining <= 0) clearInterval(answerTimerInterval);
        }, 1000);
    }

    function ordinal(n) {
        const s = ['th', 'st', 'nd', 'rd'];
        const v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }
});
