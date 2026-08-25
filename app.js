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

  // Hero Hızlı Erişim Kartları Tıklaması
  const heroNavCards = document.querySelectorAll(".hero-nav-cards .nav-card");
  heroNavCards.forEach(card => {
    card.addEventListener("click", (e) => {
      e.preventDefault();
      const filterCategory = card.dataset.filter;
      const targetBtn = document.querySelector(`.filter-btn[data-category="${filterCategory}"]`);
      if (targetBtn) {
        targetBtn.click();
      }
      const otomasyonlarSection = document.getElementById("otomasyonlar");
      if (otomasyonlarSection) {
        const navHeight = navbar ? navbar.offsetHeight : 80;
        const top = otomasyonlarSection.getBoundingClientRect().top + window.scrollY - navHeight;
        window.scrollTo({ top, behavior: "smooth" });
      }
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
    ".about-stat, .vision-card, .contact-card, .about-text, .product-card, .pricing-card, .faq-item, .problem-card"
  ).forEach(el => {
    el.classList.add("reveal");
    observer.observe(el);
  });
}

// ── 1. İnteraktif Tasarruf & ROI Hesaplayıcı ──
function initRoiCalculator() {
  const sliderMessages = document.getElementById("sliderMessages");
  const sliderTime = document.getElementById("sliderTime");
  const sliderWage = document.getElementById("sliderWage");

  const valMessages = document.getElementById("valMessages");
  const valTime = document.getElementById("valTime");
  const valWage = document.getElementById("valWage");

  const resHours = document.getElementById("resHours");
  const resSavings = document.getElementById("resSavings");
  const resRevenue = document.getElementById("resRevenue");
  const roiWaBtn = document.getElementById("roiWaBtn");

  if (!sliderMessages || !sliderTime || !sliderWage) return;

  function calculateROI() {
    const msgs = parseInt(sliderMessages.value);
    const timePerMsg = parseInt(sliderTime.value);
    const wage = parseInt(sliderWage.value);

    // Günlük & Aylık Hesaplamalar (Ayda 25 iş günü varsayımı)
    const dailyHours = (msgs * timePerMsg) / 60;
    const monthlyHours = Math.round(dailyHours * 25);
    const monthlySavings = Math.round(monthlyHours * wage);
    const monthlyRevenue = Math.round(monthlySavings * 0.75);

    // UI Güncelleme
    valMessages.textContent = `${msgs} mesaj`;
    valTime.textContent = `${timePerMsg} dk`;
    valWage.textContent = `₺${wage.toLocaleString("tr-TR")} / saat`;

    resHours.textContent = `${monthlyHours.toLocaleString("tr-TR")} Saat`;
    resSavings.textContent = `₺${monthlySavings.toLocaleString("tr-TR")}`;
    resRevenue.textContent = `₺${monthlyRevenue.toLocaleString("tr-TR")}+`;

    // WhatsApp Linki Oluştur
    const waText = encodeURIComponent(
      `Merhaba, web sitenizdeki Tasarruf Hesaplayıcıyı kullandım. Günde ${msgs} mesaj ve saatlik ₺${wage} maliyet ile ayda ${monthlyHours} saat ve ₺${monthlySavings.toLocaleString("tr-TR")} tasarruf hesabı aldım. 1 ay ücretsiz denemek istiyorum.`
    );
    roiWaBtn.href = `https://wa.me/905530551369?text=${waText}`;
  }

  [sliderMessages, sliderTime, sliderWage].forEach(input => {
    input.addEventListener("input", calculateROI);
  });

  calculateROI();
}

// ── 2. Canlı Hero Chat Simülatörü ──
function initChatSimulator() {
  const simChips = document.querySelectorAll(".sim-chip");
  const chatBody = document.querySelector(".chat-body");

  if (!simChips.length || !chatBody) return;

  const scenarios = {
    fiyat: {
      user: "Otomasyon fiyatları ne kadar?",
      bot: "Aylık paketlerimiz ₺990'den başlamaktadır. Üstelik şu an kampanyamız kapsamında tüm paketlerimiz 1 ay boyunca ücretsizdir! 🎁"
    },
    randevu: {
      user: "Takvimimle otomatik randevu oluşturabilir miyim?",
      bot: "Evet! Google Takvim entegrasyonu sayesinde müşterileriniz WhatsApp üzerinden boş saatlerinizi görüp anında randevu oluşturabilir."
    },
    stok: {
      user: "Stok azaldığında WhatsApp bildirimi gönderiyor mu?",
      bot: "Kesinlikle! Market Stock Control otomasyonumuz kritik eşiğin altına düşen ürünleri 7/24 takip edip yetkili ekibinize anlık mesaj atar."
    },
    dm: {
      user: "Instagram Reels yorumlarına otomatik DM atabiliyor musunuz?",
      bot: "Evet! Gönderinize 'FİYAT' yazan herkese 2 saniye içinde özel teklif ve katalog linkinizi DM kutusuna düşürüyoruz."
    }
  };

  simChips.forEach(chip => {
    chip.addEventListener("click", () => {
      const scenarioKey = chip.dataset.scenario;
      const data = scenarios[scenarioKey];
      if (!data) return;

      const nowStr = new Date().toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });

      // Kullanıcı Mesajını Ekle
      const userMsgDiv = document.createElement("div");
      userMsgDiv.className = "chat-msg msg-user";
      userMsgDiv.innerHTML = `<p>${data.user}</p><span class="chat-time">${nowStr}</span>`;
      chatBody.appendChild(userMsgDiv);

      // Yazıyor efekti ekle
      const typingDiv = document.createElement("div");
      typingDiv.className = "chat-msg msg-bot typing-indicator-msg";
      typingDiv.innerHTML = `<p><em>Otomasyon AI yazıyor...</em></p>`;
      chatBody.appendChild(typingDiv);

      chatBody.scrollTop = chatBody.scrollHeight;

      // 700ms sonra Bot Yanıtını Ekle
      setTimeout(() => {
        typingDiv.remove();
        const botMsgDiv = document.createElement("div");
        botMsgDiv.className = "chat-msg msg-bot";
        botMsgDiv.innerHTML = `<p>${data.bot}</p><span class="chat-time">${nowStr} <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg></span>`;
        chatBody.appendChild(botMsgDiv);
        chatBody.scrollTop = chatBody.scrollHeight;
      }, 700);
    });
  });
}

