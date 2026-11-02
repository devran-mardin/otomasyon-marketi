/**
 * Otomasyon Marketi — Admin Paneli Oturum Token'ı
 * JWT kütüphanesi eklemeden, Node'un yerleşik crypto'suyla imzalı,
 * süresi dolan basit bir oturum token'ı üretir/doğrular.
 * Token asla veritabanında tutulmaz — imza + son kullanma zamanı yeterlidir.
 */
const crypto = require('crypto');

function sign(payload, secret, ttlMs) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlMs })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token, secret) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;

  const expectedSig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

module.exports = { sign, verify };
