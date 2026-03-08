const REGION_OPTIONS = [
  'Africa',
  'Central Asia',
  'East Asia',
  'Europe',
  'Latin America',
  'Middle East',
  'North America',
  'Oceania',
  'South Asia',
  'Southeast Asia',
  'World'
];

const ERA_LABELS = {
  '01': '8000 BCE – 600 BCE',
  '02': '600 BCE – 600 CE',
  '03': '600 CE – 1450 CE',
  '04': '1450 CE – 1750 CE',
  '05': '1750 – 1914',
  '06': '1914 – 1991',
  '07': '1991 – Present'
};

function parseJsonFromContent(content) {
  if (!content) return null;
  const trimmed = String(content).trim();
  try {
    return JSON.parse(trimmed);
  } catch {}

  const cleaned = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const arrayStart = cleaned.indexOf('[');
  const arrayEnd = cleaned.lastIndexOf(']');
  const objectStart = cleaned.indexOf('{');
  const objectEnd = cleaned.lastIndexOf('}');
  if (objectStart !== -1 && objectEnd > objectStart) {
    try {
      return JSON.parse(cleaned.slice(objectStart, objectEnd + 1));
    } catch {}
  }
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    try {
      return JSON.parse(cleaned.slice(arrayStart, arrayEnd + 1));
    } catch {}
  }
  return null;
}

function stringValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function normalizeCompact(value) {
  return stringValue(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function toAliasArray(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map(stringValue).filter(Boolean)));
  }
  if (typeof value === 'string') {
    return Array.from(new Set(value.split(/[;,|]/).map(stringValue).filter(Boolean)));
  }
  return [];
}

function splitSentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z"'])/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeRegion(raw) {
  const target = stringValue(raw).toLowerCase();
  if (!target) return '';
  const direct = REGION_OPTIONS.find((region) => region.toLowerCase() === target);
  if (direct) return direct;
  const aliasMap = {
    americas: 'North America',
    america: 'North America',
    eastasia: 'East Asia',
    southasia: 'South Asia',
    southeastasia: 'Southeast Asia',
    centralasia: 'Central Asia',
    middleeast: 'Middle East',
    latinamerica: 'Latin America',
    northamerica: 'North America'
  };
  return aliasMap[target.replace(/[^a-z]+/g, '')] || '';
}

function normalizeEra(raw) {
  const text = stringValue(raw);
  if (!text) return '';
  if (ERA_LABELS[text]) return text;
  const lower = text.toLowerCase();
  const direct = Object.entries(ERA_LABELS).find(([, label]) => label.toLowerCase() === lower);
  if (direct) return direct[0];
  const fuzzy = Object.entries(ERA_LABELS).find(([, label]) => {
    const normalizedLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    const normalizedText = lower.replace(/[^a-z0-9]+/g, ' ');
    return normalizedLabel.includes(normalizedText) || normalizedText.includes(normalizedLabel);
  });
  if (fuzzy) return fuzzy[0];
  if (/8000|600 bce/.test(lower)) return '01';
  if (/600 ce|classical/.test(lower)) return '02';
  if (/1450/.test(lower)) return '03';
  if (/1750/.test(lower)) return '04';
  if (/1914/.test(lower)) return '05';
  if (/1991/.test(lower)) return '06';
  if (/present|modern/.test(lower)) return '07';
  return '';
}

