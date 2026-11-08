/**
 * DEV-ONLY: design system preview — open with daktari://dev/style-preview.
 *
 * Production builds: `__DEV__` is false, Metro's constant folding deletes the
 * `if (__DEV__)` block before dependency collection, so the preview module
 * and its mock copy are not in the bundle at all, and this route redirects.
 */
import { Redirect } from 'expo-router';
import type { ComponentType } from 'react';

let Preview: ComponentType | null = null;
if (__DEV__) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Preview = (require('../../src/dev/StylePreview') as { StylePreview: ComponentType }).StylePreview;
}

export default function StylePreviewRoute(): React.JSX.Element {
  if (Preview === null) return <Redirect href="/" />;
  return <Preview />;
}
