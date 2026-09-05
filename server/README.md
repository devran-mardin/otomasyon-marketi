# Otomasyon Marketi — Ödeme Backend'i (Paddle Billing)

`otomasyonmarketi.net` sitesindeki "Satın Al / 1 Ay Ücretsiz Başla" butonlarının
bağlandığı, gerçek Paddle ödemelerini işleyen küçük Node/Express servisi.

**Neden Paddle?** Paddle bir "Merchant of Record"dur — yani sizin adınıza satıcı
olarak işlem yapar, dünya genelinde KDV/vergiyi kendisi hesaplayıp beyan eder.
Kart bilgisi Paddle'ın kendi barındırdığı overlay (site üzerinde açılan pencere)
checkout'unda toplanır, bu siteye hiç uğramaz.

Bu backend olmadan **gerçek ödeme alınamaz** — Paddle API anahtarı (secret key)
hiçbir zaman tarayıcıya/HTML-JS'e konamaz, bu yüzden Transaction oluşturma ve
webhook doğrulama işlemleri sunucu tarafında yapılmak zorundadır.

## Ne yapar?

- `POST /api/create-transaction` — istemciden yalnızca `productId` listesi alır,
  gerçek fiyatı **kendi kataloğundan** (`catalog.js`) okur ve Paddle'da bir
  Transaction oluşturup `transactionId` döner. Fiyat asla istemciden gelmez —
  bu, tarayıcı/DevTools üzerinden fiyat değiştirme saldırılarını (price
  tampering) imkânsız kılar. Frontend bu `transactionId`'yi
  `Paddle.Checkout.open({ transactionId })` ile kendi overlay'inde açar.
- `POST /api/webhook` — Paddle'ın gönderdiği olayları `Paddle-Signature`
  başlığı ile imza doğrulaması yaparak dinler (`transaction.completed`,
  `subscription.canceled`, `transaction.payment_failed`). Şu an olayları
  loglar; kalıcı kayıt/e-posta bildirimi eklemek isterseniz burası
  genişletilecek yer.
- `GET /api/transaction/:id` — checkout tamamlandığında (Paddle.js
  `checkout.completed` event'i) site tarafının işlem durumunu ve Paddle
  müşteri kimliğini sorgulaması için.
- `POST /api/create-portal-session` — "Faturalama Portalım" butonunun
  bağlandığı, Paddle'ın kendi barındırdığı Customer Portal'a (kart güncelleme,
  abonelik iptali, fatura indirme) yönlendirme oluşturur.

## Sandbox mı, Production mı?

Paddle'da **iki ayrı hesap** vardır: Sandbox (test, sahte kartlarla ücretsiz
dener) ve Production (canlı, gerçek para). Her ikisinin de kendi API anahtarı,
kendi webhook secret'ı ve kendi Dashboard adresi vardır:

- Sandbox Dashboard: https://sandbox-vendors.paddle.com
- Production Dashboard: https://vendors.paddle.com (canlıya geçmeden önce
  Paddle'ın hesabınızı onaylaması gerekir — işletme bilgisi ve site incelemesi
  birkaç gün sürebilir)

`.env` içindeki `PADDLE_ENV` değişkeni hangisini kullandığınızı belirler.

## Yerelde Çalıştırma (Sandbox)

```bash
cd server
npm install
cp .env.example .env
# .env dosyasını Paddle SANDBOX anahtarlarınızla doldurun (PADDLE_ENV=sandbox)
npm run dev
```

Webhook'u yerelde test etmek için sunucunuzu internete açan bir tünel gerekir
(Paddle, localhost'a doğrudan webhook gönderemez):

```bash
# örnek: ngrok ile
ngrok http 3000
```

Verilen `https://....ngrok-free.app/api/webhook` adresini Paddle Dashboard >
Developer Tools > Notifications > "+ New destination" ile ekleyin, oradaki
gizli anahtarı `.env` içindeki `PADDLE_WEBHOOK_SECRET`'a yazın.

## Railway'e Deploy

1. Bu `server/` klasörünü ayrı bir Railway servisi olarak deploy edin
   (`_skills/use-railway` ve `_skills/railway-deploy-rules` yardımcı olur).
2. Railway servis ayarlarında **Environment Variables** kısmına `.env.example`
   içindeki değişkenleri gerçek değerleriyle girin. `.env` dosyasını asla
   repoya eklemeyin. Önce `PADDLE_ENV=sandbox` ile canlı ortamda test edin,
   sorunsuz çalıştığından emin olunca `production` anahtarlarına geçin.
3. Deploy sonrası Railway'in verdiği public URL'i not edin (örn.
   `https://otomasyon-marketi-server.up.railway.app`) ve isterseniz kendi
   domaininize (`api.otomasyonmarketi.net`) CNAME ile bağlayın.
4. Paddle Dashboard > Developer Tools > Notifications > "+ New destination"
   ile `https://<backend-adresiniz>/api/webhook` adresini ekleyin, dinlenecek
   olaylar: `transaction.completed`, `subscription.canceled`,
   `transaction.payment_failed`. Oluşan gizli anahtarı Railway'deki
   `PADDLE_WEBHOOK_SECRET` değişkenine yazın.
5. Ana sitedeki `index.html` içindeki Paddle.js `<script>` bloğundaki token
   (`Paddle.Initialize({ token: ... })`) değerini Paddle Dashboard > Developer
   Tools > Authentication'dan alacağınız **client-side token** ile güncelleyin
   (bu, secret key değildir — tarayıcıda görünmesi güvenlidir).
6. `billing.js` dosyasının en üstündeki `API_BASE` sabitini bu backend'in
   gerçek adresiyle güncelleyin.

## Ürün Kataloğunu Güncelleme

Yeni bir otomasyon paketi eklediğinizde veya fiyat değiştirdiğinizde:

1. `catalog.js` içine (veya mevcut kaydı) güncelleyin — tutarlar **kuruş** cinsindendir.
2. `index.html` içindeki ilgili ürünün butonuna aynı `data-product-id` değerini verin.

İki taraf da aynı ID'yi kullanmazsa "Bilinmeyen ürün" hatası alırsınız — bu kasıtlıdır,
sunucu tanımadığı bir ürün için asla ödeme oturumu açmaz.

Paddle Dashboard'da ürün/fiyat tanımlamanıza gerek YOKTUR — her satır için
sunucu, isteğe özel ("non-catalog") bir fiyat nesnesi oluşturur; bu sayede
özel paket sihirbazındaki dinamik %20 indirim de sorunsuz uygulanır.

## Önerilen Sonraki Adım

Şu an ödeme kayıtları yalnızca konsola loglanıyor. Üretim için `transaction.completed`
webhook'unda gelen veriyi kalıcı bir veritabanına (kit içindeki `_skills/supabase` ile
Supabase önerilir) yazmanız ve işletmeye e-posta/WhatsApp bildirimi eklemeniz tavsiye edilir.
