import { Router } from "express";
import Stripe from "stripe";
import { col } from "../config/db.js";
import { verifyToken } from "../middleware/auth.js";
import { PHONE_RE, normalizePhone, oid } from "../lib/utils.js";
import { amountDueNow, recordPaid } from "../lib/settle.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_missing");
const clientUrl = () => process.env.CLIENT_URL || "http://localhost:3000";
const serverUrl = () =>
  process.env.SERVER_URL || `http://localhost:${process.env.PORT || 5000}`;

// ---- Which payment options are switched on (driven by environment variables)
const sslEnabled = () =>
  !!(process.env.SSLCOMMERZ_STORE_ID && process.env.SSLCOMMERZ_STORE_PASSWORD);
const stripeEnabled = () => !!process.env.STRIPE_SECRET_KEY;
// MANUAL_WALLETS="bKash:01700000000,Nagad:01700000000,Rocket:017000000009,Upay:01700000000"
const manualWallets = () =>
  (process.env.MANUAL_WALLETS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const i = x.indexOf(":");
      return { name: x.slice(0, i).trim(), number: x.slice(i + 1).trim() };
    })
    .filter((w) => w.name && w.number);

const paymentTypeOf = (order) =>
  order.orderType === "preorder" ? "advance" : "full";

// ================= Stripe =================
async function fulfillStripe(session) {
  if (session.payment_status !== "paid") return { ok: false, reason: "unpaid" };
  const order = await col.orders.findOne({
    _id: oid(session.metadata?.orderId),
  });
  if (!order) return { ok: false, reason: "order_not_found" };
  return recordPaid({
    order,
    amount: session.amount_total / 100,
    currency: session.currency,
    paymentType: session.metadata.paymentType,
    transactionId:
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.id,
    gatewaySessionId: session.id,
    gateway: "stripe",
    method: "Card (Stripe)",
  });
}

export const webhookHandler = async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (e) {
    return res.status(400).send(`Webhook error: ${e.message}`);
  }
  if (event.type === "checkout.session.completed")
    await fulfillStripe(event.data.object);
  res.json({ received: true });
};

// ================= SSLCommerz (bKash, Nagad, Rocket, Upay, cards, internet banking) =================
const sslBase = () =>
  process.env.SSLCOMMERZ_IS_LIVE === "true"
    ? "https://securepay.sslcommerz.com"
    : "https://sandbox.sslcommerz.com";

