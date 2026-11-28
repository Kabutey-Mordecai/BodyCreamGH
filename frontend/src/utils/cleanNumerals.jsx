import React from 'react';

/**
 * Parses a heading string and wraps numeric sequences (e.g. 100%, 50%, 24h)
 * in a clean sans-serif span (.num-clean) so that digits like '1' do not render
 * with Cormorant Garamond's Roman-numeral 'I'-like serifs.
 * Also handles <br /> tags and newlines safely.
 */
export function renderCleanNumerals(text) {
  if (text == null) return null;
  const lines = String(text).split(/\r?\n|<br\s*\/?>/i);
  return lines.map((line, lIdx) => {
    const parts = line.split(/(\d+(?:[.,]\d+)?%?)/g);
    return (
      <React.Fragment key={lIdx}>
        {lIdx > 0 && <br />}
        {parts.map((p, pIdx) => {
          if (/^\d/.test(p)) {
            return (
              <span key={pIdx} className="num-clean">
                {p}
              </span>
            );
          }
          return p;
        })}
      </React.Fragment>
    );
  });
}
