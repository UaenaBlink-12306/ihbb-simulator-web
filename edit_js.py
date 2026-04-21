import re

with open('api/generate-questions.js', 'r', encoding='utf-8') as f:
    original_code = f.read()

# Add validation logic
validation_code = '''
async function validateGeneratedQuestion(item) {
  if (!process.env.DEEPSEEK_API_KEY) {
    return { valid: true, reason: 'Validation skipped (no API key)' };
  }
  const question = stringValue(item.question);
  const answer = stringValue(item.answer);
  if (!question || !answer) {
    return { valid: false, reason: 'Missing question or answer text' };
  }
  const system = [
    'You are a quality checker for IHBB (International History Bee and Bowl) tossup questions.',
    'Given a question and its expected answer, check:',
    '1. Is the question historically accurate? Are the facts correct?',
    '2. Does it follow pyramid format (4 sentences, hardest clue first, giveaway last)?',
    '3. Does the last sentence start with "For the point"?',
    '4. Is the answer unambiguous and clearly the only correct response?',
    '5. Does the question avoid revealing the answer before the final sentence?',
    'Return strict JSON: {"valid": boolean, "reason": "short explanation"}'
  ].join('\\n');
  const userPayload = { question, answer };
  try {
    const obj = await callDeepSeek([
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify(userPayload) }
    ], 150);
    if (obj && typeof obj.valid === 'boolean') {
      return { valid: Boolean(obj.valid), reason: stringValue(obj.reason) };
    }
  } catch (error) {
    console.warn('DeepSeek validation call failed:', error.message);
  }
  return { valid: true, reason: 'Validation call failed; accepted by default' };
}

module.exports = async function handler(req, res) {'''

code = original_code.replace(
    'module.exports = async function handler(req, res) {',
    validation_code
)

# Modify the return block to validate
old_return_pattern = re.compile(
    r'    const seenKeys = new Set\(\);\s*const items = rawItems\s*\.map\(\(item, index\) => normalizeGeneratedItem\(item, \{ region, era, topic, createdFrom, creatorRole \}, index, seenKeys, avoidAnswers\)\)\s*\.filter\(Boolean\);\s*if \(\!items\.length\) \{\s*return res\.status\(502\)\.json\(\{ error: \'DeepSeek returned no valid generated questions\.\' \}\);\s*\}\s*return res\.status\(200\)\.json\(\{\s*source: \'deepseek\',\s*requested: count,\s*returned: items\.length,\s*items\s*\}\);',
    re.MULTILINE | re.DOTALL
)

new_return = '''    const seenKeys = new Set();
    const parsedItems = rawItems
      .map((item, index) => normalizeGeneratedItem(item, { region, era, topic, createdFrom, creatorRole }, index, seenKeys, avoidAnswers))
      .filter(Boolean);

    if (!parsedItems.length) {
      return res.status(502).json({ error: 'DeepSeek returned no valid generated questions.' });
    }

    const skipValidation = Boolean(payload.skip_validation);
    const items = [];
    const validationResults = [];

    for (const item of parsedItems) {
      if (skipValidation) {
        items.push(item);
        validationResults.push({ valid: true, reason: 'Validation skipped' });
      } else {
        const result = await validateGeneratedQuestion(item);
        validationResults.push(result);
        if (result.valid) {
          items.push(item);
        } else {
          console.log(`Generated question rejected by validation: answer=${item.answer} reason=${result.reason}`);
        }
      }
    }

    if (!items.length) {
      return res.status(502).json({ error: 'All generated questions failed validation.', validation_results: validationResults });
    }

    // Serverless doesn't have local persistence; relying on client app.js to sync to Supabase table
    return res.status(200).json({
      source: 'deepseek',
      requested: count,
      returned: items.length,
      validated: items.length,
      rejected: parsedItems.length - items.length,
      items
    });'''

if old_return_pattern.search(code):
    code = old_return_pattern.sub(new_return.replace('\\n', '\\r\\n'), code)
    with open('api/generate-questions.js', 'w', encoding='utf-8', newline='') as f:
        f.write(code)
    print("Success!")
else:
    print("Failed to match return block. Please check the regex.")
