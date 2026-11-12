'use strict';
// Shell: tokenizer, pipes, redirection, globbing and the Unix commands the cases teach.
(function (DD) {
    const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    DD.escapeRe = escapeRe;

    DD.levenshtein = function (a, b) {
        const row = Array.from({ length: b.length + 1 }, (_, j) => j);
        for (let i = 1; i <= a.length; i++) {
            let prev = row[0];
            row[0] = i;
            for (let j = 1; j <= b.length; j++) {
                const tmp = row[j];
                row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
                prev = tmp;
            }
        }
        return row[b.length];
    };

    DD.closest = function (word, list, max) {
        let best = null, bestD = (max == null ? 2 : max) + 1;
        for (const w of list) {
            const d = DD.levenshtein(word, w);
            if (d < bestD) { best = w; bestD = d; }
        }
        return best;
    };

    // Short and long option parser. `valued` lists short flags that take a value.
    DD.getopt = function (args, valued, longValued) {
        valued = valued || '';
        longValued = longValued || [];
        const o = { _: [], after: [] };
        let stop = false;
        for (let i = 0; i < args.length; i++) {
            const a = args[i];
            if (stop) { o.after.push(a); continue; }
            if (a === '--') { stop = true; o.dashdash = true; continue; }
            if (a === '-' || !a.startsWith('-') || a.length === 1) { o._.push(a); continue; }
            if (a.startsWith('--')) {
                const eq = a.indexOf('=');
                if (eq > 0) o[a.slice(2, eq)] = a.slice(eq + 1);
                else if (longValued.includes(a.slice(2)) && i + 1 < args.length) o[a.slice(2)] = args[++i];
                else o[a.slice(2)] = true;
                continue;
            }
            if (/^-\d+$/.test(a)) { o.n = a.slice(1); continue; }
            for (let j = 1; j < a.length; j++) {
                const f = a[j];
                if (valued.includes(f)) {
                    const v = a.slice(j + 1) || args[++i];
                    if (v === undefined) o.missing = f;
                    o[f] = v;
                    break;
                }
                o[f] = true;
            }
        }
        return o;
    };

    // ---------- tokenizer and parser ----------
    function tokenize(line, env) {
        const tokens = [];
        let cur = null, i = 0;
        const push = () => { if (cur) { tokens.push(cur); cur = null; } };
        const word = () => cur || (cur = { type: 'word', v: '', glob: false, tilde: false, quotedAll: true });
        const varAt = j => {
            const m = /^\$(\w+|\{\w+\})/.exec(line.slice(j));
            if (!m) return null;
            const name = m[1].replace(/[{}]/g, '');
            return { text: env[name] != null ? env[name] : '', len: m[0].length };
        };
        while (i < line.length) {
            const ch = line[i];
            if (ch === ' ' || ch === '\t') { push(); i++; continue; }
            if ('|;&><'.includes(ch)) {
                push();
                const two = line.slice(i, i + 2);
                if (two === '&&' || two === '||' || two === '>>') { tokens.push({ type: 'op', v: two }); i += 2; continue; }
                if (ch === '&') return { error: 'background jobs (&) are not supported in this lab' };
                tokens.push({ type: 'op', v: ch });
                i++;
                continue;
            }
            if (ch === "'") {
                const end = line.indexOf("'", i + 1);
                if (end < 0) return { error: "missing closing quote (')" };
                word().v += line.slice(i + 1, end);
                i = end + 1;
                continue;
            }
            if (ch === '"') {
                let j = i + 1, s = '';
                while (j < line.length && line[j] !== '"') {
                    if (line[j] === '\\' && '"\\$`'.includes(line[j + 1])) { s += line[j + 1]; j += 2; continue; }
                    if (line[j] === '$') {
                        const v = varAt(j);
                        if (v) { s += v.text; j += v.len; continue; }
                    }
                    s += line[j];
                    j++;
                }
                if (j >= line.length) return { error: 'missing closing quote (")' };
                word().v += s;
                i = j + 1;
                continue;
            }
            if (ch === '\\' && i + 1 < line.length) { word().v += line[i + 1]; i += 2; continue; }
            if (ch === '$') {
                const v = varAt(i);
                if (v) { const w = word(); w.v += v.text; w.quotedAll = false; i += v.len; continue; }
            }
            if (ch === '#' && !cur) break;
            const w = word();
            if (w.v === '' && ch === '~') w.tilde = true;
            if (ch === '*' || ch === '?') w.glob = true;
            w.quotedAll = false;
            w.v += ch;
            i++;
        }
        push();
        return { tokens };
    }

    function parse(tokens) {
        const chain = [];
        let stages = [], stage = { argv: [], redirs: [] }, op = null;
        const closeStage = sym => {
            if (!stage.argv.length) {
                if (stage.redirs.length || stages.length || sym === '|') return `syntax error near '${sym}'`;
                return null;
            }
            stages.push(stage);
            stage = { argv: [], redirs: [] };
            return null;
        };
        for (let k = 0; k < tokens.length; k++) {
            const t = tokens[k];
            if (t.type === 'word') { stage.argv.push(t); continue; }
            if (t.v === '>' || t.v === '>>' || t.v === '<') {
                const f = tokens[k + 1];
                if (!f || f.type !== 'word') return { error: `syntax error near '${t.v}': a file name is needed` };
                stage.redirs.push({ op: t.v, file: f.v });
                k++;
                continue;
            }
            if (t.v === '|') {
                if (!stage.argv.length) return { error: "syntax error near '|'" };
                stages.push(stage);
                stage = { argv: [], redirs: [] };
                continue;
            }
            const e = closeStage(t.v);
            if (e) return { error: e };
            if (stages.length) chain.push({ op, stages });
            else if (t.v !== ';') return { error: `syntax error near '${t.v}'` };
            stages = [];
            op = t.v;
        }
        if (!stage.argv.length && stages.length) return { error: "syntax error: a command is needed after '|'" };
        if (stage.argv.length) stages.push(stage);
        if (stages.length) chain.push({ op, stages });
        return { chain };
    }
    DD.tokenize = tokenize;
    DD.parse = parse;

    // ---------- command context ----------
    class Ctx {
        constructor(sh, stdin, tty) {
            this.sh = sh;
            this.stdin = stdin;
            this.tty = tty;
            this.lines = [];
            this.errs = [];
        }
        out(text, cls, run) {
            for (const t of String(text).split('\n')) this.lines.push({ parts: [{ t, c: cls, run }] });
        }
        parts(parts) { this.lines.push({ parts }); }
        err(text) { for (const t of String(text).split('\n')) this.errs.push({ parts: [{ t, c: 'c-err' }] }); }
        text() {
            if (!this.lines.length) return '';
            return this.lines.map(l => l.parts.map(p => p.t).join('')).join('\n') + '\n';
        }
    }
    DD.Ctx = Ctx;

    const COMMANDS = Object.create(null);
    DD.commands = COMMANDS;
    DD.register = function (name, spec) { COMMANDS[name] = spec; };

    // Commands that do not exist here, with advice.
    const MISSING = {
        vim: 'No text editor in this lab. Write files with: echo "text" > file.txt',
        vi: 'No text editor in this lab. Write files with: echo "text" > file.txt',
        nano: 'No text editor in this lab. Write files with: echo "text" > file.txt',
        emacs: 'No text editor in this lab. Write files with: echo "text" > file.txt',
        code: 'No text editor in this lab. Write files with: echo "text" > file.txt',
        awk: 'awk is not installed here. Try cut -d \' \' -f N, grep -o, sort and uniq.',
        sed: 'sed is not installed here. Try grep, cut and tr-free pipelines.',
        sudo: 'You already have the access you need. No root required.',
        su: 'You already have the access you need. No root required.',
        python: 'No interpreters on this evidence machine.',
        python3: 'No interpreters on this evidence machine.',
        node: 'No interpreters on this evidence machine.',
        ssh: 'This machine is air-gapped: no network tools.',
        curl: 'This machine is air-gapped: no network tools.',
        wget: 'This machine is air-gapped: no network tools.',
        ping: 'This machine is air-gapped: no network tools.',
        exit: 'You cannot log out mid-investigation. Type cases to pick another case.',
        logout: 'You cannot log out mid-investigation. Type cases to pick another case.'
    };

    class Shell {
        constructor(game) {
            this.game = game;
            this.user = 'detective';
            this.host = 'nightjar';
            this.home = '/home/detective';
            this.history = [];
            this.vfs = new DD.VFS();
            this.cwd = this.home;
            this.oldpwd = this.home;
        }

        reset(vfs, cwd) {
            this.vfs = vfs;
            this.cwd = cwd || this.home;
            this.oldpwd = this.cwd;
        }

        env() {
            return { HOME: this.home, USER: this.user, PWD: this.cwd, HOSTNAME: this.host, SHELL: '/bin/bash' };
        }

        resolve(p) { return DD.normalize(p, this.cwd, this.home); }
        node(p) { return this.vfs.get(this.resolve(p)); }

        tildify(abs) {
            if (abs === this.home) return '~';
            if (abs.startsWith(this.home + '/')) return '~' + abs.slice(this.home.length);
            return abs;
        }

        canWrite(abs) { return abs === this.home || abs.startsWith(this.home + '/'); }

        repoAt(abs) {
            for (let n = this.vfs.get(abs); n; n = n.parent) if (n.repo) return n.repo;
            return null;
        }

        prompt() {
            const repo = this.repoAt(this.cwd);
            return { user: `${this.user}@${this.host}`, path: this.tildify(this.cwd), branch: repo ? repo.headLabel() : null };
        }

        // Expand globs and ~ in one word.
        expand(tok) {
            let v = tok.v;
            if (tok.tilde && (v === '~' || v.startsWith('~/'))) v = this.home + v.slice(1);
            if (!tok.glob) return [v];
            const cut = v.lastIndexOf('/');
            const dirPart = cut >= 0 ? v.slice(0, cut + 1) : '';
            const pat = v.slice(cut + 1);
            const dir = this.vfs.get(this.resolve(dirPart || '.'));
            if (!dir || dir.type !== 'dir') return [v];
            const re = DD.globToRegExp(pat);
            const hits = this.vfs.list(dir, pat.startsWith('.')).filter(n => re.test(n)).map(n => dirPart + n);
            return hits.length ? hits : [v];
        }

        readInputs(ctx, files, cmd) {
            if (!files.length || (files.length === 1 && files[0] === '-')) {
                if (ctx.stdin == null) {
                    ctx.err(`${cmd}: no input. Give a file name, for example: ${cmd} notes.txt`);
                    return null;
                }
                return [{ name: '(standard input)', text: ctx.stdin }];
            }
            const res = [];
            for (const f of files) {
                const n = this.node(f);
                if (!n) { ctx.err(`${cmd}: ${f}: No such file or directory`); ctx.failed = true; continue; }
                if (n.type === 'dir') { ctx.err(`${cmd}: ${f}: Is a directory`); ctx.failed = true; continue; }
                res.push({ name: f, text: n.content, node: n });
            }
            return res;
        }

        run(line) {
            const trimmed = line.trim();
            if (trimmed && this.history[this.history.length - 1] !== trimmed) this.history.push(trimmed);
            const tk = tokenize(line, this.env());
            if (tk.error) { this.game.printErr('bash: ' + tk.error); return 2; }
            const p = parse(tk.tokens);
            if (p.error) { this.game.printErr('bash: ' + p.error); return 2; }
            let last = 0;
            for (const link of p.chain) {
                if (link.op === '&&' && last !== 0) continue;
                if (link.op === '||' && last === 0) continue;
                last = this.pipeline(link.stages, line);
            }
            return last;
        }

        pipeline(stages, line) {
            let stdin = null, code = 0;
            const record = [];
            for (let k = 0; k < stages.length; k++) {
                const st = stages[k];
                const argv = [];
                for (const t of st.argv) argv.push(...this.expand(t));
                const isLast = k === stages.length - 1;
                let inFail = false;
                for (const r of st.redirs.filter(r => r.op === '<')) {
                    const n = this.node(r.file);
                    if (!n || n.type !== 'file') { this.game.printErr(`bash: ${r.file}: No such file or directory`); inFail = true; }
                    else stdin = n.content;
                }
                if (inFail) { code = 1; break; }
                const outR = st.redirs.filter(r => r.op !== '<').pop();
                const ctx = new Ctx(this, stdin, isLast && !outR);
                code = this.call(argv, ctx);
                record.push({ argv, code, failed: !!ctx.failed });
                this.game.printLines(ctx.errs);
                if (outR) {
                    code = this.redirect(outR, ctx.text()) || code;
                    stdin = '';
                } else if (isLast) {
                    this.game.printLines(ctx.lines);
                } else {
                    stdin = ctx.text();
                }
                if (ctx.special) this.game.special(ctx.special);
            }
            this.game.track({ line, stages: record, code });
            return code;
        }

        redirect(r, text) {
            const abs = this.resolve(r.file);
            const n = this.vfs.get(abs);
            if (n && n.type === 'dir') { this.game.printErr(`bash: ${r.file}: Is a directory`); return 1; }
            if (!this.canWrite(abs)) { this.game.printErr(`bash: ${r.file}: Permission denied`); return 1; }
            const parent = this.vfs.get(abs.slice(0, abs.lastIndexOf('/')) || '/');
            if (!parent || parent.type !== 'dir') { this.game.printErr(`bash: ${r.file}: No such file or directory`); return 1; }
            const content = r.op === '>>' && n ? n.content + text : text;
            this.vfs.write(abs, { content, mtime: this.game.now() });
            return 0;
        }

        call(argv, ctx) {
            const name = argv[0];
            const spec = COMMANDS[name];
            if (!spec) {
                if (MISSING[name]) { ctx.err(`${name}: ${MISSING[name]}`); return 127; }
                const guess = DD.closest(name, Object.keys(COMMANDS).filter(c => !COMMANDS[c].hidden));
                ctx.err(`${name}: command not found`);
                if (guess) ctx.lines.push({ parts: [{ t: 'Did you mean ' }, { t: guess, c: 'c-link', run: [guess].concat(argv.slice(1)).join(' ') }, { t: '?' }] });
                else ctx.out("Type 'help' to see the commands you can use.", 'c-dim');
                return 127;
            }
            try {
                const r = spec.fn(argv.slice(1), ctx);
                return r == null ? (ctx.failed ? 1 : 0) : r;
            } catch (e) {
                ctx.err(`${name}: internal error: ${e.message}`);
                return 1;
            }
        }
    }
    DD.Shell = Shell;

    // ---------- helpers for commands ----------
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function lsDate(mtime) {
        const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d:\d\d)/.exec(mtime || DD.DEFAULT_TIME);
        return `${MONTHS[+m[2] - 1]} ${m[3].replace(/^0/, ' ')} ${m[4]}`;
    }
    function joinPath(base, name) {
        if (base === '.' || base === '') return name;
        return base.replace(/\/+$/, '') + '/' + name;
    }
    function quoteArg(s) { return /^[\w@%+=:,./~-]+$/.test(s) ? s : "'" + s.replace(/'/g, "'\\''") + "'"; }
    DD.quoteArg = quoteArg;

    function parseList(spec) {
        const parts = [];
        for (const p of String(spec).split(',')) {
            const m = /^(\d*)(-?)(\d*)$/.exec(p.trim());
            if (!m || (!m[1] && !m[3])) return null;
            const a = m[1] ? +m[1] : 1;
            const b = m[2] ? (m[3] ? +m[3] : Infinity) : a;
            parts.push([a, b]);
        }
        return parts;
    }
    const inList = (list, i) => list.some(([a, b]) => i >= a && i <= b);

    function utf8ToB64(s) {
        const bytes = new TextEncoder().encode(s);
        let bin = '';
        for (const b of bytes) bin += String.fromCharCode(b);
        return btoa(bin);
    }
    function b64ToUtf8(s) {
        const bin = atob(s.replace(/\s+/g, ''));
        const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
        return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    }

    function highlight(line, re) {
        const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
        const parts = [];
        let last = 0, m;
        while ((m = g.exec(line)) !== null) {
            if (m[0] === '') { g.lastIndex++; continue; }
            if (m.index > last) parts.push({ t: line.slice(last, m.index) });
            parts.push({ t: m[0], c: 'c-match' });
            last = m.index + m[0].length;
        }
        if (last < line.length) parts.push({ t: line.slice(last) });
        return parts;
    }

    function fileType(node) {
        if (node.type === 'dir') return 'directory';
        if (node.ftype) return node.ftype;
        const c = node.content;
        if (!c.length) return 'empty';
        if (c.startsWith('#!')) return 'Bourne-Again shell script, ASCII text executable';
        const ascii = /^[\x09\x0a\x0d\x20-\x7e]*$/.test(c);
        const long = DD.lines(c).some(l => l.length > 300);
        return (ascii ? 'ASCII text' : 'Unicode text, UTF-8 text') + (long ? ', with very long lines' : '');
    }

    function mustWrite(ctx, abs, cmd, shown) {
        if (ctx.sh.canWrite(abs)) return true;
        ctx.err(`${cmd}: cannot modify '${shown}': Permission denied`);
        return false;
    }

    const reg = DD.register;

    // ---------- navigation ----------
    reg('pwd', { group: 'Navigate', fn(args, ctx) { ctx.out(ctx.sh.cwd); } });

    reg('cd', {
        group: 'Navigate',
        fn(args, ctx) {
            const sh = ctx.sh;
            let target = args[0] || sh.home;
            if (target === '-') target = sh.oldpwd;
            const abs = sh.resolve(target);
            const n = sh.vfs.get(abs);
            if (!n) { ctx.err(`cd: ${args[0]}: No such file or directory`); return 1; }
            if (n.type !== 'dir') { ctx.err(`cd: ${args[0]}: Not a directory`); return 1; }
            sh.oldpwd = sh.cwd;
            sh.cwd = abs;
            return 0;
        }
    });

    reg('ls', {
        group: 'Navigate',
        fn(args, ctx) {
            const sh = ctx.sh, vfs = sh.vfs;
            const o = DD.getopt(args);
            const all = o.a || o.A, long = o.l;
            const targets = o._.length ? o._ : ['.'];
            let code = 0;
            const emit = (entries, base) => {
                if (long) {
                    if (entries.length > 1 || entries[0].node.type === 'dir') {
                        const blocks = entries.reduce((s, e) => s + Math.ceil(vfs.size(e.node) / 4096) * 4, 0);
                        ctx.out('total ' + blocks);
                    }
                    const width = Math.max(...entries.map(e => String(vfs.size(e.node)).length));
                    for (const e of entries) {
                        const n = e.node;
                        const mode = n.mode || (n.type === 'dir' ? 'drwxr-xr-x' : '-rw-r--r--');
                        const owner = n.owner || 'detective';
                        const pre = `${mode} ${n.type === 'dir' ? 2 : 1} ${owner.padEnd(9)} ${owner.padEnd(9)} ${String(vfs.size(n)).padStart(width)} ${lsDate(n.mtime)} `;
                        ctx.parts([{ t: pre }, nameP(e, base)]);
                    }
                    return;
                }
                if (!ctx.tty) { for (const e of entries) ctx.out(e.name); return; }
                const parts = [];
                entries.forEach((e, i) => { if (i) parts.push({ t: '  ' }); parts.push(nameP(e, base)); });
                if (parts.length) ctx.parts(parts);
            };
            const nameP = (e, base) => {
                const path = base == null ? e.name : joinPath(base, e.name);
                if (e.node.type === 'dir') return { t: e.name, c: 'c-dir', run: e.dot ? null : `cd ${quoteArg(path)} && ls` };
                return { t: e.name, c: e.node.mode && e.node.mode.includes('x') ? 'c-exe' : 'c-file', run: `cat ${quoteArg(path)}` };
            };
            targets.forEach((t, idx) => {
                const n = sh.node(t);
                if (!n) { ctx.err(`ls: cannot access '${t}': No such file or directory`); code = 2; return; }
                if (n.type === 'file') { emit([{ name: t, node: n }], null); return; }
                if (targets.length > 1) ctx.out(t + ':');
                const entries = [];
                if (o.a) {
                    entries.push({ name: '.', node: n, dot: true });
                    entries.push({ name: '..', node: n.parent || n, dot: true });
                }
                for (const name of vfs.list(n, all)) entries.push({ name, node: n.children[name] });
                if (entries.length) emit(entries, t);
                if (targets.length > 1 && idx < targets.length - 1) ctx.out('');
            });
            return code;
        }
    });

    reg('tree', {
        group: 'Navigate',
        fn(args, ctx) {
            const o = DD.getopt(args);
            const start = o._[0] || '.';
            const root = ctx.sh.node(start);
            if (!root || root.type !== 'dir') { ctx.err(`tree: ${start}: not a directory`); return 1; }
            let dirs = 0, files = 0;
            ctx.out(start, 'c-dir');
            const rec = (node, prefix, path) => {
                const names = ctx.sh.vfs.list(node, o.a).filter(n => n !== '.git' || o.a);
                names.forEach((name, i) => {
                    const child = node.children[name];
                    const lastOne = i === names.length - 1;
                    const p = joinPath(path, name);
                    const isDir = child.type === 'dir';
                    if (isDir) dirs++; else files++;
                    ctx.parts([{ t: prefix + (lastOne ? '└── ' : '├── ') }, { t: name, c: isDir ? 'c-dir' : 'c-file', run: isDir ? `cd ${quoteArg(p)} && ls` : `cat ${quoteArg(p)}` }]);
                    if (isDir) rec(child, prefix + (lastOne ? '    ' : '│   '), p);
                });
            };
            rec(root, '', start);
            ctx.out('');
            ctx.out(`${dirs} director${dirs === 1 ? 'y' : 'ies'}, ${files} file${files === 1 ? '' : 's'}`);
        }
    });

    reg('find', {
        group: 'Navigate',
        fn(args, ctx) {
            const paths = [];
            let i = 0;
            while (i < args.length && !args[i].startsWith('-')) paths.push(args[i++]);
            if (!paths.length) paths.push('.');
            let name = null, type = null;
            for (; i < args.length; i++) {
                const a = args[i];
                if (a === '-name' || a === '-iname') {
                    if (args[i + 1] == null) { ctx.err(`find: missing argument to '${a}'`); return 1; }
                    name = DD.globToRegExp(args[++i], a === '-iname' ? 'i' : '');
                } else if (a === '-type') {
                    type = args[++i];
                    if (type !== 'f' && type !== 'd') { ctx.err("find: -type must be f (file) or d (directory)"); return 1; }
                } else { ctx.err(`find: unknown predicate '${a}'. Supported: -name, -iname, -type f|d`); return 1; }
            }
            let code = 0;
            for (const p of paths) {
                const start = ctx.sh.node(p);
                if (!start) { ctx.err(`find: '${p}': No such file or directory`); code = 1; continue; }
                ctx.sh.vfs.walk(start, (n, rel) => {
                    if (type === 'f' && n.type !== 'file') return;
                    if (type === 'd' && n.type !== 'dir') return;
                    const base = rel ? n.name : p.replace(/\/+$/, '').split('/').pop();
                    if (name && !name.test(base)) return;
                    const display = rel ? (p === '.' ? './' + rel : joinPath(p, rel)) : p;
                    ctx.out(display, n.type === 'dir' ? 'c-dir' : 'c-file', n.type === 'dir' ? `cd ${quoteArg(display)} && ls` : `cat ${quoteArg(display)}`);
                });
            }
            return code;
        }
    });

    // ---------- reading files ----------
    function catLike(name) {
        return function (args, ctx) {
            const o = DD.getopt(args);
            const inputs = ctx.sh.readInputs(ctx, o._, name);
            if (!inputs) return 1;
            let k = 0;
            for (const inp of inputs) {
                for (const l of DD.lines(inp.text)) {
                    if (o.n) ctx.out(String(++k).padStart(6) + '  ' + l);
                    else ctx.out(l);
                }
            }
        };
    }
    reg('cat', { group: 'Read', fn: catLike('cat') });
    reg('less', { group: 'Read', hidden: true, fn: catLike('less') });
    reg('more', { group: 'Read', hidden: true, fn: catLike('more') });

    function headTail(name) {
        return function (args, ctx) {
            const o = DD.getopt(args, 'n');
            let spec = o.n != null ? String(o.n) : '10';
            const fromStart = name === 'tail' && spec.startsWith('+');
            const n = parseInt(spec.replace('+', ''), 10);
            if (isNaN(n)) { ctx.err(`${name}: invalid number of lines: '${spec}'`); return 1; }
            const inputs = ctx.sh.readInputs(ctx, o._, name);
            if (!inputs) return 1;
            inputs.forEach((inp, idx) => {
                if (inputs.length > 1) { if (idx) ctx.out(''); ctx.out(`==> ${inp.name} <==`, 'c-dim'); }
                const ls = DD.lines(inp.text);
                const pick = name === 'head' ? ls.slice(0, n) : fromStart ? ls.slice(n - 1) : ls.slice(Math.max(0, ls.length - n));
                for (const l of pick) ctx.out(l);
            });
        };
    }
    reg('head', { group: 'Read', fn: headTail('head') });
    reg('tail', { group: 'Read', fn: headTail('tail') });

    reg('file', {
        group: 'Inspect',
        fn(args, ctx) {
            if (!args.length) { ctx.err('usage: file FILE...'); return 1; }
            for (const f of args) {
                const n = ctx.sh.node(f);
                if (!n) { ctx.out(`${f}: cannot open '${f}' (No such file or directory)`); continue; }
                ctx.parts([{ t: f, c: 'c-file' }, { t: ': ' + fileType(n) }]);
            }
        }
    });

    reg('stat', {
        group: 'Inspect',
        fn(args, ctx) {
            if (!args.length) { ctx.err('stat: missing operand'); return 1; }
            for (const f of args) {
                const n = ctx.sh.node(f);
                if (!n) { ctx.err(`stat: cannot statx '${f}': No such file or directory`); ctx.failed = true; continue; }
                const mode = n.mode || (n.type === 'dir' ? 'drwxr-xr-x' : '-rw-r--r--');
                const oct = n.type === 'dir' ? '0755' : mode.includes('x') ? '0755' : '0644';
                const owner = n.owner || 'detective';
                const uid = owner === 'root' ? 0 : 1000;
                const t = (n.mtime || DD.DEFAULT_TIME) + (n.mtime && n.mtime.length > 16 ? '' : ':00');
                ctx.out(`  File: ${f}`);
                ctx.out(`  Size: ${String(ctx.sh.vfs.size(n)).padEnd(10)} Blocks: 8          IO Block: 4096   ${n.type === 'dir' ? 'directory' : 'regular file'}`);
                ctx.out(`Access: (${oct}/${mode})  Uid: (${String(uid).padStart(5)}/${owner.padEnd(9)})   Gid: (${String(uid).padStart(5)}/${owner.padEnd(9)})`);
                ctx.parts([{ t: 'Modify: ' }, { t: `${t}.000000000 +0000`, c: 'c-hash' }]);
            }
        }
    });

    reg('wc', {
        group: 'Count',
        fn(args, ctx) {
            const o = DD.getopt(args);
            const inputs = ctx.sh.readInputs(ctx, o._, 'wc');
            if (!inputs) return 1;
            const pick = (o.l || o.w || o.c) ? ['l', 'w', 'c'].filter(k => o[k]) : ['l', 'w', 'c'];
            const rows = inputs.map(inp => {
                const t = inp.text;
                const v = { l: (t.match(/\n/g) || []).length, w: (t.match(/\S+/g) || []).length, c: new TextEncoder().encode(t).length };
                return { v, name: o._.length ? inp.name : '' };
            });
            if (rows.length > 1) {
                const tot = { l: 0, w: 0, c: 0 };
                rows.forEach(r => { tot.l += r.v.l; tot.w += r.v.w; tot.c += r.v.c; });
                rows.push({ v: tot, name: 'total' });
            }
            const width = pick.length === 1 && rows.length === 1 ? 0 : Math.max(...rows.flatMap(r => pick.map(k => String(r.v[k]).length)));
            for (const r of rows) ctx.out((pick.map(k => String(r.v[k]).padStart(width)).join(' ') + (r.name ? ' ' + r.name : '')));
        }
    });

    // ---------- search and filter ----------
    reg('grep', {
        group: 'Search',
        fn(args, ctx) {
            const o = DD.getopt(args, 'e');
            let pattern = o.e != null ? o.e : o._.shift();
            if (pattern == null) { ctx.err('usage: grep [-i -n -v -c -o -l -r -w -F] PATTERN [FILE...]'); return 2; }
            let src = o.F ? escapeRe(pattern) : (o.E ? pattern : pattern.replace(/\\\|/g, '|').replace(/\\([(){}+?])/g, '$1'));
            if (o.w) src = '\\b(?:' + src + ')\\b';
            let re;
            try { re = new RegExp(src, o.i ? 'i' : ''); } catch (e) { re = new RegExp(escapeRe(pattern), o.i ? 'i' : ''); }
            let inputs;
            const recursive = o.r || o.R;
            if (recursive) {
                inputs = [];
                for (const p of (o._.length ? o._ : ['.'])) {
                    const start = ctx.sh.node(p);
                    if (!start) { ctx.err(`grep: ${p}: No such file or directory`); continue; }
                    ctx.sh.vfs.walk(start, (n, rel) => {
                        if (n.type !== 'file' || rel.split('/').includes('.git')) return;
                        const name = start.type === 'file' ? p : (p === '.' ? rel : joinPath(p, rel));
                        inputs.push({ name, text: n.content });
                    });
                }
            } else {
                inputs = ctx.sh.readInputs(ctx, o._, 'grep');
                if (!inputs) return 2;
            }
            const multi = (inputs.length > 1 || recursive) && !o.h;
            let any = false;
            for (const inp of inputs) {
                let count = 0;
                DD.lines(inp.text).forEach((line, idx) => {
                    if (re.test(line) === !!o.v) return;
                    count++;
                    any = true;
                    if (o.c || o.l || o.q) return;
                    const pre = [];
                    if (multi) pre.push({ t: inp.name, c: 'c-file' }, { t: ':', c: 'c-dim' });
                    if (o.n) pre.push({ t: String(idx + 1), c: 'c-num' }, { t: ':', c: 'c-dim' });
                    if (o.o && !o.v) {
                        const g = new RegExp(re.source, re.flags + 'g');
                        let m;
                        while ((m = g.exec(line)) !== null) {
                            if (m[0] === '') { g.lastIndex++; continue; }
                            ctx.parts(pre.concat([{ t: m[0], c: 'c-match' }]));
                        }
                    } else {
                        ctx.parts(pre.concat(o.v ? [{ t: line }] : highlight(line, re)));
                    }
                });
                if (o.c) ctx.out((multi ? inp.name + ':' : '') + count);
                if (o.l && count) ctx.out(inp.name, 'c-file');
            }
            return any ? (ctx.failed ? 2 : 0) : 1;
        }
    });

    reg('sort', {
        group: 'Count',
        fn(args, ctx) {
            const o = DD.getopt(args, 'tk');
            const inputs = ctx.sh.readInputs(ctx, o._, 'sort');
            if (!inputs) return 1;
            let rows = inputs.flatMap(i => DD.lines(i.text));
            const field = o.k ? parseInt(o.k, 10) : 0;
            const key = l => {
                if (!field) return o.n ? l.trim() : l;
                const parts = o.t ? l.split(o.t) : l.trim().split(/\s+/);
                return parts.slice(field - 1).join(o.t || ' ');
            };
            const cmp = (a, b) => {
                const ka = key(a), kb = key(b);
                if (o.n) {
                    const d = (parseFloat(ka) || 0) - (parseFloat(kb) || 0);
                    if (d) return d;
                }
                return ka < kb ? -1 : ka > kb ? 1 : (a < b ? -1 : a > b ? 1 : 0);
            };
            rows.sort(cmp);
            if (o.r) rows.reverse();
            if (o.u) rows = rows.filter((l, i) => i === 0 || cmp(l, rows[i - 1]) !== 0);
            for (const l of rows) ctx.out(l);
        }
    });

    reg('uniq', {
        group: 'Count',
        fn(args, ctx) {
            const o = DD.getopt(args);
            const inputs = ctx.sh.readInputs(ctx, o._.slice(0, 1), 'uniq');
            if (!inputs) return 1;
            const rows = DD.lines(inputs[0].text);
            const groups = [];
            for (const l of rows) {
                const g = groups[groups.length - 1];
                if (g && g.line === l) g.n++;
                else groups.push({ line: l, n: 1 });
            }
            for (const g of groups) {
                if (o.d && g.n < 2) continue;
                if (o.u && g.n > 1) continue;
                ctx.out(o.c ? String(g.n).padStart(7) + ' ' + g.line : g.line);
            }
        }
    });

    reg('cut', {
        group: 'Count',
        fn(args, ctx) {
            const o = DD.getopt(args, 'dfc');
            if (o.f == null && o.c == null) { ctx.err("cut: you must specify a list of fields (-f) or characters (-c)\nexample: cut -d ',' -f 2 data.csv"); return 1; }
            const list = parseList(o.f != null ? o.f : o.c);
            if (!list) { ctx.err('cut: invalid field list'); return 1; }
            const delim = o.d != null ? o.d : '\t';
            if (o.f != null && delim.length !== 1) { ctx.err('cut: the delimiter must be a single character'); return 1; }
            const inputs = ctx.sh.readInputs(ctx, o._, 'cut');
            if (!inputs) return 1;
            for (const inp of inputs) {
                for (const l of DD.lines(inp.text)) {
                    if (o.c != null) { ctx.out([...l].filter((_, i) => inList(list, i + 1)).join('')); continue; }
                    if (!l.includes(delim)) { if (!o.s) ctx.out(l); continue; }
                    ctx.out(l.split(delim).filter((_, i) => inList(list, i + 1)).join(delim));
                }
            }
        }
    });

    reg('diff', {
        group: 'Inspect',
        fn(args, ctx) {
            const o = DD.getopt(args);
            if (o._.length !== 2) { ctx.err('usage: diff [-u] FILE1 FILE2'); return 2; }
            const [a, b] = o._.map(f => ctx.sh.node(f));
            for (const [f, n] of [[o._[0], a], [o._[1], b]]) {
                if (!n) { ctx.err(`diff: ${f}: No such file or directory`); return 2; }
                if (n.type === 'dir') { ctx.err(`diff: ${f}: Is a directory (compare files, not folders)`); return 2; }
            }
            if (a.content === b.content) return 0;
            if (o.u) {
                ctx.out('--- ' + o._[0], 'c-del');
                ctx.out('+++ ' + o._[1], 'c-add');
                for (const l of DD.unified(a.content, b.content)) ctx.out(l, l[0] === '@' ? 'c-hunk' : l[0] === '+' ? 'c-add' : l[0] === '-' ? 'c-del' : null);
                return 1;
            }
            const ops = DD.diffLines(DD.lines(a.content), DD.lines(b.content));
            const range = (s, e) => (s === e ? String(s) : `${s},${e}`);
            let ai = 0, bi = 0, k = 0;
            while (k < ops.length) {
                if (ops[k].op === ' ') { ai++; bi++; k++; continue; }
                const dels = [], adds = [];
                while (k < ops.length && ops[k].op !== ' ') { (ops[k].op === '-' ? dels : adds).push(ops[k].line); k++; }
                if (dels.length && adds.length) ctx.out(`${range(ai + 1, ai + dels.length)}c${range(bi + 1, bi + adds.length)}`, 'c-hunk');
                else if (dels.length) ctx.out(`${range(ai + 1, ai + dels.length)}d${bi}`, 'c-hunk');
                else ctx.out(`${ai}a${range(bi + 1, bi + adds.length)}`, 'c-hunk');
                for (const l of dels) ctx.out('< ' + l, 'c-del');
                if (dels.length && adds.length) ctx.out('---');
                for (const l of adds) ctx.out('> ' + l, 'c-add');
                ai += dels.length;
                bi += adds.length;
            }
            return 1;
        }
    });

    // ---------- encoding and hashing ----------
    reg('base64', {
        group: 'Inspect',
        fn(args, ctx) {
            const o = DD.getopt(args);
            const inputs = ctx.sh.readInputs(ctx, o._, 'base64');
            if (!inputs) return 1;
            const text = inputs.map(i => i.text).join('');
            if (o.d || o.decode) {
                try { ctx.out(b64ToUtf8(text).replace(/\n$/, '')); } catch (e) { ctx.err('base64: invalid input'); return 1; }
            } else {
                const enc = utf8ToB64(text);
                for (let i = 0; i < enc.length; i += 76) ctx.out(enc.slice(i, i + 76));
            }
        }
    });

    reg('sha256sum', {
        group: 'Inspect',
        fn(args, ctx) {
            const o = DD.getopt(args);
            if (o.c || o.check) {
                const inputs = ctx.sh.readInputs(ctx, o._, 'sha256sum');
                if (!inputs) return 1;
                let bad = 0;
                for (const l of DD.lines(inputs.map(i => i.text).join(''))) {
                    const m = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(l.trim());
                    if (!m) continue;
                    const n = ctx.sh.node(m[2]);
                    if (!n || n.type !== 'file') { ctx.out(`${m[2]}: FAILED open or read`, 'c-err'); bad++; continue; }
                    const ok = DD.sha256(n.content) === m[1];
                    if (!ok) bad++;
                    ctx.parts([{ t: m[2] + ': ' }, { t: ok ? 'OK' : 'FAILED', c: ok ? 'c-add' : 'c-del' }]);
                }
                if (bad) { const w = `sha256sum: WARNING: ${bad} computed checksum${bad > 1 ? 's' : ''} did NOT match`; if (ctx.tty) ctx.out(w, 'c-err'); else ctx.err(w); return 1; }
                return 0;
            }
            const inputs = ctx.sh.readInputs(ctx, o._, 'sha256sum');
            if (!inputs) return 1;
            for (const inp of inputs) ctx.parts([{ t: DD.sha256(inp.text), c: 'c-hash' }, { t: '  ' + (o._.length ? inp.name : '-') }]);
        }
    });

    // ---------- writing ----------
    reg('echo', {
        group: 'Write',
        fn(args, ctx) {
            let n = false, e = false;
            while (args.length && /^-[ne]+$/.test(args[0])) { const f = args.shift(); n = n || f.includes('n'); e = e || f.includes('e'); }
            let text = args.join(' ');
            if (e) text = text.replace(/\\n/g, '\n').replace(/\\t/g, '\t');
            ctx.out(text);
            if (n) ctx.noNewline = true;
        }
    });

    reg('touch', {
        group: 'Write',
        fn(args, ctx) {
            if (!args.length) { ctx.err('touch: missing file operand'); return 1; }
            for (const f of args) {
                const abs = ctx.sh.resolve(f);
                if (!mustWrite(ctx, abs, 'touch', f)) { ctx.failed = true; continue; }
                const n = ctx.sh.vfs.get(abs);
                if (n) { n.mtime = ctx.sh.game.now(); continue; }
                const parent = ctx.sh.vfs.get(abs.slice(0, abs.lastIndexOf('/')) || '/');
                if (!parent) { ctx.err(`touch: cannot touch '${f}': No such file or directory`); ctx.failed = true; continue; }
                ctx.sh.vfs.write(abs, { content: '', mtime: ctx.sh.game.now() });
            }
        }
    });

    reg('mkdir', {
        group: 'Write',
        fn(args, ctx) {
            const o = DD.getopt(args);
            if (!o._.length) { ctx.err('mkdir: missing operand'); return 1; }
            for (const f of o._) {
                const abs = ctx.sh.resolve(f);
                if (!mustWrite(ctx, abs, 'mkdir', f)) { ctx.failed = true; continue; }
                if (ctx.sh.vfs.get(abs)) { if (!o.p) { ctx.err(`mkdir: cannot create directory '${f}': File exists`); ctx.failed = true; } continue; }
                const parent = ctx.sh.vfs.get(abs.slice(0, abs.lastIndexOf('/')) || '/');
                if (!parent && !o.p) { ctx.err(`mkdir: cannot create directory '${f}': No such file or directory (use mkdir -p)`); ctx.failed = true; continue; }
                ctx.sh.vfs.mkdirp(abs);
            }
        }
    });

    reg('rm', {
        group: 'Write',
        fn(args, ctx) {
            const o = DD.getopt(args);
            if (!o._.length) { ctx.err('rm: missing operand'); return 1; }
            for (const f of o._) {
                const abs = ctx.sh.resolve(f);
                const n = ctx.sh.vfs.get(abs);
                if (!n) { if (!o.f) { ctx.err(`rm: cannot remove '${f}': No such file or directory`); ctx.failed = true; } continue; }
                if (!mustWrite(ctx, abs, 'rm', f) || abs === ctx.sh.home) { ctx.failed = true; continue; }
                if (n.type === 'dir' && !(o.r || o.R)) { ctx.err(`rm: cannot remove '${f}': Is a directory (use rm -r)`); ctx.failed = true; continue; }
                if (ctx.sh.cwd === abs || ctx.sh.cwd.startsWith(abs + '/')) { ctx.err(`rm: refusing to remove '${f}': you are inside it`); ctx.failed = true; continue; }
                ctx.sh.vfs.remove(n);
            }
        }
    });

    function copyMove(name) {
        return function (args, ctx) {
            const o = DD.getopt(args);
            if (o._.length !== 2) { ctx.err(`usage: ${name} SOURCE DEST`); return 1; }
            const [s, d] = o._;
            const src = ctx.sh.node(s);
            if (!src) { ctx.err(`${name}: cannot stat '${s}': No such file or directory`); return 1; }
            if (src.type === 'dir' && name === 'cp') { ctx.err(`cp: -r is not supported here; copy files one at a time`); return 1; }
            let abs = ctx.sh.resolve(d);
            const dn = ctx.sh.vfs.get(abs);
            if (dn && dn.type === 'dir') abs = abs + '/' + src.name;
            if (!mustWrite(ctx, abs, name, d)) return 1;
            if (name === 'mv' && !mustWrite(ctx, ctx.sh.vfs.pathOf(src), name, s)) return 1;
            if (src.type === 'dir') {
                const parent = ctx.sh.vfs.get(abs.slice(0, abs.lastIndexOf('/')) || '/');
                ctx.sh.vfs.remove(src);
                src.name = abs.slice(abs.lastIndexOf('/') + 1);
                src.parent = parent;
                parent.children[src.name] = src;
                return 0;
            }
            ctx.sh.vfs.write(abs, { content: src.content, mtime: ctx.sh.game.now() });
            if (name === 'mv') ctx.sh.vfs.remove(src);
        };
    }
    reg('cp', { group: 'Write', fn: copyMove('cp') });
    reg('mv', { group: 'Write', fn: copyMove('mv') });

    // ---------- system ----------
    reg('whoami', { group: 'System', fn(a, ctx) { ctx.out(ctx.sh.user); } });
    reg('hostname', { group: 'System', hidden: true, fn(a, ctx) { ctx.out(ctx.sh.host); } });
    reg('date', { group: 'System', hidden: true, fn(a, ctx) { ctx.out('Sat Mar 15 10:00:00 UTC 2025'); } });
    reg('clear', { group: 'System', fn(a, ctx) { ctx.special = 'clear'; } });
    reg('history', {
        group: 'System',
        fn(args, ctx) {
            if (args[0] === '-c') { ctx.sh.history.length = 0; return 0; }
            const h = ctx.sh.history;
            h.forEach((l, i) => ctx.parts([{ t: String(i + 1).padStart(5) + '  ', c: 'c-dim' }, { t: l, c: 'c-link', run: l }]));
        }
    });

    // ---------- manual pages ----------
    const MAN = {
        pwd: ['pwd', 'Print the full path of the folder you are in.', ['pwd']],
        cd: ['cd [DIR]', 'Change folder. cd with no argument goes home (~). cd .. goes up one level, cd - goes back.', ['cd logs', 'cd ..', 'cd ~/evidence', 'cd -']],
        ls: ['ls [-l] [-a] [PATH...]', 'List a folder. -a also shows hidden names that start with a dot. -l shows size, owner and the time of last change.', ['ls', 'ls -a', 'ls -la evidence']],
        tree: ['tree [-a] [DIR]', 'Draw the folder structure as a tree.', ['tree', 'tree -a']],
        find: ['find [PATH] [-name GLOB] [-iname GLOB] [-type f|d]', 'Search for files by name, through every sub-folder. Quote patterns that contain *.', ["find . -name '*.log'", 'find ~ -type d', "find . -iname '*key*'"]],
        cat: ['cat [-n] FILE...', 'Print files. -n numbers the lines.', ['cat README.txt', 'cat -n notes.txt']],
        head: ['head [-n N] [FILE]', 'Print the first N lines (default 10).', ['head -n 5 auth.log', 'head -3 data.csv']],
        tail: ['tail [-n N] [FILE]', 'Print the last N lines (default 10). tail -n +N starts at line N.', ['tail -n 20 auth.log']],
        grep: ['grep [OPTIONS] PATTERN [FILE...]', 'Print lines that match a pattern (a regular expression).\n  -i  ignore case        -n  show line numbers\n  -v  invert the match   -c  count matching lines\n  -o  print only the matching part\n  -r  search every file under a folder\n  -l  list only file names that match\n  -w  whole words only   -F  treat the pattern as plain text\n  -E  extended regex (+ ? | and groups)', ['grep password clues.txt', 'grep -n -i error app.log', "grep -oE '[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+' auth.log", 'grep -r TODO .']],
        wc: ['wc [-l] [-w] [-c] [FILE...]', 'Count lines, words and bytes.', ['wc -l auth.log', 'grep Failed auth.log | wc -l']],
        sort: ['sort [-r] [-n] [-u] [-t SEP -k N] [FILE]', 'Sort lines. -n sorts by number, -r reverses, -u drops duplicates, -k N sorts by field N.', ['sort names.txt', 'sort -rn counts.txt', "sort -t ',' -k 3 -n ledger.csv"]],
        uniq: ['uniq [-c] [-d] [-u] [FILE]', 'Collapse repeated adjacent lines. Sort first so equal lines sit together. -c prefixes each line with its count.', ['sort ips.txt | uniq -c', '... | sort | uniq -c | sort -rn']],
        cut: ['cut -d SEP -f LIST [FILE]', 'Keep some fields of each line. Fields are numbered from 1. LIST can be 2 or 1,3 or 2-4. -c LIST cuts characters.', ["cut -d ' ' -f 11 auth.log", "cut -d ',' -f 1,3 ledger.csv", 'cut -c 1-8 notes.txt']],
        diff: ['diff [-u] FILE1 FILE2', 'Show the lines that differ. < lines come from FILE1, > lines from FILE2. -u prints the unified format that git uses.', ['diff old.csv new.csv', 'diff -u a.txt b.txt']],
        file: ['file FILE...', 'Guess the real type of a file from its content, not its extension.', ['file photo.jpg', 'file *']],
        stat: ['stat FILE', 'Show size, permissions, owner and the time of last change.', ['stat ledger.csv']],
        base64: ['base64 [-d] [FILE]', 'Encode to base64, or decode with -d. Base64 text uses A-Z, a-z, 0-9, + and /, and often ends with =.', ['base64 -d message.txt', 'echo hello | base64']],
        sha256sum: ['sha256sum [-c] FILE...', 'Print the SHA-256 fingerprint of files. Any change to a file, even one character, changes its hash. -c checks files against a list of known hashes.', ['sha256sum *.csv', 'sha256sum -c MANIFEST.sha256']],
        echo: ['echo [-n] [-e] TEXT', 'Print text. With > it writes the text to a file, and >> appends.', ['echo hello', 'echo "Suspect: J. Doe" > report.txt', 'echo "more" >> report.txt']],
        touch: ['touch FILE', 'Create an empty file, or update its time.', ['touch notes.txt']],
        mkdir: ['mkdir [-p] DIR', 'Create a folder. -p creates parent folders too.', ['mkdir reports', 'mkdir -p a/b/c']],
        rm: ['rm [-r] [-f] PATH', 'Delete files. -r deletes a folder and everything in it. There is no undo.', ['rm old.txt', 'rm -r scratch']],
        mv: ['mv SOURCE DEST', 'Move or rename a file.', ['mv draft.txt report.txt']],
        cp: ['cp SOURCE DEST', 'Copy a file.', ['cp report.txt backup.txt']],
        history: ['history [-c]', 'List the commands you typed. Click one to run it again. -c clears the list.', ['history']],
        clear: ['clear', 'Clear the screen (Ctrl+L also works).', ['clear']],
        whoami: ['whoami', 'Print your user name.', ['whoami']],
        man: ['man COMMAND', 'Show the manual for a command.', ['man grep', 'man git']],
        help: ['help', 'List every command.', ['help']],
        pipes: ['A | B', 'A pipe sends the output of one command into the next one. Chain as many as you need.\n  ;   run the next command anyway\n  &&  run the next command only if this one succeeded\n  >   write output to a file (replaces it)\n  >>  append output to a file', ['grep Failed auth.log | wc -l', "cut -d ' ' -f 11 auth.log | sort | uniq -c | sort -rn | head -5", 'cd logs && ls']]
    };
    DD.MAN = MAN;

    reg('man', {
        group: 'Help',
        fn(args, ctx) {
            const name = args[0];
            if (!name) { ctx.err('What manual page do you want? Example: man grep'); return 1; }
            if (name === 'git' || name.startsWith('git-')) { return DD.commands.git.fn(['help'].concat(name === 'git' ? [] : [name.slice(4)]), ctx); }
            const page = MAN[name] || (COMMANDS[name] && COMMANDS[name].man);
            if (!page) { ctx.err(`No manual entry for ${name}`); return 16; }
            ctx.out('NAME', 'c-head');
            ctx.out('    ' + name);
            ctx.out('USAGE', 'c-head');
            ctx.out('    ' + page[0]);
            ctx.out('DESCRIPTION', 'c-head');
            for (const l of page[1].split('\n')) ctx.out('    ' + l);
            ctx.out('EXAMPLES', 'c-head');
            for (const ex of page[2]) ctx.parts([{ t: '    ' }, { t: ex, c: 'c-link', insert: ex }]);
        }
    });

    reg('help', {
        group: 'Help',
        fn(args, ctx) {
            const groups = {};
            for (const [name, spec] of Object.entries(COMMANDS)) {
                if (spec.hidden) continue;
                (groups[spec.group || 'Other'] = groups[spec.group || 'Other'] || []).push(name);
            }
            const order = ['Case', 'Navigate', 'Read', 'Search', 'Count', 'Inspect', 'Write', 'Git', 'System', 'Help'];
            for (const g of order) {
                if (!groups[g]) continue;
                const parts = [{ t: g.padEnd(10), c: 'c-head' }];
                groups[g].forEach((n, i) => { if (i) parts.push({ t: ' ' }); parts.push({ t: n, c: 'c-link', run: n === 'git' ? 'git help' : 'man ' + n }); });
                ctx.parts(parts);
            }
            ctx.out('');
            ctx.out('Click a command for its manual, or type man <command>. man pipes explains | > and &&.', 'c-dim');
            ctx.out('Keys: Tab completes, Up/Down browse history, Ctrl+L clears, Ctrl+C cancels the line.', 'c-dim');
        }
    });
})(window.DD);
