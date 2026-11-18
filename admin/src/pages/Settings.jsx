import { useEffect, useState } from 'react';
import { settingsAPI } from '../services/api';
import { useToast } from '../context/ToastContext';

/*
 Store-wide settings that don't fit under Storefront Editor or Theme.
 Currently: store identity, contact info, shipping fees, payment notices.
 These are all read by the backend/frontend via the same /api/settings endpoint.
*/

const GHANA_REGIONS = [
  'Greater Accra', 'Ashanti', 'Western', 'Western North',
  'Central', 'Eastern', 'Volta', 'Oti',
  'Northern', 'Savannah', 'North East', 'Upper East',
  'Upper West', 'Bono', 'Bono East', 'Ahafo',
];

const DEFAULTS = {
  store_name:     'BodyCream GH',
  store_email:    '',
  store_phone:    '',
  store_address:  '',
  store_region:   'Greater Accra',

  delivery_fee_flat:    15,
  delivery_fee_accra:   10,
  free_delivery_over:   200,
  delivery_estimate_accra:      '1–2 business days',
  delivery_estimate_nationwide: '3–5 business days',
  pickup_enabled:               true,
  pickup_location:              'East Legon, Accra (Call upon arrival)',
  pickup_hours:                 'Mon–Sat, 9:00 AM – 6:00 PM',

  low_stock_threshold: 5,

  paystack_public_key:          '',
  pay_on_delivery_enabled:      false,
  pay_on_delivery_accra_only:   true,
  whatsapp_number:              '',
  order_notification_email:     '',
};

const LOCAL_KEY = 'admin_settings_draft';

