import { useState, useEffect, useCallback, useMemo } from 'react';
import { variantsAPI } from '../services/api';
import { useToast } from '../context/ToastContext';

// Cartesian product of arrays of option values
function cartesian(arrays) {
  if (arrays.length === 0) return [];
  return arrays.reduce(
    (acc, arr) => acc.flatMap(a => arr.map(b => [...a, b])), [[]]
  );
}

// Stable key for a variant combination — sorted option value IDs joined
function comboKey(combo) {
  return combo.map(v => v.id).sort().join('|');
}

const EMPTY_ROW = { price: '', compare_at_price: '', sku: '', stock_quantity: '0' };

export default function VariantManager({ productId }) {
  const toast = useToast();

  const [data, setData] = useState({ option_types: [], variants: [] });
  const [loading, setLoading] = useState(false);

  // Add-option-type form
  const [showAddType, setShowAddType] = useState(false);
  const [typeName, setTypeName]       = useState('');
  const [typeValues, setTypeValues]   = useState([]);
  const [typeInput, setTypeInput]     = useState('');
  const [savingType, setSavingType]   = useState(false);

  // Per-row edits keyed by comboKey
  const [rowEdits, setRowEdits]   = useState({});
  const [rowSaving, setRowSaving] = useState({});

  const load = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    try {
      const { data: d } = await variantsAPI.getByProduct(productId);
      setData(d);
      // Seed row-edit state from saved variants
      const edits = {};
      d.variants.forEach(v => {
        const key = v.option_values.map(ov => ov.option_value_id).sort().join('|');
        edits[key] = {
          price:            String(v.price),
          compare_at_price: v.compare_at_price ? String(v.compare_at_price) : '',
          sku:              v.sku || '',
          stock_quantity:   String(v.stock_quantity),
        };
      });
      setRowEdits(edits);
    } catch {
      toast.error('Failed to load variants');
    } finally {
      setLoading(false);
    }
  }, [productId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  // All option-value combinations from current option types
  const combinations = useMemo(() => {
    const valueArrays = data.option_types.map(t =>
      (t.values || []).filter(Boolean)
    );
    if (valueArrays.length === 0 || valueArrays.some(a => a.length === 0)) return [];
    return cartesian(valueArrays);
  }, [data.option_types]);

  // Map comboKey → existing saved variant
  const existingByKey = useMemo(() => {
    const map = {};
    data.variants.forEach(v => {
      const key = v.option_values.map(ov => ov.option_value_id).sort().join('|');
      map[key] = v;
    });
    return map;
  }, [data.variants]);

  // ── Add option type helpers ──────────────────────────────────────────────────
  const commitTypeInput = () => {
    const val = typeInput.trim();
    if (val && !typeValues.includes(val)) {
      setTypeValues(prev => [...prev, val]);
    }
    setTypeInput('');
  };

  const handleTypeInputKeyDown = (e) => {
    if (e.key === 'Enter' && !e.nativeEvent?.isComposing) { e.preventDefault(); commitTypeInput(); }
    if (e.key === ',' )    { e.preventDefault(); commitTypeInput(); }
    if (e.key === 'Backspace' && !typeInput && typeValues.length) {
      setTypeValues(prev => prev.slice(0, -1));
    }
  };

  const handleTypeInputChange = (e) => {
    const val = e.target.value;
    if (val.endsWith(',')) {
      const trimmed = val.slice(0, -1).trim();
      if (trimmed && !typeValues.includes(trimmed)) setTypeValues(prev => [...prev, trimmed]);
      setTypeInput('');
    } else {
      setTypeInput(val);
    }
  };

  const handleAddOptionType = async () => {
    if (!typeName.trim()) return;
    const finalValues = [...typeValues];
    if (typeInput.trim() && !finalValues.includes(typeInput.trim())) {
      finalValues.push(typeInput.trim());
    }
    if (finalValues.length === 0) {
      toast.error('Add at least one value');
      return;
    }
    setSavingType(true);
    try {
      const { data: newType } = await variantsAPI.createOptionType(productId, {
        name:     typeName.trim(),
        position: data.option_types.length,
      });
      for (let i = 0; i < finalValues.length; i++) {
        await variantsAPI.createOptionValue(productId, newType.id, { value: finalValues[i], position: i });
      }
      toast.success(`"${typeName.trim()}" option added`);
      setTypeName('');
      setTypeValues([]);
      setTypeInput('');
      setShowAddType(false);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add option');
    } finally {
      setSavingType(false);
    }
  };

  const handleDeleteOptionType = async (typeId, typeName) => {
    if (!window.confirm(`Delete option "${typeName}"? All variants using it will also be removed.`)) return;
    try {
      await variantsAPI.deleteOptionType(productId, typeId);
      toast.success('Option deleted');
      await load();
    } catch {
      toast.error('Failed to delete option');
    }
  };

  // ── Variant row helpers ──────────────────────────────────────────────────────
  const updRow = (key, field, val) => {
    setRowEdits(prev => ({
      ...prev,
      [key]: { ...(prev[key] || EMPTY_ROW), [field]: val },
    }));
  };

  const handleSaveRow = async (combo) => {
    const key   = comboKey(combo);
    const edits = rowEdits[key] || EMPTY_ROW;
    if (!edits.price || isNaN(Number(edits.price))) {
      toast.error('Price is required');
      return;
    }
    const existing = existingByKey[key];
    const payload  = {
      price:            Number(edits.price),
      compare_at_price: edits.compare_at_price ? Number(edits.compare_at_price) : null,
      sku:              edits.sku || null,
      stock_quantity:   Number(edits.stock_quantity) || 0,
      option_value_ids: combo.map(v => v.id),
    };
    setRowSaving(prev => ({ ...prev, [key]: true }));
    try {
      if (existing) {
        await variantsAPI.update(productId, existing.id, payload);
      } else {
        await variantsAPI.create(productId, payload);
      }
      toast.success('Variant saved');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    } finally {
      setRowSaving(prev => ({ ...prev, [key]: false }));
    }
  };

  const handleToggleVariant = async (combo) => {
    const key      = comboKey(combo);
    const existing = existingByKey[key];
    if (!existing) return;
    try {
      await variantsAPI.update(productId, existing.id, {
        ...rowEdits[key] && {
          price:          Number(rowEdits[key].price) || existing.price,
          stock_quantity: Number(rowEdits[key].stock_quantity) || 0,
        },
        is_active:        !existing.is_active,
        option_value_ids: combo.map(v => v.id),
      });
      toast.success(existing.is_active ? 'Variant disabled' : 'Variant enabled');
      await load();
    } catch {
      toast.error('Failed to toggle variant');
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  if (loading) return <div className="spinner" style={{ margin: '24px auto' }} />;

  return (
    <div>
      {/* ── Option types ──────────────────────────────── */}
      <div style={{ marginBottom: 16 }}>
        {data.option_types.map(t => (
          <div key={t.id} style={{
            background: 'var(--ac-bg)',
            border: '1px solid var(--ac-border)',
            borderRadius: 8,
            padding: '10px 14px',
            marginBottom: 8,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: 6 }}>{t.name}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {(t.values || []).map(v => (
                  <span key={v.id} style={{
                    background: 'var(--ac-surface)',
                    border: '1px solid var(--ac-border)',
                    borderRadius: 99,
                    padding: '2px 10px',
                    fontSize: '0.8rem',
                  }}>
                    {v.value}
                  </span>
                ))}
              </div>
            </div>
            <button
              className="btn btn-outline btn-sm"
              style={{ color: 'var(--ac-danger)', borderColor: 'var(--ac-danger)', flexShrink: 0 }}
              onClick={() => handleDeleteOptionType(t.id, t.name)}
            >
              Delete option
            </button>
          </div>
        ))}

        {!showAddType ? (
          <button className="btn btn-outline btn-sm" onClick={() => setShowAddType(true)}>
            + Add option
          </button>
        ) : (
          <div style={{
            background: 'var(--ac-bg)',
            border: '1px solid var(--ac-border)',
            borderRadius: 8,
            padding: 14,
          }}>
            <div className="field" style={{ marginBottom: 10 }}>
              <label>Option name</label>
              <input
                type="text"
                value={typeName}
                onChange={e => setTypeName(e.target.value)}
                placeholder="e.g. Size, Scent, Bundle"
                autoFocus
              />
            </div>
            <div className="field" style={{ marginBottom: 12 }}>
              <label>Values</label>
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 5,
                border: '1px solid var(--ac-border)',
                borderRadius: 6,
                padding: '6px 8px',
                minHeight: 38,
                alignItems: 'center',
                cursor: 'text',
              }}
                onClick={e => e.currentTarget.querySelector('input')?.focus()}
              >
                {typeValues.map((v, i) => (
                  <span key={i} style={{
                    background: 'var(--ac-accent)',
                    color: '#fff',
                    borderRadius: 99,
                    padding: '1px 8px',
                    fontSize: '0.8rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}>
                    {v}
                    <button
                      type="button"
                      onClick={() => setTypeValues(prev => prev.filter((_, j) => j !== i))}
                      style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, lineHeight: 1, fontSize: '0.9rem' }}
                    >×</button>
                  </span>
                ))}
                <input
                  type="text"
                  value={typeInput}
                  onChange={handleTypeInputChange}
                  onKeyDown={handleTypeInputKeyDown}
                  placeholder={typeValues.length === 0 ? 'Type a value, press Enter' : ''}
                  style={{ border: 'none', outline: 'none', background: 'transparent', flexGrow: 1, minWidth: 80, fontSize: '0.88rem' }}
                />
              </div>
              <div className="hint">Press Enter or comma to add each value.</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-accent btn-sm"
                onClick={handleAddOptionType}
                disabled={savingType || !typeName.trim()}
              >
                {savingType ? 'Saving…' : 'Add option'}
              </button>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => { setShowAddType(false); setTypeName(''); setTypeValues([]); setTypeInput(''); }}
                disabled={savingType}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Variant table ─────────────────────────────── */}
      {combinations.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--ac-border)' }}>
                <th style={th}>Variant</th>
                <th style={th}>Price (GHS) *</th>
                <th style={th}>Was (GHS)</th>
                <th style={th}>SKU</th>
                <th style={th}>Stock</th>
                <th style={th}>Status</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {combinations.map(combo => {
                const key      = comboKey(combo);
                const existing = existingByKey[key];
                const edits    = rowEdits[key] || EMPTY_ROW;
                const isSaving = rowSaving[key];
                const label    = combo.map(v => v.value).join(' / ');
                return (
                  <tr key={key} style={{ borderBottom: '1px solid var(--ac-border)', opacity: existing && !existing.is_active ? 0.6 : 1 }}>
                    <td style={td}>
                      <span style={{ fontWeight: 500 }}>{label}</span>
                    </td>
                    <td style={td}>
                      <input
                        type="number" min="0" step="0.01"
                        value={edits.price}
                        onChange={e => updRow(key, 'price', e.target.value)}
                        style={inputStyle}
                        placeholder="0.00"
                      />
                    </td>
                    <td style={td}>
                      <input
                        type="number" min="0" step="0.01"
                        value={edits.compare_at_price}
                        onChange={e => updRow(key, 'compare_at_price', e.target.value)}
                        style={inputStyle}
                        placeholder="—"
                      />
                    </td>
                    <td style={td}>
                      <input
                        type="text"
                        value={edits.sku}
                        onChange={e => updRow(key, 'sku', e.target.value)}
                        style={{ ...inputStyle, fontFamily: 'monospace' }}
                        placeholder="SKU"
                      />
                    </td>
                    <td style={td}>
                      <input
                        type="number" min="0" step="1"
                        value={edits.stock_quantity}
                        onChange={e => updRow(key, 'stock_quantity', e.target.value)}
                        style={{ ...inputStyle, width: 64 }}
                      />
                    </td>
                    <td style={td}>
                      {existing ? (
                        <span style={{
                          padding: '2px 9px',
                          borderRadius: 99,
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          letterSpacing: '0.06em',
                          textTransform: 'uppercase',
                          background: existing.is_active
                            ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                          color: existing.is_active ? '#16a34a' : '#dc2626',
                        }}>
                          {existing.is_active ? 'Active' : 'Disabled'}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--ac-muted)', fontSize: '0.78rem' }}>Not saved</span>
                      )}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          className="btn btn-accent btn-sm"
                          onClick={() => handleSaveRow(combo)}
                          disabled={isSaving}
                        >
                          {isSaving ? '…' : existing ? 'Update' : 'Save'}
                        </button>
                        {existing && (
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => handleToggleVariant(combo)}
                          >
                            {existing.is_active ? 'Disable' : 'Enable'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data.option_types.length > 0 && combinations.length === 0 && (
        <div className="alert alert-info" style={{ marginTop: 8 }}>
          Add at least one value to each option to generate the variant table.
        </div>
      )}

      {data.option_types.length === 0 && (
        <div className="hint" style={{ marginTop: 4 }}>
          Add options above (e.g. Size, Scent) to generate variants automatically.
        </div>
      )}
    </div>
  );
}

const th = { textAlign: 'left', padding: '8px 10px', fontWeight: 600, color: 'var(--ac-muted)', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em' };
const td = { padding: '8px 10px', verticalAlign: 'middle' };
const inputStyle = { width: '100%', minWidth: 80, padding: '4px 7px', border: '1px solid var(--ac-border)', borderRadius: 5, fontSize: '0.84rem', background: 'var(--ac-surface)' };
