import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(true);
  useEffect(() => {
    let active = true;
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      changed = true;
      setReducedMotion(value);
    });
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (active && !changed) setReducedMotion(value);
      })
      .catch(() => {
        /* Keep the conservative default if native settings are unavailable. */
      });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return reducedMotion;
}
