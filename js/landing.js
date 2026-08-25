// ═══════════════════════════════════════════════════════════════════════════════
// Landing Page — Animations, Particles, Contact Form
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Particles ────────────────────────────────────────────────────────────────

function initParticles() {
    const container = document.getElementById('hero-particles');
    if (!container) return;
    const count = window.innerWidth < 768 ? 20 : 40;
    for (let i = 0; i < count; i++) {
        const p = document.createElement('div');
        p.className = 'hero-particle';
        p.style.left = Math.random() * 100 + '%';
        p.style.animationDuration = (8 + Math.random() * 12) + 's';
        p.style.animationDelay = Math.random() * 10 + 's';
        p.style.width = p.style.height = (2 + Math.random() * 4) + 'px';
        container.appendChild(p);
    }
}

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

function initTheme() {
    const saved = localStorage.getItem('ziswaf_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeIcon(saved);

    const btn = document.getElementById('btn-theme-toggle');
    if (btn) {
        btn.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme') || 'dark';
            const next = current === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('ziswaf_theme', next);
            updateThemeIcon(next);
        });
    }
}

function updateThemeIcon(theme) {
    const icon = document.getElementById('theme-icon');
    if (icon) {
        icon.className = theme === 'dark' ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
    }
}

// ─── Contact Form ──────────────────────────────────────────────────────────────

function initContactForm() {
    const form = document.getElementById('contact-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = document.getElementById('contact-submit');
        const originalText = submitBtn.innerHTML;

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Mengirim...';

        try {
            const formData = new FormData(form);
            const accessKey = formData.get('access_key');

            if (accessKey === 'YOUR_ACCESS_KEY_HERE') {
                // Demo mode — just show success toast
                showToast('Pesan berhasil dikirim! (Demo mode — daftar Web3Forms untuk production)', 'success');
                form.reset();
                return;
            }

            const response = await fetch('https://api.web3forms.com/submit', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (result.success) {
                showToast('Pesan berhasil dikirim! Kami akan merespon dalam 1×24 jam.', 'success');
                form.reset();
            } else {
                showToast('Gagal mengirim pesan. Silakan coba lagi atau hubungi email kami.', 'error');
            }
        } catch (error) {
            showToast('Gagal mengirim pesan. Silakan coba lagi.', 'error');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText;
        }
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

// ─── Initialize ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initParticles();
    initScrollAnimations();
    initContactForm();
});
