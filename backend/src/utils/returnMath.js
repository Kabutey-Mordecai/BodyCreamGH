'use strict';

/**
 * Compute integer-pesewa pro-rated refund amounts for an item-level return request.
 *
 * Rounding & coupon rules:
 * - Each requested line gets its floored pro-rated share of the net items amount
 *   paid (itemsSubtotal - discount).
 * - Coupon minimum-spend policy: we intentionally do NOT claw back a coupon
 *   discount retroactively if a partial return brings the kept items below the
 *   original coupon min_order_amount; each item is refunded at its pro-rated
 *   discounted price paid.
 * - When this return request accounts for the LAST remaining returnable unit(s)
 *   on the entire order (i.e. all purchased item units have now been returned),
 *   the last requested line absorbs any positive pesewa remainder so that a
 *   100% return (whether in one request or across multiple partial returns)
 *   refunds the EXACT net item amount paid to the pesewa.
 *
 * @param {object} params
 * @param {Array<{id: string, quantity: number, price_at_purchase: number|string, subtotal?: number|string}>} params.orderItems
 * @param {number|string} [params.discountAmount=0]
 * @param {Map<string, number>|Object<string, number>} [params.alreadyCommittedQtyByItemId]
 * @param {number} [params.alreadyCommittedItemRefundPesewas=0]
 * @param {Array<{order_item_id: string, quantity: number}>} params.requestedItems
 * @returns {{ lines: Array<{order_item_id: string, quantity: number, unit_refund_pesewas: number, line_refund_pesewas: number, unit_refund_amount: number, line_refund_amount: number}>, totalRefundPesewas: number, totalRefundAmount: number, completesAllItems: boolean }}
 */
function calculateReturnRefund({
  orderItems,
  discountAmount = 0,
  alreadyCommittedQtyByItemId = {},
  alreadyCommittedItemRefundPesewas = 0,
  requestedItems,
}) {
  const getCommittedQty = (itemId) => {
    if (alreadyCommittedQtyByItemId instanceof Map) {
      return Number(alreadyCommittedQtyByItemId.get(itemId) || 0);
    }
    return Number(alreadyCommittedQtyByItemId[itemId] || 0);
  };

  const itemById = new Map();
  let itemsSubtotalPesewas = 0;
  let totalPurchasedUnits = 0;
  let totalAlreadyCommittedUnits = 0;

  for (const item of orderItems) {
    const qty = Number(item.quantity);
    const unitPesewas = Math.round(Number(item.price_at_purchase) * 100);
    const lineGrossPesewas = item.subtotal != null
      ? Math.round(Number(item.subtotal) * 100)
      : unitPesewas * qty;
    itemById.set(item.id, { ...item, qty, unitPesewas, lineGrossPesewas });
    itemsSubtotalPesewas += lineGrossPesewas;
    totalPurchasedUnits += qty;
    totalAlreadyCommittedUnits += getCommittedQty(item.id);
  }

  const discountPesewas = Math.max(0, Math.round(Number(discountAmount || 0) * 100));
  const netPaidItemsPesewas = Math.max(0, itemsSubtotalPesewas - discountPesewas);

  // Deduplicate / merge requested items by order_item_id
  const merged = new Map();
  for (const req of requestedItems) {
    const qty = Number(req.quantity);
    if (!Number.isInteger(qty) || qty <= 0) {
      throw new Error('Return quantity must be a positive integer');
    }
    merged.set(req.order_item_id, (merged.get(req.order_item_id) || 0) + qty);
  }

  if (merged.size === 0) {
    throw new Error('At least one item must be selected for return');
  }

  const lines = [];
  let requestedTotalUnits = 0;
  let sumLinePesewas = 0;

  for (const [orderItemId, reqQty] of merged.entries()) {
    const item = itemById.get(orderItemId);
    if (!item) {
      throw new Error(`Order item ${orderItemId} does not belong to this order`);
    }
    const alreadyQty = getCommittedQty(orderItemId);
    const remainingQty = item.qty - alreadyQty;
    if (reqQty > remainingQty) {
      throw new Error(`Cannot return ${reqQty} of item ${orderItemId}; only ${remainingQty} remaining`);
    }

    // Floored pro-rated pesewas for this line
    const linePesewas = itemsSubtotalPesewas > 0
      ? Math.floor((item.unitPesewas * reqQty * netPaidItemsPesewas) / itemsSubtotalPesewas)
      : 0;
    const unitPesewas = Math.floor(linePesewas / reqQty);

    lines.push({
      order_item_id: orderItemId,
      quantity: reqQty,
      unit_refund_pesewas: unitPesewas,
      line_refund_pesewas: linePesewas,
      unit_refund_amount: unitPesewas / 100,
      line_refund_amount: linePesewas / 100,
    });
    requestedTotalUnits += reqQty;
    sumLinePesewas += linePesewas;
  }

  const completesAllItems = (totalAlreadyCommittedUnits + requestedTotalUnits) === totalPurchasedUnits;

  // Last returned unit absorbs any pesewa remainder so 100% return === exact net paid
  if (completesAllItems && lines.length > 0) {
    const remainingNetPesewas = Math.max(0, netPaidItemsPesewas - Math.round(alreadyCommittedItemRefundPesewas));
    const remainder = remainingNetPesewas - sumLinePesewas;
    if (remainder !== 0) {
      const last = lines[lines.length - 1];
      last.line_refund_pesewas = Math.max(0, last.line_refund_pesewas + remainder);
      last.line_refund_amount = last.line_refund_pesewas / 100;
      last.unit_refund_pesewas = Math.round(last.line_refund_pesewas / last.quantity);
      last.unit_refund_amount = last.unit_refund_pesewas / 100;
      sumLinePesewas = lines.reduce((acc, l) => acc + l.line_refund_pesewas, 0);
    }
  }

  // Hard cap: never exceed remaining net paid items amount
  const maxRemainingPesewas = Math.max(0, netPaidItemsPesewas - Math.round(alreadyCommittedItemRefundPesewas));
  if (sumLinePesewas > maxRemainingPesewas && lines.length > 0) {
    const excess = sumLinePesewas - maxRemainingPesewas;
    const last = lines[lines.length - 1];
    last.line_refund_pesewas = Math.max(0, last.line_refund_pesewas - excess);
    last.line_refund_amount = last.line_refund_pesewas / 100;
    sumLinePesewas = lines.reduce((acc, l) => acc + l.line_refund_pesewas, 0);
  }

  return {
    lines,
    totalRefundPesewas: sumLinePesewas,
    totalRefundAmount: sumLinePesewas / 100,
    completesAllItems,
  };
}

module.exports = { calculateReturnRefund };
