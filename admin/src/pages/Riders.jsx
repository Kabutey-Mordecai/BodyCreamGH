import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { deliveriesAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import StatCard from '../components/StatCard';
import SearchInput from '../components/SearchInput';
import Modal from '../components/Modal';
import './Riders.css';

const VEHICLE_OPTIONS = [
  { value: 'motorbike', label: 'Motorbike' },
  { value: 'van',       label: 'Delivery Van' },
  { value: 'car',       label: 'Sedan / SUV' },
  { value: 'bicycle',   label: 'Cargo Bike' },
  { value: 'courier',   label: '3rd-Party Courier' },
];

const VEHICLE_LABELS = {
  motorbike: 'Motorbike',
  van:       'Van',
  car:       'Car',
  bicycle:   'Bike',
  courier:   'Courier',
};

const GHANA_ZONE_PRESETS = [
  'Accra Central',
  'East Legon & Airport',
  'Osu & Labone',
  'Spintex & Tema',
  'Madina & Adenta',
  'Dansoman & Kasoa',
  'Kumasi Metro',
  'Nationwide',
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
  const [searchParams] = useSearchParams();

  const [riders, setRiders] = useState([]);
  const [legacyPartners, setLegacyPartners] = useState([]);
  const [unassignedPoolStops, setUnassignedPoolStops] = useState(0);
  const [legacyExpanded, setLegacyExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState(() => searchParams.get('q') || '');

  // Add / Edit Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRider, setEditingRider] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Delete Modal
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Route Manifest Modal
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
      setUnassignedPoolStops(Number(data?.unassigned_pool_stops || 0));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load dispatch riders');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadRiders();
  }, [loadRiders]);

  const legacyPhoneCounts = useMemo(() => {
    const map = {};
    legacyPartners.forEach(lp => {
      const key = toWhatsAppDigits(lp.driver_phone);
      if (key) map[key] = (map[key] || 0) + 1;
    });
    return map;
  }, [legacyPartners]);

  const kpis = useMemo(() => {
    const onDuty = riders.filter(r => r.is_active).length;
    const activeStops = riders.reduce((sum, r) => sum + Number(r.active_stops || 0), 0);
    const codPending = riders.reduce((sum, r) => sum + Number(r.cod_pending_ghs || 0), 0);
    const completedToday = riders.reduce((sum, r) => sum + Number(r.completed_today || 0), 0);
    return { onDuty, total: riders.length, activeStops, codPending, completedToday };
  }, [riders]);

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

  const openCreateModal = (prefill = null) => {
    setEditingRider(null);
    setFormError('');
    setForm({ ...EMPTY_FORM, ...(prefill || {}) });
    setModalOpen(true);
  };

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
    const existing = form.zone_coverage.split(',').map(s => s.trim()).filter(Boolean);
    const next = existing.includes(zone) ? existing.filter(z => z !== zone) : [...existing, zone];
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
      setFormError('A unique mobile or WhatsApp number is required for each rider.');
      return;
    }

    setSaving(true);
    try {
      if (editingRider) {
        await deliveriesAPI.updateRider(editingRider.id, form);
        toast.success(`Updated ${form.name.trim()}`);
      } else {
        await deliveriesAPI.createRider(form);
        toast.success(`Added ${form.name.trim()} to fleet`);
      }
      setModalOpen(false);
      loadRiders(true);
    } catch (err) {
      setFormError(err.response?.data?.error || 'Could not save rider');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleDuty = async (rider) => {
    try {
      await deliveriesAPI.updateRider(rider.id, { is_active: !rider.is_active });
      toast.success(`${rider.name} marked ${!rider.is_active ? 'On duty' : 'Off duty'}`);
      loadRiders(true);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update status');
    }
  };

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
        toast.success(data?.message || 'Cleared unregistered rider names');
      }
      setDeleteTarget(null);
      loadRiders(true);
    } catch (err) {
      if (err.response?.status === 409 && err.response?.data?.requires_force) {
        setDeleteTarget(prev => ({
          ...prev,
          forceNeeded: true,
          activeStops: err.response.data.active_stops,
        }));
      } else {
        toast.error(err.response?.data?.error || 'Delete failed');
        setDeleteTarget(null);
      }
    } finally {
      setDeleting(false);
    }
  };

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
    return () => { cancelled = true; };
  }, [manifestTarget, manifestExpiry, toast]);

  return (
    <div>
      {/* ── Page Header ──────────────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1>Riders &amp; Fleet</h1>
          <p className="muted">
            Manage dispatch riders, unique WhatsApp numbers, route links, and COD balances.
          </p>
        </div>
        <div className="page-actions">
          <Link to="/orders" className="btn btn-outline">
            Orders Queue
          </Link>
          <button type="button" className="btn btn-outline" onClick={() => loadRiders()}>
            Refresh
          </button>
          <button type="button" className="btn btn-primary" onClick={() => openCreateModal()}>
            + Add Rider
          </button>
        </div>
      </div>

      {/* ── KPI Strip ────────────────────────────────────────────────── */}
      <div className="stats-grid">
        <StatCard
          label="Active Fleet"
          value={`${kpis.onDuty} / ${kpis.total}`}
          sub="On-duty registered riders"
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="1" y="4" width="14" height="12" rx="1.5" />
              <path d="M15 8h4l4 4v4h-8V8z" />
              <circle cx="5.5" cy="18.5" r="2.2" />
              <circle cx="18.5" cy="18.5" r="2.2" />
            </svg>
          }
        />
        <StatCard
          label="Stops on Road"
          value={kpis.activeStops}
          sub="In transit awaiting OTP"
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
          }
        />
        <StatCard
          label="COD With Riders"
          value={fmtGhs(kpis.codPending)}
          sub="Unsettled Pay-on-Delivery"
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
            </svg>
          }
        />
        <StatCard
          label="Verified Today"
          value={kpis.completedToday}
          sub="Completed handoffs today"
          icon={
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          }
        />
      </div>

      {/* ── Unassigned In-House Pool Callout ─────────────────────────── */}
      {unassignedPoolStops > 0 && (
        <div className="rf-legacy-strip" style={{ borderLeftColor: 'var(--ac-accent)' }}>
          <div className="rf-legacy-bar">
            <div className="rf-legacy-summary">
              <span className="rf-legacy-dot" style={{ background: 'var(--ac-accent)' }} aria-hidden="true" />
              <span>
                <strong>{unassignedPoolStops} shipped order{unassignedPoolStops === 1 ? '' : 's'}</strong> currently in the general In-house Bike pool (not yet assigned to a named rider)
              </span>
            </div>
            <Link to="/orders" className="btn btn-outline btn-sm">
              Assign in Orders →
            </Link>
          </div>
        </div>
      )}

      {/* ── Compact Collapsible Unregistered Names Cleanup Bar ───────── */}
      {legacyPartners.length > 0 && (
        <div className="rf-legacy-strip">
          <div className="rf-legacy-bar">
            <div className="rf-legacy-summary">
              <span className="rf-legacy-dot" aria-hidden="true" />
              <span>
                <strong>{legacyPartners.length} unregistered rider name{legacyPartners.length === 1 ? '' : 's'}</strong> found on older orders
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setLegacyExpanded(v => !v)}
              >
                {legacyExpanded ? 'Hide list' : 'Review & import'}
              </button>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                style={{ color: 'var(--ac-danger)', borderColor: 'var(--ac-border-strong)' }}
                onClick={() =>
                  setDeleteTarget({
                    type: 'legacy_all',
                    forceNeeded: legacyPartners.some(lp => lp.active_stops > 0),
                    activeStops: legacyPartners.reduce((s, lp) => s + Number(lp.active_stops || 0), 0),
                  })
                }
              >
                Clear all ({legacyPartners.length})
              </button>
            </div>
          </div>

          {legacyExpanded && (
            <div className="rf-legacy-drawer">
              {legacyPartners.map(lp => {
                const normKey = toWhatsAppDigits(lp.driver_phone);
                const isSharedPhone = normKey && legacyPhoneCounts[normKey] > 1;
                return (
                  <div key={lp.delivery_partner} className="rf-legacy-item">
                    <div style={{ minWidth: 0 }}>
                      <div className="rf-legacy-name" title={lp.delivery_partner}>
                        {lp.delivery_partner}
                      </div>
                      <div className="rf-legacy-meta">
                        <span>{lp.driver_phone || 'No phone'}</span>
                        {isSharedPhone && <span className="rf-dup-tag">Duplicate #</span>}
                        <span>· {lp.active_stops} active</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() =>
                          openCreateModal({
                            name: lp.delivery_partner,
                            phone: isSharedPhone ? '' : (lp.driver_phone || ''),
                          })
                        }
                      >
                        Import
                      </button>
                      <button
                        type="button"
                        className="rf-icon-danger"
                        title={`Remove ${lp.delivery_partner}`}
                        aria-label={`Remove ${lp.delivery_partner}`}
                        onClick={() =>
                          setDeleteTarget({
                            type: 'legacy',
                            item: lp,
                            forceNeeded: lp.active_stops > 0,
                            activeStops: lp.active_stops,
                          })
                        }
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m5 0V4a1 1 0 011-1h2a1 1 0 011 1v2" />
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Main Fleet Card ──────────────────────────────────────────── */}
      <div className="card">
        <div className="rf-filter-bar">
          <div className="rf-seg-tabs" role="tablist">
            {[
              { key: 'all',      label: 'All',          count: riders.length },
              { key: 'on_duty',  label: 'On duty',      count: riders.filter(r => r.is_active).length },
              { key: 'on_route', label: 'Out on route', count: riders.filter(r => Number(r.active_stops || 0) > 0).length },
              { key: 'off_duty', label: 'Off duty',     count: riders.filter(r => !r.is_active).length },
            ].map(t => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                className={`rf-seg-tab${tab === t.key ? ' is-active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                <span>{t.label}</span>
                <span className="rf-seg-count">{t.count}</span>
              </button>
            ))}
          </div>

          <div style={{ minWidth: 260 }}>
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search rider, phone, plate, or zone…"
            />
          </div>
        </div>

        {loading ? (
          <div style={{ padding: '48px 24px', textAlign: 'center' }} className="muted">
            Loading riders…
          </div>
        ) : filteredRiders.length === 0 ? (
          <div style={{ padding: '56px 24px', textAlign: 'center' }}>
            <h3 style={{ marginBottom: 6 }}>
              {riders.length === 0 ? 'No riders registered yet' : 'No matching riders'}
            </h3>
            <p className="muted" style={{ maxWidth: 420, margin: '0 auto 18px', fontSize: '0.86rem' }}>
              {riders.length === 0
                ? 'Add your dispatch riders with their unique mobile numbers to assign orders and share route links.'
                : 'Try adjusting your search or switching status filters.'}
            </p>
            {riders.length === 0 && (
              <button type="button" className="btn btn-primary" onClick={() => openCreateModal()}>
                + Add First Rider
              </button>
            )}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Rider</th>
                  <th>Phone</th>
                  <th>Coverage Zones</th>
                  <th>Deliveries</th>
                  <th>COD Held</th>
                  <th>Status</th>
                  <th className="cell-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRiders.map(rider => {
                  const waDigits = toWhatsAppDigits(rider.phone);
                  const zones = (rider.zone_coverage || '').split(',').map(s => s.trim()).filter(Boolean);
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
                            <div style={{ fontWeight: 600 }}>{rider.name}</div>
                            <div className="rf-sub-meta">
                              <span>{VEHICLE_LABELS[rider.vehicle_type] || 'Motorbike'}</span>
                              {rider.vehicle_plate && (
                                <span className="rf-plate">{rider.vehicle_plate}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td>
                        <div className="rf-phone-num">{rider.phone || '—'}</div>
                        {waDigits && (
                          <div className="rf-inline-links">
                            <a
                              href={`https://wa.me/${waDigits}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="rf-text-link rf-text-link--wa"
                            >
                              WhatsApp
                            </a>
                            <a href={`tel:${rider.phone}`} className="rf-text-link">
                              Call
                            </a>
                          </div>
                        )}
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
                          <span className="muted text-xs">All areas</span>
                        )}
                      </td>

                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          {activeStops > 0 ? (
                            <span className="badge badge-info" style={{ width: 'fit-content' }}>
                              {activeStops} active
                            </span>
                          ) : (
                            <span className="muted text-xs">Idle</span>
                          )}
                          <span className="muted text-xs">
                            {rider.completed_today || 0} today · {rider.total_completed || 0} total
                          </span>
                        </div>
                      </td>

                      <td>
                        <span style={{ fontWeight: codHeld > 0 ? 600 : 400, color: codHeld > 0 ? 'var(--ac-warning)' : 'var(--ac-text-muted)', fontSize: '0.85rem' }}>
                          {fmtGhs(codHeld)}
                        </span>
                      </td>

                      <td>
                        <button
                          type="button"
                          className={`rf-duty-btn ${rider.is_active ? 'is-on' : 'is-off'}`}
                          onClick={() => handleToggleDuty(rider)}
                          title="Toggle duty status"
                        >
                          <span className="rf-duty-dot" />
                          {rider.is_active ? 'On duty' : 'Off duty'}
                        </button>
                      </td>

                      <td className="cell-right">
                        <div className="rf-row-actions">
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            onClick={() => {
                              setManifestData(null);
                              setManifestTarget(rider);
                            }}
                          >
                            Route link
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            onClick={() => openEditModal(rider)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="rf-icon-danger"
                            title={`Delete ${rider.name}`}
                            aria-label={`Delete ${rider.name}`}
                            onClick={() =>
                              setDeleteTarget({
                                type: 'rider',
                                item: rider,
                                forceNeeded: activeStops > 0,
                                activeStops,
                              })
                            }
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m5 0V4a1 1 0 011-1h2a1 1 0 011 1v2" />
                            </svg>
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
      <Modal
        open={modalOpen}
        onClose={() => !saving && setModalOpen(false)}
        title={editingRider ? `Edit rider · ${editingRider.name}` : 'Add dispatch rider'}
        size="md"
        footer={
          <>
            <button type="button" className="btn btn-outline" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </button>
            <button type="submit" form="rider-form" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : editingRider ? 'Save changes' : 'Add rider'}
            </button>
          </>
        }
      >
        <form id="rider-form" onSubmit={handleSaveRider}>
          {formError && (
            <div className="alert alert-error" style={{ marginBottom: 14 }}>
              {formError}
            </div>
          )}

          <div className="field-row">
            <div className="field">
              <label htmlFor="rf-name">Full name *</label>
              <input
                id="rf-name"
                type="text"
                placeholder="e.g. Kwame Mensah"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="rf-phone">Unique mobile / WhatsApp *</label>
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

          <div className="field-row">
            <div className="field">
              <label htmlFor="rf-vehicle">Vehicle type</label>
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
            <div className="field">
              <label htmlFor="rf-plate">License plate (optional)</label>
              <input
                id="rf-plate"
                type="text"
                placeholder="e.g. M-24-GR-4821"
                value={form.vehicle_plate}
                onChange={e => setForm(f => ({ ...f, vehicle_plate: e.target.value.toUpperCase() }))}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="rf-zones">Coverage zones</label>
            <input
              id="rf-zones"
              type="text"
              placeholder="e.g. East Legon, Osu, Spintex"
              value={form.zone_coverage}
              onChange={e => setForm(f => ({ ...f, zone_coverage: e.target.value }))}
            />
            <div className="rf-zone-presets">
              {GHANA_ZONE_PRESETS.map(zone => {
                const selected = form.zone_coverage.split(',').map(s => s.trim()).includes(zone);
                return (
                  <button
                    key={zone}
                    type="button"
                    className={`rf-zone-preset-btn${selected ? ' is-selected' : ''}`}
                    onClick={() => toggleZonePreset(zone)}
                  >
                    {zone}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="field">
            <label htmlFor="rf-notes">Notes (optional)</label>
            <textarea
              id="rf-notes"
              rows={2}
              placeholder="Shift hours, MoMo settlement number, or internal notes…"
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.84rem', color: 'var(--ac-text)' }}>
            <input
              type="checkbox"
              style={{ width: 'auto', minHeight: 'auto' }}
              checked={form.is_active}
              onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
            />
            <span>Available on duty for order dispatch</span>
          </label>
        </form>
      </Modal>

      {/* ── Delete Confirmation Modal ────────────────────────────────── */}
      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => !deleting && setDeleteTarget(null)}
        title={
          deleteTarget?.type === 'legacy_all'
            ? 'Clear unregistered rider names'
            : `Delete ${deleteTarget?.item?.name || deleteTarget?.item?.delivery_partner || 'rider'}`
        }
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-outline" disabled={deleting} onClick={() => setDeleteTarget(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={deleting}
              onClick={() => confirmDelete(Boolean(deleteTarget?.activeStops > 0 || deleteTarget?.forceNeeded))}
            >
              {deleting
                ? 'Deleting…'
                : deleteTarget?.activeStops > 0
                  ? 'Reassign & delete'
                  : 'Delete'}
            </button>
          </>
        }
      >
        {deleteTarget?.activeStops > 0 ? (
          <div className="alert alert-warning" style={{ marginBottom: 0 }}>
            <strong>{deleteTarget.activeStops} active order{deleteTarget.activeStops === 1 ? '' : 's'}</strong> currently assigned. Confirming will move open stops to <strong>In-house Dispatch Bike</strong> and remove this entry.
          </div>
        ) : (
          <p className="muted" style={{ fontSize: '0.86rem' }}>
            {deleteTarget?.type === 'legacy_all'
              ? 'This clears all unregistered historical names so they no longer appear in dispatch suggestions.'
              : `Permanently remove "${deleteTarget?.item?.name || deleteTarget?.item?.delivery_partner}" from your fleet directory?`}
          </p>
        )}
      </Modal>

      {/* ── Route Manifest Modal ─────────────────────────────────────── */}
      <Modal
        open={Boolean(manifestTarget)}
        onClose={() => setManifestTarget(null)}
        title={manifestTarget ? `Route manifest · ${manifestTarget.name}` : 'Route manifest'}
        size="md"
        footer={
          <button type="button" className="btn btn-outline" onClick={() => setManifestTarget(null)}>
            Done
          </button>
        }
      >
        {manifestTarget && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Link validity</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {[
                  { key: '24h', label: '24 hours' },
                  { key: '3d',  label: '3 days' },
                  { key: '7d',  label: '7 days' },
                  { key: '14d', label: '14 days' },
                ].map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    className={`btn btn-sm ${manifestExpiry === opt.key ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => setManifestExpiry(opt.key)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="field" style={{ marginBottom: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <label style={{ marginBottom: 0 }}>
                  {manifestBusy
                    ? 'Generating signed URL…'
                    : `${manifestData?.active_count ?? manifestTarget.active_stops ?? 0} active stop${(manifestData?.active_count ?? 0) === 1 ? '' : 's'}`}
                </label>
                <span className="muted text-xs">{manifestTarget.phone || 'No phone'}</span>
              </div>
              <input
                type="text"
                readOnly
                style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}
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
                  toast.success('Route link copied');
                }}
              >
                Copy link
              </button>
              <a
                href={manifestData?.manifest_url || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-outline btn-sm"
                style={{ pointerEvents: manifestData?.manifest_url ? 'auto' : 'none' }}
              >
                Open console ↗
              </a>
              <a
                href={`https://wa.me/${toWhatsAppDigits(manifestTarget.phone)}?text=${encodeURIComponent(
                  `BodyCream GH Dispatch Route\nRider: ${manifestTarget.name}\nActive Stops: ${manifestData?.active_count ?? 0}\n\nOpen route console:\n${manifestData?.manifest_url || ''}`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary btn-sm"
                style={{ pointerEvents: manifestData?.manifest_url ? 'auto' : 'none' }}
              >
                Send WhatsApp
              </a>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
