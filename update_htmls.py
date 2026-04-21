import os

# 1. Update AGENTS.md
with open('AGENTS.md', 'r', encoding='utf-8') as f:
    agents_text = f.read()

rule_to_add = "- When finishing a task, you must also add an entry to the \"What's New\" page (in student.html and teacher.html) with the date and info of your update, keeping the newest version visible to users.\n"
if rule_to_add not in agents_text:
    agents_text += rule_to_add
    with open('AGENTS.md', 'w', encoding='utf-8') as f:
        f.write(agents_text)


# 2. Update the HTML files
whatsnew_tab = '<button class="dash-tab" data-tab="whatsnew">What\'s New</button>'

whatsnew_section = '''        <section id="tab-whatsnew" class="view">
            <div class="card section-card">
                <div class="section-head">
                    <div>
                        <h2 class="card-title">What's New</h2>
                        <p class="section-subtitle">The latest updates and features added to IHBB Premium Drill.</p>
                    </div>
                </div>
                <div class="dashboard-split dashboard-split-solo">
                    <div class="list-container">
                        <div class="list-item">
                            <div>
                                <h3 style="margin:0 0 4px;">AI Notebook Weak Spot Generation & What's New Page</h3>
                                <div class="pill">April 21, 2026</div>
                                <p class="muted" style="margin: 8px 0 0;">Connected the AI Notebook directly to DeepSeek generation allowing you to automatically generate new practice questions targeting your weakest regions and eras. Added the "What's New" page to track future updates!</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>'''

for file_name in ['student.html', 'teacher.html']:
    with open(file_name, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 2a. Add the tab button if not already there
    if 'data-tab="whatsnew"' not in content:
        target_tab = '<button class="dash-tab" data-tab="account">Account</button>'
        content = content.replace(target_tab, target_tab + '\n            ' + whatsnew_tab)
    
    # 2b. Add the section
    if 'id="tab-whatsnew"' not in content:
        # We need to insert this right before the `</div>` that closes the `shell dashboard-shell`
        # But looking at both files, they end with `    </div>\n\n    <div id="name-modal"` or `teacher-modal`
        if 'student.html' in file_name:
            target_insertion = '</section>\n    </div>\n\n    <div id="name-modal"'
            if target_insertion in content:
                content = content.replace(target_insertion, '</section>\n\n' + whatsnew_section + '\n    </div>\n\n    <div id="name-modal"')
            else:
                # LF instead of CRLF check
                target_insertion2 = '</section>\r\n    </div>\r\n\r\n    <div id="name-modal"'
                content = content.replace(target_insertion2, '</section>\r\n\r\n' + whatsnew_section.replace('\n', '\r\n') + '\r\n    </div>\r\n\r\n    <div id="name-modal"')
        else:
            target_insertion = '</section>\n    </div>\n\n    <div id="teacher-modal"'
            if target_insertion in content:
                content = content.replace(target_insertion, '</section>\n\n' + whatsnew_section + '\n    </div>\n\n    <div id="teacher-modal"')
            else:
                target_insertion2 = '</section>\r\n    </div>\r\n\r\n    <div id="teacher-modal"'
                content = content.replace(target_insertion2, '</section>\r\n\r\n' + whatsnew_section.replace('\n', '\r\n') + '\r\n    </div>\r\n\r\n    <div id="teacher-modal"')

    with open(file_name, 'w', encoding='utf-8', newline='') as f:
        f.write(content)

print("Updates applied.")
