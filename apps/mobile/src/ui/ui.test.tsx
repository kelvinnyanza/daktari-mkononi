/**
 * Render tests for the core design-system components: behaviour that must not
 * regress (press / disabled / loading, a11y labels and roles, emergency
 * colours and dial targets, Swahili status labels).
 */
import { Linking, Modal, StyleSheet, TextInput } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { useI18nStore } from '../i18n';
import { lightColors } from '../theme/theme';
import {
  APPOINTMENT_STATUS_STYLE,
  AppointmentStatusPill,
  Avatar,
  Banner,
  BottomSheet,
  Button,
  ChipGroup,
  ConfirmDialog,
  EmergencyCallCard,
  EmergencyShell,
  EmergencyStrip,
  EmptyState,
  ErrorState,
  Header,
  IconButton,
  Input,
  PaymentStatusPill,
  Text,
} from './index';

function render(element: React.ReactElement): ReactTestRenderer {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(element);
  });
  return tree!;
}

/** All visible text, joined (nested Text children flattened). */
function textOf(node: ReactTestInstance | ReactTestRenderer): string {
  const root = 'root' in node ? node.root : node;
  // Host Text nodes (type 'Text') hold the strings; nested Text is flattened by joining.
  return root
    .findAll((n) => n.type === ('Text' as never))
    .map((n) => (n.children as unknown[]).filter((c): c is string => typeof c === 'string').join(''))
    .join(' ');
}

/** The RN Pressable composites: they carry both a role and onPress (our wrappers carry only onPress). */
function pressables(tree: ReactTestRenderer): ReactTestInstance[] {
  return tree.root.findAll(
    (n) => typeof n.type !== 'string' && n.props.accessibilityRole !== undefined && typeof n.props.onPress === 'function',
  );
}

function flatStyle(node: ReactTestInstance, pressed = false): Record<string, unknown> {
  const style: unknown = node.props.style;
  const resolved = typeof style === 'function' ? (style as (s: { pressed: boolean }) => unknown)({ pressed }) : style;
  return (StyleSheet.flatten(resolved as never) as Record<string, unknown> | undefined) ?? {};
}

beforeEach(() => {
  act(() => useI18nStore.getState().setLocale('sw'));
});

