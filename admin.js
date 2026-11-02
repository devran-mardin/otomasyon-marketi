/* ═══════════════════════════════════════════════════
   OTOMASYON AI — YÖNETİCİ PANELİ MANTIĞI
   Basit şifreli giriş + backend'deki (server/) admin API'sinden
   lead / ödeme-olayı / Paddle canlı verisini çekip tabloya döker.
   ═══════════════════════════════════════════════════ */

(function () {
  'use strict';

  const IS_LOCAL = ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const API_BASE = IS_LOCAL ? 'http://localhost:3000' : 'https://api.otomasyonmarketi.net';
  const TOKEN_KEY = 'otomasyon_admin_token';

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function getToken() {
    try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
  }
  function setToken(token) {
    try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* özel gezinti vb. — görmezden gel */ }
  }
  function clearToken() {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* yok say */ }
  }

  async function adminFetch(path) {
    const token = getToken();
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.status === 401) {
      clearToken();
      showLogin('Oturum süresi doldu, lütfen tekrar giriş yapın.');
      throw new Error('unauthorized');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'İstek başarısız.');
    return data;
  }

  function formatDate(value) {
    if (!value) return '—';
    // SQLite'ın datetime('now') çıktısı ("2026-11-02 10:00:00") UTC'dir ama
    // saat dilimi içermez; tarayıcı bunu yerel saat sanıp 3 saat kaydırır.
    const normalized = typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
      ? `${value.replace(' ', 'T')}Z`
      : value;
    const d = new Date(normalized);
    if (Number.isNaN(d.getTime())) return escapeHtml(String(value));
    return d.toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function formatMinorAmount(amount, currency) {
    if (amount == null) return '—';
    const major = Number(amount) / 100;
    return `${major.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${escapeHtml(currency || '')}`.trim();
  }

  function statusPill(status) {
    const s = String(status || '').toLowerCase();
    let cls = 'neutral';
    if (['completed', 'active', 'paid', 'ready'].includes(s)) cls = 'ok';
    if (['canceled', 'failed', 'past_due', 'payment_failed'].includes(s)) cls = 'warn';
    return `<span class="status-pill ${cls}">${escapeHtml(status || '—')}</span>`;
  }

  // ── Giriş / Çıkış ──
  const loginScreen = document.getElementById('loginScreen');
  const panelScreen = document.getElementById('panelScreen');
  const loginForm = document.getElementById('loginForm');
  const loginPassword = document.getElementById('loginPassword');
  const loginError = document.getElementById('loginError');
  const loginBtn = document.getElementById('loginBtn');
  const logoutBtn = document.getElementById('logoutBtn');

  function showLogin(message) {
    panelScreen.hidden = true;
    loginScreen.hidden = false;
    loginError.textContent = message || '';
    loginPassword.value = '';
    loginPassword.focus();
  }

  function showPanel() {
    loginScreen.hidden = true;
    panelScreen.hidden = false;
    loadOverview();
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';
    loginBtn.disabled = true;
    loginBtn.textContent = 'Giriş yapılıyor…';
    try {
      const res = await fetch(`${API_BASE}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: loginPassword.value })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Giriş başarısız.');
      setToken(data.token);
      showPanel();
    } catch (err) {
      loginError.textContent = err.message || 'Giriş başarısız.';
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = 'Giriş Yap';
    }
  });

  logoutBtn.addEventListener('click', () => {
    clearToken();
    showLogin();
  });

  // ── Sekmeler ──
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');
  const loadedTabs = new Set();

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      tabButtons.forEach((b) => b.classList.toggle('active', b === btn));
      tabPanels.forEach((p) => p.classList.toggle('active', p.id === `tab-${tab}`));
      loadTab(tab);
    });
  });

  function loadTab(tab) {
    if (tab === 'overview') return loadOverview();
    if (tab === 'leads') return loadLeads();
    if (tab === 'payments') return loadPayments();
    if (tab === 'paddle') return loadPaddle();
  }

  document.querySelectorAll('[data-refresh]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.refresh;
      loadedTabs.delete(tab);
      loadTab(tab);
    });
  });

  // ── Genel Bakış ──
  async function loadOverview() {
    try {
      const stats = await adminFetch('/api/admin/stats');
      document.getElementById('statLeads').textContent = stats.leadCount ?? '—';
      document.getElementById('statCompleted').textContent = stats.completedTransactions ?? '—';
      document.getElementById('statFailed').textContent = stats.failedPayments ?? '—';
      document.getElementById('statCanceled').textContent = stats.canceledSubscriptions ?? '—';

      const revenueList = document.getElementById('revenueList');
      const entries = Object.entries(stats.revenueByCurrency || {});
      revenueList.innerHTML = entries.length
        ? entries.map(([cur, amt]) => `<span class="revenue-pill">${formatMinorAmount(amt, cur)}</span>`).join('')
        : '<p class="empty-msg">Henüz gelir kaydı yok.</p>';
    } catch (err) {
      if (err.message !== 'unauthorized') console.error('[overview]', err);
    }
  }

  // ── Lead'ler ──
  async function loadLeads() {
    const tbody = document.querySelector('#leadsTable tbody');
    const empty = document.getElementById('leadsEmpty');
    try {
      const { leads } = await adminFetch('/api/admin/leads');
      empty.hidden = leads.length > 0;
      tbody.innerHTML = leads.map((l) => `
        <tr>
          <td>${formatDate(l.created_at)}</td>
          <td>${escapeHtml(l.name)}</td>
          <td>${escapeHtml(l.phone)}</td>
          <td>${escapeHtml(l.service || '—')}</td>
          <td>${escapeHtml(l.message || '—')}</td>
        </tr>
      `).join('');
    } catch (err) {
      if (err.message !== 'unauthorized') console.error('[leads]', err);
    }
  }

  // ── Ödeme Geçmişi ──
  async function loadPayments() {
    const tbody = document.querySelector('#paymentsTable tbody');
    const empty = document.getElementById('paymentsEmpty');
    try {
      const { events } = await adminFetch('/api/admin/payment-events');
      empty.hidden = events.length > 0;
      tbody.innerHTML = events.map((e) => `
        <tr>
          <td>${formatDate(e.created_at)}</td>
          <td>${escapeHtml(e.event_type)}</td>
          <td>${formatMinorAmount(e.amount, e.currency)}</td>
          <td>${statusPill(e.status)}</td>
          <td>${escapeHtml(e.customer_id || '—')}</td>
          <td>${escapeHtml(e.reference_id || '—')}</td>
        </tr>
      `).join('');
    } catch (err) {
      if (err.message !== 'unauthorized') console.error('[payments]', err);
    }
  }

  // ── Paddle Canlı Veri ──
  async function loadPaddle() {
    try {
      const [customers, subscriptions, transactions] = await Promise.all([
        adminFetch('/api/admin/paddle/customers').catch(() => ({ data: [] })),
        adminFetch('/api/admin/paddle/subscriptions').catch(() => ({ data: [] })),
        adminFetch('/api/admin/paddle/transactions').catch(() => ({ data: [] }))
      ]);

      document.querySelector('#customersTable tbody').innerHTML = (customers.data || []).map((c) => `
        <tr>
          <td>${escapeHtml(c.name || '—')}</td>
          <td>${escapeHtml(c.email || '—')}</td>
          <td>${statusPill(c.status)}</td>
          <td>${formatDate(c.created_at)}</td>
        </tr>
      `).join('') || '<tr><td colspan="4" class="empty-msg">Kayıt yok.</td></tr>';

      document.querySelector('#subscriptionsTable tbody').innerHTML = (subscriptions.data || []).map((s) => `
        <tr>
          <td>${escapeHtml(s.id)}</td>
          <td>${statusPill(s.status)}</td>
          <td>${escapeHtml(s.customer_id || '—')}</td>
          <td>${formatDate(s.next_billed_at)}</td>
        </tr>
      `).join('') || '<tr><td colspan="4" class="empty-msg">Kayıt yok.</td></tr>';

      document.querySelector('#transactionsTable tbody').innerHTML = (transactions.data || []).map((t) => `
        <tr>
          <td>${escapeHtml(t.id)}</td>
          <td>${statusPill(t.status)}</td>
          <td>${formatMinorAmount(t.details?.totals?.total, t.currency_code)}</td>
          <td>${escapeHtml(t.customer_id || '—')}</td>
          <td>${formatDate(t.created_at)}</td>
        </tr>
      `).join('') || '<tr><td colspan="5" class="empty-msg">Kayıt yok.</td></tr>';
    } catch (err) {
      if (err.message !== 'unauthorized') console.error('[paddle]', err);
    }
  }

  // ── Başlangıç ──
  if (getToken()) {
    showPanel();
  } else {
    showLogin();
  }
})();
