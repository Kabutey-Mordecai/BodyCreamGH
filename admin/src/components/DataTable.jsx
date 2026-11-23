import { useMemo } from 'react';

/**
 * Modern High-Density DataTable component:
 * - CSS Container Queries (@container) transforming rows into mobile cards on narrow screens.
 * - Sticky table headers with subtle border/shadow for seamless vertical scrolling.
 * - Skeleton shimmer loading state that eliminates layout shift (CLS).
 * - Interactive sort indicator support with aria-sort.
 * - Optional row multi-selection & floating bulk action pill.
 */
export default function DataTable({
  columns = [],
  rows = [],
  onRowClick,
  emptyMessage = 'No records found.',
  loading = false,
  skeletonCount = 5,
  selectable = false,
  selectedIds = [],
  onToggleSelect,
  onSelectAll,
  bulkActions,
  sortField,
  sortDir,
  onSort,
}) {
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allSelected = rows.length > 0 && rows.every(r => selectedSet.has(r.id));
  const isPartiallySelected = rows.some(r => selectedSet.has(r.id)) && !allSelected;

  const handleSelectAllToggle = () => {
    if (!onSelectAll) return;
    if (allSelected) {
      onSelectAll([]);
    } else {
      onSelectAll(rows.map(r => r.id));
    }
  };

  // Skeleton rows during data fetching
  if (loading) {
    return (
      <div tabIndex={0} role="region" aria-label="Loading data table" className="data-table-scroll data-table-container">
        <table className="data-table" aria-busy="true">
          <thead>
            <tr>
              {selectable && <th style={{ width: 44 }}></th>}
              {columns.map(c => (
                <th
                  key={c.key}
                  className={c.className}
                  style={c.width ? { width: c.width } : undefined}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: skeletonCount }).map((_, idx) => (
              <tr key={`skeleton-${idx}`} className="data-table-skeleton-row">
                {selectable && (
                  <td>
                    <div className="data-table-skeleton-cell" style={{ width: 18, height: 18, borderRadius: 4 }} />
                  </td>
                )}
                {columns.map(c => (
                  <td key={c.key} data-label={c.label} className={c.className}>
                    <div
                      className="data-table-skeleton-cell"
                      style={{
                        width: c.key === 'actions' ? 80 : `${Math.floor(40 + ((idx * 17) % 50))}%`,
                        maxWidth: '100%',
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <div className="empty" style={{ padding: '48px 20px' }}>
        <div className="empty-icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div
      tabIndex={0}
      role="region"
      aria-label="Data table"
      className="data-table-scroll data-table-container"
    >
      <table className="data-table">
        <thead>
          <tr>
            {selectable && (
              <th style={{ width: 44, textAlign: 'center' }}>
                <input
                  type="checkbox"
                  aria-label="Select all rows"
                  checked={allSelected}
                  ref={el => { if (el) el.indeterminate = isPartiallySelected; }}
                  onChange={handleSelectAllToggle}
                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                />
              </th>
            )}
            {columns.map(c => {
              const isSorted = sortField === c.key;
              const ariaSort = isSorted ? (sortDir === 'asc' ? 'ascending' : 'descending') : (c.sortable ? 'none' : undefined);
              return (
                <th
                  key={c.key}
                  className={`${c.className || ''} ${c.sortable ? 'sortable' : ''}`}
                  style={c.width ? { width: c.width } : undefined}
                  aria-sort={ariaSort}
                  onClick={() => c.sortable && onSort?.(c.key)}
                >
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: c.sortable ? 'pointer' : 'default' }}>
                    <span>{c.label}</span>
                    {c.sortable && (
                      <span className="sort-indicator" aria-hidden="true" style={{ fontSize: '0.7rem', opacity: isSorted ? 1 : 0.35 }}>
                        {isSorted ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                      </span>
                    )}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const rowId = row.id || row.key || JSON.stringify(row).slice(0, 60);
            const isSelected = selectedSet.has(row.id);
            return (
              <tr
                key={rowId}
                className={`${onRowClick ? 'clickable' : ''} ${isSelected ? 'selected' : ''}`}
                onClick={(e) => {
                  // Don't trigger row click if clicking checkbox, buttons, or links
                  if (e.target.closest('input, button, a')) return;
                  if (onRowClick) onRowClick(row);
                }}
              >
                {selectable && (
                  <td
                    data-label="Select"
                    style={{ width: 44, textAlign: 'center' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select row ${row.name || row.order_number || rowId}`}
                      checked={isSelected}
                      onChange={() => onToggleSelect?.(row.id)}
                      style={{ width: 16, height: 16, cursor: 'pointer' }}
                    />
                  </td>
                )}
                {columns.map(c => (
                  <td key={c.key} data-label={c.label} className={c.className}>
                    {c.render ? c.render(row) : row[c.key]}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Floating Multi-Select Bulk Actions Bar */}
      {selectable && selectedIds.length > 0 && (
        <div className="data-table-bulk-bar" role="toolbar" aria-label="Bulk actions">
          <div className="bulk-bar-count">
            <strong>{selectedIds.length}</strong> item{selectedIds.length !== 1 ? 's' : ''} selected
          </div>
          <div className="bulk-bar-actions">
            {bulkActions}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onSelectAll?.([])}
            >
              Deselect All
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
