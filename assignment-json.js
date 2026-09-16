(function (root) {
    'use strict';
    function parse(text, filename = 'assignment.json') {
        let data;
        try { data = JSON.parse(text.replace(/^\uFEFF/, '')); }
        catch (_) { throw new Error('This file is not valid JSON. Check its formatting and try again.'); }
        const rows = Array.isArray(data) ? data : (data?.items ?? data?.questions);
        if (!Array.isArray(rows) || !rows.length) throw new Error('Include a non-empty question list, or an object with an items or questions list.');
        if (rows.length > 200) throw new Error('Upload up to 200 questions per assignment.');
        const scalar = value => typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) ? String(value).trim() : '';
        const items = rows.map((row, index) => {
            const question = scalar(row?.question ?? row?.q ?? row?.question_text);
            const answer = scalar(row?.answer ?? row?.a ?? row?.answer_text);
            if (!question || !answer) throw new Error(`Question ${index + 1} needs question text and an answer. No questions were imported.`);
            if (row.aliases != null && (!Array.isArray(row.aliases) || row.aliases.some(alias => !scalar(alias)))) {
                throw new Error(`Question ${index + 1} has invalid aliases. Use a list of answer strings.`);
            }
            return {
                id: `upload:${index}:${question}:${answer}`,
                question, answer, aliases: (row.aliases || []).map(scalar),
                topic: scalar(row.topic),
                meta: {
                    category: scalar(row.meta?.category ?? row.category),
                    era: scalar(row.meta?.era ?? row.era),
                    source: scalar(row.meta?.source ?? row.source) || 'Uploaded JSON'
                }
            };
        });
        return { items, title: scalar(data?.title) || filename.replace(/\.json$/i, '') };
    }
    const api = Object.freeze({ parse });
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.AssignmentJson = api;
})(typeof window === 'undefined' ? globalThis : window);
