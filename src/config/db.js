import "dotenv/config";
import { MongoClient } from "mongodb";

// Cache the client globally so serverless invocations (Vercel) reuse the connection.
const g = globalThis;
export const client = g._agroMongo ?? (g._agroMongo = new MongoClient(process.env.MONGODB_URI));
export const db = client.db(process.env.DB_NAME || "agrobazar");

export const col = {
  users: db.collection("users"),
  products: db.collection("products"),
  orders: db.collection("orders"),
  payments: db.collection("payments"),
};

let ready;
export function init() {
  return (ready ??= (async () => {
    await client.connect();
    await Promise.all([
      col.products.createIndex({ slug: 1 }, { unique: true }),
      col.products.createIndex({ saleType: 1, isActive: 1, createdAt: -1 }),
      col.orders.createIndex({ orderNumber: 1 }, { unique: true }),
      col.orders.createIndex({ customerEmail: 1, createdAt: -1 }),
      col.payments.createIndex({ gatewaySessionId: 1 }, { unique: true }),
    ]);
  })().catch((e) => {
    ready = undefined;
    throw e;
  }));
}
