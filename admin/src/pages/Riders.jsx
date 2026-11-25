import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { deliveriesAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import './Riders.css';

const VEHICLE_OPTIONS = [
  { value: 'motorbike', label: '🏍️ Motorbike' },
  { value: 'van',       label: '🚐 Delivery Van' },
  { value: 'car',       label: '🚗 Sedan / SUV' },
  { value: 'bicycle',   label: '🚲 Cargo Bike' },
  { value: 'courier',   label: '📦 3rd-Party Courier' },
];

const VEHICLE_LABELS = {
  motorbike: '🏍️ Motorbike',
  van:       '🚐 Van',
  car:       '🚗 Car',
  bicycle:   '🚲 Bike',
  courier:   '📦 Courier',
};

const GHANA_ZONE_PRESETS = [
  'Accra Central',
  'East Legon & Airport',
  'Osu & Labone',
  'Spintex & Tema',
  'Madina & Adenta',
  'Dansoman & Kasoa',
  'Kumasi Metro',
  'Nationwide Courier',
];

const EMPTY_FORM = {
  name: '',
  phone: '',
  vehicle_type: 'motorbike',
  vehicle_plate: '',
  zone_coverage: '',
  notes: '',
  is_active: true,
};

function toWhatsAppDigits(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10 && digits.startsWith('0')) return `233${digits.slice(1)}`;
  if (digits.length === 9) return `233${digits}`;
  return digits;
}

function getInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'RD';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

