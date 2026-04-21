import re
import os

# 1. Update JS files to handle password updates and handle multiple save buttons
def fix_js(filename):
    with open(filename, 'r', encoding='utf-8') as f:
        content = f.read()

    # Find the save button click listener, currently `saveAccountBtn?.addEventListener('click', async () => {`
    # We will change it to bind to multiple buttons if they exist
    patch_js = '''
    const saveAccountBtns = document.querySelectorAll('.btn-save-account-action');
    const existingSaveBtn = document.getElementById('btn-save-account');
    const allSaveBtns = Array.from(saveAccountBtns);
    if (existingSaveBtn && !allSaveBtns.includes(existingSaveBtn)) allSaveBtns.push(existingSaveBtn);

    allSaveBtns.forEach(btn => btn?.addEventListener('click', async () => {
        const saveAccountBtn = btn;
        const nameInput = document.getElementById('acc-display-name');
        const emailInput = document.getElementById('acc-email');
        const passInput = document.getElementById('acc-password');
        if (!nameInput || !emailInput) return;

        const nextName = String(nameInput.value || '').trim();
        const nextEmail = normalizeEmail(emailInput.value);
        const nextPassword = passInput ? passInput.value : '';
        if (!nextName) {
            showAlert('Display name cannot be empty.', 'error');
            nameInput.focus();
            return;
        }
        if (!nextEmail || !isValidEmail(nextEmail)) {
            showAlert('Please enter a valid email address.', 'error');
            emailInput.focus();
            return;
        }

        const prevName = String(profile.display_name || '').trim();
        const prevEmail = normalizeEmail(userEmail);
        const prevAvatarId = normalizeAvatarId(profile.avatar_id);
        const nextAvatarId = normalizeAvatarId(selectedAvatarId);
        const nextAccountSettings = readAccountSettingsFromForm();
        const hasPersistedAccountSettings = !!profile.account_settings && typeof profile.account_settings === 'object' && !Array.isArray(profile.account_settings);
        const prevAccountSettings = normalizeAccountSettings(profile.account_settings);
        const changeName = nextName !== prevName;
        const changeEmail = nextEmail !== prevEmail;
        const changePass = !!nextPassword;
        const changeAvatar = nextAvatarId !== prevAvatarId;
        const changeSettings = !hasPersistedAccountSettings || JSON.stringify(nextAccountSettings) !== JSON.stringify(prevAccountSettings);
        
        if (!changeName && !changeEmail && !changeAvatar && !changeSettings && !changePass) {
            showAlert('No profile changes to save.', 'success');
            return;
        }

        const originalTexts = allSaveBtns.map(b => b.textContent);
        allSaveBtns.forEach(b => { b.disabled = true; b.textContent = 'Saving...'; });

        try {
            const successMsgs = [];
            const errorMsgs = [];

            if (changeName || changeAvatar || changeSettings) {
                const profilePatch = {};
                if (changeName) profilePatch.display_name = nextName;
                if (changeAvatar) profilePatch.avatar_id = nextAvatarId;
                if (changeSettings) profilePatch.account_settings = nextAccountSettings;
                const { error } = await sb.from('profiles').update(profilePatch).eq('id', uid);
                if (error) {
                    errorMsgs.push(`Profile update failed: ${error.message}`);
                } else {
                    if (changeName) {
                        profile.display_name = nextName;
                        successMsgs.push('Display name updated');
                    }
                    if (changeAvatar) {
                        profile.avatar_id = nextAvatarId;
                        successMsgs.push('Avatar updated');
                    }
                    if (changeSettings) {
                        accountSettings = normalizeAccountSettings(nextAccountSettings);
                        profile.account_settings = { ...accountSettings };
                        successMsgs.push('Workspace defaults saved');
                    }
                }
            }

            if (changeEmail || changePass) {
                const authPatch = {};
                if (changeEmail) authPatch.email = nextEmail;
                if (changePass) authPatch.password = nextPassword;
                const { data, error } = await sb.auth.updateUser(authPatch);
                if (error) {
                    errorMsgs.push(`Auth update failed: ${error.message}`);
                } else {
                    if (changeEmail) {
                        userEmail = String(data?.user?.email || data?.user?.new_email || nextEmail).trim();
                        successMsgs.push('Email change saved (check inbox to verify)');
                    }
                    if (changePass) {
                        successMsgs.push('Password updated securely');
                        if (passInput) passInput.value = '';
                    }
                }
            }

            if (!changeSettings) {
                accountSettings = nextAccountSettings;
            }
            renderAccountProfile(changeSettings);
            if (successMsgs.length && !errorMsgs.length) {
                showAlert(`${successMsgs.join('. ')}.`, 'success');
            } else if (successMsgs.length && errorMsgs.length) {
                showAlert(`${successMsgs.join('. ')}. ${errorMsgs.join(' ')}`, 'error');
            } else if (errorMsgs.length) {
                showAlert(errorMsgs.join(' '), 'error');
            }
        } catch (err) {
            showAlert(`Failed to save account changes: ${err?.message || err}`, 'error');
        } finally {
            allSaveBtns.forEach((b, i) => { b.disabled = false; b.textContent = originalTexts[i]; });
        }
    }));
'''
    # We replace the old listener
    # Search for: `saveAccountBtn?.addEventListener('click', async () => {` ... up to `});` just before confirmDeleteReveal
    start_str = "saveAccountBtn?.addEventListener('click', async () => {"
    end_str = "revealDeleteBtn?.addEventListener('click', () => {"
    
    if start_str in content and end_str in content:
        head = content[:content.find(start_str)]
        tail = content[content.find(end_str):]
        # remove the old `const saveAccountBtn = ...`
        head = re.sub(r"const saveAccountBtn = document.getElementById\('btn-save-account'\);\s*", "", head)
        content = head + patch_js + "\n    " + tail
        with open(filename, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Updated JS in {filename}")

fix_js('student.js')
fix_js('teacher.js')


def fix_html(filename):
    with open(filename, 'r', encoding='utf-8') as f:
        content = f.read()

    # The layout is:
    # <h3 style="margin: 0 0 12px;">My Profile</h3>
    # <div class="form-grid">
    # ...
    # We want to insert the save button next to the title, and add password field.
    
    # 1. Change title to include a secondary save button
    profile_title = '<h3 style="margin: 0 0 12px;">My Profile</h3>'
    if profile_title in content:
        new_title = '''<div class="section-head" style="margin-bottom: 20px;">
                            <h3 style="margin: 0;">My Profile</h3>
                            <button class="btn pri btn-save-account-action">Save Basic Info</button>
                        </div>'''
        content = content.replace(profile_title, new_title)

    # 2. Add New Password field after Email
    email_block = '''<div class="input-group">
                                <label>Email</label>
                                <input id="acc-email" type="email" maxlength="160" placeholder="name@example.com">
                            </div>'''
    password_block = '''<div class="input-group">
                                <label>New Password</label>
                                <input id="acc-password" type="password" maxlength="128" placeholder="Leave blank to keep current">
                            </div>'''
    if email_block in content and 'acc-password' not in content:
        content = content.replace(email_block, email_block + "\n                            " + password_block)

    # 3. Readonly visual cues
    role_block = '<input id="acc-role" type="text" readonly>'
    if role_block in content:
        content = content.replace(role_block, '<input id="acc-role" type="text" readonly title="Role cannot be changed">')

    class_code_block = '<input id="acc-class-code" type="text" readonly>'
    if class_code_block in content:
        content = content.replace(class_code_block, '<input id="acc-class-code" type="text" readonly title="Generated by teacher">')

    # 4. Add "Save Preferences" button for Workspace defaults to eliminate scrolling
    if 'student.html' in filename:
        settings_label = '<label>Student workspace defaults</label>'
        if settings_label in content:
            new_settings = '<div class="section-head" style="margin-bottom:12px;"><h4 style="margin:0;">Student workspace defaults</h4><button class="btn ghost btn-save-account-action">Save Preferences</button></div>'
            content = content.replace(settings_label, new_settings)
    else:
        settings_label = '<label>Teacher workspace defaults</label>'
        if settings_label in content:
            new_settings = '<div class="section-head" style="margin-bottom:12px;"><h4 style="margin:0;">Teacher workspace defaults</h4><button class="btn ghost btn-save-account-action">Save Preferences</button></div>'
            content = content.replace(settings_label, new_settings)


    with open(filename, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"Updated HTML in {filename}")

fix_html('student.html')
fix_html('teacher.html')

