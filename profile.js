document.addEventListener('DOMContentLoaded', async () => {
    const sb = window.supabaseClient;
    const guard = document.getElementById('auth-guard');
    const alertBox = document.getElementById('alert-box');

    const showAlert = (msg, type = 'error') => {
        if (!alertBox) return;
        alertBox.textContent = msg;
        alertBox.className = `alert ${type}`;
        alertBox.classList.remove('hidden');
    };
    const setValue = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value ?? '';
    };
    const formatRole = (role) => {
        const s = String(role || '').trim().toLowerCase();
        if (!s) return 'Unknown';
        return s.charAt(0).toUpperCase() + s.slice(1);
    };

    if (!sb) {
        if (guard) guard.remove();
        showAlert('Supabase is not available.', 'error');
        return;
    }

    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
        window.location.replace('login.html');
        return;
    }
    const viewerId = session.user.id;

    const { data: viewerProfile, error: viewerErr } = await sb
        .from('profiles')
        .select('id, role, display_name')
        .eq('id', viewerId)
        .single();

    if (viewerErr || !viewerProfile || !viewerProfile.role) {
        window.location.replace('onboarding.html');
        return;
    }

    const backHref = viewerProfile.role === 'teacher' ? 'teacher.html' : 'student.html';
    const backBtn = document.getElementById('btn-back-dashboard');
    if (backBtn) backBtn.href = backHref;

    document.getElementById('btn-logout')?.addEventListener('click', async (e) => {
        e.preventDefault();
        await sb.auth.signOut();
        window.location.replace('login.html');
    });

    const params = new URLSearchParams(window.location.search);
    const requestedId = params.get('user');
    let targetId = requestedId || viewerId;

    if (targetId !== viewerId && viewerProfile.role !== 'teacher') {
        targetId = viewerId;
        showAlert('You can only view your own profile.', 'error');
    }

    const { data: targetProfile, error: targetErr } = await sb
        .from('profiles')
        .select('id, role, display_name, class_code, created_at')
        .eq('id', targetId)
        .single();

    if (targetErr || !targetProfile) {
        if (guard) guard.remove();
        showAlert('Profile not found or you do not have access to view it.', 'error');
        return;
    }

    const isOwnProfile = targetProfile.id === viewerId;
    const heading = document.getElementById('profile-heading');
    const title = document.getElementById('profile-title');
    const subtitle = document.getElementById('profile-subtitle');

    if (isOwnProfile) {
        if (heading) heading.textContent = 'My Profile';
        if (title) title.textContent = 'My Profile';
        if (subtitle) subtitle.textContent = 'Basic profile info. Additional student data can be added later.';
    } else {
        const name = targetProfile.display_name || 'Student';
        if (heading) heading.textContent = `${name}'s Profile`;
        if (title) title.textContent = `${name}'s Profile`;
        if (subtitle) subtitle.textContent = 'Teacher view of this student profile.';
    }

    setValue('pf-display-name', targetProfile.display_name || 'Unnamed');
    setValue('pf-role', formatRole(targetProfile.role));
    setValue('pf-class-code', targetProfile.class_code || '—');
    setValue('pf-created-at', targetProfile.created_at ? new Date(targetProfile.created_at).toLocaleString() : '—');
    setValue('pf-user-id', targetProfile.id || '—');

    if (guard) guard.remove();
});
