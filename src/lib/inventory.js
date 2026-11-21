import { col } from "../config/db.js";

// Give stock / pre-order quota back when an order is cancelled.
export async function releaseInventory(order) {
  for (const item of order.items) {
    if (order.orderType === "instock") {
      await col.products.updateOne(
        { _id: item.productId },
        { $inc: { stock: item.quantity } },
      );
    } else if (order.advancePaid > 0) {
      // quota is only booked after the advance payment succeeds
      await col.products.updateOne(
        { _id: item.productId },
        { $inc: { preorderBooked: -item.quantity } },
      );
    }
  }
}
