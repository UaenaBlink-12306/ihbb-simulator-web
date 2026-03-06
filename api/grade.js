module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body || {};
    const question = String(payload.question || '');
    const expected = String(payload.expected ?? payload.expected_answer ?? '');
    const aliases = Array.isArray(payload.aliases) ? payload.aliases : [];
    const userAnswer = String(payload.user_answer ?? payload.answer ?? '');
    const strict = !!payload.strict;
    const coachEnabled = !!payload.coach_enabled;
    const coachOnly = !!payload.coach_only;
    const coachDepth = String(payload.coach_depth || 'full');
    const suppliedCorrect = (typeof payload.correct === 'boolean') ? !!payload.correct : null;
    const suppliedReason = String(payload.reason || payload.grade_reason || '');
    const meta = (payload.meta && typeof payload.meta === 'object') ? payload.meta : {};

    function normalize(str) {
      return String(str || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function normalizeCompact(str) {
      return String(str || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
    }

    function basicMatch(userAns, expectedAnswer, acceptedAliases = []) {
      const user = normalizeCompact(userAns);
      if (!user) return false;
      if (user === normalizeCompact(expectedAnswer)) return true;
      for (const alias of acceptedAliases) {
        if (user === normalizeCompact(alias)) return true;
      }
      return false;
    }

    function parseJsonFromContent(content) {
      if (!content) return null;
      const trimmed = String(content).trim();
      try {
        return JSON.parse(trimmed);
      } catch {}

      const cleaned = trimmed
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '');
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start === -1 || end <= start) return null;
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }

    function guessTopic(q) {
      const t = normalize(q);
      if (!t) return 'General';
      if (/(battle|war|campaign|siege|army|navy|admiral|general|military)/.test(t)) return 'Military';
      if (/(treaty|law|constitution|election|minister|president|senate|parliament|policy)/.test(t)) return 'Politics';
      if (/(religion|church|pope|caliph|bishop|buddhi|islam|christian|hindu)/.test(t)) return 'Religion';
      if (/(econom|trade|market|bank|tax|industry|debt|finance)/.test(t)) return 'Economy';
      if (/(art|painting|novel|poem|literature|music|composer|sculpt)/.test(t)) return 'Culture';
      if (/(science|physics|chemistry|biology|medicine|theory|experiment|astronomy)/.test(t)) return 'Science';
      return 'General';
    }

    function iconForFocus(region, topic) {
      const regionIcons = {
        africa: '🌍',
        europe: '🏰',
        'north america': '🦅',
        'latin america': '🗿',
        'middle east': '🕌',
        'east asia': '🏯',
        'south asia': '🪷',
        'southeast asia': '🌴',
        'central asia': '🐎',
        oceania: '🌊',
        world: '🌐'
      };
      const topicIcons = {
        military: '⚔️',
        politics: '🏛️',
        religion: '🕯️',
        economy: '💰',
        culture: '🎭',
        science: '🧪',
        general: '📘'
      };
      const r = String(region || '').toLowerCase();
      const t = String(topic || '').toLowerCase();
      return regionIcons[r] || topicIcons[t] || '📘';
    }

    function fallbackRelatedFacts(region, era, topic) {
      const r = String(region || 'this region');
      const e = String(era || 'this period');
      const t = String(topic || 'General').toLowerCase();
      return [
        `Fact 1: [Timeline Anchor] - Place this in ${e}; similar clues in different eras often indicate different answers.`,
        `Fact 2: [Regional Anchor] - Keep it tied to ${r}; cross-region lookalikes are a common trap.`,
        `Fact 3: [Theme Link] - This is most testable through ${t} consequences, not isolated name recall.`
      ];
    }

    function canonicalAnswerText(answer) {
      const raw = String(answer || '').trim();
      if (!raw) return '';
      const cleaned = raw
        .replace(/\s*\([^)]*\)/g, '')
        .replace(/\s*\[[^\]]*\]/g, '')
        .replace(/\s+/g, ' ')
        .replace(/[ ,;:.]+$/g, '')
        .trim();
      return cleaned || raw;
    }

    function wikiLinkForAnswer(answer) {
      const canonical = canonicalAnswerText(answer);
      if (!canonical) return '';
      return `https://en.wikipedia.org/wiki/${encodeURIComponent(canonical.replace(/\s+/g, '_'))}`;
    }

    function fallbackExplanationBullets(correct, reasonText, region, era, topic) {
      const user = String(userAnswer || '').trim();
      const comparison = correct
        ? 'Your answer already matched the expected target, so focus on remembering the exact clue pattern that made it uniquely right.'
        : (user
          ? `Your answer "${user}" lived near the right topic, but the clue set narrowed to a different answer.`
          : 'Your response was close to the topic area, but the clue set narrowed to a different answer.');
      const anchors = `Use ${era || 'the era'} and ${region || 'the region'} as elimination anchors before you commit.`;
      const topicNote = `Prioritize ${String(topic || 'General').toLowerCase()} clues such as named events, titles, offices, or signature works that point to one target only.`;
      const reasonNote = String(reasonText || 'Focus on the clue that uniquely separates the expected answer from nearby lookalikes.').trim();
      return [comparison, anchors, topicNote, reasonNote].filter(Boolean);
    }

    function fallbackStudyTip(region, era, topic) {
      const place = String(region || 'this region');
      const when = String(era || '').trim();
      const theme = String(topic || 'General').toLowerCase();
      return `Run a short drill on ${place}${when ? ` in ${when}` : ''} and stop on the first clue that rules out the closest lookalike. Focus especially on ${theme} triggers.`;
    }

    function buildFallbackCoach(correct, reasonText) {
      const region = String(meta.category || meta.region || 'World') || 'World';
      const era = String(meta.era || '');
      const topic = guessTopic(question);
      const explanationBullets = fallbackExplanationBullets(correct, reasonText, region, era, topic);
      const relatedFacts = fallbackRelatedFacts(region, era, topic);
      const canonicalAnswer = canonicalAnswerText(expected);
      return {
        summary: correct
          ? 'You got it right. Keep tying clues to the specific historical context.'
          : 'This was likely a near-miss in concept matching rather than total misunderstanding.',
        explanation: explanationBullets.join(' '),
        explanation_bullets: explanationBullets,
        related_facts: relatedFacts,
        key_clues: [
          'Identify the most specific clue that disambiguates lookalikes.',
          'Lock the answer to a timeline or region anchor before committing.',
          'Prefer named events, titles, and offices over broad topic similarity.'
        ],
        study_tip: fallbackStudyTip(region, era, topic),
        canonical_answer: canonicalAnswer,
        wiki_link: wikiLinkForAnswer(canonicalAnswer),
        study_focus: {
          region,
          era,
          topic,
          icon: iconForFocus(region, topic)
        },
        error_diagnosis: String(reasonText || explanationBullets[0]).trim(),
        overlap_explainer: reasonText || relatedFacts[0],
        confidence: 'low'
      };
    }

    function normalizeCoach(rawCoach, correct, reasonText) {
      const rc = (rawCoach && typeof rawCoach === 'object') ? rawCoach : {};
      const givenFocus = (rc.study_focus && typeof rc.study_focus === 'object') ? rc.study_focus : {};
      const region = String(givenFocus.region || meta.category || meta.region || 'World').trim() || 'World';
      const era = String(givenFocus.era || meta.era || '').trim();
      const topic = String(givenFocus.topic || guessTopic(question)).trim() || 'General';
      const icon = String(givenFocus.icon || iconForFocus(region, topic)).trim() || iconForFocus(region, topic);
      const confidenceRaw = String(rc.confidence || '').toLowerCase();
      const confidence = (confidenceRaw === 'high' || confidenceRaw === 'medium' || confidenceRaw === 'low') ? confidenceRaw : 'low';
      const keyClues = Array.isArray(rc.key_clues)
        ? rc.key_clues.map(x => String(x || '').trim()).filter(Boolean).slice(0, 4)
        : [];
      const relatedFacts = Array.isArray(rc.related_facts)
        ? rc.related_facts.map(x => String(x || '').trim()).filter(Boolean).slice(0, 5)
        : [];
      const explanationBullets = Array.isArray(rc.explanation_bullets)
        ? rc.explanation_bullets.map(x => String(x || '').trim()).filter(Boolean).slice(0, 5)
        : (String(rc.explanation || '').trim() ? [String(rc.explanation).trim()] : []);
      const fallbackFacts = fallbackRelatedFacts(region, era, topic);
      const mergedExplanationBullets = explanationBullets.length
        ? explanationBullets
        : fallbackExplanationBullets(correct, reasonText, region, era, topic);
      const mergedRelatedFacts = relatedFacts.length ? relatedFacts : fallbackFacts;
      const canonicalAnswer = canonicalAnswerText(rc.canonical_answer || expected);
      const wikiLink = String(rc.wiki_link || wikiLinkForAnswer(canonicalAnswer)).trim();

      return {
        summary: String(rc.summary || (correct ? 'Correct answer with good clue alignment.' : 'This answer was not accepted; review clue disambiguation.')).trim(),
        explanation: mergedExplanationBullets.join(' ').trim(),
        explanation_bullets: mergedExplanationBullets,
        related_facts: mergedRelatedFacts,
        error_diagnosis: String(rc.error_diagnosis || reasonText || mergedExplanationBullets[0]).trim(),
        overlap_explainer: String(rc.overlap_explainer || mergedRelatedFacts.join(' | ') || reasonText || 'Use the most specific clues to separate related answers.').trim(),
        key_clues: keyClues.length ? keyClues : [
          'Track clues that uniquely identify the expected answer.',
          'Use era and region to eliminate close alternatives.',
          'Prefer named events, titles, and offices over broad topic overlap.'
        ],
        study_tip: String(rc.study_tip || rc.memory_hook || rc.next_check_question || fallbackStudyTip(region, era, topic)).trim(),
        canonical_answer: canonicalAnswer,
        wiki_link: wikiLink,
        study_focus: { region, era, topic, icon },
        confidence
      };
    }

    async function callDeepSeek(messages, maxTokens) {
      const key = process.env.DEEPSEEK_API_KEY;
      const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({
          model,
          messages,
          response_format: { type: 'json_object' },
          temperature: 0.0,
          max_tokens: maxTokens
        })
      });
      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content?.trim();
      return parseJsonFromContent(content);
    }

    const fallbackCorrect = basicMatch(userAnswer, expected, aliases);
    const noKeyReason = 'DeepSeek API key not set, using basic match.';

    if (!process.env.DEEPSEEK_API_KEY) {
      const lockedCorrect = (coachOnly && suppliedCorrect !== null) ? suppliedCorrect : fallbackCorrect;
      const lockedReason = coachOnly ? (suppliedReason || noKeyReason) : noKeyReason;
      const output = { correct: lockedCorrect, reason: lockedReason };
      if (coachEnabled) output.coach = lockedCorrect ? null : buildFallbackCoach(lockedCorrect, lockedReason);
      return res.status(200).json(output);
    }

    if (!coachEnabled) {
      const messages = [
        {
          role: 'system',
          content: 'You are a strict IHBB short-answer grader. Return only JSON: {"correct":boolean,"reason":string}.'
        },
        {
          role: 'user',
          content: JSON.stringify({ question, expected, aliases, user_answer: userAnswer, strict })
        }
      ];
      const result = await callDeepSeek(messages, 220);
      if (!result || typeof result.correct !== 'boolean') {
        return res.status(200).json({ correct: fallbackCorrect, reason: 'Could not parse DeepSeek response, used basic match instead.' });
      }
      return res.status(200).json({
        correct: !!result.correct,
        reason: String(result.reason || '')
      });
    }

    if (coachOnly) {
      const lockedCorrect = suppliedCorrect === null ? fallbackCorrect : suppliedCorrect;
      const lockedReason = suppliedReason || (lockedCorrect ? 'Correct by prior grading pass.' : 'Incorrect by prior grading pass.');
      if (lockedCorrect) {
        return res.status(200).json({ correct: lockedCorrect, reason: lockedReason, coach: null });
      }
      const coachOnlySystem = [
        'Act as a personalized IHBB coach. Generate only coaching content for an already-graded incorrect answer.',
        'Do not re-grade. Respect provided is_correct and reason as the locked verdict.',
        'Address the student directly and use their wrong answer to explain the mismatch.',
        'Do not write one large paragraph; use bullet-style strings in arrays.',
        'INSTRUCTIONS:',
        '1) summary: one concise personalized takeaway.',
        '2) error_diagnosis: clearly explain why the student answer missed.',
        '3) overlap_explainer: explain the distinction between the student answer and the correct answer.',
        '4) explanation_bullets: 3 to 4 short bullet strings teaching the answer in context.',
        '5) related_facts: 3 to 5 short bullet strings with valuable adjacent facts.',
        '6) key_clues: 2 to 4 short bullet strings for the best giveaway clues.',
        '7) study_tip: one concrete next study move.',
        '8) canonical_answer: the clean answer only, with parenthetical grading notes removed.',
        '9) wiki_link: https://en.wikipedia.org/wiki/{canonical_answer_with_spaces_replaced_by_underscores}.',
        'Return strict JSON with this shape only:',
        '{"coach":{"summary":"1-sentence definitive takeaway.","error_diagnosis":"Why the student answer was not accepted.","overlap_explainer":"How the wrong answer overlaps with but differs from the right one.","explanation_bullets":["Personalized teaching bullet 1","Personalized teaching bullet 2","Personalized teaching bullet 3"],"related_facts":["Fact bullet 1","Fact bullet 2","Fact bullet 3"],"key_clues":["Specific clue that gives it away","A chronological or spatial anchor"],"study_tip":"A concrete next drill or recall move.","canonical_answer":"Clean canonical answer only","wiki_link":"https://en.wikipedia.org/wiki/Clean_Canonical_Answer","study_focus":{"region":"String","era":"String","topic":"String"},"confidence":"low|medium|high"}}'
      ].join('\n');
      const coachOnlyMessages = [
        { role: 'system', content: coachOnlySystem },
        {
          role: 'user',
          content: JSON.stringify({
            question,
            expected_answer: expected,
            user_answer: userAnswer,
            aliases,
            is_correct: lockedCorrect,
            reason: lockedReason,
            category: String(meta.category || meta.region || ''),
            strict,
            coach_depth: coachDepth,
            meta
          })
        }
      ];
      const coached = await callDeepSeek(coachOnlyMessages, 760);
      if (!coached || typeof coached !== 'object') {
        return res.status(200).json({
          correct: lockedCorrect,
          reason: lockedReason,
          coach: buildFallbackCoach(lockedCorrect, lockedReason)
        });
      }
      const coach = normalizeCoach(coached.coach || coached, lockedCorrect, lockedReason);
      return res.status(200).json({ correct: lockedCorrect, reason: lockedReason, coach });
    }

    const coachSystem = [
      'Act as a personalized IHBB coach. Your goal is to provide a high-density "Micro-Lesson" that helps a student not just memorize a fact, but understand its place in a broader system of knowledge.',
      'First, grade the answer and return top-level fields: {"correct":boolean,"reason":string}. If the answer is correct, return coach as null.',
      'CONTEXT KEYS PROVIDED: question, expected_answer, user_answer, aliases, strict, category, meta, coach_depth.',
      'INSTRUCTIONS:',
      '1) Personalize the lesson to the student wrong answer.',
      '2) Do not write one large paragraph; use bullet-style strings in arrays.',
      '3) explanation_bullets: 3 to 4 short bullets teaching why the correct answer fits.',
      '4) related_facts: 3 to 5 short bullets with valuable adjacent facts.',
      '5) key_clues: 2 to 4 short bullets identifying the best giveaway clues.',
      '6) canonical_answer must be the clean answer only, with parenthetical grading notes removed.',
      '7) wiki_link must be https://en.wikipedia.org/wiki/{canonical_answer_with_spaces_replaced_by_underscores}.',
      'Use question-specific clues and avoid generic encyclopedia dumps.',
      'OUTPUT FORMAT (Strict JSON, no markdown):',
      '{"correct":boolean,"reason":string,"coach":{"summary":"1-sentence definitive takeaway.","error_diagnosis":"Why the student answer was not accepted.","overlap_explainer":"How the wrong answer overlaps with but differs from the right one.","explanation_bullets":["Personalized teaching bullet 1","Personalized teaching bullet 2","Personalized teaching bullet 3"],"related_facts":["Fact bullet 1","Fact bullet 2","Fact bullet 3"],"key_clues":["Specific clue that gives it away","A chronological or spatial anchor"],"study_tip":"A concrete next drill or recall move.","canonical_answer":"Clean canonical answer only","wiki_link":"https://en.wikipedia.org/wiki/Clean_Canonical_Answer","study_focus":{"region":"String","era":"String","topic":"String"},"confidence":"low|medium|high"}}'
    ].join('\n');

    const coachMessages = [
      { role: 'system', content: coachSystem },
      {
        role: 'user',
        content: JSON.stringify({
          question,
          expected_answer: expected,
          aliases,
          user_answer: userAnswer,
          category: String(meta.category || meta.region || ''),
          strict,
          coach_depth: coachDepth,
          meta
        })
      }
    ];

    const graded = await callDeepSeek(coachMessages, 900);
    if (!graded || typeof graded.correct !== 'boolean') {
      return res.status(200).json({
        correct: fallbackCorrect,
        reason: 'Could not parse DeepSeek response, used basic match instead.',
        coach: fallbackCorrect ? null : buildFallbackCoach(fallbackCorrect, 'Could not parse DeepSeek response, used fallback coach.')
      });
    }

    const correct = !!graded.correct;
    const reason = String(graded.reason || '');
    if (correct) {
      return res.status(200).json({ correct, reason, coach: null });
    }
    const coach = normalizeCoach(graded.coach || graded, correct, reason);

    return res.status(200).json({ correct, reason, coach });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
};