// ── 3. Canlı Ürün Arama ──
function initProductSearch() {
  const searchInput = document.getElementById("catalogSearchInput");
  const clearBtn = document.getElementById("searchClearBtn");
  const productCards = document.querySelectorAll(".product-card");

  if (!searchInput) return;

  searchInput.addEventListener("input", () => {
    const query = searchInput.value.toLowerCase().trim();

    if (query.length > 0) {
      clearBtn.style.display = "block";
    } else {
      clearBtn.style.display = "none";
    }

    productCards.forEach(card => {
      const text = card.textContent.toLowerCase();
      if (text.includes(query)) {
        card.style.display = "flex";
        card.style.opacity = "1";
        card.style.transform = "translateY(0)";
      } else {
        card.style.opacity = "0";
        card.style.transform = "translateY(15px)";
        setTimeout(() => {
          if (!card.textContent.toLowerCase().includes(searchInput.value.toLowerCase().trim())) {
            card.style.display = "none";
          }
        }, 150);
      }
    });
  });

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      searchInput.value = "";
      clearBtn.style.display = "none";
      searchInput.dispatchEvent(new Event("input"));
    });
  }
}

// ── 4. Özel Paket Oluşturucu Modal ──
function initCustomPackageBuilder() {
  const modal = document.getElementById("customPackageModal");
  const openBtn = document.getElementById("btnOpenCustomPkg");
  const closeBtn = document.getElementById("pkgModalClose");
  const modChecks = document.querySelectorAll(".pkg-mod-check");

  const pkgSelectedCount = document.getElementById("pkgSelectedCount");
  const pkgSelectedList = document.getElementById("pkgSelectedList");
  const pkgOrigPrice = document.getElementById("pkgOrigPrice");
  const pkgDiscount = document.getElementById("pkgDiscount");
  const pkgTotalPrice = document.getElementById("pkgTotalPrice");
  const pkgWaBtn = document.getElementById("pkgWaBtn");

  if (!modal) return;

  function updatePackageCalculation() {
    let totalOrig = 0;
    let selectedNames = [];

    modChecks.forEach(check => {
      if (check.checked) {
        const price = parseInt(check.dataset.price);
        totalOrig += price;
        selectedNames.push(check.value);
      }
    });

    const count = selectedNames.length;
    // Eğer 2 veya daha fazla modül seçildiyse %20 indirim uygula
    const discountRate = count >= 2 ? 0.20 : 0;
    const discountAmount = Math.round(totalOrig * discountRate);
    const finalPrice = totalOrig - discountAmount;

    // UI Güncelleme
    if (pkgSelectedCount) pkgSelectedCount.textContent = `${count} Modül`;

    if (pkgSelectedList) {
      pkgSelectedList.innerHTML = "";
      if (count === 0) {
        pkgSelectedList.innerHTML = `<li style="color:var(--color-text-muted);">Lütfen en az 1 modül seçin.</li>`;
      } else {
        selectedNames.forEach(name => {
          const li = document.createElement("li");
          li.textContent = `✓ ${name}`;
          pkgSelectedList.appendChild(li);
        });
      }
    }

    if (pkgOrigPrice) pkgOrigPrice.textContent = `₺${totalOrig.toLocaleString("tr-TR")} /ay`;
    if (pkgDiscount) pkgDiscount.textContent = discountRate > 0 ? `-₺${discountAmount.toLocaleString("tr-TR")}` : "₺0";
    if (pkgTotalPrice) pkgTotalPrice.textContent = `₺${finalPrice.toLocaleString("tr-TR")} /ay`;

    // WhatsApp Bağlantısı
    const waText = encodeURIComponent(
      `Merhaba, özel paket sihirbazınızdan teklif oluşturdum:\n` +
      `Seçilen Modüller: ${selectedNames.join(", ")}\n` +
      `Tahmini Fiyat: ₺${finalPrice.toLocaleString("tr-TR")} /ay (İlk 1 Ay Ücretsiz Kampanyası dahil)\n` +
      `Detayları görüşebilir miyiz?`
    );
    if (pkgWaBtn) pkgWaBtn.href = `https://wa.me/905530551369?text=${waText}`;
  }

  if (openBtn) {
    openBtn.addEventListener("click", () => {
      modal.classList.add("active");
      document.body.style.overflow = "hidden";
      updatePackageCalculation();
    });
  }

  function closeModal() {
    modal.classList.remove("active");
    document.body.style.overflow = "";
  }

  if (closeBtn) closeBtn.addEventListener("click", closeModal);

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  modChecks.forEach(check => {
    check.addEventListener("change", updatePackageCalculation);
  });

  updatePackageCalculation();
}