function makeGeneratedId(index = 0) {
  return `gen_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeGeneratedItem(raw, defaults, index, seenKeys, avoidAnswers) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const question = stringValue(raw.question || raw.prompt || raw.text || raw.body).replace(/\s+/g, ' ').trim();
  const answer = stringValue(raw.answer || raw.canonical_answer || raw.solution).replace(/\s+/g, ' ').trim();
  if (!question || !answer) return null;

  const sentences = splitSentences(question);
  if (sentences.length !== 4) return null;
  const clueText = normalizeCompact(sentences.slice(0, 3).join(' '));
  if (clueText && clueText.includes(normalizeCompact(answer))) return null;
  if (!/for the point/i.test(sentences[3])) return null;

  const category = normalizeRegion(raw.category || raw.region || raw.meta?.category || defaults.region) || defaults.region || 'World';
  const era = normalizeEra(raw.era || raw.meta?.era || defaults.era) || defaults.era || '';
  const aliases = toAliasArray(raw.aliases);
  const answerKey = normalizeCompact(answer);
  const questionKey = normalizeCompact(question);
  if (!answerKey || !questionKey) return null;
  if (seenKeys.has(`${answerKey}::${questionKey}`)) return null;
  if (avoidAnswers.has(answerKey)) return null;
  seenKeys.add(`${answerKey}::${questionKey}`);

  return {
    id: makeGeneratedId(index),
    question,
    answer,
    aliases,
    meta: {
      category,
      era,
      source: 'generated'
    },
    topic: stringValue(raw.topic || defaults.topic),
    created_from: stringValue(defaults.createdFrom)
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
      temperature: 0.2,
      max_tokens: maxTokens
    })
  });

  const text = await response.text();
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('DeepSeek API key is invalid.');
    }
    throw new Error(text || `DeepSeek request failed with ${response.status}`);
  }
  const data = JSON.parse(text);
  return parseJsonFromContent(data?.choices?.[0]?.message?.content?.trim());
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.DEEPSEEK_API_KEY) {
    return res.status(503).json({ error: 'DeepSeek API key not configured.' });
  }

  try {
    const payload = typeof req.body === 'string'
      ? JSON.parse(req.body || '{}')
      : (req.body || {});

    const count = Math.max(1, Math.min(12, Number.parseInt(String(payload.count || payload.num_questions || 5), 10) || 5));
    const region = normalizeRegion(payload.region || payload.category) || 'World';
    const era = normalizeEra(payload.era || payload.era_code || payload.eraCode);
    const topic = stringValue(payload.topic || payload.focus_topic || payload.focus || payload.theme);
    const creatorRole = stringValue(payload.creator_role || payload.role || 'student') || 'student';
    const createdFrom = stringValue(payload.created_from || payload.source_context || payload.purpose || 'practice');
    const avoidAnswers = new Set(toAliasArray(payload.avoid_answers).map(normalizeCompact).filter(Boolean));
    const referenceQuestion = stringValue(payload.reference_question);
    const referenceAnswer = stringValue(payload.reference_answer);
    const wrongAnswer = stringValue(payload.wrong_answer);
    const focusReason = stringValue(payload.focus_reason || payload.reason);

    const system = [
      'You write IHBB-style history tossup practice questions.',
      `Return JSON only with shape {"items":[{"question":"...","answer":"...","aliases":["..."],"region":"${region}","era":"${era || 'code'}","topic":"${topic || 'General'}"}]}.`,
      'Every question must contain exactly 4 sentences total, in this order:',
      'Sentence 1 = hardest clue.',
      'Sentence 2 = medium clue.',
      'Sentence 3 = medium clue.',
      'Sentence 4 = easiest giveaway and must begin with "For the point, name this" or "For the point, identify this".',
      'Do not reveal or directly quote the answer before sentence 4.',
      'Use historically real, clue-rich facts. Avoid vague textbook summaries.',
      'Keep answers distinct from one another.',
      `Region must be exactly one of: ${REGION_OPTIONS.join(', ')}.`,
      `Era must be one of these codes only: ${Object.entries(ERA_LABELS).map(([code, label]) => `${code} (${label})`).join(', ')}.`,
      'Source is always generated; do not return any other source label.'
    ].join('\n');

    const user = {
      count,
      focus: {
        region,
        era_code: era,
        era_label: era ? ERA_LABELS[era] : '',
        topic,
        creator_role: creatorRole,
        created_from: createdFrom
      },
      context: {
        focus_reason: focusReason,
        reference_question: referenceQuestion,
        reference_answer: referenceAnswer,
        wrong_answer: wrongAnswer
      },
      avoid_answers: Array.from(avoidAnswers)
    };

    const raw = await callDeepSeek([
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify(user) }
    ], 2200);

    const rawItems = Array.isArray(raw)
      ? raw
      : (Array.isArray(raw?.items) ? raw.items : (Array.isArray(raw?.questions) ? raw.questions : []));
    const seenKeys = new Set();
    const items = rawItems
      .map((item, index) => normalizeGeneratedItem(item, { region, era, topic, createdFrom }, index, seenKeys, avoidAnswers))
      .filter(Boolean);

    if (!items.length) {
      return res.status(502).json({ error: 'DeepSeek returned no valid generated questions.' });
    }

    return res.status(200).json({
      source: 'deepseek',
      requested: count,
      returned: items.length,
      items
    });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Question generation failed.' });
  }
};
