import { useState } from 'react';

/**
 * Keyboard / D-pad / switch-access focus tracking for Pressables (tablets
 * with keyboards, accessibility services). Pair with a visible ring style.
 */
export function useFocusRing(): { focused: boolean; onFocus: () => void; onBlur: () => void } {
  const [focused, setFocused] = useState(false);
  return { focused, onFocus: () => setFocused(true), onBlur: () => setFocused(false) };
}
