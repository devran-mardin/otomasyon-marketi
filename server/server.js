/**
 * OTOMASYON AI — Ödeme Backend'i (Paddle Billing)
 * Gerçek Paddle Transaction oluşturma, webhook doğrulama ve
 * Customer Portal yönlendirmesi. Paddle API anahtarı ve webhook secret
 * SADECE burada, sunucu tarafında kullanılır — asla frontend'e verilmez.
 *
 * Paddle bir "Merchant of Record"dur: kart/ödeme verisini kendi barındırdığı
 * Paddle.js overlay checkout'unda toplar, KDV/vergiyi kendisi hesaplar ve
 * beyan eder. Bu backend yalnızca (1) fiyatı sunucu tarafında belirleyip bir
 * Transaction oluşturur, (2) Paddle'dan gelen webhook olaylarını doğrular,
 * (3) müşterinin Customer Portal linkini üretir.
 */
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const { PRODUCTS, CUSTOM_PACKAGE_DISCOUNT_PERCENT } = require('./catalog');
const db = require('./db');
const adminAuth = require('./admin-auth');

// ── Ortam Değişkeni Kontrolü — eksikse sunucu hiç ayağa kalkmasın ──
// PADDLE_WEBHOOK_SECRET kasıtlı olarak burada YOK: henüz bir Paddle webhook
// destination'ı kurmadan da (yerelde checkout akışını test etmek için) sunucuyu
// ayağa kaldırabilesiniz. Eksikse yalnızca /api/webhook isteği geldiğinde hata verir.
const REQUIRED_ENV = [
  'PADDLE_API_KEY', 'PADDLE_ENV', 'CLIENT_URL', 'ALLOWED_ORIGINS',
  'ADMIN_PASSWORD', 'ADMIN_SESSION_SECRET'
];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`[FATAL] Eksik ortam değişkeni: ${missing.join(', ')}. .env dosyanızı kontrol edin (bkz. .env.example).`);
  process.exit(1);
}
if (!process.env.PADDLE_WEBHOOK_SECRET) {
  console.warn('[uyarı] PADDLE_WEBHOOK_SECRET tanımlı değil — /api/webhook isteklerini şu an reddedecek. Paddle Dashboard\'da bir Notification destination kurunca .env\'e ekleyin.');
}

if (!['sandbox', 'production'].includes(process.env.PADDLE_ENV)) {
  console.error('[FATAL] PADDLE_ENV yalnızca "sandbox" veya "production" olabilir.');
  process.exit(1);
}

// Sandbox'ta test kartlarıyla ücretsiz denenir, production'da gerçek para hareket eder.
const PADDLE_API_BASE = process.env.PADDLE_ENV === 'production'
  ? 'https://api.paddle.com'
  : 'https://sandbox-api.paddle.com';

const allowedOrigins = process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);

