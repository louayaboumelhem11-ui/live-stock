import "dotenv/config";
import express from "express";
import helmet from "helmet";
import { nanoid } from "nanoid";
import path from "path";
import { db, initDb, productStockCount, getConfig } from "./db.js";

initDb();

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// static
app.use(express.static(path.join(process.cwd(), "public")));

// ---- crypto methods (your addresses) ----
const PAY_METHODS = [
  { key:"BTC", label:"Bitcoin (BTC)", address:"bc1qvug5jyxkg222y5l2tpf98y9azml9pf3pl0qk38", eta:"10–60 min" },
  { key:"LTC", label:"Litecoin (LTC)", address:"ltc1qp7sn95vtsh862sud5eykjf4z9fx3m0qwygnel5", eta:"~4 min" },
  { key:"USDT_BEP20", label:"USDT (BNB Chain - BEP20)", address:"0xc615DfC9AB9c7940C74C3Bab6112d06bA8dBBCf9", eta:"< 1 min" },
  { key:"BNB", label:"BNB (BNB Chain)", address:"0xc615DfC9AB9c7940C74C3Bab6112d06bA8dBBCf9", eta:"< 1 min" },
  { key:"USDT_ERC20", label:"USDT (Ethereum - ERC20)", address:"0xc615DfC9AB9c7940C74C3Bab6112d06bA8dBBCf9", eta:"1–5 min" }
];

// ---- API ----
app.get("/api/config", (req,res)=> res.json({ ok:true, ...getConfig() }));

app.get("/api/pay-methods", (req,res)=> res.json({ ok:true, methods: PAY_METHODS }));

app.get("/api/products", (req,res)=>{
  const rows = db.prepare("SELECT id,slug,title,category,unit_price_usd,image_key,active FROM products WHERE active=1 ORDER BY id DESC").all();
  const out = rows.map(p => ({
    ...p,
    stock: productStockCount(p.id)
  }));
  res.json({ ok:true, products: out });
});

app.get("/api/order/:orderId", (req,res)=>{
  const orderId = req.params.orderId;
  const order = db.prepare(`
    SELECT o.order_id, o.qty, o.total_usd, o.pay_method, o.txid, o.status, o.contact, o.created_at, o.approved_at,
           p.title as product_title, p.category as product_category, p.unit_price_usd
    FROM orders o JOIN products p ON p.id=o.product_id
    WHERE o.order_id=?
  `).get(orderId);

  if (!order) return res.status(404).json({ ok:false, error:"Order not found" });

  const codes = db.prepare("SELECT code FROM order_codes WHERE order_id=? ORDER BY id").all(orderId).map(x=>x.code);

  // remaining stock for product
  const pid = db.prepare("SELECT product_id FROM orders WHERE order_id=?").get(orderId).product_id;
  const remaining = productStockCount(pid);

  res.json({ ok:true, order, codes, remaining });
});

app.post("/api/order", (req,res)=>{
  const { product_slug, qty, pay_method, txid, contact } = req.body;

  if (!product_slug || !qty || !pay_method || !txid) {
    return res.status(400).json({ ok:false, error:"Missing fields" });
  }

  const q = Math.max(1, Math.min(999, parseInt(qty,10)));
  const prod = db.prepare("SELECT id,slug,title,unit_price_usd FROM products WHERE slug=? AND active=1").get(product_slug);
  if (!prod) return res.status(404).json({ ok:false, error:"Product not found" });

  const available = productStockCount(prod.id);
  if (available <= 0) return res.status(400).json({ ok:false, error:"Out of stock" });
  if (q > available) return res.status(400).json({ ok:false, error:`Not enough stock. Available: ${available}` });

  const method = PAY_METHODS.find(m=>m.key===pay_method);
  if (!method) return res.status(400).json({ ok:false, error:"Invalid pay method" });

  const orderId = `LS-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${nanoid(6).toUpperCase()}`;
  const total = +(prod.unit_price_usd * q).toFixed(2);

  db.prepare("INSERT INTO orders (order_id, product_id, qty, total_usd, pay_method, txid, contact) VALUES (?,?,?,?,?,?,?)")
    .run(orderId, prod.id, q, total, pay_method, txid, contact || null);

  res.json({ ok:true, order_id: orderId });
});

