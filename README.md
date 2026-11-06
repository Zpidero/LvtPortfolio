# lvt.dev — Personal Portfolio

> Portfolio website for **Lluc Vivet Torras** — Computer Engineering Student at Universitat de Lleida.

Live at: https://zpidero.github.io/LvtPortfolio/ (GitHub Pages, from the `gh-pages` branch)

---

## Features

A Japanese-inspired portfolio built as **one continuous 3D world** (Three.js). A single camera flies between places; each page is an overlay on top of it.

| Page | Place | How you get there |
|------|-------|-------------------|
| Home (湖) | A lake at dusk: stilt house, sakura islands, floating lanterns, falling petals | — |
| Projects (作品) | Underwater: seabed, seaweed, koi, light shafts | Dive through the surface (scroll ↓) |
| About (私) | The night sky: moon, stars, clouds, cranes | Rise through the clouds (scroll ↑) |
| Contact (連絡) | Inside the house, with a kneeling samurai | Shoji doors slide open (or click the house) |
| Hidden gallery (侍の目) | A 3D world of floating photos, watched by a giant eye | Click the samurai → fly into his eye |
| Snow Run (雪の道) | A ski mini-game on the volcano | Click the mountain |

- The lake ripples under the cursor (simulation on the CPU, uploaded as a texture); clicking floats a lantern and makes a koi leap
- The samurai's head and eyes follow the cursor; he blinks
- Two samurai duel on the lake: they circle, lunge, clash in a burst of sparks and spring apart (click them to force a clash)
- Sumi-ink brush cursor (fading stroke, ensō over links, ink splatter on click)
- Hash routing (`#projects`, `#about`, `#contact`, `#gallery`, `#ski`): back button and deep links work
- Scroll / swipe / arrow keys move between places, `Esc` goes back to the lake
- 2D fallback (canvas water) when WebGL2 isn't available; respects `prefers-reduced-motion`
- No frameworks, no build step: plain HTML, CSS and ES modules (Three.js from jsDelivr via an import map)

### Gallery photos
Put photos in `assets/gallery/` and list them in `assets/gallery/photos.json` (see `assets/gallery/README.md`).

### 3D models
`assets/models/scene-models.json` lists the generated models the scene loads (samurai, sakura). Each one replaces a hand-built version, which stays as the fallback. Untextured models are coloured in code by projecting their reference image.

---

## Structure

```
portfolio/
├── index.html
├── css/style.css
├── js/
│   ├── main.js          # router, page transitions, cursor, 2D fallback, gallery & ski hookup
│   ├── scene3d.js       # the 3D world: lake, sky, underwater, house, samurai, camera flights
│   ├── eyeShader.js     # eye shader shared by the samurai and the gallery's giant eye
│   ├── gallery3d.js     # the hidden 3D photo gallery
│   └── skigame.js       # Snow Run mini-game
├── assets/
│   ├── cv/              # CVs (English, Català)
│   ├── gallery/         # photos + photos.json
│   ├── models/          # GLB models, textures, scene-models.json
│   ├── favicon.svg
│   └── og-image.jpg     # link preview image
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
