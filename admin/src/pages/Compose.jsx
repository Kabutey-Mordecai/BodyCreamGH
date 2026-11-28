import { useState, useEffect, useCallback } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import { newsletterAPI } from '../services/api';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';

const SEGMENTS = [
  { value: 'all',              label: 'All subscribers' },
  { value: 'subscribers_only', label: 'Subscribers only (not customers)' },
  { value: 'customers_only',   label: 'Customers who have ordered' },
  { value: 'all_customers',    label: 'All registered customers' },
];

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function ToolbarBtn({ onClick, active, title, children }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        padding: '4px 8px',
        border: '1px solid',
        borderColor: active ? 'var(--ac-accent)' : 'var(--ac-border)',
        background: active ? 'var(--ac-accent)' : 'var(--ac-surface)',
        color: active ? '#fff' : 'var(--ac-text)',
        borderRadius: 4,
        cursor: 'pointer',
        fontSize: '0.8rem',
        fontWeight: active ? 700 : 400,
        lineHeight: 1.4,
        minWidth: 28,
      }}
    >
      {children}
    </button>
  );
}

function EditorToolbar({ editor }) {
  if (!editor) return null;

  const addLink = () => {
    const url = window.prompt('Enter URL:', 'https://');
    if (url) editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  const addImage = () => {
    const url = window.prompt('Enter image URL:');
    if (url) editor.chain().focus().setImage({ src: url }).run();
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '8px 10px', borderBottom: '1px solid var(--ac-border)', background: 'var(--ac-bg)' }}>
      <ToolbarBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold">
        <strong>B</strong>
      </ToolbarBtn>
      <ToolbarBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic">
        <em>I</em>
      </ToolbarBtn>
      <ToolbarBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline">
        <span style={{ textDecoration: 'underline' }}>U</span>
      </ToolbarBtn>
      <span style={{ width: 1, background: 'var(--ac-border)', margin: '0 4px' }} />
      {[1, 2, 3].map(level => (
        <ToolbarBtn
          key={level}
          onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
          active={editor.isActive('heading', { level })}
          title={`Heading ${level}`}
        >
          H{level}
        </ToolbarBtn>
      ))}
      <span style={{ width: 1, background: 'var(--ac-border)', margin: '0 4px' }} />
      <ToolbarBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list">
        •≡
      </ToolbarBtn>
      <ToolbarBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list">
        1≡
      </ToolbarBtn>
      <span style={{ width: 1, background: 'var(--ac-border)', margin: '0 4px' }} />
      <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Align left">
        ≡←
      </ToolbarBtn>
      <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Align center">
        ≡|
      </ToolbarBtn>
      <ToolbarBtn onClick={() => editor.chain().focus().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Align right">
        →≡
      </ToolbarBtn>
      <span style={{ width: 1, background: 'var(--ac-border)', margin: '0 4px' }} />
      <ToolbarBtn onClick={addLink} active={editor.isActive('link')} title="Insert link">🔗</ToolbarBtn>
      <ToolbarBtn onClick={addImage} active={false} title="Insert image">🖼</ToolbarBtn>
    </div>
  );
}

