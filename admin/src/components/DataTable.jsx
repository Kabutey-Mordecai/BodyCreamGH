// Reusable table. `columns` is [{ key, label, render?, className?, width? }].
// `rows` is an array of objects. Optional onRowClick makes rows navigable.
// Keep this dumb — sorting/filtering is owned by the caller.
export default function DataTable({
  columns,
  rows,
  onRowClick,
  emptyMessage = 'No records found.',
  loading = false,
}) {
  if (loading) return <div className="spinner" />;

  if (!rows || rows.length === 0) {
    return (
      <div className="empty" style={{ padding: '48px 20px' }}>
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div tabIndex={0} role="region" aria-label="Data table" className="data-table-scroll data-table-container">
      <table className="data-table">
        <thead>
          <tr>
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
          {rows.map(row => (
            <tr
              key={row.id || row.key || JSON.stringify(row).slice(0, 60)}
              className={onRowClick ? 'clickable' : ''}
              onClick={() => onRowClick && onRowClick(row)}
            >
              {columns.map(c => (
                <td key={c.key} data-label={c.label} className={c.className}>
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
