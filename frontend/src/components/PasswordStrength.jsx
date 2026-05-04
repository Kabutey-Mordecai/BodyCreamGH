export const RULES = [
  { key: 'length',  label: 'At least 8 characters',       test: (p) => p.length >= 8 },
  { key: 'upper',   label: 'One uppercase letter (A–Z)',   test: (p) => /[A-Z]/.test(p) },
  { key: 'number',  label: 'One number (0–9)',             test: (p) => /[0-9]/.test(p) },
  { key: 'special', label: 'One special character (!@#…)', test: (p) => /[^A-Za-z0-9]/.test(p) },
];

export function getPasswordStrength(password) {
  const passed = RULES.filter(r => r.test(password));
  return { score: passed.length, passed: passed.map(r => r.key) };
}

const STRENGTH_LABELS = ['', 'Weak', 'Fair', 'Good', 'Strong'];
const STRENGTH_COLORS = ['', '#ef4444', '#f97316', '#eab308', '#22c55e'];

export default function PasswordStrength({ password }) {
  const { score, passed } = getPasswordStrength(password);
  const color = STRENGTH_COLORS[score] || '#e5e7eb';

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, alignItems: 'center' }}>
        {[1, 2, 3, 4].map(n => (
          <div
            key={n}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              background: n <= score ? color : '#e5e7eb',
              transition: 'background 0.25s',
            }}
          />
        ))}
        <span style={{ fontSize: '0.72rem', fontWeight: 600, color, minWidth: 42, textAlign: 'right' }}>
          {STRENGTH_LABELS[score]}
        </span>
      </div>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {RULES.map(rule => {
          const met = passed.includes(rule.key);
          return (
            <li
              key={rule.key}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                fontSize: '0.78rem',
                color: met ? '#16a34a' : '#6b7280',
                transition: 'color 0.2s',
              }}
            >
              <span style={{ fontSize: '0.85rem', lineHeight: 1 }}>{met ? '✓' : '○'}</span>
              {rule.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
