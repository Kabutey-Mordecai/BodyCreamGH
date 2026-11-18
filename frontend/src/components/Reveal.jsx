import { useEffect, useRef, useState } from 'react';
import { useSettings } from '../context/SettingsContext';

/**
 * Lightweight scroll-reveal wrapper using IntersectionObserver.
 * Respects both Admin's `animations_enabled` setting and OS `prefers-reduced-motion`.
 * Elements reveal once on entry and never flicker back to hidden.
 */
export default function Reveal({
  children,
  direction = 'up',
  delay = 0,
  className = '',
  as: Tag = 'div',
  style,
  ...rest
}) {
  const { animations_enabled } = useSettings();
  const disabled = animations_enabled === false || animations_enabled === 'false';
  const ref = useRef(null);
  const [visible, setVisible] = useState(() => {
    if (disabled) return true;
    if (typeof window === 'undefined') return true;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return true;
    if (typeof IntersectionObserver === 'undefined') return true;
    return false;
  });

  useEffect(() => {
    if (disabled) {
      setVisible(true);
      return;
    }
    if (visible) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -36px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [disabled, visible]);

  const mergedStyle = delay && !disabled
    ? { ...style, transitionDelay: `${delay}ms` }
    : style;

  return (
    <Tag
      ref={ref}
      className={`reveal reveal--${direction}${visible ? ' reveal--visible' : ''}${className ? ` ${className}` : ''}`}
      style={mergedStyle}
      {...rest}
    >
      {children}
    </Tag>
  );
}
