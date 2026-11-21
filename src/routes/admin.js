import { Router } from "express";
import { col } from "../config/db.js";
import { verifyToken, verifyAdmin } from "../middleware/auth.js";
import { CATEGORIES, STATUSES, UNITS, oid, slugify } from "../lib/utils.js";
import { releaseInventory } from "../lib/inventory.js";
import { settleOrder } from "../lib/settle.js";

const router = Router();
router.use(verifyToken, verifyAdmin);

function buildProduct(b) {
  const price = Number(b.price);
  if (!b.name?.trim()) return { error: "Product name is required" };
  if (!CATEGORIES.includes(b.category)) return { error: "Invalid category" };
  if (!UNITS.includes(b.unit)) return { error: "Invalid unit" };
  if (!["instock", "preorder"].includes(b.saleType))
    return { error: "Invalid sale type" };
  if (!(price > 0)) return { error: "Price must be greater than 0" };
  const data = {
    name: b.name.trim(),
    nameBn: String(b.nameBn || "").trim(),
    descriptionBn: String(b.descriptionBn || "").trim(),
    category: b.category,
    description: String(b.description || "").trim(),
    image: String(b.image || ""),
    price,
    unit: b.unit,
    saleType: b.saleType,
    isActive: b.isActive !== false,
  };
  if (b.saleType === "instock") {
    const stock = Number(b.stock);
    if (!(stock >= 0)) return { error: "Stock is required" };
    Object.assign(data, {
      stock,
      preorderQuota: null,
      expectedDeliveryDate: null,
      advancePercent: null,
    });
  } else {
    const quota = Number(b.preorderQuota),
      pct = Number(b.advancePercent),
      date = new Date(b.expectedDeliveryDate);
    if (!(quota > 0) || !(pct > 0 && pct <= 100) || isNaN(date))
      return {
        error: "Quota, advance % and delivery date are required for pre-orders",
      };
    Object.assign(data, {
      stock: null,
      preorderQuota: quota,
      expectedDeliveryDate: date,
      advancePercent: pct,
    });
  }
  return { data };
}

// ---- Products (full CRUD)
router.get("/products", async (_req, res) =>
  res.json(await col.products.find().sort({ createdAt: -1 }).toArray()),
);

router.post("/products", async (req, res) => {
  const { data, error } = buildProduct(req.body || {});
  if (error) return res.status(400).json({ message: error });
  const slug = `${slugify(data.name)}-${Math.random().toString(36).slice(2, 6)}`;
  const doc = { ...data, slug, preorderBooked: 0, createdAt: new Date() };
  const { insertedId } = await col.products.insertOne(doc);
  res.status(201).json({ ...doc, _id: insertedId });
});

