# lvt.dev — Personal Portfolio

> Portfolio website for **Lluc Vivet Torras** — Computer Engineering Student at Universitat de Lleida.

Live at: `https://lvtportfolio.onrender.com/`

---

## Features

A Japanese-inspired single page with four "places", each reached with its own camera move:

| Page | Place | Transition |
|------|-------|------------|
| Home (湖) | A lake at dusk with a house on stilts, a torii and falling sakura | — |
| Projects (作品) | Underwater — koi, bubbles, seaweed, light rays | The camera dives below the surface |
| About (私) | The night sky above the lake — moon, stars, cranes | The camera rises into the sky |
| Contact (連絡) | Inside the house — round window, hanging scroll | Zoom into the lit doorway, shoji doors slide open |

- The water reacts to the cursor or touch (a ripple simulation on canvas) on the lake, underwater and in the round window
- Scroll, swipe or use the arrow keys on Home to dive (↓) or rise (↑); `Esc` goes back to the lake
- Hash routing (`#projects`, `#about`, `#contact`), so the back button and deep links work
- Respects `prefers-reduced-motion`
- No frameworks, no build step — pure HTML, CSS and JS

---

## Structure

```
portfolio/
├── index.html
├── css/
│   └── style.css       
├── js/
<<<<<<< HEAD
│   └── main.js             # Water simulation, scenes, router & transitions
=======
│   └── main.js            
>>>>>>> 81b00b915c97f82b917042be8b946137af858b05
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

- [Shippori Mincho](https://fonts.google.com/specimen/Shippori+Mincho), [Zen Kaku Gothic New](https://fonts.google.com/specimen/Zen+Kaku+Gothic+New) + [Space Mono](https://fonts.google.com/specimen/Space+Mono) — Google Fonts
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