export default function Settings() {
  const toast = useToast();
  const [data, setData] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [dirty, setDirty]     = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data: remote } = await settingsAPI.getAll();
        setData({ ...DEFAULTS, ...remote });
      } catch {
        const cached = localStorage.getItem(LOCAL_KEY);
        if (cached) {
          try { setData({ ...DEFAULTS, ...JSON.parse(cached) }); } catch { /* ignore */ }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const update = (k, v) => { setData(p => ({ ...p, [k]: v })); setDirty(true); };

  const save = async () => {
    setSaving(true);
    try {
      const entries = Object.entries(data).map(([key, value]) => ({ key, value }));
      await settingsAPI.updateMany(entries);
      localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
      toast.success('Settings saved');
      setDirty(false);
    } catch {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(data));
      toast.error('Failed to save settings to server. Changes saved locally.');
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="spinner" />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="muted">Store identity, shipping, and payment configuration.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-accent" onClick={save} disabled={!dirty || saving}>
            {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
          </button>
        </div>
      </div>

      {dirty && <div className="alert alert-warning">You have unsaved changes.</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 800 }}>

        <div className="card">
          <div className="card-header"><h2 className="card-title">Store identity</h2></div>
          <div className="card-body">
            <div className="field">
              <label>Store name</label>
              <input value={data.store_name} onChange={e => update('store_name', e.target.value)} />
              <div className="hint">Appears in the navigation, footer, email templates, and browser tab.</div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Contact email</label>
                <input type="email" value={data.store_email} onChange={e => update('store_email', e.target.value)} placeholder="hello@yourstore.com" />
              </div>
              <div className="field">
                <label>Contact phone</label>
                <input type="tel" value={data.store_phone} onChange={e => update('store_phone', e.target.value)} placeholder="+233 XX XXX XXXX" />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Store address</label>
                <input value={data.store_address} onChange={e => update('store_address', e.target.value)} placeholder="Accra, Ghana" />
              </div>
              <div className="field">
                <label>Region</label>
                <select value={data.store_region} onChange={e => update('store_region', e.target.value)}>
                  {GHANA_REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h2 className="card-title">Shipping &amp; delivery</h2></div>
          <div className="card-body">
            <div className="field-row">
              <div className="field">
                <label>Accra delivery fee (GHS)</label>
                <input type="number" min="0" step="0.01" value={data.delivery_fee_accra} onChange={e => update('delivery_fee_accra', e.target.value)} />
              </div>
              <div className="field">
                <label>Nationwide delivery fee (GHS)</label>
                <input type="number" min="0" step="0.01" value={data.delivery_fee_flat} onChange={e => update('delivery_fee_flat', e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label>Free delivery threshold (GHS)</label>
              <input type="number" min="0" step="0.01" value={data.free_delivery_over} onChange={e => update('free_delivery_over', e.target.value)} />
              <div className="hint">Orders above this total ship for free. Set to 0 to disable.</div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Delivery estimate — Accra</label>
                <input
                  type="text"
                  value={data.delivery_estimate_accra}
                  onChange={e => update('delivery_estimate_accra', e.target.value)}
                  placeholder="1–2 business days"
                />
              </div>
              <div className="field">
                <label>Delivery estimate — Nationwide</label>
                <input
                  type="text"
                  value={data.delivery_estimate_nationwide}
                  onChange={e => update('delivery_estimate_nationwide', e.target.value)}
                  placeholder="3–5 business days"
                />
              </div>
            </div>
            <div className="field">
              <label>Low stock threshold (units)</label>
              <input
                type="number"
                min="1"
                value={data.low_stock_threshold}
                onChange={e => update('low_stock_threshold', Number(e.target.value) || 5)}
              />
              <div className="hint">Products at or below this quantity show a "low stock" warning to customers.</div>
            </div>

            <div style={{ borderTop: '1px solid var(--ac-border)', paddingTop: 14, marginTop: 14 }}>
              <div className="field" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  id="pickup_enabled"
                  type="checkbox"
                  checked={Boolean(data.pickup_enabled)}
                  onChange={e => update('pickup_enabled', e.target.checked)}
                  style={{ width: 'auto' }}
                />
                <label htmlFor="pickup_enabled" style={{ margin: 0, cursor: 'pointer' }}>
                  Enable Store Pickup Station (GHS 0.00 fee)
                </label>
              </div>
              <div className="field-row">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Pickup station address</label>
                  <input
                    type="text"
                    value={data.pickup_location}
                    onChange={e => update('pickup_location', e.target.value)}
                    placeholder="East Legon, Accra (Call upon arrival)"
                  />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Pickup hours</label>
                  <input
                    type="text"
                    value={data.pickup_hours}
                    onChange={e => update('pickup_hours', e.target.value)}
                    placeholder="Mon–Sat, 9:00 AM – 6:00 PM"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h2 className="card-title">Payments</h2></div>
          <div className="card-body">
            <div className="field">
              <label>Paystack public key</label>
              <input
                type="text"
                value={data.paystack_public_key}
                onChange={e => update('paystack_public_key', e.target.value)}
                placeholder="pk_live_xxxxxxxxxxxxx"
                style={{ fontFamily: 'SF Mono, Menlo, monospace' }}
              />
              <div className="hint">
                Used by the storefront for card/MoMo payments. Find it in your{' '}
                <a href="https://dashboard.paystack.com/#/settings/developers" target="_blank" rel="noreferrer">Paystack dashboard</a>.
                {' '}The secret key lives only on the backend in <code>.env</code>.
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--ac-border)', paddingTop: 14, marginTop: 14 }}>
              <div className="field" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  id="pay_on_delivery_enabled"
                  type="checkbox"
                  checked={Boolean(data.pay_on_delivery_enabled)}
                  onChange={e => update('pay_on_delivery_enabled', e.target.checked)}
                  style={{ width: 'auto' }}
                />
                <label htmlFor="pay_on_delivery_enabled" style={{ margin: 0, cursor: 'pointer' }}>
                  Enable Pay on Delivery / Pay on Pickup (Cash or MoMo on arrival)
                </label>
              </div>
              <div className="field" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 0 }}>
                <input
                  id="pay_on_delivery_accra_only"
                  type="checkbox"
                  checked={Boolean(data.pay_on_delivery_accra_only)}
                  onChange={e => update('pay_on_delivery_accra_only', e.target.checked)}
                  style={{ width: 'auto' }}
                />
                <label htmlFor="pay_on_delivery_accra_only" style={{ margin: 0, cursor: 'pointer' }}>
                  Restrict Pay on Delivery to Greater Accra &amp; Store Pickup only
                </label>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><h2 className="card-title">Customer support</h2></div>
          <div className="card-body">
            <div className="field">
              <label>WhatsApp number</label>
              <input
                type="tel"
                value={data.whatsapp_number}
                onChange={e => update('whatsapp_number', e.target.value)}
                placeholder="233XXXXXXXXX (no +)"
              />
              <div className="hint">Powers the WhatsApp contact link in the footer.</div>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Order notification email</label>
              <input
                type="email"
                value={data.order_notification_email}
                onChange={e => update('order_notification_email', e.target.value)}
                placeholder="orders@yourstore.com"
              />
              <div className="hint">Where new-order alerts are sent. Can be the same as contact email.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