async function createSslSession(order) {
  const amount = amountDueNow(order);
  const a = order.shippingInfo.address;
  const form = new URLSearchParams({
    store_id: process.env.SSLCOMMERZ_STORE_ID,
    store_passwd: process.env.SSLCOMMERZ_STORE_PASSWORD,
    total_amount: amount.toFixed(2),
    currency: "BDT",
    tran_id: `${order.orderNumber}-${Date.now().toString(36)}`,
    success_url: `${serverUrl()}/api/payments/sslcommerz/success`,
    fail_url: `${serverUrl()}/api/payments/sslcommerz/fail`,
    cancel_url: `${serverUrl()}/api/payments/sslcommerz/cancel`,
    ipn_url: `${serverUrl()}/api/payments/sslcommerz/ipn`,
    shipping_method: "NO",
    product_name: `AgroBazar ${order.orderNumber}`,
    product_category: "Agro products",
    product_profile: "general",
    num_of_item: String(order.items.length),
    cus_name: order.shippingInfo.name,
    cus_email: order.customerEmail,
    cus_add1: a.details,
    cus_city: a.district,
    cus_state: a.division,
    cus_postcode: "1000",
    cus_country: "Bangladesh",
    cus_phone: order.shippingInfo.phone,
    value_a: String(order._id),
    value_b: paymentTypeOf(order),
  });
  const res = await fetch(`${sslBase()}/gwprocess/v4/api.php`, {
    method: "POST",
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (data.status !== "SUCCESS" || !data.GatewayPageURL) {
    console.error("SSLCommerz init failed:", data.failedreason || data);
    throw Object.assign(
      new Error("Could not start the payment. Please try another method."),
      { status: 502 },
    );
  }
  return data.GatewayPageURL;
}

// Never trust the browser callback: always confirm with SSLCommerz's Order Validation API.
async function confirmSsl(valId) {
  const qs = new URLSearchParams({
    val_id: valId,
    store_id: process.env.SSLCOMMERZ_STORE_ID,
    store_passwd: process.env.SSLCOMMERZ_STORE_PASSWORD,
    format: "json",
  });
  const res = await fetch(
    `${sslBase()}/validator/api/validationserverAPI.php?${qs}`,
  );
  const v = await res.json().catch(() => ({}));
  if (!["VALID", "VALIDATED"].includes(v.status))
    return { ok: false, reason: "invalid" };
  const order = await col.orders.findOne({ _id: oid(v.value_a) });
  if (!order) return { ok: false, reason: "order_not_found" };
  if (
    Math.abs(Number(v.amount) - amountDueNow(order)) > 0.01 ||
    (v.currency_type && v.currency_type !== "BDT")
  ) {
    return {
      ok: false,
      reason: "amount_mismatch",
      orderNumber: order.orderNumber,
    };
  }
  return recordPaid({
    order,
    amount: Number(v.amount),
    currency: "bdt",
    paymentType: paymentTypeOf(order),
    transactionId: v.bank_tran_id || v.tran_id,
    gatewaySessionId: v.tran_id,
    gateway: "sslcommerz",
    method:
      [v.card_issuer, v.card_type].filter(Boolean).join(" - ") || "SSLCommerz",
  });
}

const orderNoFromTran = (tran = "") =>
  String(tran).split("-").slice(0, 2).join("-");
const back = (res, path) => res.redirect(303, `${clientUrl()}${path}`);

export const sslRouter = Router();
sslRouter.post("/success", async (req, res) => {
  try {
    const r = req.body?.val_id
      ? await confirmSsl(req.body.val_id)
      : { ok: false, reason: "invalid" };
    const no = r.orderNumber || orderNoFromTran(req.body?.tran_id);
    back(
      res,
      `/payment/success?order=${encodeURIComponent(no)}&ok=${r.ok ? 1 : 0}${r.reason ? `&reason=${r.reason}` : ""}`,
    );
  } catch (e) {
    console.error(e);
    back(res, `/payment/success?ok=0&reason=error`);
  }
});
sslRouter.post("/fail", (req, res) =>
  back(
    res,
    `/payment/cancel?order=${encodeURIComponent(orderNoFromTran(req.body?.tran_id))}`,
  ),
);
sslRouter.post("/cancel", (req, res) =>
  back(
    res,
    `/payment/cancel?order=${encodeURIComponent(orderNoFromTran(req.body?.tran_id))}`,
  ),
);
sslRouter.post("/ipn", async (req, res) => {
  try {
    if (req.body?.val_id) await confirmSsl(req.body.val_id);
  } catch (e) {
    console.error(e);
  }
  res.status(200).send("OK");
});

// ================= Authenticated routes =================
const router = Router();
router.use("/sslcommerz", sslRouter); // callbacks come from SSLCommerz, so no JWT here

router.get("/methods", (_req, res) => {
  res.json({
    sslcommerz: sslEnabled(),
    stripe: stripeEnabled(),
    manual: manualWallets(),
  });
});

async function payableOrder(req) {
  const order = await col.orders.findOne({
    _id: oid(req.body?.orderId),
    customerEmail: req.user.email,
  });
  if (
    !order ||
    order.status !== "pending" ||
    order.paymentMethod !== "online" ||
    order.advancePaid > 0
  )
    return null;
  return order;
}

router.post("/create-session", verifyToken, async (req, res) => {
  const order = await payableOrder(req);
  if (!order)
    return res
      .status(400)
      .json({ message: "This order cannot be paid online" });
  const gateway = req.body?.gateway || "sslcommerz";

  if (gateway === "sslcommerz") {
    if (!sslEnabled())
      return res
        .status(400)
        .json({ message: "This payment option is not available" });
    return res.json({ url: await createSslSession(order) });
  }
  if (gateway === "stripe") {
    if (!stripeEnabled())
      return res
        .status(400)
        .json({ message: "This payment option is not available" });
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: order.customerEmail,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: process.env.STRIPE_CURRENCY || "usd",
            unit_amount: Math.round(amountDueNow(order) * 100),
            product_data: {
              name: `AgroBazar ${order.orderNumber} - ${order.orderType === "preorder" ? "Advance payment" : "Order payment"}`,
            },
          },
        },
      ],
      metadata: {
        orderId: String(order._id),
        paymentType: paymentTypeOf(order),
      },
      success_url: `${clientUrl()}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${clientUrl()}/payment/cancel?order=${order.orderNumber}`,
    });
    return res.json({ url: session.url });
  }
  res.status(400).json({ message: "Unknown payment option" });
});

