/**
 * Ürün Kataloğu — TEK GÜVENİLİR FİYAT KAYNAĞI.
 *
 * Ödeme tutarları HİÇBİR ZAMAN istemciden (tarayıcıdan) gelen fiyat metniyle
 * belirlenmez. Frontend yalnızca bir `productId` gönderir; gerçek tutar burada,
 * sunucu tarafında aranır. Bu sayede DOM/DevTools üzerinden fiyat değiştirme
 * (price tampering) saldırıları etkisiz kalır.
 *
 * amount: kuruş cinsinden (₺1 = 100 kuruş). Örn: ₺2.490 -> 249000
 *   (Paddle'a gönderilirken server.js içinde string'e çevrilir — Paddle
 *   Transactions API `unit_price.amount` alanını string bekler.)
 * mode: 'subscription' (aylık, deneme süreli) | 'payment' (tek seferlik)
 * trialDays: yalnızca subscription ürünlerde geçerli
 *
 * index.html içindeki data-product-id değerleriyle BİREBİR eşleşmelidir.
 */
const PRODUCTS = {
  'whatsapp-musteri-temsilcisi': {
    name: 'WhatsApp Akıllı Müşteri Temsilcisi',
    amount: 249000,
    currency: 'try',
    mode: 'subscription',
    trialDays: 30
  },
  'ai-sesli-telefon-asistani': {
    name: 'AI Sesli Telefon Asistanı',
    amount: 329000,
    currency: 'try',
    mode: 'subscription',
    trialDays: 30
  },
  'instagram-auto-dm-yorum': {
    name: 'Instagram Auto-DM & Yorum Yanıtlayıcı',
    amount: 249000,
    currency: 'try',
    mode: 'subscription',
    trialDays: 30
  },
  'ai-eposta-asistani': {
    name: 'AI Akıllı E-Posta Asistanı',
    amount: 199000,
    currency: 'try',
    mode: 'subscription',
    trialDays: 30
  },
  'b2b-lead-bulucu-bot': {
    name: 'B2B Müşteri & E-posta Bulucu Bot',
    amount: 249000,
    currency: 'try',
    mode: 'payment',
    trialDays: 0
  },
  'telegram-vip-bot': {
    name: 'Telegram Akıllı Mesaj Yanıtlayıcı & VIP Bot',
    amount: 199000,
    currency: 'try',
    mode: 'subscription',
    trialDays: 30
  },
  'eticaret-sepet-tahsilat-bot': {
    name: 'E-Ticaret Terk Edilen Sepet & Tahsilat Botu',
    amount: 189000,
    currency: 'try',
    mode: 'subscription',
    trialDays: 30
  },
  'market-stock-control': {
    name: 'Market Stock Control Otomasyonu',
    amount: 4990000,
    currency: 'try',
    mode: 'payment',
    trialDays: 0
  }
};

// Özel Paket Sihirbazı'nda birden fazla abonelik ürünü seçildiğinde uygulanan indirim
const CUSTOM_PACKAGE_DISCOUNT_PERCENT = 20;

module.exports = { PRODUCTS, CUSTOM_PACKAGE_DISCOUNT_PERCENT };
