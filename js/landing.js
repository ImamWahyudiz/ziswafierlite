// ═══════════════════════════════════════════════════════════════════════════════
// Landing Page — Interactivity, Editions Toggle, Genuine Contact Action
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Scroll Animations (IntersectionObserver) ──────────────────────────────────

function initScrollAnimations() {
    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('visible');
                    observer.unobserve(entry.target);
                }
            });
        },
        { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
    );

    document.querySelectorAll('[data-animate]').forEach((el) => {
        observer.observe(el);
    });
}

// ─── Theme Toggle ──────────────────────────────────────────────────────────────

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const icon = document.getElementById('theme-icon');
    if (icon) {
        icon.className = theme === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
    }
    try { localStorage.setItem('ziswaf_theme', theme); } catch (e) {}
}

function initTheme() {
    const saved = localStorage.getItem('ziswaf_theme');
    const current = saved || document.documentElement.getAttribute('data-theme') || (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    applyTheme(current);

    const btn = document.getElementById('btn-theme-toggle');
    if (btn) {
        btn.onclick = (e) => {
            e.preventDefault();
            const cur = document.documentElement.getAttribute('data-theme') || 'dark';
            applyTheme(cur === 'dark' ? 'light' : 'dark');
        };
    }
}

// ─── Genuine Contact Form (Direct Email Mailto) ───────────────────────────────

function initContactForm() {
    const form = document.getElementById('contact-form');
    if (!form) return;

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = (document.getElementById('contact-name')?.value || '').trim();
        const email = (document.getElementById('contact-email')?.value || '').trim();
        const org = (document.getElementById('contact-org')?.value || '').trim();
        const message = (document.getElementById('contact-message')?.value || '').trim();

        if (!name || !email || !message) {
            showToast('Mohon lengkapi nama, email, dan pesan Anda.', 'error');
            return;
        }

        const subject = encodeURIComponent(`[ZISWAFier Konsultasi] ${org ? org + ' - ' : ''}${name}`);
        const body = encodeURIComponent(
            `Nama: ${name}\n` +
            `Email: ${email}\n` +
            `Lembaga / Organisasi: ${org || '-'}\n\n` +
            `Pesan / Kebutuhan:\n${message}\n\n` +
            `-- Dikirim dari landing page ZISWAFier`
        );

        showToast('Membuka aplikasi email resmi Anda...', 'info');
        window.location.href = `mailto:indahtrihartini14@gmail.com?subject=${subject}&body=${body}`;
    });
}

// ─── Toast ─────────────────────────────────────────────────────────────────────

function showToast(message, type = 'info') {
    const root = document.getElementById('toast-root');
    if (!root) return;
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = message;
    root.appendChild(t);
    setTimeout(() => { t.classList.add('fadeout'); setTimeout(() => t.remove(), 300); }, 4000);
}

// ─── Mobile Navigation ─────────────────────────────────────────────────────────

function initMobileMenu() {
    const btn = document.getElementById('btn-mobile-menu');
    const menu = document.getElementById('navbar-menu');
    const icon = document.getElementById('menu-icon');
    if (!btn || !menu) return;

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isActive = menu.classList.toggle('is-active');
        if (icon) {
            icon.className = isActive ? 'fa-solid fa-xmark' : 'fa-solid fa-bars';
        }
    });

    // Close menu when clicking a link
    menu.querySelectorAll('.nav-link').forEach((link) => {
        link.addEventListener('click', () => {
            menu.classList.remove('is-active');
            if (icon) icon.className = 'fa-solid fa-bars';
        });
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!menu.contains(e.target) && !btn.contains(e.target)) {
            menu.classList.remove('is-active');
            if (icon) icon.className = 'fa-solid fa-bars';
        }
    });
}

// ─── Edition Toggle (Demo vs Full) ─────────────────────────────────────────────

function initEditionToggle() {
    const btnDemo = document.getElementById('btn-toggle-demo');
    const btnFull = document.getElementById('btn-toggle-full');
    const cardDemo = document.getElementById('card-demo');
    const cardFull = document.getElementById('card-full');
    const hintText = document.getElementById('edition-hint-text');
    const hintBar = document.getElementById('edition-hint-bar');
    const table = document.getElementById('matrix-table');

    if (!btnDemo || !btnFull || !cardDemo || !cardFull) return;

    function setEdition(mode) {
        if (mode === 'full') {
            btnFull.classList.add('active');
            btnFull.setAttribute('aria-selected', 'true');
            btnDemo.classList.remove('active');
            btnDemo.setAttribute('aria-selected', 'false');

            cardFull.classList.add('is-highlighted');
            cardDemo.classList.remove('is-highlighted');

            if (hintText && hintBar) {
                hintBar.innerHTML = '<i class="fa-solid fa-shield-halved text-accent"></i> <span id="edition-hint-text">Mode Aktif: <b>Versi Full (Enterprise)</b> — Sistem komprehensif multi-user, approval kadiv, closing date lock &amp; database terpusat.</span>';
            }

            if (table) {
                table.classList.add('show-full-only');
                table.classList.remove('show-demo-only');
                table.querySelectorAll('.col-demo').forEach(el => el.classList.remove('highlighted-col'));
                table.querySelectorAll('.col-full').forEach(el => el.classList.add('highlighted-col-full'));
            }
        } else {
            btnDemo.classList.add('active');
            btnDemo.setAttribute('aria-selected', 'true');
            btnFull.classList.remove('active');
            btnFull.setAttribute('aria-selected', 'false');

            cardDemo.classList.add('is-highlighted');
            cardFull.classList.remove('is-highlighted');

            if (hintText && hintBar) {
                hintBar.innerHTML = '<i class="fa-solid fa-circle-check text-emerald"></i> <span id="edition-hint-text">Mode Aktif: <b>Versi Demo (Lite)</b> — 100% Client-Side di browser, privat, tanpa server &amp; gratis dipakai langsung.</span>';
            }

            if (table) {
                table.classList.add('show-demo-only');
                table.classList.remove('show-full-only');
                table.querySelectorAll('.col-full').forEach(el => el.classList.remove('highlighted-col-full'));
                table.querySelectorAll('.col-demo').forEach(el => el.classList.add('highlighted-col'));
            }
        }
    }

    btnDemo.addEventListener('click', () => setEdition('demo'));
    btnFull.addEventListener('click', () => setEdition('full'));

    // Initialize: check hash on load or default to demo
    if (window.location.hash === '#editions-full') {
        setEdition('full');
    } else {
        setEdition('demo');
    }
}

// ─── Initialize ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initMobileMenu();
    initScrollAnimations();
    initEditionToggle();
    initContactForm();
});