// ---- Admin auth (simple password) ----
function requireAdmin(req,res,next){
  const pass = req.headers["x-admin-password"] || req.query.p || "";
  if (!process.env.ADMIN_PASSWORD) return res.status(500).json({ ok:false, error:"ADMIN_PASSWORD not set" });
  if (pass !== process.env.ADMIN_PASSWORD) return res.status(401).json({ ok:false, error:"Unauthorized" });
  next();
}

app.get("/api/admin/orders", requireAdmin, (req,res)=>{
  const rows = db.prepare(`
    SELECT o.order_id, o.status, o.qty, o.total_usd, o.pay_method, o.txid, o.contact, o.created_at,
           p.title as product_title
    FROM orders o JOIN products p ON p.id=o.product_id
    ORDER BY o.id DESC LIMIT 200
  `).all();
  res.json({ ok:true, orders: rows });
});

app.post("/api/admin/stock/add", requireAdmin, (req,res)=>{
  const { product_slug, codes_text } = req.body;
  const prod = db.prepare("SELECT id FROM products WHERE slug=?").get(product_slug);
  if (!prod) return res.status(404).json({ ok:false, error:"Product not found" });

  const codes = (codes_text || "").split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if (codes.length === 0) return res.status(400).json({ ok:false, error:"No codes" });

  const ins = db.prepare("INSERT INTO stock_codes (product_id, code) VALUES (?,?)");
  const trx = db.transaction((items)=>{
    for (const c of items) ins.run(prod.id, c);
  });
  trx(codes);

  res.json({ ok:true, added: codes.length, stock: productStockCount(prod.id) });
});

app.post("/api/admin/order/approve", requireAdmin, (req,res)=>{
  const { order_id } = req.body;
  const order = db.prepare("SELECT order_id, product_id, qty, status FROM orders WHERE order_id=?").get(order_id);
  if (!order) return res.status(404).json({ ok:false, error:"Order not found" });
  if (order.status === "APPROVED") {
    const codes = db.prepare("SELECT code FROM order_codes WHERE order_id=? ORDER BY id").all(order_id).map(x=>x.code);
    return res.json({ ok:true, already:true, codes });
  }
  if (order.status === "REJECTED") return res.status(400).json({ ok:false, error:"Order rejected" });

  const available = db.prepare("SELECT id, code FROM stock_codes WHERE product_id=? AND sold=0").all(order.product_id);
  if (available.length < order.qty) return res.status(400).json({ ok:false, error:"Not enough stock to approve" });

  // random pick
  const picked = [];
  const pool = [...available];
  for (let i=0;i<order.qty;i++){
    const idx = Math.floor(Math.random()*pool.length);
    picked.push(pool[idx]);
    pool.splice(idx,1);
  }

  const markSold = db.prepare("UPDATE stock_codes SET sold=1, sold_at=datetime('now'), order_id=? WHERE id=?");
  const insOC = db.prepare("INSERT INTO order_codes (order_id, code) VALUES (?,?)");
  const updOrder = db.prepare("UPDATE orders SET status='APPROVED', approved_at=datetime('now') WHERE order_id=?");

  const trx = db.transaction(()=>{
    for (const item of picked){
      markSold.run(order_id, item.id);
      insOC.run(order_id, item.code);
    }
    updOrder.run(order_id);
  });
  trx();

  res.json({ ok:true, codes: picked.map(x=>x.code), remaining: productStockCount(order.product_id) });
});

app.post("/api/admin/order/reject", requireAdmin, (req,res)=>{
  const { order_id } = req.body;
  const order = db.prepare("SELECT order_id, status FROM orders WHERE order_id=?").get(order_id);
  if (!order) return res.status(404).json({ ok:false, error:"Order not found" });
  if (order.status === "APPROVED") return res.status(400).json({ ok:false, error:"Cannot reject approved order" });

  db.prepare("UPDATE orders SET status='REJECTED' WHERE order_id=?").run(order_id);
  res.json({ ok:true });
});

// fallback
app.use((req,res)=> res.status(404).send("Not Found"));

const port = process.env.PORT || 3000;
app.listen(port, ()=> console.log(`LIVE STOCK running on http://localhost:${port}`));
