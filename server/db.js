/**
 * Otomasyon Marketi — Yerel SQLite Depolama
 * Lead'leri (iletişim formu mesajlarını) ve Paddle webhook olaylarını
 * kalıcı olarak saklar. Ayrı bir DB servisi (Supabase vb.) gerektirmez —
 * Node'un yerleşik `node:sqlite` modülünü kullanır (native derleme/Visual
 * Studio Build Tools gerektirmez), dosya Railway'de kalıcı bir Volume'a
 * (bkz. server/README.md) bağlanarak deploy'lar arasında korunur.
 */
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'app.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    service TEXT,
    message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS payment_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    reference_id TEXT,
    customer_id TEXT,
    amount REAL,
    currency TEXT,
    status TEXT,
    raw_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Paddle aynı olayı (ağ hatası, timeout vb. durumlarda) birden fazla kez
// gönderebilir. event_id ile tekilleştirip ödeme geçmişinde çift kayıt ve
// panelde şişmiş gelir toplamı oluşmasını engelliyoruz. Eski veritabanlarında
// sütun yoksa sonradan eklenir.
const paymentEventColumns = db.prepare(`PRAGMA table_info(payment_events)`).all().map((c) => c.name);
if (!paymentEventColumns.includes('event_id')) {
  db.exec(`ALTER TABLE payment_events ADD COLUMN event_id TEXT`);
}
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_events_event_id ON payment_events(event_id)`);

const insertLeadStmt = db.prepare(
  `INSERT INTO leads (name, phone, service, message) VALUES (@name, @phone, @service, @message)`
);
const listLeadsStmt = db.prepare(
  `SELECT id, name, phone, service, message, created_at FROM leads ORDER BY id DESC LIMIT ?`
);
const countLeadsStmt = db.prepare(`SELECT COUNT(*) AS c FROM leads`);

const insertPaymentEventStmt = db.prepare(
  `INSERT OR IGNORE INTO payment_events (event_id, event_type, reference_id, customer_id, amount, currency, status, raw_json)
   VALUES (@eventId, @eventType, @referenceId, @customerId, @amount, @currency, @status, @raw)`
);
const listPaymentEventsStmt = db.prepare(
  `SELECT id, event_type, reference_id, customer_id, amount, currency, status, created_at
   FROM payment_events ORDER BY id DESC LIMIT ?`
);

module.exports = {
  insertLead(lead) {
    insertLeadStmt.run({
      name: lead.name,
      phone: lead.phone,
      service: lead.service || '',
      message: lead.message || ''
    });
  },
  listLeads(limit = 200) {
    return listLeadsStmt.all(limit);
  },
  countLeads() {
    return countLeadsStmt.get().c;
  },
  insertPaymentEvent(evt) {
    insertPaymentEventStmt.run({
      eventId: evt.eventId || null,
      eventType: evt.eventType,
      referenceId: evt.referenceId || null,
      customerId: evt.customerId || null,
      amount: typeof evt.amount === 'number' ? evt.amount : null,
      currency: evt.currency || null,
      status: evt.status || null,
      raw: evt.raw || null
    });
  },
  listPaymentEvents(limit = 200) {
    return listPaymentEventsStmt.all(limit);
  }
};
