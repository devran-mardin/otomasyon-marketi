/* ═══════════════════════════════════════════════════
   OTOMASYON AI — BILLING & SUBSCRIPTION ENGINE
   1. İşletme Hesabı (B2B Auth & Oturum)
   2. Temel Ödeme Altyapısı (Kart Doğrulama & 3D Secure)
   3. 30 Gün Ücretsiz Deneme ve 30 Günlük Periyodik Tahsilat
   ═══════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── 1. Depolama & Veri Modelleri (Storage Keys) ──
  const STORAGE_KEYS = {
    USERS: 'otomasyon_users',
    SESSION: 'otomasyon_active_session',
    SUBSCRIPTIONS: 'otomasyon_subscriptions',
    TRANSACTIONS: 'otomasyon_transactions',
    SAVED_CARDS: 'otomasyon_saved_cards'
  };

  // Güvenli yerel veri alıcı & kaydedici
  const DB = {
    get(key, fallback = []) {
      try {
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : fallback;
      } catch (e) {
        console.error('Veri okuma hatası:', e);
        return fallback;
      }
    },
    set(key, val) {
      try {
        localStorage.setItem(key, JSON.stringify(val));
      } catch (e) {
        console.error('Veri yazma hatası:', e);
      }
    }
  };

  // Toast Bildirimi
  function showToast(message, type = 'success') {
    let container = document.getElementById('billingToastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'billingToastContainer';
      container.className = 'billing-toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `billing-toast toast-${type}`;
    const icon = type === 'success' ? '✓' : (type === 'error' ? '✕' : 'ℹ');
    toast.innerHTML = `<span class="toast-icon">${icon}</span> <div class="toast-msg">${message}</div>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('show');
    }, 10);

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // ── 2. Kimlik Doğrulama Servisi (AuthService) ──
  const AuthService = {
    getUsers() {
      return DB.get(STORAGE_KEYS.USERS, []);
    },

    getCurrentUser() {
      return DB.get(STORAGE_KEYS.SESSION, null);
    },

    registerBusiness(data) {
      const users = this.getUsers();
      const email = data.email.trim().toLowerCase();

      // Aynı e-posta kontrolü
      if (users.some(u => u.email.toLowerCase() === email)) {
        return { success: false, message: 'Bu e-posta adresiyle kayıtlı bir işletme hesabı zaten mevcut.' };
      }

      const newUser = {
        id: 'biz_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        businessName: data.businessName.trim(),
        contactName: data.contactName.trim(),
        email: email,
        phone: data.phone.trim(),
        sector: data.sector || 'Genel',
        password: data.password, // Mock/Client-side
        createdAt: new Date().toISOString()
      };

      users.push(newUser);
      DB.set(STORAGE_KEYS.USERS, users);
      this.setSession(newUser);

      return { success: true, user: newUser };
    },

    loginBusiness(email, password) {
      const users = this.getUsers();
      const cleanEmail = email.trim().toLowerCase();
      const user = users.find(u => u.email.toLowerCase() === cleanEmail && u.password === password);

      if (!user) {
        return { success: false, message: 'E-posta adresi veya şifre hatalı.' };
      }

      this.setSession(user);
      return { success: true, user: user };
    },

    setSession(user) {
      // Şifresiz güvenli oturum objesi
      const safeUser = { ...user };
      delete safeUser.password;
      DB.set(STORAGE_KEYS.SESSION, safeUser);
      this.onAuthStateChanged();
    },

    logout() {
      localStorage.removeItem(STORAGE_KEYS.SESSION);
      this.onAuthStateChanged();
      showToast('İşletme oturumunuz sonlandırıldı.', 'info');
    },

    onAuthStateChanged() {
      UIManager.updateNavAuth();
    }
  };

  // ── 3. Kart & Ödeme Altyapısı (PaymentService) ──
  const PaymentService = {
    // Kart tipini tespit et
    detectCardBrand(number) {
      const clean = number.replace(/\D/g, '');
      if (/^4/.test(clean)) return 'visa';
      if (/^5[1-5]/.test(clean) || /^2[2-7]/.test(clean)) return 'mastercard';
      if (/^9792/.test(clean) || /^65/.test(clean)) return 'troy';
      if (/^3[47]/.test(clean)) return 'amex';
      return 'generic';
    },

    // Luhn Algoritması ile Kart Numarası Doğrulama
    validateCardNumber(number) {
      const clean = number.replace(/\D/g, '');
      if (clean.length < 13 || clean.length > 19) return false;

      let sum = 0;
      let shouldDouble = false;
      for (let i = clean.length - 1; i >= 0; i--) {
        let digit = parseInt(clean.charAt(i), 10);
        if (shouldDouble) {
          digit *= 2;
          if (digit > 9) digit -= 9;
        }
        sum += digit;
        shouldDouble = !shouldDouble;
      }
      return sum % 10 === 0;
    },

    // Son Kullanma Tarihi Doğrulama (MM/YY)
    validateExpiry(expiry) {
      const parts = expiry.split('/');
      if (parts.length !== 2) return false;
      const month = parseInt(parts[0].trim(), 10);
      const year = parseInt('20' + parts[1].trim(), 10);

      if (isNaN(month) || isNaN(year) || month < 1 || month > 12) return false;

      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;

      if (year < currentYear) return false;
      if (year === currentYear && month < currentMonth) return false;
      if (year > currentYear + 20) return false;

      return true;
    },

    // CVV Doğrulama
    validateCVV(cvv, cardBrand = 'generic') {
      const clean = cvv.replace(/\D/g, '');
      if (cardBrand === 'amex') return clean.length === 4;
      return clean.length === 3;
    },

    // Kartı maskele (**** **** **** 1234)
    maskCardNumber(number) {
      const clean = number.replace(/\D/g, '');
      const last4 = clean.slice(-4);
      return `•••• •••• •••• ${last4}`;
    },

    // Kart Kaydetme
    saveCard(businessId, cardData) {
      const cards = DB.get(STORAGE_KEYS.SAVED_CARDS, []);
      const masked = this.maskCardNumber(cardData.number);
      const brand = this.detectCardBrand(cardData.number);

      // Mevcut aynı kart var mı kontrol et
      const existing = cards.find(c => c.businessId === businessId && c.masked === masked);
      if (existing) {
        existing.holder = cardData.holder;
        existing.expiry = cardData.expiry;
        existing.updatedAt = new Date().toISOString();
        DB.set(STORAGE_KEYS.SAVED_CARDS, cards);
        return existing;
      }

      const newCard = {
        id: 'card_' + Date.now(),
        businessId: businessId,
        holder: cardData.holder.toUpperCase(),
        masked: masked,
        brand: brand,
        expiry: cardData.expiry,
        isDefault: true,
        createdAt: new Date().toISOString()
      };

      cards.push(newCard);
      DB.set(STORAGE_KEYS.SAVED_CARDS, cards);
      return newCard;
    },

    getCards(businessId) {
      const cards = DB.get(STORAGE_KEYS.SAVED_CARDS, []);
      return cards.filter(c => c.businessId === businessId);
    }
  };

  // ── 4. 30 Gün Ücretsiz Deneme & Abonelik Motoru (SubscriptionEngine) ──
  const SubscriptionEngine = {
    TRIAL_DAYS: 30,
    BILLING_CYCLE_DAYS: 30,

    getSubscriptions(businessId = null) {
      const subs = DB.get(STORAGE_KEYS.SUBSCRIPTIONS, []);
      if (!businessId) return subs;
      return subs.filter(s => s.businessId === businessId);
    },

    getTransactions(businessId = null) {
      const txs = DB.get(STORAGE_KEYS.TRANSACTIONS, []);
      if (!businessId) return txs;
      return txs.filter(t => t.businessId === businessId);
    },

    // Yeni Abonelik Başlatma (İlk 30 Gün Ücretsiz)
    createSubscription(params) {
      const {
        businessId,
        businessName,
        packageName,
        packageCategory,
        monthlyPrice,
        savedCardId,
        cardMasked,
        billingDetails
      } = params;

      const now = new Date();
      // İlk 30 gün ücretsiz bitişi ve ilk tahsilat tarihi:
      const trialEnds = new Date(now.getTime() + this.TRIAL_DAYS * 24 * 60 * 60 * 1000);

      const subId = 'sub_' + Date.now();

      const newSubscription = {
        id: subId,
        businessId: businessId,
        businessName: businessName,
        packageName: packageName,
        packageCategory: packageCategory || 'AI Otomasyon',
        monthlyPrice: monthlyPrice, // örn: 2490
        currency: 'TRY',
        symbol: '₺',
        status: 'trialing', // 'trialing' (ücretsiz deneme), 'active' (faturalandırılmış), 'cancelled' (iptal)
        createdAt: now.toISOString(),
        trialStartedAt: now.toISOString(),
        trialEndsAt: trialEnds.toISOString(),
        nextBillingDate: trialEnds.toISOString(),
        cycleDays: this.BILLING_CYCLE_DAYS,
        billingCount: 0,
        savedCardId: savedCardId,
        cardMasked: cardMasked,
        billingDetails: billingDetails || {}
      };

      const subs = DB.get(STORAGE_KEYS.SUBSCRIPTIONS, []);
      subs.unshift(newSubscription);
      DB.set(STORAGE_KEYS.SUBSCRIPTIONS, subs);

      // İlk Provizyon İşlemi Kaydı (₺0 Deneme Başlatma)
      this.recordTransaction({
        subscriptionId: subId,
        businessId: businessId,
        packageName: packageName,
        amount: 0,
        currency: 'TRY',
        type: 'trial_authorization',
        status: 'success',
        cardMasked: cardMasked,
        description: '30 Günlük Ücretsiz Deneme Başlangıç Provizyonu (₺0.00)',
        nextChargeAmount: monthlyPrice,
        nextChargeDate: trialEnds.toISOString()
      });

      return newSubscription;
    },

    // Abonelik İptali
    cancelSubscription(subscriptionId, businessId) {
      const subs = DB.get(STORAGE_KEYS.SUBSCRIPTIONS, []);
      const sub = subs.find(s => s.id === subscriptionId && s.businessId === businessId);

      if (!sub) return { success: false, message: 'Abonelik bulunamadı.' };

      sub.status = 'cancelled';
      sub.cancelledAt = new Date().toISOString();
      DB.set(STORAGE_KEYS.SUBSCRIPTIONS, subs);

      this.recordTransaction({
        subscriptionId: subscriptionId,
        businessId: businessId,
        packageName: sub.packageName,
        amount: 0,
        currency: 'TRY',
        type: 'cancellation',
        status: 'cancelled',
        cardMasked: sub.cardMasked,
        description: 'Abonelik kullanıcı talebiyle iptal edildi.'
      });

      return { success: true, message: 'Aboneliğiniz başarıyla iptal edildi. Deneme veya aktif dönemin sonuna kadar hizmetiniz durdurulmaz.' };
    },

    // İşlem Kaydetme
    recordTransaction(tx) {
      const txs = DB.get(STORAGE_KEYS.TRANSACTIONS, []);
      const newTx = {
        id: 'tx_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        date: new Date().toISOString(),
        ...tx
      };
      txs.unshift(newTx);
      DB.set(STORAGE_KEYS.TRANSACTIONS, txs);
      return newTx;
    },

    // Kalan Gün Hesaplayıcı
    calculateDaysLeft(targetDateStr) {
      const target = new Date(targetDateStr);
      const now = new Date();
      const diffMs = target.getTime() - now.getTime();
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      return diffDays > 0 ? diffDays : 0;
    },

    // Arka Plan Periyodik Tahsilat Kontrolü (30 günde bir)
    checkAndProcessRecurringBilling() {
      const subs = DB.get(STORAGE_KEYS.SUBSCRIPTIONS, []);
      const now = new Date();
      let updated = false;

      subs.forEach(sub => {
        if (sub.status === 'cancelled') return;

        const nextBilling = new Date(sub.nextBillingDate);
        if (now >= nextBilling) {
          // Tahsilat zamanı geldi (30 gün doldu)
          sub.status = 'active';
          sub.billingCount = (sub.billingCount || 0) + 1;
          sub.lastBilledAt = now.toISOString();

          // Bir sonraki 30 günlük tarihi hesapla
          const nextCycle = new Date(now.getTime() + this.BILLING_CYCLE_DAYS * 24 * 60 * 60 * 1000);
          sub.nextBillingDate = nextCycle.toISOString();
          updated = true;

          // Tahsilat dekontu oluştur
          this.recordTransaction({
            subscriptionId: sub.id,
            businessId: sub.businessId,
            packageName: sub.packageName,
            amount: sub.monthlyPrice,
            currency: 'TRY',
            type: 'recurring_charge',
            status: 'success',
            cardMasked: sub.cardMasked,
            description: `${sub.packageName} - 30 Günlük Otomatik Abonelik Tahsilatı`,
            nextChargeAmount: sub.monthlyPrice,
            nextChargeDate: sub.nextBillingDate
          });
        }
      });

      if (updated) {
        DB.set(STORAGE_KEYS.SUBSCRIPTIONS, subs);
      }
    }
  };

  // ── 5. Kullanıcı Arayüzü Yöneticisi (UIManager) ──
  const UIManager = {
    currentCheckoutPackage: null,

    init() {
      this.injectModals();
      this.bindEvents();
      this.updateNavAuth();
      SubscriptionEngine.checkAndProcessRecurringBilling();
    },

    // Modalları sayfaya enjekte et
    injectModals() {
      // 1. Auth Modalı
      if (!document.getElementById('authModal')) {
        const authModalHtml = `
        <div class="modal-overlay" id="authModal">
          <div class="modal-card auth-modal-card">
            <button class="modal-close" id="authModalClose" aria-label="Kapat">&times;</button>
            <div class="auth-tabs">
              <button class="auth-tab-btn active" data-tab="register">İşletme Hesabı Aç</button>
              <button class="auth-tab-btn" data-tab="login">İşletme Girişi</button>
            </div>

            <!-- Kayıt Formu -->
            <form id="businessRegisterForm" class="auth-tab-pane active">
              <div class="auth-header">
                <h3>İşletmeniz İçin Hesap Oluşturun</h3>
                <p>Yapay zeka otomasyonlarını anında aktifleştirin, 30 gün boyunca hiçbir ücret ödemeden deneyin.</p>
              </div>

              <div class="form-group">
                <label>İşletme / Şirket Unvanı *</label>
                <input type="text" id="regBizName" class="form-input" placeholder="Örn: Atlas Tekstil A.Ş. veya Luna Kafe" required>
              </div>

              <div class="form-row-2">
                <div class="form-group">
                  <label>Yetkili Adı Soyadı *</label>
                  <input type="text" id="regContactName" class="form-input" placeholder="Örn: Ahmet Yılmaz" required>
                </div>
                <div class="form-group">
                  <label>İşletme Sektörü</label>
                  <select id="regSector" class="form-select">
                    <option value="E-Ticaret & Perakende">E-Ticaret & Perakende</option>
                    <option value="Hizmet & Danışmanlık">Hizmet & Danışmanlık</option>
                    <option value="Sağlık & Klinik / Güzellik">Sağlık & Klinik / Güzellik</option>
                    <option value="Gayrimenkul & Emlak">Gayrimenkul & Emlak</option>
                    <option value="Restoran & Cafe">Restoran & Cafe</option>
                    <option value="Turizm & Otelcilik">Turizm & Otelcilik</option>
                    <option value="Diğer">Diğer</option>
                  </select>
                </div>
              </div>

              <div class="form-row-2">
                <div class="form-group">
                  <label>İşletme E-Posta Adresi *</label>
                  <input type="email" id="regEmail" class="form-input" placeholder="sirket@domain.com" required>
                </div>
                <div class="form-group">
                  <label>WhatsApp / Telefon *</label>
                  <input type="tel" id="regPhone" class="form-input" placeholder="0555 123 45 67" required>
                </div>
              </div>

              <div class="form-group">
                <label>Şifre Belirleyin *</label>
                <input type="password" id="regPassword" class="form-input" placeholder="En az 6 karakter" minlength="6" required>
              </div>

              <div class="auth-policy-note">
                Hesap oluşturarak <a href="gizlilik-ve-kvkk.html" target="_blank">Kullanım Şartları & KVKK Metni</a>'ni kabul etmiş olursunuz.
              </div>

              <button type="submit" class="btn-primary-glow btn-block">
                İşletme Hesabını Oluştur 🚀
              </button>
            </form>

            <!-- Giriş Formu -->
            <form id="businessLoginForm" class="auth-tab-pane">
              <div class="auth-header">
                <h3>İşletme Hesabınıza Giriş Yapın</h3>
                <p>Aktif otomasyonlarınızı, paketlerinizi ve faturalarınızı yönetin.</p>
              </div>

              <div class="form-group">
                <label>Kayıtlı E-Posta Adresi *</label>
                <input type="email" id="loginEmail" class="form-input" placeholder="sirket@domain.com" required>
              </div>

              <div class="form-group">
                <label>Şifre *</label>
                <input type="password" id="loginPassword" class="form-input" placeholder="••••••••" required>
              </div>

              <button type="submit" class="btn-primary-glow btn-block">
                Giriş Yap ➔
              </button>
            </form>
          </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', authModalHtml);
      }

      // 2. Checkout & Ödeme Modalı
      if (!document.getElementById('checkoutModal')) {
        const checkoutModalHtml = `
        <div class="modal-overlay" id="checkoutModal">
          <div class="modal-card checkout-modal-card">
            <button class="modal-close" id="checkoutModalClose" aria-label="Kapat">&times;</button>
            
            <div class="checkout-grid">
              <!-- Sol: Paket & Deneme Özeti -->
              <div class="checkout-summary-pane">
                <div class="checkout-badge-top">🎁 30 Gün Ücretsiz Deneme Fırsatı</div>
                <h3 id="checkoutPackageTitle" class="checkout-pkg-name">WhatsApp Akıllı Müşteri Temsilcisi</h3>
                <p id="checkoutPackageDesc" class="checkout-pkg-desc">7/24 gelen müşteri sorularını yapay zeka ile otomatik yanıtlayın.</p>

                <div class="trial-highlight-box">
                  <div class="trial-row">
                    <span>İlk 30 Günlük Tutar:</span>
                    <strong class="text-free">₺0 (ÜCRETSİZ)</strong>
                  </div>
                  <div class="trial-row">
                    <span>İlk Tahsilat Tarihi:</span>
                    <strong id="checkoutFirstChargeDate">--</strong>
                  </div>
                  <div class="trial-row">
                    <span>30 Gün Sonraki Periyodik Ücret:</span>
                    <strong id="checkoutRecurringPrice">₺2.490 / 30 gün</strong>
                  </div>
                </div>

                <div class="checkout-guarantee-list">
                  <div class="guar-item">
                    <span class="guar-icon">🛡️</span>
                    <div>
                      <strong>30 Gün Boyunca ₺0 Çekim</strong>
                      <p>Kartınız yalnızca abonelik devamlılığı için doğrulanır, bugün hiçbir ücret kesilmez.</p>
                    </div>
                  </div>
                  <div class="guar-item">
                    <span class="guar-icon">⚡</span>
                    <div>
                      <strong>Dilediğiniz An Tek Tıkla İptal</strong>
                      <p>Panelinizden 30 gün dolmadan önce iptal ederseniz tek kuruş ödemezsiniz.</p>
                    </div>
                  </div>
                  <div class="guar-item">
                    <span class="guar-icon">🔒</span>
                    <div>
                      <strong>256-Bit SSL & 3D Secure</strong>
                      <p>Kart bilgileriniz BDDK ve PCI-DSS standartlarıyla korunur.</p>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Sağ: Ödeme Formu & Canlı Kart Görseli -->
              <div class="checkout-form-pane">
                <div class="checkout-form-header">
                  <h4>Ödeme Bilgileri</h4>
                  <div class="card-brand-logos">
                    <span class="brand-badge visa">VISA</span>
                    <span class="brand-badge mastercard">Mastercard</span>
                    <span class="brand-badge troy">TROY</span>
                  </div>
                </div>

                <!-- Canlı Kredi Kartı Görseli (Live Interactive Card) -->
                <div class="interactive-card-wrapper">
                  <div class="credit-card-preview" id="creditCardPreview">
                    <div class="card-chip"></div>
                    <div class="card-contactless">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M8.5 10a4 4 0 0 1 0 4M12 7a8 8 0 0 1 0 10M15.5 4a12 12 0 0 1 0 16" />
                      </svg>
                    </div>
                    <div class="card-logo-display" id="cardLogoDisplay">CARD</div>
                    <div class="card-number-display" id="cardNumberDisplay">•••• •••• •••• ••••</div>
                    <div class="card-footer-display">
                      <div class="card-holder-info">
                        <small>KART SAHİBİ</small>
                        <span id="cardHolderDisplay">AD SOYAD</span>
                      </div>
                      <div class="card-expiry-info">
                        <small>SKT</small>
                        <span id="cardExpiryDisplay">AA/YY</span>
                      </div>
                    </div>
                  </div>
                </div>

                <form id="checkoutPaymentForm">
                  <div class="form-group">
                    <label>Kart Üzerindeki İsim *</label>
                    <input type="text" id="cardHolderInput" class="form-input" placeholder="Örn: AHMET YILMAZ" required>
                  </div>

                  <div class="form-group">
                    <label>Kart Numarası *</label>
                    <div class="input-with-icon">
                      <input type="text" id="cardNumberInput" class="form-input" placeholder="•••• •••• •••• ••••" maxlength="19" required>
                      <span class="input-card-type" id="inputCardType">💳</span>
                    </div>
                  </div>

                  <div class="form-row-2">
                    <div class="form-group">
                      <label>Son Kullanma (AA/YY) *</label>
                      <input type="text" id="cardExpiryInput" class="form-input" placeholder="MM/YY" maxlength="5" required>
                    </div>
                    <div class="form-group">
                      <label>CVV / Güvenlik Kodu *</label>
                      <input type="password" id="cardCvvInput" class="form-input" placeholder="•••" maxlength="4" required>
                    </div>
                  </div>

                  <!-- Fatura Bilgileri Toggle -->
                  <div class="billing-details-accordion">
                    <button type="button" class="btn-toggle-billing" id="toggleBillingDetailsBtn">
                      <span>🏢 Kurumsal Fatura Bilgileri</span>
                      <span class="arrow">↓</span>
                    </button>
                    <div class="billing-details-content" id="billingDetailsContent">
                      <div class="form-group">
                        <label>Fatura Şirket Unvanı</label>
                        <input type="text" id="invoiceBizName" class="form-input" placeholder="Şirket Tam Unvanı">
                      </div>
                      <div class="form-row-2">
                        <div class="form-group">
                          <label>Vergi Dairesi & No / TC</label>
                          <input type="text" id="invoiceTaxNo" class="form-input" placeholder="Vergi No / TC Kimlik">
                        </div>
                        <div class="form-group">
                          <label>İl / İlçe</label>
                          <input type="text" id="invoiceCity" class="form-input" placeholder="İstanbul / Kadıköy">
                        </div>
                      </div>
                      <div class="form-group">
                        <label>Fatura Adresi</label>
                        <input type="text" id="invoiceAddress" class="form-input" placeholder="Şirket açık adresi...">
                      </div>
                    </div>
                  </div>

                  <div class="checkout-terms-box">
                    <label class="checkbox-label">
                      <input type="checkbox" id="termsCheck" required checked>
                      <span>
                        <strong>İlk 30 gün ₺0</strong> tutarını, 30 gün sonra her 30 günde bir <span id="termsRecurringText">₺2.490</span> otomatik yenileme şartını ve <a href="gizlilik-ve-kvkk.html" target="_blank">Abonelik & Mesafeli Satış Sözleşmesi</a>'ni onaylıyorum.
                      </span>
                    </label>
                  </div>

                  <button type="submit" class="btn-primary-glow btn-block" id="btnSubmitPayment">
                    <span>🛡️ 3D Secure ile 30 Gün Ücretsiz Başlat (₺0)</span>
                  </button>
                </form>
              </div>
            </div>

          </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', checkoutModalHtml);
      }

      // 3. 3D Secure Onay Simülasyon Modalı
      if (!document.getElementById('threeDSecureModal')) {
        const threeDSModalHtml = `
        <div class="modal-overlay" id="threeDSecureModal">
          <div class="modal-card three-d-card">
            <div class="three-d-header">
              <div class="bank-brand">
                <span class="bank-logo-icon">🏛️</span>
                <strong>Banka Güvenlik Onayı (3D Secure)</strong>
              </div>
              <div class="pci-badge">PCI-DSS Level 1</div>
            </div>

            <div class="three-d-body">
              <p class="three-d-desc">
                İşletmeniz adına başlatılan <strong>30 Günlük Ücretsiz Deneme Aboneliği</strong> kart doğrulaması için telefonunuza doğrulama kodu gönderilmiştir.
              </p>

              <div class="three-d-info-table">
                <div class="row"><span>İşyeri:</span> <strong>OtomasyonAI Teknoloji A.Ş.</strong></div>
                <div class="row"><span>Çekilecek Tutar:</span> <strong class="text-free">₺0.00 (Ücretsiz Deneme Provizyonu)</strong></div>
                <div class="row"><span>Kart:</span> <strong id="threeDCardMasked">•••• •••• •••• 4242</strong></div>
                <div class="row"><span>İşlem Türü:</span> <strong>Kart Saklama & Abonelik Kaydı</strong></div>
              </div>

              <form id="threeDSecureForm">
                <div class="form-group">
                  <label>SMS Doğrulama Kodu</label>
                  <div class="sms-input-row">
                    <input type="text" id="smsCodeInput" class="form-input sms-input" placeholder="123456" maxlength="6" value="584921" required>
                    <button type="button" class="btn-sms-resend" id="btnResendSms">Tekrar Gönder (59s)</button>
                  </div>
                  <small style="color:var(--color-text-muted);font-size:0.8rem;margin-top:4px;display:block;">
                    * Test ortamında kod otomatik doldurulmuştur. "Onayla" butonuna basınız.
                  </small>
                </div>

                <div class="three-d-actions">
                  <button type="button" class="btn-secondary" id="btnCancel3D">İptal</button>
                  <button type="submit" class="btn-primary-glow" id="btnConfirm3D">Doğrula ve Aboneliği Başlat ➔</button>
                </div>
              </form>
            </div>
          </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', threeDSModalHtml);
      }

      // 4. Müşteri Yönetim Paneli (Customer Dashboard Modal)
      if (!document.getElementById('customerDashboardModal')) {
        const dashboardModalHtml = `
        <div class="modal-overlay" id="customerDashboardModal">
          <div class="modal-card customer-dashboard-card">
            <button class="modal-close" id="dashboardModalClose" aria-label="Kapat">&times;</button>
            
            <div class="dash-header">
              <div class="dash-biz-info">
                <div class="biz-avatar" id="dashBizAvatar">🏢</div>
                <div>
                  <h3 id="dashBizName">İşletme Adı</h3>
                  <p><span id="dashContactName">Yetkili</span> • <span id="dashBizEmail">email</span> • <span class="badge-status-active">İşletme Hesabı</span></p>
                </div>
              </div>
              <button class="btn-dash-logout" id="dashLogoutBtn">Çıkış Yap</button>
            </div>

            <!-- Dashboard Sekmeleri -->
            <div class="dash-tabs">
              <button class="dash-tab-btn active" data-dashtab="subscriptions">📦 Aktif Paketlerim & Abonelikler</button>
              <button class="dash-tab-btn" data-dashtab="cards">💳 Kayıtlı Ödeme Yöntemi</button>
              <button class="dash-tab-btn" data-dashtab="invoices">🧾 Fatura & İşlem Geçmişi</button>
            </div>

            <!-- 1. Sekme: Aktif Abonelikler -->
            <div class="dash-pane active" id="paneSubscriptions">
              <div id="activeSubsList" class="subs-grid">
                <!-- JS Dinamik Dolduracak -->
              </div>
            </div>

            <!-- 2. Sekme: Kayıtlı Kartlar -->
            <div class="dash-pane" id="paneCards">
              <div id="savedCardsList" class="cards-list-box">
                <!-- JS Dinamik Dolduracak -->
              </div>
            </div>

            <!-- 3. Sekme: Fatura & Tahsilat Dekontları -->
            <div class="dash-pane" id="paneInvoices">
              <div class="invoice-table-wrapper">
                <table class="dash-table">
                  <thead>
                    <tr>
                      <th>İşlem Tarihi</th>
                      <th>Paket / Açıklama</th>
                      <th>Tür</th>
                      <th>Tutar</th>
                      <th>Kart</th>
                      <th>Durum</th>
                    </tr>
                  </thead>
                  <tbody id="invoiceTableBody">
                    <!-- JS Dinamik Dolduracak -->
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', dashboardModalHtml);
      }
    },

    // Navbar'daki Giriş/Hesap Alanını Güncelle
    updateNavAuth() {
      const navInner = document.querySelector('.nav-inner');
      if (!navInner) return;

      let authContainer = document.getElementById('navAuthContainer');
      if (!authContainer) {
        authContainer = document.createElement('div');
        authContainer.id = 'navAuthContainer';
        authContainer.className = 'nav-auth-container';
        // Hamburger'dan önce yerleştir
        const hamburger = document.getElementById('hamburger');
        if (hamburger) {
          navInner.insertBefore(authContainer, hamburger);
        } else {
          navInner.appendChild(authContainer);
        }
      }

      const user = AuthService.getCurrentUser();

      if (user) {
        // Kullanıcı giriş yapmış
        authContainer.innerHTML = `
          <button class="btn-nav-dashboard" id="btnOpenDashboard">
            <span class="biz-icon">🏢</span>
            <span class="biz-title">${user.businessName}</span>
            <span class="dash-arrow">▾</span>
          </button>
        `;

        const btnDash = document.getElementById('btnOpenDashboard');
        if (btnDash) {
          btnDash.addEventListener('click', () => this.openCustomerDashboard());
        }
      } else {
        // Kullanıcı giriş yapmamış
        authContainer.innerHTML = `
          <button class="btn-nav-login" id="btnOpenAuth">
            <span>İşletme Girişi / Kayıt</span>
          </button>
        `;

        const btnOpenAuth = document.getElementById('btnOpenAuth');
        if (btnOpenAuth) {
          btnOpenAuth.addEventListener('click', () => this.openAuthModal('register'));
        }
      }
    },

    // Event Listener'lar
    bindEvents() {
      // Auth Modal Kapatma
      const authModal = document.getElementById('authModal');
      const authModalClose = document.getElementById('authModalClose');
      if (authModalClose) authModalClose.addEventListener('click', () => this.closeModal(authModal));
      if (authModal) {
        authModal.addEventListener('click', (e) => {
          if (e.target === authModal) this.closeModal(authModal);
        });
      }

      // Auth Sekme Değişimi
      const authTabs = document.querySelectorAll('.auth-tab-btn');
      authTabs.forEach(btn => {
        btn.addEventListener('click', () => {
          authTabs.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const tab = btn.dataset.tab;
          document.querySelectorAll('.auth-tab-pane').forEach(p => p.classList.remove('active'));
          if (tab === 'register') {
            document.getElementById('businessRegisterForm').classList.add('active');
          } else {
            document.getElementById('businessLoginForm').classList.add('active');
          }
        });
      });

      // Kayıt Formu Gönderimi
      const registerForm = document.getElementById('businessRegisterForm');
      if (registerForm) {
        registerForm.addEventListener('submit', (e) => {
          e.preventDefault();
          const bizName = document.getElementById('regBizName').value;
          const contactName = document.getElementById('regContactName').value;
          const sector = document.getElementById('regSector').value;
          const email = document.getElementById('regEmail').value;
          const phone = document.getElementById('regPhone').value;
          const password = document.getElementById('regPassword').value;

          const res = AuthService.registerBusiness({
            businessName: bizName,
            contactName: contactName,
            sector: sector,
            email: email,
            phone: phone,
            password: password
          });

          if (!res.success) {
            showToast(res.message, 'error');
            return;
          }

          showToast(`Hoş geldiniz! ${res.user.businessName} işletme hesabınız başarıyla açıldı.`, 'success');
          this.closeModal(authModal);

          // Eğer bekleyen bir checkout paketi varsa checkout'u aç
          if (this.currentCheckoutPackage) {
            this.openCheckoutModal(this.currentCheckoutPackage);
          } else {
            this.openCustomerDashboard();
          }
        });
      }

      // Giriş Formu Gönderimi
      const loginForm = document.getElementById('businessLoginForm');
      if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
          e.preventDefault();
          const email = document.getElementById('loginEmail').value;
          const password = document.getElementById('loginPassword').value;

          const res = AuthService.loginBusiness(email, password);
          if (!res.success) {
            showToast(res.message, 'error');
            return;
          }

          showToast(`Tekrar hoş geldiniz, ${res.user.businessName}!`, 'success');
          this.closeModal(authModal);

          if (this.currentCheckoutPackage) {
            this.openCheckoutModal(this.currentCheckoutPackage);
          } else {
            this.openCustomerDashboard();
          }
        });
      }

      // Checkout Modal Kapatma
      const checkoutModal = document.getElementById('checkoutModal');
      const checkoutClose = document.getElementById('checkoutModalClose');
      if (checkoutClose) checkoutClose.addEventListener('click', () => this.closeModal(checkoutModal));
      if (checkoutModal) {
        checkoutModal.addEventListener('click', (e) => {
          if (e.target === checkoutModal) this.closeModal(checkoutModal);
        });
      }

      // Fatura Bilgileri Akordeon Toggle
      const toggleBillingBtn = document.getElementById('toggleBillingDetailsBtn');
      const billingContent = document.getElementById('billingDetailsContent');
      if (toggleBillingBtn && billingContent) {
        toggleBillingBtn.addEventListener('click', () => {
          const isOpen = billingContent.style.display === 'block';
          billingContent.style.display = isOpen ? 'none' : 'block';
          toggleBillingBtn.querySelector('.arrow').textContent = isOpen ? '↓' : '↑';
        });
      }

      // Canlı Kart Giriş Maskeleme & Önizleme
      this.bindCardInputs();

      // Checkout Formu Gönderimi
      const checkoutForm = document.getElementById('checkoutPaymentForm');
      if (checkoutForm) {
        checkoutForm.addEventListener('submit', (e) => {
          e.preventDefault();
          this.handleCheckoutSubmit();
        });
      }

      // 3D Secure Modal Olayları
      const threeDModal = document.getElementById('threeDSecureModal');
      const btnCancel3D = document.getElementById('btnCancel3D');
      if (btnCancel3D) {
        btnCancel3D.addEventListener('click', () => {
          this.closeModal(threeDModal);
          showToast('3D Secure işlemi iptal edildi.', 'info');
        });
      }

      const threeDForm = document.getElementById('threeDSecureForm');
      if (threeDForm) {
        threeDForm.addEventListener('submit', (e) => {
          e.preventDefault();
          this.handleThreeDSecureConfirm();
        });
      }

      // Dashboard Modal Olayları
      const dashModal = document.getElementById('customerDashboardModal');
      const dashClose = document.getElementById('dashboardModalClose');
      if (dashClose) dashClose.addEventListener('click', () => this.closeModal(dashModal));
      if (dashModal) {
        dashModal.addEventListener('click', (e) => {
          if (e.target === dashModal) this.closeModal(dashModal);
        });
      }

      const dashLogout = document.getElementById('dashLogoutBtn');
      if (dashLogout) {
        dashLogout.addEventListener('click', () => {
          AuthService.logout();
          this.closeModal(dashModal);
        });
      }

      // Dashboard Sekmeleri
      const dashTabs = document.querySelectorAll('.dash-tab-btn');
      dashTabs.forEach(tabBtn => {
        tabBtn.addEventListener('click', () => {
          dashTabs.forEach(t => t.classList.remove('active'));
          tabBtn.classList.add('active');
          const tabId = tabBtn.dataset.dashtab;
          document.querySelectorAll('.dash-pane').forEach(p => p.classList.remove('active'));
          if (tabId === 'subscriptions') document.getElementById('paneSubscriptions').classList.add('active');
          if (tabId === 'cards') document.getElementById('paneCards').classList.add('active');
          if (tabId === 'invoices') document.getElementById('paneInvoices').classList.add('active');
        });
      });

      // Sayfadaki Tüm Satın Al / Deneme Başlat Butonlarını Dinle
      this.bindPurchaseButtons();
    },

    // Kart Girdisi Formatlama ve Kart Önizleme Senkronizasyonu
    bindCardInputs() {
      const numInput = document.getElementById('cardNumberInput');
      const holderInput = document.getElementById('cardHolderInput');
      const expiryInput = document.getElementById('cardExpiryInput');
      const cvvInput = document.getElementById('cardCvvInput');

      const numDisplay = document.getElementById('cardNumberDisplay');
      const holderDisplay = document.getElementById('cardHolderDisplay');
      const expiryDisplay = document.getElementById('cardExpiryDisplay');
      const logoDisplay = document.getElementById('cardLogoDisplay');
      const cardPreview = document.getElementById('creditCardPreview');
      const inputCardType = document.getElementById('inputCardType');

      if (!numInput) return;

      // Kart No Formatlama (4'erli)
      numInput.addEventListener('input', (e) => {
        let val = e.target.value.replace(/\D/g, '').substring(0, 16);
        let formatted = val.match(/.{1,4}/g)?.join(' ') || '';
        e.target.value = formatted;

        numDisplay.textContent = formatted || '•••• •••• •••• ••••';

        // Kart Tipi
        const brand = PaymentService.detectCardBrand(val);
        logoDisplay.textContent = brand.toUpperCase();
        cardPreview.className = 'credit-card-preview theme-' + brand;

        if (brand === 'visa') inputCardType.textContent = '💳 Visa';
        else if (brand === 'mastercard') inputCardType.textContent = '💳 MC';
        else if (brand === 'troy') inputCardType.textContent = '💳 TROY';
        else inputCardType.textContent = '💳';
      });

      // Kart Sahibi
      holderInput.addEventListener('input', (e) => {
        const val = e.target.value.toUpperCase();
        holderDisplay.textContent = val || 'AD SOYAD';
      });

      // SKT Formatlama (AA/YY)
      expiryInput.addEventListener('input', (e) => {
        let val = e.target.value.replace(/\D/g, '').substring(0, 4);
        if (val.length >= 3) {
          val = val.substring(0, 2) + '/' + val.substring(2);
        }
        e.target.value = val;
        expiryDisplay.textContent = val || 'AA/YY';
      });

      // CVV
      cvvInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '').substring(0, 4);
      });
    },

    // Sayfadaki ürün kartlarını ve modalları "Satın Al / 1 Ay Ücretsiz Başla" işleyicisine bağla
    bindPurchaseButtons() {
      // 1. Ürün Kartları
      document.querySelectorAll('.product-card').forEach(card => {
        const title = card.querySelector('h3')?.textContent || 'Otomasyon Paketi';
        const priceEl = card.querySelector('.product-price');
        const priceText = priceEl ? priceEl.textContent : '₺2.490';
        const category = card.dataset.category || 'whatsapp';

        // Sayısal fiyatı çek (örn: ₺2.490 -> 2490)
        const numericPrice = parseInt(priceText.replace(/\D/g, ''), 10) || 2490;

        // Kart altına "1 Ay Ücretsiz Başla" butonu ekle / güncelle
        let btnBuy = card.querySelector('.btn-buy-package');
        if (!btnBuy) {
          btnBuy = document.createElement('button');
          btnBuy.className = 'btn-buy-package';
          btnBuy.innerHTML = `<span>1 Ay Ücretsiz Başla ➔</span>`;
          const footer = card.querySelector('.product-footer');
          if (footer) {
            footer.appendChild(btnBuy);
          }
        }

        btnBuy.addEventListener('click', (e) => {
          e.preventDefault();
          this.initiatePurchase({
            title: title,
            category: category,
            price: numericPrice,
            priceFormatted: `₺${numericPrice.toLocaleString('tr-TR')} /aylık`,
            desc: card.querySelector('p')?.textContent || '7/24 kesintisiz otomasyon çözümü.'
          });
        });
      });

      // 2. Ürün Detay Modalı Butonu
      const modalOrderBtn = document.getElementById('modalOrderBtn');
      if (modalOrderBtn) {
        // Mevcut WhatsApp butonunun yanına "1 Ay Ücretsiz Satın Al" butonu ekle
        let modalBuyBtn = document.getElementById('modalBuyPackageBtn');
        if (!modalBuyBtn) {
          modalBuyBtn = document.createElement('button');
          modalBuyBtn.id = 'modalBuyPackageBtn';
          modalBuyBtn.className = 'btn-modal-buy-trial';
          modalBuyBtn.innerHTML = `🎁 1 Ay Ücretsiz Başla (Satın Al)`;
          modalOrderBtn.parentNode.insertBefore(modalBuyBtn, modalOrderBtn);
        }

        modalBuyBtn.addEventListener('click', (e) => {
          e.preventDefault();
          const title = document.getElementById('modalTitle')?.textContent || 'Otomasyon Paketi';
          const priceStr = document.getElementById('modalPrice')?.textContent || '₺2.490';
          const desc = document.getElementById('modalDesc')?.textContent || '';
          const numericPrice = parseInt(priceStr.replace(/\D/g, ''), 10) || 2490;

          // Detay modalını kapatıp checkout'a geç
          const productModal = document.getElementById('productModal');
          if (productModal) productModal.classList.remove('active');

          this.initiatePurchase({
            title: title,
            category: 'AI Otomasyon',
            price: numericPrice,
            priceFormatted: `₺${numericPrice.toLocaleString('tr-TR')} /aylık`,
            desc: desc
          });
        });
      }

      // 3. Özel Paket Oluşturucu Sihirbazı Sipariş Butonu
      const pkgWaBtn = document.getElementById('pkgWaBtn');
      if (pkgWaBtn) {
        let pkgBuyBtn = document.getElementById('pkgDirectBuyBtn');
        if (!pkgBuyBtn) {
          pkgBuyBtn = document.createElement('button');
          pkgBuyBtn.id = 'pkgDirectBuyBtn';
          pkgBuyBtn.className = 'btn-pkg-buy-trial';
          pkgBuyBtn.innerHTML = `🎁 1 Ay Ücretsiz Bu Paketi Başlat`;
          pkgWaBtn.parentNode.insertBefore(pkgBuyBtn, pkgWaBtn);
        }

        pkgBuyBtn.addEventListener('click', (e) => {
          e.preventDefault();
          const customModal = document.getElementById('customPackageModal');
          if (customModal) customModal.classList.remove('active');

          const count = document.getElementById('pkgSelectedCount')?.textContent || 'Özel Paket';
          const priceStr = document.getElementById('pkgTotalPrice')?.textContent || '₺2.144';
          const numericPrice = parseInt(priceStr.replace(/\D/g, ''), 10) || 2144;

          this.initiatePurchase({
            title: `Özel Otomasyon Paketi (${count})`,
            category: 'Özel Paket',
            price: numericPrice,
            priceFormatted: `₺${numericPrice.toLocaleString('tr-TR')} /aylık`,
            desc: 'Seçtiğiniz çoklu otomasyon modülleri içeren indirimli özel işletme paketi.'
          });
        });
      }
    },

    // Satın Alma Akışını Başlat
    initiatePurchase(pkg) {
      this.currentCheckoutPackage = pkg;
      const currentUser = AuthService.getCurrentUser();

      if (!currentUser) {
        // Kullanıcı giriş yapmamışsa önce Auth modalını aç
        showToast('Satın alma ve 30 günlük ücretsiz deneme için lütfen önce işletme hesabı oluşturun veya giriş yapın.', 'info');
        this.openAuthModal('register');
      } else {
        // Giriş yapmışsa doğrudan checkout modalını aç
        this.openCheckoutModal(pkg);
      }
    },

    // Auth Modalı Aç
    openAuthModal(tab = 'register') {
      const modal = document.getElementById('authModal');
      if (!modal) return;

      const tabs = modal.querySelectorAll('.auth-tab-btn');
      tabs.forEach(t => {
        if (t.dataset.tab === tab) t.classList.add('active');
        else t.classList.remove('active');
      });

      if (tab === 'register') {
        document.getElementById('businessRegisterForm').classList.add('active');
        document.getElementById('businessLoginForm').classList.remove('active');
      } else {
        document.getElementById('businessRegisterForm').classList.remove('active');
        document.getElementById('businessLoginForm').classList.add('active');
      }

      modal.classList.add('active');
      document.body.style.overflow = 'hidden';
    },

    // Checkout Modalı Aç
    openCheckoutModal(pkg) {
      const modal = document.getElementById('checkoutModal');
      if (!modal) return;

      const user = AuthService.getCurrentUser();

      // Bilgileri yerleştir
      document.getElementById('checkoutPackageTitle').textContent = pkg.title;
      document.getElementById('checkoutPackageDesc').textContent = pkg.desc;

      const now = new Date();
      const chargeDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const chargeDateFormatted = chargeDate.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });

      document.getElementById('checkoutFirstChargeDate').textContent = chargeDateFormatted;
      document.getElementById('checkoutRecurringPrice').textContent = `₺${pkg.price.toLocaleString('tr-TR')} / 30 gün`;
      document.getElementById('termsRecurringText').textContent = `₺${pkg.price.toLocaleString('tr-TR')}`;

      // Kart sahibi alanını kullanıcı adıyla doldur
      if (user) {
        const holderInput = document.getElementById('cardHolderInput');
        if (holderInput && !holderInput.value) {
          holderInput.value = user.contactName.toUpperCase();
          document.getElementById('cardHolderDisplay').textContent = user.contactName.toUpperCase();
        }
        const invoiceBiz = document.getElementById('invoiceBizName');
        if (invoiceBiz && !invoiceBiz.value) {
          invoiceBiz.value = user.businessName;
        }
      }

      modal.classList.add('active');
      document.body.style.overflow = 'hidden';
    },

    // Checkout Formu Doğrulama ve 3D Secure'a Geçiş
    handleCheckoutSubmit() {
      const num = document.getElementById('cardNumberInput').value;
      const holder = document.getElementById('cardHolderInput').value;
      const expiry = document.getElementById('cardExpiryInput').value;
      const cvv = document.getElementById('cardCvvInput').value;
      const terms = document.getElementById('termsCheck').checked;

      if (!terms) {
        showToast('Lütfen abonelik ve deneme şartlarını onaylayınız.', 'error');
        return;
      }

      if (!holder.trim()) {
        showToast('Lütfen kart üzerindeki adı ve soyadı giriniz.', 'error');
        return;
      }

      if (!PaymentService.validateCardNumber(num)) {
        showToast('Geçersiz kart numarası! Lütfen kontrol ediniz.', 'error');
        return;
      }

      if (!PaymentService.validateExpiry(expiry)) {
        showToast('Kart son kullanma tarihi geçersiz veya kartınızın süresi dolmuş.', 'error');
        return;
      }

      const brand = PaymentService.detectCardBrand(num);
      if (!PaymentService.validateCVV(cvv, brand)) {
        showToast('Geçersiz güvenlik kodu (CVV).', 'error');
        return;
      }

      // Kart geçerli -> 3D Secure simülasyonunu başlat
      const masked = PaymentService.maskCardNumber(num);
      document.getElementById('threeDCardMasked').textContent = masked;

      // Checkout modalını kapat, 3D Secure modalını aç
      document.getElementById('checkoutModal').classList.remove('active');
      const threeDModal = document.getElementById('threeDSecureModal');
      threeDModal.classList.add('active');
    },

    // 3D Secure Doğrulama ve Aboneliğin Aktifleştirilmesi
    handleThreeDSecureConfirm() {
      const smsCode = document.getElementById('smsCodeInput').value.trim();
      if (smsCode.length < 4) {
        showToast('Lütfen geçerli bir SMS kodu giriniz.', 'error');
        return;
      }

      const user = AuthService.getCurrentUser();
      if (!user) {
        showToast('Oturum zaman aşımına uğradı.', 'error');
        return;
      }

      const num = document.getElementById('cardNumberInput').value;
      const holder = document.getElementById('cardHolderInput').value;
      const expiry = document.getElementById('cardExpiryInput').value;

      // Kartı güvenli kaydet
      const savedCard = PaymentService.saveCard(user.id, {
        number: num,
        holder: holder,
        expiry: expiry
      });

      // Fatura detayları
      const billingDetails = {
        invoiceBizName: document.getElementById('invoiceBizName').value || user.businessName,
        taxNo: document.getElementById('invoiceTaxNo').value || '',
        city: document.getElementById('invoiceCity').value || '',
        address: document.getElementById('invoiceAddress').value || ''
      };

      // Aboneliği 30 gün ücretsiz deneme olarak oluştur
      const pkg = this.currentCheckoutPackage;
      const newSub = SubscriptionEngine.createSubscription({
        businessId: user.id,
        businessName: user.businessName,
        packageName: pkg.title,
        packageCategory: pkg.category,
        monthlyPrice: pkg.price,
        savedCardId: savedCard.id,
        cardMasked: savedCard.masked,
        billingDetails: billingDetails
      });

      // 3D Secure modalını kapat
      document.getElementById('threeDSecureModal').classList.remove('active');
      document.body.style.overflow = '';

      // Formları sıfırla
      document.getElementById('checkoutPaymentForm').reset();
      this.currentCheckoutPackage = null;

      // Tebrik ve bilgilendirme
      showToast(`🎉 Tebrikler! "${newSub.packageName}" paketiniz ilk 30 gün ÜCRETSİZ olarak tanımlandı.`, 'success');

      // Doğrudan Müşteri Paneline yönlendir
      setTimeout(() => {
        this.openCustomerDashboard();
      }, 600);
    },

    // Müşteri Paneli Aç ve Verileri Yükle
    openCustomerDashboard() {
      const modal = document.getElementById('customerDashboardModal');
      if (!modal) return;

      const user = AuthService.getCurrentUser();
      if (!user) {
        this.openAuthModal('login');
        return;
      }

      // Başlık bilgileri
      document.getElementById('dashBizName').textContent = user.businessName;
      document.getElementById('dashContactName').textContent = user.contactName;
      document.getElementById('dashBizEmail').textContent = user.email;
      document.getElementById('dashBizAvatar').textContent = user.businessName.charAt(0).toUpperCase();

      // 1. Abonelikleri Render Et
      this.renderDashboardSubscriptions(user.id);

      // 2. Kayıtlı Kartları Render Et
      this.renderDashboardCards(user.id);

      // 3. Fatura ve İşlemleri Render Et
      this.renderDashboardInvoices(user.id);

      modal.classList.add('active');
      document.body.style.overflow = 'hidden';
    },

    // Dashboard: Abonelikler Listesi
    renderDashboardSubscriptions(businessId) {
      const container = document.getElementById('activeSubsList');
      const subs = SubscriptionEngine.getSubscriptions(businessId);

      if (!subs.length) {
        container.innerHTML = `
          <div class="dash-empty-state">
            <span class="empty-icon">📦</span>
            <h4>Henüz aktif bir otomasyon paketiniz bulunmuyor.</h4>
            <p>Kataloğumuzdaki tüm otomasyonları 30 gün boyunca ücretsiz deneyebilirsiniz.</p>
            <a href="#otomasyonlar" class="btn-primary-glow btn-sm" onclick="document.getElementById('customerDashboardModal').classList.remove('active');document.body.style.overflow='';">
              Otomasyonları Keşfet ➔
            </a>
          </div>
        `;
        return;
      }

      container.innerHTML = subs.map(sub => {
        const isCancelled = sub.status === 'cancelled';
        const isTrialing = sub.status === 'trialing';

        const nextDate = new Date(sub.nextBillingDate).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
        const daysLeft = SubscriptionEngine.calculateDaysLeft(sub.nextBillingDate);

        let statusBadge = '';
        if (isCancelled) {
          statusBadge = `<span class="badge-status-cancelled">❌ İptal Edildi</span>`;
        } else if (isTrialing) {
          statusBadge = `<span class="badge-status-trial">🎁 30 Gün Ücretsiz Deneme (${daysLeft} gün kaldı)</span>`;
        } else {
          statusBadge = `<span class="badge-status-active">🟢 Aktif Abonelik (${daysLeft} gün sonra yenilenecek)</span>`;
        }

        return `
          <div class="dash-sub-card ${isCancelled ? 'sub-cancelled' : ''}">
            <div class="sub-card-header">
              <div>
                <span class="sub-category-tag">${sub.packageCategory}</span>
                <h4>${sub.packageName}</h4>
              </div>
              <div>${statusBadge}</div>
            </div>

            <div class="sub-card-meta-grid">
              <div class="meta-item">
                <small>Aylık Periyodik Tutar</small>
                <strong>₺${sub.monthlyPrice.toLocaleString('tr-TR')} / 30 gün</strong>
              </div>
              <div class="meta-item">
                <small>Bir Sonraki Tahsilat</small>
                <strong>${isCancelled ? 'Tahsilat Yapılmayacak' : nextDate}</strong>
              </div>
              <div class="meta-item">
                <small>Tanımlı Kart</small>
                <strong>${sub.cardMasked || '•••• 4242'}</strong>
              </div>
              <div class="meta-item">
                <small>Faturalama Döngüsü</small>
                <strong>30 Günde Bir Tekrarlanan</strong>
              </div>
            </div>

            <div class="sub-card-footer">
              ${!isCancelled ? `
                <button class="btn-sub-cancel" data-subid="${sub.id}">
                  Aboneliği İptal Et
                </button>
              ` : `
                <span class="text-cancelled-info">Bu paket iptal edilmiştir. Süre sonuna kadar hizmetiniz aktiftir.</span>
              `}
              <span class="sub-cycle-badge">🔄 30 Günlük Otomatik Döngü</span>
            </div>
          </div>
        `;
      }).join('');

      // İptal Butonlarını Bağla
      container.querySelectorAll('.btn-sub-cancel').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const subId = e.target.dataset.subid;
          if (confirm('Aboneliğinizi iptal etmek istediğinize emin misiniz? Bir sonraki 30 günlük tahsilat durdurulacaktır.')) {
            const user = AuthService.getCurrentUser();
            const res = SubscriptionEngine.cancelSubscription(subId, user.id);
            if (res.success) {
              showToast(res.message, 'info');
              this.renderDashboardSubscriptions(user.id);
              this.renderDashboardInvoices(user.id);
            }
          }
        });
      });
    },

    // Dashboard: Kayıtlı Kartlar
    renderDashboardCards(businessId) {
      const container = document.getElementById('savedCardsList');
      const cards = PaymentService.getCards(businessId);

      if (!cards.length) {
        container.innerHTML = `
          <div class="dash-empty-state">
            <span class="empty-icon">💳</span>
            <h4>Kayıtlı bir ödeme yönteminiz bulunmuyor.</h4>
            <p>Bir paket satın aldığınızda kartınız güvenli şekilde buraya kaydedilir.</p>
          </div>
        `;
        return;
      }

      container.innerHTML = cards.map(c => `
        <div class="saved-card-row">
          <div class="saved-card-left">
            <span class="card-brand-icon ${c.brand}">${c.brand.toUpperCase()}</span>
            <div>
              <strong>${c.masked}</strong>
              <small>${c.holder} • Son Kul: ${c.expiry}</small>
            </div>
          </div>
          <div class="saved-card-right">
            <span class="badge-default-card">Varsayılan Kart</span>
            <span class="security-pci">🔒 Güvenli Altyapı</span>
          </div>
        </div>
      `).join('');
    },

    // Dashboard: Fatura & İşlem Geçmişi
    renderDashboardInvoices(businessId) {
      const tbody = document.getElementById('invoiceTableBody');
      const txs = SubscriptionEngine.getTransactions(businessId);

      if (!txs.length) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" style="text-align:center;padding:2rem;color:var(--color-text-muted);">
              Henüz gerçekleşmiş bir fatura veya provizyon işlemi bulunmuyor.
            </td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = txs.map(tx => {
        const dateStr = new Date(tx.date).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        
        let typeBadge = '';
        if (tx.type === 'trial_authorization') {
          typeBadge = '<span class="tx-badge trial">30 Günlük Deneme</span>';
        } else if (tx.type === 'recurring_charge') {
          typeBadge = '<span class="tx-badge recurring">Periyodik Tahsilat</span>';
        } else if (tx.type === 'cancellation') {
          typeBadge = '<span class="tx-badge cancel">İptal Kaydı</span>';
        }

        const amountStr = tx.amount === 0 ? '₺0.00 (Ücretsiz)' : `₺${tx.amount.toLocaleString('tr-TR')}`;

        return `
          <tr>
            <td>${dateStr}</td>
            <td><strong>${tx.packageName}</strong><br><small style="color:var(--color-text-muted)">${tx.description}</small></td>
            <td>${typeBadge}</td>
            <td><strong class="${tx.amount === 0 ? 'text-free' : ''}">${amountStr}</strong></td>
            <td><code>${tx.cardMasked || '•••• 4242'}</code></td>
            <td><span class="badge-status-active">✓ Onaylandı</span></td>
          </tr>
        `;
      }).join('');
    },

    closeModal(modal) {
      if (!modal) return;
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }
  };

  // Dışarıya Açılan Global Arayüz
  window.OtomasyonBilling = {
    AuthService,
    PaymentService,
    SubscriptionEngine,
    UIManager
  };

  // Sayfa Yüklendiğinde Başlat
  document.addEventListener('DOMContentLoaded', () => {
    UIManager.init();
  });

})();
