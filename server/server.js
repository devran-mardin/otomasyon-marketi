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

// ── Ortam Değişkeni Kontrolü — eksikse sunucu hiç ayağa kalkmasın ──
const REQUIRED_ENV = ['PADDLE_API_KEY', 'PADDLE_WEBHOOK_SECRET', 'PADDLE_ENV', 'CLIENT_URL', 'ALLOWED_ORIGINS'];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`[FATAL] Eksik ortam değişkeni: ${missing.join(', ')}. .env dosyanızı kontrol edin (bkz. .env.example).`);
  process.exit(1);
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
      // TODO (önerilir): Bu kaydı kalıcı bir veritabanına (ör. Supabase) yazın ve
      // işletmeye/size bilgilendirme e-postası gönderin. Şu an yalnızca loglanıyor.
      break;
    }
    case 'subscription.canceled': {
      const sub = event.data;
      console.log(`[webhook] Abonelik sona erdi/iptal edildi: ${sub.id}`);
      break;
    }
    case 'transaction.payment_failed': {
      const txn = event.data;
      console.warn(`[webhook] Tahsilat BAŞARISIZ: customer=${txn.customer_id}`);
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