export default function Compose() {
  const [subject, setSubject]           = useState('');
  const [segment, setSegment]           = useState('all');
  const [recipientCount, setRecipientCount] = useState(null);
  const [loadingCount, setLoadingCount] = useState(false);

  // Send flow state
  const [showConfirm, setShowConfirm]   = useState(false);
  const [sending, setSending]           = useState(false);
  const [campaignId, setCampaignId]     = useState(null);
  const [progress, setProgress]         = useState(null);   // { sent_count, recipient_count, status, failed_count }
  const [done, setDone]                 = useState(false);
  const [sendError, setSendError]       = useState('');

  // Preview modal
  const [showPreview, setShowPreview]   = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false }),
      Image,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: '',
    editorProps: {
      attributes: {
        style: 'min-height: 320px; padding: 16px; outline: none; font-family: sans-serif; font-size: 0.95rem; line-height: 1.6;',
      },
    },
  });

  // Fetch recipient count when segment changes
  const fetchCount = useCallback(async (seg) => {
    setLoadingCount(true);
    try {
      const { data } = await newsletterAPI.getPreviewCount(seg);
      setRecipientCount(data.count);
    } catch {
      setRecipientCount(null);
    } finally {
      setLoadingCount(false);
    }
  }, []);

  useEffect(() => { fetchCount(segment); }, [segment, fetchCount]);

  // Poll progress while sending
  useEffect(() => {
    if (!campaignId || done) return;
    const poll = async () => {
      try {
        const { data } = await newsletterAPI.getCampaignStatus(campaignId);
        setProgress(data);
        if (data.status === 'sent' || data.status === 'failed') {
          setDone(true);
          setSending(false);
        }
      } catch {}
    };
    const interval = setInterval(poll, 3000);
    poll(); // immediate first call
    return () => clearInterval(interval);
  }, [campaignId, done]);

  const handleSend = async () => {
    if (!subject.trim()) { setSendError('Subject is required.'); return; }
    const bodyHtml = editor?.getHTML() || '';
    if (!bodyHtml.trim() || bodyHtml === '<p></p>') { setSendError('Email body is required.'); return; }
    setSendError('');
    setShowConfirm(true);
  };

  const confirmSend = async () => {
    const bodyHtml = editor?.getHTML() || '';
    const bodyText = stripHtml(bodyHtml);
    setShowConfirm(false);
    setSending(true);
    setDone(false);
    setProgress(null);

    try {
      const { data: campaign } = await newsletterAPI.createCampaign({ subject, body_html: bodyHtml, body_text: bodyText, segment });
      await newsletterAPI.sendCampaign(campaign.id);
      setCampaignId(campaign.id);
    } catch (err) {
      setSendError(err.response?.data?.error || 'Failed to send campaign.');
      setSending(false);
    }
  };

  const reset = () => {
    setSubject('');
    setSegment('all');
    editor?.commands.clearContent();
    setCampaignId(null);
    setProgress(null);
    setDone(false);
    setSending(false);
    setSendError('');
  };

  // Progress bar percentage
  const pct = progress && progress.recipient_count > 0
    ? Math.round(((progress.sent_count + progress.failed_count) / progress.recipient_count) * 100)
    : 0;

  if (done && progress) {
    return (
      <div>
        <h1 className="page-title">Compose Newsletter</h1>
        <div className="card" style={{ padding: 32, maxWidth: 560, marginTop: 24 }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>{progress.failed_count === 0 ? '✅' : '⚠️'}</div>
          <h2 style={{ marginBottom: 8 }}>Campaign sent!</h2>
          <p style={{ color: 'var(--ac-text-soft)', marginBottom: 20 }}>
            <strong>{progress.sent_count}</strong> sent successfully
            {progress.failed_count > 0 && <>, <strong style={{ color: 'var(--ac-danger)' }}>{progress.failed_count}</strong> failed</>}.
          </p>
          <button className="btn btn-primary" onClick={reset}>Compose another</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Compose Newsletter</h1>
          <p className="muted">Write and broadcast an email campaign to your audience</p>
        </div>
        <div className="page-actions">
          <RouterLink to="/newsletter/history" className="btn btn-outline btn-sm">
            Campaign History →
          </RouterLink>
        </div>
      </div>

      {/* Sending progress overlay */}
      {sending && (
        <div className="card" style={{ padding: 24, marginBottom: 24, maxWidth: 560 }}>
          <p style={{ fontWeight: 600, marginBottom: 12 }}>Sending campaign…</p>
          <div style={{ background: 'var(--ac-surface-2)', borderRadius: 4, height: 8, overflow: 'hidden', marginBottom: 8 }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--ac-accent)', transition: 'width 0.5s' }} />
          </div>
          {progress && (
            <p style={{ fontSize: '0.82rem', color: 'var(--ac-text-muted)' }}>
              Sent {progress.sent_count} of {progress.recipient_count}
              {progress.failed_count > 0 && ` (${progress.failed_count} failed)`}
            </p>
          )}
        </div>
      )}

      {sendError && <div className="alert alert-error" style={{ marginBottom: 16 }}>{sendError}</div>}

      <div className="compose-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
          {/* Subject */}
          <div className="card" style={{ padding: 20 }}>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="nl-subject">Subject line</label>
              <input
                id="nl-subject"
                type="text"
                placeholder="Your email subject…"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                disabled={sending}
              />
            </div>
          </div>

          {/* Rich text editor */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <EditorToolbar editor={editor} />
            <EditorContent editor={editor} />
          </div>
        </div>

        {/* Right panel */}
        <div className="compose-sidebar">
          <div className="card" style={{ padding: 20 }}>
            <div className="field" style={{ marginBottom: 14 }}>
              <label htmlFor="nl-segment">Send to</label>
              <select
                id="nl-segment"
                value={segment}
                onChange={e => setSegment(e.target.value)}
                disabled={sending}
              >
                {SEGMENTS.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div
              style={{
                padding: '10px 12px',
                borderRadius: 'var(--ac-radius)',
                background: 'var(--ac-surface-2)',
                border: '1px solid var(--ac-border)',
                fontSize: '0.82rem',
                color: 'var(--ac-text-muted)',
              }}
            >
              {loadingCount ? (
                'Calculating recipients…'
              ) : recipientCount !== null ? (
                <>
                  Will send to{' '}
                  <strong style={{ color: 'var(--ac-text)' }}>
                    {recipientCount.toLocaleString()}
                  </strong>{' '}
                  recipient{recipientCount !== 1 ? 's' : ''}
                </>
              ) : (
                'Unable to load count'
              )}
            </div>
          </div>

          <button
            type="button"
            className="btn btn-outline btn-full"
            onClick={() => setShowPreview(true)}
            disabled={sending}
          >
            Preview email
          </button>
          <button
            type="button"
            className="btn btn-accent btn-full"
            onClick={handleSend}
            disabled={sending || loadingCount || recipientCount === 0}
          >
            Send campaign
          </button>
        </div>
      </div>

      {/* Preview modal (Native HTML5 <dialog>) */}
      <Modal
        open={showPreview}
        onClose={() => setShowPreview(false)}
        title="Email preview"
        size="lg"
        footer={
          <button type="button" className="btn btn-outline" onClick={() => setShowPreview(false)}>
            Close
          </button>
        }
      >
        <div style={{ borderBottom: '1px solid var(--ac-border)', paddingBottom: 12, marginBottom: 16 }}>
          <strong>Subject:</strong>{' '}
          {subject || <em style={{ color: 'var(--ac-text-muted)' }}>No subject</em>}
        </div>
        <iframe
          title="Compose email preview"
          sandbox=""
          srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:18px;font-family:sans-serif;font-size:15px;line-height:1.6;color:#111827;background:#ffffff;word-break:break-word;}img{max-width:100%;height:auto;}</style></head><body>${editor?.getHTML() || '<p><em>Empty</em></p>'}</body></html>`}
          style={{
            width: '100%',
            height: 320,
            border: '1px solid var(--ac-border)',
            borderRadius: 'var(--ac-radius)',
            background: '#ffffff',
          }}
        />
        <div style={{ marginTop: 14, fontSize: '0.75rem', color: 'var(--ac-text-muted)', textAlign: 'center' }}>
          You're receiving this because you subscribed to BodyCreamGH updates.{' '}
          <span style={{ textDecoration: 'underline' }}>Unsubscribe here</span>
        </div>
      </Modal>

      {/* Confirm send dialog (Native HTML5 <dialog>) */}
      <ConfirmDialog
        open={showConfirm}
        onClose={() => setShowConfirm(false)}
        onConfirm={confirmSend}
        title="Send this campaign?"
        message={`Subject: "${subject}". This will queue delivery to approximately ${recipientCount?.toLocaleString() ?? '?'} recipient(s). This cannot be undone.`}
        confirmLabel="Send now"
      />

      <style>{`
        .compose-grid {
          display: grid;
          grid-template-columns: 1fr 280px;
          gap: 20px;
          align-items: start;
        }
        .compose-sidebar {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        @media (max-width: 900px) {
          .compose-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
