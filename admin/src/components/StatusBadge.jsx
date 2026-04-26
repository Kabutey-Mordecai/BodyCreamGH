// Color-coded status pill. Centralized here so every page uses the same colors.
const MAP = {
  // Orders
  pending:   { cls: 'badge-warning', label: 'Pending' },
  confirmed: { cls: 'badge-info',    label: 'Confirmed' },
  processing:{ cls: 'badge-info',    label: 'Processing' },
  shipped:   { cls: 'badge-info',    label: 'Shipped' },
  delivered: { cls: 'badge-success', label: 'Delivered' },
  cancelled: { cls: 'badge-danger',  label: 'Cancelled' },
  refunded:  { cls: 'badge-neutral', label: 'Refunded' },

  // Payments
  paid:          { cls: 'badge-success', label: 'Paid' },
  unpaid:        { cls: 'badge-warning', label: 'Unpaid' },
  not_requested: { cls: 'badge-neutral', label: 'Not requested' },
  success:       { cls: 'badge-success', label: 'Success' },
  failed:        { cls: 'badge-danger',  label: 'Failed' },

  // Stock
  in_stock:     { cls: 'badge-success', label: 'In stock' },
  low_stock:    { cls: 'badge-warning', label: 'Low stock' },
  out_of_stock: { cls: 'badge-danger',  label: 'Out of stock' },
};

export default function StatusBadge({ status }) {
  const normalized = String(status || '').toLowerCase();
  const cfg = MAP[normalized] || { cls: 'badge-neutral', label: status || '—' };
  return <span className={`badge ${cfg.cls}`}>{cfg.label}</span>;
}
