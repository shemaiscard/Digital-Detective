'use strict';
// The game: terminal rendering, input, cases, scoring and saved progress.
(function (DD) {
    const KEY = 'dd-progress-v2';
    const HOME = '/home/detective';
    const MAX_LINES = 2000;
    const GIT_SUBS = ['add', 'blame', 'branch', 'checkout', 'commit', 'config', 'diff', 'grep', 'help', 'init', 'log', 'ls-files', 'reflog', 'reset', 'restore', 'rev-parse', 'show', 'stash', 'status', 'switch'];
    const $ = s => document.querySelector(s);
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarse = () => window.matchMedia && matchMedia('(pointer: coarse)').matches;
    const p2 = n => String(n).padStart(2, '0');
    const wait = ms => new Promise(r => setTimeout(r, reduced() ? 0 : ms));

    function freshSave() { return { v: 2, cases: {}, current: 0, settings: { crt: true }, seen: false }; }
    function loadSave() {
        try {
            const s = JSON.parse(localStorage.getItem(KEY));
            if (s && s.v === 2 && s.cases) return Object.assign(freshSave(), s);
        } catch (e) { /* storage blocked or corrupt: start fresh */ }
        return freshSave();
    }

    class Game {
        constructor() {
            this.save = loadSave();
            this.sh = new DD.Shell(this);
            this.clock = Date.UTC(2025, 2, 15, 10, 0);
            this.case = null;
            this.facts = {};
            this.histIdx = null;
            this.draft = '';
            this.busy = false;
            this.pending = [];
            this.dom = {
                screen: $('#screen'), out: $('#out'), form: $('#promptForm'), cmd: $('#cmd'), ps1: $('#ps1'),
                panel: $('#panel'), score: $('#score'), chip: $('#caseChip'), badge: $('#panelBadge'),
                brief: $('#brief'), questions: $('#questions'), objectives: $('#objectives'), objCount: $('#objCount'),
                cheats: $('#cheats'), caseTitle: $('#caseTitle'), caseMeta: $('#caseMeta')
            };
        }

        // ---------- hooks used by the shell ----------
        now() { const d = new Date(this.clock); return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`; }
        printErr(text) { this.printLines(String(text).split('\n').map(t => ({ parts: [{ t, c: 'c-err' }] }))); }
        print(text, cls) { this.printLines(String(text).split('\n').map(t => ({ parts: [{ t, c: cls }] }))); }
        printLines(lines) {
            const out = this.dom.out;
            const frag = document.createDocumentFragment();
            for (const line of lines) {
                const div = el('div', 'line');
                for (const p of line.parts) {
                    if (p.t === '' || p.t == null) continue;
                    let node;
                    if (p.run || p.insert) {
                        node = el('button', 'lnk' + (p.c ? ' ' + p.c : ''), p.t);
                        node.type = 'button';
                        node.tabIndex = -1;
                        if (p.run) { node.dataset.run = p.run; node.title = 'Run: ' + p.run; } else { node.dataset.insert = p.insert; node.title = 'Type: ' + p.insert; }
                    } else if (p.c) node = el('span', p.c, p.t);
                    else node = document.createTextNode(p.t);
                    div.appendChild(node);
                }
                frag.appendChild(div);
            }
            out.appendChild(frag);
            let extra = out.childElementCount - MAX_LINES;
            while (extra-- > 0) out.removeChild(out.firstChild);
            this.scroll();
        }
        special(s) {
            if (s === 'clear') this.dom.out.textContent = '';
            else if (s && s.play != null) this.startCase(s.play, true);
            else if (s && s.restart) this.startCase(this.save.current, true);
        }
        track(rec) {
            if (!this.case) return;
            const st = this.state();
            this.case.objectives.forEach((o, i) => {
                if (st.obj[i]) return;
                let ok = false;
                try { ok = o.test(rec); } catch (e) { ok = false; }
                if (!ok) return;
                st.obj[i] = true;
                this.pending.push({ parts: [{ t: '[x] ', c: 'c-ok' }, { t: 'Objective done: ' + o.text, c: 'c-dim' }] });
            });
        }

        // ---------- state ----------
        state(c) {
            c = c || this.case;
            const s = this.save.cases[c.id] = this.save.cases[c.id] || {};
            for (const k of ['solved', 'hints', 'wrong', 'obj', 'answers']) s[k] = s[k] || {};
            return s;
        }
        persist() { try { localStorage.setItem(KEY, JSON.stringify(this.save)); } catch (e) { /* private mode: progress lasts this visit */ } }
        points(c, qi) {
            const s = this.state(c);
            if (!s.solved[qi]) return 0;
            return Math.max(20, 100 - 10 * (s.hints[qi] || 0) - 5 * (s.wrong[qi] || 0));
        }
        caseScore(c) { return c.questions.reduce((sum, q) => sum + this.points(c, q.id), 0); }
        totalScore() { return DD.CASES.reduce((sum, c) => sum + (this.save.cases[c.id] ? this.caseScore(c) : 0), 0); }
        stars(c) {
            const s = this.save.cases[c.id];
            if (!s || !s.done) return 0;
            const h = Object.values(s.hints || {}).reduce((a, b) => a + b, 0);
            return h === 0 ? 3 : h <= 2 ? 2 : 1;
        }
        repo(name) { const n = this.sh.vfs.get(HOME + '/' + name); return n && n.repo ? n.repo : null; }

        // ---------- cases ----------
        startCase(i, announce) {
            const c = DD.CASES[i];
            if (!c) return;
            this.case = c;
            this.save.current = i;
            const vfs = new DD.VFS();
            const world = c.build(vfs);
            this.facts = world.facts || {};
            this.sh.reset(vfs, world.cwd);
            this.state();
            this.persist();
            if (announce !== false) {
                this.print('');
                this.printLines([{ parts: [{ t: `CASE ${c.n}/${DD.CASES.length}: ${c.title.toUpperCase()}`, c: 'c-head' }, { t: `  ${c.track} track, ${c.level}`, c: 'c-dim' }] }]);
                this.print(c.brief);
                this.printLines([{ parts: [{ t: 'Questions are in the ' }, { t: 'case file', c: 'c-link', run: 'brief' }, { t: '. Stuck? Type ' }, { t: 'hint', c: 'c-link', run: 'hint' }, { t: ' or ' }, { t: 'help', c: 'c-link', run: 'help' }, { t: '.' }] }]);
                this.print('');
            }
            this.renderPanel();
            this.updatePrompt();
            this.updateScore();
        }

        submit(qi, raw) {
            const c = this.case, q = c.questions[qi], s = this.state();
            if (!q) return { ok: false, msg: `There is no question ${qi + 1}. This case has ${c.questions.length}.` };
            if (s.solved[qi]) return { ok: true, msg: 'Already solved.' };
            if (q.task) return { ok: false, msg: 'This one is a task: do it in the terminal and it ticks itself.' };
            const answer = String(raw || '').trim();
            if (!answer) return { ok: false, msg: 'Type an answer first.' };
            const ok = q.check ? q.check(answer, this.facts) : q.answers.includes(DD.norm(answer));
            if (ok) {
                s.solved[qi] = true;
                s.answers[qi] = answer;
                this.persist();
                this.afterSolve(qi);
                return { ok: true, msg: `Correct. +${this.points(c, qi)} points.` };
            }
            s.wrong[qi] = (s.wrong[qi] || 0) + 1;
            this.persist();
            this.renderQuestion(qi);
            return { ok: false, msg: 'Not quite. Check the evidence again (-5).' };
        }

        hint(qi) {
            const q = this.case.questions[qi], s = this.state();
            if (!q || s.solved[qi]) return null;
            const n = s.hints[qi] || 0;
            if (n >= q.hints.length) return { text: q.hints[q.hints.length - 1], n, last: true };
            s.hints[qi] = n + 1;
            this.persist();
            this.renderQuestion(qi);
            this.updateScore();
            return { text: q.hints[n], n: n + 1, last: n + 1 === q.hints.length };
        }

        afterSolve(qi) {
            this.renderQuestion(qi);
            this.updateScore();
            const c = this.case, s = this.state();
            if (!s.done && c.questions.every(q => s.solved[q.id])) {
                s.done = true;
                this.persist();
                this.renderPanel();
                setTimeout(() => this.showDone(), reduced() ? 50 : 600);
            }
        }

        checkTasks() {
            const c = this.case, s = this.state();
            c.questions.forEach(q => {
                if (!q.auto || s.solved[q.id]) return;
                let ok = false;
                try { ok = q.auto(this); } catch (e) { ok = false; }
                if (!ok) return;
                s.solved[q.id] = true;
                this.persist();
                this.printLines([{ parts: [{ t: '[x] ', c: 'c-ok' }, { t: `Task ${q.id + 1} complete: ${q.q} +${this.points(c, q.id)} points`, c: 'c-ok' }] }]);
                this.afterSolve(q.id);
            });
        }

        // ---------- running commands ----------
        exec(line, opts) {
            opts = opts || {};
            this.echo(line);
            this.histIdx = null;
            if (!line.trim()) return;
            this.clock += 60000;
            this.pending = [];
            this.sh.run(line);
            if (this.pending.length) { this.printLines(this.pending); this.persist(); this.renderObjectives(); }
            this.pending = [];
            this.checkTasks();
            this.updatePrompt();
        }

        echo(line) {
            const p = this.sh.prompt();
            const parts = [{ t: p.user, c: 'c-user' }, { t: ':' }, { t: p.path, c: 'c-path' }];
            if (p.branch) parts.push({ t: ` (${p.branch})`, c: 'c-branch' });
            parts.push({ t: '$ ' }, { t: line });
            this.printLines([{ parts }]);
        }

        updatePrompt() {
            const p = this.sh.prompt();
            const ps1 = this.dom.ps1;
            ps1.textContent = '';
            ps1.append(el('span', 'c-user', p.user), ':', el('span', 'c-path', p.path));
            if (p.branch) ps1.append(el('span', 'c-branch', ` (${p.branch})`));
            ps1.append('$');
        }

        scroll() { const s = this.dom.screen; s.scrollTop = s.scrollHeight; }

        // ---------- tab completion ----------
        complete() {
            const input = this.dom.cmd;
            const pos = input.selectionStart;
            const before = input.value.slice(0, pos), after = input.value.slice(pos);
            const word = /(\S*)$/.exec(before)[1];
            const head = before.slice(0, before.length - word.length);
            const segment = head.split(/\|\||&&|[|;]/).pop();
            const words = segment.trim().split(/\s+/).filter(Boolean);
            let cands = [], pathMode = false;
            if (!words.length) cands = Object.keys(DD.commands).filter(n => !DD.commands[n].hidden);
            else if (words[0] === 'git' && words.length === 1) cands = GIT_SUBS;
            else if (words[0] === 'man') cands = Object.keys(DD.commands).filter(n => !DD.commands[n].hidden).concat(['pipes']);
            else if (words[0] === 'play') cands = DD.CASES.map(c => String(c.n));
            else {
                const repo = this.sh.repoAt(this.sh.cwd);
                if (words[0] === 'git' && repo && ['switch', 'checkout', 'branch', 'log', 'diff', 'show', 'reset'].includes(words[1]) && !word.includes('/')) cands = Object.keys(repo.branches);
                pathMode = true;
            }
            let matches = cands.filter(c => c.startsWith(word)).map(c => ({ full: c, show: c, dir: false }));
            if (pathMode) {
                const cut = word.lastIndexOf('/');
                const dirPart = cut >= 0 ? word.slice(0, cut + 1) : '';
                const base = word.slice(cut + 1);
                let dirAbs = dirPart || '.';
                if (dirPart.startsWith('~')) dirAbs = HOME + dirPart.slice(1);
                const dir = this.sh.node(dirAbs);
                if (dir && dir.type === 'dir') {
                    for (const name of this.sh.vfs.list(dir, base.startsWith('.'))) {
                        if (!name.startsWith(base)) continue;
                        const isDir = dir.children[name].type === 'dir';
                        matches.push({ full: dirPart + name + (isDir ? '/' : ''), show: name + (isDir ? '/' : ''), dir: isDir });
                    }
                }
            }
            const seen = new Set();
            matches = matches.filter(m => !seen.has(m.full) && seen.add(m.full));
            if (!matches.length) return;
            const set = text => { input.value = head + text + after; const at = (head + text).length; input.setSelectionRange(at, at); };
            if (matches.length === 1) { const m = matches[0]; set(m.full + (m.dir ? '' : ' ')); return; }
            let pre = matches[0].full;
            for (const m of matches) while (!m.full.startsWith(pre)) pre = pre.slice(0, -1);
            if (pre.length > word.length) { set(pre); return; }
            this.echo(input.value);
            const parts = [];
            matches.forEach((m, i) => { if (i) parts.push({ t: '  ' }); parts.push({ t: m.show, c: m.dir ? 'c-dir' : null }); });
            this.printLines([{ parts }]);
        }

        // ---------- panel ----------
        renderPanel() {
            const c = this.case, d = this.dom;
            d.caseTitle.textContent = `Case ${c.n}: ${c.title}`;
            d.caseMeta.textContent = `${c.track} track, ${c.level}`;
            d.chip.textContent = `Case ${c.n}/${DD.CASES.length}: ${c.title}`;
            d.brief.textContent = c.brief;
            d.questions.textContent = '';
            c.questions.forEach(q => d.questions.appendChild(el('li')));
            c.questions.forEach(q => this.renderQuestion(q.id));
            this.renderObjectives();
            d.cheats.textContent = '';
            for (const [cmd, desc] of c.cheats) {
                const li = el('li');
                const b = el('button', 'cheat', cmd);
                b.type = 'button';
                b.dataset.insert = cmd;
                b.title = 'Put this command in the terminal';
                li.append(b, el('span', 'cheat-desc', desc));
                d.cheats.appendChild(li);
            }
        }

        renderQuestion(qi) {
            const c = this.case, q = c.questions[qi], s = this.state();
            const li = this.dom.questions.children[qi];
            const draft = li.querySelector('input') ? li.querySelector('input').value : '';
            li.textContent = '';
            li.className = 'q' + (s.solved[qi] ? ' solved' : '');
            const top = el('div', 'q-top');
            top.append(el('span', 'q-num', String(qi + 1)), el('p', 'q-text', q.q));
            li.appendChild(top);
            if (s.solved[qi]) {
                const done = el('p', 'q-done');
                done.append(el('span', 'tag-ok', 'SOLVED'), ' ', el('span', 'q-ans', q.task ? 'done in the terminal' : s.answers[qi] || ''), el('span', 'q-pts', ` +${this.points(c, qi)}`));
                li.appendChild(done);
            } else if (q.task) {
                li.appendChild(el('p', 'q-task', 'Task: do this in the terminal. It ticks itself when done.'));
            } else {
                const f = el('form', 'q-form');
                const inp = el('input');
                inp.type = 'text';
                inp.autocomplete = 'off';
                inp.spellcheck = false;
                inp.setAttribute('autocapitalize', 'off');
                inp.setAttribute('aria-label', `Answer to question ${qi + 1}`);
                inp.placeholder = 'answer';
                inp.value = draft;
                const btn = el('button', 'btn', 'Check');
                btn.type = 'submit';
                f.append(inp, btn);
                f.addEventListener('submit', e => {
                    e.preventDefault();
                    const r = this.submit(qi, inp.value);
                    const live = this.dom.questions.children[qi].querySelector('.q-status');
                    if (live) { live.textContent = r.msg; live.className = 'q-status ' + (r.ok ? 'ok' : 'bad'); }
                    if (!r.ok && !reduced()) { f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake'); }
                    if (!r.ok) { const again = this.dom.questions.children[qi].querySelector('input'); if (again) again.focus(); }
                });
                li.appendChild(f);
            }
            const used = s.hints[qi] || 0;
            if (used) {
                const ol = el('ol', 'hints');
                q.hints.slice(0, used).forEach(h => ol.appendChild(el('li', null, h)));
                li.appendChild(ol);
            }
            if (!s.solved[qi]) {
                const meta = el('div', 'q-meta');
                if (used < q.hints.length) {
                    const hb = el('button', 'btn btn-ghost', used ? `Another hint (${used}/${q.hints.length}, -10)` : 'Hint (-10)');
                    hb.type = 'button';
                    hb.addEventListener('click', () => { this.hint(qi); const nb = this.dom.questions.children[qi].querySelector('.btn-ghost'); (nb || this.dom.questions.children[qi].querySelector('input') || this.dom.cmd).focus(); });
                    meta.appendChild(hb);
                }
                const status = el('span', 'q-status');
                status.setAttribute('role', 'status');
                if (s.wrong[qi]) status.textContent = `${s.wrong[qi]} wrong ${s.wrong[qi] === 1 ? 'try' : 'tries'}`;
                meta.appendChild(status);
                li.appendChild(meta);
            }
            const solved = c.questions.filter(x => s.solved[x.id]).length;
            this.dom.badge.textContent = `${solved}/${c.questions.length}`;
        }

        renderObjectives() {
            const c = this.case, s = this.state(), ul = this.dom.objectives;
            ul.textContent = '';
            let n = 0;
            c.objectives.forEach((o, i) => {
                const li = el('li', s.obj[i] ? 'done' : null);
                li.append(el('span', 'box', s.obj[i] ? '[x]' : '[ ]'), ' ', o.text);
                ul.appendChild(li);
                if (s.obj[i]) n++;
            });
            this.dom.objCount.textContent = `${n}/${c.objectives.length}`;
        }

        updateScore() { this.dom.score.textContent = String(this.totalScore()); }

        // ---------- dialogs ----------
        starNodes(n) {
            const span = el('span', 'stars');
            span.setAttribute('aria-label', `${n} of 3 stars`);
            for (let i = 0; i < 3; i++) span.appendChild(el('span', i < n ? 'star on' : 'star', '*'));
            return span;
        }

        showCases() {
            const list = $('#caseList');
            list.textContent = '';
            for (const track of ['Shell', 'Git']) {
                list.appendChild(el('h3', 'track', track === 'Shell' ? 'Shell track: navigate, search, count, verify' : 'Git track: history, branches, blame, commits'));
                const ul = el('ul', 'case-grid');
                for (const c of DD.CASES.filter(x => x.track === track)) {
                    const s = this.save.cases[c.id];
                    const li = el('li');
                    const b = el('button', 'case-card' + (this.case === c ? ' current' : '') + (s && s.done ? ' done' : ''));
                    b.type = 'button';
                    const solved = s ? c.questions.filter(q => s.solved && s.solved[q.id]).length : 0;
                    b.append(el('span', 'cc-num', p2(c.n)), el('span', 'cc-title', c.title), el('span', 'cc-meta', `${c.level}, ${solved}/${c.questions.length} solved`), this.starNodes(this.stars(c)));
                    b.addEventListener('click', () => { $('#casesDlg').close(); this.exec('play ' + c.n); this.focusCmd(); });
                    li.appendChild(b);
                    ul.appendChild(li);
                }
                list.appendChild(ul);
            }
            $('#totalLine').textContent = `Total score: ${this.totalScore()}. Cases closed: ${DD.CASES.filter(c => this.save.cases[c.id] && this.save.cases[c.id].done).length}/${DD.CASES.length}.`;
            $('#casesDlg').showModal();
        }

        showDone() {
            const c = this.case;
            const dlg = $('#doneDlg');
            $('#doneTitle').textContent = `Case ${c.n} closed: ${c.title}`;
            const st = $('#doneStars');
            st.textContent = '';
            st.appendChild(this.starNodes(this.stars(c)));
            const s = this.state();
            const hints = Object.values(s.hints).reduce((a, b) => a + b, 0);
            $('#doneScore').textContent = `${this.caseScore(c)} points, ${hints} ${hints === 1 ? 'hint' : 'hints'} used. Total: ${this.totalScore()}.`;
            const ul = $('#doneLearned');
            ul.textContent = '';
            for (const l of c.learned) ul.appendChild(el('li', null, l));
            const next = DD.CASES[c.n];
            const nb = $('#doneNext');
            nb.textContent = next ? `Next: ${next.title}` : 'All cases';
            nb.onclick = () => { dlg.close(); if (next) this.exec('play ' + next.n); else this.showCases(); this.focusCmd(); };
            if (!next) $('#doneTitle').textContent = 'Every case closed. Quinn Ash is in custody.';
            dlg.showModal();
        }

        focusCmd() { if (!coarse()) this.dom.cmd.focus(); }

        // ---------- setup ----------
        bindInput() {
            const d = this.dom, input = d.cmd;
            d.form.addEventListener('submit', e => {
                e.preventDefault();
                if (this.busy) return;
                const line = input.value;
                input.value = '';
                this.exec(line);
            });
            input.addEventListener('keydown', e => {
                const hist = this.sh.history;
                if (e.key === 'Tab') { e.preventDefault(); this.complete(); return; }
                if (e.key === 'ArrowUp') {
                    if (!hist.length) return;
                    e.preventDefault();
                    if (this.histIdx == null) { this.draft = input.value; this.histIdx = hist.length; }
                    this.histIdx = Math.max(0, this.histIdx - 1);
                    input.value = hist[this.histIdx];
                    requestAnimationFrame(() => input.setSelectionRange(input.value.length, input.value.length));
                    return;
                }
                if (e.key === 'ArrowDown') {
                    if (this.histIdx == null) return;
                    e.preventDefault();
                    this.histIdx++;
                    if (this.histIdx >= hist.length) { this.histIdx = null; input.value = this.draft; } else input.value = hist[this.histIdx];
                    return;
                }
                if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) { e.preventDefault(); d.out.textContent = ''; return; }
                if (e.ctrlKey && (e.key === 'c' || e.key === 'C') && input.selectionStart === input.selectionEnd) {
                    e.preventDefault();
                    this.echo(input.value + '^C');
                    input.value = '';
                    this.histIdx = null;
                    return;
                }
                if (e.ctrlKey && (e.key === 'u' || e.key === 'U')) { e.preventDefault(); input.value = input.value.slice(input.selectionStart); input.setSelectionRange(0, 0); }
            });
            d.out.addEventListener('click', e => {
                const b = e.target.closest('[data-run],[data-insert]');
                if (b) {
                    if (b.dataset.run) this.exec(b.dataset.run);
                    else this.insert(b.dataset.insert);
                    this.focusCmd();
                    return;
                }
            });
            d.screen.addEventListener('click', e => {
                if (e.target.closest('button,a,input')) return;
                const sel = window.getSelection();
                if (sel && String(sel).length) return;
                input.focus();
            });
            d.cheats.addEventListener('click', e => {
                const b = e.target.closest('[data-insert]');
                if (!b) return;
                this.insert(b.dataset.insert);
                if (window.innerWidth < 900) this.togglePanel(false);
                input.focus();
            });
            for (const k of document.querySelectorAll('#keys button')) {
                k.addEventListener('pointerdown', e => e.preventDefault());
                k.addEventListener('click', () => {
                    const key = k.dataset.key;
                    if (key === 'Tab') this.complete();
                    else if (key === 'Up' || key === 'Down') input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Arrow' + key, bubbles: true }));
                    else this.typeAtCursor(key);
                    input.focus();
                });
            }
        }

        insert(text) { const i = this.dom.cmd; i.value = text; i.setSelectionRange(text.length, text.length); this.histIdx = null; }
        typeAtCursor(t) {
            const i = this.dom.cmd, a = i.selectionStart, b = i.selectionEnd;
            i.value = i.value.slice(0, a) + t + i.value.slice(b);
            i.setSelectionRange(a + t.length, a + t.length);
        }

        togglePanel(force) {
            const open = force != null ? force : !document.body.classList.contains('panel-open');
            document.body.classList.toggle('panel-open', open);
            document.body.classList.toggle('panel-closed', !open);
            $('#btnPanel').setAttribute('aria-expanded', String(open));
        }

        bindChrome() {
            $('#btnPanel').addEventListener('click', () => this.togglePanel());
            $('#panelClose').addEventListener('click', () => { this.togglePanel(false); this.focusCmd(); });
            $('#btnCases').addEventListener('click', () => this.showCases());
            this.dom.chip.addEventListener('click', () => this.showCases());
            const crt = $('#btnCrt');
            const applyCrt = () => { document.body.classList.toggle('crt', !!this.save.settings.crt); crt.setAttribute('aria-pressed', String(!!this.save.settings.crt)); };
            crt.addEventListener('click', () => { this.save.settings.crt = !this.save.settings.crt; this.persist(); applyCrt(); });
            applyCrt();
            for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => { b.closest('dialog').close(); this.focusCmd(); });
            $('#restartCase').addEventListener('click', () => { this.exec('restart'); if (window.innerWidth < 900) this.togglePanel(false); this.focusCmd(); });
            $('#resetAll').addEventListener('click', () => {
                if (!window.confirm('Erase all scores, hints and solved cases?')) return;
                const crtOn = this.save.settings.crt;
                this.save = freshSave();
                this.save.settings.crt = crtOn;
                this.save.seen = true;
                this.persist();
                $('#casesDlg').close();
                this.dom.out.textContent = '';
                this.startCase(0, true);
                this.updateScore();
            });
            if (window.innerWidth < 900) this.togglePanel(false); else this.togglePanel(true);
        }

        async boot() {
            this.bindInput();
            this.bindChrome();
            this.updatePrompt();
            const first = !this.save.seen;
            if (first) {
                this.busy = true;
                const lines = [['NIGHTJAR FORENSICS LAB  terminal v2.0', 'c-head'], ['Connecting to evidence server ... ok', 'c-dim'], ['Mounting case files ... 8 cases found', 'c-dim'], ['', null],
                    ['You are a new detective. Everything here is solved by typing real shell and git commands.', null],
                    ['Type a command and press Enter. Anything underlined can be clicked to run it.', null],
                    ['Answer each case\'s questions in the case file. Hints cost 10 points, wrong answers 5.', null]];
                for (const [t, c] of lines) { this.print(t, c); await wait(220); }
                this.save.seen = true;
                this.busy = false;
                this.startCase(0, true);
            } else {
                const c = DD.CASES[this.save.current] || DD.CASES[0];
                this.print('NIGHTJAR FORENSICS LAB  terminal v2.0', 'c-head');
                this.printLines([{ parts: [{ t: 'Welcome back. Your progress is saved in this browser. Type ' }, { t: 'cases', c: 'c-link', run: 'cases' }, { t: ' to pick another case.' }] }]);
                this.startCase(DD.CASES.indexOf(c), true);
            }
            this.focusCmd();
        }
    }

    // ---------- game commands ----------
    const game = () => window.DDGame;
    const qIndex = (arg, c, s) => {
        if (arg != null && /^\d+$/.test(arg)) return +arg - 1;
        const open = c.questions.find(q => !s.solved[q.id]);
        return open ? open.id : -1;
    };

    DD.register('cases', {
        group: 'Case', man: ['cases', 'List every case with your stars. Click a case to play it.', ['cases']],
        fn(args, ctx) {
            const g = game();
            for (const c of DD.CASES) {
                const st = g.stars(c);
                ctx.parts([{ t: p2(c.n) + '  ', c: 'c-dim' }, { t: c.title.padEnd(18), c: 'c-link', run: 'play ' + c.n }, { t: ` ${c.track.padEnd(6)}${c.level.padEnd(8)}`, c: 'c-dim' }, { t: '*'.repeat(st), c: 'c-hash' }, { t: '*'.repeat(3 - st), c: 'c-dim' }, { t: g.case === c ? '  <- current' : '', c: 'c-ok' }]);
            }
        }
    });
    DD.register('play', {
        group: 'Case', man: ['play N', 'Start case N with a fresh copy of its evidence. Your score is kept.', ['play 1', 'play 5']],
        fn(args, ctx) {
            const n = parseInt(args[0], 10);
            if (!(n >= 1 && n <= DD.CASES.length)) { ctx.err(`play: pick a case from 1 to ${DD.CASES.length}, for example: play 5`); return 1; }
            ctx.special = { play: n - 1 };
        }
    });
    DD.register('restart', {
        group: 'Case', man: ['restart', 'Rebuild the current case from scratch, undoing every change you made to its files. Your score is kept.', ['restart']],
        fn(args, ctx) { ctx.special = { restart: true }; }
    });
    DD.register('brief', {
        group: 'Case', man: ['brief', 'Print the case brief and its questions.', ['brief']],
        fn(args, ctx) {
            const g = game(), c = g.case, s = g.state();
            ctx.out(`Case ${c.n}: ${c.title}`, 'c-head');
            ctx.out(c.brief);
            ctx.out('');
            c.questions.forEach(q => {
                const done = s.solved[q.id];
                ctx.parts([{ t: done ? '[x] ' : '[ ] ', c: done ? 'c-ok' : 'c-dim' }, { t: `${q.id + 1}. ${q.q}` }, { t: done ? `  ${q.task ? 'done' : s.answers[q.id]}` : '', c: 'c-ok' }]);
            });
            ctx.out('');
            ctx.parts([{ t: 'Answer with ', c: 'c-dim' }, { t: 'answer N TEXT', c: 'c-link', insert: 'answer 1 ' }, { t: ' or in the case file. Tasks tick themselves.', c: 'c-dim' }]);
        }
    });
    DD.register('hint', {
        group: 'Case', man: ['hint [N]', 'Show the next hint for question N, or for the first open question. Each hint costs 10 points.', ['hint', 'hint 2']],
        fn(args, ctx) {
            const g = game(), c = g.case, s = g.state();
            const qi = qIndex(args[0], c, s);
            if (qi < 0) { ctx.out('Every question in this case is solved.'); return 0; }
            if (!c.questions[qi]) { ctx.err(`hint: this case has questions 1 to ${c.questions.length}`); return 1; }
            if (s.solved[qi]) { ctx.out(`Question ${qi + 1} is already solved.`); return 0; }
            const h = g.hint(qi);
            ctx.out(`Question ${qi + 1}: ${c.questions[qi].q}`, 'c-dim');
            ctx.out(`Hint ${h.n}/${c.questions[qi].hints.length}: ${h.text}`, 'c-hash');
            if (h.last) ctx.out('That was the last hint for this question.', 'c-dim');
        }
    });
    DD.register('answer', {
        group: 'Case', man: ['answer N TEXT', 'Submit TEXT as the answer to question N. Case and extra spaces do not matter.', ['answer 1 /home/detective']],
        fn(args, ctx) {
            const g = game();
            if (args.length < 2 || !/^\d+$/.test(args[0])) { ctx.err('usage: answer N TEXT   for example: answer 2 OWL-4471'); return 1; }
            const r = g.submit(+args[0] - 1, args.slice(1).join(' '));
            ctx.out(r.msg, r.ok ? 'c-ok' : 'c-err');
            return r.ok ? 0 : 1;
        }
    });
    DD.register('progress', {
        group: 'Case', man: ['progress', 'Show your score for every case.', ['progress']],
        fn(args, ctx) {
            const g = game();
            for (const c of DD.CASES) {
                const s = g.save.cases[c.id];
                const solved = s ? c.questions.filter(q => s.solved && s.solved[q.id]).length : 0;
                ctx.out(`${p2(c.n)}  ${c.title.padEnd(18)} ${solved}/${c.questions.length} solved  ${String(s ? g.caseScore(c) : 0).padStart(4)} pts`, s && s.done ? 'c-ok' : null);
            }
            ctx.out(`Total: ${g.totalScore()} points`, 'c-head');
        }
    });

    DD.Game = Game;
    window.addEventListener('DOMContentLoaded', () => {
        window.DDGame = new Game();
        window.DDGame.boot();
    });
})(window.DD);