const fmtGhs = (n) => `GHS ${Number(n || 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Riders() {
  const toast = useToast();

  const [riders, setRiders] = useState([]);
  const [legacyPartners, setLegacyPartners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');

  // Add / Edit Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRider, setEditingRider] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Delete confirmation modal state
  const [deleteTarget, setDeleteTarget] = useState(null); // { type: 'rider' | 'legacy' | 'legacy_all', item, forceNeeded }
  const [deleting, setDeleting] = useState(false);

  // Route Manifest modal state
  const [manifestTarget, setManifestTarget] = useState(null);
  const [manifestExpiry, setManifestExpiry] = useState('24h');
  const [manifestData, setManifestData] = useState(null);
  const [manifestBusy, setManifestBusy] = useState(false);

  const loadRiders = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data } = await deliveriesAPI.getRiders();
      setRiders(Array.isArray(data?.riders) ? data.riders : []);
      setLegacyPartners(Array.isArray(data?.legacy_partners) ? data.legacy_partners : []);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load dispatch riders');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadRiders();
  }, [loadRiders]);

  // Detect duplicate phones among legacy test entries so admins see why they collided
  const legacyPhoneCounts = useMemo(() => {
    const map = {};
    legacyPartners.forEach(lp => {
      const key = toWhatsAppDigits(lp.driver_phone);
      if (key) map[key] = (map[key] || 0) + 1;
    });
    return map;
  }, [legacyPartners]);

  // KPI metrics
  const kpis = useMemo(() => {
    const onDuty = riders.filter(r => r.is_active).length;
    const activeStops = riders.reduce((sum, r) => sum + Number(r.active_stops || 0), 0);
    const codPending = riders.reduce((sum, r) => sum + Number(r.cod_pending_ghs || 0), 0);
    const completedToday = riders.reduce((sum, r) => sum + Number(r.completed_today || 0), 0);
    return { onDuty, total: riders.length, activeStops, codPending, completedToday };
  }, [riders]);

  // Filtered riders
  const filteredRiders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return riders.filter(r => {
      if (tab === 'on_duty' && !r.is_active) return false;
      if (tab === 'on_route' && Number(r.active_stops || 0) === 0) return false;
      if (tab === 'off_duty' && r.is_active) return false;
      if (!q) return true;
      const hay = `${r.name || ''} ${r.phone || ''} ${r.vehicle_plate || ''} ${r.zone_coverage || ''} ${r.vehicle_type || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [riders, tab, search]);

  // Open Add Modal
  const openCreateModal = (prefill = null) => {
    setEditingRider(null);
    setFormError('');
    setForm({
      ...EMPTY_FORM,
      ...(prefill || {}),
    });
    setModalOpen(true);
  };

  // Open Edit Modal
  const openEditModal = (rider) => {
    setEditingRider(rider);
    setFormError('');
    setForm({
      name: rider.name || '',
      phone: rider.phone || '',
      vehicle_type: rider.vehicle_type || 'motorbike',
      vehicle_plate: rider.vehicle_plate || '',
      zone_coverage: rider.zone_coverage || '',
      notes: rider.notes || '',
      is_active: Boolean(rider.is_active),
    });
    setModalOpen(true);
  };

  const toggleZonePreset = (zone) => {
    const existing = form.zone_coverage
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const next = existing.includes(zone)
      ? existing.filter(z => z !== zone)
      : [...existing, zone];
    setForm(prev => ({ ...prev, zone_coverage: next.join(', ') }));
  };

  const handleSaveRider = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.name.trim()) {
      setFormError('Rider name is required.');
      return;
    }
    if (!form.phone.trim()) {
      setFormError('Each rider must have their own unique mobile / WhatsApp number.');
      return;
    }

    setSaving(true);
    try {
      if (editingRider) {
        await deliveriesAPI.updateRider(editingRider.id, form);
        toast.success(`Updated "${form.name.trim()}"`);
      } else {
        await deliveriesAPI.createRider(form);
        toast.success(`Added "${form.name.trim()}" to dispatch fleet`);
      }
      setModalOpen(false);
      loadRiders(true);
    } catch (err) {
      const msg = err.response?.data?.error || 'Could not save rider';
      setFormError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleDuty = async (rider) => {
    try {
      await deliveriesAPI.updateRider(rider.id, { is_active: !rider.is_active });
      toast.success(`${rider.name} is now ${!rider.is_active ? 'On Duty' : 'Off Duty'}`);
      loadRiders(true);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update duty status');
    }
  };

  // Delete handlers (Fleet rider OR Unregistered legacy rider)
  const confirmDelete = async (force = false) => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      if (deleteTarget.type === 'rider') {
        const { data } = await deliveriesAPI.deleteRider(deleteTarget.item.id, force);
        toast.success(data?.message || `Deleted ${deleteTarget.item.name}`);
      } else if (deleteTarget.type === 'legacy') {
        const { data } = await deliveriesAPI.removeLegacyPartner({
          delivery_partner: deleteTarget.item.delivery_partner,
          force,
        });
        toast.success(data?.message || `Removed ${deleteTarget.item.delivery_partner}`);
      } else if (deleteTarget.type === 'legacy_all') {
        const { data } = await deliveriesAPI.removeLegacyPartner({
          clear_all: true,
          force,
        });
        toast.success(data?.message || 'Cleared unregistered test riders');
      }
      setDeleteTarget(null);
      loadRiders(true);
    } catch (err) {
      if (err.response?.status === 409 && err.response?.data?.requires_force) {
        setDeleteTarget(prev => ({
          ...prev,
          forceNeeded: true,
          activeStops: err.response.data.active_stops,
          warningMessage: err.response.data.error,
        }));
      } else {
        toast.error(err.response?.data?.error || 'Delete failed');
        setDeleteTarget(null);
      }
    } finally {
      setDeleting(false);
    }
  };

  // Generate signed Rider Manifest link when modal opens or expiry changes
  useEffect(() => {
    if (!manifestTarget) return;
    let cancelled = false;
    setManifestBusy(true);
    deliveriesAPI
      .createManifestLink({
        delivery_partner: manifestTarget.name,
        driver_phone: manifestTarget.phone || undefined,
        expires_in: manifestExpiry,
      })
      .then(({ data }) => {
        if (!cancelled) setManifestData(data);
      })
      .catch(err => {
        if (!cancelled) toast.error(err.response?.data?.error || 'Failed to generate manifest link');
      })
      .finally(() => {
        if (!cancelled) setManifestBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [manifestTarget, manifestExpiry, toast]);

  return (
    <div className="page">
      {/* ── Page Header ──────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Riders &amp; Fleet</h1>
          <p className="muted text-sm" style={{ marginTop: 4 }}>
            Register dispatch riders with unique WhatsApp numbers, share signed mobile route links, and remove stale test entries.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link to="/orders" className="btn btn-outline" style={{ textDecoration: 'none' }}>
            📦 View Orders Queue
          </Link>
          <button type="button" className="btn btn-outline" onClick={() => loadRiders()}>
            ↻ Refresh
          </button>
          <button type="button" className="btn btn-accent" onClick={() => openCreateModal()}>
            + Add Dispatch Rider
          </button>
        </div>
      </div>

      {/* ── 4-Card Operations KPI Strip ──────────────────────────────── */}
      <div className="rf-kpi-grid">
        <div className="rf-kpi-card">
          <div className="rf-kpi-top">
            <span className="rf-kpi-label">Active Fleet</span>
            <span className="rf-kpi-icon">🏍️</span>
          </div>
          <div className="rf-kpi-value">{kpis.onDuty} <span className="muted" style={{ fontSize: '0.95rem', fontWeight: 500 }}>/ {kpis.total}</span></div>
          <div className="rf-kpi-sub">On-duty registered riders</div>
        </div>

        <div className="rf-kpi-card">
          <div className="rf-kpi-top">
            <span className="rf-kpi-label">Stops on Road</span>
            <span className="rf-kpi-icon">📍</span>
          </div>
          <div className="rf-kpi-value">{kpis.activeStops}</div>
          <div className="rf-kpi-sub">In-transit awaiting 6-digit OTP</div>
        </div>

        <div className="rf-kpi-card">
          <div className="rf-kpi-top">
            <span className="rf-kpi-label">COD Cash With Riders</span>
            <span className="rf-kpi-icon">₵</span>
          </div>
          <div className="rf-kpi-value">{fmtGhs(kpis.codPending)}</div>
          <div className="rf-kpi-sub">Pay-on-Delivery to remit</div>
        </div>

        <div className="rf-kpi-card">
          <div className="rf-kpi-top">
            <span className="rf-kpi-label">Verified Today</span>
            <span className="rf-kpi-icon">✓</span>
          </div>
          <div className="rf-kpi-value">{kpis.completedToday}</div>
          <div className="rf-kpi-sub">Completed handoffs today</div>
        </div>
      </div>

      {/* ── Unregistered / Historical Test Riders Cleanup Banner ─────── */}
      {legacyPartners.length > 0 && (
        <div className="rf-legacy-banner">
          <div className="rf-legacy-head">
            <div>
              <div className="rf-legacy-title">
                <span>⚠️ {legacyPartners.length} Unregistered / Historical Rider Name{legacyPartners.length === 1 ? '' : 's'} Found</span>
              </div>
              <p className="muted text-xs" style={{ marginTop: 4, maxWidth: 720 }}>
                These names were typed on older or simulated orders before dedicated Fleet Management (which is why several shared the same phone number or could not be deleted). Import real riders with a unique phone number, or delete test entries below.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              style={{ borderColor: 'rgba(239, 68, 68, 0.45)', color: '#f87171' }}
              onClick={() =>
                setDeleteTarget({
                  type: 'legacy_all',
                  forceNeeded: legacyPartners.some(lp => lp.active_stops > 0),
                  activeStops: legacyPartners.reduce((s, lp) => s + Number(lp.active_stops || 0), 0),
                })
              }
            >
              🗑 Delete All Unregistered ({legacyPartners.length})
            </button>
          </div>

          <div className="rf-legacy-grid">
            {legacyPartners.map(lp => {
              const normKey = toWhatsAppDigits(lp.driver_phone);
              const isSharedPhone = normKey && legacyPhoneCounts[normKey] > 1;
              return (
                <div key={lp.delivery_partner} className="rf-legacy-card">
                  <div style={{ minWidth: 0 }}>
                    <div className="rf-legacy-name" title={lp.delivery_partner}>
                      {lp.delivery_partner}
                    </div>
                    <div className="rf-legacy-meta">
                      <span>{lp.driver_phone || 'No phone'}</span>
                      {isSharedPhone && <span className="rf-dup-phone-tag">Duplicate #</span>}
                      <span>· {lp.active_stops} active / {lp.total_count} total</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      title="Register as real fleet rider with unique phone"
                      onClick={() =>
                        openCreateModal({
                          name: lp.delivery_partner,
                          phone: isSharedPhone ? '' : (lp.driver_phone || ''),
                        })
                      }
                    >
                      + Import
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      style={{ color: '#f87171', borderColor: 'rgba(239, 68, 68, 0.35)' }}
                      title={`Delete "${lp.delivery_partner}"`}
                      onClick={() =>
                        setDeleteTarget({
                          type: 'legacy',
                          item: lp,
                          forceNeeded: lp.active_stops > 0,
                          activeStops: lp.active_stops,
                        })
                      }
                    >
                      🗑
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Filter Tabs & Search Bar ─────────────────────────────────── */}
      <div className="rf-toolbar">
        <div className="rf-tabs" role="tablist">
          {[
            { key: 'all',      label: 'All Riders',    count: riders.length },
            { key: 'on_duty',  label: 'On Duty',       count: riders.filter(r => r.is_active).length },
            { key: 'on_route', label: 'Out on Route',  count: riders.filter(r => Number(r.active_stops || 0) > 0).length },
            { key: 'off_duty', label: 'Off Duty',      count: riders.filter(r => !r.is_active).length },
          ].map(t => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`rf-tab${tab === t.key ? ' is-active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              <span>{t.label}</span>
              <span className="rf-tab-count">{t.count}</span>
            </button>
          ))}
        </div>

        <div className="rf-search-wrap">
          <span className="rf-search-icon">🔍</span>
          <input
            type="search"
            placeholder="Search rider name, phone, plate, zone…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* ── Fleet Directory Table ────────────────────────────────────── */}
      <div className="card">
        {loading ? (
          <div style={{ padding: '48px 24px', textAlign: 'center' }} className="muted">
            Loading dispatch fleet…
          </div>
        ) : filteredRiders.length === 0 ? (
          <div style={{ padding: '52px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: '2.2rem', marginBottom: 10 }}>🏍️</div>
            <h3 style={{ margin: '0 0 6px' }}>
              {riders.length === 0 ? 'No Registered Dispatch Riders Yet' : 'No Riders Match Your Filter'}
            </h3>
            <p className="muted text-sm" style={{ maxWidth: 460, margin: '0 auto 18px' }}>
              {riders.length === 0
                ? 'Add your in-house dispatch riders and couriers here. Each rider gets their own unique phone number, instant WhatsApp route link, and live COD tracking.'
                : 'Try clearing your search query or switching status tabs.'}
            </p>
            {riders.length === 0 && (
              <button type="button" className="btn btn-accent" onClick={() => openCreateModal()}>
                + Add First Dispatch Rider
              </button>
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Rider &amp; Vehicle</th>
                  <th>Unique Phone</th>
                  <th>Coverage Zones</th>
                  <th>Live Workload</th>
                  <th>COD Held</th>
                  <th>Status</th>
                  <th className="cell-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRiders.map(rider => {
                  const waDigits = toWhatsAppDigits(rider.phone);
                  const zones = (rider.zone_coverage || '')
                    .split(',')
                    .map(s => s.trim())
                    .filter(Boolean);
                  const activeStops = Number(rider.active_stops || 0);
                  const codHeld = Number(rider.cod_pending_ghs || 0);

                  return (
                    <tr key={rider.id}>
                      <td>
                        <div className="rf-rider-ident">
                          <div className={`rf-avatar${rider.is_active ? '' : ' is-off'}`}>
                            {getInitials(rider.name)}
                          </div>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{rider.name}</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                              <span className="rf-vehicle-pill">
                                {VEHICLE_LABELS[rider.vehicle_type] || '🏍️ Motorbike'}
                              </span>
                              {rider.vehicle_plate && (
                                <span className="rf-plate-badge">{rider.vehicle_plate}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td>
                        <div className="rf-phone-cell">
                          <span className="rf-phone-num">{rider.phone || '—'}</span>
                          {waDigits && (
                            <div className="rf-contact-links">
                              <a
                                href={`https://wa.me/${waDigits}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rf-mini-link rf-mini-link--wa"
                              >
                                💬 WhatsApp
                              </a>
                              <a href={`tel:${rider.phone}`} className="rf-mini-link">
                                📞 Call
                              </a>
                            </div>
                          )}
                        </div>
                      </td>

                      <td>
                        {zones.length > 0 ? (
                          <div className="rf-zone-chips">
                            {zones.slice(0, 3).map(z => (
                              <span key={z} className="rf-zone-chip">{z}</span>
                            ))}
                            {zones.length > 3 && (
                              <span className="rf-zone-chip">+{zones.length - 3}</span>
                            )}
                          </div>
                        ) : (
                          <span className="muted text-xs">All Accra / Unspecified</span>
                        )}
                      </td>

                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {activeStops > 0 ? (
                            <span className="badge badge-info" style={{ width: 'fit-content' }}>
                              {activeStops} Active Stop{activeStops === 1 ? '' : 's'}
                            </span>
                          ) : (
                            <span className="muted text-xs">Idle · 0 active stops</span>
                          )}
                          <span className="muted text-xs">
                            {rider.completed_today || 0} today · {rider.total_completed || 0} lifetime
                          </span>
                        </div>
                      </td>

                      <td>
                        {codHeld > 0 ? (
                          <span style={{ fontWeight: 700, color: '#fbbf24', fontSize: '0.86rem' }}>
                            {fmtGhs(codHeld)}
                          </span>
                        ) : (
                          <span className="muted text-xs">GHS 0.00</span>
                        )}
                      </td>

                      <td>
                        <button
                          type="button"
                          className={`rf-duty-toggle ${rider.is_active ? 'is-on' : 'is-off'}`}
                          onClick={() => handleToggleDuty(rider)}
                          title="Click to toggle On Duty / Off Duty"
                        >
                          <span className="rf-duty-dot" />
                          {rider.is_active ? 'On Duty' : 'Off Duty'}
                        </button>
                      </td>

                      <td className="cell-right">
                        <div className="rf-row-actions">
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            title="Generate & send live mobile route manifest"
                            onClick={() => {
                              setManifestData(null);
                              setManifestTarget(rider);
                            }}
                          >
                            🔗 Manifest
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            title="Edit rider details or phone number"
                            onClick={() => openEditModal(rider)}
                          >
                            ✎ Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            style={{ color: '#f87171', borderColor: 'rgba(239, 68, 68, 0.35)' }}
                            title="Delete rider"
                            onClick={() =>
                              setDeleteTarget({
                                type: 'rider',
                                item: rider,
                                forceNeeded: activeStops > 0,
                                activeStops,
                              })
                            }
                          >
                            🗑
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Add / Edit Rider Modal ───────────────────────────────────── */}
      {modalOpen && (
        <div
          className="rf-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={editingRider ? 'Edit Dispatch Rider' : 'Add Dispatch Rider'}
          onClick={() => setModalOpen(false)}
        >
          <div className="rf-modal" onClick={e => e.stopPropagation()}>
            <div className="rf-modal-head">
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>
                  {editingRider ? `Edit Rider · ${editingRider.name}` : 'Add Dispatch Rider'}
                </h3>
                <p className="muted text-xs" style={{ marginTop: 3 }}>
                  Every rider requires a unique mobile / WhatsApp number so manifests and customer calls never collide.
                </p>
              </div>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setModalOpen(false)}>
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveRider}>
              <div className="rf-modal-body">
                {formError && (
                  <div className="alert alert-danger" style={{ marginBottom: 0 }}>
                    {formError}
                  </div>
                )}

                <div className="rf-form-grid">
                  <div>
                    <label htmlFor="rf-name">Rider Full Name *</label>
                    <input
                      id="rf-name"
                      type="text"
                      placeholder="e.g. Kwame Mensah"
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      required
                      autoFocus
                    />
                  </div>
                  <div>
                    <label htmlFor="rf-phone">Unique WhatsApp / Mobile # *</label>
                    <input
                      id="rf-phone"
                      type="tel"
                      placeholder="e.g. 024 812 3456"
                      value={form.phone}
                      onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                      required
                    />
                  </div>
                </div>

                <div className="rf-form-grid">
                  <div>
                    <label htmlFor="rf-vehicle">Vehicle Type</label>
                    <select
                      id="rf-vehicle"
                      value={form.vehicle_type}
                      onChange={e => setForm(f => ({ ...f, vehicle_type: e.target.value }))}
                    >
                      {VEHICLE_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="rf-plate">License Plate # (Optional)</label>
                    <input
                      id="rf-plate"
                      type="text"
                      placeholder="e.g. M-24-GR-4821"
                      value={form.vehicle_plate}
                      onChange={e => setForm(f => ({ ...f, vehicle_plate: e.target.value.toUpperCase() }))}
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="rf-zones">Primary Coverage Zones</label>
                  <input
                    id="rf-zones"
                    type="text"
                    placeholder="e.g. East Legon, Osu, Spintex"
                    value={form.zone_coverage}
                    onChange={e => setForm(f => ({ ...f, zone_coverage: e.target.value }))}
                  />
                  <div className="rf-zone-presets">
                    {GHANA_ZONE_PRESETS.map(zone => {
                      const selected = form.zone_coverage
                        .split(',')
                        .map(s => s.trim())
                        .includes(zone);
                      return (
                        <button
                          key={zone}
                          type="button"
                          className={`rf-zone-preset-btn${selected ? ' is-selected' : ''}`}
                          onClick={() => toggleZonePreset(zone)}
                        >
                          {selected ? '✓ ' : '+ '}{zone}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label htmlFor="rf-notes">Internal Dispatch Notes (Optional)</label>
                  <textarea
                    id="rf-notes"
                    rows={2}
                    placeholder="e.g. Shift hours 8am–6pm, MoMo settlement number, backup phone…"
                    value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  />
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.86rem' }}>
                  <input
                    type="checkbox"
                    checked={form.is_active}
                    onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
                  />
                  <span>Rider is currently <strong>On Duty</strong> (available in Order Dispatch quick-assign chips)</span>
                </label>
              </div>

              <div className="rf-modal-foot">
                <button type="button" className="btn btn-outline" onClick={() => setModalOpen(false)} disabled={saving}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-accent" disabled={saving}>
                  {saving ? 'Saving…' : editingRider ? 'Save Changes' : 'Add Rider to Fleet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Confirmation Modal ────────────────────────────────── */}
      {deleteTarget && (
        <div
          className="rf-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm Rider Removal"
          onClick={() => !deleting && setDeleteTarget(null)}
        >
          <div className="rf-modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div className="rf-modal-head">
              <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#f87171' }}>
                🗑 {deleteTarget.type === 'legacy_all'
                  ? 'Delete All Unregistered Test Riders?'
                  : `Delete "${deleteTarget.item?.name || deleteTarget.item?.delivery_partner}"?`}
              </h3>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
              >
                ✕
              </button>
            </div>

            <div className="rf-modal-body">
              {deleteTarget.activeStops > 0 ? (
                <div className="alert alert-danger" style={{ marginBottom: 0 }}>
                  <strong>{deleteTarget.activeStops} active in-transit order{deleteTarget.activeStops === 1 ? '' : 's'}</strong>{' '}
                  {deleteTarget.type === 'legacy_all' ? 'are assigned to unregistered riders.' : 'are currently assigned to this rider.'}
                  <div style={{ marginTop: 6 }}>
                    Confirming will move those open stops to <strong>In-house Dispatch Bike</strong> and permanently remove {deleteTarget.type === 'legacy_all' ? 'all unregistered test names' : 'this rider'}.
                  </div>
                </div>
              ) : (
                <p className="muted text-sm" style={{ margin: 0 }}>
                  {deleteTarget.type === 'legacy_all'
                    ? 'This will clear all unregistered/test rider names from historical delivery records so they no longer appear anywhere in Admin.'
                    : `This will permanently remove "${deleteTarget.item?.name || deleteTarget.item?.delivery_partner}" from your fleet and dispatch quick-select chips.`}
                </p>
              )}
            </div>

            <div className="rf-modal-foot">
              <button
                type="button"
                className="btn btn-outline"
                disabled={deleting}
                onClick={() => setDeleteTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ background: '#dc2626', borderColor: '#dc2626', color: '#fff' }}
                disabled={deleting}
                onClick={() => confirmDelete(Boolean(deleteTarget.activeStops > 0 || deleteTarget.forceNeeded))}
              >
                {deleting
                  ? 'Deleting…'
                  : deleteTarget.activeStops > 0
                    ? 'Reassign Open Stops & Delete'
                    : 'Yes, Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Rider Signed Route Manifest Share Modal ──────────────────── */}
      {manifestTarget && (
        <div
          className="rf-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Rider Route Manifest Link"
          onClick={() => setManifestTarget(null)}
        >
          <div className="rf-modal" onClick={e => e.stopPropagation()}>
            <div className="rf-modal-head">
              <div>
                <h3 style={{ margin: 0, fontSize: '1.08rem' }}>
                  🏍️ Route Manifest · {manifestTarget.name}
                </h3>
                <p className="muted text-xs" style={{ marginTop: 3 }}>
                  Signed mobile driver console link ({manifestTarget.phone || 'No phone'}) — no admin login needed.
                </p>
              </div>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setManifestTarget(null)}>
                ✕
              </button>
            </div>

            <div className="rf-modal-body">
              <div>
                <label>Link Validity Window</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 6 }}>
                  {[
                    { key: '24h', label: '24 Hours' },
                    { key: '3d',  label: '3 Days' },
                    { key: '7d',  label: '7 Days' },
                    { key: '14d', label: '14 Days' },
                  ].map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      className={`btn btn-sm ${manifestExpiry === opt.key ? 'btn-accent' : 'btn-outline'}`}
                      onClick={() => setManifestExpiry(opt.key)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span className="text-xs" style={{ fontWeight: 700 }}>
                    {manifestBusy
                      ? 'Generating signed link…'
                      : `${manifestData?.active_count ?? manifestTarget.active_stops ?? 0} Active Stop${(manifestData?.active_count ?? 0) === 1 ? '' : 's'} Assigned`}
                  </span>
                  <span className="badge badge-success">Valid {manifestExpiry.toUpperCase()}</span>
                </div>
                <input
                  type="text"
                  readOnly
                  className="rf-url-input"
                  value={manifestData?.manifest_url || 'Generating…'}
                  onFocus={e => e.target.select()}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={!manifestData?.manifest_url}
                  onClick={() => {
                    navigator.clipboard?.writeText(manifestData.manifest_url);
                    toast.success('Route manifest link copied');
                  }}
                >
                  📋 Copy Link
                </button>
                <a
                  href={manifestData?.manifest_url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-outline btn-sm"
                  style={{ textDecoration: 'none', textAlign: 'center', pointerEvents: manifestData?.manifest_url ? 'auto' : 'none' }}
                >
                  ↗ Open Console
                </a>
                <a
                  href={`https://wa.me/${toWhatsAppDigits(manifestTarget.phone)}?text=${encodeURIComponent(
                    `🏍️ *BodyCream GH Dispatch Manifest*\nRider: ${manifestTarget.name}\nActive Stops: ${manifestData?.active_count ?? 0}\n\nOpen your live route console:\n${manifestData?.manifest_url || ''}`
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-whatsapp btn-sm"
                  style={{ textDecoration: 'none', textAlign: 'center', pointerEvents: manifestData?.manifest_url ? 'auto' : 'none' }}
                >
                  💬 WhatsApp
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