// Customer sent money to a merchant wallet and reports the TrxID; an admin verifies it.
router.post("/manual", verifyToken, async (req, res) => {
  const order = await payableOrder(req);
  if (!order)
    return res
      .status(400)
      .json({ message: "This order cannot be paid online" });
  const wallet = manualWallets().find((w) => w.name === req.body?.wallet);
  if (!wallet)
    return res.status(400).json({ message: "Please choose a payment method" });
  const sender = normalizePhone(req.body?.senderNumber);
  const trxId = String(req.body?.trxId || "")
    .trim()
    .toUpperCase();
  if (!PHONE_RE.test(sender))
    return res
      .status(400)
      .json({ message: "Enter the number you sent the money from" });
  if (!/^[A-Z0-9]{6,20}$/.test(trxId))
    return res
      .status(400)
      .json({ message: "Enter a valid Transaction ID (TrxID)" });
  if (
    await col.payments.findOne({ orderId: order._id, paymentStatus: "pending" })
  ) {
    return res
      .status(409)
      .json({
        message:
          "You already submitted a payment for this order. We are verifying it.",
      });
  }
  const user = await col.users.findOne(
    { email: order.customerEmail },
    { projection: { name: 1 } },
  );
  try {
    await col.payments.insertOne({
      orderId: order._id,
      orderNumber: order.orderNumber,
      userEmail: order.customerEmail,
      userName: user?.name || order.shippingInfo.name,
      amount: amountDueNow(order),
      currency: "bdt",
      paymentType: paymentTypeOf(order),
      transactionId: trxId,
      gatewaySessionId: `manual:${wallet.name}:${trxId}`,
      gateway: "manual",
      method: wallet.name,
      senderNumber: sender,
      paymentStatus: "pending",
      submittedAt: new Date(),
    });
  } catch (e) {
    if (e.code === 11000)
      return res
        .status(409)
        .json({ message: "This Transaction ID was already submitted" });
    throw e;
  }
  res.status(201).json({ ok: true });
});

router.post("/verify", verifyToken, async (req, res) => {
  const session = await stripe.checkout.sessions.retrieve(
    String(req.body?.sessionId || ""),
  );
  const order = await col.orders.findOne({
    _id: oid(session.metadata?.orderId),
  });
  if (!order || order.customerEmail !== req.user.email)
    return res.status(404).json({ message: "Payment not found" });
  res.json(await fulfillStripe(session));
});

router.get("/my", verifyToken, async (req, res) => {
  res.json(
    await col.payments
      .find({ userEmail: req.user.email })
      .sort({ paidAt: -1, submittedAt: -1 })
      .toArray(),
  );
});

export default router;
