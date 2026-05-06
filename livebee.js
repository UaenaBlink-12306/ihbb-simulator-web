// livebee.js — Live Bee Room: real-time multiplayer buzzer
document.addEventListener('DOMContentLoaded', async () => {
    const sb = window.supabaseClient;
    const guard = document.getElementById('auth-guard');
    if (!sb) { if (guard) guard.remove(); return; }

    // ==================== AUTH ====================
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { window.location.replace('login.html'); return; }
    const uid = session.user.id;

    const KEY_SETTINGS = `ihbb_v2_settings_${uid}`;
    const avatarCatalog = window.AvatarCatalog || {};
    const normalizeAvatarId = (value) => {
        if (typeof avatarCatalog.normalizeAvatarId === 'function') return avatarCatalog.normalizeAvatarId(value);
        return 'penguin';
    };
    const avatarAssetPath = (value) => {
        if (typeof avatarCatalog.avatarAssetPath === 'function') return avatarCatalog.avatarAssetPath(value);
        return `/assets/avatars/${normalizeAvatarId(value)}.png`;
    };
    const applyAvatarImage = (img, value, altText) => {
        if (!img) return;
        if (typeof avatarCatalog.applyAvatarImage === 'function') {
            avatarCatalog.applyAvatarImage(img, value, altText);
            return;
        }
        img.alt = altText || 'Avatar';
        img.src = avatarAssetPath(value);
    };

    const { data: profile } = await sb.from('profiles').select('role, display_name, avatar_id').eq('id', uid).single();
    if (!profile || !profile.role) { window.location.replace('onboarding.html'); return; }
    if (guard) guard.remove();

    let isHost = profile.role === 'teacher';
    const myRole = profile.role;
    const myName = profile.display_name || (myRole === 'teacher' ? 'Teacher' : 'Student');
    const myAvatarId = normalizeAvatarId(profile.avatar_id);

    // Back button - always point to the user's actual role dashboard
    const dashboardUrl = myRole === 'teacher' ? 'teacher.html' : 'student.html';
    document.getElementById('btn-back').href = dashboardUrl;
    document.getElementById('btn-back-dashboard').href = dashboardUrl;

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
    function userAvatarHtml(value, name, variant = 'default') {
        const resolvedAvatarId = normalizeAvatarId(value);
        const sizeMap = {
            default: 'width:44px;height:44px;border-radius:16px;',
            'user-avatar-small': 'width:40px;height:40px;border-radius:14px;',
            'user-avatar-tiny': 'width:28px;height:28px;border-radius:10px;',
            'user-avatar-podium': 'width:clamp(56px, 10vw, 72px);height:clamp(56px, 10vw, 72px);border-radius:24px;margin:0 auto 4px;'
        };
        const shellSize = sizeMap[variant] || sizeMap.default;
        return `<span style="${shellSize}flex:0 0 auto;display:inline-grid;place-items:center;overflow:hidden;border:1px solid rgba(125,211,252,0.48);background:radial-gradient(circle at 30% 24%, rgba(255,255,255,0.62), transparent 34%), linear-gradient(180deg, #dff4ff, #b8e2ff);box-shadow:inset 0 1px 0 rgba(255,255,255,0.6), 0 14px 24px -24px rgba(8,47,73,0.45);"><img data-avatar-id="${esc(resolvedAvatarId)}" src="${esc(avatarAssetPath(resolvedAvatarId))}" alt="${esc(name || 'Player')} avatar" style="width:80%;height:80%;display:block;object-fit:contain;transform:scale(1.12);transform-origin:center;"></span>`;
    }
    function hydrateAvatarImages(root) {
        const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
        scope.querySelectorAll('img[data-avatar-id]').forEach((img) => {
            applyAvatarImage(img, img.dataset.avatarId, img.alt || 'Avatar');
        });
    }
    function normalizePlayerRecord(player = {}) {
        return {
            name: String(player?.name || 'Player').trim() || 'Player',
            score: Number(player?.score) || 0,
            avatarId: normalizeAvatarId(player?.avatarId ?? player?.avatar_id)
        };
    }
    function upsertPlayer(userId, patch = {}) {
        const key = String(userId || '').trim();
        if (!key) return null;
        const next = normalizePlayerRecord({ ...(players[key] || {}), ...patch });
        players[key] = next;
        return next;
    }
    function normalizeQueueEntry(entry = {}) {
        const userId = String(entry?.userId || '').trim();
        const player = userId ? players[userId] : null;
        return {
            userId,
            name: String(entry?.name || player?.name || 'Player').trim() || 'Player',
            avatarId: normalizeAvatarId(entry?.avatarId ?? player?.avatarId)
        };
    }
    function genCode() { return Math.random().toString(36).substring(2, 8).toUpperCase(); }

    function resetRoundReviews() {
        roundReviews = [];
    }

    function ensureRoundReview(index = questionIndex) {
        const safeIndex = Number(index);
        if (!Number.isFinite(safeIndex) || safeIndex < 0) return null;
        const q = gameQuestions[safeIndex] || {};
        if (!roundReviews[safeIndex]) {
            roundReviews[safeIndex] = {
                index: safeIndex,
                number: safeIndex + 1,
                question: q.question || q.q || '',
                answer: q.answer || q.a || '',
                meta: q.meta || {},
                attempts: [],
                solvedBy: null,
                revealed: false,
                unanswered: false
            };
        } else {
            roundReviews[safeIndex].question = roundReviews[safeIndex].question || q.question || q.q || '';
            roundReviews[safeIndex].answer = roundReviews[safeIndex].answer || q.answer || q.a || '';
            roundReviews[safeIndex].meta = roundReviews[safeIndex].meta || q.meta || {};
        }
        return roundReviews[safeIndex];
    }

    function recordRoundAttempt(attempt = {}) {
        const review = ensureRoundReview(questionIndex);
        if (!review || !attempt.userId) return;
        const text = String(attempt.text || '').trim();
        const existing = [...review.attempts].reverse().find(item =>
            item.userId === attempt.userId &&
            (!text || !item.text || item.text === text) &&
            typeof item.correct !== 'boolean'
        );
        const next = existing || {
            userId: attempt.userId,
            name: String(attempt.name || players[attempt.userId]?.name || 'Player').trim() || 'Player',
            avatarId: normalizeAvatarId(attempt.avatarId || players[attempt.userId]?.avatarId),
            text,
            correct: null,
            reason: '',
            roundId: String(attempt.roundId || activeRoundId || '').trim()
        };
        if (text) next.text = text;
        if (typeof attempt.correct === 'boolean') next.correct = attempt.correct;
        if (attempt.reason) next.reason = String(attempt.reason || '').trim();
        if (!existing) review.attempts.push(next);
        if (next.correct) {
            review.solvedBy = {
                userId: next.userId,
                name: next.name,
                avatarId: next.avatarId
            };
        }
        review.unanswered = false;
    }

    function markRoundSolved(userId) {
        const review = ensureRoundReview(questionIndex);
        const player = players[userId] || {};
        if (review && userId) {
            review.solvedBy = {
                userId,
                name: player.name || 'Player',
                avatarId: normalizeAvatarId(player.avatarId)
            };
        }
    }

    function markRoundReveal(answer = '') {
        const review = ensureRoundReview(questionIndex);
        if (!review) return;
        review.answer = String(answer || review.answer || '').trim();
        review.revealed = true;
    }

    function normalizeRoundReviews(raw) {
        const list = Array.isArray(raw) ? raw : [];
        return list.map((item, idx) => ({
            index: Number.isFinite(Number(item?.index)) ? Number(item.index) : idx,
            number: Number.isFinite(Number(item?.number)) ? Number(item.number) : idx + 1,
            question: String(item?.question || '').trim(),
            answer: String(item?.answer || '').trim(),
            meta: item?.meta && typeof item.meta === 'object' ? item.meta : {},
            attempts: Array.isArray(item?.attempts) ? item.attempts.map(attempt => ({
                userId: String(attempt?.userId || '').trim(),
                name: String(attempt?.name || 'Player').trim() || 'Player',
                avatarId: normalizeAvatarId(attempt?.avatarId),
                text: String(attempt?.text || '').trim(),
                correct: typeof attempt?.correct === 'boolean' ? attempt.correct : null,
                reason: String(attempt?.reason || '').trim()
            })).filter(attempt => attempt.userId || attempt.text) : [],
            solvedBy: item?.solvedBy && typeof item.solvedBy === 'object' ? item.solvedBy : null,
            revealed: !!item?.revealed,
            unanswered: !!item?.unanswered
        }));
    }

    function buildPostGameReviewPayload() {
        for (let i = 0; i < gameQuestions.length; i++) ensureRoundReview(i);
        return normalizeRoundReviews(roundReviews).filter(item => item.question || item.answer);
    }

    // ==================== SOUND EFFECTS ====================
    const beePrefs = (() => {
        try { return JSON.parse(localStorage.getItem(KEY_SETTINGS) || '{}') || {}; } catch { return {}; }
    })();
    const BeeFeedback = {
        sound: beePrefs.cueBeep !== false,
        haptics: beePrefs.haptics !== false
    };
    const beeHapticPattern = Object.freeze({
        tap: [8],
        join: [10, 24, 10],
        start: [14, 30, 14],
        question: [10],
        buzz: [18],
        queue: [10, 24, 10],
        your_turn: [16, 24, 24],
        submit: [10],
        grading: [8],
        timer: [8],
        timeout: [28, 36, 12],
        correct: [14, 30, 20],
        wrong: [40, 50, 16],
        reveal: [10, 16, 10],
        finish: [24, 30, 24]
    });
    function beeVibrate(pattern) {
        try { if (BeeFeedback.haptics && navigator.vibrate) navigator.vibrate(pattern); } catch { }
    }
    let audioCtx = null;
    function getAudioCtx() {
        if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { } }
        return audioCtx;
    }
    function playTone(freq, dur, type = 'sine', peak = 0.28) {
        const ctx = getAudioCtx(); if (!ctx) return;
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.connect(g); g.connect(ctx.destination);
        o.frequency.value = freq; o.type = type;
        g.gain.setValueAtTime(0.0001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(peak, ctx.currentTime + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
        o.start(); o.stop(ctx.currentTime + dur);
    }
    function playBeeCue(name, opts = {}) {
        const allowSound = (opts.sound !== false) && BeeFeedback.sound;
        const allowHaptic = (opts.haptic !== false) && BeeFeedback.haptics;

        if (allowSound) {
            if (name === 'tap') {
                playTone(980, 0.03, 'triangle', 0.07);
            } else if (name === 'join') {
                playTone(760, 0.06, 'triangle', 0.11);
                setTimeout(() => playTone(980, 0.08, 'triangle', 0.12), 90);
            } else if (name === 'start') {
                playTone(620, 0.06, 'triangle', 0.11);
                setTimeout(() => playTone(784, 0.07, 'triangle', 0.12), 80);
                setTimeout(() => playTone(988, 0.1, 'triangle', 0.13), 160);
            } else if (name === 'question') {
                playTone(520, 0.05, 'triangle', 0.09);
            } else if (name === 'buzz') {
                playTone(640, 0.05, 'square', 0.13);
                setTimeout(() => playTone(760, 0.06, 'square', 0.13), 70);
            } else if (name === 'queue') {
                playTone(700, 0.05, 'triangle', 0.1);
            } else if (name === 'your_turn') {
                playTone(760, 0.07, 'square', 0.13);
                setTimeout(() => playTone(940, 0.08, 'square', 0.13), 90);
            } else if (name === 'submit') {
                playTone(560, 0.05, 'sine', 0.11);
                setTimeout(() => playTone(620, 0.05, 'sine', 0.11), 65);
            } else if (name === 'grading') {
                playTone(480, 0.04, 'sine', 0.08);
            } else if (name === 'timer') {
                playTone(840, 0.04, 'triangle', 0.08);
            } else if (name === 'timeout') {
                playTone(230, 0.14, 'sawtooth', 0.15);
                setTimeout(() => playTone(170, 0.16, 'sawtooth', 0.14), 120);
            } else if (name === 'correct') {
                playTone(880, 0.12, 'sine', 0.16);
                setTimeout(() => playTone(1320, 0.15, 'sine', 0.16), 105);
            } else if (name === 'wrong') {
                playTone(170, 0.32, 'sawtooth', 0.14);
            } else if (name === 'reveal') {
                playTone(500, 0.06, 'triangle', 0.1);
                setTimeout(() => playTone(650, 0.06, 'triangle', 0.1), 80);
            } else if (name === 'finish') {
                playTone(659, 0.08, 'triangle', 0.12);
                setTimeout(() => playTone(784, 0.08, 'triangle', 0.12), 90);
                setTimeout(() => playTone(988, 0.12, 'triangle', 0.13), 180);
            }
        }

        if (!allowHaptic) return;
        const pattern = beeHapticPattern[name];
        if (pattern) beeVibrate(pattern);
    }
    function dingCorrect() { playBeeCue('correct'); }
    function buzzWrong() { playBeeCue('wrong'); }
    function buzzInSound() { playBeeCue('buzz'); }

    // Procedural, lyric-free host music so no external/licensed audio files are needed.
    const BeeHostMusic = {
        enabled: isHost && beePrefs.liveBeeHostMusic !== false,
        playing: false,
        step: 0,
        timer: null,
        master: null,
        filter: null,
        track: 0,
        tracks: [
            {
                lead: [659, 784, 880, 784, 659, 587, 659, 523, 659, 784, 988, 880, 784, 659, 587, 659],
                bass: [165, 165, 196, 196, 147, 147, 175, 175],
                pad: [330, 392, 294, 349]
            },
            {
                lead: [587, 698, 784, 932, 784, 698, 587, 523, 587, 698, 880, 784, 698, 659, 587, 523],
                bass: [147, 147, 175, 175, 131, 131, 196, 196],
                pad: [294, 349, 262, 392]
            },
            {
                lead: [523, 659, 784, 659, 587, 698, 880, 698, 659, 784, 988, 784, 698, 587, 659, 523],
                bass: [131, 131, 165, 165, 147, 147, 196, 196],
                pad: [262, 330, 294, 392]
            }
        ]
    };
    function ensureHostMusicNodes() {
        if (!isHost) return null;
        const ctx = getAudioCtx();
        if (!ctx) return null;
        if (!BeeHostMusic.master) {
            const master = ctx.createGain();
            const filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 2400;
            filter.Q.value = 0.55;
            master.gain.value = 0.032;
            master.connect(filter);
            filter.connect(ctx.destination);
            BeeHostMusic.master = master;
            BeeHostMusic.filter = filter;
        }
        return ctx;
    }
    function playHostMusicNote(freq, dur, type, peak, when = 0) {
        const ctx = ensureHostMusicNodes();
        if (!ctx || !BeeHostMusic.master) return;
        const start = ctx.currentTime + when;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(peak, start + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        osc.connect(gain);
        gain.connect(BeeHostMusic.master);
        osc.start(start);
        osc.stop(start + dur + 0.04);
    }
    function tickHostMusic() {
        if (!BeeHostMusic.playing || !BeeHostMusic.enabled) return;
        const track = BeeHostMusic.tracks[BeeHostMusic.track % BeeHostMusic.tracks.length];
        const step = BeeHostMusic.step;
        const lead = track.lead[step % track.lead.length];
        const bass = track.bass[Math.floor(step / 2) % track.bass.length];
        const pad = track.pad[Math.floor(step / 8) % track.pad.length];
        if (step % 2 === 0) playHostMusicNote(lead, 0.18, 'triangle', 0.10);
        if (step % 4 === 0) playHostMusicNote(bass, 0.42, 'sine', 0.12);
        if (step % 16 === 0) playHostMusicNote(pad, 1.35, 'sine', 0.05);
        if (step > 0 && step % 64 === 0) BeeHostMusic.track = (BeeHostMusic.track + 1) % BeeHostMusic.tracks.length;
        BeeHostMusic.step += 1;
    }
    async function startHostMusic() {
        if (!BeeHostMusic.enabled || BeeHostMusic.playing || !isHost) return;
        const ctx = ensureHostMusicNodes();
        if (!ctx) return;
        try { if (ctx.state === 'suspended') await ctx.resume(); } catch { }
        BeeHostMusic.playing = true;
        tickHostMusic();
        BeeHostMusic.timer = setInterval(tickHostMusic, 250);
        updateHostMusicButton();
    }
    function stopHostMusic() {
        if (BeeHostMusic.timer) clearInterval(BeeHostMusic.timer);
        BeeHostMusic.timer = null;
        BeeHostMusic.playing = false;
        updateHostMusicButton();
    }
    function setHostMusicEnabled(enabled) {
        if (!isHost) return;
        BeeHostMusic.enabled = !!enabled;
        try { localStorage.setItem(KEY_SETTINGS, JSON.stringify({ ...beePrefs, liveBeeHostMusic: BeeHostMusic.enabled })); } catch { }
        if (BeeHostMusic.enabled) void startHostMusic();
        else stopHostMusic();
        updateHostMusicButton();
    }
    function updateHostMusicButton() {
        document.querySelectorAll('#btn-host-music, #btn-host-music-game').forEach((btn) => {
            btn.textContent = BeeHostMusic.enabled ? 'Music On' : 'Music Off';
            btn.setAttribute('aria-pressed', BeeHostMusic.enabled ? 'true' : 'false');
            btn.classList.toggle('ghost', !BeeHostMusic.enabled);
            btn.classList.toggle('pri', BeeHostMusic.enabled);
        });
    }

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

    const EXPLICIT_NO_ATTEMPT_ANSWERS = new Set([
        "I don't know",
        'IDK',
        'idk',
        'I have no idea',
        'just not attempting to answer'
    ]);

    function isExplicitNoAttemptAnswer(text) {
        return EXPLICIT_NO_ATTEMPT_ANSWERS.has(String(text || '').trim());
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
    let players = {};        // { [userId]: { name, score, avatarId } }
    let gameQuestions = [];   // Array of { question, answer, aliases, meta }
    let questionIndex = -1;
    let buzzQueue = [];       // Ordered by arrival at host
    let currentBuzzer = null; // userId of who's currently answering
    let answerTimeout = null;
    let ttsAborted = false;
    let isReading = false;
    let activeRoundId = null;
    let confettiCleanupTimer = null;
    let roundReviews = [];

    // ==================== LOBBY ====================
    $('lobby-host').classList.remove('hidden');
    $('lobby-join').classList.remove('hidden');
    if (isHost) updateHostMusicButton();

    ['btn-host-music', 'btn-host-music-game'].forEach((id) => {
        $(id)?.addEventListener('click', () => {
            playBeeCue('tap', { sound: false });
            setHostMusicEnabled(!BeeHostMusic.enabled);
        });
    });
    window.addEventListener('pagehide', stopHostMusic);

    // Host: Create Room (Accessible to all now)
    $('btn-create-room')?.addEventListener('click', async () => {
        const code = genCode();
        const { data, error } = await sb.from('bee_rooms').insert({ code, host_id: uid, status: 'waiting' }).select().single();
        if (error) { showAlert('Failed to create room: ' + error.message); return; }
        room = data;
        isHost = true; // User who creates the room is the host
        BeeHostMusic.enabled = isHost && beePrefs.liveBeeHostMusic !== false;
        
        upsertPlayer(uid, { name: myName, score: 0, avatarId: myAvatarId });
        await sb.from('bee_participants').insert({ room_id: room.id, user_id: uid, display_name: myName, score: 0 });
        playBeeCue('join');
        void startHostMusic();
        enterWaitingRoom();
    });

    // Student: Join Room
    $('btn-join-room')?.addEventListener('click', async () => {
        const code = ($('join-code').value || '').trim().toUpperCase();
        if (!code || code.length < 4) { showAlert('Please enter a valid room code.'); return; }

        const rpcJoin = await sb.rpc('join_bee_room_by_code', {
            p_code: code,
            p_display_name: myName
        });
        if (!rpcJoin.error) {
            const joined = Array.isArray(rpcJoin.data) ? rpcJoin.data[0] : rpcJoin.data;
            if (!joined?.id) { showAlert('Room not found. Check the code.'); return; }
            room = {
                id: joined.id,
                code: joined.code,
                host_id: joined.host_id,
                status: joined.status
            };
            isHost = (uid === room.host_id);
            BeeHostMusic.enabled = isHost && beePrefs.liveBeeHostMusic !== false;

            playBeeCue('join');
            enterWaitingRoom();
            return;
        }
        const codeValue = String(rpcJoin.error?.code || '').trim();
        const message = String(rpcJoin.error?.message || '').toLowerCase();
        const missingRpc = codeValue === '42883'
            || codeValue === 'PGRST202'
            || (message.includes('function') && message.includes('not found'));
        if (missingRpc) {
            showAlert('Room join is unavailable until the latest Supabase migration is applied.');
            return;
        }

        showAlert(rpcJoin.error.message || 'Failed to join room.');
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
            upsertPlayer(payload.userId, {
                name: payload.name,
                avatarId: payload.avatarId,
                score: players[payload.userId]?.score || 0
            });
            if (payload.userId !== uid) playBeeCue('tap', { sound: false });
            renderPlayerList();
        });

        channel.on('broadcast', { event: 'player_leave' }, ({ payload }) => {
            delete players[payload.userId];
            if (payload.userId !== uid) playBeeCue('tap', { sound: false });
            renderPlayerList();
        });

        channel.on('broadcast', { event: 'game_start' }, ({ payload }) => {
            gameQuestions = payload.questions || [];
            questionIndex = -1;
            resetRoundReviews();
            playBeeCue('start');
            showView('view-game');
            updateGameProgress();
            renderScoreboard();
        });

        channel.on('broadcast', { event: 'question' }, ({ payload }) => {
            playBeeCue('question', { haptic: false });
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
            playBeeCue('reveal');
            handleReveal(payload);
        });

        channel.on('broadcast', { event: 'game_end' }, ({ payload }) => {
            playBeeCue('finish');
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
        channel.send({ type: 'broadcast', event: 'player_join', payload: { userId: uid, name: myName, avatarId: myAvatarId } });

        // Load current participants from DB
        const { data: parts } = await sb.from('bee_participants').select('user_id, display_name, score').eq('room_id', room.id);
        const participantIds = (parts || []).map((p) => p.user_id).filter(Boolean);
        const avatarMap = {};
        if (participantIds.length) {
            const { data: participantProfiles } = await sb.from('profiles').select('id, avatar_id').in('id', participantIds);
            (participantProfiles || []).forEach((participantProfile) => {
                avatarMap[participantProfile.id] = normalizeAvatarId(participantProfile.avatar_id);
            });
        }
        (parts || []).forEach((p) => {
            upsertPlayer(p.user_id, {
                name: p.display_name || 'Player',
                score: p.score || 0,
                avatarId: avatarMap[p.user_id]
            });
        });
        upsertPlayer(uid, { name: myName, avatarId: myAvatarId, score: players[uid]?.score || 0 });
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
                ${userAvatarHtml(p.avatarId, p.name, 'user-avatar-small')}
                <span class="score-name" style="${isMe ? 'color: var(--accent);' : ''}">${esc(p.name)}${badge}${isMe ? ' (You)' : ''}</span>
            </div>`;
        }).join('');
        hydrateAvatarImages(el);
        // Update start button
        const btn = $('btn-start-bee');
        if (btn) btn.disabled = selectedQuestions.length === 0;
    }

    // Leave room
    $('btn-leave')?.addEventListener('click', async () => {
        playBeeCue('tap', { sound: false });
        stopHostMusic();
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
    let myQuestionSets = [];

    async function loadBeeSavedSets() {
        const { data, error } = await sb.from('question_sets').select('*').order('created_at', { ascending: false });
        if (!error && data) {
            myQuestionSets = data;
            const el = $('bee-saved-sets-list');
            if (!el) return;
            if (!data.length) {
                el.innerHTML = '<p class="muted" style="margin:0;">No saved question sets available.</p>';
                return;
            }
            el.innerHTML = data.map(set => {
                const count = Array.isArray(set.questions) ? set.questions.length : 0;
                const isMine = set.creator_id === uid;
                const visibilityLabel = set.visibility === 'public' ? 'Public' : (set.visibility === 'class' ? 'Class' : 'Private');
                return `<div class="list-item" style="cursor:pointer;" onclick="loadSetIntoBee('${set.id}')">
                    <div class="item-copy">
                        <span class="item-title">${esc(set.title)}</span>
                        <span class="item-meta">${count} questions • ${visibilityLabel} • By ${isMine ? 'Me' : (set.creator_role === 'teacher' ? 'Teacher' : 'Peer')}</span>
                    </div>
                    <span class="item-badge">Load</span>
                </div>`;
            }).join('');
        }
    }

    window.loadSetIntoBee = (setId) => {
        const set = myQuestionSets.find(s => s.id === setId);
        if (!set) return;
        selectedQuestions = [...(set.questions || [])];
        showAlert('Loaded questions from "' + set.title + '".', 'success');
        updatePreview();
    };

    function setupHostQuestionUI() {
        // Mode switching
        document.querySelectorAll('.bee-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.bee-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                document.querySelectorAll('.bee-mode-panel').forEach(p => p.classList.add('hidden'));
                const panel = $('bee-mode-' + btn.dataset.mode);
                if (panel) panel.classList.remove('hidden');
                
                if (btn.dataset.mode === 'saved-sets' && !myQuestionSets.length) {
                    loadBeeSavedSets();
                }
            });
        });

        // Preload set from URL if present
        const urlParams = new URLSearchParams(window.location.search);
        const presetId = urlParams.get('set');
        if (presetId) {
            (async () => {
                await loadBeeSavedSets();
                const set = myQuestionSets.find(s => s.id === presetId);
                if (set) {
                    const btn = document.querySelector('.bee-mode-btn[data-mode="saved-sets"]');
                    if (btn) btn.click();
                    loadSetIntoBee(presetId);
                    window.history.replaceState({}, document.title, window.location.pathname);
                }
            })();
        }

        // Random
        $('btn-bee-random')?.addEventListener('click', () => {
            const n = Math.max(1, Math.min(200, parseInt($('bee-random-count').value) || 10));
            const shuffled = [...allQuestions].sort(() => Math.random() - 0.5);
            selectedQuestions = shuffled.slice(0, Math.min(n, allQuestions.length));
            playBeeCue('tap');
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
            playBeeCue('tap');
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
            playBeeCue('tap', { sound: false });
            updatePreview();
        }

        $('btn-bee-clear')?.addEventListener('click', () => { selectedQuestions = []; playBeeCue('tap'); updatePreview(); });

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
        playBeeCue('start');
        void startHostMusic();

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
        resetRoundReviews();
        updateGameProgress();
        renderScoreboard();
        setTimeout(() => hostNextQuestion(), 500);
    }

    // ==================== HOST: QUESTION FLOW ====================
    async function hostNextQuestion() {
        questionIndex++;
        if (questionIndex >= gameQuestions.length) { endBee(); return; }

        const q = gameQuestions[questionIndex];
        ensureRoundReview(questionIndex);
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
        ensureRoundReview(questionIndex);

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
        buzzQueue = Array.isArray(payload.queue) ? payload.queue.map(normalizeQueueEntry) : [];
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
            playBeeCue('your_turn');
            $('game-status').textContent = 'You buzzed! Type your answer:';
            $('answer-area').classList.remove('hidden');
            $('bee-answer-input').focus();
            startAnswerTimer(10);
        } else {
            playBeeCue('queue', { haptic: false });
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
        playBeeCue('your_turn');
    }

    function handleAnswerShow(payload) {
        // Show the answer a player typed to everyone
        playBeeCue('grading', { haptic: false });
        recordRoundAttempt({
            userId: payload.userId,
            name: payload.name || players[payload.userId]?.name || 'Player',
            avatarId: payload.avatarId || players[payload.userId]?.avatarId,
            text: payload.text,
            roundId: payload.roundId
        });
        const display = $('answer-display');
        display.classList.remove('hidden', 'answer-correct', 'answer-incorrect', 'answer-grading');
        display.classList.add('answer-grading');
        const answerPlayerName = $('answer-player-name');
        const playerName = payload.name || players[payload.userId]?.name || 'Player';
        if (answerPlayerName) {
            answerPlayerName.innerHTML = `
                <span style="display:inline-flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;">
                    ${userAvatarHtml(payload.avatarId || players[payload.userId]?.avatarId, playerName, 'user-avatar-small')}
                    <span style="line-height:1.3;">${esc(playerName)} answered:</span>
                </span>
            `;
            hydrateAvatarImages(answerPlayerName);
        }
        $('answer-text').textContent = payload.text;
        $('answer-verdict').textContent = '⏳ Grading...';
    }

    function handleResult(payload) {
        // payload: { userId, correct, reason, answer }
        recordRoundAttempt({
            userId: payload.userId,
            name: players[payload.userId]?.name || 'Player',
            avatarId: players[payload.userId]?.avatarId,
            text: payload.answer || payload.text || '',
            correct: !!payload.correct,
            reason: payload.reason || '',
            roundId: payload.roundId
        });
        const display = $('answer-display');
        display.classList.remove('answer-grading', 'answer-correct', 'answer-incorrect');
        clearInterval(answerTimerInterval);
        $('answer-timer').textContent = '';

        if (payload.correct) {
            markRoundSolved(payload.userId);
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
            if (payload.reason === 'Time ran out') playBeeCue('timeout');
            else buzzWrong();
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
            recordRoundAttempt({
                userId: payload.userId,
                name: players[payload.userId]?.name || 'Player',
                avatarId: players[payload.userId]?.avatarId,
                correct: true,
                reason: payload.reason || 'Confirmed by AI',
                roundId: payload.roundId
            });
            markRoundSolved(payload.userId);
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
        markRoundReveal(payload.answer);
        const el = $('correct-answer-reveal');
        el.classList.remove('hidden');
        el.textContent = '📖 Answer: ' + payload.answer;
        if (isHost) showHostControls();
    }

    function handleGameEnd(payload) {
        ttsStop();
        if (isHost) stopHostMusic();
        showView('view-results');
        const standings = getFinalStandings();
        roundReviews = normalizeRoundReviews(payload?.review || roundReviews);
        renderResultsPodium(standings);
        renderFinalScoreboard(standings);
        renderPostGameReview(roundReviews);
        launchResultsConfetti();
    }

    // ==================== BUZZ SYSTEM ====================
    function handleHostBuzz(payload) {
        if (!isHost || !payload?.userId) return;
        if (payload.roundId && activeRoundId && payload.roundId !== activeRoundId) return;
        // Lock after first accepted buzz.
        if (currentBuzzer) return;

        upsertPlayer(payload.userId, { name: payload.name, avatarId: payload.avatarId });
        const name = payload.name || players[payload.userId]?.name || 'Player';
        const avatarId = payload.avatarId || players[payload.userId]?.avatarId;
        buzzQueue = [normalizeQueueEntry({ userId: payload.userId, name, avatarId })];
        currentBuzzer = payload.userId;
        playBeeCue('queue');

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
            payload: { userId: uid, name: myName, avatarId: myAvatarId, roundId: activeRoundId }
        });
        buzzInSound();
        $('bee-buzz').disabled = true;
        $('bee-buzz').classList.add('disabled');
        $('bee-buzz').classList.remove('pulse');
    });

    // Lightweight haptics for most UI controls; key gameplay actions have dedicated cues.
    document.addEventListener('click', e => {
        const ctl = e.target && e.target.closest ? e.target.closest('button, .btn, .chip, .bee-mode-btn') : null;
        if (!ctl || ctl.disabled) return;
        const id = String(ctl.id || '');
        if ([
            'btn-create-room', 'btn-join-room', 'btn-leave',
            'btn-bee-random', 'btn-bee-filter', 'btn-bee-clear', 'btn-start-bee',
            'bee-buzz', 'btn-submit-bee-answer', 'btn-next-question', 'btn-end-bee',
            'btn-host-music', 'btn-host-music-game'
        ].includes(id)) return;
        playBeeCue('tap', { sound: false, haptic: true });
    }, true);

    function startHostAnswerTimeout() {
        clearTimeout(answerTimeout);
        answerTimeout = setTimeout(() => {
            // Current buzzer timed out
            if (isHost) {
                channel.send({
                    type: 'broadcast', event: 'result',
                    payload: {
                        userId: currentBuzzer,
                        correct: false,
                        reason: 'Time ran out',
                        answer: '',
                        expected: gameQuestions[questionIndex]?.answer || '',
                        roundId: activeRoundId
                    }
                });
                // advance queue handled by result handler
            }
        }, 12000); // 12 seconds (10 visible + 2 network buffer)
    }

    // ==================== ANSWER SUBMISSION ====================
    $('btn-submit-bee-answer')?.addEventListener('click', submitBeeAnswer);

    function submitBeeAnswer() {
        if (uid !== currentBuzzer || !activeRoundId) return;
        const text = ($('bee-answer-input').value || '').trim();
        if (!text) return;
        playBeeCue('submit');
        clearTimeout(answerTimeout);
        $('answer-area').classList.add('hidden');
        $('game-status').textContent = 'Answer submitted. Waiting for grading...';

        // Broadcast the answer text to everyone
        channel.send({
            type: 'broadcast', event: 'answer_submit',
            payload: { userId: uid, name: myName, avatarId: myAvatarId, text, roundId: activeRoundId }
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
                avatarId: payload.avatarId || players[payload.userId]?.avatarId,
                text,
                roundId: activeRoundId
            }
        });

        // Phase 1: fast local match.
        const quickCorrect = quickMatch(text, q.answer, q.aliases || []);
        if (quickCorrect) {
            channel.send({
                type: 'broadcast', event: 'result',
                payload: {
                    userId: payload.userId,
                    correct: true,
                    reason: 'Exact match',
                    answer: text,
                    expected: q.answer,
                    roundId: activeRoundId
                }
            });
            return;
        }

        if (isExplicitNoAttemptAnswer(text)) {
            channel.send({
                type: 'broadcast',
                event: 'result',
                payload: {
                    userId: payload.userId,
                    correct: false,
                    reason: 'No attempt submitted',
                    answer: text,
                    expected: q.answer,
                    roundId: activeRoundId
                }
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
                reason: deepseekResult ? 'Confirmed by AI' : 'Incorrect',
                answer: text,
                expected: q.answer,
                roundId: activeRoundId
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
        const review = ensureRoundReview(questionIndex);
        if (review && !review.attempts.length) review.unanswered = true;
        markRoundReveal(q.answer);
        channel.send({ type: 'broadcast', event: 'reveal', payload: { answer: q.answer } });
    }

    function showHostControls() {
        if (isHost) {
            $('host-game-controls').classList.remove('hidden');
            $('btn-next-question').textContent = (questionIndex >= gameQuestions.length - 1) ? 'Finish Bee' : 'Next Question →';
        }
    }

    $('btn-next-question')?.addEventListener('click', () => {
        playBeeCue('tap');
        if (questionIndex >= gameQuestions.length - 1) { endBee(); }
        else { hostNextQuestion(); }
    });

    $('btn-end-bee')?.addEventListener('click', () => {
        playBeeCue('finish');
        endBee();
    });

    async function endBee() {
        // Save final scores to DB
        for (const [id, p] of Object.entries(players)) {
            try {
                await sb.from('bee_participants').update({ score: p.score }).eq('room_id', room.id).eq('user_id', id);
            } catch { }
        }
        await sb.from('bee_rooms').update({ status: 'finished' }).eq('id', room.id);

        // Save post-game review for each participant
        const reviewPayload = buildPostGameReviewPayload();
        const standings = getFinalStandings();
        const summary = {
            totalQuestions: gameQuestions.length,
            solved: reviewPayload.filter(item => item.solvedBy).length,
            missed: reviewPayload.filter(item => !item.solvedBy).length,
            totalAttempts: reviewPayload.reduce((sum, item) => sum + (item.attempts ? item.attempts.length : 0), 0)
        };
        for (const [id, p] of Object.entries(players)) {
            if (id === room.host_id && myRole !== 'teacher') continue; // skip non-teacher host
            const standing = standings.find(s => s.id === id);
            try {
                await sb.from('livebee_game_reviews').insert({
                    room_id: room.id,
                    user_id: id,
                    room_code: room.code,
                    host_name: players[room.host_id]?.name || 'Host',
                    player_count: Object.keys(players).length - (room.host_id ? 1 : 0),
                    my_rank: standing ? standing.rank : null,
                    my_score: p.score,
                    standings: JSON.stringify(standings.map(s => ({
                        rank: s.rank, name: s.name, avatarId: s.avatarId, score: s.score
                    }))),
                    review: JSON.stringify(reviewPayload),
                    summary: JSON.stringify(summary)
                });
            } catch { /* Review save is best-effort */ }
        }

        channel.send({ type: 'broadcast', event: 'game_end', payload: { review: reviewPayload } });
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
                ${userAvatarHtml(b.avatarId, b.name, 'user-avatar-tiny')}
                <span>${label}: ${esc(b.name)}${isMe ? ' (You)' : ''}</span>
            </div>`;
        }).join('');
        hydrateAvatarImages(el);
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
                ${userAvatarHtml(p.avatarId, p.name, 'user-avatar-small')}
                <span class="score-name" style="${isMe ? 'color: var(--accent);' : ''}">${esc(p.name)}${isMe ? ' (You)' : ''}</span>
                <span class="score-points">${p.score}</span>
            </div>`;
        }).join('');
        hydrateAvatarImages(el);
    }

    function getFinalStandings() {
        return Object.entries(players)
            .filter(([id]) => id !== room?.host_id)
            .sort((a, b) => {
                const delta = (Number(b[1]?.score) || 0) - (Number(a[1]?.score) || 0);
                if (delta !== 0) return delta;
                return String(a[1]?.name || '').localeCompare(String(b[1]?.name || ''));
            })
            .map(([id, p], idx) => ({
                id,
                rank: idx + 1,
                name: p?.name || 'Player',
                avatarId: normalizeAvatarId(p?.avatarId),
                score: Number(p?.score) || 0,
                isMe: id === uid
            }));
    }

    function renderResultsPodium(standings) {
        const el = $('results-podium');
        if (!el) return;
        const first = standings[0] || null;
        const second = standings[1] || null;
        const third = standings[2] || null;

        const slotHtml = (player, cls, medal, label) => {
            if (!player) {
                return `<div class="podium-slot ${cls}">
                    <div class="podium-medal">${medal}</div>
                    <div class="podium-name muted">Open Spot</div>
                    <div class="podium-points">—</div>
                    <div class="podium-rank-label">${label}</div>
                </div>`;
            }
            return `<div class="podium-slot ${cls}" style="${player.isMe ? 'box-shadow: 0 0 0 2px var(--ring), inset 0 1px 0 rgba(255,255,255,0.12);' : ''}">
                <div class="podium-medal">${medal}</div>
                ${userAvatarHtml(player.avatarId, player.name, 'user-avatar-podium')}
                <div class="podium-name">${esc(player.name)}${player.isMe ? ' (You)' : ''}</div>
                <div class="podium-points">${player.score} pts</div>
                <div class="podium-rank-label">${label}</div>
            </div>`;
        };

        el.innerHTML =
            slotHtml(second, 'second', '🥈', '2nd') +
            slotHtml(first, 'first', '🥇', '1st') +
            slotHtml(third, 'third', '🥉', '3rd');
        hydrateAvatarImages(el);
    }

    function renderFinalScoreboard(standings) {
        const el = $('final-scoreboard');
        if (!el) return;
        if (!standings.length) {
            el.innerHTML = '<p class="muted">No players scored.</p>';
            return;
        }
        el.innerHTML = standings.map((p, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
            return `<div class="score-entry" style="${p.isMe ? 'background: rgba(96,165,250,0.1); border-radius: 12px;' : ''}">
                <span class="score-rank">${medal}</span>
                ${userAvatarHtml(p.avatarId, p.name, 'user-avatar-small')}
                <span class="score-name" style="${p.isMe ? 'color: var(--accent);' : ''}">${esc(p.name)}${p.isMe ? ' (You)' : ''}</span>
                <span class="score-points">${p.score} pts</span>
            </div>`;
        }).join('');
        hydrateAvatarImages(el);
    }

    function renderPostGameReview(reviews) {
        const el = $('post-game-review');
        if (!el) return;
        const list = normalizeRoundReviews(reviews).filter(item => item.question || item.answer);
        if (!list.length) {
            el.innerHTML = `
                <div class="post-game-review-head">
                    <div>
                        <h3 class="card-title">Post-game review</h3>
                        <p class="section-subtitle">No round details were captured for this room.</p>
                    </div>
                </div>
            `;
            return;
        }
        const solved = list.filter(item => item.solvedBy).length;
        const missed = list.length - solved;
        const attempts = list.reduce((sum, item) => sum + item.attempts.length, 0);
        const reviewItems = list.map(item => {
            const status = item.solvedBy
                ? `Solved by ${item.solvedBy.name || 'Player'}`
                : (item.unanswered || !item.attempts.length ? 'No correct buzz' : 'Missed after buzzes');
            const meta = [item.meta?.category, item.meta?.era ? ERA_LABELS[item.meta.era] || item.meta.era : ''].filter(Boolean).join(' • ');
            const attemptsHtml = item.attempts.length
                ? item.attempts.map(attempt => `
                    <div class="post-game-attempt ${attempt.correct ? 'is-correct' : 'is-missed'}">
                        ${userAvatarHtml(attempt.avatarId, attempt.name, 'user-avatar-tiny')}
                        <span class="post-game-attempt-name">${esc(attempt.name)}${attempt.userId === uid ? ' (You)' : ''}</span>
                        <span class="post-game-attempt-answer">${esc(attempt.text || 'No answer')}</span>
                        <span class="post-game-attempt-result">${attempt.correct ? 'Correct' : esc(attempt.reason || 'Incorrect')}</span>
                    </div>
                `).join('')
                : '<p class="muted post-game-empty">No one buzzed before the reveal.</p>';
            return `
                <details class="post-game-round" ${item.solvedBy ? '' : 'open'}>
                    <summary>
                        <span class="post-game-round-number">Q${item.number}</span>
                        <span class="post-game-round-status">${esc(status)}</span>
                        <span class="post-game-round-answer">${esc(item.answer || 'Answer unavailable')}</span>
                    </summary>
                    <div class="post-game-round-body">
                        ${meta ? `<div class="post-game-meta">${esc(meta)}</div>` : ''}
                        <p class="post-game-question">${esc(item.question || 'Question unavailable')}</p>
                        <div class="post-game-answer"><strong>Answer:</strong> ${esc(item.answer || 'Answer unavailable')}</div>
                        <div class="post-game-attempts">${attemptsHtml}</div>
                    </div>
                </details>
            `;
        }).join('');

        el.innerHTML = `
            <div class="post-game-review-head">
                <div>
                    <h3 class="card-title">Post-game review</h3>
                    <p class="section-subtitle">${list.length} questions • ${solved} solved • ${missed} missed • ${attempts} buzz attempt${attempts === 1 ? '' : 's'}</p>
                </div>
            </div>
            <div class="post-game-review-list">${reviewItems}</div>
        `;
        hydrateAvatarImages(el);
    }

    function launchResultsConfetti() {
        const zone = $('results-confetti');
        if (!zone) return;
        zone.innerHTML = '';
        const colors = ['#60a5fa', '#2dd4bf', '#fbbf24', '#f87171', '#34d399', '#ffffff'];
        const pieces = 140;
        for (let i = 0; i < pieces; i++) {
            const piece = document.createElement('span');
            piece.className = 'confetti-piece';
            piece.style.left = `${(Math.random() * 100).toFixed(2)}%`;
            piece.style.background = colors[Math.floor(Math.random() * colors.length)];
            piece.style.opacity = String(0.62 + Math.random() * 0.38);
            piece.style.animationDelay = `${(Math.random() * 0.9).toFixed(2)}s`;
            piece.style.animationDuration = `${(2.8 + Math.random() * 2.4).toFixed(2)}s`;
            piece.style.setProperty('--drift', `${Math.round((Math.random() * 2 - 1) * 220)}px`);
            piece.style.setProperty('--spin', `${Math.round((Math.random() * 2 - 1) * 1100)}deg`);
            zone.appendChild(piece);
        }
        if (confettiCleanupTimer) clearTimeout(confettiCleanupTimer);
        confettiCleanupTimer = setTimeout(() => { zone.innerHTML = ''; }, 7600);
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
            if (remaining > 0 && remaining <= 3) {
                playBeeCue('timer', { haptic: remaining === 1 });
            }
            if (remaining <= 0) clearInterval(answerTimerInterval);
        }, 1000);
    }

    function ordinal(n) {
        const s = ['th', 'st', 'nd', 'rd'];
        const v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }
});
