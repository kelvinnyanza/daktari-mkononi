/**
 * Renders the DEV-ONLY "Style preview" button in development builds and
 * nothing in production. Same guard as app/dev/style-preview.tsx: with
 * `__DEV__` false, Metro's constant folding deletes the `if` block before
 * dependency collection, so the button module is not in the bundle at all.
 */
import type { ComponentType } from 'react';

let DevButton: ComponentType | null = null;
if (__DEV__) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  DevButton = (require('../dev/StylePreviewButton') as { StylePreviewButton: ComponentType }).StylePreviewButton;
}

export function DevStylePreviewEntry(): React.JSX.Element | null {
  return DevButton === null ? null : <DevButton />;
}
