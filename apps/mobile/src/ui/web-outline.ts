import { Platform, type TextStyle } from 'react-native';

/**
 * WEB PREVIEW ONLY: browsers draw their own outline inside focused inputs;
 * our fields show focus with their own border. RN's type for outlineStyle
 * omits 'none', hence the cast. Native: an empty object.
 */
export const noWebOutline: TextStyle =
  Platform.OS === 'web' ? ({ outlineStyle: 'none', outlineWidth: 0 } as unknown as TextStyle) : {};
