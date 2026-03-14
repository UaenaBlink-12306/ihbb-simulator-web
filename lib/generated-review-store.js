const fs = require('fs/promises');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const QUESTIONS_JSON_PATH = path.join(ROOT_DIR, 'questions.json');
const GENERATED_QUESTIONS_BANK_PATH = path.join(ROOT_DIR, 'generated_questions_bank.json');
const GENERATED_QUESTIONS_REVIEW_PATH = path.join(ROOT_DIR, 'generated_questions_review.json');

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

function questionStorageKey(raw) {
  const answer = normalizeCompact(raw?.answer || raw?.answer_text);
  const question = normalizeCompact(raw?.question || raw?.question_text);
  if (!answer || !question) return '';
  return `${answer}::${question}`;
}

function normalizeGeneratedBankItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const question = stringValue(raw.question || raw.question_text || raw.prompt || raw.text || raw.body).replace(/\s+/g, ' ').trim();
  const answer = stringValue(raw.answer || raw.answer_text || raw.canonical_answer || raw.solution).replace(/\s+/g, ' ').trim();
  if (!question || !answer) return null;
  const item = {
    id: stringValue(raw.id) || `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    question,
    answer,
    aliases: toAliasArray(raw.aliases),
    meta: {
      category: stringValue(raw?.meta?.category || raw.category || raw.region) || 'World',
      era: stringValue(raw?.meta?.era || raw.era),
      source: 'generated'
    }
  };
  const topic = stringValue(raw.topic);
  if (topic) item.topic = topic;
  const createdFrom = stringValue(raw.created_from);
  if (createdFrom) item.created_from = createdFrom;
  const createdByRole = stringValue(raw.created_by_role || raw.creator_role);
  if (createdByRole) item.created_by_role = createdByRole;
  return item;
}

function normalizeReviewEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = stringValue(raw.id);
  const storageKey = stringValue(raw.storage_key || raw.storageKey);
  if (!id && !storageKey) return null;
  const status = stringValue(raw.review_status || raw.status).toLowerCase();
  return {
    id,
    storage_key: storageKey,
    question: stringValue(raw.question),
    answer: stringValue(raw.answer),
    category: stringValue(raw.category),
    era: stringValue(raw.era),
    topic: stringValue(raw.topic),
    created_from: stringValue(raw.created_from),
    created_by_role: stringValue(raw.created_by_role),
    review_status: ['approved', 'deleted'].includes(status) ? status : 'pending',
    review_created_at: stringValue(raw.review_created_at) || new Date().toISOString(),
    reviewed_at: stringValue(raw.reviewed_at),
    merged: raw.merged !== false
  };
}

function mergeGeneratedItems(existingItems, incomingItems) {
  const nextItems = Array.isArray(existingItems) ? existingItems.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) : [];
  const byId = new Map();
  const byKey = new Map();
  for (const item of nextItems) {
    const id = stringValue(item.id);
    const key = questionStorageKey(item);
    if (id) byId.set(id, item);
    if (key) byKey.set(key, item);
  }
  const sessionItems = [];
  let added = 0;
  for (const raw of (incomingItems || [])) {
    const item = normalizeGeneratedBankItem(raw);
    if (!item) continue;
    const id = stringValue(item.id);
    const key = questionStorageKey(item);
    const existing = (id && byId.get(id)) || (key && byKey.get(key)) || null;
    if (existing) {
      sessionItems.push(existing);
      continue;
    }
    nextItems.push(item);
    if (id) byId.set(id, item);
    if (key) byKey.set(key, item);
    sessionItems.push(item);
    added += 1;
  }
  return { items: nextItems, sessionItems, added };
}

async function readJsonObject(filename, fallback) {
  try {
    const raw = await fs.readFile(filename, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {}
  return { ...fallback };
}

async function atomicWriteJson(filename, payload) {
  const tmpPath = `${filename}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
  await fs.rename(tmpPath, filename);
}

function buildReviewMaps(items) {
  const byId = new Map();
  const byKey = new Map();
  for (const raw of (items || [])) {
    const entry = normalizeReviewEntry(raw);
    if (!entry) continue;
    if (entry.id) byId.set(entry.id, entry);
    if (entry.storage_key) byKey.set(entry.storage_key, entry);
  }
  return { byId, byKey };
}

function upsertReviewEntries(reviewPayload, items) {
  reviewPayload.items = Array.isArray(reviewPayload.items) ? reviewPayload.items.map(normalizeReviewEntry).filter(Boolean) : [];
  const { byId, byKey } = buildReviewMaps(reviewPayload.items);
  let pendingAdded = 0;
  let blockedByDelete = 0;
  for (const raw of (items || [])) {
    const item = normalizeGeneratedBankItem(raw);
    if (!item) continue;
    const storageKey = questionStorageKey(item);
    const existing = (item.id && byId.get(item.id)) || (storageKey && byKey.get(storageKey)) || null;
    if (existing) {
      if (existing.review_status === 'deleted') blockedByDelete += 1;
      continue;
    }
    const entry = {
      id: item.id,
      storage_key: storageKey,
      question: item.question,
      answer: item.answer,
      category: stringValue(item?.meta?.category),
      era: stringValue(item?.meta?.era),
      topic: stringValue(item.topic),
      created_from: stringValue(item.created_from),
      created_by_role: stringValue(item.created_by_role),
      review_status: 'pending',
      review_created_at: new Date().toISOString(),
      reviewed_at: '',
      merged: true
    };
    reviewPayload.items.push(entry);
    if (entry.id) byId.set(entry.id, entry);
    if (entry.storage_key) byKey.set(entry.storage_key, entry);
    pendingAdded += 1;
  }
  return { pendingAdded, blockedByDelete };
}

