document.addEventListener('DOMContentLoaded', async () => {
    const stepRole = document.getElementById('step-role');
    const stepStudent = document.getElementById('step-student');
    const stepTeacher = document.getElementById('step-teacher');

    const roleCards = document.querySelectorAll('.role-card');
    const btnNextRole = document.getElementById('btn-next-role');

    const btnSkipStudent = document.getElementById('btn-skip-student');
    const btnFinishStudent = document.getElementById('btn-finish-student');
    const studentClassCode = document.getElementById('student-class-code');

    const teacherClassName = document.getElementById('teacher-class-name');
    const generatedCodeInput = document.getElementById('generated-code');
    const btnGenerateCode = document.getElementById('btn-generate-code');
    const btnSkipTeacher = document.getElementById('btn-skip-teacher');
    const btnFinishTeacher = document.getElementById('btn-finish-teacher');

    const alertBox = document.getElementById('alert-box');
    const progressRole = document.getElementById('progress-step-role');
    const progressSetup = document.getElementById('progress-step-setup');

    let selectedRole = null;
    let currentUser = null;

    // Check auth status
    if (!window.supabaseClient) {
        return showAlert('Supabase connection failed.');
    }

    const { data: { session } } = await window.supabaseClient.auth.getSession();
    if (!session) {
        window.location.replace('login.html');
        return;
    }

    // Remove auth-guard now that session is verified
    const authGuard = document.getElementById('auth-guard');
    if (authGuard) authGuard.remove();

    currentUser = session.user;

    function showAlert(message, type = 'error') {
        alertBox.textContent = message;
        alertBox.className = `alert ${type}`;
        alertBox.classList.remove('hidden');
    }

    function clearAlert() {
        alertBox.classList.add('hidden');
        alertBox.textContent = '';
    }

    function setWizardStep(step) {
        const isRole = step === 'role';
        if (progressRole) progressRole.classList.toggle('active', isRole);
        if (progressSetup) progressSetup.classList.toggle('active', !isRole);
    }

    // Role Selection
    roleCards.forEach(card => {
        card.addEventListener('click', () => {
            roleCards.forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            selectedRole = card.dataset.role;
            btnNextRole.disabled = false;
        });
    });

    btnNextRole.addEventListener('click', () => {
        if (!selectedRole) return;
        stepRole.classList.add('hidden');
        stepRole.classList.remove('active');
        setWizardStep('setup');

        if (selectedRole === 'student') {
            document.getElementById('onboarding-subtitle').textContent = "Join your Teacher's class";
            stepStudent.classList.remove('hidden');
            stepStudent.classList.add('active');
        } else {
            document.getElementById('onboarding-subtitle').textContent = "Set up your virtual classroom";
            stepTeacher.classList.remove('hidden');
            stepTeacher.classList.add('active');
        }
    });

    // Student Flow
    async function saveStudentProfile(classCode) {
        try {
            // Note: Since we don't have the table created yet in the DB, 
            // this is an optimistic update/insert.
            const { error } = await window.supabaseClient
                .from('profiles')
                .upsert({
                    id: currentUser.id,
                    role: 'student',
                    class_code: classCode
                });

            // Even if it fails (table not created), we let them into the app for now
            // since we are just doing frontend setup.
            window.location.href = 'student.html';
        } catch (err) {
            console.error(err);
            window.location.href = 'student.html';
        }
    }

    btnSkipStudent.addEventListener('click', () => saveStudentProfile(null));
    btnFinishStudent.addEventListener('click', () => {
        const code = studentClassCode.value.trim();
        saveStudentProfile(code || null);
    });

    // Teacher Flow
    btnGenerateCode.addEventListener('click', () => {
        // Generate a random 6-character alphanumeric code
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        generatedCodeInput.value = code;
    });

    async function saveTeacherProfile(className, inviteCode) {
        try {
            await window.supabaseClient
                .from('profiles')
                .upsert({
                    id: currentUser.id,
                    role: 'teacher'
                });

            if (inviteCode) {
                await window.supabaseClient
                    .from('classes')
                    .insert({
                        teacher_id: currentUser.id,
                        name: className || 'My Class',
                        code: inviteCode
                    });
            }
            window.location.href = 'teacher.html';
        } catch (err) {
            console.error(err);
            window.location.href = 'teacher.html';
        }
    }

    btnSkipTeacher.addEventListener('click', () => saveTeacherProfile(null, null));
    btnFinishTeacher.addEventListener('click', () => {
        const cName = teacherClassName.value.trim();
        const code = generatedCodeInput.value.trim();
        if (!code) return showAlert('Please generate an invite code first.');
        saveTeacherProfile(cName, code);
    });

    setWizardStep('role');
});
