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
├── index.html              # Main HTML
├── css/
│   └── style.css           # All styles, dark mode, animations, responsive
├── js/
│   └── main.js             # Scroll reveal, project filter tabs, active nav
├── assets/
│   ├── cv/
│   │   ├── cv-lluc-vivet-en.pdf    ← English CV (add yours here)
│   │   └── cv-lluc-vivet-ca.pdf    ← Catalan CV (add yours here)
│   └── images/                     ← Any images you want to add
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

## Contact

- Email: [lluc@vivet.cat](mailto:lluc@vivet.cat)
- GitHub: [github.com/Zpidero](https://github.com/Zpidero)
- LinkedIn: [in/lluc-vivet-torras](https://linkedin.com/in/lluc-vivet-torras)
