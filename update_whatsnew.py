import re

new_update = '''                        <div class="list-item">
                            <div>
                                <h3 style="margin:0 0 4px;">Account Settings Overhaul</h3>
                                <div class="pill">April 21, 2026</div>
                                <p class="muted" style="margin: 8px 0 0;">The Account page has been redesigned so that saving profile basics (DisplayName, Email, Password) and workspace preferences are decoupled and immediately accessible without excessive scrolling. You can also now update your account password directly from this tab.</p>
                            </div>
                        </div>
'''

for file_name in ['student.html', 'teacher.html']:
    with open(file_name, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # find the What's new list-container
    marker = '<div class="dashboard-split dashboard-split-solo">\n                    <div class="list-container">'
    if marker not in content:
        # maybe CRLF
        marker = '<div class="dashboard-split dashboard-split-solo">\r\n                    <div class="list-container">'
    
    if marker in content:
        # We inject right after the marker
        content = content.replace(marker, marker + '\n' + new_update)
        with open(file_name, 'w', encoding='utf-8', newline='') as f:
            f.write(content)
        print(f"Updated Whats New in {file_name}")

