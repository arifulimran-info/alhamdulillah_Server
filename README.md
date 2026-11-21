# AgroBazar - Server

Express + MongoDB API for AgroBazar, an agricultural e-commerce platform with in-stock sales and seasonal pre-orders.

- **Live API:** https://YOUR-SERVER.vercel.app
- **Client repo:** https://github.com/YOUR-USER/agrobazar-client
- **Live site:** https://YOUR-CLIENT.vercel.app

## Admin credentials
| Role | Email | Password |
|---|---|---|
| Admin | admin@agrobazar.com | Admin@12345 |
| Customer | customer@agrobazar.com | Customer@12345 |

## Features
- BetterAuth (MongoDB adapter) email/password auth, default role `customer`
- JWT issued from the session; `verifyToken`, `verifyCustomer`, `verifyAdmin` middleware
- Products CRUD, server-side search / category / sale type / price filter / sort / pagination
- Checkout recalculates price, delivery, advance and due on the server; in-stock and pre-order items are split into separate orders
- Atomic stock decrement and pre-order quota booking (quota is booked only after the advance is paid)
- Payments for Bangladesh: SSLCommerz (bKash, Nagad, Rocket, Upay, cards, internet banking) with server-side Order Validation and IPN; manual Send Money with TrxID (any wallet in `MANUAL_WALLETS`) approved by an admin; optional Stripe for international cards
- All payment records are idempotent (unique transaction key), amounts are re-checked on the server
- Admin stats, monthly sales, pre-order overview, user roles, transactions
- Public order tracking (order number + phone)

## Collections (4)
`users`, `products`, `orders`, `payments`. BetterAuth also keeps its own internal `session`, `account` and `verification` collections.

## Payment setup
1. **SSLCommerz**: create a sandbox store, put `SSLCOMMERZ_STORE_ID` / `SSLCOMMERZ_STORE_PASSWORD` in `.env` (`SSLCOMMERZ_IS_LIVE=true` only for the live store). Set `SERVER_URL` to this server's public URL and add `SERVER_URL/api/payments/sslcommerz/ipn` as the IPN URL in the SSLCommerz panel.
2. **Manual wallets**: set `MANUAL_WALLETS=bKash:017...,Nagad:017...,Rocket:017...,Upay:017...` (add any other wallet name). Customers send money, submit the TrxID, and you approve it in Dashboard > Transactions.
3. **Stripe** (optional): `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`.
Options without credentials are hidden from the pay page automatically.

## Environment variables (`.env`)
See `.env.example`. Needed: `MONGODB_URI`, `CLIENT_URL`, `BETTER_AUTH_URL` (same as the client URL), `BETTER_AUTH_SECRET`, `JWT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.

## Run
```bash
npm install
cp .env.example .env   # fill in values
npm run seed           # 20 products, admin and demo customer
npm run dev
```

## Deploy (Vercel)
Import the repo, add the env vars, deploy. `vercel.json` is included. Set the Stripe webhook to `https://YOUR-SERVER.vercel.app/api/payments/webhook` (event `checkout.session.completed`).

## npm packages
better-auth, cors, dotenv, express, jsonwebtoken, mongodb, stripe
