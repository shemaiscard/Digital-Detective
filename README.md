# Digital Detective: Scavenger Hunt

**Play it:** [scavengerterminal.netlify.app](https://scavengerterminal.netlify.app/)

A detective game you play by typing real shell and git commands. Each case drops you into a small Linux machine with files, logs and git repositories. You find the answer the way you would on a real server: search, filter, compare, and read the history.

The terminal is an emulator written for this game. It runs in the browser, needs no install or account, and keeps your progress on your device.

## How to play

1. Open the game. The first case starts on its own.
2. Read the brief at the top of the terminal or in the **Case file** panel.
3. Type commands. Hashes, file names and examples in the output are clickable.
4. Answer the questions in the panel, or type `answer 1 YOUR ANSWER`.
5. Stuck? `hint` gives the next hint for the first open question. Each hint costs 10 points.

A question is worth up to 100 points: minus 10 per hint and 5 per wrong answer, never below 20. A case with no hints earns 3 stars.

Useful keys: **Tab** completes commands, paths and branch names, **Up/Down** walks your history, **Ctrl+L** clears the screen and **Ctrl+C** drops the current line. On phones, a row of keys above the keyboard gives Tab, history, `|`, `-`, `/`, `~`, `..` and `>`.

## Cases

| # | Case | Track | Level | What you practice |
| --- | --- | --- | --- | --- |
| 1 | Orientation | Shell | Easy | `pwd`, `ls -a`, `cd`, `cat`, hidden files |
| 2 | The Haystack | Shell | Easy | `grep -n`, `grep -c`, `grep -i`, pipes into `wc -l` |
| 3 | Night Shift | Shell | Medium | Reading an auth log with `grep`, `cut`, `sort`, `uniq -c` and `head` |
| 4 | Chain of Custody | Shell | Medium | `sha256sum -c`, `diff`, `ls -l`, `file`, `base64 -d` |
| 5 | Leaked Key | Git | Medium | `git log -p`, `git log -S`, `git show HASH:FILE` |
| 6 | Lost Branch | Git | Hard | `git reflog`, recovering a deleted branch with `git branch NAME HASH` |
| 7 | Blame Game | Git | Hard | `git blame`, reading diffs behind commit messages, `git stash show -p` |
| 8 | Case Closed | Git | Medium | `git config`, `git switch -c`, `git add`, `git commit`, `git status` |

Every case ends with a summary of the commands it taught. `man COMMAND` and `git help SUBCOMMAND` work inside the game and list examples you can click.

## What the terminal supports

**Shell (34 commands):**

| Group | Commands |
| --- | --- |
| Navigate | `pwd` `cd` `ls` `tree` `find` |
| Read | `cat` `head` `tail` `less` `more` |
| Search and count | `grep` `wc` `sort` `uniq` `cut` |
| Inspect | `diff` `file` `stat` `sha256sum` `base64` |
| Write | `echo` `touch` `mkdir` `cp` `mv` `rm` |
| System | `whoami` `hostname` `date` `history` `clear` |
| Help | `help` `man` |

Pipes (`|`), redirects (`>`, `>>`, `<`), `&&` and `||`, globs (`*.log`), `~`, quotes and common flags work the way they do in bash.

**Git:** `status`, `add`, `commit`, `log` (with `--oneline`, `--graph`, `--all`, `-p`, `--stat`, `-S`, `--author`, `--grep`, ranges), `show`, `diff`, `branch`, `switch`, `checkout`, `restore`, `reset`, `reflog`, `blame`, `stash`, `grep`, `config`, `rev-parse` and `ls-files`. Each case builds the same commits and hashes on every run. Network commands such as `push` and `pull` explain that the lab is offline.

**Game commands:** `cases`, `play N`, `brief`, `hint`, `answer N TEXT`, `progress`, `restart`.

## Run locally

The pages load assets from the site root, so serve the folder instead of opening the file directly:

```bash
git clone https://github.com/shemaiscard/Digital-Detective.git
cd Digital-Detective
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Tech

| Part | Details |
| --- | --- |
| Language | Vanilla JavaScript, no framework, no build step |
| Shell | Tokenizer, pipelines and redirects over an in-memory file system (`js/core.js`, `js/shell.js`) |
| Git | Commits, branches, index, reflog, stash and a line diff in JavaScript (`js/git.js`) |
| Hashing | SHA-256 implemented in `js/core.js`, used for `sha256sum` and commit IDs |
| Cases | Data and answer checks in `js/cases.js`, with seeded random data so every run is the same |
| App | Installable PWA with an offline cache (`sw.js`), progress in `localStorage` |
| Styling | CSS with JetBrains Mono, an optional CRT effect, and reduced motion respected |
| Hosting | Netlify, publish directory `.` |

## License

MIT License
