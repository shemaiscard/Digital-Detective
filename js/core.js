'use strict';
// Core helpers: SHA-256, seeded random numbers, a virtual file system and line diffs.
window.DD = window.DD || {};

(function (DD) {
    // SHA-256 in plain JavaScript, so hashing also works when the page is opened from a file.
    const K = new Uint32Array([
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ]);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));

    DD.sha256 = function (text) {
        const msg = new TextEncoder().encode(text);
        const total = ((msg.length + 9 + 63) >> 6) << 6;
        const buf = new Uint8Array(total);
        buf.set(msg);
        buf[msg.length] = 0x80;
        const dv = new DataView(buf.buffer);
        const bits = msg.length * 8;
        dv.setUint32(total - 4, bits >>> 0);
        dv.setUint32(total - 8, Math.floor(bits / 0x100000000));
        const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
        const W = new Uint32Array(64);
        for (let off = 0; off < total; off += 64) {
            for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
            for (let i = 16; i < 64; i++) {
                const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
                const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
                W[i] = W[i - 16] + s0 + W[i - 7] + s1;
            }
            let [a, b, c, d, e, f, g, h] = H;
            for (let i = 0; i < 64; i++) {
                const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
                const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
                h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
            }
            H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
        }
        return Array.from(H, x => x.toString(16).padStart(8, '0')).join('');
    };

    // Seeded random numbers (mulberry32): every player gets the same evidence.
    DD.rng = function (seed) {
        let s = seed >>> 0;
        return function () {
            s = (s + 0x6D2B79F5) | 0;
            let t = Math.imul(s ^ (s >>> 15), 1 | s);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    };

    DD.lines = function (text) {
        if (text === '' || text == null) return [];
        return text.replace(/\n$/, '').split('\n');
    };

    DD.normalize = function (path, cwd, home) {
        if (path === '~' || path.startsWith('~/')) path = home + path.slice(1);
        const abs = path.startsWith('/') ? path : (cwd === '/' ? '' : cwd) + '/' + path;
        const parts = [];
        for (const p of abs.split('/')) {
            if (!p || p === '.') continue;
            if (p === '..') parts.pop(); else parts.push(p);
        }
        return '/' + parts.join('/');
    };

    DD.globToRegExp = function (glob, flags) {
        let src = '';
        for (const ch of glob) {
            if (ch === '*') src += '.*';
            else if (ch === '?') src += '.';
            else src += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        }
        return new RegExp('^' + src + '$', flags || '');
    };

    const DEFAULT_TIME = '2025-03-14 08:00';

    class VFS {
        constructor() {
            this.root = { type: 'dir', name: '', parent: null, children: Object.create(null), mtime: DEFAULT_TIME, owner: 'root' };
        }

        get(abs) {
            let node = this.root;
            for (const p of abs.split('/')) {
                if (!p) continue;
                if (node.type !== 'dir' || !node.children[p]) return null;
                node = node.children[p];
            }
            return node;
        }

        mkdirp(abs, owner) {
            let node = this.root;
            for (const p of abs.split('/')) {
                if (!p) continue;
                if (!node.children[p]) {
                    node.children[p] = { type: 'dir', name: p, parent: node, children: Object.create(null), mtime: DEFAULT_TIME, owner: owner || 'detective' };
                }
                node = node.children[p];
            }
            return node;
        }

        write(abs, data) {
            const cut = abs.lastIndexOf('/');
            const dir = this.mkdirp(abs.slice(0, cut) || '/', data && data.owner);
            const name = abs.slice(cut + 1);
            if (!name) return dir;
            const spec = typeof data === 'string' ? { content: data } : data;
            const node = Object.assign({ type: 'file', name, parent: dir, content: '', mtime: DEFAULT_TIME, owner: 'detective' }, spec);
            dir.children[name] = node;
            return node;
        }

        remove(node) {
            if (node.parent) delete node.parent.children[node.name];
        }

        pathOf(node) {
            const parts = [];
            for (let n = node; n && n.parent; n = n.parent) parts.unshift(n.name);
            return '/' + parts.join('/');
        }

        list(dir, hidden) {
            return Object.keys(dir.children)
                .filter(n => hidden || !n.startsWith('.'))
                .sort((a, b) => a.replace(/^\./, '').localeCompare(b.replace(/^\./, ''), 'en', { sensitivity: 'base' }));
        }

        size(node) {
            if (node.type === 'dir') return 4096;
            if (node.size != null) return node.size;
            return new TextEncoder().encode(node.content).length;
        }

        walk(node, fn, rel) {
            rel = rel || '';
            fn(node, rel);
            if (node.type === 'dir') {
                for (const name of this.list(node, true)) {
                    this.walk(node.children[name], fn, rel ? rel + '/' + name : name);
                }
            }
        }
    }
    DD.VFS = VFS;
    DD.DEFAULT_TIME = DEFAULT_TIME;

    // Longest common subsequence diff on lines.
    DD.diffLines = function (a, b) {
        const n = a.length, m = b.length;
        const dp = [];
        for (let i = 0; i <= n; i++) dp.push(new Int32Array(m + 1));
        for (let i = n - 1; i >= 0; i--) {
            for (let j = m - 1; j >= 0; j--) {
                dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
            }
        }
        const ops = [];
        let i = 0, j = 0;
        while (i < n && j < m) {
            if (a[i] === b[j]) { ops.push({ op: ' ', line: a[i], ai: i, bi: j }); i++; j++; }
            else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ op: '-', line: a[i], ai: i }); i++; }
            else { ops.push({ op: '+', line: b[j], bi: j }); j++; }
        }
        while (i < n) { ops.push({ op: '-', line: a[i], ai: i }); i++; }
        while (j < m) { ops.push({ op: '+', line: b[j], bi: j }); j++; }
        return ops;
    };

    // Unified diff hunks with three lines of context.
    DD.unified = function (aText, bText, ctx) {
        ctx = ctx == null ? 3 : ctx;
        const ops = DD.diffLines(DD.lines(aText), DD.lines(bText));
        const out = [];
        let k = 0;
        while (k < ops.length) {
            if (ops[k].op === ' ') { k++; continue; }
            const start = Math.max(0, k - ctx);
            let last = k;
            for (let t = k; t < ops.length; t++) {
                if (ops[t].op !== ' ') last = t;
                else if (t - last > 2 * ctx) break;
            }
            const end = Math.min(ops.length, last + ctx + 1);
            const before = ops.slice(0, start);
            const slice = ops.slice(start, end);
            const aLine = before.filter(o => o.op !== '+').length + 1;
            const bLine = before.filter(o => o.op !== '-').length + 1;
            const aLen = slice.filter(o => o.op !== '+').length;
            const bLen = slice.filter(o => o.op !== '-').length;
            const range = (start, len) => (len === 1 ? `${start}` : `${len ? start : start - 1},${len}`);
            out.push(`@@ -${range(aLine, aLen)} +${range(bLine, bLen)} @@`);
            for (const o of slice) out.push(o.op + o.line);
            k = end;
        }
        return out;
    };
})(window.DD);
