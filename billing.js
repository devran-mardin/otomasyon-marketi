/* ═══════════════════════════════════════════════════
   OTOMASYON AI — BILLING & SUBSCRIPTION ENGINE
   1. İşletme Hesabı (B2B Auth & Oturum) — yerel/kozmetik, ödeme gerçeğine karışmaz
   2. Ödeme: gerçek Paddle Transaction + Paddle.js overlay checkout (server/ backend'i üzerinden)
   3. Faturalama Portalı: abonelik yönetimi Paddle Customer Portal'da yapılır
   ═══════════════════════════════════════════════════ */

(function () {
  'use strict';

  // Ödeme backend'inin adresi. Sayfa localhost/127.0.0.1'de açıldığında otomatik
  // olarak yerel backend'e (server/, npm run dev) bağlanır; canlı domain'de
  // (otomasyonmarketi.net) gerçek Railway adresini kullanır. Railway'e deploy
  // ettiğinizde production adresini bu satırda güncelleyin.
  const IS_LOCAL = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const API_BASE = IS_LOCAL ? 'http://localhost:3000' : 'https://api.otomasyonmarketi.net';

  // Paddle.js client-side token — GİZLİ DEĞİLDİR, tarayıcıda görünmesi güvenlidir
  // (asıl gizli anahtar server/.env içindeki PADDLE_API_KEY'dir, buraya ASLA konmaz).
  // Paddle Dashboard > Developer Tools > Authentication'dan alın.
  // "test_..." ile başlıyorsa otomatik sandbox'a geçilir, "live_..." ise production'dır.
  const PADDLE_CLIENT_TOKEN = 'test_73cc930baa345d767b102d9d774';

  // Kullanıcı girdisini innerHTML'e basmadan önce kaçış karakterlerine çevirir (XSS koruması)
  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  // ── 1. Depolama & Veri Modelleri (Storage Keys) ──
  const STORAGE_KEYS = {
    USERS: 'otomasyon_users',
    SESSION: 'otomasyon_active_session',
    SUBSCRIPTIONS: 'otomasyon_subscriptions',
    TRANSACTIONS: 'otomasyon_transactions',
    PADDLE_CUSTOMER: 'otomasyon_paddle_customer'
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

  // ── 3. Kart & Ödeme Altyapısı — KALDIRILDI ──
  // Önceden burada kart numarası/CVV/SKT toplayıp Luhn ile "doğrulayan" ve
  // localStorage'a maskeli kart kaydeden bir PaymentService vardı. Kart verisi
  // artık hiçbir zaman bu siteye uğramıyor: ödeme ve kart saklama tamamen
  // Paddle overlay checkout / Paddle Customer Portal üzerinden yürüyor (bkz.
  // UIManager içindeki handleCheckoutSubmit ve openBillingPortal).

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
      this.initPaddle();
    },

    // Paddle.js'i başlatır ve checkout olaylarını (tamamlandı/kapatıldı) dinler.
    // Paddle overlay bir sayfa yönlendirmesi YAPMAZ — ödeme aynı sayfa üzerinde
    // açılan bir pencerede tamamlanır, bu yüzden Stripe'takine benzer bir
    // "?checkout=success" URL yakalama mantığına gerek yoktur.
    initPaddle() {
      if (typeof Paddle === 'undefined') {
        console.warn('Paddle.js yüklenemedi — ödeme butonları şu an çalışmayacak.');
        return;
      }
      if (PADDLE_CLIENT_TOKEN.startsWith('test_')) {
        Paddle.Environment.set('sandbox');
      }
      Paddle.Initialize({
        token: PADDLE_CLIENT_TOKEN,
        eventCallback: (event) => this.handlePaddleEvent(event)
      });
    },

    // Paddle.js overlay'inden gelen olayları işler.
    async handlePaddleEvent(event) {
      if (!event || !event.name) return;

      if (event.name === 'checkout.completed') {
        const transactionId = event.data?.transaction_id;
        showToast('🎉 Ödemeniz alındı! "Panelim" üzerinden faturalama portalına ulaşabilirsiniz.', 'success');

        if (transactionId) {
          try {
            const res = await fetch(`${API_BASE}/api/transaction/${encodeURIComponent(transactionId)}`);
            const data = await res.json();
            if (res.ok && data.customerId) {
              DB.set(STORAGE_KEYS.PADDLE_CUSTOMER, { customerId: data.customerId });
            }
          } catch (err) {
            console.error('[paddle-checkout-result]', err);
          }
        }
      }
      // 'checkout.closed' için özel bir işlem gerekmiyor — kullanıcı vazgeçmiş demektir.
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
                    <span class="brand-badge amex">AMEX</span>
                    <span class="brand-badge applepay">Pay</span>
                    <span class="brand-badge gpay">G Pay</span>
                    <span class="brand-badge paypal">PayPal</span>
                    <span class="brand-badge paddle-pill">Paddle</span>
                  </div>
                </div>

                <p class="checkout-paddle-note">
                  Kart bilgileriniz bu sitede tutulmaz. "Devam Et" dediğinizde Paddle'ın kendi güvenli ödeme
                  penceresi açılır, işlem orada 3D Secure ile tamamlanır.
                </p>

                <form id="checkoutPaymentForm">
                  <!-- Fatura Bilgileri Toggle -->
                  <div class="billing-details-accordion">
                    <button type="button" class="btn-toggle-billing" id="toggleBillingDetailsBtn">
                      <span>🏢 Kurumsal Fatura Bilgileri</span>
                      <span class="arrow">↓</span>
                    </button>
                    <div class="billing-details-content" id="billingDetailsContent">
                      <div class="form-group">
                        <label>Fatura Şirket Unvanı</label>
                        <input type="text" id="invoiceBizName" class="form-input" placeholder="Şirket Tam Unvanı" maxlength="200">
                      </div>
                      <div class="form-row-2">
                        <div class="form-group">
                          <label>Vergi Dairesi & No / TC</label>
                          <input type="text" id="invoiceTaxNo" class="form-input" placeholder="Vergi No / TC Kimlik" maxlength="50">
                        </div>
                        <div class="form-group">
                          <label>İl / İlçe</label>
                          <input type="text" id="invoiceCity" class="form-input" placeholder="İstanbul / Kadıköy" maxlength="100">
                        </div>
                      </div>
                      <div class="form-group">
                        <label>Fatura Adresi</label>
                        <input type="text" id="invoiceAddress" class="form-input" placeholder="Şirket açık adresi..." maxlength="300">
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
                    <span>🔒 Paddle ile Güvenli Ödemeye Geç</span>
                  </button>
                </form>
              </div>
            </div>

          </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', checkoutModalHtml);
      }

      // 3. 3D Secure Onay Simülasyonu — KALDIRILDI.
      // Kart doğrulama/3D Secure artık gerçek: Paddle'ın kendi barındırdığı
      // overlay checkout penceresinde gerçekleşir. Bu site hiçbir zaman kart
      // numarası, CVV veya SMS/OTP kodu görmez ya da saklamaz.

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
              <div class="dash-header-actions">
                <button class="btn-dash-portal" id="dashPortalBtn">🔒 Faturalama Portalım (Paddle)</button>
                <button class="btn-dash-logout" id="dashLogoutBtn">Çıkış Yap</button>
              </div>
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

    // Navbar'daki Giriş/Hesap Alanını Güncelle (İki Ayrı Buton: Giriş ve Kayıt)
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
        // Kullanıcı giriş yapmış: Paneline doğrudan erişim + Çıkış
        authContainer.innerHTML = `
          <button class="btn-nav-dashboard" id="btnNavDashboard" title="İşletme Profilim & Yönetim Paneli">
            <span class="biz-icon">🏢</span>
            <span class="biz-title">${escapeHtml(user.businessName)}</span>
            <span class="dash-arrow">▾</span>
          </button>
          <button class="btn-nav-logout-icon" id="btnNavLogout" title="Oturumu Kapat">
            Çıkış
          </button>
        `;

        const btnDash = document.getElementById('btnNavDashboard');
        if (btnDash) {
          btnDash.addEventListener('click', () => this.openCustomerDashboard());
        }

        const btnLogout = document.getElementById('btnNavLogout');
        if (btnLogout) {
          btnLogout.addEventListener('click', () => AuthService.logout());
        }
      } else {
        // Kullanıcı henüz giriş yapmamış: İki Ayrı Buton
        authContainer.innerHTML = `
          <button class="btn-nav-login" id="btnNavLogin" title="Kayıtlı işletme hesabınıza giriş yapın veya panelinize erişin">
            <span>İşletme Girişi</span>
          </button>
          <button class="btn-nav-register" id="btnNavRegister" title="Yeni işletme hesabı oluşturun">
            <span>Kayıt Ol</span>
          </button>
        `;

        const btnLogin = document.getElementById('btnNavLogin');
        if (btnLogin) {
          btnLogin.addEventListener('click', () => {
            const activeUser = AuthService.getCurrentUser();
            if (activeUser) {
              // Eğer önceden kaydı ve açık oturumu varsa direkt işletme profiline yönlendir
              this.openCustomerDashboard();
            } else {
              // Değilse doğrudan 'İşletme Girişi' sekmesini aç
              this.openAuthModal('login');
            }
          });
        }

        const btnRegister = document.getElementById('btnNavRegister');
        if (btnRegister) {
          btnRegister.addEventListener('click', () => {
            // İlk defa hesap açacaklar direkt kayda basıp kayıt oluştursun
            this.openAuthModal('register');
          });
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

      // Checkout Formu Gönderimi — gerçek Paddle Transaction oluşturup overlay'i açar
      const checkoutForm = document.getElementById('checkoutPaymentForm');
      if (checkoutForm) {
        checkoutForm.addEventListener('submit', (e) => {
          e.preventDefault();
          this.handleCheckoutSubmit();
        });
      }

      // Faturalama Portalı (Paddle Customer Portal)
      const dashPortalBtn = document.getElementById('dashPortalBtn');
      if (dashPortalBtn) {
        dashPortalBtn.addEventListener('click', () => this.openBillingPortal());
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

    // Sayfadaki ürün kartlarını ve modalları "Satın Al / 1 Ay Ücretsiz Başla" işleyicisine bağla
    bindPurchaseButtons() {
      // 1. Ürün Kartları
      document.querySelectorAll('.product-card').forEach(card => {
        const title = card.querySelector('h3')?.textContent || 'Otomasyon Paketi';
        const priceEl = card.querySelector('.product-price');
        const priceText = priceEl ? priceEl.textContent.trim() : '';
        const category = card.dataset.category || 'whatsapp';
        const productId = card.querySelector('.btn-open-modal')?.dataset.productId || '';

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
          if (!productId) {
            showToast('Bu ürün için satın alma şu an tanımlı değil, lütfen bizimle iletişime geçin.', 'error');
            return;
          }
          this.initiatePurchase({
            title: title,
            category: category,
            priceLabel: priceText,
            productIds: [productId],
            desc: card.querySelector('p')?.textContent || '7/24 kesintisiz otomasyon çözümü.'
          });
        });
      });

      // 2. Ürün Detay Modalı Butonu
      const modalOrderBtn = document.getElementById('modalOrderBtn');
      const productModal = document.getElementById('productModal');
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
          const priceStr = document.getElementById('modalPrice')?.textContent || '';
          const desc = document.getElementById('modalDesc')?.textContent || '';
          const productId = productModal?.dataset.productId || '';

          // Detay modalını kapatıp checkout'a geç
          if (productModal) productModal.classList.remove('active');

          if (!productId) {
            showToast('Bu ürün için satın alma şu an tanımlı değil, lütfen bizimle iletişime geçin.', 'error');
            return;
          }

          this.initiatePurchase({
            title: title,
            category: 'AI Otomasyon',
            priceLabel: priceStr,
            productIds: [productId],
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

          const checked = Array.from(document.querySelectorAll('.pkg-mod-check:checked'));
          const productIds = checked.map(chk => chk.dataset.productId).filter(Boolean);
          const count = document.getElementById('pkgSelectedCount')?.textContent || 'Özel Paket';
          const priceStr = document.getElementById('pkgTotalPrice')?.textContent || '';

          if (!productIds.length) {
            showToast('Lütfen en az bir modül seçin.', 'error');
            return;
          }

          this.initiatePurchase({
            title: `Özel Otomasyon Paketi (${count})`,
            category: 'Özel Paket',
            priceLabel: priceStr,
            productIds: productIds,
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

    // Checkout Modalı Aç — sadece özet gösterir, kart bilgisi burada ASLA toplanmaz.
    // Gerçek ödeme "Devam Et" ile Paddle'ın kendi barındırdığı overlay'de alınır.
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
      document.getElementById('checkoutRecurringPrice').textContent = pkg.priceLabel || '--';
      document.getElementById('termsRecurringText').textContent = pkg.priceLabel || '--';

      // Fatura unvanı alanını kullanıcının işletme adıyla ön doldur
      if (user) {
        const invoiceBiz = document.getElementById('invoiceBizName');
        if (invoiceBiz && !invoiceBiz.value) {
          invoiceBiz.value = user.businessName;
        }
      }

      modal.classList.add('active');
      document.body.style.overflow = 'hidden';
    },

    // Checkout Formu Gönderimi — backend'de GERÇEK bir Paddle Transaction
    // oluşturur, ardından Paddle'ın kendi güvenli overlay checkout'unu açar.
    // Fiyat burada DEĞİL, sunucu tarafındaki ürün kataloğunda belirlenir; bu sayede
    // istemci tarafında fiyat/DOM manipülasyonu ile ödeme tutarı değiştirilemez.
    async handleCheckoutSubmit() {
      const terms = document.getElementById('termsCheck').checked;
      if (!terms) {
        showToast('Lütfen abonelik ve deneme şartlarını onaylayınız.', 'error');
        return;
      }

      const user = AuthService.getCurrentUser();
      const pkg = this.currentCheckoutPackage;
      if (!user || !pkg || !pkg.productIds || !pkg.productIds.length) {
        showToast('Oturum veya paket bilgisi bulunamadı, lütfen tekrar deneyin.', 'error');
        return;
      }

      const submitBtn = document.getElementById('btnSubmitPayment');
      const originalLabel = submitBtn.innerHTML;
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Hazırlanıyor…</span>';

      try {
        const billingDetails = {
          invoiceBizName: document.getElementById('invoiceBizName').value || user.businessName,
          taxNo: document.getElementById('invoiceTaxNo').value || '',
          city: document.getElementById('invoiceCity').value || '',
          address: document.getElementById('invoiceAddress').value || ''
        };

        const res = await fetch(`${API_BASE}/api/create-transaction`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            productIds: pkg.productIds,
            customerEmail: user.email,
            billingDetails
          })
        });

        const data = await res.json();
        if (!res.ok || !data.transactionId) {
          throw new Error(data.error || 'Ödeme oturumu oluşturulamadı.');
        }

        if (typeof Paddle === 'undefined') {
          throw new Error('Ödeme sistemi yüklenemedi. Lütfen sayfayı yenileyip tekrar deneyin.');
        }

        // Kendi özet modalımızı kapatıp Paddle'ın kendi güvenli overlay'ini açıyoruz.
        this.closeModal(document.getElementById('checkoutModal'));
        Paddle.Checkout.open({
          transactionId: data.transactionId,
          customer: { email: user.email }
        });
      } catch (err) {
        console.error('[checkout]', err);
        showToast(err.message || 'Ödeme başlatılamadı. Lütfen daha sonra tekrar deneyin.', 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalLabel;
      }
    },

    // Faturalama Portalı: Paddle Customer Portal'a yönlendirir. Abonelik iptali,
    // kart güncelleme ve fatura indirme artık tamamen Paddle'ın güvenli sayfasında yapılır.
    async openBillingPortal() {
      const stored = DB.get(STORAGE_KEYS.PADDLE_CUSTOMER, null);
      if (!stored || !stored.customerId) {
        showToast('Faturalama portalına erişmek için önce bir paket satın almış olmanız gerekir.', 'info');
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/api/create-portal-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customerId: stored.customerId })
        });
        const data = await res.json();
        if (!res.ok || !data.url) {
          throw new Error(data.error || 'Faturalama portalı açılamadı.');
        }
        window.location.href = data.url;
      } catch (err) {
        console.error('[billing-portal]', err);
        showToast(err.message || 'Faturalama portalı açılamadı. Lütfen daha sonra tekrar deneyin.', 'error');
      }
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
                <span class="sub-category-tag">${escapeHtml(sub.packageCategory)}</span>
                <h4>${escapeHtml(sub.packageName)}</h4>
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
                <strong>${escapeHtml(sub.cardMasked || '•••• 4242')}</strong>
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

    // Dashboard: Ödeme Yöntemi — kart bilgisi bu sitede hiç tutulmadığı için
    // yönetim tamamen Paddle'ın kendi güvenli Faturalama Portalı'nda yapılır.
    renderDashboardCards(businessId) {
      const container = document.getElementById('savedCardsList');
      container.innerHTML = `
        <div class="dash-empty-state">
          <span class="empty-icon">💳</span>
          <h4>Kart bilgileriniz bu sitede saklanmaz.</h4>
          <p>Kayıtlı kartınızı görüntülemek, güncellemek veya değiştirmek için Paddle'ın güvenli Faturalama Portalı'nı kullanın.</p>
          <button type="button" class="btn-primary-glow btn-sm" id="btnOpenPortalFromCards">🔒 Faturalama Portalını Aç</button>
        </div>
      `;
      const btn = document.getElementById('btnOpenPortalFromCards');
      if (btn) btn.addEventListener('click', () => this.openBillingPortal());
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
            <td><strong>${escapeHtml(tx.packageName)}</strong><br><small style="color:var(--color-text-muted)">${escapeHtml(tx.description)}</small></td>
            <td>${typeBadge}</td>
            <td><strong class="${tx.amount === 0 ? 'text-free' : ''}">${amountStr}</strong></td>
            <td><code>${escapeHtml(tx.cardMasked || '•••• 4242')}</code></td>
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
    SubscriptionEngine,
    UIManager
  };

  // Sayfa Yüklendiğinde Başlat
  document.addEventListener('DOMContentLoaded', () => {
    UIManager.init();
  });

})();
