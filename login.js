document.addEventListener('DOMContentLoaded', () => {
    const tabs = document.querySelectorAll('.tab');
    const form = document.getElementById('auth-form');
    const submitBtn = document.getElementById('submit-btn');
    const classCodeGroup = document.getElementById('class-code-group');
    const classCodeInput = document.getElementById('class-code');
    const passwordGroup = document.getElementById('password-group');
    const passwordInput = document.getElementById('password');
    const alertBox = document.getElementById('alert-box');
    const authTitle = document.getElementById('auth-title');
    const authSubtitle = document.getElementById('auth-subtitle');
    const authModeNote = document.getElementById('auth-mode-note');

    let currentMode = 'login'; // 'login' | 'signup'

    if (!window.supabaseClient) {
        showAlert('Supabase failed to load. Please check your internet connection or URL/Key configuration.', 'error');
        submitBtn.disabled = true;
    }

    tabs.forEach(tab => {
        tab.addEventListener('click', (event) => {
            event.preventDefault();
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            setMode(tab.dataset.tab);
        });
    });

    function setMode(mode) {
        currentMode = mode === 'signup' ? 'signup' : 'login';
        clearAlert();
        document.body.dataset.authMode = currentMode;

        if (currentMode === 'signup') {
            submitBtn.textContent = 'Create Account';
            classCodeGroup.classList.remove('hidden');
            passwordGroup.classList.remove('hidden');
            passwordInput.required = true;
            if (authTitle) authTitle.textContent = 'Create Your Account';
            if (authSubtitle) authSubtitle.textContent = 'Use email and password to create an account, then finish your role setup on the next screen.';
            if (authModeNote) authModeNote.textContent = 'Password-based signup is the only supported account flow in this build.';
            return;
        }

        submitBtn.textContent = 'Sign In';
        classCodeGroup.classList.add('hidden');
        passwordGroup.classList.remove('hidden');
        passwordInput.required = true;
        if (authTitle) authTitle.textContent = 'Welcome Back';
        if (authSubtitle) authSubtitle.textContent = 'Sign in with your email and password to access drills, assignments, analytics, and live rooms.';
        if (authModeNote) authModeNote.textContent = 'Password-based access is the only supported sign-in flow in this build.';
    }

    function showAlert(message, type = 'error') {
        alertBox.textContent = message;
        alertBox.className = `alert ${type}`;
        alertBox.classList.remove('hidden');
    }

    function clearAlert() {
        alertBox.classList.add('hidden');
        alertBox.textContent = '';
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearAlert();

        if (!window.supabaseClient) {
            return showAlert('Supabase connection is not defined. Check config.js.');
        }

        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const classCode = classCodeInput.value.trim();

        if (!email) return showAlert('Email is required');
        if (!password) return showAlert('Password is required');

        submitBtn.disabled = true;
        const originalText = submitBtn.textContent;
        submitBtn.textContent = 'Processing...';

        try {
            if (currentMode === 'signup') {
                const { data, error } = await window.supabaseClient.auth.signUp({
                    email,
                    password,
                    options: {
                        data: { class_code: classCode },
                        emailRedirectTo: window.location.origin
                    }
                });

                if (error) throw error;
                if (data.user && data.user.identities && data.user.identities.length === 0) {
                    showAlert('Email already taken. Please sign in.', 'error');
                } else {
                    window.location.href = 'index.html';
                }
            } else {
                const { error } = await window.supabaseClient.auth.signInWithPassword({
                    email,
                    password
                });
                if (error) throw error;
                window.location.href = 'index.html';
            }
        } catch (error) {
            showAlert(error.message || 'An error occurred. Please try again.');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    });

    setMode('login');
});
