(function initCoachEra(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.IHBBCoachEra = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function coachEraFactory() {
  'use strict';

  const ERA_NAMES = Object.freeze({
    '01': '8000 BCE – 600 BCE',
    '02': '600 BCE – 600 CE',
    '03': '600 CE – 1450 CE',
    '04': '1450 CE – 1750 CE',
    '05': '1750 – 1914',
    '06': '1914 – 1991',
    '07': '1991 – Present'
  });

  function comparable(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[\u2012-\u2015]/g, '-')
      .replace(/\s+/g, ' ');
  }

  function toCode(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (Object.prototype.hasOwnProperty.call(ERA_NAMES, raw)) return raw;
    if (/^[1-7]$/.test(raw)) return raw.padStart(2, '0');
    const target = comparable(raw);
    const match = Object.entries(ERA_NAMES).find(([, name]) => comparable(name) === target);
    return match ? match[0] : '';
  }

  function toName(value) {
    const raw = String(value || '').trim();
    const code = toCode(raw);
    return code ? ERA_NAMES[code] : raw;
  }

  return Object.freeze({ ERA_NAMES, toCode, toName });
});