describe('Button', () => {
  it('renders its label and fires onPress', () => {
    const onPress = jest.fn();
    const tree = render(<Button label="Lipia sasa" onPress={onPress} />);
    expect(textOf(tree)).toContain('Lipia sasa');
    const button = pressables(tree)[0]!;
    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityLabel).toBe('Lipia sasa');
    act(() => button.props.onPress());
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('disabled and loading both block presses and report state', () => {
    const disabled = render(<Button label="A" onPress={jest.fn()} disabled />);
    expect(pressables(disabled)[0]!.props.disabled).toBe(true);
    expect(pressables(disabled)[0]!.props.accessibilityState).toEqual({ disabled: true, busy: false });

    const loading = render(<Button label="B" onPress={jest.fn()} loading />);
    expect(pressables(loading)[0]!.props.disabled).toBe(true);
    expect(pressables(loading)[0]!.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(textOf(loading)).toContain('B'); // label kept while loading
  });

  it('meets the 48dp touch target and uses the primary teal', () => {
    const tree = render(<Button label="A" onPress={jest.fn()} size="sm" />);
    const style = flatStyle(pressables(tree)[0]!);
    expect(style.minHeight).toBeGreaterThanOrEqual(48);
    expect(flatStyle(pressables(render(<Button label="A" onPress={jest.fn()} />))[0]!).backgroundColor).toBe(
      lightColors.primary,
    );
  });
});

describe('IconButton', () => {
  it('is 48×48 and carries its required accessibility label', () => {
    const tree = render(<IconButton icon="x" accessibilityLabel="Funga" onPress={jest.fn()} />);
    const button = pressables(tree)[0]!;
    expect(button.props.accessibilityLabel).toBe('Funga');
    const style = flatStyle(button);
    expect(style.width).toBeGreaterThanOrEqual(48);
    expect(style.height).toBeGreaterThanOrEqual(48);
  });
});

describe('Header', () => {
  it('back button is labelled in the active language', () => {
    const tree = render(<Header title="Miadi" onBack={jest.fn()} />);
    expect(pressables(tree)[0]!.props.accessibilityLabel).toBe('Rudi nyuma');
    act(() => useI18nStore.getState().setLocale('en'));
    expect(pressables(tree)[0]!.props.accessibilityLabel).toBe('Go back');
  });
});

describe('Input', () => {
  it('shows the hint, and the error replaces it', () => {
    const hinted = render(<Input label="Namba ya simu" hint="Mfano: 0712 345 678" />);
    expect(textOf(hinted)).toContain('Mfano: 0712 345 678');
    expect(hinted.root.findByType(TextInput).props.accessibilityLabel).toBe('Namba ya simu');

    const errored = render(<Input label="Jina" hint="hint" error="Andika jina lako" />);
    expect(textOf(errored)).toContain('Andika jina lako');
    expect(textOf(errored)).not.toContain('hint');
    expect(errored.root.findByType(TextInput).props.accessibilityHint).toBe('Andika jina lako');
  });

  it('disabled fields are not editable', () => {
    const tree = render(<Input label="Barua pepe" disabled />);
    expect(tree.root.findByType(TextInput).props.editable).toBe(false);
  });
});

describe('Status pills', () => {
  it.each(Object.keys(APPOINTMENT_STATUS_STYLE))('appointment %s renders its Swahili label', (status) => {
    const tree = render(<AppointmentStatusPill status={status as never} />);
    expect(textOf(tree).length).toBeGreaterThan(0);
  });

  it('renders the payment label in Swahili', () => {
    expect(textOf(render(<PaymentStatusPill status="PENDING" />))).toContain('Inasubiri');
    expect(textOf(render(<AppointmentStatusPill status="PENDING_PAYMENT" />))).toContain('Inasubiri malipo');
  });
});

describe('Emergency UI', () => {
  it('strip: solid emergency red and two dial buttons 112 / 115', () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const tree = render(<EmergencyStrip />);
    const strip = tree.root.findAll((n) => flatStyle(n).backgroundColor === lightColors.emergencyBg);
    expect(strip.length).toBeGreaterThan(0);
    expect(lightColors.emergencyBg).toBe('#B91C1C');

    const buttons = pressables(tree);
    expect(buttons.map((b) => b.props.accessibilityLabel)).toEqual([
      'Piga 112 — huduma za dharura',
      'Piga 115 — gari la wagonjwa',
    ]);
    act(() => buttons[0]!.props.onPress());
    act(() => buttons[1]!.props.onPress());
    expect(open).toHaveBeenNthCalledWith(1, 'tel:112');
    expect(open).toHaveBeenNthCalledWith(2, 'tel:115');
    open.mockRestore();
  });

  it('call card never uses 999 / 911 / 114', () => {
    const text = textOf(render(<EmergencyCallCard />));
    expect(text).toMatch(/112/);
    expect(text).toMatch(/115/);
    expect(text).not.toMatch(/999|911|114/);
  });
});

describe('States', () => {
  it('empty state shows one action that fires', () => {
    const onPress = jest.fn();
    const tree = render(<EmptyState title="Bado huna miadi" action={{ label: 'Tafuta daktari', onPress }} />);
    expect(textOf(tree)).toContain('Bado huna miadi');
    const buttons = pressables(tree);
    expect(buttons).toHaveLength(1);
    act(() => buttons[0]!.props.onPress());
    expect(onPress).toHaveBeenCalled();
  });

  it('offline state says "Hakuna mtandao" and retries', () => {
    const onRetry = jest.fn();
    const tree = render(<ErrorState kind="offline" onRetry={onRetry} />);
    expect(textOf(tree)).toContain('Hakuna mtandao');
    act(() => pressables(tree)[0]!.props.onPress());
    expect(onRetry).toHaveBeenCalled();
  });

  it('danger banner is announced as an alert', () => {
    const tree = render(<Banner tone="danger" message="Malipo hayakufanikiwa" />);
    expect(tree.root.findAll((n) => n.props.accessibilityRole === 'alert').length).toBeGreaterThan(0);
  });
});

describe('ChipGroup', () => {
  it('reports selection with radio semantics', () => {
    const onChange = jest.fn();
    const tree = render(
      <ChipGroup
        options={[
          { value: 'a', label: 'Wote' },
          { value: 'b', label: 'Watoto' },
        ]}
        value="a"
        onChange={onChange}
      />,
    );
    const chips = pressables(tree);
    expect(chips.map((c) => c.props.accessibilityState)).toEqual([{ checked: true }, { checked: false }]);
    act(() => chips[1]!.props.onPress());
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

describe('Avatar', () => {
  it('shows initials without the honorific', () => {
    expect(textOf(render(<Avatar name="Dkt. Amina Mushi" />))).toContain('AM');
  });
});

describe('Overlays never cover the emergency strip', () => {
  it('a bottom sheet inside the shell renders below the strip; only the screen is hidden from TalkBack', () => {
    const tree = render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <EmergencyShell>
        <BottomSheet visible onClose={jest.fn()} title="Vichujio">
          <RNTextProbe />
        </BottomSheet>
      </EmergencyShell>
      </SafeAreaProvider>,
    );
    // No full-window RN Modal is used inside the shell.
    expect(tree.root.findAll((n) => n.type === Modal)).toHaveLength(0);
    // The strip's dial buttons are not inside any hidden subtree.
    const dial = pressables(tree).filter((p) => String(p.props.accessibilityLabel).startsWith('Piga 11'));
    expect(dial).toHaveLength(2);
    for (const button of dial) {
      let node: ReactTestInstance | null = button;
      while (node !== null) {
        expect(node.props.importantForAccessibility).not.toBe('no-hide-descendants');
        node = node.parent;
      }
    }
    // The screen content under the sheet IS hidden while the sheet is open.
    expect(tree.root.findAll((n) => n.props.importantForAccessibility === 'no-hide-descendants').length).toBeGreaterThan(0);
    expect(textOf(tree)).toContain('Vichujio');
  });

  it('closing the sheet removes the overlay', () => {
    const tree = render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <EmergencyShell>
        <BottomSheet visible={false} onClose={jest.fn()} title="Vichujio">
          <RNTextProbe />
        </BottomSheet>
      </EmergencyShell>
      </SafeAreaProvider>,
    );
    expect(textOf(tree)).not.toContain('Vichujio');
  });
});

describe('Destructive actions are soft, never solid red', () => {
  it('danger button is outlined red on a white surface', () => {
    const style = flatStyle(pressables(render(<Button variant="danger" label="Ghairi miadi" onPress={jest.fn()} />))[0]!);
    expect(style.backgroundColor).toBe(lightColors.surface);
    expect(style.borderColor).toBe(lightColors.dangerFg);
  });

  it('confirm dialog: the safe choice cancels, the other confirms', () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const tree = render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <EmergencyShell>
        <ConfirmDialog
          visible
          title="Ghairi miadi hii?"
          message="Huwezi kutendua hatua hii."
          confirmLabel="Ndiyo, ghairi"
          cancelLabel="Hapana, rudi"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      </EmergencyShell>
      </SafeAreaProvider>,
    );
    const byLabel = (label: string): ReactTestInstance =>
      pressables(tree).find((p) => p.props.accessibilityLabel === label && p.props.accessibilityRole === 'button' && textOf(p).includes(label))!;
    act(() => byLabel('Hapana, rudi').props.onPress());
    expect(onCancel).toHaveBeenCalledTimes(1);
    act(() => byLabel('Ndiyo, ghairi').props.onPress());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

/** Plain child for overlay tests. */
function RNTextProbe(): React.JSX.Element {
  return <Text>probe</Text>;
}
