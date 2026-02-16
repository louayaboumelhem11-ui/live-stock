import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const dbPath = path.join(process.cwd(), "data.sqlite");
export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      unit_price_usd REAL NOT NULL DEFAULT 1.0,
      image_key TEXT NOT NULL DEFAULT 'default',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stock_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      code TEXT NOT NULL,
      sold INTEGER NOT NULL DEFAULT 0,
      sold_at TEXT,
      order_id TEXT,
      FOREIGN KEY(product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT UNIQUE NOT NULL,
      product_id INTEGER NOT NULL,
      qty INTEGER NOT NULL,
      total_usd REAL NOT NULL,
      pay_method TEXT NOT NULL,
      txid TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING/APPROVED/REJECTED
      contact TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      approved_at TEXT,
      FOREIGN KEY(product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS order_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id TEXT NOT NULL,
      code TEXT NOT NULL
    );
  `);

  // seed minimal products if none
  const count = db.prepare("SELECT COUNT(*) as c FROM products").get().c;
  if (count === 0) {
    const ins = db.prepare("INSERT INTO products (slug,title,category,unit_price_usd,image_key) VALUES (?,?,?,?,?)");
    ins.run("psn", "PSN STOCK", "Gaming", 1.00, "psn");
    ins.run("epic", "EPIC STOCK", "Gaming", 1.00, "epic");
    ins.run("fullaccess", "FULL ACCESS", "FULL ACCESS", 1.00, "full");
  }
}

export function productStockCount(productId) {
  return db.prepare("SELECT COUNT(*) as c FROM stock_codes WHERE product_id=? AND sold=0").get(productId).c;
}

export function getConfig() {
  return {
    storeName: process.env.STORE_NAME || "LIVE STOCK",
    supportTg: process.env.SUPPORT_TG || "https://t.me/T_T_C_c_C"
  };
}
