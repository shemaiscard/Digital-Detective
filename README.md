# Digital Detective: Scavenger Hunt

**Live Demo:** [scavengerterminal.netlify.app](https://scavengerterminal.netlify.app/)

A browser-based terminal forensics game with CRT scanline effects. You play as a digital detective piecing together evidence using Unix-style commands typed directly into an in-browser terminal.

## Gameplay

Type commands into the terminal to investigate the scene, examine evidence files, and uncover what happened. The game rewards curiosity and knowledge of Unix command syntax.

### Available Commands

| Command | Action |
|---|---|
| `ls` | List files in the current directory |
| `cat <file>` | Read a file |
| `cd <dir>` | Change directory |
| `pwd` | Show current path |
| `help` | Show available commands |
| `clear` | Clear the terminal |

## Features

- Authentic terminal aesthetic with CRT scanline and phosphor glow effects
- Branching evidence discovery across directories
- Keyboard-driven gameplay, no mouse required
- Responsive layout for desktop and mobile
- No install, no login, runs entirely in the browser

## Tech Stack

| Layer | Technology |
|---|---|
| Language | Vanilla JavaScript |
| Styling | CSS3 (CRT effects, animations) |
| Font | JetBrains Mono |
| Hosting | Netlify |

## Run Locally

No server or build step needed. Open `index.html` in any modern browser.

## Deploy

Deploys as a static site. Connect this repo to [Netlify](https://app.netlify.com) and set publish directory to `.` (root).

## License
MIT License
