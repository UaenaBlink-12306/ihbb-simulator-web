module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = req.body || {};
    const question = String(payload.question || '');
    const expected = String(payload.expected || '');
    const aliases = Array.isArray(payload.aliases) ? payload.aliases : [];
    const userAnswer = String(payload.user_answer ?? payload.answer ?? '');
    const strict = !!payload.strict;
    const coachEnabled = !!payload.coach_enabled;
    const coachDepth = String(payload.coach_depth || 'full');
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
      return {
        summary: correct
          ? 'You got it right. Keep tying clues to the specific historical context.'
          : 'This was likely a near-miss in concept matching rather than total misunderstanding.',
        error_diagnosis: correct
          ? 'Your answer aligned with the required entity and context.'
          : 'Your answer did not match the expected entity under strict identification, likely due to overlap with a related concept.',
        overlap_explainer: reasonText || 'Focus on the clue combination that uniquely identifies the expected answer.',
        key_clues: [
          'Identify which clue is unique rather than merely related.',
          'Prioritize clues that narrow to one entity.',
          'Cross-check timeframe and region before finalizing.'
        ],
        memory_hook: 'Anchor one distinctive clue to one named entity.',
        next_check_question: fallbackNextCheck(question),
        study_focus: {
          region,
          era,
          topic,
          icon: iconForFocus(region, topic)
        },
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

      return {
        summary: String(rc.summary || (correct ? 'Correct answer with good clue alignment.' : 'This answer was not accepted; review clue disambiguation.')).trim(),
        error_diagnosis: String(rc.error_diagnosis || (correct ? 'You identified the right entity.' : 'The response likely overlapped with a related but different concept.')).trim(),
        overlap_explainer: String(rc.overlap_explainer || reasonText || 'Use the most specific clues to separate related answers.').trim(),
        key_clues: keyClues.length ? keyClues : [
          'Track clues that uniquely identify the expected answer.',
          'Use era and region to eliminate close alternatives.',
          'Prioritize proper nouns and named events.'
        ],
        memory_hook: String(rc.memory_hook || 'Pair one unique clue with one canonical answer.').trim(),
        next_check_question: String(rc.next_check_question || '').trim(),
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
      const output = { correct: fallbackCorrect, reason: noKeyReason };
      if (coachEnabled) output.coach = buildFallbackCoach(fallbackCorrect, noKeyReason);
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

    const coachSystem = [
      'You are an IHBB grading + coaching assistant.',
      'Be error-centric: do not just explain the right answer; explain why the user answer may feel plausible and where overlap/confusion happens.',
      'Use only question-specific clues; avoid generic encyclopedia exposition.',
      'The next_check_question must be a concept-check about causation/result/context, not a repetition of the original question.',
      'Do not include the exact expected answer string inside next_check_question.',
      'Return strict JSON with this shape:',
      '{"correct":boolean,"reason":string,"coach":{"summary":string,"error_diagnosis":string,"overlap_explainer":string,"key_clues":string[],"memory_hook":string,"next_check_question":string,"study_focus":{"region":string,"era":string,"topic":string,"icon":string},"confidence":"high|medium|low"}}'
    ].join('\n');

    const coachMessages = [
      { role: 'system', content: coachSystem },
      {
        role: 'user',
        content: JSON.stringify({
          question,
          expected,
          aliases,
          user_answer: userAnswer,
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
