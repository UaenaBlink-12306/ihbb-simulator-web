(function (root) {
    'use strict';

    const text = value => String(value ?? '').trim();
    function questions(set) {
        let rows = set?.questions;
        if (typeof rows === 'string') {
            try { rows = JSON.parse(rows); } catch { return []; }
        }
        return Array.isArray(rows) ? rows.map(row => ({
            question: text(row?.question ?? row?.q ?? row?.prompt ?? row?.text ?? row?.body),
            answer: text(row?.answer ?? row?.a ?? row?.response ?? row?.correct ?? row?.solution),
            aliases: Array.isArray(row?.aliases) ? row.aliases.map(text).filter(Boolean) : []
        })).filter(row => row.question && row.answer) : [];
    }

    const compact = value => text(value).replace(/\s+/g, ' ');
    function contentKey(row) {
        // Match the normalization used when Practice Hub imports a saved set.
        const answer = compact(row.answer)
            .replace(/\[(?:accept|also|or)\s*([^\]]+)\]|\((?:accept|also|or)\s*([^)]+)\)/ig, '').trim()
            .replace(/(\d{4}.*?(Round|Regional|Extra|Packet|Bee|Bowl|Championship).*)$/i, '').trim()
            .replace(/^"|"$/g, '').trim();
        return JSON.stringify([compact(row.question), answer]);
    }
    function completed(set, session, userId) {
        if (!userId || !session || (session.user_id && session.user_id !== userId)) return false;
        const rows = questions(set);
        const total = Number(session.total);
        const results = session.results;
        const meta = session.meta;
        if (!rows.length || total !== rows.length || !Array.isArray(results) || results.length !== total
            || !results.every(result => typeof result === 'boolean')
            || !Array.isArray(meta) || meta.length !== total) return false;
        // Compare the full content, including duplicate questions, in any practice order.
        // Older sessions have no set_id; their complete snapshots can still prove completion.
        const remaining = new Map();
        for (const row of rows) {
            const key = contentKey(row);
            remaining.set(key, (remaining.get(key) || 0) + 1);
        }
        for (const row of meta) {
            if (row?.set_id && text(row.set_id) !== text(set.id)) return false;
            const key = contentKey({ question: row?.question_text, answer: row?.expected_answer });
            const count = remaining.get(key) || 0;
            if (!count) return false;
            remaining.set(key, count - 1);
        }
        return true;
    }

    async function loadCompletedSets(client, userId, sets, storage) {
        const ids = new Set();
        if (!userId) return { ids, unavailable: false };
        const pending = new Map(sets.filter(set => questions(set).length).map(set => [set.id, set]));
        const consume = sessions => {
            for (const session of sessions) {
                for (const [id, set] of pending) {
                    if (completed(set, session, userId)) { ids.add(id); pending.delete(id); }
                }
            }
        };
        try {
            const local = JSON.parse(storage.getItem(`ihbb_v2_sessions_${userId}`) || '[]');
            if (Array.isArray(local)) consume(local);
        } catch { /* Cloud history remains available if browser storage fails. */ }
        try {
            // Page through the student's own history so older completions still unlock review.
            const pageSize = 200;
            for (let offset = 0; pending.size; offset += pageSize) {
                const { data, error } = await client.from('user_drill_sessions')
                    .select('user_id,client_session_id,total,results,meta')
                    .eq('user_id', userId).order('ts', { ascending: false })
                    .order('client_session_id', { ascending: true }).range(offset, offset + pageSize - 1);
                if (error) throw error;
                if (!Array.isArray(data)) throw new Error('Practice history unavailable');
                consume(data);
                if (data.length < pageSize) break;
            }
            return { ids, unavailable: false };
        } catch {
            return { ids, unavailable: true };
        }
    }

    function show(set) {
        const rows = questions(set);
        if (!rows.length) return;
        const doc = root.document;
        doc.querySelector('.question-set-review')?.close();
        const opener = doc.activeElement;
        const dialog = doc.createElement('dialog');
        dialog.className = 'question-set-review';
        dialog.setAttribute('aria-labelledby', 'question-set-review-title');
        const header = doc.createElement('header');
        const title = doc.createElement('h2');
        title.id = 'question-set-review-title';
        title.textContent = text(set.title) || 'Question set';
        const close = doc.createElement('button');
        close.type = 'button'; close.className = 'btn ghost'; close.textContent = 'Close';
        close.addEventListener('click', () => dialog.close());
        header.append(title, close);
        const search = doc.createElement('input');
        search.type = 'search'; search.placeholder = 'Search questions or answers';
        search.setAttribute('aria-label', search.placeholder);
        search.setAttribute('data-autofill-lock', 'off');
        const status = doc.createElement('p');
        status.className = 'muted'; status.setAttribute('role', 'status');
        const list = doc.createElement('ol');
        list.className = 'question-set-review-list';
        const cards = rows.map((row, index) => {
            const card = doc.createElement('li');
            card.value = index + 1;
            const question = doc.createElement('p');
            question.className = 'question-set-review-question'; question.textContent = row.question;
            const answer = doc.createElement('p');
            answer.className = 'question-set-review-answer'; answer.textContent = `Answer: ${row.answer}`;
            card.append(question, answer);
            if (row.aliases.length) {
                const aliases = doc.createElement('p');
                aliases.className = 'muted'; aliases.textContent = `Also accepted: ${row.aliases.join(' • ')}`;
                card.append(aliases);
            }
            list.append(card);
            return { card, searchText: [row.question, row.answer, ...row.aliases].join(' ').toLowerCase() };
        });
        const filter = () => {
            const query = search.value.trim().toLowerCase();
            let visible = 0;
            for (const row of cards) {
                row.card.hidden = !row.searchText.includes(query);
                if (!row.card.hidden) visible++;
            }
            status.textContent = query ? `${visible} of ${rows.length} questions` : `${rows.length} questions • Questions and answers in set order`;
        };
        search.addEventListener('input', filter);
        filter();
        dialog.append(header, search, status, list);
        dialog.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.preventDefault(); dialog.close(); }
        });
        dialog.addEventListener('close', () => { dialog.remove(); if (opener?.isConnected) opener.focus(); });
        doc.body.append(dialog);
        dialog.showModal();
    }

    const api = { questions, completed, loadCompletedSets, show };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.QuestionSetReview = api;
})(typeof window === 'object' ? window : globalThis);
