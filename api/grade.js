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

    function isConceptCheckValid(nextCheck, originalQuestion, expectedAnswer) {
      const nq = normalize(nextCheck);
      const oq = normalize(originalQuestion);
      const ex = normalize(expectedAnswer);
      if (!nq || nq.length < 18) return false;
      if (oq && nq === oq) return false;
      if (ex && ex.length >= 4 && nq.includes(ex)) return false;
      const nqWords = new Set(nq.split(' ').filter(Boolean));
      const oqWords = new Set(oq.split(' ').filter(Boolean));
      if (!nqWords.size || !oqWords.size) return true;
      let overlap = 0;
      for (const w of nqWords) if (oqWords.has(w)) overlap++;
      const ratio = overlap / Math.max(1, Math.min(nqWords.size, oqWords.size));
      return ratio < 0.72;
    }

    function fallbackNextCheck(originalQuestion) {
      const q = normalize(originalQuestion);
      if (/(battle|war|campaign|siege)/.test(q)) return 'What broader political or territorial change followed that conflict?';
      if (/(treaty|law|constitution)/.test(q)) return 'What long-term political effect did that decision produce?';
      return 'What cause-and-effect relationship best explains this answer in its historical context?';
    }

    function buildFallbackCoach(correct, reasonText) {
      const region = String(meta.category || meta.region || 'World') || 'World';
      const era = String(meta.era || '');
      const topic = guessTopic(question);
      const explanation = correct
        ? 'The clue set points to a unique target, and your response matched that target within the right context.'
        : 'The likely issue is conceptual overlap: your response may be related, but the clues narrow to a different target in this context.';
      const relatedFacts = fallbackRelatedFacts(region, era, topic);
      const nextCheck = fallbackNextCheck(question);
      return {
        summary: correct
          ? 'You got it right. Keep tying clues to the specific historical context.'
          : 'This was likely a near-miss in concept matching rather than total misunderstanding.',
        explanation,
        related_facts: relatedFacts,
        key_clues: [
          'Identify the most specific clue that disambiguates lookalikes.',
          'Lock the answer to a timeline or region anchor before committing.'
        ],
        memory_hook: 'Anchor one distinctive clue to one named entity.',
        study_focus: {
          region,
          era,
          topic,
          icon: iconForFocus(region, topic)
        },
        error_diagnosis: explanation,
        overlap_explainer: reasonText || relatedFacts[0],
        next_check_question: nextCheck,
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
        ? rc.related_facts.map(x => String(x || '').trim()).filter(Boolean).slice(0, 3)
        : [];
      const fallbackFacts = fallbackRelatedFacts(region, era, topic);
      const explanation = String(
        rc.explanation ||
        rc.error_diagnosis ||
        (correct ? 'You identified the right entity and context.' : 'Your response likely overlapped with a related but different concept.')
      ).trim();
      const nextCheckRaw = String(rc.next_check_question || '').trim();
      const nextCheck = nextCheckRaw || fallbackNextCheck(question);
      const mergedRelatedFacts = relatedFacts.length ? relatedFacts : fallbackFacts;

      return {
        summary: String(rc.summary || (correct ? 'Correct answer with good clue alignment.' : 'This answer was not accepted; review clue disambiguation.')).trim(),
        explanation,
        related_facts: mergedRelatedFacts,
        error_diagnosis: explanation,
        overlap_explainer: String(rc.overlap_explainer || mergedRelatedFacts.join(' | ') || reasonText || 'Use the most specific clues to separate related answers.').trim(),
        key_clues: keyClues.length ? keyClues : [
          'Track clues that uniquely identify the expected answer.',
          'Use era and region to eliminate close alternatives.'
        ],
        memory_hook: String(rc.memory_hook || 'Pair one unique clue with one canonical answer.').trim(),
        next_check_question: nextCheck,
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
      if (coachEnabled) output.coach = buildFallbackCoach(lockedCorrect, lockedReason);
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
      const coachOnlySystem = [
        'Act as an expert polymath and memory architect. Generate only coaching content for an already-graded answer.',
        'Do not re-grade. Respect provided is_correct and reason as the locked verdict.',
        'INSTRUCTIONS:',
        '1) Explain the underlying logic/significance in 2-3 punchy sentences.',
        '2) Provide 3 related high-value facts linked to the correct answer.',
        '3) If is_correct is false, clearly separate user answer vs expected answer.',
        '4) Provide one vivid mnemonic.',
        'Return strict JSON with this shape only:',
        '{"coach":{"summary":"1-sentence definitive takeaway.","explanation":"Deep context explaining the logic of the answer.","related_facts":["Fact 1: [Connection Type] - [Data]","Fact 2: [Connection Type] - [Data]","Fact 3: [Connection Type] - [Data]"],"key_clues":["Specific word in the question that gives it away","A chronological or spatial anchor"],"memory_hook":"A short, sticky mnemonic or visual association.","study_focus":{"region":"String","era":"String","topic":"String"}}}'
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
      let coach = normalizeCoach(coached.coach || coached, lockedCorrect, lockedReason);
      if (!isConceptCheckValid(coach.next_check_question, question, expected)) {
        const fixMessages = [
          {
            role: 'system',
            content: 'Rewrite only next_check_question as a concept-check (cause/effect/context), not a repetition, and do not include the expected answer string. Return JSON: {"next_check_question":string}.'
          },
          {
            role: 'user',
            content: JSON.stringify({
              original_question: question,
              expected_answer: expected,
              bad_next_check_question: coach.next_check_question
            })
          }
        ];
        const fixed = await callDeepSeek(fixMessages, 140);
        const nextQ = String(fixed?.next_check_question || '').trim();
        coach.next_check_question = isConceptCheckValid(nextQ, question, expected) ? nextQ : fallbackNextCheck(question);
      }
      return res.status(200).json({ correct: lockedCorrect, reason: lockedReason, coach });
    }

    const coachSystem = [
      'Act as an expert polymath and memory architect. Your goal is to provide a high-density "Micro-Lesson" that helps a student not just memorize a fact, but understand its place in a broader system of knowledge.',
      'First, grade the answer and return top-level fields: {"correct":boolean,"reason":string}. Use this grading verdict as is_correct when writing the coach content.',
      'CONTEXT KEYS PROVIDED: question, expected_answer, user_answer, aliases, strict, category, meta, coach_depth.',
      'INSTRUCTIONS:',
      '1) THE "WHY": Explain the underlying logic or historical significance in 2-3 punchy sentences.',
      '2) THE "DEEP SCAN" (3 RELATED FACTS): Provide three additional high-value facts contextually linked to the answer.',
      '3) ERROR CORRECTION: If is_correct is false, briefly explain the specific difference between the user answer and the correct one.',
      '4) MEMORY ANCHOR: Provide one vivid, strange, or rhythmic mnemonic.',
      'Use question-specific clues and avoid generic encyclopedia dumps.',
      'OUTPUT FORMAT (Strict JSON, no markdown):',
      '{"correct":boolean,"reason":string,"coach":{"summary":"1-sentence definitive takeaway.","explanation":"Deep context explaining the logic of the answer.","related_facts":["Fact 1: [Connection Type] - [Data]","Fact 2: [Connection Type] - [Data]","Fact 3: [Connection Type] - [Data]"],"key_clues":["Specific word in the question that gives it away","A chronological or spatial anchor"],"memory_hook":"A short, sticky mnemonic or visual association.","study_focus":{"region":"String","era":"String","topic":"String"}}}'
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
        coach: buildFallbackCoach(fallbackCorrect, 'Could not parse DeepSeek response, used fallback coach.')
      });
    }

    const correct = !!graded.correct;
    const reason = String(graded.reason || '');
    let coach = normalizeCoach(graded.coach || graded, correct, reason);

    if (!isConceptCheckValid(coach.next_check_question, question, expected)) {
      const fixMessages = [
        {
          role: 'system',
          content: 'Rewrite only next_check_question as a concept-check (cause/effect/context), not a repetition, and do not include the expected answer string. Return JSON: {"next_check_question":string}.'
        },
        {
          role: 'user',
          content: JSON.stringify({
            original_question: question,
            expected_answer: expected,
            bad_next_check_question: coach.next_check_question
          })
        }
      ];
      const fixed = await callDeepSeek(fixMessages, 140);
      const nextQ = String(fixed?.next_check_question || '').trim();
      coach.next_check_question = isConceptCheckValid(nextQ, question, expected) ? nextQ : fallbackNextCheck(question);
    }

    return res.status(200).json({ correct, reason, coach });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
};
