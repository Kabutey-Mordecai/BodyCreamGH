import { useState, useEffect, useCallback, useMemo } from 'react';
import { variantsAPI } from '../services/api';
import { useToast } from '../context/ToastContext';
import ConfirmDialog from './ConfirmDialog';

// Cartesian product of arrays of option values
function cartesian(arrays) {
  if (arrays.length === 0) return [];
  return arrays.reduce(
    (acc, arr) => acc.flatMap(a => arr.map(b => [...a, b])),
    [[]]
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

  // Inline add-value to existing option type: { [typeId]: string }
  const [addValueText, setAddValueText]   = useState({});
  const [addingValueId, setAddingValueId] = useState(null);

  // Delete option confirm dialog
  const [deleteTarget, setDeleteTarget] = useState(null);

  // Per-row edits keyed by comboKey
  const [rowEdits, setRowEdits]     = useState({});
  const [savedEdits, setSavedEdits] = useState({});
  const [rowSaving, setRowSaving]   = useState({});
  const [savingAll, setSavingAll]   = useState(false);

  // Bulk fill bar
  const [bulkPrice, setBulkPrice] = useState('');
  const [bulkStock, setBulkStock] = useState('');

  const load = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    try {
      const { data: d } = await variantsAPI.getByProduct(productId);
      setData(d);
      const edits = {};
      (d.variants || []).forEach(v => {
        const key = v.option_values.map(ov => ov.option_value_id).sort().join('|');
        edits[key] = {
          price:            String(v.price ?? ''),
          compare_at_price: v.compare_at_price ? String(v.compare_at_price) : '',
          sku:              v.sku || '',
          stock_quantity:   String(v.stock_quantity ?? '0'),
        };
      });
      setRowEdits(edits);
      setSavedEdits(edits);
    } catch {
      toast.error('Failed to load variants');
    } finally {
      setLoading(false);
    }
  }, [productId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const combinations = useMemo(() => {
    const valueArrays = (data.option_types || []).map(t =>
      (t.values || []).filter(Boolean)
    );
    if (valueArrays.length === 0 || valueArrays.some(a => a.length === 0)) return [];
    return cartesian(valueArrays);
  }, [data.option_types]);

  const existingByKey = useMemo(() => {
    const map = {};
    (data.variants || []).forEach(v => {
      const key = v.option_values.map(ov => ov.option_value_id).sort().join('|');
      map[key] = v;
    });
    return map;
  }, [data.variants]);

  const dirtyCombos = useMemo(() => {
    return combinations.filter(combo => {
      const key = comboKey(combo);
      const cur = rowEdits[key] || EMPTY_ROW;
      const prev = savedEdits[key];
      if (!prev) {
        return cur.price !== '';
      }
      return (
        cur.price !== prev.price ||
        cur.compare_at_price !== prev.compare_at_price ||
        cur.sku !== prev.sku ||
        cur.stock_quantity !== prev.stock_quantity
      );
    });
  }, [combinations, rowEdits, savedEdits]);

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
    if (e.key === ',') { e.preventDefault(); commitTypeInput(); }
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

  const handleAddValueToExisting = async (optType) => {
    const val = (addValueText[optType.id] || '').trim();
    if (!val) return;
    if ((optType.values || []).some(v => v.value.toLowerCase() === val.toLowerCase())) {
      toast.error(`"${val}" already exists in ${optType.name}`);
      return;
    }
    setAddingValueId(optType.id);
    try {
      await variantsAPI.createOptionValue(productId, optType.id, {
        value: val,
        position: (optType.values || []).length,
      });
      setAddValueText(prev => ({ ...prev, [optType.id]: '' }));
      toast.success(`Added "${val}" to ${optType.name}`);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add value');
    } finally {
      setAddingValueId(null);
    }
  };

  const confirmDeleteOptionType = async () => {
    if (!deleteTarget) return;
    try {
      await variantsAPI.deleteOptionType(productId, deleteTarget.id);
      toast.success(`Option "${deleteTarget.name}" deleted`);
      setDeleteTarget(null);
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

  const saveSingleCombo = async (combo) => {
    const key      = comboKey(combo);
    const edits    = rowEdits[key] || EMPTY_ROW;
    const existing = existingByKey[key];
    const payload  = {
      price:            Number(edits.price),
      compare_at_price: edits.compare_at_price ? Number(edits.compare_at_price) : null,
      sku:              edits.sku || null,
      stock_quantity:   Number(edits.stock_quantity) || 0,
      option_value_ids: combo.map(v => v.id),
    };
    if (existing) {
      await variantsAPI.update(productId, existing.id, payload);
    } else {
      await variantsAPI.create(productId, payload);
    }
  };

  const handleSaveRow = async (combo) => {
    const key   = comboKey(combo);
    const edits = rowEdits[key] || EMPTY_ROW;
    if (!edits.price || isNaN(Number(edits.price))) {
      toast.error('Price is required');
      return;
    }
    setRowSaving(prev => ({ ...prev, [key]: true }));
    try {
      await saveSingleCombo(combo);
      toast.success('Variant saved');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    } finally {
      setRowSaving(prev => ({ ...prev, [key]: false }));
    }
  };

  const handleSaveAllDirty = async () => {
    if (dirtyCombos.length === 0) return;
    for (const combo of dirtyCombos) {
      const edits = rowEdits[comboKey(combo)] || EMPTY_ROW;
      if (!edits.price || isNaN(Number(edits.price))) {
        toast.error(`Price is required for "${combo.map(v => v.value).join(' / ')}"`);
        return;
      }
    }
    setSavingAll(true);
    try {
      for (const combo of dirtyCombos) {
        await saveSingleCombo(combo);
      }
      toast.success(`Saved ${dirtyCombos.length} variant${dirtyCombos.length !== 1 ? 's' : ''}`);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Bulk save failed');
    } finally {
      setSavingAll(false);
    }
  };

  const handleApplyBulk = () => {
    if (bulkPrice === '' && bulkStock === '') return;
    setRowEdits(prev => {
      const next = { ...prev };
      combinations.forEach(combo => {
        const key = comboKey(combo);
        const cur = next[key] || { ...EMPTY_ROW };
        next[key] = {
          ...cur,
          ...(bulkPrice !== '' && { price: bulkPrice }),
          ...(bulkStock !== '' && { stock_quantity: bulkStock }),
        };
      });
      return next;
    });
    toast.success('Applied to all rows — click "Save all" to commit');
    setBulkPrice('');
    setBulkStock('');
  };

  const handleToggleVariant = async (combo) => {
    const key      = comboKey(combo);
    const existing = existingByKey[key];
    if (!existing) return;
    try {
      await variantsAPI.update(productId, existing.id, {
        ...(rowEdits[key] && {
          price:          Number(rowEdits[key].price) || existing.price,
          stock_quantity: Number(rowEdits[key].stock_quantity) || 0,
        }),
        is_active:        !existing.is_active,
        option_value_ids: combo.map(v => v.id),
      });
      toast.success(existing.is_active ? 'Variant disabled' : 'Variant enabled');
      await load();
    } catch {
      toast.error('Failed to toggle variant');
    }
  };

  if (loading) return <div className="spinner" style={{ margin: '24px auto' }} />;

  return (
    <div>
      {/* ── Option types ──────────────────────────────── */}
      <div style={{ marginBottom: 16 }}>
        {data.option_types.map(t => (
          <div key={t.id} className="vm-option-card">
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: 8 }}>{t.name}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                {(t.values || []).map(v => (
                  <span key={v.id} className="vm-val-chip">
                    {v.value}
                  </span>
                ))}
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="text"
                    placeholder={`+ Add ${t.name.toLowerCase()}…`}
                    value={addValueText[t.id] || ''}
                    onChange={e => setAddValueText(prev => ({ ...prev, [t.id]: e.target.value }))}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddValueToExisting(t);
                      }
                    }}
                    disabled={addingValueId === t.id}
                    style={{ width: 130, padding: '3px 8px', fontSize: '0.78rem' }}
                  />
                  {(addValueText[t.id] || '').trim() && (
                    <button
                      type="button"
                      className="btn btn-accent btn-sm"
                      disabled={addingValueId === t.id}
                      onClick={() => handleAddValueToExisting(t)}
                    >
                      {addingValueId === t.id ? '…' : 'Add'}
                    </button>
                  )}
                </div>
              </div>
            </div>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              style={{ color: 'var(--ac-danger)', flexShrink: 0 }}
              onClick={() => setDeleteTarget(t)}
            >
              Delete option
            </button>
          </div>
        ))}

        {!showAddType ? (
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowAddType(true)}>
            + Add option
          </button>
        ) : (
          <div className="vm-option-card" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <div className="field" style={{ marginBottom: 10 }}>
              <label htmlFor="vm-new-option-name">Option name</label>
              <input
                id="vm-new-option-name"
                type="text"
                value={typeName}
                onChange={e => setTypeName(e.target.value)}
                placeholder="e.g. Size, Scent, Bundle"
                autoFocus
              />
            </div>
            <div className="field" style={{ marginBottom: 12 }}>
              <label>Values</label>
              <div
                className="vm-chip-input-box"
                onClick={e => e.currentTarget.querySelector('input')?.focus()}
              >
                {typeValues.map((v, i) => (
                  <span key={i} className="vm-chip-active">
                    {v}
                    <button
                      type="button"
                      onClick={() => setTypeValues(prev => prev.filter((_, j) => j !== i))}
                      aria-label={`Remove ${v}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  value={typeInput}
                  onChange={handleTypeInputChange}
                  onKeyDown={handleTypeInputKeyDown}
                  placeholder={typeValues.length === 0 ? 'Type a value, press Enter or comma' : ''}
                  className="vm-chip-raw-input"
                />
              </div>
              <div className="hint">Press Enter or comma after each value (e.g. 100ml, 200ml, 500ml).</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn btn-accent btn-sm"
                onClick={handleAddOptionType}
                disabled={savingType || !typeName.trim()}
              >
                {savingType ? 'Saving…' : 'Add option'}
              </button>
              <button
                type="button"
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

      {/* ── Bulk Fill & Save All Bar ──────────────────── */}
      {combinations.length > 0 && (
        <div className="vm-bulk-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="muted text-xs" style={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Bulk fill:
            </span>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Price (GHS)"
              value={bulkPrice}
              onChange={e => setBulkPrice(e.target.value)}
              style={{ width: 115, padding: '4px 8px', fontSize: '0.82rem' }}
            />
            <input
              type="number"
              min="0"
              step="1"
              placeholder="Stock"
              value={bulkStock}
              onChange={e => setBulkStock(e.target.value)}
              style={{ width: 85, padding: '4px 8px', fontSize: '0.82rem' }}
            />
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={handleApplyBulk}
              disabled={bulkPrice === '' && bulkStock === ''}
            >
              Apply to all
            </button>
          </div>

          {dirtyCombos.length > 0 && (
            <button
              type="button"
              className="btn btn-accent btn-sm"
              onClick={handleSaveAllDirty}
              disabled={savingAll}
            >
              {savingAll
                ? 'Saving all…'
                : `Save all (${dirtyCombos.length})`}
            </button>
          )}
        </div>
      )}

      {/* ── Variant table ─────────────────────────────── */}
      {combinations.length > 0 && (
        <div className="data-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Variant</th>
                <th style={{ width: 120 }}>Price (GHS) *</th>
                <th style={{ width: 115 }}>Was (GHS)</th>
                <th style={{ width: 135 }}>SKU</th>
                <th style={{ width: 90 }}>Stock</th>
                <th style={{ width: 100 }}>Status</th>
                <th style={{ width: 150 }}></th>
              </tr>
            </thead>
            <tbody>
              {combinations.map(combo => {
                const key      = comboKey(combo);
                const existing = existingByKey[key];
                const edits    = rowEdits[key] || EMPTY_ROW;
                const prev     = savedEdits[key];
                const isDirty  = prev
                  ? (edits.price !== prev.price ||
                     edits.compare_at_price !== prev.compare_at_price ||
                     edits.sku !== prev.sku ||
                     edits.stock_quantity !== prev.stock_quantity)
                  : edits.price !== '';
                const isSaving = rowSaving[key];
                const label    = combo.map(v => v.value).join(' / ');

                return (
                  <tr
                    key={key}
                    className={isDirty ? 'selected' : ''}
                    style={{ opacity: existing && !existing.is_active ? 0.6 : 1 }}
                  >
                    <td>
                      <div className="cell-primary">{label}</div>
                      {isDirty && <div style={{ fontSize: '0.7rem', color: 'var(--ac-accent-dark)', fontWeight: 600 }}>Unsaved</div>}
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={edits.price}
                        onChange={e => updRow(key, 'price', e.target.value)}
                        placeholder="0.00"
                        style={{ padding: '5px 8px', fontSize: '0.84rem' }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={edits.compare_at_price}
                        onChange={e => updRow(key, 'compare_at_price', e.target.value)}
                        placeholder="—"
                        style={{ padding: '5px 8px', fontSize: '0.84rem' }}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={edits.sku}
                        onChange={e => updRow(key, 'sku', e.target.value)}
                        placeholder="SKU"
                        style={{ padding: '5px 8px', fontSize: '0.84rem', fontFamily: 'monospace' }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={edits.stock_quantity}
                        onChange={e => updRow(key, 'stock_quantity', e.target.value)}
                        style={{ padding: '5px 8px', fontSize: '0.84rem', width: 72 }}
                      />
                    </td>
                    <td>
                      {existing ? (
                        <span className={`badge ${existing.is_active ? 'badge-success' : 'badge-danger'}`}>
                          {existing.is_active ? 'Active' : 'Disabled'}
                        </span>
                      ) : (
                        <span className="badge badge-neutral">Not saved</span>
                      )}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          className={`btn btn-sm ${isDirty || !existing ? 'btn-accent' : 'btn-outline'}`}
                          onClick={() => handleSaveRow(combo)}
                          disabled={isSaving || savingAll}
                        >
                          {isSaving ? '…' : existing ? 'Update' : 'Save'}
                        </button>
                        {existing && (
                          <button
                            type="button"
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

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDeleteOptionType}
        danger
        title="Delete variant option?"
        message={
          deleteTarget
            ? `Delete option "${deleteTarget.name}"? All saved variants using this option will also be permanently removed.`
            : ''
        }
        confirmLabel="Delete option"
      />

      <style>{`
        .vm-option-card {
          background: var(--ac-surface-2);
          border: 1px solid var(--ac-border);
          border-radius: var(--ac-radius);
          padding: 12px 14px;
          margin-bottom: 10px;
          display: flex;
          align-items: flex-start;
          gap: 12px;
        }
        .vm-val-chip {
          background: var(--ac-surface);
          border: 1px solid var(--ac-border-strong);
          color: var(--ac-text);
          border-radius: 99px;
          padding: 2px 10px;
          font-size: 0.8rem;
          font-weight: 500;
        }
        .vm-chip-input-box {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          border: 1px solid var(--ac-input-border);
          background: var(--ac-input-bg);
          border-radius: var(--ac-radius);
          padding: 6px 8px;
          min-height: 38px;
          align-items: center;
          cursor: text;
        }
        .vm-chip-active {
          background: var(--ac-accent);
          color: #fff;
          border-radius: 99px;
          padding: 2px 10px;
          font-size: 0.78rem;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }
        .vm-chip-active button {
          background: none;
          border: none;
          color: inherit;
          cursor: pointer;
          padding: 0;
          line-height: 1;
          font-size: 0.95rem;
        }
        .vm-chip-raw-input {
          border: none !important;
          outline: none !important;
          box-shadow: none !important;
          background: transparent !important;
          flex-grow: 1;
          min-width: 100px;
          width: auto !important;
          padding: 2px 4px !important;
          font-size: 0.86rem;
        }
        .vm-bulk-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 12px;
          padding: 10px 14px;
          margin-bottom: 12px;
          background: var(--ac-surface-2);
          border: 1px solid var(--ac-border);
          border-radius: var(--ac-radius);
        }
      `}</style>
    </div>
  );
}