function filterIncomingByReview(items, reviewPayload) {
  const reviewItems = Array.isArray(reviewPayload?.items) ? reviewPayload.items : [];
  const { byId, byKey } = buildReviewMaps(reviewItems);
  return (items || []).filter((raw) => {
    const item = normalizeGeneratedBankItem(raw);
    if (!item) return false;
    const storageKey = questionStorageKey(item);
    const existing = (item.id && byId.get(item.id)) || (storageKey && byKey.get(storageKey)) || null;
    return existing?.review_status !== 'deleted';
  });
}

async function persistGeneratedItems(items) {
  const persistence = {
    shared_bank_added: 0,
    shared_bank_total: 0,
    questions_json_added: 0,
    questions_json_updated: false,
    review_pending_added: 0,
    review_pending_total: 0,
    review_blocked: 0,
    warning: ''
  };
  const warnings = [];

  const reviewPayload = await readJsonObject(GENERATED_QUESTIONS_REVIEW_PATH, { id: 'generated_question_reviews', items: [] });
  const filteredIncoming = filterIncomingByReview(items, reviewPayload);
  persistence.review_blocked = Math.max(0, (items || []).length - filteredIncoming.length);

  try {
    const bankPayload = await readJsonObject(GENERATED_QUESTIONS_BANK_PATH, {
      id: 'generated_shared_bank',
      name: 'Shared Generated Questions',
      items: []
    });
    const mergedBank = mergeGeneratedItems(bankPayload.items, filteredIncoming);
    bankPayload.id = bankPayload.id || 'generated_shared_bank';
    bankPayload.name = bankPayload.name || 'Shared Generated Questions';
    bankPayload.items = mergedBank.items;
    await atomicWriteJson(GENERATED_QUESTIONS_BANK_PATH, bankPayload);
    persistence.shared_bank_added = mergedBank.added;
    persistence.shared_bank_total = mergedBank.items.length;
  } catch {
    warnings.push('Shared generated bank could not be updated on this server.');
  }

  try {
    const questionsPayload = await readJsonObject(QUESTIONS_JSON_PATH, { items: [] });
    const mergedQuestions = mergeGeneratedItems(questionsPayload.items, filteredIncoming);
    questionsPayload.items = mergedQuestions.items;
    await atomicWriteJson(QUESTIONS_JSON_PATH, questionsPayload);
    persistence.questions_json_added = mergedQuestions.added;
    persistence.questions_json_updated = true;
  } catch {
    warnings.push('questions.json could not be rewritten on this server.');
  }

  try {
    const reviewResult = upsertReviewEntries(reviewPayload, filteredIncoming);
    reviewPayload.id = reviewPayload.id || 'generated_question_reviews';
    await atomicWriteJson(GENERATED_QUESTIONS_REVIEW_PATH, reviewPayload);
    persistence.review_pending_added = reviewResult.pendingAdded;
    persistence.review_pending_total = reviewPayload.items.filter((entry) => entry.review_status === 'pending').length;
    persistence.review_blocked += reviewResult.blockedByDelete;
  } catch {
    warnings.push('Generated question review ledger could not be updated on this server.');
  }

  if (warnings.length) persistence.warning = warnings.join(' ');
  return persistence;
}

