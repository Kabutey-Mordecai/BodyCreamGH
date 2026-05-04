import { useState, useEffect, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import { newsletterAPI } from '../services/api';

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 className="page-title">Compose Newsletter</h1>
          <p className="page-subtitle">Write and send a newsletter campaign</p>
        </div>
      </div>

      {/* Sending progress overlay */}
      {sending && (
        <div className="card" style={{ padding: 24, marginBottom: 24, maxWidth: 560 }}>
          <p style={{ fontWeight: 600, marginBottom: 12 }}>Sending campaign…</p>
          <div style={{ background: 'var(--ac-bg)', borderRadius: 4, height: 8, overflow: 'hidden', marginBottom: 8 }}>
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 24, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Subject */}
          <div className="card" style={{ padding: 20 }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label htmlFor="nl-subject">Subject line</label>
              <input
                id="nl-subject"
                type="text"
                className="form-input"
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
        <div style={{ width: 260, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ padding: 20 }}>
            <div className="form-group" style={{ marginBottom: 16 }}>
              <label htmlFor="nl-segment">Send to</label>
              <select
                id="nl-segment"
                className="form-input"
                value={segment}
                onChange={e => setSegment(e.target.value)}
                disabled={sending}
              >
                {SEGMENTS.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <p style={{ fontSize: '0.82rem', color: 'var(--ac-text-muted)', margin: 0 }}>
              {loadingCount ? 'Calculating…' : recipientCount !== null
                ? `This will send to ~${recipientCount.toLocaleString()} recipient${recipientCount !== 1 ? 's' : ''}`
                : '—'}
            </p>
          </div>

          <button className="btn" style={{ width: '100%' }} onClick={() => setShowPreview(true)} disabled={sending}>
            Preview email
          </button>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleSend} disabled={sending}>
            Send campaign
          </button>
        </div>
      </div>

      {/* Preview modal */}
      {showPreview && (
        <div className="modal-overlay" onClick={() => setShowPreview(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 640, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0 }}>Email preview</h3>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem' }} onClick={() => setShowPreview(false)}>×</button>
            </div>
            <div style={{ borderBottom: '1px solid var(--ac-border)', paddingBottom: 12, marginBottom: 16 }}>
              <strong>Subject:</strong> {subject || <em style={{ color: 'var(--ac-text-muted)' }}>No subject</em>}
            </div>
            <div
              style={{ flex: 1, overflowY: 'auto', fontFamily: 'sans-serif', fontSize: '0.95rem', lineHeight: 1.6, border: '1px solid var(--ac-border)', borderRadius: 4, padding: 20 }}
              dangerouslySetInnerHTML={{ __html: editor?.getHTML() || '<p><em>Empty</em></p>' }}
            />
            <div style={{ marginTop: 16, padding: '12px 0 0', borderTop: '1px solid var(--ac-border)', fontSize: '0.75rem', color: '#9ca3af', textAlign: 'center' }}>
              You're receiving this because you subscribed to BodyCreamGH updates. <span style={{ textDecoration: 'underline' }}>Unsubscribe here</span>
            </div>
          </div>
        </div>
      )}

      {/* Confirm send modal */}
      {showConfirm && (
        <div className="modal-overlay" onClick={() => setShowConfirm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <h3 style={{ marginBottom: 12 }}>Send this campaign?</h3>
            <p style={{ color: 'var(--ac-text-soft)', marginBottom: 8 }}>
              <strong>Subject:</strong> {subject}
            </p>
            <p style={{ color: 'var(--ac-text-soft)', marginBottom: 20 }}>
              This will send to approximately <strong>{recipientCount?.toLocaleString() ?? '?'}</strong> recipients.
              This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setShowConfirm(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={confirmSend}>Send now</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
