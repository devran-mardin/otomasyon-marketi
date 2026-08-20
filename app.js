/* ═══════════════════════════════════════════════════
   OTOMASYON MARKET — APP.JS
   Navbar, scroll animasyonları, aktif link takibi
   ═══════════════════════════════════════════════════ */

// ── DOM ──
const navbar = document.getElementById("navbar");
const hamburger = document.getElementById("hamburger");
const navLinks = document.getElementById("navLinks");
const navItems = document.querySelectorAll(".nav-link");
const sections = document.querySelectorAll("section[id]");

// ── Hamburger Menü ──
hamburger.addEventListener("click", () => {
  hamburger.classList.toggle("active");
  navLinks.classList.toggle("active");
});

// Menü linki tıklanınca mobil menüyü kapat
navItems.forEach(link => {
  link.addEventListener("click", () => {
    hamburger.classList.remove("active");
    navLinks.classList.remove("active");
  });
});

// ── Navbar Scroll Efekti ──
window.addEventListener("scroll", () => {
  if (window.scrollY > 50) {
    navbar.classList.add("scrolled");
  } else {
    navbar.classList.remove("scrolled");
  }
}, { passive: true });

// ── Aktif Navigasyon Linki ──
function updateActiveNav() {
  const scrollY = window.scrollY + 100;

  sections.forEach(section => {
    const top = section.offsetTop - 100;
    const bottom = top + section.offsetHeight;
    const id = section.getAttribute("id");

    if (scrollY >= top && scrollY < bottom) {
      navItems.forEach(link => {
        link.classList.remove("active");
        if (link.getAttribute("href") === `#${id}`) {
          link.classList.add("active");
        }
      });
    }
  });
}

window.addEventListener("scroll", updateActiveNav, { passive: true });

// ── Smooth Scroll ──
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener("click", function(e) {
    const href = this.getAttribute("href");
    if (href === "#") return;
    const target = document.querySelector(href);
    if (target) {
      e.preventDefault();
      const navHeight = navbar.offsetHeight;
      const top = target.getBoundingClientRect().top + window.scrollY - navHeight;
      window.scrollTo({ top, behavior: "smooth" });
    }
  });
});

// ── Sayı Animasyonu ──
function animateCounters() {
  const counters = document.querySelectorAll("[data-count]");

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const el = entry.target;
        const target = parseInt(el.dataset.count);
        const duration = 1200;
        const start = performance.now();

        function update(now) {
          const elapsed = now - start;
          const progress = Math.min(elapsed / duration, 1);
          const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
          el.textContent = Math.round(target * eased);
          if (progress < 1) requestAnimationFrame(update);
        }

        requestAnimationFrame(update);
        observer.unobserve(el);
      }
    });
  }, { threshold: 0.5 });

  counters.forEach(c => observer.observe(c));
}

// ── Kategori Filtreleme ──
function initCategoryFilters() {
  const filterBtns = document.querySelectorAll(".filter-btn");
  const productCards = document.querySelectorAll(".product-card");

  filterBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      filterBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");

      const category = btn.dataset.category;

      productCards.forEach(card => {
        if (category === "all" || card.dataset.category === category) {
          card.style.display = "flex";
          setTimeout(() => {
            card.style.opacity = "1";
            card.style.transform = "translateY(0)";
          }, 50);
        } else {
          card.style.opacity = "0";
          card.style.transform = "translateY(15px)";
          setTimeout(() => {
            card.style.display = "none";
          }, 200);
        }
      });
    });
  });
}

// ── Ürün Detay Modalı ──
function initProductModal() {
  const modal = document.getElementById("productModal");
  const modalClose = document.getElementById("modalClose");
  const openBtns = document.querySelectorAll(".btn-open-modal");

  const modalTitle = document.getElementById("modalTitle");
  const modalPlatform = document.getElementById("modalPlatform");
  const modalPrice = document.getElementById("modalPrice");
  const modalDesc = document.getElementById("modalDesc");
  const modalFeatures = document.getElementById("modalFeatures");
  const modalOrderBtn = document.getElementById("modalOrderBtn");

  openBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const title = btn.dataset.title;
      const platform = btn.dataset.platform;
      const price = btn.dataset.price;
      const desc = btn.dataset.desc;
      const features = btn.dataset.features ? btn.dataset.features.split(",") : [];

      modalTitle.textContent = title;
      modalPlatform.textContent = platform;
      modalPrice.textContent = price;
      modalDesc.textContent = desc;

      // Özellik listesini doldur
      modalFeatures.innerHTML = "";
      features.forEach(feat => {
        const li = document.createElement("li");
        li.innerHTML = `<span class="check" style="color:#25d366;font-weight:800;">✓</span> ${feat.trim()}`;
        modalFeatures.appendChild(li);
      });

      // Dinamik WhatsApp Linki Oluştur
      const waText = encodeURIComponent(`Merhaba, '${title}' (${price}) otomasyonu hakkında bilgi almak ve sipariş vermek istiyorum.`);
      modalOrderBtn.href = `https://wa.me/905530551369?text=${waText}`;

      // Modalı Aç
      modal.classList.add("active");
      document.body.style.overflow = "hidden";
    });
  });

  // Kapatma İşlemleri
  function closeModal() {
    modal.classList.remove("active");
    document.body.style.overflow = "";
  }

  if (modalClose) modalClose.addEventListener("click", closeModal);

  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal && modal.classList.contains("active")) {
      closeModal();
    }
  });
}

// ── SSS Akordeon ──
function initFAQAccordion() {
  const faqItems = document.querySelectorAll(".faq-item");

  faqItems.forEach(item => {
    const question = item.querySelector(".faq-question");
    const answer = item.querySelector(".faq-answer");

    question.addEventListener("click", () => {
      const isActive = item.classList.contains("active");

      // Diğerlerini kapat
      faqItems.forEach(other => {
        other.classList.remove("active");
        const otherAns = other.querySelector(".faq-answer");
        if (otherAns) otherAns.style.maxHeight = null;
      });

      // Tıklananı aç/kapat
      if (!isActive) {
        item.classList.add("active");
        answer.style.maxHeight = answer.scrollHeight + "px";
      }
    });
  });
}

// ── Scroll Reveal ──
function initScrollReveal() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: "0px 0px -40px 0px" });

  document.querySelectorAll(
    ".about-stat, .vision-card, .contact-card, .about-text, .product-card, .pricing-card, .faq-item"
  ).forEach(el => {
    el.classList.add("reveal");
    observer.observe(el);
  });
}

// ── Init ──
document.addEventListener("DOMContentLoaded", () => {
  animateCounters();
  initScrollReveal();
  updateActiveNav();
  initCategoryFilters();
  initProductModal();
  initFAQAccordion();
});

