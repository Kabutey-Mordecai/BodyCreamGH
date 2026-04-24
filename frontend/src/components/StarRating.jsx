import { useState } from 'react';
import './StarRating.css';

export default function StarRating({ value = 0, max = 5, interactive = false, onChange, size = 'md' }) {
  const [hovered, setHovered] = useState(0);
  const display = interactive ? (hovered || value) : value;

  return (
    <div className={`star-rating star-rating--${size} ${interactive ? 'star-rating--interactive' : ''}`}>
      {Array.from({ length: max }, (_, i) => {
        const star = i + 1;
        const filled = star <= display;
        const half = !filled && star - 0.5 <= display;
        return (
          <span
            key={star}
            className={`star ${filled ? 'star--full' : half ? 'star--half' : 'star--empty'}`}
            onMouseEnter={() => interactive && setHovered(star)}
            onMouseLeave={() => interactive && setHovered(0)}
            onClick={() => interactive && onChange?.(star)}
            role={interactive ? 'button' : undefined}
            aria-label={interactive ? `Rate ${star} star${star > 1 ? 's' : ''}` : undefined}
          >
            ★
          </span>
        );
      })}
    </div>
  );
}
