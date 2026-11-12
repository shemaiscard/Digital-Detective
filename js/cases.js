'use strict';
// The eight cases. Each build() creates a fresh world; the evidence is seeded, so it is the same for everyone.
(function (DD) {
    const HOME = '/home/detective';
    const p2 = n => String(n).padStart(2, '0');
    const hms = s => `${p2(Math.floor(s / 3600) % 24)}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}`;
    const pick = (r, list) => list[Math.floor(r() * list.length)];
    const norm = s => String(s).trim().toLowerCase().replace(/^["'`]+|["'`]+$/g, '').replace(/\s+/g, ' ');
    const prefixOf = full => a => { a = norm(a); return a.length >= 7 && full.startsWith(a); };

    // Objective test: some stage ran `name` and its arguments contain every needle.
    function uses(name, ...needles) {
        return rec => rec.stages.some(s => s.argv[0] === name && !s.failed && (s.code === 0 || (name !== 'git' && s.code === 1)) &&
            needles.every(n => (n instanceof RegExp ? s.argv.slice(1).some(a => n.test(a)) : s.argv.includes(n))));
    }
    const piped = rec => rec.stages.length >= 2 && rec.code === 0;

    function base(vfs, cwd) {
        vfs.mkdirp(HOME);
        vfs.write('/etc/hostname', { content: 'nightjar\n', owner: 'root' });
        vfs.write('/etc/motd', { content: 'Nightjar Forensics Lab. Authorized staff only.\n', owner: 'root' });
        vfs.mkdirp('/tmp', 'root');
        return cwd || HOME;
    }

    const CASES = [];

    // ---------------------------------------------------------------- 1
    CASES.push({
        id: 'orientation', track: 'Shell', title: 'Orientation', level: 'Easy',
        brief: 'First night at the Nightjar Forensics Lab. Your mentor, Inspector Vale, left you a note and locked the lab access code in a drawer. Find out where you are, look around, and open the drawer.',
        learned: ['pwd prints where you are', 'ls lists a folder, ls -a also shows hidden files that start with a dot', 'cd moves between folders, cd .. goes up one level', 'cat prints a file'],
        build(vfs) {
            base(vfs);
            vfs.write(HOME + '/README.txt', 'Welcome to the lab terminal.\n\nEverything here is typed. Try these, one at a time:\n  pwd        where am I?\n  ls         what is in this folder?\n  cd inbox   go into the inbox folder\n  cat FILE   print a file\n\nYour mentor left you a message in the inbox.\n');
            vfs.write(HOME + '/inbox/welcome.txt', 'From: Inspector Vale\nTo: New detective\n\nWelcome aboard. The lab access code is in my desk drawer.\nThe drawer is hidden. Hidden files and folders start with a dot,\nand plain ls does not show them. Try ls -a in my desk folder.\n\nGo up one level with cd .. and then into desk.\n\n- V.\n');
            vfs.write(HOME + '/inbox/spam.txt', 'CONGRATULATIONS! You have won a free cruise. Reply with your password.\n(Never do this.)\n');
            vfs.write(HOME + '/desk/todo.txt', 'TODO\n- order more evidence bags\n- renew the server certificate\n- show the new detective around\n');
            vfs.write(HOME + '/desk/mug.txt', 'A mug that says WORLD\'S OKAYEST INSPECTOR.\n');
            vfs.write(HOME + '/desk/.drawer/code.txt', 'Lab access code: OWL-4471\nDo not write this on a sticky note.\n');
            return { cwd: HOME, facts: {} };
        },
        questions: [
            { q: 'What is the full path of your home folder?', answers: ['/home/detective'], hints: ['Type pwd right after the case starts. It prints the folder you are in.', 'You start in your home folder, so pwd shows its path.', 'The answer starts with /home/'] },
            { q: 'What is the lab access code in the hidden drawer?', answers: ['owl-4471'], hints: ['Read the note: cd inbox, then cat welcome.txt.', 'Go back up with cd .. and then cd desk. Run ls -a to see hidden items.', 'cat .drawer/code.txt from inside the desk folder.'] }
        ],
        objectives: [
            { text: 'Print where you are with pwd', test: uses('pwd') },
            { text: 'List a folder with ls', test: uses('ls') },
            { text: 'Enter a folder with cd', test: uses('cd') },
            { text: 'Read a file with cat', test: uses('cat') },
            { text: 'Reveal hidden files with ls -a', test: rec => uses('ls', /^-\w*a/)(rec) }
        ],
        cheats: [['pwd', 'where am I?'], ['ls', 'list this folder'], ['cd inbox', 'go into a folder'], ['cat welcome.txt', 'print a file'], ['cd ..', 'go up one level'], ['ls -a', 'include hidden files'], ['tree', 'draw the folders']]
    });

    // ---------------------------------------------------------------- 2
    CASES.push({
        id: 'haystack', track: 'Shell', title: 'The Haystack', level: 'Easy',
        brief: 'A server dumped 200 lines of logs into ~/dump/clues.txt. Somewhere in there an engineer pasted the vault password by mistake. Reading 200 lines by eye is slow. Search instead.',
        learned: ['grep prints only the lines that match', 'grep -n adds line numbers, grep -i ignores case, grep -c counts', 'A pipe | sends one command\'s output into the next, for example grep ERROR clues.txt | wc -l'],
        build(vfs) {
            base(vfs);
            const r = DD.rng(2025);
            const mods = ['api', 'db', 'cache', 'mailer', 'scheduler', 'auth'];
            const msgs = {
                INFO: ['request served in 41 ms', 'user session refreshed', 'nightly job queued', 'cache warmed with 1200 keys', 'connection pool resized to 16', 'health check ok', 'config reloaded', 'report exported to /srv/reports'],
                DEBUG: ['payload size 2048 bytes', 'retry counter reset', 'lock acquired on table orders', 'parsed 14 headers', 'token expires in 3600 s'],
                WARN: ['slow query took 1.8 s', 'disk usage at 81 percent', 'deprecated endpoint called', 'certificate expires in 12 days'],
                ERROR: ['upstream timed out after 30 s', 'could not reach smtp relay', 'deadlock detected, transaction rolled back', 'job failed with exit code 2', 'checksum mismatch on chunk 7']
            };
            const lines = [];
            let t = 9 * 3600;
            for (let i = 0; i < 200; i++) {
                t += 7 + Math.floor(r() * 90);
                const x = r();
                const lvl = x < 0.58 ? 'INFO' : x < 0.78 ? 'DEBUG' : x < 0.91 ? 'WARN' : 'ERROR';
                lines.push(`[2025-03-13 ${hms(t)}] ${lvl.padEnd(5)} ${pick(r, mods)}: ${pick(r, msgs[lvl])}`);
            }
            const stampOf = i => lines[i].slice(0, 21);
            lines[41] = `${stampOf(41)} INFO  SYSTEM_LOG: The secret vault password is 'crimson_apple_77'`;
            lines[86] = `${stampOf(86)} INFO  mailer: on-call phone updated to +1 404 555 0187`;
            lines[119] = `${stampOf(119)} INFO  auth: Password policy updated: minimum length 12`;
            lines[155] = `${stampOf(155)} DEBUG scheduler: note to self, the code word is PHANTOM`;
            const errors = lines.filter(l => l.includes('ERROR')).length;
            vfs.write(HOME + '/dump/clues.txt', { content: lines.join('\n') + '\n', mtime: '2025-03-13 18:02' });
            vfs.write(HOME + '/dump/README.txt', 'clues.txt has 200 lines. Do not scroll through it.\n\n  grep WORD FILE      print the lines that contain WORD\n  grep -n WORD FILE   the same, with line numbers\n  head -n 5 FILE      the first 5 lines\n  wc -l FILE          count the lines\n');
            return { cwd: HOME, facts: { errors } };
        },
        questions: [
            { q: 'What is the vault password?', answers: ['crimson_apple_77'], hints: ['cd dump, then search the file instead of reading it: grep WORD clues.txt', 'Search for the word password: grep password clues.txt', 'The password is the text between the quotes on that line.'] },
            { q: 'On which line number of clues.txt is the password?', answers: ['42'], hints: ['grep can print line numbers too. Check man grep.', 'grep -n password clues.txt', 'The number before the colon is the line number.'] },
            { q: 'How many lines in clues.txt are tagged ERROR?', check: (a, f) => norm(a) === String(f.errors), hints: ['grep ERROR clues.txt prints them. Counting by hand is slow.', 'grep -c ERROR clues.txt prints the count. So does grep ERROR clues.txt | wc -l', 'Search for ERROR in capitals: grep is case-sensitive unless you add -i.'] }
        ],
        objectives: [
            { text: 'Search a file with grep', test: uses('grep') },
            { text: 'Show line numbers with grep -n', test: uses('grep', /^-\w*n/) },
            { text: 'Count lines with wc -l or grep -c', test: rec => uses('wc', /^-\w*l/)(rec) || uses('grep', /^-\w*c/)(rec) },
            { text: 'Connect two commands with a pipe |', test: piped }
        ],
        cheats: [['cd dump', 'go to the dump'], ['head -n 5 clues.txt', 'peek at the start'], ['grep password clues.txt', 'lines that match'], ['grep -n password clues.txt', 'with line numbers'], ['grep -i password clues.txt', 'ignore upper/lower case'], ['grep ERROR clues.txt | wc -l', 'count matches with a pipe'], ['man grep', 'every grep option']]
    });

    // ---------------------------------------------------------------- 3
    CASES.push({
        id: 'nightshift', track: 'Shell', title: 'Night Shift', level: 'Medium',
        brief: 'Overnight, someone hammered the lab server with password guesses, and one of them got in. The SSH log is in ~/logs/auth.log. Find the attacking address, measure the attack, and name the account it broke into.',
        learned: ['cut -d \' \' -f 11 picks one column from each line', 'sort | uniq -c | sort -rn counts how often each value appears, most frequent first', 'Chaining grep twice narrows results: grep Accepted auth.log | grep 203.0.113.77', 'head -n N keeps the first N lines of output'],
        build(vfs) {
            base(vfs);
            const r = DD.rng(314);
            const ev = [];
            const users = ['root', 'admin', 'oracle', 'test', 'ubuntu', 'postgres', 'pi', 'svc_backup', 'deploy'];
            const port = () => 30000 + Math.floor(r() * 35000);
            let pid = 4100;
            const attack = (ip, n, from, to) => {
                for (let i = 0; i < n; i++) {
                    const t = Math.floor(from + (to - from) * (i / n) + r() * ((to - from) / n));
                    ev.push([t, `sshd[${pid + Math.floor(i / 6)}]: Failed password for ${pick(r, users)} from ${ip} port ${port()} ssh2`]);
                    if (i % 6 === 5) ev.push([t + 1, `sshd[${pid + Math.floor(i / 6)}]: Disconnected from authenticating user root ${ip} port ${port()} [preauth]`]);
                }
                pid += Math.ceil(n / 6) + 7;
            };
            attack('203.0.113.77', 214, 1 * 3600 + 12 * 60, 3 * 3600 + 46 * 60);
            attack('198.51.100.23', 41, 0 * 3600 + 35 * 60, 2 * 3600 + 5 * 60);
            attack('192.0.2.150', 37, 2 * 3600 + 20 * 60, 4 * 3600 + 40 * 60);
            attack('203.0.113.9', 12, 4 * 3600 + 50 * 60, 5 * 3600 + 10 * 60);
            attack('10.0.4.17', 3, 0 * 3600 + 41 * 60, 0 * 3600 + 44 * 60);
            for (let t = 30 * 60 + 1; t < 5 * 3600 + 30 * 60; t += 600) ev.push([t, `CRON[${pid++}]: pam_unix(cron:session): session opened for user root by (uid=0)`]);
            ev.push([0 * 3600 + 44 * 60 + 30, `sshd[3907]: Accepted publickey for detective from 10.0.4.17 port 50211 ssh2`]);
            const breach = 3 * 3600 + 47 * 60 + 12;
            ev.push([breach, `sshd[6650]: Accepted password for svc_backup from 203.0.113.77 port 51877 ssh2`]);
            ev.push([breach + 1, `sshd[6650]: pam_unix(sshd:session): session opened for user svc_backup by (uid=0)`]);
            ev.push([breach + 1210, `sshd[6650]: Received disconnect from 203.0.113.77 port 51877:11: disconnected by user`]);
            ev.sort((a, b) => a[0] - b[0]);
            const text = ev.map(([t, m]) => `Mar 14 ${hms(t)} nightjar ${m}`).join('\n') + '\n';
            vfs.write(HOME + '/logs/auth.log', { content: text, mtime: '2025-03-14 06:00' });
            vfs.write(HOME + '/logs/NOTES.txt', 'Every failed guess looks like this:\n\nMar 14 01:12:09 nightjar sshd[4100]: Failed password for root from 203.0.113.77 port 40213 ssh2\n\nSplit on spaces, the address is word number 11.\nA successful login says Accepted instead of Failed.\n');
            return { cwd: HOME, facts: {} };
        },
        questions: [
            { q: 'Which IP address made the most failed password attempts?', answers: ['203.0.113.77'], hints: ['Start with only the failures: grep Failed auth.log | head', 'Cut out the address column and count each one: grep Failed auth.log | cut -d \' \' -f 11 | sort | uniq -c', 'Add | sort -rn | head -n 3 to put the biggest count first.'] },
            { q: 'How many failed attempts came from that address?', answers: ['214'], hints: ['The uniq -c output from the last question already shows it.', 'Or chain two greps: grep Failed auth.log | grep 203.0.113.77 | wc -l', 'Count only Failed lines. The address also appears on Disconnected and Accepted lines.'] },
            { q: 'Which account did the attacker log in to?', answers: ['svc_backup'], hints: ['A successful login is logged with the word Accepted.', 'grep Accepted auth.log', 'One Accepted line is the detective logging in from inside the lab. The other comes from the attacker.'] },
            { q: 'At what time did the attacker get in? (HH:MM:SS)', answers: ['03:47:12', '3:47:12'], hints: ['The time is the third word of the Accepted line.', 'grep Accepted auth.log | grep 203.0.113.77', 'Format it as HH:MM:SS.'] }
        ],
        objectives: [
            { text: 'Pick a column with cut', test: uses('cut') },
            { text: 'Sort lines with sort', test: uses('sort') },
            { text: 'Count repeats with uniq -c', test: uses('uniq', /^-\w*c/) },
            { text: 'Build a pipeline of four or more commands', test: rec => rec.stages.length >= 4 && rec.code === 0 }
        ],
        cheats: [['cd logs', 'go to the logs'], ['wc -l auth.log', 'how big is it?'], ['grep Failed auth.log | head', 'first failures'], ["grep Failed auth.log | cut -d ' ' -f 11 | sort | uniq -c | sort -rn | head", 'top attackers'], ['grep Accepted auth.log', 'successful logins'], ['man cut', 'columns']]
    });

    // ---------------------------------------------------------------- 4
    CASES.push({
        id: 'custody', track: 'Shell', title: 'Chain of Custody', level: 'Medium',
        brief: 'The evidence folder for the Records Room break-in came with a manifest of SHA-256 fingerprints, taken when the files were collected. Someone has touched the evidence since. Prove which file changed, show what changed, and look at the photo nobody could open.',
        learned: ['sha256sum -c checks files against a list of fingerprints', 'diff old new prints only the lines that differ', 'ls -l shows when each file was last modified', 'file tells you what a file really contains, whatever its name says', 'base64 -d decodes base64 text'],
        build(vfs) {
            base(vfs);
            const r = DD.rng(77);
            const accts = ['ACC-1180', 'ACC-2045', 'ACC-3310', 'ACC-4402', 'ACC-5127'];
            const memos = ['Vendor payment', 'Payroll', 'Office supplies', 'Lab equipment', 'Cloud hosting', 'Refund'];
            const rows = ['date,account,amount,memo'];
            for (let d = 1, i = 0; i < 23; i++) {
                if (r() < 0.6) d++;
                rows.push(`2025-03-${p2(Math.min(d, 13))},${pick(r, accts)},${(Math.floor(r() * 900) * 10 + 100).toFixed(2)},${pick(r, memos)}`);
            }
            rows.splice(19, 0, '2025-03-11,ACC-1180,4200.00,Vendor payment');
            const original = rows.join('\n') + '\n';
            const tampered = original.replace('2025-03-11,ACC-1180,4200.00,Vendor payment', '2025-03-11,ACC-7731,42000.00,Vendor payment');
            const staff = [['B-1043', 'Dana Reyes'], ['B-1177', 'Lee Huang'], ['B-1820', 'Sam Ortiz'], ['B-2291', 'Quinn Ash'], ['B-0007', 'Inspector Vale']];
            const doors = ['Main Entrance', 'Lab 2', 'Server Room', 'Records Room', 'Loading Dock'];
            const badge = ['time,badge,name,door,result'];
            let t = 7 * 3600;
            for (let i = 0; i < 34; i++) {
                t += 600 + Math.floor(r() * 1500);
                const [b, n] = pick(r, staff.slice(0, 3).concat([staff[4]]));
                badge.push(`2025-03-13 ${hms(t)},${b},${n},${pick(r, doors.filter(x => x !== 'Records Room'))},${r() < 0.9 ? 'GRANTED' : 'DENIED'}`);
            }
            badge.push('2025-03-13 18:12:44,B-1043,Dana Reyes,Records Room,GRANTED');
            badge.push('2025-03-14 02:44:31,B-2291,Quinn Ash,Main Entrance,GRANTED');
            badge.push('2025-03-14 02:47:09,B-2291,Quinn Ash,Records Room,GRANTED');
            badge.push('2025-03-14 03:05:52,B-2291,Quinn Ash,Main Entrance,GRANTED');
            badge.push('2025-03-14 07:58:03,B-0007,Inspector Vale,Main Entrance,GRANTED');
            const memo = 'Case NJ-0314, evidence notes (Inspector Vale)\n\n- Collected 2025-03-13 18:20. Fingerprints in MANIFEST.sha256.\n- A clean copy of the ledger is in ~/backup.\n- IMG_0412.jpg came from a phone found near the Records Room.\n  Nobody can open it. The tech thinks the extension lies.\n';
            const secret = btoa('Meet me at Pier 9, 23:00 Friday. Bring the drive. -Q\n');
            const img = secret.replace(/(.{60})/g, '$1\n') + '\n';
            const files = { 'badge_log.csv': badge.join('\n') + '\n', 'ledger.csv': original, 'memo.txt': memo, 'IMG_0412.jpg': img };
            const manifest = Object.keys(files).sort().map(n => `${DD.sha256(files[n])}  ${n}`).join('\n') + '\n';
            const E = HOME + '/evidence/';
            vfs.write(E + 'MANIFEST.sha256', { content: manifest, mtime: '2025-03-13 18:20' });
            vfs.write(E + 'badge_log.csv', { content: files['badge_log.csv'], mtime: '2025-03-13 18:20' });
            vfs.write(E + 'memo.txt', { content: memo, mtime: '2025-03-13 18:20' });
            vfs.write(E + 'IMG_0412.jpg', { content: img, mtime: '2025-03-13 18:20' });
            vfs.write(E + 'ledger.csv', { content: tampered, mtime: '2025-03-14 02:51' });
            vfs.write(HOME + '/backup/ledger.csv', { content: original, mtime: '2025-03-13 18:20', mode: '-r--r--r--' });
            return { cwd: HOME, facts: {} };
        },
        questions: [
            { q: 'Which evidence file no longer matches its fingerprint?', answers: ['ledger.csv', 'evidence/ledger.csv'], hints: ['cd evidence and look at MANIFEST.sha256 with cat.', 'sha256sum -c MANIFEST.sha256 checks every file in the list.', 'The file marked FAILED was changed after collection.'] },
            { q: 'Which account number appears in the altered row?', answers: ['acc-7731'], hints: ['There is a clean copy in ~/backup. Compare the two.', 'diff ~/backup/ledger.csv ledger.csv', 'Lines starting with > are in the second file only: that is the altered row.'] },
            { q: 'Who badged into the Records Room shortly before the ledger was modified?', answers: ['quinn ash', 'b-2291'], hints: ['ls -l shows when ledger.csv was last modified.', 'grep "Records Room" badge_log.csv', 'Look for the entry a few minutes before 02:51 on March 14.'] },
            { q: 'IMG_0412.jpg is not a photo. Where does the hidden message set the meeting?', answers: ['pier 9', 'pier9', 'at pier 9'], hints: ['file IMG_0412.jpg tells you what the file contains.', 'It is text. cat it: it looks like base64.', 'base64 -d IMG_0412.jpg'] }
        ],
        objectives: [
            { text: 'Verify fingerprints with sha256sum -c', test: uses('sha256sum', '-c') },
            { text: 'Compare two files with diff', test: uses('diff') },
            { text: 'Check modification times with ls -l', test: uses('ls', /^-\w*l/) },
            { text: 'Identify a file type with file', test: uses('file') },
            { text: 'Decode base64 with base64 -d', test: uses('base64', /^(-\w*d|--decode)$/) }
        ],
        cheats: [['cd evidence', 'go to the evidence'], ['cat MANIFEST.sha256', 'the fingerprints'], ['sha256sum -c MANIFEST.sha256', 'check every file'], ['ls -l', 'sizes and times'], ['diff ~/backup/ledger.csv ledger.csv', 'what changed'], ['file IMG_0412.jpg', 'what is it really?'], ['base64 -d IMG_0412.jpg', 'decode']]
    });

    // ---------------------------------------------------------------- 5
    CASES.push({
        id: 'leak', track: 'Git', title: 'Leaked Key', level: 'Medium',
        brief: 'The payments team says a live API key was committed to ~/payments-api and then "cleaned up" in a later commit. Deleting a line in a new commit does not erase it from history. Find the key, who committed it, and the commit that did it.',
        learned: ['git log lists commits, git log --oneline one per line', 'git log -p shows the change each commit made', 'git log -S TEXT finds commits that added or removed TEXT', 'git show HASH shows one commit, and git show HASH:FILE prints a file as it was then', 'A secret stays in history even after a later commit removes it. Rotate it.'],
        build(vfs) {
            base(vfs);
            const R = new DD.Repo(vfs, HOME + '/payments-api', { remote: 'https://git.nightjar.lab/payments-api.git' });
            const D = 'Dana Reyes <dana@nightjar.lab>', M = 'Mo Patel <mo@nightjar.lab>', L = 'Lee Huang <lee@nightjar.lab>';
            R.commit({ author: D, date: '2025-02-20 09:14:02', message: 'Initial commit', set: { 'README.md': '# payments-api\n\nSmall service that sends card payments to the gateway.\n', 'app.py': 'from flask import Flask\n\napp = Flask(__name__)\n\n\n@app.route("/pay", methods=["POST"])\ndef pay():\n    return {"status": "queued"}\n', 'requirements.txt': 'flask==3.0.2\nrequests==2.31.0\n' } });
            R.commit({ author: D, date: '2025-02-21 11:02:47', message: 'Add health check endpoint', set: { 'app.py': 'from flask import Flask\n\napp = Flask(__name__)\n\n\n@app.route("/health")\ndef health():\n    return {"ok": True}\n\n\n@app.route("/pay", methods=["POST"])\ndef pay():\n    return {"status": "queued"}\n' } });
            const leak = R.commit({ author: M, date: '2025-02-24 16:41:09', message: 'Connect to payment gateway', set: { 'config.py': 'GATEWAY_URL = "https://gateway.example.com/v2"\nAPI_KEY = "sk_live_N1GHTJAR_7f3a9c"\nTIMEOUT_S = 10\n', 'gateway.py': 'import requests\n\nfrom config import API_KEY, GATEWAY_URL, TIMEOUT_S\n\n\ndef charge(amount_cents, token):\n    r = requests.post(GATEWAY_URL + "/charge", json={"amount": amount_cents, "token": token},\n                      headers={"Authorization": "Bearer " + API_KEY}, timeout=TIMEOUT_S)\n    r.raise_for_status()\n    return r.json()\n' } });
            R.commit({ author: L, date: '2025-02-25 10:20:33', message: 'Add retry logic to gateway client', set: { 'gateway.py': 'import time\n\nimport requests\n\nfrom config import API_KEY, GATEWAY_URL, TIMEOUT_S\n\n\ndef charge(amount_cents, token, retries=3):\n    for attempt in range(retries):\n        try:\n            r = requests.post(GATEWAY_URL + "/charge", json={"amount": amount_cents, "token": token},\n                              headers={"Authorization": "Bearer " + API_KEY}, timeout=TIMEOUT_S)\n            r.raise_for_status()\n            return r.json()\n        except requests.RequestException:\n            time.sleep(2 ** attempt)\n    raise RuntimeError("gateway unreachable")\n' } });
            R.commit({ author: M, date: '2025-02-27 08:55:16', message: 'Clean up config', set: { 'config.py': 'import os\n\nGATEWAY_URL = "https://gateway.example.com/v2"\nAPI_KEY = os.environ["PAYMENT_API_KEY"]\nTIMEOUT_S = 10\n' } });
            R.commit({ author: L, date: '2025-03-03 14:30:51', message: 'Document setup steps', set: { 'README.md': '# payments-api\n\nSmall service that sends card payments to the gateway.\n\n## Setup\n\n    pip install -r requirements.txt\n    export PAYMENT_API_KEY=...\n    flask --app app run\n' } });
            R.commit({ author: D, date: '2025-03-10 09:05:12', message: 'Release 1.2.0', set: { 'VERSION': '1.2.0\n' } });
            R.finish();
            return { cwd: HOME, facts: { leak } };
        },
        questions: [
            { q: 'What is the leaked API key?', answers: ['sk_live_n1ghtjar_7f3a9c'], hints: ['cd payments-api, then git log --oneline. Which commit sounds like it touched secrets?', 'git log -p config.py shows every change made to config.py.', 'Or search history directly: git log -S API_KEY -p'] },
            { q: 'Who committed the key?', answers: ['mo patel', 'mo', 'mo@nightjar.lab'], hints: ['git log shows an Author line for each commit.', 'Find the commit that added the key with git log -S sk_live', 'git show that commit and read its Author line.'] },
            { q: 'What is the hash of the commit that added the key? (7 or more characters)', check: (a, f) => prefixOf(f.leak)(a), hints: ['git log --oneline prints a short hash before each message.', 'git log -S sk_live --oneline lists the commits that added or removed that text. The older one added it.', 'The first 7 characters of the hash are enough.'] }
        ],
        objectives: [
            { text: 'List history with git log', test: uses('git', 'log') },
            { text: 'Compact history with git log --oneline', test: uses('git', 'log', '--oneline') },
            { text: 'See changes with git log -p or git log -S', test: rec => uses('git', 'log', '-p')(rec) || uses('git', 'log', /^-S/)(rec) },
            { text: 'Inspect one commit with git show', test: uses('git', 'show') }
        ],
        cheats: [['cd payments-api', 'enter the repo'], ['git log --oneline', 'history, short'], ['git log -p config.py', 'every change to one file'], ['git log -S API_KEY --oneline', 'commits that added or removed text'], ['git show HEAD~2', 'one commit and its diff'], ['git help log', 'all log options']]
    });

    // ---------------------------------------------------------------- 6
    CASES.push({
        id: 'lostbranch', track: 'Git', title: 'Lost Branch', level: 'Hard',
        brief: 'Someone added a secret override code to the door firmware in ~/door-firmware on a side branch, then deleted the branch. git branch no longer shows it and git log --all cannot see it. Git keeps a private diary of where HEAD has been. Use it to recover the work.',
        learned: ['git reflog lists every commit HEAD has visited, including ones no branch points to', 'A deleted branch only removes the name. The commits stay until git cleans them up', 'git branch NAME HASH puts a new name on any commit, which brings it back', 'git show HASH:PATH prints one file from any commit'],
        build(vfs) {
            base(vfs);
            const R = new DD.Repo(vfs, HOME + '/door-firmware');
            const L = 'Lee Huang <lee@nightjar.lab>', S = 'Sam Ortiz <sam@nightjar.lab>', Q = 'Quinn Ash <quinn@nightjar.lab>';
            const lock1 = '#include "lock.h"\n\nint unlock(const char *pin) {\n    return check_pin(pin);\n}\n';
            R.commit({ author: L, date: '2025-02-11 10:00:41', message: 'Initial firmware skeleton', set: { 'README.md': '# door-firmware\n\nFirmware for the lab door controllers.\n', 'src/main.c': '#include "lock.h"\n\nint main(void) {\n    lock_init();\n    for (;;) lock_poll();\n}\n', 'src/lock.c': lock1 } });
            R.commit({ author: S, date: '2025-02-14 15:22:10', message: 'Add keypad driver', set: { 'src/keypad.c': '#include "keypad.h"\n\nchar keypad_read(void) {\n    return scan_matrix(DEBOUNCE_MS);\n}\n' } });
            R.checkout('hotfix/door-lock');
            const lost = R.commit({ author: Q, date: '2025-03-12 23:58:30', message: 'Add maintenance override code', set: { 'src/override.h': '#pragma once\n\n/* Opens every door. Remove before release. */\n#define OVERRIDE_CODE "7-ALPHA-29"\n', 'src/lock.c': '#include "lock.h"\n#include "override.h"\n\nint unlock(const char *pin) {\n    if (strcmp(pin, OVERRIDE_CODE) == 0) return 1;\n    return check_pin(pin);\n}\n' } });
            R.checkout('main');
            R.deleteBranch('hotfix/door-lock');
            R.commit({ author: L, date: '2025-03-13 09:41:27', message: 'Fix keypad debounce timing', set: { 'src/keypad.c': '#include "keypad.h"\n\n#define DEBOUNCE_MS 25\n\nchar keypad_read(void) {\n    return scan_matrix(DEBOUNCE_MS);\n}\n' } });
            R.commit({ author: S, date: '2025-03-13 16:03:55', message: 'Update README with flashing steps', set: { 'README.md': '# door-firmware\n\nFirmware for the lab door controllers.\n\nFlash with: make flash PORT=/dev/ttyUSB0\n' } });
            R.finish();
            return { cwd: HOME, facts: { lost } };
        },
        questions: [
            { q: 'What is the hash of the lost commit? (7 or more characters)', check: (a, f) => prefixOf(f.lost)(a), hints: ['cd door-firmware. git branch and git log --all only show what branches point to.', 'git reflog shows where HEAD has been, newest first.', 'Look for the commit on hotfix/door-lock, right before "checkout: moving from hotfix/door-lock to main".'] },
            { q: 'What is the override code?', answers: ['7-alpha-29'], hints: ['git show HASH shows the lost commit and its diff.', 'The code is in src/override.h.', 'git show HASH:src/override.h prints just that file.'] },
            { q: 'Recover the work: create a branch that points at the lost commit.', auto: g => { const r = g.repo('door-firmware'); return !!r && Object.values(r.branches).includes(g.facts.lost); }, task: true, hints: ['git branch NAME HASH creates a branch at any commit.', 'For example: git branch rescue HASH', 'git switch -c rescue HASH also works, and moves you onto it.'] }
        ],
        objectives: [
            { text: 'List branches with git branch', test: uses('git', 'branch') },
            { text: 'Read the reflog with git reflog', test: uses('git', 'reflog') },
            { text: 'Show a lost commit with git show', test: uses('git', 'show') },
            { text: 'Switch to the rescued branch', test: rec => uses('git', 'switch')(rec) || uses('git', 'checkout')(rec) }
        ],
        cheats: [['cd door-firmware', 'enter the repo'], ['git branch', 'list branches'], ['git log --oneline --all', 'every commit a branch can reach'], ['git reflog', 'where HEAD has been'], ['git show HEAD@{2}', 'a reflog entry'], ['git branch rescue HASH', 'name a commit'], ['git switch rescue', 'move onto it']]
    });

    // ---------------------------------------------------------------- 7
    CASES.push({
        id: 'blame', track: 'Git', title: 'Blame Game', level: 'Hard',
        brief: 'The lab door alarm stayed silent during the break-in. The setting lives in ~/door-controller/config/settings.ini. Find who switched it off and how they disguised the change. Then check whether they left unfinished work lying around.',
        learned: ['git blame FILE shows who last changed each line, and in which commit', 'A commit message can hide what the commit really does. Read the diff', 'git stash list shows changes set aside for later, and git stash show -p shows their content'],
        build(vfs) {
            base(vfs);
            const R = new DD.Repo(vfs, HOME + '/door-controller');
            const L = 'Lee Huang <lee@nightjar.lab>', S = 'Sam Ortiz <sam@nightjar.lab>', Q = 'Quinn Ash <quinn@nightjar.lab>';
            const ini = o => `[door]\nopen_delay_ms = ${o.delay}\nlock_retry = ${o.retry}\nalarm_enabled = ${o.alarm}\nnight_mode = ${o.night}\n\n[network]\nlisten_port = 8443\nlog_level = ${o.log}\n${o.extra || ''}`;
            const st = { delay: 1500, retry: 3, alarm: 'true', night: 'false', log: 'info' };
            const step = (author, date, message, change, extra) => { Object.assign(st, change); R.commit({ author, date, message, set: Object.assign({ 'config/settings.ini': ini(st) }, extra || {}) }); };
            step(L, '2025-02-10 09:30:00', 'Initial controller config', {}, { 'controller.py': 'import configparser\n\ncfg = configparser.ConfigParser()\ncfg.read("config/settings.ini")\nALARM = cfg.getboolean("door", "alarm_enabled")\n', 'README.md': '# door-controller\n\nReads config/settings.ini and drives the door locks.\n' });
            step(S, '2025-02-18 13:12:45', 'Raise lock retry to 5', { retry: 5 });
            step(L, '2025-03-01 17:40:02', 'Enable night mode', { night: 'true' });
            const bad = R.headHash();
            step(Q, '2025-03-12 23:31:18', 'Tune night mode timings', { delay: 900, alarm: 'false' });
            step(S, '2025-03-13 08:15:27', 'Set log level to warning', { log: 'warning' });
            step(L, '2025-03-13 11:02:39', 'Add tests for door state', {}, { 'tests/test_door.py': 'from controller import ALARM\n\n\ndef test_alarm_flag_is_bool():\n    assert isinstance(ALARM, bool)\n' });
            void bad;
            R.stashSave({ author: Q, date: '2025-03-14 02:10:44', message: 'keep for later', set: { 'config/settings.ini': ini(Object.assign({}, st, { extra: 'remote_host = 198.51.100.66\nremote_user = svc_backup\n' })) } });
            R.finish();
            return { cwd: HOME, facts: {} };
        },
        questions: [
            { q: 'Who set alarm_enabled = false?', answers: ['quinn ash', 'quinn', 'quinn@nightjar.lab'], hints: ['cd door-controller and cat config/settings.ini.', 'git blame config/settings.ini shows the author of every line.', 'Read the name on the alarm_enabled line.'] },
            { q: 'What commit message did they use for that change?', answers: ['tune night mode timings'], hints: ['git blame prints a short hash at the start of each line.', 'git show HASH shows that commit, its message and its diff.', 'Or: git log --oneline --author=Quinn'] },
            { q: 'They also stashed unfinished work. Which remote IP address does it contain?', answers: ['198.51.100.66'], hints: ['git stash list shows stashed work.', 'git stash show -p prints the stashed changes.', 'Look for the remote_host line.'] }
        ],
        objectives: [
            { text: 'Find line authors with git blame', test: uses('git', 'blame') },
            { text: 'Open a commit with git show', test: uses('git', 'show') },
            { text: 'List stashes with git stash list', test: uses('git', 'stash', 'list') },
            { text: 'Read a stash with git stash show -p', test: uses('git', 'stash', 'show') }
        ],
        cheats: [['cd door-controller', 'enter the repo'], ['cat config/settings.ini', 'the current settings'], ['git blame config/settings.ini', 'who changed each line'], ['git log -p config/settings.ini', 'every change, oldest last'], ['git stash list', 'work set aside'], ['git stash show -p', 'what is in the stash']]
    });

    // ---------------------------------------------------------------- 8
    CASES.push({
        id: 'report', track: 'Git', title: 'Case Closed', level: 'Medium',
        brief: 'Time to file your report. The case repository is ~/casefile. Sign your work with your name, write your report on its own branch named report, and commit it. Inspector Vale reviews every commit.',
        learned: ['git config user.name sets the name stored in your commits', 'git switch -c NAME creates a branch and moves onto it', 'git add stages a file, git commit -m records it', 'git status tells you what is staged, changed or untracked at any moment'],
        build(vfs) {
            base(vfs);
            const R = new DD.Repo(vfs, HOME + '/casefile');
            const V = 'Inspector Vale <vale@nightjar.lab>';
            R.commit({ author: V, date: '2025-03-14 08:10:00', message: 'Open case file NJ-0314', set: { 'README.md': '# Case NJ-0314: Records Room break-in\n\nFindings are in evidence/. One person appears in all of the serious ones.\n\nTo file your report:\n  1. git config user.name "Your Name"\n  2. git switch -c report\n  3. echo "Suspect: FULL NAME" > report.txt\n  4. git add report.txt\n  5. git commit -m "Add report"\n' } });
            R.commit({ author: V, date: '2025-03-14 09:25:00', message: 'Add findings from the first four cases', set: {
                'evidence/payments.txt': 'Leaked API key committed by Mo Patel on 2025-02-24.\nMo reported it the same week. The key was rotated. Accident, not a crime.\n',
                'evidence/ssh.txt': 'svc_backup was broken into from 203.0.113.77 at 03:47:12.\nThe svc_backup password was on a sticky note in Lab 2.\n',
                'evidence/ledger.txt': 'ledger.csv was altered at 02:51 on 2025-03-14.\nBadge B-2291 entered the Records Room at 02:47.\nBadge B-2291 belongs to Quinn Ash.\n'
            } });
            R.commit({ author: V, date: '2025-03-14 10:02:00', message: 'Add door system findings', set: {
                'evidence/firmware.txt': 'A deleted branch held a master override code for every door.\nCommit author: Quinn Ash.\n',
                'evidence/alarm.txt': 'alarm_enabled was set to false in a commit called "Tune night mode timings".\nCommit author: Quinn Ash. A stash on the same machine points at 198.51.100.66, as svc_backup.\n'
            } });
            R.finish();
            return { cwd: HOME + '/casefile', facts: {} };
        },
        questions: [
            { q: 'Who is the suspect? (full name)', answers: ['quinn ash'], hints: ['ls evidence, then read the files with cat.', 'grep -r Quinn evidence shows every mention at once.', 'One name appears in the ledger, firmware and alarm findings.'] },
            { q: 'Create a branch named report and switch to it.', task: true, auto: g => { const r = g.repo('casefile'); return !!r && r.head.branch === 'report'; }, hints: ['git switch -c report creates the branch and moves onto it.', 'git checkout -b report does the same thing, the older way.', 'The prompt shows the branch you are on, in brackets.'] },
            { q: 'Commit report.txt on the report branch, naming the suspect.', task: true, auto: g => {
                const r = g.repo('casefile');
                if (!r || !r.branches.report) return false;
                const c = r.commits[r.branches.report];
                return c.author !== 'Inspector Vale' && /quinn\s+ash/i.test(c.tree['report.txt'] || '');
            }, hints: ['echo "Suspect: Quinn Ash" > report.txt writes the file.', 'git add report.txt stages it. git status shows it under "Changes to be committed".', 'git commit -m "Add report" records it.'] }
        ],
        objectives: [
            { text: 'Set your name with git config user.name', test: rec => rec.stages.some(s => s.argv[0] === 'git' && s.argv[1] === 'config' && s.argv[2] === 'user.name' && s.argv.length > 3) },
            { text: 'Create a branch with git switch -c', test: rec => uses('git', 'switch', '-c')(rec) || uses('git', 'checkout', '-b')(rec) },
            { text: 'Write a file with echo and >', test: rec => /\becho\b.*>/.test(rec.line) && rec.code === 0 },
            { text: 'Stage it with git add', test: uses('git', 'add') },
            { text: 'Check your work with git status', test: uses('git', 'status') },
            { text: 'Commit with git commit -m', test: uses('git', 'commit') },
            { text: 'Review history with git log --oneline', test: uses('git', 'log', '--oneline') }
        ],
        cheats: [['cat README.md', 'the instructions'], ['grep -r Quinn evidence', 'search every finding'], ['git config user.name "Your Name"', 'sign your commits'], ['git switch -c report', 'new branch'], ['echo "Suspect: FULL NAME" > report.txt', 'write the report'], ['git status', 'what changed?'], ['git add report.txt', 'stage it'], ['git commit -m "Add report"', 'record it'], ['git log --oneline', 'see your commit']]
    });

    CASES.forEach((c, i) => { c.n = i + 1; c.questions.forEach((q, k) => { q.id = k; }); });
    DD.CASES = CASES;
    DD.norm = norm;
})(window.DD);
