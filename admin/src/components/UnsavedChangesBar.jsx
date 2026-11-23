import { useEffect } from 'react';

/**
 * Sticky floating bottom bar for long forms (ProductEditor, Settings, Storefront).
 * Automatically handles Ctrl+S / Cmd+S keyboard shortcut when dirty.
 */
export default function UnsavedChangesBar({
  dirty = false,
  saving = false,
  onSave,
  onDiscard,
  label = 'You have unsaved changes',
  saveLabel = 'Save changes',
}) {
  useEffect(() => {
    if (!dirty) return;
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!saving) {
          onSave?.();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dirty, saving, onSave]);

  if (!dirty) return null;

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform);

  return (
    <div className="unsaved-bar" role="region" aria-label="Unsaved changes">
      <div className="unsaved-bar-info">
        <span className="unsaved-dot" aria-hidden="true" />
        <span className="unsaved-text">{label}</span>
        <kbd className="unsaved-kbd">{isMac ? '⌘S' : 'Ctrl+S'}</kbd>
      </div>
      <div className="unsaved-bar-actions">
        {onDiscard && (
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={onDiscard}
            disabled={saving}
          >
            Discard
          </button>
        )}
        <button
          type="button"
          className="btn btn-accent btn-sm"
          onClick={onSave}
          disabled={saving}
        >
          {saving ? 'Saving…' : saveLabel}
        </button>
      </div>
    </div>
  );
}
