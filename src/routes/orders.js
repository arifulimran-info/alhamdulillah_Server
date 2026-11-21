import { Router } from "express";
import { col } from "../config/db.js";
import { verifyToken, verifyCustomer } from "../middleware/auth.js";
import {
  PHONE_RE,
  deliveryCharge,
  makeOrderNumber,
  normalizePhone,
  oid,
} from "../lib/utils.js";
import { releaseInventory } from "../lib/inventory.js";

const router = Router();

// Public: track by order number + phone
router.get("/track", async (req, res) => {
  const { orderNumber = "", phone = "" } = req.query;
  const order = await col.orders.findOne({
    orderNumber: String(orderNumber).trim().toUpperCase(),
    "shippingInfo.phone": normalizePhone(phone),
  });
  if (!order)
    return res
      .status(404)
      .json({ message: "No order found with that number and phone" });
  const {
    orderNumber: n,
    status,
    orderType,
    totalAmount,
    advancePaid,
    dueAmount,
    expectedDeliveryDate,
    createdAt,
    items,
  } = order;
  res.json({
    orderNumber: n,
    status,
    orderType,
    totalAmount,
    advancePaid,
    dueAmount,
    expectedDeliveryDate,
    createdAt,
    items: items.map((i) => ({ name: i.name, quantity: i.quantity })),
  });
});

// Checkout: prices, delivery and advance are ALWAYS recalculated here (never trusted from the client)
router.post("/checkout", verifyToken, verifyCustomer, async (req, res) => {
  const { items, shippingInfo = {}, paymentMethod } = req.body || {};
  if (!Array.isArray(items) || !items.length)
    return res.status(400).json({ message: "Your cart is empty" });

  const phone = normalizePhone(shippingInfo.phone);
  const addr = shippingInfo.address || {};
  if (
    !shippingInfo.name?.trim() ||
    !PHONE_RE.test(phone) ||
    !addr.division ||
    !addr.district?.trim() ||
    !addr.details?.trim()
  ) {
    return res
      .status(400)
      .json({ message: "Please provide valid delivery details" });
  }

  const wanted = new Map();
  for (const it of items) {
    const id = oid(it.productId);
    const qty = Number(it.quantity);
    if (!id || !Number.isInteger(qty) || qty < 1 || qty > 100)
      return res.status(400).json({ message: "Invalid cart item" });
    wanted.set(String(id), (wanted.get(String(id)) || 0) + qty);
  }

  const products = await col.products
    .find({
      _id: { $in: [...wanted.keys()].map((i) => oid(i)) },
      isActive: true,
    })
    .toArray();
  if (products.length !== wanted.size)
    return res
      .status(400)
      .json({ message: "Some products are no longer available" });
  const lines = products.map((p) => ({ p, qty: wanted.get(String(p._id)) }));

  for (const { p, qty } of lines) {
    if (p.saleType === "instock" && p.stock < qty)
      return res
        .status(409)
        .json({ message: `${p.name}: only ${p.stock} left in stock` });
    if (p.saleType === "preorder" && p.preorderBooked + qty > p.preorderQuota)
      return res
        .status(409)
        .json({ message: `${p.name}: pre-order quota is full` });
  }

  // Atomically reserve in-stock quantities (roll back if any line fails)
  const instockLines = lines.filter((l) => l.p.saleType === "instock");
  const reserved = [];
  for (const { p, qty } of instockLines) {
    const ok = await col.products.findOneAndUpdate(
      { _id: p._id, stock: { $gte: qty } },
      { $inc: { stock: -qty } },
    );
    if (!ok) {
      for (const r of reserved)
        await col.products.updateOne(
          { _id: r.p._id },
          { $inc: { stock: r.qty } },
        );
      return res
        .status(409)
        .json({ message: `${p.name} just went out of stock` });
    }
    reserved.push({ p, qty });
  }

  const created = [];
  for (const type of ["instock", "preorder"]) {
    const group = lines.filter((l) => l.p.saleType === type);
    if (!group.length) continue;
    const subtotal = group.reduce((s, { p, qty }) => s + p.price * qty, 0);
    const delivery = deliveryCharge(addr.district);
    const totalAmount = subtotal + delivery;
    const advanceAmount =
      type === "preorder"
        ? Math.round(
            group.reduce(
              (s, { p, qty }) =>
                s + (p.price * qty * (p.advancePercent || 30)) / 100,
              0,
            ),
          )
        : 0;
    const method =
      type === "preorder"
        ? "online"
        : paymentMethod === "online"
          ? "online"
          : "cod";
    const order = {
      orderNumber: makeOrderNumber(),
      customerEmail: req.user.email,
      items: group.map(({ p, qty }) => ({
        productId: p._id,
        name: p.name,
        price: p.price,
        quantity: qty,
        unit: p.unit,
        saleType: p.saleType,
        advancePercent: p.advancePercent || 0,
      })),
      orderType: type,
      subtotal,
      deliveryCharge: delivery,
      totalAmount,
      advanceAmount,
      advancePaid: 0,
      dueAmount: totalAmount,
      paymentMethod: method,
      shippingInfo: {
        name: shippingInfo.name.trim(),
        phone,
        address: {
          division: addr.division,
          district: addr.district.trim(),
          details: addr.details.trim(),
        },
      },
      expectedDeliveryDate:
        type === "preorder"
          ? new Date(
              Math.max(
                ...group.map(({ p }) => +new Date(p.expectedDeliveryDate)),
              ),
            )
          : null,
      status: "pending",
      createdAt: new Date(),
    };
    const { insertedId } = await col.orders.insertOne(order);
    created.push({
      _id: insertedId,
      orderNumber: order.orderNumber,
      orderType: type,
      paymentMethod: method,
      payNow: method === "online",
    });
  }
  res.status(201).json({ orders: created });
});

router.get("/my", verifyToken, async (req, res) => {
  const q = { customerEmail: req.user.email };
  if (req.query.type) q.orderType = req.query.type;
  res.json(await col.orders.find(q).sort({ createdAt: -1 }).toArray());
});

router.get("/:id", verifyToken, async (req, res) => {
  const order = await col.orders.findOne({ _id: oid(req.params.id) });
  if (
    !order ||
    (order.customerEmail !== req.user.email && req.user.role !== "admin")
  )
    return res.status(404).json({ message: "Order not found" });
  res.json(order);
});

router.patch("/:id/cancel", verifyToken, verifyCustomer, async (req, res) => {
  const order = await col.orders.findOneAndUpdate(
    {
      _id: oid(req.params.id),
      customerEmail: req.user.email,
      status: "pending",
    },
    { $set: { status: "cancelled", cancelledAt: new Date() } },
    { returnDocument: "before" },
  );
  if (!order)
    return res
      .status(400)
      .json({ message: "Only pending orders can be cancelled" });
  await releaseInventory(order);
  res.json({ ok: true });
});

export default router;
