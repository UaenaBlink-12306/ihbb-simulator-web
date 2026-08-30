'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('teacher dashboard surfaces Supabase read and mutation failures', () => {
  const source = read('teacher.js');
  assert.match(source, /async function loadClasses\(\)[\s\S]*?if \(error\) throw error;/);
  assert.match(source, /async function loadAssignments\(\)[\s\S]*?if \(error\) throw error;/);
  assert.match(source, /const analyticsResponses = \[rosterRes, assignmentRes, profileRes, submissionRes, sessionRes, wrongRes, coachRes\]/);
  assert.match(source, /const analyticsError = analyticsResponses\.find\(result => result\?\.error\)\?\.error;/);
  assert.match(source, /window\.deleteClass[\s\S]*?if \(error\) throw error;/);
  assert.match(source, /window\.deleteAssignment[\s\S]*?if \(error\) throw error;/);
  const tabHelper = source.slice(source.indexOf('function activateDashboardTab'), source.indexOf('function syncDashboardTabGroups'));
  assert.match(tabHelper, /nextTab === 'create'[\s\S]*?options\.builderMode !== 'set'/);
  const menuHelper = source.slice(source.indexOf('function setDashboardMenuOpen'), source.indexOf('function openDashboardMenu'));
  assert.doesNotMatch(menuHelper, /\bnextTab\b|\boptions\.builderMode\b/);
});

test('teacher analytics migration grants only enrolled-student reads', () => {
  const migration = read('migrations/20260830130350_repair_teacher_dashboard_access.sql');
  for (const table of ['user_drill_sessions', 'user_wrong_questions', 'user_coach_attempts']) {
    assert.match(migration, new RegExp(`ON public\\.${table}[\\s\\S]*?FOR SELECT[\\s\\S]*?TO authenticated[\\s\\S]*?is_current_user_student_teacher\\(user_id\\)`, 'i'));
  }
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.is_current_user_student_teacher\(uuid\) FROM PUBLIC, anon;/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.is_current_user_student_teacher\(uuid\) TO authenticated;/i);
  assert.doesNotMatch(migration, /USING\s*\(\s*true\s*\)/i);
});
