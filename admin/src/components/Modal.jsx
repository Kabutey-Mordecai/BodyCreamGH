import { useEffect, useRef } from 'react';

/**
 * Modern HTML5 Native <dialog> Modal.
 * Uses .showModal() for top-layer stacking, native focus-trapping,
 * ::backdrop rendering, and Escape key handling.
 */
export default function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else {
      if (dialog.open) {
        dialog.close();
      }
    }
  }, [open]);

  const maxWidth = { sm: 400, md: 520, lg: 740, xl: 980 }[size] || 520;

  return (
    <dialog
      ref={dialogRef}
      className={`ac-modal modal-${size}`}
      style={{ maxWidth }}
      onCancel={(e) => {
        e.preventDefault();
        onClose?.();
      }}
      onClick={(e) => {
        // Direct click on the dialog element itself means the backdrop was clicked
        if (e.target === dialogRef.current) {
          onClose?.();
        }
      }}
      aria-labelledby={title ? 'ac-modal-title' : undefined}
    >
      <div className="modal-inner">
        {title && (
          <div className="modal-header">
            <h3 id="ac-modal-title">{title}</h3>
            <button
              type="button"
              className="modal-close"
              onClick={onClose}
              aria-label="Close modal"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </dialog>
  );
}
