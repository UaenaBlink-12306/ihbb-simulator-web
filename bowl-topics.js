(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.IHBBBowlTopics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function normalizeGroups(rawGroups, items) {
    if (!Array.isArray(rawGroups)) return [];
    const ids = new Set(items.map(item => item.id));
    const seen = new Set();
    return rawGroups.flatMap(raw => {
      if (!raw || typeof raw.id !== 'string' || !raw.id || seen.has(raw.id)
        || typeof raw.topic !== 'string' || !raw.topic.trim()
        || !Array.isArray(raw.questionIds) || !raw.questionIds.length
        || raw.questionIds.some(id => !ids.has(id))) return [];
      seen.add(raw.id);
      return [{ id: raw.id, topic: raw.topic.trim(), prompt: String(raw.prompt || ''),
        packet: String(raw.packet || ''), questionIds: raw.questionIds.slice() }];
    });
  }
  function selectedGroup(set, id) {
    return id ? (set?.bowlThirdQuarterGroups || []).find(group => group.id === id) || null : null;
  }
  function groupItems(set, id) {
    const group = selectedGroup(set, id);
    if (!group) return [];
    const byId = new Map(set.items.map(item => [item.id, item]));
    // A stale selection must never silently widen to the whole question bank.
    if (group.questionIds.some(questionId => !byId.has(questionId))) return [];
    return group.questionIds.map(questionId => byId.get(questionId));
  }
  function packetLabel(packet) {
    return String(packet || '').replace(/\.pdf$/i, '').replace(/[_/]+/g, ' / ').replace(/-/g, ' ');
  }
  function libraryEntries(set, { thirdQuarterOnly = false, topicId = '', query = '', category = '', era = '' } = {}) {
    const items = set?.items || [];
    let entries;
    if (thirdQuarterOnly) {
      const byId = new Map(items.map((it, idx) => [it.id, { it, idx }]));
      entries = (set?.bowlThirdQuarterGroups || [])
        .filter(group => !topicId || group.id === topicId)
        .slice().sort((a, b) => a.topic.localeCompare(b.topic) || a.packet.localeCompare(b.packet))
        .flatMap(group => group.questionIds.flatMap((id, index) => {
          const entry = byId.get(id);
          return entry ? [{ ...entry, group, number: index + 1 }] : [];
        }));
    } else {
      entries = items.map((it, idx) => ({ it, idx, group: null }));
    }
    const search = String(query || '').trim().toLocaleLowerCase();
    return entries.filter(({ it, group }) => {
      if (category && (it.meta?.category || '') !== category) return false;
      if (era && (it.meta?.era || '') !== era) return false;
      return !search || [it.question, it.answer, group?.topic, group?.prompt, group?.packet]
        .some(value => String(value || '').toLocaleLowerCase().includes(search));
    });
  }
  function spokenQuestion(group, question) {
    if (!group) return question;
    const context = group.prompt || group.topic;
    const lower = question.toLocaleLowerCase();
    const topic = group.topic.toLocaleLowerCase();
    const hasContext = lower.startsWith(context.toLocaleLowerCase())
      || lower.startsWith('concerning ' + topic) || lower.startsWith('regarding ' + topic);
    return hasContext ? question : group.topic + '. ' + context + ' ' + question;
  }
  return { normalizeGroups, selectedGroup, groupItems, packetLabel, spokenQuestion, libraryEntries };
});
