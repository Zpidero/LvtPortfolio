/* ===========================
   Lluc Vivet Torras — Portfolio
   js/main.js
   =========================== */

// ---- Scroll reveal ----
const revealEls = document.querySelectorAll(
  '#about .about-text p, #about .section-label, ' +
  '#projects .section-label, .project-tabs, .project-item, ' +
  '#skills .section-label, .skill-group, ' +
  '#contact .section-label, .contact-heading, .contact-intro, #contact .hero-cta'
);

revealEls.forEach((el, i) => {
  el.classList.add('reveal');
  // stagger siblings of the same parent slightly
  el.style.transitionDelay = `${(i % 6) * 60}ms`;
});

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { rootMargin: '0px 0px -80px 0px' });

revealEls.forEach(el => revealObserver.observe(el));

// ---- Project filter tabs ----
const tabs = document.querySelectorAll('.project-tab');
const projects = document.querySelectorAll('.project-item');

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    const filter = tab.dataset.filter;
    projects.forEach(project => {
      const match = filter === 'all' || project.dataset.category === filter;
      project.style.display = match ? 'grid' : 'none';
      project.style.borderTop = '';
    });

    const visible = [...projects].filter(p => p.style.display !== 'none');
    if (visible.length) visible[0].style.borderTop = '1px solid var(--border)';
  });
});


// ---- Inline Simple Icons via CDN (so they inherit currentColor) ----
document.querySelectorAll('.skill-icon-wrap[data-icon]').forEach(async el => {
  const name = el.dataset.icon;
  try {
    const res = await fetch(`https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/${name}.svg`);
    const text = await res.text();
    const tmp = document.createElement('div');
    tmp.innerHTML = text;
    const svg = tmp.querySelector('svg');
    if (svg) {
      svg.removeAttribute('fill');
      svg.style.fill = 'currentColor';
      el.appendChild(svg);
    }
  } catch (e) {}
});

const sections = document.querySelectorAll('section[id]');
const navLinks = document.querySelectorAll('.nav-links a');

const navObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      navLinks.forEach(link => {
        link.classList.toggle(
          'active',
          link.getAttribute('href') === `#${entry.target.id}`
        );
      });
    }
  });
}, { rootMargin: '-40% 0px -55% 0px' });

sections.forEach(section => navObserver.observe(section));