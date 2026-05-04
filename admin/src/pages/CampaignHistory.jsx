import { useState, useEffect, useCallback } from 'react';
import { newsletterAPI } from '../services/api';

const STATUS_BADGE = {
  draft:   { label: 'Draft',   bg: '#f3f4f6', color: '#6b7280' },
  sending: { label: 'Sending', bg: '#fef9c3', color: '#ca8a04' },
  sent:    { label: 'Sent',    bg: '#dcfce7', color: '#16a34a' },
  failed:  { label: 'Failed',  bg: '#fee2e2', color: '#dc2626' },
};

const SEGMENT_LABEL = {
  all:              'All subscribers',
  subscribers_only: 'Subscribers only',
  customers_only:   'Customers (ordered)',
  all_customers:    'All customers',
};

function StatusBadge({ status }) {
  const b = STATUS_BADGE[status] || STATUS_BADGE.draft;
  return (
    <span style={{ background: b.bg, color: b.color, borderRadius: 20, padding: '2px 10px', fontSize: '0.75rem', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      {status === 'sending' && (
        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', border: '2px solid currentColor', borderTopColor: 'transparent', animation: 'spin 0.7s linear infinite' }} />
      )}
      {b.label}
    </span>
  );
}

export default function CampaignHistory() {
  const [data, setData]             = useState([]);
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [detail, setDetail]         = useState(null);   // full campaign detail for modal
  const [loadingDetail, setLoadingDetail] = useState(false);

  const fetchData = useCallback(async (pg = page) => {
    setLoading(true);
    setError('');
    try {
      const { data: res } = await newsletterAPI.getCampaigns({ page: pg, limit: 20 });
      setData(res.data);
      setTotal(res.total);
      setPage(res.page);
      setTotalPages(res.totalPages);
    } catch {
      setError('Failed to load campaigns.');
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { fetchData(1); }, []);

  // Auto-refresh if any campaign is 'sending'
  useEffect(() => {
    const hasSending = data.some(c => c.status === 'sending');
    if (!hasSending) return;
    const t = setInterval(() => fetchData(page), 5000);
    return () => clearInterval(t);
  }, [data, page, fetchData]);

  const openDetail = async (id) => {
    setDetail(null);
    setLoadingDetail(true);
    try {
      const { data: res } = await newsletterAPI.getCampaignById(id);
      setDetail(res);
    } catch {
      alert('Failed to load campaign details.');
    } finally {
      setLoadingDetail(false);
    }
  };

  const fmt = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  return (
    <div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <div style={{ marginBottom: 24 }}>
        <h1 className="page-title">Campaign History</h1>
        <p className="page-subtitle">All sent newsletter campaigns</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card" style={{ overflow: 'hidden' }}>
        <table className="table">
          <thead>
            <tr>
              <th>Subject</th>
              <th>Segment</th>
              <th>Status</th>
              <th>Recipients</th>
              <th>Sent</th>
              <th>Failed</th>
              <th>Sent by</th>
              <th>Date</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: 32 }}><div className="spinner" /></td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: 32, color: 'var(--ac-text-muted)' }}>No campaigns yet.</td></tr>
            ) : data.map(row => (
              <tr key={row.id}>
                <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.subject}
                </td>
                <td style={{ fontSize: '0.82rem', color: 'var(--ac-text-soft)' }}>
                  {SEGMENT_LABEL[row.segment] || row.segment}
                </td>
                <td><StatusBadge status={row.status} /></td>
                <td style={{ textAlign: 'right' }}>{row.recipient_count.toLocaleString()}</td>
                <td style={{ textAlign: 'right', color: '#16a34a' }}>{row.sent_count.toLocaleString()}</td>
                <td style={{ textAlign: 'right', color: row.failed_count > 0 ? '#dc2626' : 'var(--ac-text-muted)' }}>
                  {row.failed_count.toLocaleString()}
                </td>
                <td style={{ fontSize: '0.82rem' }}>{row.sent_by_name || '—'}</td>
                <td style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>{fmt(row.created_at)}</td>
                <td>
                  <button
                    className="btn btn-sm"
                    onClick={() => openDetail(row.id)}
                    style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}
                  >
                    View details
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 20 }}>
          <button className="btn btn-sm" disabled={page <= 1} onClick={() => { setPage(p => p - 1); fetchData(page - 1); }}>Previous</button>
          <span style={{ padding: '6px 12px', fontSize: '0.85rem', color: 'var(--ac-text-muted)' }}>Page {page} of {totalPages}</span>
          <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => { setPage(p => p + 1); fetchData(page + 1); }}>Next</button>
        </div>
      )}

      {/* Detail modal */}
      {(detail !== null || loadingDetail) && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 680, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>Campaign details</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem' }} onClick={() => setDetail(null)}>×</button>
            </div>

            {loadingDetail ? (
              <div style={{ textAlign: 'center', padding: 32 }}><div className="spinner" /></div>
            ) : detail && (
              <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Meta */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: '0.85rem' }}>
                  <div><strong>Subject:</strong><br />{detail.subject}</div>
                  <div><strong>Segment:</strong><br />{SEGMENT_LABEL[detail.segment] || detail.segment}</div>
                  <div><strong>Status:</strong><br /><StatusBadge status={detail.status} /></div>
                  <div><strong>Sent by:</strong><br />{detail.sent_by_name || '—'}</div>
                </div>

                {/* Stats */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                  {[
                    { label: 'Recipients', value: detail.recipient_count },
                    { label: 'Sent',       value: detail.sent_count, color: '#16a34a' },
                    { label: 'Failed',     value: detail.failed_count, color: detail.failed_count > 0 ? '#dc2626' : undefined },
                  ].map(s => (
                    <div key={s.label} style={{ background: 'var(--ac-bg)', borderRadius: 6, padding: '10px 14px' }}>
                      <div style={{ fontSize: '1.4rem', fontWeight: 700, color: s.color }}>{s.value.toLocaleString()}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--ac-text-muted)' }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Body preview */}
                <div>
                  <strong style={{ fontSize: '0.85rem' }}>Email body preview</strong>
                  <div
                    style={{ border: '1px solid var(--ac-border)', borderRadius: 4, padding: 16, marginTop: 8, fontFamily: 'sans-serif', fontSize: '0.9rem', lineHeight: 1.6, maxHeight: 240, overflowY: 'auto' }}
                    dangerouslySetInnerHTML={{ __html: detail.body_html }}
                  />
                </div>

                {/* Failed sends list */}
                {detail.sends?.filter(s => s.status === 'failed').length > 0 && (
                  <div>
                    <strong style={{ fontSize: '0.85rem', color: '#dc2626' }}>Failed recipients</strong>
                    <div style={{ border: '1px solid #fee2e2', borderRadius: 4, marginTop: 8, maxHeight: 160, overflowY: 'auto' }}>
                      {detail.sends.filter(s => s.status === 'failed').map(s => (
                        <div key={s.id} style={{ padding: '8px 12px', borderBottom: '1px solid #fee2e2', fontSize: '0.8rem', fontFamily: 'monospace' }}>
                          {s.email}
                          {s.error_message && <span style={{ color: '#9ca3af', marginLeft: 8 }}>— {s.error_message}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