async function loadGeneratedModerationState() {
  const bankPayload = await readJsonObject(GENERATED_QUESTIONS_BANK_PATH, {
    id: 'generated_shared_bank',
    name: 'Shared Generated Questions',
    items: []
  });
  const reviewPayload = await readJsonObject(GENERATED_QUESTIONS_REVIEW_PATH, {
    id: 'generated_question_reviews',
    items: []
  });
  const reviewItems = Array.isArray(reviewPayload.items) ? reviewPayload.items.map(normalizeReviewEntry).filter(Boolean) : [];
  const reviewById = new Map();
  const reviewByKey = new Map();
  for (const entry of reviewItems) {
    if (entry.id) reviewById.set(entry.id, entry);
    if (entry.storage_key) reviewByKey.set(entry.storage_key, entry);
  }
  const bankItems = Array.isArray(bankPayload.items) ? bankPayload.items.map(normalizeGeneratedBankItem).filter(Boolean) : [];
  const records = bankItems.map((item) => {
    const storageKey = questionStorageKey(item);
    const review = reviewById.get(item.id) || reviewByKey.get(storageKey) || null;
    return {
      ...item,
      storage_key: storageKey,
      review_status: review?.review_status || 'pending',
      review_created_at: review?.review_created_at || '',
      reviewed_at: review?.reviewed_at || '',
      created_by_role: stringValue(item.created_by_role || review?.created_by_role),
      merged: review?.merged !== false
    };
  });
  const pendingOnly = reviewItems
    .filter((entry) => entry.review_status === 'pending')
    .map((entry) => ({
      id: entry.id,
      question: entry.question,
      answer: entry.answer,
      aliases: [],
      meta: {
        category: entry.category,
        era: entry.era,
        source: 'generated'
      },
      topic: entry.topic,
      created_from: entry.created_from,
      created_by_role: entry.created_by_role,
      storage_key: entry.storage_key,
      review_status: entry.review_status,
      review_created_at: entry.review_created_at,
      reviewed_at: entry.reviewed_at,
      merged: false
    }))
    .filter((entry) => !records.some((record) => record.id === entry.id || (record.storage_key && record.storage_key === entry.storage_key)));
  return {
    bankPayload,
    reviewPayload: { ...reviewPayload, items: reviewItems },
    records: records.concat(pendingOnly).sort((a, b) => String(b.review_created_at || '').localeCompare(String(a.review_created_at || '')))
  };
}

function removeQuestionFromList(items, targetId, targetKey) {
  return (items || []).filter((item) => {
    const normalized = normalizeGeneratedBankItem(item);
    if (!normalized) return false;
    const storageKey = questionStorageKey(normalized);
    if (targetId && stringValue(normalized.id) === targetId) return false;
    if (targetKey && storageKey === targetKey) return false;
    return true;
  });
}

async function updateReviewStatus(action, targetId = '') {
  const target = await loadGeneratedModerationState();
  const targetIdText = stringValue(targetId);
  const record = target.records.find((item) => stringValue(item.id) === targetIdText);
  if (!record) {
    const error = new Error('Generated question not found.');
    error.statusCode = 404;
    throw error;
  }
  const storageKey = questionStorageKey(record);
  const now = new Date().toISOString();
  if (action === 'delete') {
    target.bankPayload.items = removeQuestionFromList(target.bankPayload.items, targetIdText, storageKey);
    const questionsPayload = await readJsonObject(QUESTIONS_JSON_PATH, { items: [] });
    questionsPayload.items = removeQuestionFromList(questionsPayload.items, targetIdText, storageKey);
    await atomicWriteJson(QUESTIONS_JSON_PATH, questionsPayload);
    await atomicWriteJson(GENERATED_QUESTIONS_BANK_PATH, target.bankPayload);
  }
  let matched = false;
  target.reviewPayload.items = target.reviewPayload.items.map((entry) => {
    const matchesId = targetIdText && stringValue(entry.id) === targetIdText;
    const matchesKey = storageKey && stringValue(entry.storage_key) === storageKey;
    if (!matchesId && !matchesKey) return entry;
    matched = true;
    return {
      ...entry,
      review_status: action === 'delete' ? 'deleted' : 'approved',
      reviewed_at: now,
      merged: action !== 'delete'
    };
  });
  if (!matched) {
    target.reviewPayload.items.push({
      id: targetIdText,
      storage_key: storageKey,
      question: stringValue(record.question),
      answer: stringValue(record.answer),
      category: stringValue(record?.meta?.category),
      era: stringValue(record?.meta?.era),
      topic: stringValue(record.topic),
      created_from: stringValue(record.created_from),
      created_by_role: stringValue(record.created_by_role),
      review_status: action === 'delete' ? 'deleted' : 'approved',
      review_created_at: stringValue(record.review_created_at) || now,
      reviewed_at: now,
      merged: action !== 'delete'
    });
  }
  await atomicWriteJson(GENERATED_QUESTIONS_REVIEW_PATH, target.reviewPayload);
  return loadGeneratedModerationState();
}

async function approveAllGeneratedQuestions() {
  const target = await loadGeneratedModerationState();
  const now = new Date().toISOString();
  let changed = 0;
  target.reviewPayload.items = target.reviewPayload.items.map((entry) => {
    if (entry.review_status !== 'pending') return entry;
    changed += 1;
    return {
      ...entry,
      review_status: 'approved',
      reviewed_at: now,
      merged: true
    };
  });
  await atomicWriteJson(GENERATED_QUESTIONS_REVIEW_PATH, target.reviewPayload);
  return { changed, state: await loadGeneratedModerationState() };
}

async function getQuestionsJsonCount() {
  try {
    const payload = await readJsonObject(QUESTIONS_JSON_PATH, { items: [] });
    return Array.isArray(payload.items) ? payload.items.length : 0;
  } catch {
    return 0;
  }
}

module.exports = {
  GENERATED_QUESTIONS_BANK_PATH,
  GENERATED_QUESTIONS_REVIEW_PATH,
  QUESTIONS_JSON_PATH,
  questionStorageKey,
  persistGeneratedItems,
  loadGeneratedModerationState,
  updateReviewStatus,
  approveAllGeneratedQuestions,
  getQuestionsJsonCount
};
