import re

with open('app.js', 'r', encoding='utf-8') as f:
    app_code = f.read()

# 1. Modify the source initialization in buildFilteredPoolFromSet
pool_filter_old = '''  if (App.filters.src) arr = arr.filter(it => (it.meta?.source || '') === App.filters.src);'''
pool_filter_new = '''  if (App.filters.src) arr = arr.filter(it => {
    const src = String(it.meta?.source || 'original').trim().toLowerCase();
    const filterSrc = String(App.filters.src || '').trim().toLowerCase();
    return filterSrc ? src === filterSrc : true;
  });'''
app_code = app_code.replace(pool_filter_old, pool_filter_new)

# 2. Add renderSourceChips and update getSetupFilterDetails and hydrateSharedGeneratedQuestions
hydrate_code = '''
async function hydrateSharedGeneratedQuestions() {
  if (!window.supabaseClient) return [];
  try {
    const { data, error } = await window.supabaseClient
      .from(GENERATED_SYNC_TABLE)
      .select('id, question_text, answer_text, aliases, category, era, source, topic, created_from, created_by_role')
      .order('created_at', { ascending: false })
      .limit(1000);
    if (error) throw error;
    
    const items = (Array.isArray(data) ? data : []).map(normalizeGeneratedQuestionRecord).filter(Boolean);
    if (items.length) {
      mergeGeneratedQuestionsIntoLibrary(items, { activate: false, persistLocal: true });
    }
    return items;
  } catch (err) {
    console.warn('[GeneratedQuestionsSync] shared fetch failed.', err);
    return [];
  }
}

function renderSourceChips() {
  const wrap = $('src-chips'); if (!wrap) return;
  wrap.innerHTML = '';
  const sources = [
    { label: 'All sources', value: '' },
    { label: 'Original', value: 'original' },
    { label: 'Generated', value: 'generated' }
  ];
  const selected = String(App.filters.src || '').trim().toLowerCase();
  
  sources.forEach(src => {
    const chip = document.createElement('div');
    const isActive = selected === src.value;
    chip.className = 'chip' + (isActive ? ' active' : '');
    chip.textContent = src.label;
    chip.dataset.src = src.value;
    chip.onclick = () => {
      App.filters.src = src.value;
      renderSourceChips();
      updateSetupOverview();
    };
    wrap.appendChild(chip);
  });
}
'''

# Find the end of hydratePrivateGeneratedQuestions to insert the new block
hydrate_private_end = '''async function hydratePrivateGeneratedQuestions(forceCloud = false) {
  const items = await fetchPrivateGeneratedQuestionItems(forceCloud);
  if (!items.length) return false;
  mergeGeneratedQuestionsIntoLibrary(items, { activate: false, persistLocal: true });
  return true;
}'''

if hydrate_private_end in app_code:
    app_code = app_code.replace(hydrate_private_end, hydrate_private_end + '\n' + hydrate_code)
else:
    print("Warning: Could not find hydratePrivateGeneratedQuestions block")

# 3. Handle the "Generate from Weak Spots" button in AI Notebook
generate_weak_code = '''
async function generateQuestionsFromNotebook() {
  const focuses = buildCoachFocusSuggestions(CoachNotebook.records);
  const openFocuses = focuses.filter(f => f.unresolved > 0);
  if (!openFocuses.length) {
    toast('No open weak spots to generate questions for.');
    return;
  }
  
  const targetFocus = openFocuses[0]; // Take the most pressing weak spot
  toast(`Generating questions to target your weak spot in ${buildFocusTitle(targetFocus)}...`);
  
  const btn = $('btn-coach-generate-weak');
  const origText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }
  
  try {
    const success = await startGeneratedFocusDrill(targetFocus, {
      count: 5,
      creatorRole: 'student',
      createdFrom: 'notebook_auto_weak_spot',
      clearPending: true,
      startSession: false
    });
    if (success) {
      toast('Generated questions added to the library! They will appear with the "Generated" source tag.');
      navSet('nav-setup');
      SHOW('view-setup');
    }
  } catch (err) {
    console.error('Failed to generate weak spot questions:', err);
    toast('Failed to generate questions. Please try again later.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = origText; }
  }
}
'''

app_code += '\n' + generate_weak_code

# 4. Wire up events
events_code = '''
  const btnGenWeak = $('btn-coach-generate-weak');
  if (btnGenWeak) btnGenWeak.addEventListener('click', generateQuestionsFromNotebook);
'''

# Insert after other btn-coach events
coach_events = '''  const btnClearNb = $('btn-coach-clear'); if (btnClearNb) btnClearNb.addEventListener('click', clearCoachNotebook);'''
app_code = app_code.replace(coach_events, coach_events + events_code)

# 5. Call renderSourceChips and hydrateSharedGeneratedQuestions in init()
init_old = '''  renderPresets(); renderLibrarySelectors(); updateFilterRow();'''
init_new = '''  renderPresets(); renderLibrarySelectors(); updateFilterRow(); renderSourceChips();'''
app_code = app_code.replace(init_old, init_new)

hydrate_old = '''  await hydratePrivateGeneratedQuestions(false);'''
hydrate_new = '''  await hydratePrivateGeneratedQuestions(false);
  await hydrateSharedGeneratedQuestions();'''
app_code = app_code.replace(hydrate_old, hydrate_new)

# 6. Update setup rendering for the old filter-src element which is now gone
filter_src_old = '''  const fs = $('filter-src');'''
filter_src_new = '''  const fs = $('filter-src'); // Legacy check'''
app_code = app_code.replace(filter_src_old, filter_src_new)

# Remove the setup options override that resets filter-src drop down, it's chips now
bad_filter_update = '''    if (App.filters.src) {
      try { fs.value = App.filters.src; } catch { }
    }'''
app_code = app_code.replace(bad_filter_update, '/* source is now chips */')

with open('app.js', 'w', encoding='utf-8', newline='') as f:
    f.write(app_code)

print("Success!")
