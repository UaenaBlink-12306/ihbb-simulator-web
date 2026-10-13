/**
 * Practice Hub — local/deploy server (optional but recommended).
 *
 * Serves the static frontend AND proxies AI grading to DeepSeek so the API
 * key never touches the browser.
 *
 * Usage:
 *   DEEPSEEK_API_KEY=sk-xxx node server.js        (Linux/macOS/Git Bash)
 *   set DEEPSEEK_API_KEY=sk-xxx && node server.js (Windows cmd)
 *   $env:DEEPSEEK_API_KEY="sk-xxx"; node server.js (Windows PowerShell)
 *
 * Env vars:
 *   DEEPSEEK_API_KEY          (required for AI grading; falls back to lenient local match without it)
 *   DEEPSEEK_MODEL            (optional, default: deepseek-chat)
 *   PORT                      (optional, default: 3000)
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

function parseJsonFromContent(content) {
  if (!content) return null;
  try { return JSON.parse(content); } catch { /* try fenced */ }
  const m = String(content).match(/\{[\s\S]*\}/);
  try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
}

function lenientMatch(userAnswer, expected, aliases) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const nu = norm(userAnswer);
  if (nu && nu === norm(expected)) return true;
  for (const a of aliases || []) if (nu && nu === norm(a)) return true;
  return false;
}

async function callDeepSeek(messages, maxTokens) {
  const key = process.env.DEEPSEEK_API_KEY;
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model, messages,
      response_format: { type: 'json_object' },
      temperature: 0.0,
      max_tokens: maxTokens
    })
  });
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content?.trim();
  return parseJsonFromContent(content);
}

async function handleGrade(body) {
  const question = String(body.question || '');
  const expected = String(body.expected || '');
  const aliases = Array.isArray(body.aliases) ? body.aliases : [];
  const userAnswer = String(body.answer ?? body.user_answer ?? '');
  const strict = !!body.strict;

  const fallbackCorrect = lenientMatch(userAnswer, expected, aliases);
  if (!process.env.DEEPSEEK_API_KEY) {
    return { correct: fallbackCorrect, reason: 'DEEPSEEK_API_KEY not set, used lenient match.' };
  }
  if (fallbackCorrect && !strict) {
    // local match already confident — skip the API call
    return { correct: true, reason: 'Matched locally.' };
  }
  try {
    const messages = [
      { role: 'system', content: [
        'You are an IHBB short-answer grader.',
        'Be lenient on spelling and minor phonetic variations when the intended answer is clear.',
        'If the student answer is understandable and the phonics line up with the expected answer, mark it correct instead of penalizing small spelling mistakes.',
        'Return only JSON: {"correct":boolean,"reason":string}.'
      ].join(' ') },
      { role: 'user', content: JSON.stringify({ question, expected, aliases, user_answer: userAnswer, strict }) }
    ];
    const result = await callDeepSeek(messages, 220);
    if (!result || typeof result.correct !== 'boolean') {
      return { correct: fallbackCorrect, reason: 'Could not parse DeepSeek response, used basic match instead.' };
    }
    let correct = !!result.correct;
    let reason = String(result.reason || '');
    if (!correct && /(spell|typo|phon|pronoun|misspell|capital)/i.test(reason) && lenientMatch(userAnswer, expected, aliases)) {
      correct = true;
      reason = 'Accepted with lenient spelling matching.';
    }
    return { correct, reason };
  } catch (e) {
    return { correct: fallbackCorrect, reason: `DeepSeek call failed (${e.message}), used basic match instead.` };
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/grade' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const out = await handleGrade(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ correct: false, reason: `Server error: ${e.message}` }));
    }
    return;
  }
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      deepseek: process.env.DEEPSEEK_API_KEY ? 'env key configured' : 'no key — local lenient grading only'
    }));
    return;
  }
  // static files
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(ROOT, file);
  if (!full.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
});

server.listen(PORT, () => {
  console.log(`Practice Hub running at http://localhost:${PORT}`);
  console.log(`DeepSeek grading: ${process.env.DEEPSEEK_API_KEY ? `ON (model: ${process.env.DEEPSEEK_MODEL || 'deepseek-chat'})` : 'OFF — set DEEPSEEK_API_KEY to enable AI grading'}`);
});
