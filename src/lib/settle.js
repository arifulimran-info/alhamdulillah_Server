import { col } from "../config/db.js";

// Applies a successful (or admin-approved) payment to an order.
// Pre-order quota is booked here, atomically, only AFTER the advance is paid.
export async function settleOrder(order, amount) {
  if (order.status !== "pending" || order.advancePaid > 0) {
    return {
      ok: false,
      reason: "order_not_pending",
      orderNumber: order.orderNumber,
    };
  }
  if (order.orderType === "preorder") {
    const booked = [];
    for (const item of order.items) {
      const r = await col.products.findOneAndUpdate(
        {
          _id: item.productId,
          $expr: {
            $lte: [
              { $add: ["$preorderBooked", item.quantity] },
              "$preorderQuota",
            ],
          },
        },
        { $inc: { preorderBooked: item.quantity } },
      );
      if (!r) {
        for (const b of booked)
          await col.products.updateOne(
            { _id: b.productId },
            { $inc: { preorderBooked: -b.quantity } },
          );
        await col.orders.updateOne(
          { _id: order._id },
          {
            $set: {
              status: "cancelled",
              note: "Quota filled before payment - refund required",
            },
          },
        );
        return {
          ok: false,
          reason: "quota_full",
          orderNumber: order.orderNumber,
        };
      }
      booked.push(item);
    }
  }
  await col.orders.updateOne(
    { _id: order._id },
    {
      $set: {
        advancePaid: amount,
        dueAmount: Math.max(0, order.totalAmount - amount),
        status: "confirmed",
        paidAt: new Date(),
      },
    },
  );
  return { ok: true, orderNumber: order.orderNumber };
}

// Inserts a paid payment record exactly once (unique gatewaySessionId), then settles the order.
export async function recordPaid({
  order,
  amount,
  currency,
  paymentType,
  transactionId,
  gatewaySessionId,
  gateway,
  method,
}) {
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
      amount,
      currency,
      paymentType,
      transactionId,
      gatewaySessionId,
      gateway,
      method: method || gateway,
      paymentStatus: "paid",
      paidAt: new Date(),
    });
  } catch (e) {
    if (e.code === 11000)
      return { ok: true, duplicate: true, orderNumber: order.orderNumber }; // idempotent
    throw e;
  }
  return settleOrder(order, amount);
}

export const amountDueNow = (order) =>
  order.orderType === "preorder" ? order.advanceAmount : order.totalAmount;
