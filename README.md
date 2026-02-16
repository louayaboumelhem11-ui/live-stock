# LIVE STOCK

## 1) Install
- Install Node.js (v18+)
- In this folder:
  npm install

## 2) Configure
- Copy .env.example to .env
- Set ADMIN_PASSWORD
- Optional: STORE_NAME, SUPPORT_TG

## 3) Run
  npm start
Open:
- Shop: http://localhost:3000
- Admin: http://localhost:3000/admin.html

## 4) Usage
- Admin: paste codes (1 code per line) and click Add Stock.
- Customer: chooses qty, pays crypto, pastes TxID -> Order ID.
- Admin: Approve -> codes are randomly assigned and shown inside the order page.

## Notes
- Database is stored in data.sqlite (same folder).
