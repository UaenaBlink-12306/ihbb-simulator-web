(function (root) {
    'use strict';
    const data = root.TeacherResults;
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const list = value => Array.isArray(value) ? value : [];
    const ts = row => Number(row?.ts) || new Date(row?.created_at || '').getTime() || 0;
    let nextControl = 0;

    root.TeacherResultView = {
        create({ sb, formatDate, formatDateTime, formatDuration, eraLabel, getQuestionById, abortSignal, onGradeChanged }) {
            const mounted = new WeakSet();
            const homeworkCache = new Map();
            const histories = new Map();

            function homeworkHtml(item, studentId, studentName = '', avatar = '') {
                const submission = item.submission;
                const status = data.dueStatus(item.dueDate, submission?.submittedAt);
                const metadata = [item.className, item.dueDate ? `Due ${formatDate(item.dueDate)}` : 'No due date',
                    submission?.submittedAt ? `Submitted ${formatDateTime(submission.submittedAt)}` : 'No submission yet'].filter(Boolean).join(' · ');
                const copy = `${avatar}<div class="item-copy"><span class="item-title">${esc(studentName || item.title || 'Homework')}</span><span class="item-meta">${esc(metadata)}</span></div>`;
                const statusHtml = `<span class="status-pill ${status === 'Overdue' || status === 'Submitted late' ? 'overdue' : (submission ? 'done' : 'pending')}">${esc(status)}</span>`;
                if (!submission) return `<div class="list-item">${copy}${statusHtml}</div>`;
                const score = submission.total > 0 ? `${Math.round(submission.correct / submission.total * 100)}%` : '—';
                return `<details class="teacher-result" data-homework-assignment="${esc(item.assignmentId)}" data-homework-student="${esc(studentId)}">
                    <summary>${copy}${statusHtml}<span class="item-score">${esc(`${submission.correct}/${submission.total} · ${score}`)}</span></summary>
                    <div class="teacher-result-body" data-homework-body><p class="muted">Open this review to load saved answers.</p></div>
                </details>`;
            }

            function questionReviewHtml(rows, note, canOverride = false) {
                if (!rows.length) return `<p class="muted teacher-result-empty">No question-level details were saved for this record.</p>`;
                const summary = data.rowSummary(rows);
                const control = ++nextControl;
                const dimensions = [['category', 'Regions'], ['era', 'Eras']].map(([key, title]) => {
                    const groups = data.breakdown(rows, key);
                    return `<div class="summary-item"><span>${title}</span>${groups.map(group => `<strong>${esc(key === 'era' ? eraLabel(group.name) : group.name)}: ${group.correct}/${group.total - group.unknown}${group.accuracy === null ? ' · Not recorded' : ` · ${group.accuracy}%`}${group.unknown ? ` · ${group.unknown} unknown` : ''}</strong>`).join('')}</div>`;
                }).join('');
                return `<div data-question-review>
                    <p class="muted">${esc(note)}</p>
                    <div class="teacher-result-summary"><span class="pill">${summary.correct} correct</span><span class="pill">${summary.missed} missed</span>
                        ${summary.unknown ? `<span class="pill">${summary.unknown} results not recorded</span>` : ''}
                        ${summary.noAnswer ? `<span class="pill">${summary.noAnswer} blank answers</span>` : ''}
                        ${summary.averageBuzz === null ? '' : `<span class="pill">Average buzz ${summary.averageBuzz.toFixed(2)}s</span>`}
                    </div>
                    <div class="teacher-result-breakdown">${dimensions}</div>
                    <div class="teacher-result-tools">
                        <div class="input-group"><label for="result-outcome-${control}">Show questions</label><select id="result-outcome-${control}" data-result-outcome><option value="all">All results</option><option value="missed">Missed only</option><option value="correct">Correct only</option><option value="unknown">Result not recorded</option></select></div>
                        <div class="input-group"><label for="result-search-${control}">Find a question or answer</label><input id="result-search-${control}" type="search" data-result-search placeholder="Search this review"></div>
                    </div>
                    <p class="muted" data-result-count aria-live="polite">Showing ${rows.length} of ${rows.length} questions</p>
                    <div class="teacher-result-questions">${rows.map(row => {
                        const outcome = row.correct === true ? 'correct' : (row.correct === false ? 'missed' : 'unknown');
                        const label = outcome === 'unknown' ? 'Result not recorded' : (outcome === 'correct' ? 'Correct' : 'Missed');
                        const tags = [row.category, row.era ? eraLabel(row.era) : '', row.source ? `Source: ${row.source}` : '', row.buzz === null ? '' : `Buzz: ${row.buzz.toFixed(2)}s`].filter(Boolean).join(' · ');
                        return `<article class="teacher-result-question" data-outcome="${outcome}">
                            <div class="teacher-result-question-head"><strong>Question ${row.index}</strong><span class="status-pill ${outcome === 'correct' ? 'done' : (outcome === 'missed' ? 'overdue' : 'pending')}">${label}</span></div>
                            <p>${esc(row.question || `Question text not available${row.id ? ` (ID: ${row.id})` : ''}.`)}</p>
                            <div class="item-meta">${esc(tags)}</div>
                            <dl class="teacher-result-answers"><div><dt>Student's answer</dt><dd>${esc(row.answer === null ? 'Not recorded' : (row.answer.trim() ? row.answer : 'No answer entered'))}</dd></div><div><dt>Accepted answer</dt><dd>${esc(row.expected || 'Not available')}</dd></div></dl>
                            ${row.aliases.length ? `<p class="muted">Accepted alternatives: ${esc(row.aliases.join('; '))}</p>` : ''}
                            ${row.teacherCorrected ? `<p class="muted">Teacher marked correct · System originally marked incorrect${row.reviewedAt ? ` · ${esc(formatDateTime(row.reviewedAt))}` : ''}</p>` : ''}
                            ${canOverride && (row.correct === false || row.teacherCorrected) ? `<button class="btn ghost" type="button" data-grade-override="${esc(row.id)}" data-grade-action="${row.teacherCorrected ? 'reset' : 'correct'}">${row.teacherCorrected ? 'Undo teacher override' : 'Mark correct'}</button>` : ''}
                        </article>`;
                    }).join('')}</div>
                    <p class="muted teacher-result-empty" data-result-empty hidden>No questions match these filters.</p>
                </div>`;
            }

            async function loadHomework(element, refresh = false) {
                const target = element.querySelector('[data-homework-body]');
                if (!target) return;
                const assignmentId = element.dataset.homeworkAssignment;
                const studentId = element.dataset.homeworkStudent;
                const key = `${assignmentId}:${studentId}`;
                if (target.dataset.loaded && !refresh) return;
                target.innerHTML = '<p class="muted" role="status">Loading saved homework answers…</p>';
                if (refresh) homeworkCache.delete(key);
                try {
                    if (!homeworkCache.has(key)) {
                        const promise = Promise.all([
                            sb.from('assignment_submissions').select('assignment_id, student_id, correct, total, submitted_at, verified, attempts, grading_overrides')
                                .eq('assignment_id', assignmentId).eq('student_id', studentId).eq('verified', true).maybeSingle().abortSignal(abortSignal()),
                            sb.from('assignment_questions').select('question_id, question_text, answer_text, category, era, source, aliases')
                                .eq('assignment_id', assignmentId).abortSignal(abortSignal())
                        ]).then(([submissionRes, questionsRes]) => {
                            if (submissionRes.error) throw submissionRes.error;
                            if (questionsRes.error) throw questionsRes.error;
                            if (!submissionRes.data) throw new Error('The saved submission is no longer available.');
                            return { submission: submissionRes.data, questions: questionsRes.data || [] };
                        });
                        homeworkCache.set(key, promise);
                    }
                    const { submission, questions } = await homeworkCache.get(key);
                    const rows = data.homeworkRows(questions, submission);
                    const summary = data.rowSummary(rows);
                    let note = `Verified homework score: ${submission.correct}/${submission.total}. Question results match saved responses against the current accepted answer and alternatives.`;
                    if (!list(submission.attempts).length) note += ' This older submission has no saved answers.';
                    else if (summary.correct !== Number(submission.correct) || rows.length !== Number(submission.total)) note += ' The current answer key or saved question details differ from this submission; the verified score above is unchanged.';
                    if (!target.isConnected) return;
                    const score = element.querySelector('.item-score');
                    if (score) score.textContent = `${submission.correct}/${submission.total} · ${submission.total > 0 ? `${Math.round(submission.correct / submission.total * 100)}%` : '—'}`;
                    const canOverride = summary.unknown === 0 && summary.correct === Number(submission.correct) && rows.length === Number(submission.total);
                    if (!canOverride) note += ' Teacher overrides require complete saved answers and a matching answer key.';
                    target.innerHTML = questionReviewHtml(rows, note, canOverride);
                    target.dataset.loaded = 'true';
                } catch (error) {
                    homeworkCache.delete(key);
                    if (!target.isConnected) return;
                    target.innerHTML = `<p class="muted" role="alert">Saved answers could not be loaded: ${esc(error?.message || 'Please try again.')}</p><button class="btn ghost" type="button" data-homework-retry>Retry loading answers</button>`;
                }
            }

            async function overrideHomework(button) {
                const element = button.closest('[data-homework-assignment]');
                if (!element || element.dataset.savingGrade) return;
                element.dataset.savingGrade = 'true';
                const buttons = [...element.querySelectorAll('[data-grade-override]')];
                buttons.forEach(control => { control.disabled = true; });
                const body = element.querySelector('[data-homework-body]');
                body.querySelector('[data-grade-status]')?.remove();
                const status = document.createElement('p');
                status.dataset.gradeStatus = 'true';
                status.setAttribute('role', 'status');
                status.textContent = 'Saving teacher grade…';
                body.prepend(status);
                try {
                    const { data: saved, error } = await sb.rpc('override_assignment_grade', {
                        p_assignment_id: element.dataset.homeworkAssignment,
                        p_student_id: element.dataset.homeworkStudent,
                        p_question_id: button.dataset.gradeOverride,
                        p_mark_correct: button.dataset.gradeAction === 'correct'
                    });
                    if (error) throw error;
                    if (!saved) throw new Error('The corrected grade was not returned. Please reload and try again.');
                    const key = `${element.dataset.homeworkAssignment}:${element.dataset.homeworkStudent}`;
                    homeworkCache.delete(key);
                    document.querySelectorAll('[data-homework-assignment]').forEach(review => {
                        if (review.dataset.homeworkAssignment !== element.dataset.homeworkAssignment || review.dataset.homeworkStudent !== element.dataset.homeworkStudent) return;
                        delete review.querySelector('[data-homework-body]').dataset.loaded;
                        const score = review.querySelector('.item-score');
                        if (score) score.textContent = `${saved.correct}/${saved.total} · ${saved.total > 0 ? `${Math.round(saved.correct / saved.total * 100)}%` : '—'}`;
                    });
                    const outcome = body.querySelector('[data-result-outcome]')?.value || 'all';
                    const search = body.querySelector('[data-result-search]')?.value || '';
                    await loadHomework(element, true);
                    const review = body.querySelector('[data-question-review]');
                    if (review) {
                        review.querySelector('[data-result-outcome]').value = outcome;
                        review.querySelector('[data-result-search]').value = search;
                        filterQuestions(review);
                        const message = document.createElement('p');
                        message.setAttribute('role', 'status');
                        message.textContent = button.dataset.gradeAction === 'correct' ? 'Teacher correction saved. The official homework score has been updated.' : 'Teacher override undone. The original mark has been restored.';
                        review.prepend(message);
                    }
                    document.querySelectorAll('[data-homework-assignment]').forEach(other => {
                        if (other !== element && other.open && other.dataset.homeworkAssignment === element.dataset.homeworkAssignment && other.dataset.homeworkStudent === element.dataset.homeworkStudent) void loadHomework(other);
                    });
                    if (onGradeChanged) void Promise.resolve(onGradeChanged(saved)).catch(error => console.warn('Grade saved; analytics refresh failed.', error));
                } catch (error) {
                    status.setAttribute('role', 'alert');
                    status.textContent = `Grade could not be saved: ${error?.message || 'Please try again.'}`;
                } finally {
                    delete element.dataset.savingGrade;
                    buttons.forEach(control => { control.disabled = false; });
                }
            }

            function practiceHistoryHtml(detail) {
                histories.set(String(detail.id), {
                    sessions: list(detail.sessions).slice().sort((a, b) => ts(b) - ts(a)), coachRows: list(detail.coachRows)
                });
                const control = ++nextControl;
                return `<div class="analytics-panel teacher-practice-history" data-practice-student="${esc(detail.id)}">
                    <div class="analytics-panel-head"><div><div class="analytics-panel-kicker">Saved sessions</div><h3>Practice history &amp; answers</h3><p class="analytics-panel-note">Student-wide sessions, including homework retries. Practice marks are separate from verified homework grades. Question text and typed answers are saved for new sessions; older records show available details.</p></div></div>
                    <div class="teacher-result-tools">
                        <div class="input-group"><label for="practice-range-${control}">Time period</label><select id="practice-range-${control}" data-practice-range><option value="30">Last 30 days</option><option value="7">Last 7 days</option><option value="90">Last 90 days</option><option value="all">All saved history</option></select></div>
                        <div class="input-group"><label for="practice-kind-${control}">Session type</label><select id="practice-kind-${control}" data-practice-kind><option value="all">All session types</option><option value="practice">Independent practice</option><option value="retry">Homework retries</option><option value="homework">Original homework sessions</option><option value="legacy">Older sessions (type not recorded)</option></select></div>
                        <div class="input-group"><label for="practice-search-${control}">Find a session</label><input id="practice-search-${control}" type="search" data-practice-search placeholder="Set, question, answer, or source"></div>
                    </div>
                    <div class="teacher-result-summary" data-practice-summary aria-live="polite"></div>
                    <div class="teacher-practice-sessions" data-practice-sessions></div>
                    <button class="btn ghost" type="button" data-practice-more hidden>Show more sessions</button>
                </div>`;
            }

            function renderPractice(history, reset = true) {
                const record = histories.get(history.dataset.practiceStudent);
                if (!record) return;
                if (reset) history.dataset.visibleCount = '10';
                const days = history.querySelector('[data-practice-range]').value;
                const kind = history.querySelector('[data-practice-kind]').value;
                const search = history.querySelector('[data-practice-search]').value.trim().toLowerCase();
                const cutoff = days === 'all' ? 0 : Date.now() - Number(days) * 86400000;
                const questionById = getQuestionById();
                const matching = record.sessions.map((session, index) => ({ session, index })).filter(({ session }) => {
                    if (ts(session) < cutoff || (kind !== 'all' && data.sessionKind(session) !== kind)) return false;
                    if (!search) return true;
                    const rows = data.practiceRows(session, questionById, record.coachRows);
                    return `${data.sessionTitle(session)} ${rows.map(row => [row.question, row.expected, row.answer, row.category, row.era, row.source].join(' ')).join(' ')}`.toLowerCase().includes(search);
                });
                const total = matching.reduce((sum, row) => sum + (Number(row.session.total) || 0), 0);
                const correct = matching.reduce((sum, row) => sum + (Number(row.session.correct) || 0), 0);
                const duration = matching.reduce((sum, row) => sum + (Number(row.session.dur) || 0), 0);
                const visible = matching.slice(0, Number(history.dataset.visibleCount) || 10);
                history.querySelector('[data-practice-summary]').innerHTML = `<span class="pill">${matching.length} session${matching.length === 1 ? '' : 's'}</span><span class="pill">${correct}/${total} correct${total ? ` · ${Math.round(correct / total * 100)}%` : ''}</span><span class="pill">${esc(formatDuration(duration))} total time</span><span class="pill">Showing ${visible.length} of ${matching.length}</span>`;
                history.querySelector('[data-practice-sessions]').innerHTML = visible.length ? visible.map(({ session, index }) => {
                    const counts = data.rowSummary(data.practiceRows(session, questionById, record.coachRows));
                    const metadata = `${formatDateTime(ts(session))} · ${formatDuration(session.dur)}${counts.averageBuzz === null ? '' : ` · Average buzz ${counts.averageBuzz.toFixed(2)}s`}`;
                    return `<details class="teacher-result" data-practice-index="${index}"><summary><div class="item-copy"><span class="item-title">${esc(data.sessionTitle(session))}</span><span class="item-meta">${esc(metadata)}</span></div><span class="item-score">${esc(`${session.correct || 0}/${session.total || 0}`)}</span><span class="pill">${counts.missed} missed${counts.unknown ? ` · ${counts.unknown} unknown` : ''}</span></summary><div class="teacher-result-body" data-practice-body></div></details>`;
                }).join('') : '<p class="muted">No saved sessions match this time period and filter.</p>';
                history.querySelector('[data-practice-more]').hidden = visible.length >= matching.length;
            }

            function filterQuestions(review) {
                const outcome = review.querySelector('[data-result-outcome]').value;
                const search = review.querySelector('[data-result-search]').value.trim().toLowerCase();
                const cards = [...review.querySelectorAll('[data-outcome]')];
                let visible = 0;
                cards.forEach(card => {
                    card.hidden = (outcome !== 'all' && card.dataset.outcome !== outcome) || !card.textContent.toLowerCase().includes(search);
                    if (!card.hidden) visible++;
                });
                review.querySelector('[data-result-count]').textContent = `Showing ${visible} of ${cards.length} questions`;
                review.querySelector('[data-result-empty]').hidden = visible > 0;
            }

            function mount(container) {
                container.querySelectorAll('[data-practice-student]').forEach(history => renderPractice(history));
                if (mounted.has(container)) return;
                mounted.add(container);
                container.addEventListener('toggle', event => {
                    const details = event.target;
                    if (!details.open || !container.contains(details)) return;
                    if (details.matches('[data-homework-assignment]')) void loadHomework(details);
                    if (details.matches('[data-practice-index]')) {
                        const history = details.closest('[data-practice-student]');
                        const record = histories.get(history.dataset.practiceStudent);
                        const session = record?.sessions[Number(details.dataset.practiceIndex)];
                        const body = details.querySelector('[data-practice-body]');
                        if (session && !body.dataset.loaded) {
                            const rows = data.practiceRows(session, getQuestionById(), record.coachRows);
                            body.innerHTML = questionReviewHtml(rows, 'Results and buzz times are the saved marks from this session. “Not recorded” means the older session did not save a typed answer.');
                            body.dataset.loaded = 'true';
                        }
                    }
                }, true);
                for (const eventName of ['input', 'change']) container.addEventListener(eventName, event => {
                    if (event.target.matches('[data-result-outcome], [data-result-search]')) filterQuestions(event.target.closest('[data-question-review]'));
                    if (event.target.matches('[data-practice-range], [data-practice-kind], [data-practice-search]')) renderPractice(event.target.closest('[data-practice-student]'));
                });
                container.addEventListener('click', event => {
                    const gradeButton = event.target.closest('[data-grade-override]');
                    if (gradeButton) void overrideHomework(gradeButton);
                    if (event.target.closest('[data-homework-retry]')) void loadHomework(event.target.closest('[data-homework-assignment]'), true);
                    const more = event.target.closest('[data-practice-more]');
                    if (more) {
                        const history = more.closest('[data-practice-student]');
                        history.dataset.visibleCount = String((Number(history.dataset.visibleCount) || 10) + 10);
                        renderPractice(history, false);
                    }
                });
            }

            return { homeworkHtml, practiceHistoryHtml, mount };
        }
    };
})(typeof globalThis !== 'undefined' ? globalThis : this);
