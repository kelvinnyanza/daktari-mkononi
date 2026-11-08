import { View } from 'react-native';
import { radius, useTheme } from '../theme/theme';
import { Icon, type IconName } from './Icon';

/** 48dp rounded tile with a teal icon — list leadings, quick actions. Decorative. */
export function IconTile({ icon, tone = 'primary' }: { icon: IconName; tone?: 'primary' | 'neutral' }): React.JSX.Element {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: 48,
        height: 48,
        borderRadius: radius.md,
        backgroundColor: tone === 'primary' ? colors.primarySoft : colors.surfaceMuted,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={icon} color={tone === 'primary' ? colors.primary : colors.textSecondary} />
    </View>
  );
}