router.put("/products/:id", async (req, res) => {
  const { data, error } = buildProduct(req.body || {});
  if (error) return res.status(400).json({ message: error });
  const r = await col.products.findOneAndUpdate(
    { _id: oid(req.params.id) },
    { $set: { ...data, updatedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!r) return res.status(404).json({ message: "Product not found" });
  res.json(r);
});

router.patch("/products/:id/toggle", async (req, res) => {
  const r = await col.products.findOneAndUpdate(
    { _id: oid(req.params.id) },
    [{ $set: { isActive: { $not: ["$isActive"] } } }],
    { returnDocument: "after" },
  );
  if (!r) return res.status(404).json({ message: "Product not found" });
  res.json(r);
});

router.delete("/products/:id", async (req, res) => {
  const r = await col.products.deleteOne({ _id: oid(req.params.id) });
  res.json({ deleted: r.deletedCount });
});

// ---- Orders
router.get("/orders", async (req, res) => {
  const q = {};
  if (["instock", "preorder"].includes(req.query.orderType))
    q.orderType = req.query.orderType;
  if (STATUSES.includes(req.query.status)) q.status = req.query.status;
  res.json(
    await col.orders.find(q).sort({ createdAt: -1 }).limit(300).toArray(),
  );
});

router.patch("/orders/:id/status", async (req, res) => {
  const { status } = req.body || {};
  if (!STATUSES.includes(status))
    return res.status(400).json({ message: "Invalid status" });
  const order = await col.orders.findOne({ _id: oid(req.params.id) });
  if (!order) return res.status(404).json({ message: "Order not found" });
  if (["cancelled", "delivered"].includes(order.status))
    return res
      .status(400)
      .json({ message: `A ${order.status} order cannot be changed` });
  if (
    order.paymentMethod === "online" &&
    order.advancePaid === 0 &&
    !["pending", "cancelled"].includes(status)
  ) {
    return res
      .status(400)
      .json({ message: "Online payment has not been received yet" });
  }
  if (status === "cancelled") await releaseInventory(order);
  await col.orders.updateOne(
    { _id: order._id },
    { $set: { status, updatedAt: new Date() } },
  );
  res.json({ ok: true });
});

router.patch("/orders/:id/mark-paid", async (req, res) => {
  const order = await col.orders.findOne({ _id: oid(req.params.id) });
  if (!order || order.status === "cancelled")
    return res.status(400).json({ message: "Order not found or cancelled" });
  if (order.paymentMethod === "online" && order.advancePaid === 0)
    return res.status(400).json({ message: "Online payment not received yet" });
  if (order.dueAmount <= 0)
    return res.status(400).json({ message: "Nothing due on this order" });
  await col.orders.updateOne(
    { _id: order._id },
    {
      $set: {
        advancePaid: order.totalAmount,
        dueAmount: 0,
        dueCollectedAt: new Date(),
      },
    },
  );
  res.json({ ok: true });
});

// ---- Overview
router.get("/stats", async (_req, res) => {
  const live = { status: { $ne: "cancelled" } };
  const since = new Date();
  since.setMonth(since.getMonth() - 5, 1);
  since.setHours(0, 0, 0, 0);
  const [sales, totalOrders, pendingOrders, totalCustomers, lowStock, monthly] =
    await Promise.all([
      col.orders
        .aggregate([
          { $match: live },
          { $group: { _id: null, total: { $sum: "$advancePaid" } } },
        ])
        .toArray(),
      col.orders.countDocuments(),
      col.orders.countDocuments({ status: "pending" }),
      col.users.countDocuments({ role: "customer" }),
      col.products.countDocuments({
        saleType: "instock",
        isActive: true,
        stock: { $lte: 10 },
      }),
      col.orders
        .aggregate([
          { $match: { ...live, createdAt: { $gte: since } } },
          {
            $group: {
              _id: { y: { $year: "$createdAt" }, m: { $month: "$createdAt" } },
              sales: { $sum: "$advancePaid" },
              orders: { $sum: 1 },
            },
          },
          { $sort: { "_id.y": 1, "_id.m": 1 } },
        ])
        .toArray(),
    ]);
  res.json({
    totalSales: sales[0]?.total || 0,
    totalOrders,
    pendingOrders,
    totalCustomers,
    lowStock,
    monthly: monthly.map((x) => ({
      year: x._id.y,
      month: x._id.m,
      sales: x.sales,
      orders: x.orders,
    })),
  });
});

router.get("/preorders", async (_req, res) => {
  const products = await col.products
    .find({ saleType: "preorder" })
    .sort({ expectedDeliveryDate: 1 })
    .toArray();
  const advances = await col.orders
    .aggregate([
      {
        $match: {
          orderType: "preorder",
          status: { $nin: ["cancelled", "pending"] },
        },
      },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.productId",
          advance: {
            $sum: {
              $divide: [
                {
                  $multiply: [
                    "$items.price",
                    "$items.quantity",
                    "$items.advancePercent",
                  ],
                },
                100,
              ],
            },
          },
        },
      },
    ])
    .toArray();
  const map = new Map(advances.map((a) => [String(a._id), a.advance]));
  res.json(
    products.map((p) => ({
      ...p,
      totalAdvance: Math.round(map.get(String(p._id)) || 0),
    })),
  );
});

// ---- Users & transactions
router.get("/users", async (_req, res) =>
  res.json(await col.users.find().sort({ createdAt: -1 }).toArray()),
);

router.patch("/users/:id/role", async (req, res) => {
  const { role } = req.body || {};
  if (!["customer", "admin"].includes(role))
    return res.status(400).json({ message: "Invalid role" });
  const target = await col.users.findOne({ _id: oid(req.params.id) });
  if (!target) return res.status(404).json({ message: "User not found" });
  if (target.email === req.user.email)
    return res.status(400).json({ message: "You cannot change your own role" });
  await col.users.updateOne({ _id: target._id }, { $set: { role } });
  res.json({ ok: true });
});

router.patch("/payments/:id/approve", async (req, res) => {
  const pay = await col.payments.findOneAndUpdate(
    { _id: oid(req.params.id), paymentStatus: "pending" },
    {
      $set: {
        paymentStatus: "paid",
        paidAt: new Date(),
        reviewedBy: req.user.email,
      },
    },
    { returnDocument: "after" },
  );
  if (!pay)
    return res
      .status(400)
      .json({ message: "Payment not found or already reviewed" });
  const order = await col.orders.findOne({ _id: pay.orderId });
  res.json(await settleOrder(order, pay.amount));
});

router.patch("/payments/:id/reject", async (req, res) => {
  const r = await col.payments.updateOne(
    { _id: oid(req.params.id), paymentStatus: "pending" },
    {
      $set: {
        paymentStatus: "rejected",
        reviewedBy: req.user.email,
        reviewedAt: new Date(),
      },
    },
  );
  if (!r.matchedCount)
    return res
      .status(400)
      .json({ message: "Payment not found or already reviewed" });
  res.json({ ok: true });
});

router.get("/transactions", async (_req, res) =>
  res.json(await col.payments.find().sort({ paidAt: -1 }).limit(300).toArray()),
);

export default router;
