export default async function handler(req, res) {
  if (req.method !== 'POST') {
.    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { question = '', answer = '', expected = '', aliases = [], strict = true } = req.body || {};
    // fallback simple match ignoring case and punctuation
    function normalize(str) {
      return String(str || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
    }
    function basicMatch(userAnswer, expectedAnswer, acceptedAliases = []) {
      const user = normalize(userAnswer);
      if (!user) return false;
      if (user === normalize(expectedAnswer)) return true;
      for (const alias of acceptedAliases) {
        if (user === normalize(alias)) return true;
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
    const key = process.env.DEEPSEEK_API_KEY;
    const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
    if (!key) {
      const correct = basicMatch(answer, expected, aliases);
      return res.status(200).json({ correct, reason: 'DeepSeek API key not set, using basic match.' });
    }
    const messages = [
      {
        role: 'system',
        content:
          'You are a grader for IHBB. Only respond with a JSON object having two keys: "correct" (true or false) and "reason" (brief explanation). Do not include any other text or commentary.'
      },
      {
        role: 'user',
        content: JSON.stringify({ question, expected, aliases, user_answer: answer, strict })
      }
    ];
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model,
        messages,
            response_format: { type: 'json_object' },
      temperature: 0.0,
        max_tokens: 200
      })
    });
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content?.trim();
    const result = parseJsonFromContent(content);
    if (!result || typeof result.correct !== 'boolean') {
      const correct = basicMatch(answer, expected, aliases);
      return res.status(200).json({ correct, reason: 'Could not parse DeepSeek response, used basic match instead.' });
    }
    return res.status(200).json({ correct: result.correct, reason: String(result.reason || '') });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
