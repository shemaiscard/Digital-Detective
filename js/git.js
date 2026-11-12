'use strict';
// A small in-memory git: commits, index, branches, reflog, stash, blame and diffs.
(function (DD) {
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const short = h => h.slice(0, 7);
    const subject = m => m.split('\n')[0];
    const copy = t => Object.assign({}, t);
    const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

    function gitDate(s) {
        const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)$/.exec(s);
        if (!m) return s;
        const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
        return `${DAYS[d.getUTCDay()]} ${MONTHS[+m[2] - 1]} ${+m[3]} ${m[4]}:${m[5]}:${m[6]} ${m[1]} +0000`;
    }
    function stamp(ms) {
        const d = new Date(ms), p = n => String(n).padStart(2, '0');
        return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
    }
    function sameTree(a, b) {
        const ka = Object.keys(a), kb = Object.keys(b);
        return ka.length === kb.length && ka.every(k => k in b && b[k] === a[k]);
    }
    function changes(a, b) {
        const paths = new Set(Object.keys(a).concat(Object.keys(b)));
        return [...paths].sort().filter(p => a[p] !== b[p]).map(p => ({
            path: p, status: a[p] == null ? 'A' : b[p] == null ? 'D' : 'M', a: a[p], b: b[p]
        }));
    }
    function counts(a, b) {
        const ops = DD.diffLines(DD.lines(a || ''), DD.lines(b || ''));
        return { add: ops.filter(o => o.op === '+').length, del: ops.filter(o => o.op === '-').length };
    }
    const blob = c => (c == null ? '0000000' : DD.sha256('blob ' + c).slice(0, 7));
    const match = (path, spec) => spec === '' || path === spec || path.startsWith(spec + '/');
    const matchAny = (path, specs) => !specs || !specs.length || specs.some(s => match(path, s));
    const lineClass = l => (l.startsWith('@@') ? 'c-hunk' : l[0] === '+' ? 'c-add' : l[0] === '-' ? 'c-del' : null);
    const validName = n => /^[A-Za-z0-9][\w./-]*$/.test(n) && !n.includes('..') && !n.endsWith('/') && !n.endsWith('.lock');

    class Repo {
        constructor(vfs, root, opts) {
            opts = opts || {};
            this.vfs = vfs;
            this.root = root;
            this.commits = Object.create(null);
            this.seq = 0;
            this.branches = Object.create(null);
            this.head = { branch: 'main' };
            this.index = {};
            this.reflogList = [];
            this.stashes = [];
            this.config = { 'user.name': 'Detective', 'user.email': 'detective@nightjar.lab' };
            this.remote = opts.remote || null;
            this.clock = Date.UTC(2025, 2, 15, 10, 0, 0);
            vfs.mkdirp(root).repo = this;
            vfs.write(root + '/.git/config', '[core]\n\trepositoryformatversion = 0\n\tbare = false\n' +
                (this.remote ? `[remote "origin"]\n\turl = ${this.remote}\n` : ''));
            vfs.write(root + '/.git/description', 'Unnamed repository; edit this file to name it.\n');
            this.writeHeadFile();
        }

        // ----- state helpers -----
        headHash() { return this.head.branch ? this.branches[this.head.branch] || null : this.head.detached; }
        headLabel() { return this.head.branch || short(this.head.detached) + '...'; }
        headTree() { const h = this.headHash(); return h ? copy(this.commits[h].tree) : {}; }
        tree(h) { return copy(this.commits[h].tree); }
        writeHeadFile() {
            this.vfs.write(this.root + '/.git/HEAD', this.head.branch ? `ref: refs/heads/${this.head.branch}\n` : this.head.detached + '\n');
        }
        tick() { this.clock += 7 * 60000; return stamp(this.clock); }
        reflogAdd(hash, msg) { this.reflogList.unshift({ hash, msg }); }
        moveHead(h) { if (this.head.branch) this.branches[this.head.branch] = h; else this.head.detached = h; }

        rel(sh, p) {
            const abs = sh.resolve(p);
            if (abs === this.root) return '';
            if (abs.startsWith(this.root + '/')) return abs.slice(this.root.length + 1);
            return null;
        }

        worktree() {
            const t = {};
            const dir = this.vfs.get(this.root);
            if (!dir) return t;
            this.vfs.walk(dir, (n, rel) => {
                if (!rel || n.type !== 'file' || rel === '.git' || rel.startsWith('.git/')) return;
                t[rel] = n.content;
            });
            return t;
        }

        trackedWorktree(extra) {
            const wt = this.worktree(), out = {};
            const keys = new Set(Object.keys(this.index).concat(Object.keys(extra || {})));
            for (const k of keys) if (k in wt) out[k] = wt[k];
            return out;
        }

        writeFile(path, content, mtime) { this.vfs.write(this.root + '/' + path, { content, mtime: mtime || this.vfs.now || DD.DEFAULT_TIME }); }

        removeFile(path) {
            const n = this.vfs.get(this.root + '/' + path);
            if (!n) return;
            let dir = n.parent;
            this.vfs.remove(n);
            while (dir && dir !== this.vfs.get(this.root) && Object.keys(dir.children).length === 0) {
                const up = dir.parent;
                this.vfs.remove(dir);
                dir = up;
            }
        }

        makeCommit(c) {
            const seq = ++this.seq;
            const hash = DD.sha256([seq, c.parents.join(','), c.author, c.email, c.date, c.message, JSON.stringify(c.tree)].join('\n')).slice(0, 40);
            this.commits[hash] = Object.assign({ hash, seq }, c);
            return hash;
        }

        resolve(spec) {
            if (!spec || typeof spec !== 'string') return null;
            const m = /^(.*?)((?:[~^]\d*)*)$/.exec(spec);
            const base = m[1], suf = m[2];
            let h = null, mm;
            if (base === 'HEAD' || base === '@') h = this.headHash();
            else if ((mm = /^(?:HEAD)?@\{(\d+)\}$/.exec(base))) h = (this.reflogList[+mm[1]] || {}).hash || null;
            else if (base === 'stash' || base === 'refs/stash' || (mm = /^stash@\{(\d+)\}$/.exec(base))) h = (this.stashes[mm ? +mm[1] : 0] || {}).hash || null;
            else if (this.branches[base]) h = this.branches[base];
            else if (base.startsWith('refs/heads/') && this.branches[base.slice(11)]) h = this.branches[base.slice(11)];
            else if (/^[0-9a-f]{4,40}$/i.test(base)) {
                const c = Object.keys(this.commits).filter(x => x.startsWith(base.toLowerCase()));
                if (c.length === 1) h = c[0];
            }
            if (!h) return null;
            const re = /([~^])(\d*)/g;
            let t;
            while ((t = re.exec(suf))) {
                const n = t[2] === '' ? 1 : +t[2];
                if (t[1] === '~') {
                    for (let i = 0; i < n && h; i++) h = this.commits[h].parents[0];
                } else if (n > 0) h = this.commits[h].parents[n - 1];
                if (!h) return null;
            }
            return h;
        }

        ancestors(starts) {
            const seen = new Set(), st = starts.filter(Boolean);
            while (st.length) {
                const h = st.pop();
                if (seen.has(h)) continue;
                seen.add(h);
                st.push(...this.commits[h].parents);
            }
            return seen;
        }

        decor(h) {
            const d = [];
            if (!this.head.branch && this.head.detached === h) d.push('HEAD');
            for (const b of Object.keys(this.branches).sort()) {
                if (this.branches[b] === h) d.push(this.head.branch === b ? 'HEAD -> ' + b : b);
            }
            if (this.stashes[0] && this.stashes[0].hash === h) d.push('refs/stash');
            return d.length ? [{ t: ' (' + d.join(', ') + ')', c: 'c-ref' }] : [];
        }

        // ----- builder API used by the cases -----
        commit(spec) {
            const tree = this.headTree();
            Object.assign(tree, spec.set || {});
            for (const p of spec.del || []) delete tree[p];
            const parent = this.headHash();
            const am = /^(.*?)\s*<(.+)>$/.exec(spec.author);
            const h = this.makeCommit({ tree, parents: parent ? [parent] : [], author: am[1], email: am[2], date: spec.date, message: spec.message });
            this.moveHead(h);
            this.reflogAdd(h, (parent ? 'commit: ' : 'commit (initial): ') + subject(spec.message));
            return h;
        }
        branch(name, at) { this.branches[name] = at || this.headHash(); }
        checkout(name) {
            const from = this.head.branch || short(this.headHash());
            if (!this.branches[name]) this.branches[name] = this.headHash();
            this.head = { branch: name };
            this.reflogAdd(this.headHash(), `checkout: moving from ${from} to ${name}`);
        }
        deleteBranch(name) { delete this.branches[name]; }
        stashSave(spec) {
            const tree = Object.assign(this.headTree(), spec.set || {});
            const am = /^(.*?)\s*<(.+)>$/.exec(spec.author);
            const label = `On ${this.head.branch}: ${spec.message}`;
            const h = this.makeCommit({ tree, parents: [this.headHash()], author: am[1], email: am[2], date: spec.date, message: label });
            this.stashes.unshift({ hash: h, label });
        }
        finish() {
            const t = this.headTree();
            const h = this.headHash();
            const mtime = h ? this.commits[h].date.slice(0, 16) : DD.DEFAULT_TIME;
            for (const [p, c] of Object.entries(t)) this.writeFile(p, c, mtime);
            this.index = copy(t);
            this.writeHeadFile();
        }

        // Move HEAD to commit h (on branch `name`, or detached when name is null) and update files.
        switchTo(ctx, h, name) {
            const head = this.headTree();
            const target = h ? this.tree(h) : {};
            const wt = this.worktree();
            const dirty = new Set();
            for (const c of changes(head, this.index)) dirty.add(c.path);
            for (const p of Object.keys(this.index)) if (wt[p] !== this.index[p]) dirty.add(p);
            const conflicts = [...dirty].filter(p => target[p] !== head[p]).sort();
            if (conflicts.length) {
                ctx.err('error: Your local changes to the following files would be overwritten by checkout:');
                for (const p of conflicts) ctx.err('\t' + p);
                ctx.err('Please commit your changes or stash them before you switch branches.\nAborting');
                return false;
            }
            const now = this.vfs.now || DD.DEFAULT_TIME;
            for (const p of Object.keys(head)) if (!(p in target) && !dirty.has(p)) this.removeFile(p);
            for (const [p, c] of Object.entries(target)) if (head[p] !== c || !(p in wt)) this.writeFile(p, c, now);
            const idx = copy(target);
            for (const c of changes(head, this.index)) { if (c.b == null) delete idx[c.path]; else idx[c.path] = c.b; }
            this.index = idx;
            const from = this.head.branch || short(this.headHash() || '');
            this.head = name ? { branch: name } : { detached: h };
            this.reflogAdd(h, `checkout: moving from ${from} to ${name || h}`);
            this.writeHeadFile();
            return true;
        }
    }
    DD.Repo = Repo;

    // ----- printing helpers -----
    function printCommit(repo, ctx, c, oneline) {
        if (oneline) {
            ctx.parts([{ t: short(c.hash), c: 'c-hash', run: 'git show ' + short(c.hash) }].concat(repo.decor(c.hash), [{ t: ' ' + subject(c.message) }]));
            return;
        }
        ctx.parts([{ t: 'commit ' }, { t: c.hash, c: 'c-hash', run: 'git show ' + short(c.hash) }].concat(repo.decor(c.hash)));
        ctx.out(`Author: ${c.author} <${c.email}>`);
        ctx.out(`Date:   ${gitDate(c.date)}`);
        ctx.out('');
        for (const l of c.message.split('\n')) ctx.out('    ' + l);
        ctx.out('');
    }

    function printDiff(ctx, a, b, paths) {
        for (const ch of changes(a, b)) {
            if (!matchAny(ch.path, paths)) continue;
            ctx.out(`diff --git a/${ch.path} b/${ch.path}`, 'c-bold');
            if (ch.status === 'A') ctx.out('new file mode 100644', 'c-bold');
            if (ch.status === 'D') ctx.out('deleted file mode 100644', 'c-bold');
            ctx.out(`index ${blob(ch.a)}..${blob(ch.b)}${ch.status === 'M' ? ' 100644' : ''}`, 'c-bold');
            ctx.out(ch.a == null ? '--- /dev/null' : `--- a/${ch.path}`, 'c-bold');
            ctx.out(ch.b == null ? '+++ /dev/null' : `+++ b/${ch.path}`, 'c-bold');
            for (const l of DD.unified(ch.a || '', ch.b || '')) ctx.out(l, lineClass(l));
        }
    }

    function printStat(ctx, a, b, paths) {
        const rows = changes(a, b).filter(ch => matchAny(ch.path, paths)).map(ch => Object.assign({ path: ch.path }, counts(ch.a, ch.b)));
        if (!rows.length) return;
        const w = Math.max(...rows.map(r => r.path.length));
        const nw = Math.max(...rows.map(r => String(r.add + r.del).length));
        let add = 0, del = 0;
        for (const r of rows) {
            add += r.add;
            del += r.del;
            const scale = Math.max(1, Math.ceil((r.add + r.del) / 40));
            ctx.parts([{ t: ` ${r.path.padEnd(w)} | ${String(r.add + r.del).padStart(nw)} ` }, { t: '+'.repeat(Math.ceil(r.add / scale)), c: 'c-add' }, { t: '-'.repeat(Math.ceil(r.del / scale)), c: 'c-del' }]);
        }
        ctx.out(summary(rows.length, add, del));
    }

    function summary(files, add, del) {
        let s = ` ${files} file${files === 1 ? '' : 's'} changed`;
        if (add || !del) s += `, ${plural(add, 'insertion')}(+)`;
        if (del) s += `, ${plural(del, 'deletion')}(-)`;
        return s;
    }

    // ----- subcommands -----
    const SUB = Object.create(null);

    SUB.status = function (repo, args, ctx) {
        const o = DD.getopt(args);
        const head = repo.headTree(), idx = repo.index, wt = repo.worktree();
        const staged = changes(head, idx);
        const unstaged = changes(idx, wt).filter(c => c.status !== 'A');
        const untracked = Object.keys(wt).filter(p => !(p in idx)).sort();
        if (o.s || o.short) {
            const paths = new Set(staged.map(c => c.path).concat(unstaged.map(c => c.path)));
            for (const p of [...paths].sort()) {
                const x = (staged.find(c => c.path === p) || {}).status || ' ';
                const y = (unstaged.find(c => c.path === p) || {}).status || ' ';
                ctx.parts([{ t: x, c: 'c-add' }, { t: y, c: 'c-del' }, { t: ' ' + p }]);
            }
            for (const p of untracked) ctx.parts([{ t: '??', c: 'c-del' }, { t: ' ' + p }]);
            return 0;
        }
        if (repo.head.branch) ctx.out(`On branch ${repo.head.branch}`);
        else ctx.out(`HEAD detached at ${short(repo.head.detached)}`, 'c-del');
        if (!repo.headHash()) ctx.out('\nNo commits yet');
        const label = s => (s === 'A' ? 'new file:   ' : s === 'D' ? 'deleted:    ' : 'modified:   ');
        if (staged.length) {
            ctx.out('');
            ctx.out('Changes to be committed:');
            ctx.out('  (use "git restore --staged <file>..." to unstage)', 'c-dim');
            for (const c of staged) ctx.out('\t' + label(c.status) + c.path, 'c-add');
        }
        if (unstaged.length) {
            ctx.out('');
            ctx.out('Changes not staged for commit:');
            ctx.out('  (use "git add <file>..." to update what will be committed)', 'c-dim');
            ctx.out('  (use "git restore <file>..." to discard changes in working directory)', 'c-dim');
            for (const c of unstaged) ctx.out('\t' + label(c.status) + c.path, 'c-del');
        }
        if (untracked.length) {
            ctx.out('');
            ctx.out('Untracked files:');
            ctx.out('  (use "git add <file>..." to include in what will be committed)', 'c-dim');
            for (const p of untracked) ctx.out('\t' + p, 'c-del');
        }
        ctx.out('');
        if (!staged.length && !unstaged.length && !untracked.length) ctx.out('nothing to commit, working tree clean');
        else if (!staged.length && !unstaged.length) ctx.out('nothing added to commit but untracked files present (use "git add" to track)');
        else if (!staged.length) ctx.out('no changes added to commit (use "git add" and/or "git commit -a")');
        return 0;
    };

    SUB.add = function (repo, args, ctx) {
        const o = DD.getopt(args);
        const specs = (o.A || o.all) ? ['.'] : o._.concat(o.after);
        if (!specs.length) { ctx.err("Nothing specified, nothing added.\nhint: Maybe you wanted to say 'git add .'?"); return 1; }
        const wt = repo.worktree();
        for (const spec of specs) {
            const rel = (o.A || o.all) ? '' : repo.rel(ctx.sh, spec);
            if (rel == null) { ctx.err(`fatal: ${spec}: '${spec}' is outside repository at '${repo.root}'`); return 128; }
            let hit = false;
            for (const p of new Set(Object.keys(wt).concat(Object.keys(repo.index)))) {
                if (!match(p, rel)) continue;
                hit = true;
                if (p in wt) repo.index[p] = wt[p]; else delete repo.index[p];
            }
            if (!hit) { ctx.err(`fatal: pathspec '${spec}' did not match any files`); return 128; }
        }
        return 0;
    };

    SUB.commit = function (repo, args, ctx) {
        const o = DD.getopt(args, 'm', ['message']);
        if (o.amend) { ctx.err('--amend is not available in this lab. Make a new commit instead.'); return 1; }
        if (o.missing === 'm') { ctx.err("error: switch `m' requires a value"); return 129; }
        const msg = typeof o.m === 'string' ? o.m : typeof o.message === 'string' ? o.message : null;
        if (msg == null) { ctx.err('Aborting commit: there is no editor in this lab.\nWrite the message inline: git commit -m "Describe the change"'); return 1; }
        if (!msg.trim()) { ctx.err('Aborting commit due to empty commit message.'); return 1; }
        if (o.a || o.all) {
            const wt = repo.worktree();
            for (const p of Object.keys(repo.index)) { if (p in wt) repo.index[p] = wt[p]; else delete repo.index[p]; }
        }
        const head = repo.headTree();
        if (sameTree(head, repo.index)) {
            const wt = repo.worktree();
            if (changes(repo.index, wt).some(c => c.status !== 'A')) ctx.out('no changes added to commit (use "git add" and/or "git commit -a")');
            else if (Object.keys(wt).some(p => !(p in repo.index))) ctx.out('nothing added to commit but untracked files present (use "git add" to track)');
            else ctx.out('nothing to commit, working tree clean');
            return 1;
        }
        const parent = repo.headHash();
        const h = repo.makeCommit({
            tree: copy(repo.index), parents: parent ? [parent] : [], author: repo.config['user.name'],
            email: repo.config['user.email'], date: repo.tick(), message: msg.trim()
        });
        repo.moveHead(h);
        repo.reflogAdd(h, (parent ? 'commit: ' : 'commit (initial): ') + subject(msg.trim()));
        const ch = changes(head, repo.index);
        let add = 0, del = 0;
        for (const c of ch) { const k = counts(c.a, c.b); add += k.add; del += k.del; }
        ctx.parts([{ t: `[${repo.head.branch || 'detached HEAD'}${parent ? '' : ' (root-commit)'} ` }, { t: short(h), c: 'c-hash' }, { t: `] ${subject(msg.trim())}` }]);
        ctx.out(summary(ch.length, add, del));
        for (const c of ch) if (c.status !== 'M') ctx.out(` ${c.status === 'A' ? 'create' : 'delete'} mode 100644 ${c.path}`);
        return 0;
    };

    SUB.log = function (repo, args, ctx) {
        const o = DD.getopt(args, 'nS', ['author', 'grep']);
        const limit = o.n != null ? parseInt(o.n, 10) : Infinity;
        const paths = o.after.map(p => repo.rel(ctx.sh, p)).filter(p => p != null);
        const include = [], exclude = [];
        for (const r of o._) {
            if (r.includes('..')) {
                const [a, b] = r.split('..');
                const ha = repo.resolve(a || 'HEAD'), hb = repo.resolve(b || 'HEAD');
                if (!ha || !hb) { ctx.err(`fatal: ambiguous argument '${r}': unknown revision`); return 128; }
                exclude.push(ha);
                include.push(hb);
                continue;
            }
            const h = repo.resolve(r);
            if (h) { include.push(h); continue; }
            const rel = repo.rel(ctx.sh, r);
            if (rel != null && ctx.sh.node(r)) { paths.push(rel); continue; }
            ctx.err(`fatal: ambiguous argument '${r}': unknown revision or path not in the working tree.`);
            return 128;
        }
        if (o.all) {
            include.push(repo.headHash(), ...Object.values(repo.branches));
            if (repo.stashes[0]) include.push(repo.stashes[0].hash);
        }
        if (!include.length) include.push(repo.headHash());
        if (!include.some(Boolean)) { ctx.err(`fatal: your current branch '${repo.head.branch}' does not have any commits yet`); return 128; }
        const skip = repo.ancestors(exclude);
        let list = [...repo.ancestors(include)].filter(h => !skip.has(h)).map(h => repo.commits[h]).sort((a, b) => b.seq - a.seq);
        if (o.author) { const a = String(o.author).toLowerCase(); list = list.filter(c => (c.author + ' <' + c.email + '>').toLowerCase().includes(a)); }
        if (o.grep) {
            let re;
            try { re = new RegExp(o.grep, o.i ? 'i' : ''); } catch (e) { re = new RegExp(DD.escapeRe(o.grep), o.i ? 'i' : ''); }
            list = list.filter(c => re.test(c.message));
        }
        if (o.S) {
            const needle = String(o.S);
            const countIn = t => Object.values(t).reduce((s, v) => s + v.split(needle).length - 1, 0);
            list = list.filter(c => countIn(c.tree) !== countIn(c.parents[0] ? repo.commits[c.parents[0]].tree : {}));
        }
        if (paths.length) list = list.filter(c => changes(c.parents[0] ? repo.commits[c.parents[0]].tree : {}, c.tree).some(ch => matchAny(ch.path, paths)));
        if (o.reverse) list.reverse();
        list = list.slice(0, limit);
        const oneline = o.oneline || o.graph;
        list.forEach((c, i) => {
            if (o.graph) ctx.parts([{ t: '* ', c: 'c-ref' }].concat(lineOf(repo, c)));
            else printCommit(repo, ctx, c, oneline);
            const pt = c.parents[0] ? repo.commits[c.parents[0]].tree : {};
            if (o.stat) { printStat(ctx, pt, c.tree, paths); if (i < list.length - 1) ctx.out(''); }
            else if (o.p || o.patch) { printDiff(ctx, pt, c.tree, paths); if (i < list.length - 1) ctx.out(''); }
            else if (o['name-only']) { for (const ch of changes(pt, c.tree)) if (matchAny(ch.path, paths)) ctx.out(ch.path, 'c-file'); if (i < list.length - 1) ctx.out(''); }
        });
        while (ctx.lines.length && ctx.lines[ctx.lines.length - 1].parts.every(p => p.t === '')) ctx.lines.pop();
        return 0;
    };
    const lineOf = (repo, c) => [{ t: short(c.hash), c: 'c-hash', run: 'git show ' + short(c.hash) }].concat(repo.decor(c.hash), [{ t: ' ' + subject(c.message) }]);

    SUB.show = function (repo, args, ctx) {
        const o = DD.getopt(args);
        const spec = o._[0] || 'HEAD';
        const colon = spec.indexOf(':');
        if (colon >= 0) {
            const ref = spec.slice(0, colon) || 'HEAD';
            let path = spec.slice(colon + 1).replace(/^\.\//, '').replace(/\/+$/, '');
            const h = repo.resolve(ref);
            if (!h) { ctx.err(`fatal: invalid object name '${ref}'.`); return 128; }
            const t = repo.commits[h].tree;
            if (t[path] != null) { for (const l of DD.lines(t[path])) ctx.out(l); return 0; }
            const kids = new Set(Object.keys(t).filter(p => match(p, path) && p !== path).map(p => p.slice(path ? path.length + 1 : 0).split('/')[0] + (p.slice(path ? path.length + 1 : 0).includes('/') ? '/' : '')));
            if (kids.size) { ctx.out(`tree ${spec}`, 'c-bold'); ctx.out(''); for (const k of [...kids].sort()) ctx.out(k); return 0; }
            ctx.err(`fatal: path '${path}' does not exist in '${ref}'`);
            return 128;
        }
        const h = repo.resolve(spec);
        if (!h) { ctx.err(`fatal: ambiguous argument '${spec}': unknown revision or path not in the working tree.`); return 128; }
        const c = repo.commits[h];
        printCommit(repo, ctx, c, o.oneline);
        const pt = c.parents[0] ? repo.commits[c.parents[0]].tree : {};
        const paths = o.after.map(p => repo.rel(ctx.sh, p)).filter(p => p != null);
        if (o.stat) printStat(ctx, pt, c.tree, paths);
        else if (o['name-only']) { for (const ch of changes(pt, c.tree)) ctx.out(ch.path, 'c-file'); }
        else printDiff(ctx, pt, c.tree, paths);
        return 0;
    };

    SUB.diff = function (repo, args, ctx) {
        const o = DD.getopt(args);
        const paths = o.after.map(p => repo.rel(ctx.sh, p)).filter(p => p != null);
        const revs = [];
        for (const x of o._) {
            if (x.includes('..')) { const [l, r] = x.split('..'); revs.push(l || 'HEAD', r || 'HEAD'); continue; }
            revs.push(x);
        }
        const hashes = [];
        for (const r of revs) {
            const h = repo.resolve(r);
            if (h) { hashes.push(h); continue; }
            const rel = repo.rel(ctx.sh, r);
            if (rel != null && ctx.sh.node(r)) { paths.push(rel); continue; }
            ctx.err(`fatal: ambiguous argument '${r}': unknown revision or path not in the working tree.`);
            return 128;
        }
        let a, b;
        if (o.staged || o.cached) { a = hashes[0] ? repo.tree(hashes[0]) : repo.headTree(); b = repo.index; }
        else if (!hashes.length) { a = repo.index; b = repo.trackedWorktree(); }
        else if (hashes.length === 1) { a = repo.tree(hashes[0]); b = repo.trackedWorktree(a); }
        else { a = repo.tree(hashes[0]); b = repo.tree(hashes[1]); }
        if (o.stat) printStat(ctx, a, b, paths);
        else if (o['name-only']) { for (const ch of changes(a, b)) if (matchAny(ch.path, paths)) ctx.out(ch.path, 'c-file'); }
        else printDiff(ctx, a, b, paths);
        return 0;
    };

    SUB.branch = function (repo, args, ctx) {
        const o = DD.getopt(args, '', ['contains']);
        if (o.d || o.D || o.delete) {
            for (const name of o._) {
                if (!repo.branches[name]) { ctx.err(`error: branch '${name}' not found.`); return 1; }
                if (repo.head.branch === name) { ctx.err(`error: Cannot delete branch '${name}' checked out at '${repo.root}'`); return 1; }
                if (o.d && !repo.ancestors([repo.headHash()]).has(repo.branches[name])) {
                    ctx.err(`error: The branch '${name}' is not fully merged.\nIf you are sure you want to delete it, run 'git branch -D ${name}'.`);
                    return 1;
                }
                const was = repo.branches[name];
                delete repo.branches[name];
                ctx.out(`Deleted branch ${name} (was ${short(was)}).`);
            }
            return 0;
        }
        if (o.m || o.M) {
            const [from, to] = o._.length >= 2 ? o._ : [repo.head.branch, o._[0]];
            if (!repo.branches[from]) { ctx.err(`error: refname refs/heads/${from} not found`); return 1; }
            if (!to || !validName(to)) { ctx.err(`fatal: '${to}' is not a valid branch name`); return 128; }
            repo.branches[to] = repo.branches[from];
            delete repo.branches[from];
            if (repo.head.branch === from) { repo.head.branch = to; repo.writeHeadFile(); }
            return 0;
        }
        if (o.contains) {
            const h = repo.resolve(o.contains === true ? o._[0] : o.contains);
            if (!h) { ctx.err('error: malformed object name'); return 129; }
            for (const b of Object.keys(repo.branches).sort()) {
                if (repo.ancestors([repo.branches[b]]).has(h)) ctx.out((repo.head.branch === b ? '* ' : '  ') + b, repo.head.branch === b ? 'c-add' : null);
            }
            return 0;
        }
        if (o._.length && !o.a && !o.v && !o.list) {
            const name = o._[0];
            if (!validName(name)) { ctx.err(`fatal: '${name}' is not a valid branch name`); return 128; }
            if (repo.branches[name]) { ctx.err(`fatal: a branch named '${name}' already exists`); return 128; }
            const h = o._[1] ? repo.resolve(o._[1]) : repo.headHash();
            if (!h) { ctx.err(o._[1] ? `fatal: not a valid object name: '${o._[1]}'` : 'fatal: no commits yet, so there is nothing to branch from'); return 128; }
            repo.branches[name] = h;
            return 0;
        }
        if (!repo.head.branch) ctx.out(`* (HEAD detached at ${short(repo.head.detached)})`, 'c-del');
        for (const b of Object.keys(repo.branches).sort()) {
            const cur = repo.head.branch === b;
            const parts = [{ t: cur ? '* ' : '  ' }, { t: b, c: cur ? 'c-add' : null, run: cur ? null : 'git switch ' + b }];
            if (o.v) { const c = repo.commits[repo.branches[b]]; parts.push({ t: ' ' }, { t: short(c.hash), c: 'c-hash' }, { t: ' ' + subject(c.message) }); }
            ctx.parts(parts);
        }
        if (o.a && repo.remote) for (const b of Object.keys(repo.branches).filter(b => b === 'main').sort()) ctx.out('  remotes/origin/' + b, 'c-del');
        return 0;
    };

    function createAndSwitch(repo, ctx, name, start) {
        if (!validName(name)) { ctx.err(`fatal: '${name}' is not a valid branch name`); return 128; }
        if (repo.branches[name]) { ctx.err(`fatal: a branch named '${name}' already exists`); return 128; }
        const h = start ? repo.resolve(start) : repo.headHash();
        if (start && !h) { ctx.err(`fatal: '${start}' is not a commit and a branch '${name}' cannot be created from it`); return 128; }
        if (!h) { repo.head = { branch: name }; repo.writeHeadFile(); ctx.out(`Switched to a new branch '${name}'`); return 0; }
        repo.branches[name] = h;
        const prev = repo.head;
        if (!repo.switchTo(ctx, h, name)) { delete repo.branches[name]; repo.head = prev; return 1; }
        ctx.out(`Switched to a new branch '${name}'`);
        return 0;
    }

    function previousBranch(repo) {
        for (const e of repo.reflogList) {
            const m = /^checkout: moving from (\S+) to /.exec(e.msg);
            if (m) return m[1];
        }
        return null;
    }

    function toBranch(repo, ctx, name) {
        if (repo.head.branch === name) { ctx.out(`Already on '${name}'`); return 0; }
        if (!repo.switchTo(ctx, repo.branches[name], name)) return 1;
        ctx.out(`Switched to branch '${name}'`);
        return 0;
    }

    function detach(repo, ctx, h, spec) {
        if (!repo.switchTo(ctx, h, null)) return 1;
        ctx.out(`Note: switching to '${spec}'.`);
        ctx.out('');
        ctx.out("You are in 'detached HEAD' state. You can look around and make experimental", 'c-dim');
        ctx.out('commits. To keep work made here, create a branch: git switch -c <new-branch-name>', 'c-dim');
        ctx.out('');
        ctx.out(`HEAD is now at ${short(h)} ${subject(repo.commits[h].message)}`);
        return 0;
    }

    function restorePaths(repo, ctx, specs, source, toIndex, toWorktree) {
        const wt = repo.worktree();
        let n = 0;
        for (const spec of specs) {
            const rel = repo.rel(ctx.sh, spec);
            const pool = new Set(Object.keys(repo.index).concat(Object.keys(source), Object.keys(wt).filter(p => p in repo.index)));
            const hits = [...pool].filter(p => rel != null && match(p, rel));
            if (!hits.length) { ctx.err(`error: pathspec '${spec}' did not match any file(s) known to git`); return 1; }
            for (const p of hits) {
                if (toIndex) { if (source[p] == null) delete repo.index[p]; else repo.index[p] = source[p]; }
                if (toWorktree) {
                    const v = toIndex ? source[p] : (source === repo.index ? repo.index[p] : source[p]);
                    if (v == null) repo.removeFile(p); else repo.writeFile(p, v, repo.vfs.now);
                }
                n++;
            }
        }
        return n;
    }

    SUB.checkout = function (repo, args, ctx) {
        const o = DD.getopt(args, 'bB');
        if (o.b || o.B) return createAndSwitch(repo, ctx, o.b || o.B, o._[0]);
        if (o.dashdash) {
            const ref = o._[0];
            const h = ref ? repo.resolve(ref) : null;
            if (ref && !h) { ctx.err(`fatal: invalid reference: ${ref}`); return 128; }
            const n = restorePaths(repo, ctx, o.after, h ? repo.tree(h) : repo.index, !!h, true);
            if (ctx.errs.length) return 1;
            ctx.out(`Updated ${plural(n, 'path')} from ${h ? short(h) : 'the index'}`);
            return 0;
        }
        let target = o._[0];
        if (!target) { ctx.err('error: you must name a branch or commit, for example: git checkout main'); return 1; }
        if (target === '-') { target = previousBranch(repo); if (!target) { ctx.err('error: there is no previous branch'); return 1; } }
        if (repo.branches[target]) return toBranch(repo, ctx, target);
        const h = repo.resolve(target);
        if (h) return detach(repo, ctx, h, target);
        if (ctx.sh.node(target) && repo.rel(ctx.sh, target) != null) {
            const n = restorePaths(repo, ctx, [target], repo.index, false, true);
            if (ctx.errs.length) return 1;
            ctx.out(`Updated ${plural(n, 'path')} from the index`);
            return 0;
        }
        ctx.err(`error: pathspec '${target}' did not match any file(s) known to git`);
        const guess = DD.closest(target, Object.keys(repo.branches), 3);
        if (guess) ctx.lines.push({ parts: [{ t: 'Did you mean the branch ' }, { t: guess, c: 'c-link', run: 'git checkout ' + guess }, { t: '?' }] });
        return 1;
    };

    SUB.switch = function (repo, args, ctx) {
        const o = DD.getopt(args, 'cC');
        if (o.c || o.C) return createAndSwitch(repo, ctx, o.c || o.C, o._[0]);
        let target = o._[0];
        if (!target) { ctx.err('fatal: missing branch name; try git switch <branch> or git switch -c <new-branch>'); return 128; }
        if (o.detach || o.d) {
            const h = repo.resolve(target);
            if (!h) { ctx.err(`fatal: invalid reference: ${target}`); return 128; }
            return detach(repo, ctx, h, target);
        }
        if (target === '-') { target = previousBranch(repo); if (!target) { ctx.err('fatal: there is no previous branch'); return 128; } }
        if (repo.branches[target]) return toBranch(repo, ctx, target);
        if (repo.resolve(target)) {
            ctx.err(`fatal: a branch is expected, got commit '${target}'\nhint: To look at that commit, run git switch --detach ${target}\nhint: To keep it, create a branch there: git switch -c <name> ${target}`);
            return 128;
        }
        ctx.err(`fatal: invalid reference: ${target}`);
        const guess = DD.closest(target, Object.keys(repo.branches), 3);
        if (guess) ctx.lines.push({ parts: [{ t: 'Did you mean ' }, { t: guess, c: 'c-link', run: 'git switch ' + guess }, { t: '?' }] });
        return 128;
    };

    SUB.restore = function (repo, args, ctx) {
        const o = DD.getopt(args, 's', ['source']);
        const specs = o._.concat(o.after);
        if (!specs.length) { ctx.err('fatal: you must specify path(s) to restore'); return 128; }
        const srcSpec = o.s || o.source;
        let source = null;
        if (srcSpec) {
            const h = repo.resolve(srcSpec);
            if (!h) { ctx.err(`fatal: could not resolve ${srcSpec}`); return 128; }
            source = repo.tree(h);
        }
        const staged = o.staged || o.S;
        const toWt = o.worktree || o.W || !staged;
        if (staged) { const n = restorePaths(repo, ctx, specs, source || repo.headTree(), true, false); if (ctx.errs.length) return 1; void n; }
        if (toWt) { restorePaths(repo, ctx, specs, source || repo.index, false, true); if (ctx.errs.length) return 1; }
        return 0;
    };

    SUB.reset = function (repo, args, ctx) {
        const o = DD.getopt(args);
        if (o.hard || o.soft || o.mixed) {
            const spec = o._[0] || 'HEAD';
            const h = repo.resolve(spec);
            if (!h) { ctx.err(`fatal: ambiguous argument '${spec}': unknown revision`); return 128; }
            const old = repo.headTree();
            repo.moveHead(h);
            repo.reflogAdd(h, `reset: moving to ${spec}`);
            const t = repo.tree(h);
            if (!o.soft) repo.index = copy(t);
            if (o.hard) {
                for (const p of Object.keys(old)) if (!(p in t)) repo.removeFile(p);
                for (const [p, c] of Object.entries(t)) repo.writeFile(p, c, repo.vfs.now);
                ctx.out(`HEAD is now at ${short(h)} ${subject(repo.commits[h].message)}`);
            }
            return 0;
        }
        const specs = o._.concat(o.after);
        const head = repo.headTree();
        if (!specs.length) { repo.index = copy(head); return 0; }
        for (const s of specs) {
            const rel = repo.rel(ctx.sh, s);
            for (const p of new Set(Object.keys(repo.index).concat(Object.keys(head)))) {
                if (rel == null || !match(p, rel)) continue;
                if (head[p] == null) delete repo.index[p]; else repo.index[p] = head[p];
            }
        }
        return 0;
    };

    SUB.reflog = function (repo, args, ctx) {
        if (!repo.reflogList.length) { ctx.err("fatal: your current branch has no history yet"); return 128; }
        repo.reflogList.forEach((e, i) => {
            ctx.parts([{ t: short(e.hash), c: 'c-hash', run: 'git show ' + short(e.hash) }].concat(repo.decor(e.hash), [{ t: ` HEAD@{${i}}: ${e.msg}` }]));
        });
        return 0;
    };

    SUB.blame = function (repo, args, ctx) {
        const o = DD.getopt(args, 'L');
        let file = o.after[0] || o._[o._.length - 1];
        const ref = o.after.length ? o._[0] : (o._.length > 1 ? o._[0] : null);
        if (!file) { ctx.err('usage: git blame [-L start,end] <file>'); return 129; }
        const start = ref ? repo.resolve(ref) : repo.headHash();
        if (!start) { ctx.err(`fatal: no such ref: ${ref || 'HEAD'}`); return 128; }
        const rel = repo.rel(ctx.sh, file);
        const content = rel != null ? repo.commits[start].tree[rel] : null;
        if (content == null) { ctx.err(`fatal: no such path '${file}' in ${ref || 'HEAD'}`); return 128; }
        const finalLines = DD.lines(content);
        const owner = new Array(finalLines.length).fill(null);
        const map = finalLines.map((_, i) => i);
        let cur = start, curLines = finalLines;
        while (cur) {
            const p = repo.commits[cur].parents[0];
            const pc = p ? repo.commits[p].tree[rel] : null;
            if (pc == null) { for (let i = 0; i < owner.length; i++) if (!owner[i]) owner[i] = cur; break; }
            const pLines = DD.lines(pc);
            const toParent = new Map();
            for (const op of DD.diffLines(pLines, curLines)) if (op.op === ' ') toParent.set(op.bi, op.ai);
            for (let i = 0; i < owner.length; i++) {
                if (owner[i]) continue;
                if (toParent.has(map[i])) map[i] = toParent.get(map[i]); else owner[i] = cur;
            }
            if (owner.every(Boolean)) break;
            cur = p;
            curLines = pLines;
        }
        let from = 1, to = finalLines.length;
        if (o.L) { const m = /^(\d+),(\d+)$/.exec(o.L); if (m) { from = +m[1]; to = Math.min(+m[2], to); } }
        const aw = Math.max(...owner.map(h => repo.commits[h].author.length));
        const nw = String(finalLines.length).length;
        for (let i = from - 1; i < to; i++) {
            const c = repo.commits[owner[i]];
            const root = !c.parents.length;
            ctx.parts([
                { t: root ? '^' + c.hash.slice(0, 7) : c.hash.slice(0, 8), c: 'c-hash', run: 'git show ' + short(c.hash) },
                { t: ` (${c.author.padEnd(aw)} ${c.date} +0000 ${String(i + 1).padStart(nw)}) `, c: 'c-dim' },
                { t: finalLines[i] }
            ]);
        }
        return 0;
    };

    SUB.stash = function (repo, args, ctx) {
        const sub = args[0] && !args[0].startsWith('-') ? args[0] : 'push';
        const rest = args[0] && !args[0].startsWith('-') ? args.slice(1) : args;
        const pick = spec => {
            const m = /^(?:stash@\{)?(\d+)\}?$/.exec(spec || '0');
            const n = m ? +m[1] : -1;
            return repo.stashes[n] ? n : -1;
        };
        if (sub === 'list') {
            repo.stashes.forEach((s, i) => ctx.parts([{ t: `stash@{${i}}`, c: 'c-ref', run: `git stash show -p stash@{${i}}` }, { t: ': ' + s.label }]));
            return 0;
        }
        if (sub === 'show' || sub === 'apply' || sub === 'pop' || sub === 'drop') {
            const o = DD.getopt(rest);
            if (!repo.stashes.length) { ctx.err('error: No stash entries found.'); return 1; }
            const n = pick(o._[0]);
            if (n < 0) { ctx.err(`error: ${o._[0]} is not a valid reference`); return 1; }
            const c = repo.commits[repo.stashes[n].hash];
            const base = repo.commits[c.parents[0]].tree;
            if (sub === 'show') { if (o.p || o.patch) printDiff(ctx, base, c.tree); else printStat(ctx, base, c.tree); return 0; }
            if (sub !== 'drop') {
                for (const ch of changes(base, c.tree)) { if (ch.b == null) repo.removeFile(ch.path); else repo.writeFile(ch.path, ch.b, repo.vfs.now); }
                SUB.status(repo, [], ctx);
            }
            if (sub !== 'apply') { const [s] = repo.stashes.splice(n, 1); ctx.out(`Dropped stash@{${n}} (${s.hash})`); }
            return 0;
        }
        if (sub === 'clear') { repo.stashes.length = 0; return 0; }
        if (sub === 'push' || sub === 'save') {
            const o = DD.getopt(rest, 'm');
            const head = repo.headTree();
            if (!repo.headHash()) { ctx.err('You do not have the initial commit yet'); return 1; }
            const wt = repo.worktree();
            const tree = {};
            for (const p of new Set(Object.keys(head).concat(Object.keys(repo.index)))) if (p in wt) tree[p] = wt[p];
            if (sameTree(tree, head) && sameTree(repo.index, head)) { ctx.out('No local changes to save'); return 0; }
            const hc = repo.commits[repo.headHash()];
            const label = typeof o.m === 'string' ? `On ${repo.headLabel()}: ${o.m}` : `WIP on ${repo.headLabel()}: ${short(hc.hash)} ${subject(hc.message)}`;
            const h = repo.makeCommit({ tree, parents: [hc.hash], author: repo.config['user.name'], email: repo.config['user.email'], date: repo.tick(), message: label });
            repo.stashes.unshift({ hash: h, label });
            for (const p of Object.keys(tree)) if (!(p in head)) repo.removeFile(p);
            for (const [p, c] of Object.entries(head)) repo.writeFile(p, c, repo.vfs.now);
            repo.index = head;
            ctx.out(`Saved working directory and index state ${label}`);
            return 0;
        }
        ctx.err(`error: unknown subcommand: ${sub}\nusage: git stash [push | list | show [-p] | apply | pop | drop]`);
        return 129;
    };

    SUB.grep = function (repo, args, ctx) {
        const o = DD.getopt(args);
        const pattern = o._.shift();
        if (pattern == null) { ctx.err('usage: git grep [-n] [-i] [-c] <pattern> [<commit>]'); return 129; }
        let re;
        try { re = new RegExp(pattern, o.i ? 'i' : ''); } catch (e) { re = new RegExp(DD.escapeRe(pattern), o.i ? 'i' : ''); }
        const ref = o._[0];
        const h = ref ? repo.resolve(ref) : null;
        if (ref && !h) { ctx.err(`fatal: unable to resolve revision: ${ref}`); return 128; }
        const tree = h ? repo.tree(h) : repo.trackedWorktree();
        let any = false;
        for (const p of Object.keys(tree).sort()) {
            let count = 0;
            DD.lines(tree[p]).forEach((l, i) => {
                if (!re.test(l)) return;
                count++;
                any = true;
                if (o.c || o.l) return;
                const pre = [];
                if (ref) pre.push({ t: ref + ':', c: 'c-hash' });
                pre.push({ t: p, c: 'c-file' }, { t: ':', c: 'c-dim' });
                if (o.n) pre.push({ t: String(i + 1), c: 'c-num' }, { t: ':', c: 'c-dim' });
                ctx.parts(pre.concat([{ t: l }]));
            });
            if (o.c && count) ctx.out(`${p}:${count}`);
            if (o.l && count) ctx.out(p, 'c-file');
        }
        return any ? 0 : 1;
    };

    SUB.config = function (repo, args, ctx) {
        const o = DD.getopt(args);
        if (o.list || o.l) { for (const [k, v] of Object.entries(repo.config)) ctx.out(`${k}=${v}`); return 0; }
        const [key, value] = o._;
        if (!key) { ctx.err('usage: git config <key> [<value>]\nexample: git config user.name "Your Name"'); return 129; }
        if (value != null) { repo.config[key] = value; return 0; }
        if (repo.config[key] == null) return 1;
        ctx.out(repo.config[key]);
        return 0;
    };

    SUB['rev-parse'] = function (repo, args, ctx) {
        const o = DD.getopt(args);
        for (const r of o._) {
            const h = repo.resolve(r);
            if (!h) { ctx.err(`fatal: ambiguous argument '${r}': unknown revision`); return 128; }
            ctx.out(o.short ? short(h) : h);
        }
        return 0;
    };

    SUB['ls-files'] = function (repo, args, ctx) { for (const p of Object.keys(repo.index).sort()) ctx.out(p); return 0; };

    SUB.remote = function (repo, args, ctx) {
        if (!repo.remote) return 0;
        if (args.includes('-v')) { ctx.out(`origin\t${repo.remote} (fetch)`); ctx.out(`origin\t${repo.remote} (push)`); }
        else ctx.out('origin');
        return 0;
    };

    for (const net of ['push', 'pull', 'fetch', 'clone']) {
        SUB[net] = (repo, args, ctx) => { ctx.err(`fatal: unable to access the remote: this evidence machine is offline, so git ${net} cannot reach a server.`); return 128; };
    }
    for (const later of ['merge', 'rebase', 'cherry-pick', 'tag', 'revert']) {
        SUB[later] = (repo, args, ctx) => { ctx.err(`git ${later} is not part of this lab yet. The cases only need: ${Object.keys(GIT_MAN).join(', ')}`); return 1; };
    }

    // ----- manual -----
    const GIT_MAN = {
        status: ['git status [-s]', 'Show the current branch, what is staged for the next commit, what changed but is not staged, and untracked files.', ['git status', 'git status -s']],
        log: ['git log [--oneline] [--all] [-p] [--stat] [-n N] [--author=NAME] [--grep=TEXT] [-S TEXT] [REV] [-- PATH]', 'List commits, newest first.\n  --oneline      one commit per line\n  --all          include every branch, not just the current one\n  -p             show the change each commit made\n  -S TEXT        only commits that added or removed TEXT\n  --author=NAME  only commits by that author\n  --grep=TEXT    only commits whose message matches', ['git log --oneline', 'git log -p config.py', 'git log -S API_KEY --oneline', 'git log --author=Quinn']],
        show: ['git show [REV] | git show REV:PATH', 'Show one commit with its change. REV:PATH prints a file as it was in that commit.', ['git show', 'git show HEAD~2', 'git show a1b2c3d:config.py']],
        diff: ['git diff [--staged] [REV [REV]] [-- PATH]', 'Show changes. With no argument: what you changed but did not stage. --staged: what the next commit will contain. Two revisions: the change between them.', ['git diff', 'git diff --staged', 'git diff main feature', 'git diff HEAD~3 HEAD -- config.py']],
        add: ['git add PATH... | git add .', 'Stage changes so the next commit includes them.', ['git add report.txt', 'git add .']],
        commit: ['git commit -m MESSAGE [-a]', 'Record the staged changes as a new commit. -a stages changes to tracked files first.', ['git commit -m "Add report"']],
        branch: ['git branch [-v] [NAME [START]] [-d|-D NAME] [-m OLD NEW] [--contains REV]', 'List, create, rename or delete branches. A branch is a movable name that points at one commit.', ['git branch', 'git branch -v', 'git branch rescue a1b2c3d', 'git branch -d old-work']],
        switch: ['git switch BRANCH | git switch -c NEW [START] | git switch --detach REV', 'Move to another branch. -c creates the branch first.', ['git switch main', 'git switch -c report', 'git switch -']],
        checkout: ['git checkout BRANCH | git checkout -b NEW [START] | git checkout REV -- PATH', 'The older all-in-one command: switch branches, or restore files from a commit.', ['git checkout main', 'git checkout -b fix', 'git checkout HEAD~1 -- config.py']],
        restore: ['git restore [--staged] [--source=REV] PATH', 'Undo changes to files. --staged unstages. --source takes the file from a commit.', ['git restore notes.txt', 'git restore --staged notes.txt', 'git restore --source=HEAD~2 config.py']],
        reset: ['git reset [PATH] | git reset --hard [REV]', 'Unstage files, or move the current branch. --hard also discards changes to files (no undo, except through the reflog).', ['git reset report.txt', 'git reset --hard HEAD~1']],
        reflog: ['git reflog', 'Every position HEAD has had, newest first, including commits on branches that were deleted. This is how lost work is found.', ['git reflog', 'git show HEAD@{2}']],
        blame: ['git blame [-L START,END] FILE', 'For every line of a file, show the commit and author that last changed it.', ['git blame config/settings.ini', 'git blame -L 5,8 app.py']],
        stash: ['git stash [push [-m MSG] | list | show [-p] [stash@{N}] | apply | pop | drop]', 'Set unfinished changes aside, and bring them back later.', ['git stash list', 'git stash show -p stash@{0}', 'git stash pop']],
        grep: ['git grep [-n] [-i] PATTERN [REV]', 'Search tracked files, or the files of one commit.', ['git grep -n password', 'git grep TODO HEAD~3']],
        config: ['git config KEY [VALUE]', 'Read or set a setting. Your name and email go into every commit you make.', ['git config user.name "Ada Detective"', 'git config user.name']],
        init: ['git init', 'Create a new repository in the current folder.', ['git init']]
    };

    const GROUPS = [
        ['Look at history and state', ['status', 'log', 'show', 'diff', 'blame', 'reflog', 'grep']],
        ['Record changes', ['add', 'commit', 'restore', 'reset', 'stash']],
        ['Branches', ['branch', 'switch', 'checkout']],
        ['Setup', ['init', 'config']]
    ];

    function gitHelp(args, ctx) {
        const sub = args[0];
        if (sub && GIT_MAN[sub]) {
            const [usage, desc, ex] = GIT_MAN[sub];
            ctx.out('NAME', 'c-head');
            ctx.out('    git ' + sub);
            ctx.out('USAGE', 'c-head');
            ctx.out('    ' + usage);
            ctx.out('DESCRIPTION', 'c-head');
            for (const l of desc.split('\n')) ctx.out('    ' + l);
            ctx.out('EXAMPLES', 'c-head');
            for (const e of ex) ctx.parts([{ t: '    ' }, { t: e, c: 'c-link', insert: e }]);
            return 0;
        }
        ctx.out('usage: git <command> [<args>]');
        ctx.out('');
        for (const [title, list] of GROUPS) {
            const parts = [{ t: title.padEnd(27), c: 'c-head' }];
            list.forEach((s, i) => { if (i) parts.push({ t: ' ' }); parts.push({ t: s, c: 'c-link', run: 'git help ' + s }); });
            ctx.parts(parts);
        }
        ctx.out('');
        ctx.out('Click a command, or type git help <command>.', 'c-dim');
        return 0;
    }

    DD.register('git', {
        group: 'Git',
        fn(args, ctx) {
            const sub = args[0];
            if (!sub || sub === 'help' || sub === '--help' || sub === '-h') return gitHelp(args.slice(1), ctx);
            if (args[1] === '--help' || args[1] === '-h') return gitHelp([sub], ctx);
            if (sub === '--version' || sub === 'version') { ctx.out('git version 2.47.0 (Digital Detective lab)'); return 0; }
            const sh = ctx.sh;
            if (sub === 'init') {
                const existing = sh.repoAt(sh.cwd);
                if (existing && existing.root === sh.cwd) { ctx.out(`Reinitialized existing Git repository in ${sh.cwd}/.git/`); return 0; }
                if (!sh.canWrite(sh.cwd)) { ctx.err(`fatal: cannot mkdir ${sh.cwd}/.git: Permission denied`); return 128; }
                const r = new Repo(sh.vfs, sh.cwd);
                r.vfs.now = sh.vfs.now;
                ctx.out(`Initialized empty Git repository in ${sh.cwd}/.git/`);
                return 0;
            }
            const fn = SUB[sub];
            if (!fn) {
                ctx.err(`git: '${sub}' is not a git command. See 'git help'.`);
                const guess = DD.closest(sub, Object.keys(GIT_MAN), 2);
                if (guess) ctx.lines.push({ parts: [{ t: 'The most similar command is ' }, { t: 'git ' + guess, c: 'c-link', run: ['git', guess].concat(args.slice(1)).map(DD.quoteArg).join(' ') }] });
                return 1;
            }
            const repo = sh.repoAt(sh.cwd);
            if (!repo) {
                ctx.err('fatal: not a git repository (or any of the parent directories): .git');
                ctx.out('Tip: cd into a folder that holds a repository first. ls -a shows the hidden .git folder.', 'c-dim');
                return 128;
            }
            repo.vfs.now = sh.game.now();
            return fn(repo, args.slice(1), ctx);
        }
    });
})(window.DD);
