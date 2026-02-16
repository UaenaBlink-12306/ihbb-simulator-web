export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { question, answer } = req.body;
    // fallback simple match ignoring case and punctuation
    function normalize(str) {
      return String(str || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
    }
    function basicMatch(q, a) {
      return normalize(q) === normalize(a);
    }
    const key =process.env.DEEPSEEK_API_KEY;
    const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
    if (!key) {
      const correct = basicMatch(question, answer);
      return res.status(200).json({ correct, reason: 'DeepSeek API key not set, using basic match.' });
    }
    const messages = [
      { role: 'system', content: 'You are a quiz grader. Respond with a JSON object: {"correct": true or false, "reason": "explanation"}. Do not say anything else.' },
      { role: 'user', content: `Question: ${question}\nAnswer: ${answer}` }
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
        temperature: 0.0,
        max_tokens: 40
      })
    });
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content?.trim();
    let result;
    try {
      result = JSON.parse(content);
    } catch (err) {
      const correct = basicMatch(question, answer);
      return res.status(200).json({ correct, reason: 'Could not parse DeepSeek response, used basic match instead.' });
    }
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
