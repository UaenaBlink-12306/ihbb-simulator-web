document.addEventListener('DOMContentLoaded', () => {
    const tabs = document.querySelectorAll('.tab');
    const form = document.getElementById('auth-form');
    const submitBtn = document.getElementById('submit-btn');
    const classCodeGroup = document.getElementById('class-code-group');
    const classCodeInput = document.getElementById('class-code');
    const passwordGroup = document.getElementById('password-group');
    const passwordInput = document.getElementById('password');
    const forgotPasswordLink = document.getElementById('forgot-password');
    const alertBox = document.getElementById('alert-box');

    let currentMode = 'login'; // 'login', 'signup', 'magic-link', 'reset'

    // Check if Supabase loaded properly
    if (!window.supabase) {
        showAlert('Supabase failed to load. Please check your internet connection or URL/Key configuration.', 'error');
        submitBtn.disabled = true;
    }

    // Tab switching
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const mode = tab.dataset.tab;
            setMode(mode);
        });
    });

    function setMode(mode) {
        currentMode = mode;
        clearAlert();

        if (mode === 'login') {
            submitBtn.textContent = 'Sign In';
            classCodeGroup.classList.add('hidden');
            passwordGroup.classList.remove('hidden');
            passwordInput.required = true;
            document.querySelector('.auth-header h1').textContent = 'Welcome Back';
            document.querySelector('.auth-header p').textContent = 'Sign in to access IHBB Premium Drill';
        } else if (mode === 'signup') {
            submitBtn.textContent = 'Create Account';
            classCodeGroup.classList.remove('hidden');
            passwordGroup.classList.remove('hidden');
            passwordInput.required = true;
            document.querySelector('.auth-header h1').textContent = 'Join Us';
            document.querySelector('.auth-header p').textContent = 'Create an account to start drilling';
        } else if (mode === 'magic-link') {
            submitBtn.textContent = 'Send Magic Link';
            classCodeGroup.classList.add('hidden');
            passwordGroup.classList.add('hidden');
            passwordInput.required = false;
            document.querySelector('.auth-header h1').textContent = 'Passwordless';
            document.querySelector('.auth-header p').textContent = 'We will email you a secure link to log in';
        } else if (mode === 'reset') {
            submitBtn.textContent = 'Send Reset Instructions';
            classCodeGroup.classList.add('hidden');
            passwordGroup.classList.add('hidden');
            passwordInput.required = false;
            document.querySelector('.auth-header h1').textContent = 'Reset Password';
            document.querySelector('.auth-header p').textContent = 'Enter your email to receive a password reset link';
        }
    }

    // Forgot password handler
    forgotPasswordLink.addEventListener('click', (e) => {
        e.preventDefault();
        tabs.forEach(t => t.classList.remove('active')); // Deselect tabs
        setMode('reset');
    });

    // Magic link handler
    document.getElementById('btn-magic-link').addEventListener('click', (e) => {
        e.preventDefault();
        tabs.forEach(t => t.classList.remove('active'));
        setMode('magic-link');
    });

    function showAlert(message, type = 'error') {
        alertBox.textContent = message;
        alertBox.className = `alert ${type}`;
        alertBox.classList.remove('hidden');
    }

    function clearAlert() {
        alertBox.classList.add('hidden');
        alertBox.textContent = '';
    }

    // Form submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearAlert();

        if (!window.supabase) {
            return showAlert('Supabase connection is not defined. Check config.js.');
        }

        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const classCode = classCodeInput.value.trim();

        if (!email) return showAlert('Email is required');
        if (['login', 'signup'].includes(currentMode) && !password) return showAlert('Password is required');

        submitBtn.disabled = true;
        const originalText = submitBtn.textContent;
        submitBtn.textContent = 'Processing...';

        try {
            if (currentMode === 'signup') {
                const { data, error } = await supabase.auth.signUp({
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
                } else if (data.session) {
                    window.location.href = 'index.html'; // Auto-login
                } else {
                    showAlert('Check your email for the verification link!', 'success');
                }
            }
            else if (currentMode === 'login') {
                const { data, error } = await supabase.auth.signInWithPassword({
                    email,
                    password
                });
                if (error) throw error;
                window.location.href = 'index.html';
            }
            else if (currentMode === 'magic-link') {
                const { error } = await supabase.auth.signInWithOtp({
                    email,
                    options: {
                        emailRedirectTo: window.location.origin
                    }
                });
                if (error) throw error;
                showAlert('Check your email for the magic link!', 'success');
            }
            else if (currentMode === 'reset') {
                const { error } = await supabase.auth.resetPasswordForEmail(email, {
                    redirectTo: window.location.origin + '/reset-password.html',
                });
                if (error) throw error;
                showAlert('Password reset instructions sent to your email!', 'success');
            }
        } catch (error) {
            showAlert(error.message || 'An error occurred. Please try again.');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    });

    // SSO Handlers
    document.getElementById('btn-google').addEventListener('click', async () => {
        if (!window.supabase) return;
        const { error } = await supabase.auth.signInWithOAuth({ provider: 'google' });
        if (error) showAlert(error.message);
    });

    document.getElementById('btn-microsoft').addEventListener('click', async () => {
        if (!window.supabase) return;
        const { error } = await supabase.auth.signInWithOAuth({ provider: 'azure' });
        if (error) showAlert(error.message);
    });
});
