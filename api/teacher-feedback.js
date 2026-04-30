module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = typeof req.body === 'string'
      ? JSON.parse(req.body || '{}')
      : (req.body || {});

    const studentName = String(payload.studentName || 'Student').trim();
    const accuracy = Number(payload.accuracy);
    const practiceSessions = Number(payload.practiceSessions);
    const completion = Number(payload.completion);
    const blindSpots = Array.isArray(payload.blindSpots) ? payload.blindSpots : [];

    const fallbackFeedback = `Hi ${studentName},\n\nKeep up the great work! You've been active in ${practiceSessions || 0} practice sessions recently.\n\nMake sure to review any areas where you feel less confident, and keep drilling those questions.\n\nBest,\nYour Teacher`;

    if (!process.env.DEEPSEEK_API_KEY) {
      return res.status(200).json({ feedback: fallbackFeedback });
    }

    const system = [
      'You are a supportive, expert history teacher writing a short piece of feedback to a student.',
      'Use the provided performance data to personalize the feedback.',
      'Acknowledge their effort, gently point out 1-2 areas for improvement (like specific blind spots if provided), and give a concrete, actionable study tip.',
      'Keep the tone encouraging, constructive, and brief (3-4 short paragraphs maximum).',
      'Sign off as "Your Teacher".',
      'Do not output JSON or markdown code blocks, just return the plain text message.'
    ].join('\n');

    const promptData = {
      name: studentName,
      accuracy: Number.isFinite(accuracy) ? `${accuracy}%` : 'N/A',
      sessions_completed: practiceSessions || 0,
      assignment_completion: Number.isFinite(completion) ? `${completion}%` : 'N/A',
      blind_spots: blindSpots.slice(0, 2).map(bs => `${bs.dim || 'Topic'}: ${bs.name} (${Math.round(bs.accuracy || 0)}% accuracy)`)
    };

    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
        thinking: { type: 'disabled' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: JSON.stringify(promptData) }
        ],
        temperature: 0.7,
        max_tokens: 350
      })
    });

    if (!response.ok) {
      throw new Error(`DeepSeek API failed with ${response.status}`);
    }

    const data = await response.json();
    const feedback = data?.choices?.[0]?.message?.content || fallbackFeedback;

    return res.status(200).json({ feedback: feedback.trim() });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
};
