(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.TeacherResults = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const list = value => Array.isArray(value) ? value : [];
    const text = value => String(value ?? '');
    const number = value => value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
    const answerKey = value => text(value).replace(/^ +| +$/g, '').replace(/\\s+/g, ' ').toLowerCase();

    // Mirror the deployed submit_assignment_attempts, including its legacy
    // escaped regex (internal whitespace stays significant), and exact aliases.
    // The saved submission total remains the authoritative homework grade.
    function homeworkRows(questions, submission) {
        const byId = new Map(list(questions).map(q => [text(q.question_id), q]));
        const attempts = new Map(list(submission?.attempts).map(a => [text(a.question_id), a]));
        const order = [...new Set([...attempts.keys(), ...byId.keys()])];
        return order.map((id, index) => {
            const q = byId.get(id);
            const attempt = attempts.get(id);
            const hasAnswer = !!attempt && Object.prototype.hasOwnProperty.call(attempt, 'answer');
            const aliases = list(q?.aliases).map(text);
            const accepted = [q?.answer_text, ...aliases].filter(value => value !== undefined && value !== null);
            const systemCorrect = q && hasAnswer && accepted.length
                ? accepted.some(value => answerKey(value) === answerKey(attempt.answer))
                : null;
            const override = submission?.grading_overrides?.[id];
            const teacherCorrected = override?.active === true && override?.correct === true;
            const correct = teacherCorrected ? true : systemCorrect;
            return {
                id, index: index + 1,
                question: text(q?.question_text), expected: text(q?.answer_text),
                answer: hasAnswer ? text(attempt.answer) : null,
                correct, systemCorrect, teacherCorrected,
                reviewedAt: text(override?.reviewed_at),
                category: text(q?.category), era: text(q?.era), source: text(q?.source), aliases,
                buzz: number(attempt?.buzz_seconds) > 0 ? number(attempt.buzz_seconds) : null
            };
        });
    }

    function practiceRows(session, questionById = new Map(), coachRows = []) {
        const items = list(session?.items);
        const results = list(session?.results);
        const meta = list(session?.meta);
        const buzz = list(session?.buzz);
        const sessionId = text(session?.client_session_id || session?.sid);
        const coachByQuestion = new Map(list(coachRows)
            .filter(row => sessionId && text(row.client_session_id) === sessionId)
            .map(row => [text(row.question_id), row]));
        return Array.from({ length: Math.max(items.length, results.length, meta.length) }, (_, index) => {
            const id = text(items[index]);
            const saved = meta[index] || {};
            const q = questionById.get(id) || {};
            const coach = coachByQuestion.get(id) || {};
            const hasAnswer = Object.prototype.hasOwnProperty.call(saved, 'user_answer');
            return {
                id, index: index + 1,
                question: text(saved.question_text || q.question || q.question_text || coach.question_text),
                expected: text(saved.expected_answer || q.answer || q.answer_text || coach.expected_answer),
                answer: hasAnswer ? text(saved.user_answer) : (coach.user_answer !== undefined ? text(coach.user_answer) : null),
                correct: typeof results[index] === 'boolean' ? results[index] : null,
                category: text(saved.category || q.meta?.category || q.category || coach.category),
                era: text(saved.era || q.meta?.era || q.era || coach.era),
                source: text(saved.source || q.meta?.source || q.source || coach.source),
                aliases: list(q.aliases),
                buzz: number(buzz[index]) > 0 ? number(buzz[index]) : null
            };
        });
    }

    function breakdown(rows, dimension) {
        const groups = new Map();
        list(rows).forEach(row => {
            const name = text(row[dimension]).trim() || 'Unspecified';
            if (!groups.has(name)) groups.set(name, { name, total: 0, correct: 0, unknown: 0 });
            const group = groups.get(name);
            group.total++;
            if (row.correct === true) group.correct++;
            if (row.correct === null) group.unknown++;
        });
        return [...groups.values()].map(group => ({ ...group,
            accuracy: group.total > group.unknown ? Math.round(group.correct / (group.total - group.unknown) * 100) : null
        })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    }

    function rowSummary(rows) {
        const graded = list(rows).filter(row => typeof row.correct === 'boolean');
        const times = list(rows).map(row => row.buzz).filter(value => Number.isFinite(value) && value > 0);
        return {
            correct: graded.filter(row => row.correct).length,
            missed: graded.filter(row => !row.correct).length,
            unknown: list(rows).length - graded.length,
            noAnswer: list(rows).filter(row => row.answer !== null && !row.answer.trim()).length,
            averageBuzz: times.length ? times.reduce((sum, value) => sum + value, 0) / times.length : null
        };
    }

    function dueStatus(dueDate, submittedAt, now = Date.now()) {
        if (!dueDate) return submittedAt ? 'Completed' : 'Pending';
        const deadline = /^\d{4}-\d{2}-\d{2}$/.test(dueDate)
            ? new Date(`${dueDate}T23:59:59.999`).getTime() : new Date(dueDate).getTime();
        if (!Number.isFinite(deadline)) return submittedAt ? 'Completed' : 'Pending';
        if (submittedAt) return new Date(submittedAt).getTime() > deadline ? 'Submitted late' : 'On time';
        return now > deadline ? 'Overdue' : 'Pending';
    }

    function sessionKind(session) {
        const meta = list(session?.meta).find(row => row?.activity_type) || {};
        if (meta.activity_type === 'homework') return meta.retry_mode && meta.retry_mode !== 'first' ? 'retry' : 'homework';
        return meta.activity_type === 'practice' ? 'practice' : 'legacy';
    }

    function sessionTitle(session) {
        const meta = list(session?.meta).find(row => row?.activity_type) || {};
        const kind = sessionKind(session);
        if (kind === 'retry') return `${meta.assignment_title || 'Homework'} · ${meta.retry_mode === 'missed' ? 'Missed-question retry' : 'Practice retry'}`;
        if (kind === 'homework') return `${meta.assignment_title || 'Homework'} · Original session`;
        return meta.set_title || (kind === 'legacy' ? 'Practice session (older record)' : 'Independent practice');
    }

    return { homeworkRows, practiceRows, breakdown, rowSummary, dueStatus, sessionKind, sessionTitle };
});
