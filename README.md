# 🚀 OtomasyonAI (otomasyonmarketi.net)

Yapay zeka destekli otomasyon çözümlerinin (WhatsApp, Instagram, Telegram, E-Posta, Lead Scraping ve Market Stok Takip) sergilendiği ve aylık/tek seferlik paketler halinde satışa sunulduğu profesyonel platform.

## 🔗 Canlı Adres
- **Domain:** [https://otomasyonmarketi.net](https://otomasyonmarketi.net)

## 🛠️ Teknolojiler
- **Ön Yüz (Frontend):** HTML5, Vanilla CSS3 (Custom Design System, Dark Mode, Glassmorphism), JavaScript (ES6+)
- **SEO & Performans:** Schema.org JSON-LD, Open Graph Meta Tag'leri, Sitemap.xml, Robots.txt, Web App Manifest
- **Barındırma & Deploy:** GitHub + Railway / CNAME

## 🌟 Özellikler
- 💬 **Canlı Hero Chat Simülatörü:** Ziyaretçilerin yapay zeka otomasyonunu canlı deneyimlediği sohbet simülasyonu.
- 💰 **İnteraktif Tasarruf & ROI Hesaplayıcı:** İşletmenin aylık zaman ve maliyet kazancını anlık hesaplayan dinamik araç.
- 📦 **Özel Paket Oluşturucu Sihirbazı:** Müşterilerin modül seçerek %20 indirimli paket oluşturmasını sağlayan modal.
- 🔍 **Canlı Katalog Arama & Filtreleme:** Kategoriye ve kelimeye göre anlık arama yapan ürün kataloğu.
- 📩 **Web İletişim Formu & WhatsApp Entegrasyonu:** Müşteri mesajlarını WhatsApp hattına otomatik taşıyan sistem.
- 💳 **Gerçek Paddle Ödeme Altyapısı:** Satın alma/deneme butonları `server/` klasöründeki backend
  üzerinden gerçek bir Paddle Transaction oluşturup Paddle.js overlay checkout'unu açar; kart
  bilgisi bu sitede hiç tutulmaz, KDV/vergiyi Merchant of Record olarak Paddle hesaplar.
  Detaylar için `server/README.md`.
- ⚖️ **Yasal Uyum:** KVKK, Gizlilik Politikası ve 1 Ay Ücretsiz Cayma Hakkı Şartları (`gizlilik-ve-kvkk.html`).
- 🚫 **Özel 404 Sayfası:** Şık hata yönetimi (`404.html`).

## 💳 Ödeme Altyapısı

`billing.js` artık kart bilgisi toplamaz veya sahte bir ödeme akışı çalıştırmaz.
"Satın Al / 1 Ay Ücretsiz Başla" butonları, `server/` klasöründeki Node/Express backend'ini
çağırıp bir Paddle Transaction oluşturur ve kullanıcıya Paddle.js'in kendi güvenli overlay
checkout'unu (site üzerinde açılan ödeme penceresi) açar. Paddle bir Merchant of Record
olduğu için KDV/vergi beyanını da kendisi üstlenir.
Fiyatlar yalnızca backend'deki `server/catalog.js` içinde tanımlıdır — istemci tarafından
gönderilen hiçbir fiyat değeri güvenilmez. Backend'i kurmadan bu butonlar çalışmaz; kurulum
ve Railway'e deploy adımları için `server/README.md`'ye bakın.
