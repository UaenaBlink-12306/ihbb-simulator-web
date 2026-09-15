/* Account-scoped, browser-local assignment checkpoints. */
(function (root) {
  const prefix = 'ihbb_assignment_progress_';
  const key = (user, id, mode = 'first') => prefix + encodeURIComponent(user) + '_' + encodeURIComponent(id) + '_' + mode;
  function read(user, id, mode = 'first') {
    try {
      const value = JSON.parse(localStorage.getItem(key(user, id, mode)));
      if (!user || !value || value.version !== 1 || value.user !== user || value.id !== id || value.mode !== mode || !Array.isArray(value.items) || !value.items.length || !value.items.every(item => item && item.id && typeof item.question === 'string' && typeof item.answer === 'string') || !Array.isArray(value.results) || value.results.length > value.items.length || !value.results.every(x => typeof x === 'boolean') || !Array.isArray(value.answers) || value.answers.length !== value.results.length) return null;
      return value;
    } catch { return null; }
  }
  root.AssignmentProgress = {
    read,
    save(user, id, mode, data) {
      if (!user || !id) return false;
      try { localStorage.setItem(key(user, id, mode), JSON.stringify({ ...data, version: 1, user, id, mode, savedAt: Date.now() })); return true; } catch { return false; }
    },
    remove(user, id, mode) { try { localStorage.removeItem(key(user, id, mode)); } catch {} },
    list(user) {
      const found = [];
      try { for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k.startsWith(prefix)) continue;
        try { const v = JSON.parse(localStorage.getItem(k)); const valid = v && read(user, v.id, v.mode); if (valid) found.push(valid); } catch {}
      } } catch {}
      return found.sort((a, b) => b.savedAt - a.savedAt);
    },
    matches(saved, items) {
      return saved && saved.items.length === items.length && saved.items.every(old => items.some(item => String(item.id) === String(old.id) && item.question === old.question && item.answer === old.answer));
    }
  };
})(window);
