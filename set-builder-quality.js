(function () {
  const SOURCE_LABELS = {
    original: 'Original bank',
    generated: 'Generated draft',
    deepseek: 'DeepSeek',
    fallback: 'Local fallback'
  };

  const STOP_WORDS = new Set(`
    a an and are as at be been being but by can could did do does during each for from had
    has have he her his in into is it its may name named of on or other over point s she
    that the their them these this those through to was were what when where which who whose
    why with would
  `.split(/\s+/).filter(Boolean));

  const COMMON_CLUE_WORDS = new Set(`
    after against also before between both city country emperor empire event events following
    for from government group king kingdom known leader leaders man name named one people
    person place point president ruler series served state states these this time war wars
    which who whose world
  `.split(/\s+/).filter(Boolean));

  const INSTRUCTION_PATTERN = /\b(accept|accepted|anti|be lenient|do not|do not accept|equivalent|give|need|optional|prompt|pronunciation|pronounce|require|required)\b/i;

  function text(value) {
    return String(value == null ? '' : value).trim();
  }

  function compact(value) {
    return text(value).replace(/\s+/g, ' ');
  }

  function esc(value) {
    return text(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function stripMarks(value) {
    return text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function normalizeText(value) {
    return stripMarks(value)
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function questionText(question) {
    return text(question && (question.question || question.q || question.question_text));
  }

  function answerText(question) {
    return text(question && (question.answer || question.a || question.answer_text));
  }

  function questionAliases(question) {
    return Array.isArray(question && question.aliases)
      ? question.aliases.map(text).filter(Boolean)
      : [];
  }

  function questionMeta(question) {
    return question && question.meta && typeof question.meta === 'object' ? question.meta : {};
  }

  function questionRegion(question) {
    const meta = questionMeta(question);
    return text(meta.category || meta.region || (question && (question.category || question.region)));
  }

  function questionEra(question) {
    const meta = questionMeta(question);
    return text(meta.era || (question && question.era));
  }

  function questionTopic(question) {
    const meta = questionMeta(question);
    return text((question && question.topic) || meta.topic);
  }

  function sourceValue(question) {
    const meta = questionMeta(question);
    return text(meta.source || (question && question.source));
  }

  function sourceLabel(question) {
    const raw = sourceValue(question);
    const key = raw.toLowerCase();
    if (!key) return 'Unknown source';
    return SOURCE_LABELS[key] || raw.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  function provenanceParts(question) {
    const meta = questionMeta(question);
    const parts = [sourceLabel(question)];
    const topic = questionTopic(question);
    const createdFrom = text((question && question.created_from) || meta.created_from || (question && question.createdFrom));
    const createdByRole = text((question && question.created_by_role) || meta.created_by_role || (question && question.createdByRole));
    if (topic) parts.push(`Topic: ${topic}`);
    if (createdFrom) parts.push(`From: ${createdFrom.replace(/[-_]+/g, ' ')}`);
    if (createdByRole) parts.push(`By: ${createdByRole}`);
    return parts;
  }

  function cleanAnswer(value) {
    return compact(value)
      .replace(/\s*\[[^\]]+\]\s*/g, ' ')
      .replace(/\s*\([^)]*\)\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizedAnswer(value) {
    return normalizeText(cleanAnswer(value) || value);
  }

  function addAliasCandidate(out, candidate) {
    const clean = compact(candidate)
      .replace(/^answer:\s*/i, '')
      .replace(/^the\s+/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!clean || clean.length < 2 || INSTRUCTION_PATTERN.test(clean)) return;
    out.push(clean);
    const ascii = stripMarks(clean);
    if (ascii && ascii !== clean) out.push(ascii);
  }

  function aliasSuggestions(question, limit = 4) {
    const answer = answerText(question);
    if (!answer) return [];
    const candidates = [];
    const withoutNotes = cleanAnswer(answer);
    if (withoutNotes && withoutNotes !== answer) addAliasCandidate(candidates, withoutNotes);

    Array.from(answer.matchAll(/\(([^)]+)\)|\[([^\]]+)\]/g)).forEach(match => {
      const inner = compact(match[1] || match[2] || '');
      if (!inner || INSTRUCTION_PATTERN.test(inner)) return;
      inner.split(/\s*(?:;|\/|\bor\b)\s*/i).forEach(part => addAliasCandidate(candidates, part));
    });

    withoutNotes.split(/\s*(?:;|\/|\bor\b)\s*/i).forEach(part => {
      if (part && part !== withoutNotes) addAliasCandidate(candidates, part);
    });

    const personMatch = withoutNotes.match(/^([A-Z][A-Za-z'.-]+)\s+(?:[A-Z]\.\s+)?([A-Z][A-Za-z'.-]+)$/);
    if (personMatch) addAliasCandidate(candidates, personMatch[2]);

    const existingValues = [...questionAliases(question)];
    if (withoutNotes === answer) existingValues.push(answer);
    const existing = new Set(existingValues.map(normalizedAnswer).filter(Boolean));
    const seen = new Set();
    return candidates.filter(candidate => {
      const key = normalizedAnswer(candidate);
      if (!key || existing.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, limit);
  }

  function difficulty(question) {
    const q = questionText(question);
    const a = answerText(question);
    const sentenceCount = (q.match(/[.!?]/g) || []).length;
    const dateCount = (q.match(/\b(?:[1-9]\d{2,3}|20\d{2}|[1-9](?:st|nd|rd|th)\s+century)\b/gi) || []).length;
    const namedPhraseCount = extractCapitalizedPhrases(q).length;
    let score = 0;
    if (q.length > 360) score += 2;
    else if (q.length > 210) score += 1;
    if (a.length > 38) score += 2;
    else if (a.length > 18) score += 1;
    if (sentenceCount >= 4) score += 1;
    if (dateCount >= 2) score += 1;
    if (namedPhraseCount >= 5) score += 1;
    const label = score >= 4 ? 'Hard' : score >= 2 ? 'Medium' : 'Easy';
    return { label, score };
  }

  function extractWords(value, answer = '') {
    const answerWords = new Set(normalizeText(answer).split(/\s+/).filter(Boolean));
    return normalizeText(value)
      .split(/\s+/)
      .filter(word => word.length >= 4 && !STOP_WORDS.has(word) && !COMMON_CLUE_WORDS.has(word) && !answerWords.has(word));
  }

  function tokenSetForQuestion(question) {
    return new Set(extractWords(questionText(question), answerText(question)));
  }

  function extractCapitalizedPhrases(value) {
    const matches = [];
    const pattern = /\b(?:[A-Z][A-Za-z'.-]+|[A-Z]{2,})(?:\s+(?:of|the|and|de|del|la|le|van|von|al|ibn|[A-Z][A-Za-z'.-]+|[A-Z]{2,})){0,5}\b/g;
    let match;
    while ((match = pattern.exec(text(value)))) {
      const phrase = compact(match[0]);
      if (!phrase || phrase.length < 4 || /^(For|This|The|A|An|Name)$/i.test(phrase)) continue;
      matches.push(phrase);
    }
    return matches;
  }

  function cluePhrases(question) {
    const qText = questionText(question);
    const answerWords = new Set(normalizeText(answerText(question)).split(/\s+/).filter(Boolean));
    const phrases = [];
    extractCapitalizedPhrases(qText).forEach(phrase => {
      const key = normalizeText(phrase);
      const words = key.split(/\s+/).filter(Boolean);
      if (!words.length || words.every(word => answerWords.has(word))) return;
      if (words.every(word => COMMON_CLUE_WORDS.has(word))) return;
      phrases.push({ label: phrase, key });
    });
    Array.from(qText.matchAll(/\b(?:[1-9]\d{2,3}|20\d{2}|[1-9](?:st|nd|rd|th)\s+century)\b/gi)).forEach(match => {
      const label = compact(match[0]);
      phrases.push({ label, key: normalizeText(label) });
    });
    const seen = new Set();
    return phrases.filter(item => {
      if (!item.key || seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    });
  }

  function pairSimilarity(aSet, bSet) {
    if (!aSet.size || !bSet.size) return { score: 0, shared: [] };
    const shared = [];
    aSet.forEach(token => {
      if (bSet.has(token)) shared.push(token);
    });
    const union = new Set([...aSet, ...bSet]);
    return { score: shared.length / Math.max(1, union.size), shared };
  }

  function groupedCounts(questions, getter, fallback) {
    const counts = {};
    questions.forEach(question => {
      const key = text(getter(question)) || fallback;
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }

  function analyze(questions) {
    const list = Array.isArray(questions) ? questions.filter(Boolean) : [];
    const byQuestion = list.map((question, index) => ({
      index,
      question,
      difficulty: difficulty(question),
      aliases: questionAliases(question),
      aliasSuggestions: aliasSuggestions(question)
    }));

    const duplicateQuestions = [];
    const questionSeen = new Map();
    list.forEach((question, index) => {
      const key = normalizeText(questionText(question));
      if (!key) return;
      if (questionSeen.has(key)) duplicateQuestions.push({ index1: questionSeen.get(key), index2: index, answer: answerText(question) });
      else questionSeen.set(key, index);
    });

    const answerOverlaps = [];
    const answerSeen = new Map();
    list.forEach((question, index) => {
      const key = normalizedAnswer(answerText(question));
      if (!key) return;
      if (answerSeen.has(key)) answerOverlaps.push({ index1: answerSeen.get(key), index2: index, answer: answerText(question) });
      else answerSeen.set(key, index);
    });

    const tokenSets = list.map(tokenSetForQuestion);
    const similarQuestions = [];
    for (let i = 0; i < tokenSets.length; i += 1) {
      for (let j = i + 1; j < tokenSets.length; j += 1) {
        const result = pairSimilarity(tokenSets[i], tokenSets[j]);
        if (result.score >= 0.52 || (result.score >= 0.42 && result.shared.length >= 10)) {
          similarQuestions.push({
            index1: i,
            index2: j,
            score: result.score,
            shared: result.shared.slice(0, 5)
          });
        }
      }
    }
    similarQuestions.sort((a, b) => b.score - a.score);

    const clueMap = new Map();
    list.forEach((question, index) => {
      cluePhrases(question).forEach(clue => {
        if (!clueMap.has(clue.key)) clueMap.set(clue.key, { clue: clue.label, indices: [] });
        clueMap.get(clue.key).indices.push(index);
      });
    });
    const duplicateClues = Array.from(clueMap.values())
      .filter(item => item.indices.length > 1)
      .sort((a, b) => b.indices.length - a.indices.length || a.clue.localeCompare(b.clue));

    const difficultyCounts = { Easy: 0, Medium: 0, Hard: 0 };
    byQuestion.forEach(row => { difficultyCounts[row.difficulty.label] += 1; });

    return {
      total: list.length,
      byQuestion,
      duplicateQuestions,
      answerOverlaps,
      similarQuestions,
      duplicateClues,
      aliasSuggestions: byQuestion.filter(row => row.aliasSuggestions.length),
      difficulty: difficultyCounts,
      balance: {
        regions: groupedCounts(list, questionRegion, 'Unknown'),
        eras: groupedCounts(list, questionEra, 'Unknown')
      },
      sources: groupedCounts(list, sourceLabel, 'Unknown source')
    };
  }

  function barsHtml(title, rows, total, eraLabeler) {
    const safeTotal = Math.max(1, total);
    const body = Object.entries(rows || {})
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 6)
      .map(([label, count]) => {
        const display = title === 'Era Balance' && eraLabeler ? eraLabeler(label) : label;
        const pct = Math.round((count / safeTotal) * 100);
        return `<div class="quality-bar-row"><span>${esc(display || 'Unknown')}</span><div class="quality-bar"><div class="quality-bar-fill" style="width:${pct}%"></div></div><span>${count}</span></div>`;
      }).join('');
    return `<div><strong>${esc(title)}</strong>${body || '<p class="muted">No data</p>'}</div>`;
  }

  function warningBlock(title, rows, className = '') {
    if (!rows.length) return '';
    return `
      <div class="quality-warnings ${className}">
        <strong>${esc(title)}</strong>
        <ul>${rows.map(row => `<li>${row}</li>`).join('')}</ul>
      </div>
    `;
  }

  function renderQualityPanel(analysis, options = {}) {
    const data = analysis || analyze([]);
    const issueCount = data.duplicateQuestions.length + data.answerOverlaps.length + data.similarQuestions.length + data.duplicateClues.length;
    const statusClass = data.duplicateQuestions.length ? 'quality-bad' : issueCount ? 'quality-warn' : 'quality-ok';
    const statusText = data.duplicateQuestions.length
      ? `${data.duplicateQuestions.length} exact duplicate clue${data.duplicateQuestions.length === 1 ? '' : 's'}`
      : issueCount
        ? `${issueCount} review warning${issueCount === 1 ? '' : 's'}`
        : 'All clear';

    const duplicateRows = data.duplicateQuestions.slice(0, 5).map(item => `Q${item.index1 + 1} and Q${item.index2 + 1} have the same clue text${item.answer ? ` (${esc(item.answer)})` : ''}.`);
    const overlapRows = data.answerOverlaps.slice(0, 5).map(item => `Q${item.index1 + 1} and Q${item.index2 + 1} repeat the answer "${esc(item.answer || 'Untitled answer')}".`);
    const similarRows = data.similarQuestions.slice(0, 5).map(item => {
      const shared = item.shared.length ? ` Shared terms: ${esc(item.shared.join(', '))}.` : '';
      return `Q${item.index1 + 1} and Q${item.index2 + 1} are ${Math.round(item.score * 100)}% similar.${shared}`;
    });
    const clueRows = data.duplicateClues.slice(0, 6).map(item => `${esc(item.clue)} appears in ${item.indices.map(index => `Q${index + 1}`).join(', ')}.`);
    const aliasRows = data.aliasSuggestions.slice(0, 6).map(row => {
      const answer = answerText(row.question) || `Q${row.index + 1}`;
      return `Q${row.index + 1} ${esc(answer)}: ${esc(row.aliasSuggestions.join(', '))}`;
    });
    const sourceChips = Object.entries(data.sources || {})
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([label, count]) => `<span class="quality-chip quality-chip-source">${esc(label)}: ${count}</span>`)
      .join('');

    return `
      <div class="quality-panel ${statusClass}">
        <div class="quality-status">
          <span><strong>${esc(options.title || 'Set Quality')}:</strong> ${esc(statusText)}</span>
        </div>
        <div class="quality-detail">
          <span class="quality-chip quality-chip-easy">Easy: ${data.difficulty.Easy || 0}</span>
          <span class="quality-chip quality-chip-medium">Medium: ${data.difficulty.Medium || 0}</span>
          <span class="quality-chip quality-chip-hard">Hard: ${data.difficulty.Hard || 0}</span>
          ${sourceChips}
          <span class="pill">${data.total || 0} total</span>
        </div>
        ${warningBlock('Duplicate clue text', duplicateRows)}
        ${warningBlock('Repeated answers', overlapRows)}
        ${warningBlock('Too similar to another question', similarRows, 'quality-warnings-similar')}
        ${warningBlock('Duplicate clue signals', clueRows, 'quality-warnings-clues')}
        ${warningBlock('Answer-alias suggestions', aliasRows, 'quality-warnings-aliases')}
        <div class="quality-balance-grid">
          ${barsHtml('Region Balance', data.balance.regions, data.total, options.eraLabeler)}
          ${barsHtml('Era Balance', data.balance.eras, data.total, options.eraLabeler)}
        </div>
      </div>
    `;
  }

  function questionMetaHtml(question, options = {}) {
    const diff = difficulty(question).label;
    const region = questionRegion(question) || 'Unknown';
    const era = questionEra(question);
    const eraLabel = era && typeof options.eraLabeler === 'function' ? options.eraLabeler(era) : (era || 'Unknown');
    const aliases = questionAliases(question);
    const suggestions = aliasSuggestions(question);
    const parts = [];
    if (options.showDifficulty !== false) parts.push(`<span class="quality-diff-label quality-diff-${diff.toLowerCase()}">${esc(diff)}</span>`);
    if (options.showRegionEra !== false) {
      parts.push(`<span class="pill">Region: ${esc(region)}</span>`);
      parts.push(`<span class="pill">Era: ${esc(eraLabel || 'Unknown')}</span>`);
    }
    if (options.showSource !== false) parts.push(`<span class="pill">Source: ${esc(sourceLabel(question))}</span>`);
    if (options.showProvenance) {
      parts.push(`<span class="pill">Provenance: ${esc(provenanceParts(question).join(' / '))}</span>`);
    }
    if (options.showAliases && aliases.length) {
      parts.push(`<span class="pill">Aliases: ${esc(aliases.slice(0, 3).join(', '))}${aliases.length > 3 ? '...' : ''}</span>`);
    }
    if (options.showAliasSuggestions && suggestions.length) {
      parts.push(`<span class="pill alias-suggestion-pill">Alias ideas: ${esc(suggestions.slice(0, 3).join(', '))}</span>`);
    }
    return `<div class="set-builder-meta-grid">${parts.join('')}</div>`;
  }

  function qualityIssueSummary(analysis) {
    const data = analysis || analyze([]);
    const lines = [];
    data.duplicateQuestions.slice(0, 3).forEach(item => lines.push(`Q${item.index1 + 1} and Q${item.index2 + 1} have duplicate clue text.`));
    data.answerOverlaps.slice(0, 3).forEach(item => lines.push(`Q${item.index1 + 1} and Q${item.index2 + 1} repeat the answer "${item.answer || 'Untitled answer'}".`));
    data.similarQuestions.slice(0, 3).forEach(item => lines.push(`Q${item.index1 + 1} and Q${item.index2 + 1} are ${Math.round(item.score * 100)}% similar.`));
    data.duplicateClues.slice(0, 3).forEach(item => lines.push(`${item.clue} appears in ${item.indices.map(index => `Q${index + 1}`).join(', ')}.`));
    return lines.join('\n');
  }

  window.SetBuilderQuality = {
    analyze,
    aliasSuggestions,
    difficulty,
    difficultyLabel: question => difficulty(question).label,
    questionMetaHtml,
    renderQualityPanel,
    sourceLabel,
    provenanceParts,
    qualityIssueSummary
  };
})();