// Paddle REST API'sine imzalı istek atan küçük yardımcı.
async function paddleFetch(path, options = {}) {
  const res = await fetch(`${PADDLE_API_BASE}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${process.env.PADDLE_API_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    console.error('[paddle-api-error]', JSON.stringify(data));
    const message = data?.error?.detail || data?.error?.code || `Paddle API hatası (HTTP ${res.status})`;
    throw new Error(message);
  }
  return data;
}

const app = express();
app.set('trust proxy', 1); // Railway/proxy arkasında doğru IP için (rate limit doğruluğu)
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    // origin yoksa (sunucu-sunucu, curl vb.) veya izinli listede ise geçir
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('CORS: Bu origin için izin yok.'));
  },
  methods: ['GET', 'POST'],
  optionsSuccessStatus: 200
}));

// ── Webhook: RAW body şart (imza doğrulaması için), bu yüzden
// express.json()'dan ÖNCE tanımlanmalı. ──
app.post('/api/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (!process.env.PADDLE_WEBHOOK_SECRET) {
    console.error('[webhook] PADDLE_WEBHOOK_SECRET tanımlı değil, istek reddedildi.');
    return res.status(500).send('Webhook Error: Sunucu webhook için yapılandırılmamış.');
  }

  const signatureHeader = req.headers['paddle-signature'];
  if (!signatureHeader || typeof signatureHeader !== 'string') {
    return res.status(400).send('Webhook Error: Paddle-Signature başlığı eksik.');
  }

  // Paddle-Signature formatı: "ts=1671552777;h1=<hmac-sha256-hex>"
  const parts = Object.fromEntries(
    signatureHeader.split(';').map((p) => p.split('=')).filter((p) => p.length === 2)
  );
  const { ts, h1 } = parts;
  if (!ts || !h1) {
    return res.status(400).send('Webhook Error: İmza formatı geçersiz.');
  }

  // Eski (yakalanıp tekrar gönderilen) imzalı istekleri reddet: Paddle'ın
  // önerdiği gibi zaman damgası 5 dakikadan eski olmamalı.
  const WEBHOOK_TOLERANCE_SEC = 5 * 60;
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > WEBHOOK_TOLERANCE_SEC) {
    return res.status(400).send('Webhook Error: Zaman damgası geçersiz veya çok eski.');
  }

  if (!Buffer.isBuffer(req.body)) {
    return res.status(400).send('Webhook Error: Gövde okunamadı.');
  }
  const rawBody = req.body.toString('utf8');
  const signedPayload = `${ts}:${rawBody}`;
  const computedHash = crypto
    .createHmac('sha256', process.env.PADDLE_WEBHOOK_SECRET)
    .update(signedPayload, 'utf8')
    .digest('hex');

  const isValid = computedHash.length === h1.length
    && crypto.timingSafeEqual(Buffer.from(computedHash), Buffer.from(h1));

  if (!isValid) {
    console.error('[webhook] İmza doğrulama hatası.');
    return res.status(401).send('Webhook Error: İmza doğrulanamadı.');
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (err) {
    return res.status(400).send('Webhook Error: Gövde JSON değil.');
  }

  switch (event.event_type) {
    case 'transaction.completed': {
      const txn = event.data;
      console.log(
        `[webhook] Ödeme tamamlandı — txn=${txn.id} customer=${txn.customer_id} ` +
        `total=${txn.details?.totals?.total} ${txn.currency_code}`
      );
      db.insertPaymentEvent({
        eventId: event.event_id || null,
        eventType: event.event_type,
        referenceId: txn.id,
        customerId: txn.customer_id || null,
        amount: txn.details?.totals?.total ? Number(txn.details.totals.total) : null,
        currency: txn.currency_code || null,
        status: txn.status || null,
        raw: rawBody
      });
      break;
    }
    case 'subscription.canceled': {
      const sub = event.data;
      console.log(`[webhook] Abonelik sona erdi/iptal edildi: ${sub.id}`);
      db.insertPaymentEvent({
        eventId: event.event_id || null,
        eventType: event.event_type,
        referenceId: sub.id,
        customerId: sub.customer_id || null,
        amount: null,
        currency: null,
        status: sub.status || null,
        raw: rawBody
      });
      break;
    }
    case 'transaction.payment_failed': {
      const txn = event.data;
      console.warn(`[webhook] Tahsilat BAŞARISIZ: customer=${txn.customer_id}`);
      db.insertPaymentEvent({
        eventId: event.event_id || null,
        eventType: event.event_type,
        referenceId: txn.id,
        customerId: txn.customer_id || null,
        amount: null,
        currency: txn.currency_code || null,
        status: txn.status || null,
        raw: rawBody
      });
      break;
    }
    default:
      break;
  }

  res.json({ received: true });
});

app.use(express.json({ limit: '32kb' }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla istek gönderildi. Lütfen birkaç dakika sonra tekrar deneyin.' }
});

// Fatura bilgisi gibi opsiyonel serbest metinleri Paddle custom_data'sına
// güvenli uzunlukta aktarır.
function toMetadataString(value, maxLen = 300) {
  if (typeof value !== 'string') return '';
  return value.slice(0, maxLen);
}

app.post('/api/create-transaction', apiLimiter, async (req, res) => {
  try {
    const { productIds, customerEmail, billingDetails } = req.body || {};

    if (!Array.isArray(productIds) || productIds.length === 0 || productIds.length > 10) {
      return res.status(400).json({ error: 'Geçersiz ürün listesi.' });
    }

    // Fiyatlar İSTEMCİDEN DEĞİL, sunucudaki kataloğdan okunur.
    const items = [];
    for (const id of productIds) {
      const product = PRODUCTS[id];
      if (!product) {
        return res.status(400).json({ error: `Bilinmeyen ürün: ${id}` });
      }
      items.push({ id, ...product });
    }

    const modes = new Set(items.map((i) => i.mode));
    if (modes.size > 1) {
      return res.status(400).json({ error: 'Abonelik ürünleri ile tek seferlik ürünler aynı sepette birleştirilemez.' });
    }
    const mode = items[0].mode;
    const isBundle = items.length > 1;
    const currency = items[0].currency.toUpperCase();

    // Özel Paket Sihirbazı'ndan gelen çoklu abonelik seçimlerine indirim uygula
    const discountMultiplier = (isBundle && mode === 'subscription')
      ? (100 - CUSTOM_PACKAGE_DISCOUNT_PERCENT) / 100
      : 1;

    const trialDays = mode === 'subscription' ? Math.max(...items.map((i) => i.trialDays || 0)) : 0;

    // Paddle'da kataloğa (Dashboard'a) önceden ürün/fiyat tanımlamaya gerek yok:
    // her satır için "non-catalog price" (istemciye görünmeyen, tamamen bizim
    // belirlediğimiz anlık fiyat nesnesi) gönderiyoruz. Bu, Stripe'taki
    // price_data'nın Paddle karşılığıdır ve fiyat yine sadece sunucuda belirlenir.
    const paddleItems = items.map((item) => ({
      quantity: 1,
      price: {
        description: `Otomasyon Marketi — ${item.name}`,
        name: item.name,
        unit_price: {
          amount: String(Math.round(item.amount * discountMultiplier)),
          currency_code: currency
        },
        tax_mode: 'account_setting',
        // Paddle, tam anlık (non-catalog) fiyatlarda ürünü de inline istiyor —
        // Dashboard'da önceden bir Product oluşturmaya gerek kalmıyor.
        product: {
          name: item.name,
          tax_category: 'saas'
        },
        ...(mode === 'subscription' ? { billing_cycle: { interval: 'month', frequency: 1 } } : {}),
        ...(mode === 'subscription' && trialDays > 0
          ? { trial_period: { interval: 'day', frequency: trialDays } }
          : {})
      }
    }));

    const transactionBody = {
      items: paddleItems,
      currency_code: currency,
      collection_mode: 'automatic'
    };

    const customData = {};
    if (typeof customerEmail === 'string' && customerEmail.length <= 320) {
      customData.customerEmail = customerEmail;
    }
    if (billingDetails && typeof billingDetails === 'object') {
      customData.invoiceBizName = toMetadataString(billingDetails.invoiceBizName, 200);
      customData.taxNo = toMetadataString(billingDetails.taxNo, 50);
      customData.city = toMetadataString(billingDetails.city, 100);
      customData.address = toMetadataString(billingDetails.address, 300);
    }
    if (Object.keys(customData).length) {
      transactionBody.custom_data = customData;
    }

    const result = await paddleFetch('/transactions', {
      method: 'POST',
      body: JSON.stringify(transactionBody)
    });

    // Frontend, dönen transactionId'yi Paddle.Checkout.open({ transactionId }) ile
    // kendi overlay'inde açar — burada bir yönlendirme URL'i gerekmez.
    res.json({ transactionId: result.data.id });
  } catch (err) {
    console.error('[create-transaction]', err);
    res.status(400).json({ error: 'Ödeme oturumu oluşturulamadı. Lütfen tekrar deneyin.' });
  }
});

// Checkout tamamlandığında (checkout.completed event'i ile) frontend'in
// transaction durumunu ve müşteri kimliğini sorgulaması için.
app.get('/api/transaction/:id', apiLimiter, async (req, res) => {
  try {
    if (!/^txn_[A-Za-z0-9]+$/.test(req.params.id)) {
      return res.status(400).json({ error: 'Geçersiz işlem kimliği.' });
    }
    const result = await paddleFetch(`/transactions/${encodeURIComponent(req.params.id)}`);
    res.json({
      status: result.data.status,
      customerId: result.data.customer_id || null
    });
  } catch (err) {
    res.status(404).json({ error: 'İşlem bulunamadı.' });
  }
});

app.post('/api/create-portal-session', apiLimiter, async (req, res) => {
  try {
    const { customerId } = req.body || {};
    if (typeof customerId !== 'string' || !/^ctm_[A-Za-z0-9]+$/.test(customerId)) {
      return res.status(400).json({ error: 'Geçersiz müşteri kimliği.' });
    }

    const result = await paddleFetch(`/customers/${encodeURIComponent(customerId)}/portal-sessions`, {
      method: 'POST',
      body: JSON.stringify({})
    });

    res.json({ url: result.data.urls.general.overview });
  } catch (err) {
    console.error('[create-portal-session]', err);
    res.status(400).json({ error: 'Faturalama portalı açılamadı.' });
  }
});

// ── Lead Kaydı — Web İletişim Formu ──
// Form gönderildiğinde WhatsApp'a yönlendirmeye EK olarak (onun yerine değil)
// burada da kaydedilir, böylece admin panelinden görülebilir.
const leadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla istek gönderildi. Lütfen birkaç dakika sonra tekrar deneyin.' }
});

app.post('/api/leads', leadLimiter, (req, res) => {
  const { name, phone, service, message } = req.body || {};

  if (typeof name !== 'string' || !name.trim() || name.length > 120) {
    return res.status(400).json({ error: 'Geçerli bir ad gerekli.' });
  }
  if (typeof phone !== 'string' || !phone.trim() || phone.length > 40) {
    return res.status(400).json({ error: 'Geçerli bir telefon gerekli.' });
  }

  db.insertLead({
    name: name.trim(),
    phone: phone.trim(),
    service: toMetadataString(service, 120),
    message: toMetadataString(message, 1000)
  });

  res.json({ ok: true });
});

// ── Admin Paneli — Basit Şifreli Oturum ──
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla deneme yapıldı. Lütfen birkaç dakika sonra tekrar deneyin.' }
});

const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 saat

app.post('/api/admin/login', adminLoginLimiter, (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== 'string' || !password || password.length > 200) {
    return res.status(400).json({ error: 'Şifre gerekli.' });
  }

  const expected = Buffer.from(process.env.ADMIN_PASSWORD);
  const given = Buffer.from(password);
  const isValid = expected.length === given.length && crypto.timingSafeEqual(expected, given);
  if (!isValid) {
    return res.status(401).json({ error: 'Şifre hatalı.' });
  }

  const token = adminAuth.sign({ role: 'admin' }, process.env.ADMIN_SESSION_SECRET, ADMIN_SESSION_TTL_MS);
  res.json({ token, expiresInMs: ADMIN_SESSION_TTL_MS });
});

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token && adminAuth.verify(token, process.env.ADMIN_SESSION_SECRET);
  if (!payload || payload.role !== 'admin') {
    return res.status(401).json({ error: 'Yetkisiz erişim. Lütfen tekrar giriş yapın.' });
  }
  next();
}

app.get('/api/admin/leads', requireAdmin, (req, res) => {
  res.json({ leads: db.listLeads(200) });
});

app.get('/api/admin/payment-events', requireAdmin, (req, res) => {
  res.json({ events: db.listPaymentEvents(200) });
});

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const events = db.listPaymentEvents(1000);
  const completed = events.filter((e) => e.event_type === 'transaction.completed');
  const revenueByCurrency = {};
  for (const e of completed) {
    if (!e.currency || e.amount == null) continue;
    revenueByCurrency[e.currency] = (revenueByCurrency[e.currency] || 0) + e.amount;
  }

  res.json({
    leadCount: db.countLeads(),
    completedTransactions: completed.length,
    revenueByCurrency,
    failedPayments: events.filter((e) => e.event_type === 'transaction.payment_failed').length,
    canceledSubscriptions: events.filter((e) => e.event_type === 'subscription.canceled').length
  });
});

// Paddle'daki gerçek (canlı) müşteri/abonelik/işlem verisini panelde göstermek için.
app.get('/api/admin/paddle/customers', requireAdmin, async (req, res) => {
  try {
    const result = await paddleFetch('/customers?per_page=50&order_by=created_at[DESC]');
    res.json(result);
  } catch (err) {
    console.error('[admin/paddle/customers]', err);
    res.status(502).json({ error: 'Paddle müşteri listesi alınamadı.' });
  }
});

app.get('/api/admin/paddle/subscriptions', requireAdmin, async (req, res) => {
  try {
    // Not: Paddle'ın /subscriptions uç noktası yalnızca 'id' ile sıralamaya izin verir.
    const result = await paddleFetch('/subscriptions?per_page=50&order_by=id[DESC]');
    res.json(result);
  } catch (err) {
    console.error('[admin/paddle/subscriptions]', err);
    res.status(502).json({ error: 'Paddle abonelik listesi alınamadı.' });
  }
});

app.get('/api/admin/paddle/transactions', requireAdmin, async (req, res) => {
  try {
    const result = await paddleFetch('/transactions?per_page=50&order_by=created_at[DESC]');
    res.json(result);
  } catch (err) {
    console.error('[admin/paddle/transactions]', err);
    res.status(502).json({ error: 'Paddle işlem listesi alınamadı.' });
  }
});

app.get('/health', (req, res) => res.json({ ok: true }));

// Genel hata yakalayıcı — beklenmedik hatalarda (ör. CORS reddi) stack trace
// gibi iç detayları istemciye asla sızdırmaz.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[unhandled]', err);
  res.status(err.status || 500).json({ error: 'Beklenmedik bir hata oluştu.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Otomasyon Marketi ödeme sunucusu (Paddle, ${process.env.PADDLE_ENV}) ${PORT} portunda çalışıyor.`);
});
