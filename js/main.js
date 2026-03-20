/* ===========================
   Lluc Vivet Torras — Portfolio
   js/main.js
   =========================== */

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
      // remove top border gap when first visible item changes
      project.style.borderTop = '';
    });

    // restore top border on first visible item
    const visible = [...projects].filter(p => p.style.display !== 'none');
    if (visible.length) visible[0].style.borderTop = '1px solid var(--border)';
  });
});

// ---- Active nav link on scroll ----
const sections = document.querySelectorAll('section[id]');
const navLinks = document.querySelectorAll('.nav-links a');

const observer = new IntersectionObserver((entries) => {
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

sections.forEach(section => observer.observe(section));