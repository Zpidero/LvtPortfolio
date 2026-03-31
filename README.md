# lvt.dev — Personal Portfolio

> Portfolio website for **Lluc Vivet Torras** — Computer Engineering Student at Universitat de Lleida.

Live at: `https://lvtportfolio.onrender.com/`

---

## Features

- Minimal & clean design with dark mode support
- Fully responsive (mobile, tablet, desktop)
- Scroll reveal animations
- Project filter tabs (Personal / Hackathons)
- CV download in English and Català
- No frameworks, no build step — pure HTML, CSS and JS

---

## Structure

```
portfolio/
├── index.html
├── css/
│   └── style.css       
├── js/
│   └── main.js            
├── assets/
│   ├── cv/
│   │   ├── cv-lluc-vivet-en.pdf
│   │   └── cv-lluc-vivet-ca.pdf    
│   └── images/                     
└── README.md
```

---

## Run locally

No build step needed — just open `index.html` in your browser.

For a local server with live reload:

```bash
# Python
python3 -m http.server 3000

# Node
npx serve .
```

Then open [http://localhost:3000](http://localhost:3000).

---

## Built with

- [DM Sans](https://fonts.google.com/specimen/DM+Sans) + [DM Mono](https://fonts.google.com/specimen/DM+Mono) — Google Fonts
- [Simple Icons](https://simpleicons.org/) — skill icons
- Deployed on [Render](https://render.com)

---

## CI/CD Pipeline

This project uses two GitHub Actions workflows for automated validation and deployment.

### CI — Continuous Integration (`ci.yml`)
Triggered on every `push` or `pull request` to `main`. It spins up the static site with `serve` and runs a `curl` health check to confirm the site responds correctly.

### CD — Continuous Deployment (`cd.yml`)
Triggered automatically after the CI workflow passes. It uses a **Render Deploy Hook** — a private URL stored as a GitHub secret — to trigger a new deploy on [lvtportfolio.onrender.com](https://lvtportfolio.onrender.com). Deploys only happen on `main` and only if CI succeeds.

---

## Contact

- Email: [lluc@vivet.cat](mailto:lluc@vivet.cat)
- GitHub: [github.com/Zpidero](https://github.com/Zpidero)
- LinkedIn: [in/lluc-vivet-torras](https://linkedin.com/in/lluc-vivet-torras)
