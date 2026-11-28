import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { newsletterAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import StatCard from '../components/StatCard';
import DataTable from '../components/DataTable';
import Modal from '../components/Modal';

const STATUS_MAP = {
  draft:   { label: 'Draft',   cls: 'badge-neutral' },
  sending: { label: 'Sending', cls: 'badge-warning' },
  sent:    { label: 'Sent',    cls: 'badge-success' },
  failed:  { label: 'Failed',  cls: 'badge-danger' },
};

const SEGMENT_LABEL = {
  all:              'All subscribers',
  subscribers_only: 'Subscribers only',
  customers_only:   'Customers (ordered)',
  all_customers:    'All customers',
};

function CampaignStatusBadge({ status }) {
  const info = STATUS_MAP[status] || STATUS_MAP.draft;
  return (
    <span
      className={`badge ${info.cls}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
    >
      {status === 'sending' && (
        <span
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            borderRadius: '50%',
            border: '2px solid currentColor',
            borderTopColor: 'transparent',
            animation: 'spin 0.7s linear infinite',
          }}
        />
      )}
      {info.label}
    </span>
  );
}

export default function CampaignHistory() {
  const toast = useToast();

  const [data, setData]                   = useState([]);
  const [total, setTotal]                 = useState(0);
  const [page, setPage]                   = useState(1);
  const [totalPages, setTotalPages]       = useState(1);
  const [loading, setLoading]             = useState(true);
  const [refreshing, setRefreshing]       = useState(false);
  const [error, setError]                 = useState('');
  const [detail, setDetail]               = useState(null);
  const [detailOpen, setDetailOpen]       = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const fetchData = useCallback(async (pg = page, silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError('');
    try {
      const { data: res } = await newsletterAPI.getCampaigns({ page: pg, limit: 20 });
      setData(res.data || []);
      setTotal(res.total || 0);
      setPage(res.page || pg);
      setTotalPages(res.totalPages || 1);
    } catch {
      setError('Failed to load campaigns.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page]);

  useEffect(() => {
    fetchData(page, false);
  }, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh if any campaign is currently 'sending'
  useEffect(() => {
    const hasSending = data.some(c => c.status === 'sending');
    if (!hasSending) return;
    const t = setInterval(() => fetchData(page, true), 5000);
    return () => clearInterval(t);
  }, [data, page, fetchData]);

  const openDetail = async (id) => {
    setDetail(null);
    setDetailOpen(true);
    setLoadingDetail(true);
    try {
      const { data: res } = await newsletterAPI.getCampaignById(id);
      setDetail(res);
    } catch {
      toast.error('Failed to load campaign details.');
      setDetailOpen(false);
    } finally {
      setLoadingDetail(false);
    }
  };

  const pageSummary = useMemo(() => {
    const totalSent = data.reduce((s, c) => s + Number(c.sent_count || 0), 0);
    const totalRecipients = data.reduce((s, c) => s + Number(c.recipient_count || 0), 0);
    const completed = data.filter(c => c.status === 'sent').length;
    const deliveryRate = totalRecipients > 0 ? Math.round((totalSent / totalRecipients) * 100) : 0;
    return { totalSent, completed, deliveryRate };
  }, [data]);

  const fmt = (d) =>
    d
      ? new Date(d).toLocaleString('en-GH', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : '—';

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1>Campaign History</h1>
          <p className="muted">Track newsletter delivery &amp; past email broadcasts</p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => fetchData(page, true)}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing…' : '↻ Refresh'}
          </button>
          <Link to="/newsletter/compose" className="btn btn-accent btn-sm">
            + Compose Campaign
          </Link>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="stats-grid" style={{ marginBottom: 20 }}>
        <StatCard
          label="Total Campaigns"
          value={total.toLocaleString()}
          sub={`${pageSummary.completed} sent on this page`}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
              <polyline points="22,6 12,13 2,6" />
            </svg>
          }
        />
        <StatCard
          label="Emails Delivered"
          value={pageSummary.totalSent.toLocaleString()}
          sub="Across displayed campaigns"
          accent="var(--ac-success)"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          }
        />
        <StatCard
          label="Delivery Rate"
          value={pageSummary.totalSent > 0 ? `${pageSummary.deliveryRate}%` : '—'}
          sub="Sent vs total recipients"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          }
        />
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Campaigns DataTable */}
      <div className="card">
        <DataTable
          loading={loading}
          rows={data}
          onRowClick={row => openDetail(row.id)}
          emptyMessage="No newsletter campaigns sent yet."
          columns={[
            {
              key: 'subject',
              label: 'Subject',
              render: row => (
                <div>
                  <div className="cell-primary" style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.subject}
                  </div>
                  <div className="cell-muted text-xs">{row.sent_by_name || 'Admin'}</div>
                </div>
              ),
            },
            {
              key: 'segment',
              label: 'Audience',
              render: row => (
                <span className="badge badge-neutral">
                  {SEGMENT_LABEL[row.segment] || row.segment}
                </span>
              ),
            },
            {
              key: 'status',
              label: 'Status',
              render: row => <CampaignStatusBadge status={row.status} />,
            },
            {
              key: 'recipient_count',
              label: 'Recipients',
              className: 'cell-right',
              render: row => Number(row.recipient_count || 0).toLocaleString(),
            },
            {
              key: 'sent_count',
              label: 'Delivered',
              className: 'cell-right',
              render: row => (
                <span style={{ color: 'var(--ac-success)', fontWeight: 600 }}>
                  {Number(row.sent_count || 0).toLocaleString()}
                </span>
              ),
            },
            {
              key: 'failed_count',
              label: 'Failed',
              className: 'cell-right',
              render: row => (
                <span style={{ color: row.failed_count > 0 ? 'var(--ac-danger)' : 'var(--ac-text-muted)' }}>
                  {Number(row.failed_count || 0).toLocaleString()}
                </span>
              ),
            },
            {
              key: 'created_at',
              label: 'Date',
              render: row => <span className="text-sm">{fmt(row.created_at)}</span>,
            },
            {
              key: 'actions',
              label: '',
              width: 110,
              className: 'cell-right',
              render: row => (
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={e => {
                    e.stopPropagation();
                    openDetail(row.id);
                  }}
                >
                  View details
                </button>
              ),
            },
          ]}
        />

        {totalPages > 1 && (
          <div className="pagination">
            <span>
              Page <strong>{page}</strong> of <strong>{totalPages}</strong> ({total.toLocaleString()} campaigns)
            </span>
            <div className="pagination-controls">
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                ← Prev
              </button>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={page >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Campaign Detail Modal (Native HTML5 <dialog>) */}
      <Modal
        open={detailOpen}
        onClose={() => {
          setDetailOpen(false);
          setDetail(null);
        }}
        title={detail ? detail.subject : 'Campaign details'}
        size="lg"
        footer={
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              setDetailOpen(false);
              setDetail(null);
            }}
          >
            Close
          </button>
        }
      >
        {loadingDetail ? (
          <div style={{ padding: 36, textAlign: 'center' }}>
            <div className="spinner" />
          </div>
        ) : detail ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* Meta */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, fontSize: '0.85rem' }}>
              <div>
                <div className="muted text-xs">Audience</div>
                <div style={{ fontWeight: 500, marginTop: 2 }}>{SEGMENT_LABEL[detail.segment] || detail.segment}</div>
              </div>
              <div>
                <div className="muted text-xs">Status</div>
                <div style={{ marginTop: 2 }}><CampaignStatusBadge status={detail.status} /></div>
              </div>
              <div>
                <div className="muted text-xs">Sent by</div>
                <div style={{ fontWeight: 500, marginTop: 2 }}>{detail.sent_by_name || '—'}</div>
              </div>
              <div>
                <div className="muted text-xs">Date</div>
                <div style={{ fontWeight: 500, marginTop: 2 }}>{fmt(detail.created_at)}</div>
              </div>
            </div>

            {/* Delivery Breakdown */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {[
                { label: 'Recipients', value: detail.recipient_count || 0 },
                { label: 'Delivered',  value: detail.sent_count || 0, color: 'var(--ac-success)' },
                { label: 'Failed',     value: detail.failed_count || 0, color: detail.failed_count > 0 ? 'var(--ac-danger)' : undefined },
              ].map(s => (
                <div
                  key={s.label}
                  style={{
                    background: 'var(--ac-surface-2)',
                    border: '1px solid var(--ac-border)',
                    borderRadius: 'var(--ac-radius)',
                    padding: '10px 14px',
                  }}
                >
                  <div style={{ fontSize: '1.35rem', fontWeight: 700, color: s.color || 'var(--ac-text)' }}>
                    {Number(s.value).toLocaleString()}
                  </div>
                  <div className="muted text-xs">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Email Body Preview */}
            <div>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: 8 }}>Email body preview</div>
              <iframe
                title="Campaign email body preview"
                sandbox=""
                srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:16px;font-family:sans-serif;font-size:14px;line-height:1.6;color:#111827;background:#ffffff;word-break:break-word;}img{max-width:100%;height:auto;}</style></head><body>${detail.body_html || ''}</body></html>`}
                style={{
                  width: '100%',
                  height: 260,
                  border: '1px solid var(--ac-border)',
                  borderRadius: 'var(--ac-radius)',
                  background: '#ffffff',
                }}
              />
            </div>

            {/* Failed sends log */}
            {detail.sends?.filter(s => s.status === 'failed').length > 0 && (
              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--ac-danger)', marginBottom: 8 }}>
                  Failed recipients
                </div>
                <div
                  style={{
                    border: '1px solid var(--ac-danger)',
                    background: 'var(--ac-danger-soft)',
                    borderRadius: 'var(--ac-radius)',
                    maxHeight: 160,
                    overflowY: 'auto',
                  }}
                >
                  {detail.sends
                    .filter(s => s.status === 'failed')
                    .map(s => (
                      <div
                        key={s.id}
                        style={{
                          padding: '8px 12px',
                          borderBottom: '1px solid rgba(220, 38, 38, 0.15)',
                          fontSize: '0.8rem',
                          fontFamily: 'monospace',
                        }}
                      >
                        {s.email}
                        {s.error_message && (
                          <span style={{ opacity: 0.8, marginLeft: 8 }}>— {s.error_message}</span>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
