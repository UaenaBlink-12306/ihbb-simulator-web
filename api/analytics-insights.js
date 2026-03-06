module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const payload = typeof req.body === 'string'
      ? JSON.parse(req.body || '{}')
      : (req.body || {});

    function num(value, digits = null) {
      const n = Number(value);
      if (!Number.isFinite(n)) return null;
      return digits === null ? n : Number(n.toFixed(digits));
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

    function normalizeSummary() {
      const summary = (payload.summary && typeof payload.summary === 'object') ? payload.summary : {};
      return {
        total_attempts: Math.max(0, Math.round(num(summary.total_attempts, 0) || 0)),
        total_accuracy: Math.max(0, Math.min(100, Math.round(num(summary.total_accuracy, 0) || 0))),
        avg_buzz_seconds: num(summary.avg_buzz_seconds, 2),
        sessions: Math.max(0, Math.round(num(summary.sessions, 0) || 0)),
        active_days: Math.max(0, Math.round(num(summary.active_days, 0) || 0)),
        fastest_buzz_seconds: num(summary.fastest_buzz_seconds, 2),
        accuracy_delta_7d: num(summary.accuracy_delta_7d, 1),
        buzz_delta_7d: num(summary.buzz_delta_7d, 2)
      };
    }

    function normalizeArea(raw) {
      if (!raw || typeof raw !== 'object') return null;
      const name = String(raw.name || raw.title || '').trim();
      if (!name) return null;
      return {
        name,
        dim: String(raw.dim || raw.dimension || 'Focus').trim() || 'Focus',
        attempts: Math.max(0, Math.round(num(raw.attempts, 0) || 0)),
        correct: Math.max(0, Math.round(num(raw.correct, 0) || 0)),
        accuracy: Math.max(0, Math.min(100, Math.round(num(raw.accuracy, 0) || 0))),
        avg_buzz: num(raw.avg_buzz, 2)
      };
    }

    function collectAreas(key) {
      const raw = Array.isArray(payload[key]) ? payload[key] : [];
      return raw.map(normalizeArea).filter(Boolean);
    }

    function dedupeAreas(list) {
      const out = [];
      const seen = new Set();
      for (const area of Array.isArray(list) ? list : []) {
        const key = `${area.dim}|${area.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(area);
      }
      return out;
    }

    function areaPriority(area) {
      if (area.accuracy < 50 || area.attempts >= 10) return 'high';
      if (area.accuracy < 70) return 'medium';
      return 'low';
    }

    function areaAction(area) {
      const dim = String(area.dim || '').toLowerCase();
      if (dim === 'era') {
        return `Run two short drills in ${area.name} and write down three timeline anchors before buzzing.`;
      }
      if (dim === 'region') {
        return `Practice ${area.name} in mixed-region sets and wait for one uniquely regional clue before buzzing in.`;
      }
      return `Build one short focused set on ${area.name} and slow your buzz until the disambiguating clue appears.`;
    }

    const windowDays = Math.max(1, Math.round(num(payload.window_days, 0) || 30));
    const summary = normalizeSummary();
    const blindSpots = collectAreas('blind_spots');
    const weakEras = collectAreas('weak_eras');
    const weakRegions = collectAreas('weak_regions');
    const strengths = collectAreas('strengths');

    function buildFallbackInsights() {
      const weakCandidates = dedupeAreas([...blindSpots, ...weakEras, ...weakRegions]).slice(0, 3);
      const weakAreas = weakCandidates.map(area => ({
        title: `${area.dim}: ${area.name}`,
        dimension: area.dim,
        why: area.accuracy < 55
          ? 'You are missing too many questions in this slice for it to stay in mixed practice.'
          : 'This segment is trailing the rest of your chart and is likely dragging overall accuracy down.',
        evidence: `${area.accuracy}% accuracy over ${area.attempts} questions${area.avg_buzz ? ` with a ${area.avg_buzz.toFixed(2)}s average buzz.` : '.'}`,
        action: areaAction(area),
        priority: areaPriority(area)
      }));
      const wins = strengths.slice(0, 2).map(area =>
        `${area.dim}: ${area.name} is holding at ${area.accuracy}% across ${area.attempts} questions.`
      );
      const nextSteps = [];
      if (weakAreas[0]) nextSteps.push(weakAreas[0].action);
      if (weakAreas[1]) nextSteps.push(weakAreas[1].action);
      if (summary.active_days < 5) {
        nextSteps.push('Add three shorter practice days this week so weak-area review is repeated instead of crammed.');
      }
      if (Number.isFinite(summary.accuracy_delta_7d) && summary.accuracy_delta_7d < 0) {
        nextSteps.push('Pause mixed drilling for one session and rebuild accuracy with targeted review before speeding up again.');
      }
      if (!nextSteps.length) {
        nextSteps.push('Keep one mixed drill and one targeted weak-area drill in the same week to stabilize gains.');
      }
      return {
        headline: weakAreas[0]
          ? `${weakAreas[0].title} is the clearest weak area to improve next.`
          : 'Your analytics are starting to show a few workable study patterns.',
        overview: `Over the last ${windowDays} days you answered ${summary.total_attempts} questions at ${summary.total_accuracy}% accuracy across ${summary.sessions} sessions and ${summary.active_days} active days.`,
        weak_areas: weakAreas,
        wins,
        next_steps: nextSteps.slice(0, 4),
        confidence: summary.total_attempts >= 40 ? 'high' : (summary.total_attempts >= 15 ? 'medium' : 'low')
      };
    }

    const fallback = buildFallbackInsights();

    function normalizeInsights(raw) {
      const obj = (raw && typeof raw === 'object') ? raw : {};
      const weakAreas = Array.isArray(obj.weak_areas)
        ? obj.weak_areas.map((item, index) => {
            if (!item || typeof item !== 'object') return null;
            const title = String(item.title || item.name || '').trim();
            if (!title) return null;
            const fb = fallback.weak_areas[index] || fallback.weak_areas[0] || {
              why: 'This slice is underperforming compared with the rest of your recent practice.',
              evidence: 'Recent drill results show this area needs more attention.',
              action: 'Run one short focused drill on this area before returning to mixed practice.',
              priority: 'medium'
            };
            const priorityRaw = String(item.priority || '').trim().toLowerCase();
            return {
              title,
              dimension: String(item.dimension || item.dim || 'Focus').trim() || 'Focus',
              why: String(item.why || item.diagnosis || '').trim() || fb.why,
              evidence: String(item.evidence || '').trim() || fb.evidence,
              action: String(item.action || item.recommendation || '').trim() || fb.action,
              priority: ['high', 'medium', 'low'].includes(priorityRaw) ? priorityRaw : fb.priority
            };
          }).filter(Boolean).slice(0, 3)
        : [];

      const wins = Array.isArray(obj.wins)
        ? obj.wins.map(x => String(x || '').trim()).filter(Boolean).slice(0, 3)
        : [];
      const nextSteps = Array.isArray(obj.next_steps)
        ? obj.next_steps.map(x => String(x || '').trim()).filter(Boolean).slice(0, 4)
        : [];
      const confidenceRaw = String(obj.confidence || '').trim().toLowerCase();

      return {
        headline: String(obj.headline || '').trim() || fallback.headline,
        overview: String(obj.overview || '').trim() || fallback.overview,
        weak_areas: weakAreas.length ? weakAreas : fallback.weak_areas,
        wins: wins.length ? wins : fallback.wins,
        next_steps: nextSteps.length ? nextSteps : fallback.next_steps,
        confidence: ['high', 'medium', 'low'].includes(confidenceRaw) ? confidenceRaw : fallback.confidence
      };
    }

    if (!process.env.DEEPSEEK_API_KEY) {
      return res.status(200).json({ source: 'fallback', insights: fallback });
    }

    async function callDeepSeek(messages, maxTokens) {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
          model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
          messages,
          response_format: { type: 'json_object' },
          temperature: 0.0,
          max_tokens: maxTokens
        })
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `DeepSeek request failed with ${response.status}`);
      }

      const data = await response.json();
      return parseJsonFromContent(data?.choices?.[0]?.message?.content || '');
    }

    const system = [
      'You are an IHBB analytics coach. You are given only aggregated 30-day performance data.',
      'Identify the student\'s weakest eras and regions, explain why they matter, and propose specific next steps.',
      'Do not invent data that is not present. Keep the advice concise and practical.',
      'Return strict JSON only with this shape:',
      '{"headline":"string","overview":"string","weak_areas":[{"title":"string","dimension":"string","why":"string","evidence":"string","action":"string","priority":"high|medium|low"}],"wins":["string"],"next_steps":["string"],"confidence":"high|medium|low"}'
    ].join('\n');

    const user = {
      window_days: windowDays,
      summary,
      blind_spots: blindSpots,
      weak_eras: weakEras,
      weak_regions: weakRegions,
      strengths
    };

    try {
      const raw = await callDeepSeek([
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(user) }
      ], 720);

      return res.status(200).json({
        source: 'deepseek',
        insights: normalizeInsights(raw)
      });
    } catch {
      return res.status(200).json({ source: 'fallback', insights: fallback });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
};