// ── 5. Web İletişim Formu ──
function initContactForm() {
  const form = document.getElementById("contactForm");
  const statusMsg = document.getElementById("formStatus");

  if (!form) return;

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const name = document.getElementById("formName").value.trim();
    const phone = document.getElementById("formPhone").value.trim();
    const service = document.getElementById("formService").value;
    const msg = document.getElementById("formMessage").value.trim();

    const waText = encodeURIComponent(
      `Merhaba, web sitenizdeki İletişim Formu üzerinden mesaj gönderiyorum:\n\n` +
      `👤 Ad Soyad: ${name}\n` +
      `📞 Telefon: ${phone}\n` +
      `📦 İlgilenilen Otomasyon: ${service}\n` +
      (msg ? `📝 Mesaj: ${msg}\n\n` : "") +
      `1 ay ücretsiz deneme ve detaylar hakkında görüşmek istiyorum.`
    );

    const waUrl = `https://wa.me/905530551369?text=${waText}`;

    statusMsg.className = "form-status-msg success";
    statusMsg.innerHTML = `✓ Teşekkürler ${name}! Mesajınız alındı. WhatsApp üzerinden bilgi aktarmak üzere yönlendiriliyorsunuz...`;

    setTimeout(() => {
      window.open(waUrl, "_blank");
      form.reset();
      setTimeout(() => {
        statusMsg.style.display = "none";
      }, 5000);
    }, 1200);
  });
}

// ── 6. E-Posta Akıllı Yönlendirme (Masaüstü & Mobil Uyumlu) ──
function initEmailModal() {
  const emailCard = document.getElementById("emailContactCard");
  if (!emailCard) return;

  emailCard.addEventListener("click", (e) => {
    e.preventDefault();

    // E-posta adresini panoya kopyala
    if (navigator.clipboard) {
      navigator.clipboard.writeText("platform@otomasyonmarketi.net").catch(() => {});
    }

    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    if (isMobile) {
      window.location.href = "mailto:platform@otomasyonmarketi.net?subject=Otomasyon%20Market%20Bilgi%20ve%20Teklif%20Talebi&body=Merhaba,%20otomasyon%20çözümleriniz%20hakkında%20bilgi%20almak%20istiyorum.";
    } else {
      // Masaüstünde doğrudan Gmail Web yeni e-posta oluşturma sekmesini açar
      window.open("https://mail.google.com/mail/?view=cm&fs=1&to=platform@otomasyonmarketi.net&su=Otomasyon%20Market%20Bilgi%20ve%20Teklif%20Talebi&body=Merhaba,%20otomasyon%20çözümleriniz%20hakkında%20bilgi%20almak%20istiyorum.", "_blank");
    }
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
  initRoiCalculator();
  initChatSimulator();
  initProductSearch();
  initCustomPackageBuilder();
  initContactForm();
  initEmailModal();
});


