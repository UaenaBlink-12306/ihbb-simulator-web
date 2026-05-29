document.addEventListener('DOMContentLoaded', () => {
    const tabs = document.querySelectorAll('.tab');
    const form = document.getElementById('auth-form');
    const submitBtn = document.getElementById('submit-btn');
    const passwordGroup = document.getElementById('password-group');
    const passwordInput = document.getElementById('password');
    const alertBox = document.getElementById('alert-box');
    const authTitle = document.getElementById('auth-title');
    const authSubtitle = document.getElementById('auth-subtitle');
    const authModeNote = document.getElementById('auth-mode-note');
    const passwordHelp = document.getElementById('password-help');

    let currentMode = 'login'; // 'login' | 'signup'

    if (!window.supabaseClient) {
        showAlert('Supabase failed to load. Please check your internet connection or URL/Key configuration.', 'error');
        submitBtn.disabled = true;
    }

    tabs.forEach(tab => {
        tab.addEventListener('click', (event) => {
            event.preventDefault();
            setMode(tab.dataset.tab);
        });
    });

    function syncTabs() {
        tabs.forEach(tab => {
            const isActive = tab.dataset.tab === currentMode;
            tab.classList.toggle('active', isActive);
            tab.setAttribute('aria-selected', String(isActive));
        });
    }

    function setMode(mode) {
        currentMode = mode === 'signup' ? 'signup' : 'login';
        clearAlert();
        document.body.dataset.authMode = currentMode;
        syncTabs();

        if (currentMode === 'signup') {
            submitBtn.textContent = 'Create Account';
            passwordGroup.classList.remove('hidden');
            passwordInput.required = true;
            passwordInput.setAttribute('autocomplete', 'new-password');
            passwordInput.setAttribute('minlength', '6');
            passwordInput.placeholder = 'Create a password';
            if (passwordHelp) passwordHelp.classList.remove('hidden');
            if (authTitle) authTitle.textContent = 'Create Your Account';
            if (authSubtitle) authSubtitle.textContent = 'Use email and password to create an account, then finish your role setup on the next screen.';
            if (authModeNote) authModeNote.textContent = 'New accounts use password-based access only in this build.';
            return;
        }

        submitBtn.textContent = 'Sign In';
        passwordGroup.classList.remove('hidden');
        passwordInput.required = true;
        passwordInput.setAttribute('autocomplete', 'current-password');
        passwordInput.removeAttribute('minlength');
        passwordInput.placeholder = 'Enter your password';
        if (passwordHelp) passwordHelp.classList.add('hidden');
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

    const recoveredSessionNotice = typeof window.readIhbbAuthRecoveryNotice === 'function'
        ? window.readIhbbAuthRecoveryNotice()
        : '';
    if (recoveredSessionNotice) {
        showAlert(recoveredSessionNotice, 'error');
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearAlert();

        if (!window.supabaseClient) {
            return showAlert('Supabase connection is not defined. Check config.js.');
        }

        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;

        if (!email) return showAlert('Email is required');
        if (!password) return showAlert('Password is required');
        if (currentMode === 'signup' && password.length < 6) {
            return showAlert('Use at least 6 characters for your new password.');
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Processing...';

        try {
            if (currentMode === 'signup') {
                const { data, error } = await window.supabaseClient.auth.signUp({
                    email,
                    password
                });

                if (error) throw error;
                if (data.user && data.user.identities && data.user.identities.length === 0) {
                    showAlert('Email already taken. Please sign in.', 'error');
                } else if (data.session) {
                    window.location.href = 'index.html';
                } else {
                    setMode('login');
                    document.getElementById('email').value = email;
                    passwordInput.value = '';
                    showAlert('Account created. Please sign in here once your account is ready.', 'success');
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
            submitBtn.textContent = currentMode === 'signup' ? 'Create Account' : 'Sign In';
        }
    });

    setMode('login');
});
