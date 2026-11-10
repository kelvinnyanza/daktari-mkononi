/**
 * DEV-ONLY design system preview (route /dev/style-preview). Loaded through an
 * `if (__DEV__)` require in app/dev/style-preview.tsx, so Metro strips this
 * module (and its mock copy) from production bundles.
 */
import type { AppointmentStatus, PaymentStatusValue } from '@daktari/schemas';
import { useRouter } from 'expo-router';
import { useState, type PropsWithChildren } from 'react';
import { View } from 'react-native';
import { useI18nStore, useT } from '../i18n';
import { formatTzs } from '../lib/money';
import { contrastRatio } from '../theme/tokens';
import { elevation, layout, lightColors, radius, space, type, useTheme, type TypeVariant } from '../theme/theme';
import {
  APPOINTMENT_STATUS_STYLE,
  AppointmentStatusPill,
  Avatar,
  Badge,
  Banner,
  BottomSheet,
  Button,
  Card,
  ChipGroup,
  EmergencyCallCard,
  EmergencyFab,
  EmptyState,
  ErrorState,
  Header,
  Icon,
  IconButton,
  Input,
  ListItem,
  Logo,
  LogoMark,
  PAYMENT_STATUS_STYLE,
  PaymentStatusPill,
  Screen,
  Section,
  SkeletonCard,
  SkeletonGroup,
  SkeletonListItem,
  Stack,
  Text,
  type IconName,
} from '../ui';
import { usePreviewCopy, type PreviewCopy } from './preview-copy';

type Frame = 'phone' | 'full';
type ApptState = 'pending' | 'processing' | 'join' | 'done';

const noop = (): void => undefined;

export function StylePreview(): React.JSX.Element {
  const c = usePreviewCopy();
  const t = useT();
  const router = useRouter();
  const locale = useI18nStore((state) => state.locale);
  const setLocale = useI18nStore((state) => state.setLocale);
  const [frame, setFrame] = useState<Frame>('phone');

  return (
    <Screen
      edges={['top', 'left', 'right']}
      header={
        <Header
          title={c.title}
          onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        />
      }
    >
      <Text tone="secondary">{c.intro}</Text>
      <Card tone="muted">
        <Text variant="label">{c.language}</Text>
        <ChipGroup
          options={[
            { value: 'sw', label: 'Kiswahili' },
            { value: 'en', label: 'English' },
          ]}
          value={locale}
          onChange={setLocale}
        />
        <Text variant="label">{c.frame}</Text>
        <ChipGroup
          options={[
            { value: 'phone', label: c.framePhone },
            { value: 'full', label: c.frameFull },
          ]}
          value={frame}
          onChange={setFrame}
        />
      </Card>

      <BrandSection c={c} />
      <ColorSection c={c} />
      <TypeSection c={c} />
      <SpacingSection c={c} />
      <ButtonSection c={c} />
      <InputSection c={c} />
      <ChipStatusSection c={c} />
      <ListCardSection c={c} />
      <BannerSection c={c} />
      <HeaderSection c={c} t={t} />
      <StatesSection c={c} />
      <SkeletonSection c={c} />
      <SheetSection c={c} />
      <MockupSection c={c} frame={frame} />
    </Screen>
  );
}

function SectionTitle({ children }: PropsWithChildren): React.JSX.Element {
  return (
    <Text variant="title" accessibilityRole="header">
      {children}
    </Text>
  );
}

// ─── Brand ──────────────────────────────────────────────────────────────────
function BrandSection({ c }: { c: PreviewCopy }): React.JSX.Element {
  return (
    <Section title={<SectionTitle>{c.sBrand}</SectionTitle>}>
      <Card>
        <View style={{ alignItems: 'center', paddingVertical: space[6] }}>
          <Logo size="lg" stacked tagline />
        </View>
      </Card>
      <Card>
        <Logo size="md" />
        <Logo size="sm" />
        <View style={{ flexDirection: 'row', gap: space[4], alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <LogoMark size={96} />
          <LogoMark size={64} />
          <LogoMark size={48} />
          <LogoMark size={32} />
          <LogoMark size={24} />
        </View>
      </Card>
    </Section>
  );
}

// ─── Colour ─────────────────────────────────────────────────────────────────
const ROLE_GROUPS: ReadonlyArray<readonly (keyof typeof lightColors)[]> = [
  ['primary', 'primaryPressed', 'primarySoft', 'primarySoftPressed', 'onPrimarySoft', 'accent'],
  ['background', 'surface', 'surfaceMuted', 'border', 'borderStrong', 'disabledFill'],
  ['text', 'textSecondary', 'textDisabled', 'focus'],
  ['successFg', 'successBg', 'warningFg', 'warningBg', 'dangerFg', 'dangerBg', 'infoFg', 'infoBg', 'neutralFg', 'neutralBg'],
  ['emergencyBg', 'emergencyPressed', 'onEmergency'],
];

function ColorSection({ c }: { c: PreviewCopy }): React.JSX.Element {
  const { colors } = useTheme();
  return (
    <Section title={<SectionTitle>{c.sColors}</SectionTitle>}>
      {ROLE_GROUPS.map((group) => (
        <Card key={group[0]}>
          {group.map((role) => {
            const hex = lightColors[role];
            const ratio = hex.startsWith('#') ? contrastRatio(hex, colors.surface).toFixed(1) : '—';
            return (
              <View key={role} style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
                <View
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: radius.md,
                    backgroundColor: hex,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{role}</Text>
                  <Text variant="caption" tone="secondary">
                    {hex} · {c.contrast} {ratio}:1
                  </Text>
                </View>
              </View>
            );
          })}
        </Card>
      ))}
    </Section>
  );
}

// ─── Type ───────────────────────────────────────────────────────────────────
function TypeSection({ c }: { c: PreviewCopy }): React.JSX.Element {
  const variants = Object.keys(type) as TypeVariant[];
  return (
    <Section title={<SectionTitle>{c.sType}</SectionTitle>}>
      <Card>
        {variants.map((variant) => (
          <View key={variant} style={{ gap: 2 }}>
            <Text variant="caption" tone="secondary">
              {variant} · {type[variant].fontSize}/{type[variant].lineHeight}
            </Text>
            <Text variant={variant}>{c.typeSample}</Text>
          </View>
        ))}
      </Card>
    </Section>
  );
}

// ─── Spacing / radius / elevation ───────────────────────────────────────────
function SpacingSection({ c }: { c: PreviewCopy }): React.JSX.Element {
  const { colors } = useTheme();
  return (
    <Section title={<SectionTitle>{c.sSpacing}</SectionTitle>}>
      <Card>
        {([1, 2, 3, 4, 6, 8, 12, 16] as const).map((step) => (
          <View key={step} style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
            <Text variant="caption" tone="secondary" style={{ minWidth: 72 }}>
              space[{step}] {space[step]}
            </Text>
            <View style={{ width: space[step], height: 16, backgroundColor: colors.primary, borderRadius: 2 }} />
          </View>
        ))}
      </Card>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[3] }}>
        {(Object.keys(radius) as (keyof typeof radius)[]).map((key) => (
          <View
            key={key}
            style={{
              width: 88,
              height: 64,
              borderRadius: Math.min(radius[key], 32),
              backgroundColor: colors.primarySoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text variant="caption" tone="primary">
              {key}
            </Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[4] }}>
        {(['none', 'sm', 'md'] as const).map((key) => (
          <View
            key={key}
            style={{
              width: 96,
              height: 64,
              borderRadius: radius.lg,
              backgroundColor: colors.surface,
              alignItems: 'center',
              justifyContent: 'center',
              ...elevation[key],
            }}
          >
            <Text variant="caption">elevation.{key}</Text>
          </View>
        ))}
      </View>
    </Section>
  );
}

// ─── Buttons ────────────────────────────────────────────────────────────────
function ButtonSection({ c }: { c: PreviewCopy }): React.JSX.Element {
  const rows: Array<{ variant: 'primary' | 'secondary' | 'ghost' | 'danger'; label: string; icon: IconName }> = [
    { variant: 'primary', label: c.btnPrimary, icon: 'credit-card' },
    { variant: 'secondary', label: c.btnSecondary, icon: 'calendar' },
    { variant: 'ghost', label: c.btnGhost, icon: 'info' },
    { variant: 'danger', label: c.btnDanger, icon: 'x-circle' },
  ];
  return (
    <Section title={<SectionTitle>{c.sButtons}</SectionTitle>}>
      <Text variant="caption" tone="secondary">
        {c.pressHint}
      </Text>
      {rows.map((row) => (
        <Card key={row.variant}>
          <Text variant="label" tone="secondary">
            {row.variant}
          </Text>
          <Button variant={row.variant} label={row.label} onPress={noop} />
          <Button variant={row.variant} label={c.stateIcon} icon={row.icon} onPress={noop} />
          <Button variant={row.variant} label={c.stateLoading} loading onPress={noop} />
          <Button variant={row.variant} label={c.stateDisabled} disabled onPress={noop} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            <Button variant={row.variant} size="sm" label={c.stateDefault} fullWidth={false} onPress={noop} />
            <Button variant={row.variant} size="sm" label={c.stateIcon} icon={row.icon} fullWidth={false} onPress={noop} />
          </View>
        </Card>
      ))}
      <Card>
        <Button label={c.btnLong} icon="video" onPress={noop} />
        <View style={{ flexDirection: 'row', gap: space[2] }}>
          <IconButton icon="share-2" accessibilityLabel={c.btnGhost} onPress={noop} />
          <IconButton icon="heart" variant="tonal" accessibilityLabel={c.btnGhost} onPress={noop} />
          <IconButton icon="trash-2" disabled accessibilityLabel={c.btnGhost} onPress={noop} />
        </View>
      </Card>
    </Section>
  );
}

// ─── Inputs ─────────────────────────────────────────────────────────────────
function InputSection({ c }: { c: PreviewCopy }): React.JSX.Element {
  const [phone, setPhone] = useState('');
  return (
    <Section title={<SectionTitle>{c.sInputs}</SectionTitle>}>
      <Card>
        <Input
          label={c.inputPhone}
          hint={c.inputPhoneHint}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          leadingIcon="phone"
          placeholder="0712 345 678"
        />
        <Input label={c.inputName} error={c.inputNameError} defaultValue="Rehema" />
        <Input label={c.inputSearch} leadingIcon="search" placeholder={c.inputSearch} />
        <Input label={c.inputDisabled} disabled defaultValue="rehema@example.co.tz" />
      </Card>
    </Section>
  );
}

// ─── Chips, badges, status, avatars ─────────────────────────────────────────
function ChipStatusSection({ c }: { c: PreviewCopy }): React.JSX.Element {
  const [chip, setChip] = useState('all');
  return (
    <>
      <Section title={<SectionTitle>{c.sChips}</SectionTitle>}>
        <ChipGroup
          options={[
            { value: 'all', label: c.chipAll },
            { value: 'gp', label: c.chipGp },
            { value: 'kids', label: c.chipKids },
            { value: 'women', label: c.chipWomen },
            { value: 'skin', label: c.chipSkin },
          ]}
          value={chip}
          onChange={setChip}
        />
      </Section>
      <Section title={<SectionTitle>{c.sStatus}</SectionTitle>}>
        <Card>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            {(Object.keys(APPOINTMENT_STATUS_STYLE) as AppointmentStatus[]).map((status) => (
              <AppointmentStatusPill key={status} status={status} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            {(Object.keys(PAYMENT_STATUS_STYLE) as PaymentStatusValue[]).map((status) => (
              <PaymentStatusPill key={status} status={status} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            <Badge label={c.badgeNew} tone="primary" />
            <Badge label={c.badgeVerified} tone="success" icon="shield" />
            <Badge label={c.available} tone="success" icon="circle" />
          </View>
        </Card>
      </Section>
      <Section title={<SectionTitle>{c.sAvatars}</SectionTitle>}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[3], alignItems: 'center' }}>
          <Avatar name="Dkt. Amina Mushi" size="lg" />
          <Avatar name="Dkt. Baraka Mwakyusa" />
          <Avatar name="Neema Kileo" />
          <Avatar name="Juma Salim Hamad" />
          <Avatar name="Rehema" size="sm" />
        </View>
      </Section>
    </>
  );
}

// ─── List items + cards ─────────────────────────────────────────────────────
function ListCardSection({ c }: { c: PreviewCopy }): React.JSX.Element {
  return (
    <>
      <Section title={<SectionTitle>{c.sList}</SectionTitle>}>
        <Card padded={false} style={{ overflow: 'hidden' }}>
          <ListItem
            title="Dkt. Amina Mushi"
            subtitle={c.chipKids}
            leading={<Avatar name="Dkt. Amina Mushi" />}
            meta={<AppointmentStatusPill status="CONFIRMED" />}
            onPress={noop}
            divider
          />
          <ListItem
            title={c.homeRecords}
            subtitle={c.apptRecord}
            leading={<IconTile icon="file-text" />}
            onPress={noop}
            divider
          />
          <ListItem title={c.apptFee} trailing={<Text variant="bodyStrong">{formatTzs(25000)}</Text>} />
        </Card>
      </Section>
      <Section title={<SectionTitle>{c.sCards}</SectionTitle>}>
        <Card>
          <Text variant="heading">{c.listCardTitle}</Text>
          <Text tone="secondary">{c.bannerInfo}</Text>
        </Card>
        <Card onPress={noop} accessibilityLabel={c.listCardTitle}>
          <Text variant="heading">{c.listCardTitle}</Text>
          <Text tone="secondary">{c.pressHint}</Text>
        </Card>
        <Card tone="primary">
          <Text variant="heading">{c.homeScreenTitle}</Text>
          <Text>{c.homeScreenBody}</Text>
        </Card>
        <Card tone="muted">
          <Text>{c.apptPayHint}</Text>
        </Card>
      </Section>
    </>
  );
}

function IconTile({ icon }: { icon: IconName }): React.JSX.Element {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: 48,
        height: 48,
        borderRadius: radius.md,
        backgroundColor: colors.primarySoft,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={icon} color={colors.primary} />
    </View>
  );
}

// ─── Banners ────────────────────────────────────────────────────────────────
function BannerSection({ c }: { c: PreviewCopy }): React.JSX.Element {
  return (
    <Section title={<SectionTitle>{c.sBanners}</SectionTitle>}>
      {/* The floating "Dharura" button (in the app it floats bottom-right on every screen). */}
      <View style={{ alignItems: 'flex-end' }}>
        <EmergencyFab onPress={noop} />
      </View>
      <Banner tone="info" title={c.bannerInfoTitle} message={c.bannerInfo} />
      <Banner tone="success" message={c.bannerSuccess} />
      <Banner tone="warning" title={c.bannerWarningTitle} message={c.bannerWarning} />
      <Banner tone="danger" message={c.bannerDanger} action={{ label: c.bannerAction, onPress: noop }} />
      <EmergencyCallCard message={c.emergencyCard} />
    </Section>
  );
}

// ─── Headers ────────────────────────────────────────────────────────────────
function HeaderSection({ c, t }: { c: PreviewCopy; t: ReturnType<typeof useT> }): React.JSX.Element {
  const { colors } = useTheme();
  return (
    <Section title={<SectionTitle>{c.sHeaders}</SectionTitle>}>
      <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
        <Header title={c.headerLarge} large right={<Logo size="sm" />} />
      </View>
      <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
        <Header
          title={c.headerTitle}
          subtitle={c.headerSubtitle}
          onBack={noop}
          right={<IconButton icon="share-2" accessibilityLabel={t('a11y.close')} onPress={noop} />}
        />
      </View>
    </Section>
  );
}

// ─── States ─────────────────────────────────────────────────────────────────
function StatesSection({ c }: { c: PreviewCopy }): React.JSX.Element {
  return (
    <Section title={<SectionTitle>{c.sStates}</SectionTitle>}>
      <Card>
        <EmptyState
          icon="calendar"
          title={c.emptyTitle}
          message={c.emptyBody}
          action={{ label: c.emptyAction, onPress: noop, icon: 'search' }}
        />
      </Card>
      <Card>
        <ErrorState kind="offline" onRetry={noop} />
      </Card>
      <Card>
        <ErrorState message={c.errorCustom} onRetry={noop} />
      </Card>
    </Section>
  );
}

function SkeletonSection({ c }: { c: PreviewCopy }): React.JSX.Element {
  return (
    <Section title={<SectionTitle>{c.sSkeleton}</SectionTitle>}>
      <SkeletonGroup>
        <SkeletonCard />
        <SkeletonListItem />
        <SkeletonListItem />
      </SkeletonGroup>
    </Section>
  );
}

function SheetSection({ c }: { c: PreviewCopy }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState('mpesa');
  return (
    <Section title={<SectionTitle>{c.sSheet}</SectionTitle>}>
      <Button variant="secondary" label={c.sheetOpen} icon="chevrons-up" onPress={() => setOpen(true)} />
      <BottomSheet visible={open} onClose={() => setOpen(false)} title={c.sheetTitle}>
        <Text tone="secondary">{c.sheetBody}</Text>
        <ChipGroup
          options={[
            { value: 'mpesa', label: c.sheetMpesa },
            { value: 'tigo', label: c.sheetTigo },
            { value: 'airtel', label: c.sheetAirtel },
          ]}
          value={method}
          onChange={setMethod}
        />
        <Button label={c.sheetConfirm} onPress={() => setOpen(false)} />
      </BottomSheet>
    </Section>
  );
}

// ─── Mock-ups ───────────────────────────────────────────────────────────────
function MockupSection({ c, frame }: { c: PreviewCopy; frame: Frame }): React.JSX.Element {
  const [screen, setScreen] = useState<'home' | 'doctors' | 'appt'>('home');
  const [appt, setAppt] = useState<ApptState>('pending');
  return (
    <Section title={<SectionTitle>{c.sMockups}</SectionTitle>}>
      <ChipGroup
        options={[
          { value: 'home', label: c.mockHome },
          { value: 'doctors', label: c.mockDoctors },
          { value: 'appt', label: c.mockAppt },
        ]}
        value={screen}
        onChange={setScreen}
      />
      {screen === 'appt' ? (
        <ChipGroup
          options={[
            { value: 'pending', label: c.apptPending },
            { value: 'processing', label: c.apptProcessing },
            { value: 'join', label: c.apptJoin },
            { value: 'done', label: c.apptDone },
          ]}
          value={appt}
          onChange={setAppt}
        />
      ) : null}
      <MockFrame frame={frame}>
        {screen === 'home' ? <HomeMock c={c} /> : screen === 'doctors' ? <DoctorsMock c={c} /> : <AppointmentMock c={c} state={appt} />}
      </MockFrame>
    </Section>
  );
}

function MockFrame({ children, frame }: PropsWithChildren<{ frame: Frame }>): React.JSX.Element {
  const { colors } = useTheme();
  return (
    <View
      style={{
        alignSelf: 'center',
        width: frame === 'phone' ? 360 : '100%',
        maxWidth: '100%',
        borderRadius: radius.xl,
        borderWidth: 6,
        borderColor: colors.text,
        backgroundColor: colors.background,
        overflow: 'hidden',
      }}
    >
      {children}
    </View>
  );
}

function MockBody({ children }: PropsWithChildren): React.JSX.Element {
  return <View style={{ padding: layout.gutterPhone, gap: space[6] }}>{children}</View>;
}

function HomeMock({ c }: { c: PreviewCopy }): React.JSX.Element {
  return (
    <>
      <View style={{ paddingHorizontal: layout.gutterPhone, paddingTop: space[4] }}>
        <Logo size="sm" />
      </View>
      <MockBody>
        <View style={{ gap: space[1] }}>
          <Text variant="display" accessibilityRole="header">
            {c.greeting}
          </Text>
          <Text tone="secondary">{c.homeAsk}</Text>
        </View>
        <Card tone="primary">
          <Text variant="heading">{c.homeScreenTitle}</Text>
          <Text>{c.homeScreenBody}</Text>
          <Button label={c.homeScreenCta} icon="message-circle" onPress={noop} />
        </Card>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[3] }}>
          <QuickAction icon="search" label={c.homeFind} />
          <QuickAction icon="file-text" label={c.homeRecords} />
        </View>
        <Section
          title={<Text variant="heading">{c.homeUpcoming}</Text>}
          action={<Button variant="ghost" size="sm" label={c.seeAll} fullWidth={false} onPress={noop} />}
        >
          <Card padded={false} style={{ overflow: 'hidden' }}>
            <ListItem
              title="Dkt. Amina Mushi"
              subtitle={c.headerSubtitle}
              leading={<Avatar name="Dkt. Amina Mushi" />}
              meta={<AppointmentStatusPill status="CONFIRMED" />}
              onPress={noop}
            />
          </Card>
        </Section>
      </MockBody>
    </>
  );
}

function QuickAction({ icon, label }: { icon: IconName; label: string }): React.JSX.Element {
  return (
    <Card onPress={noop} accessibilityLabel={label} style={{ flexGrow: 1, flexBasis: 140 }}>
      <IconTile icon={icon} />
      <Text variant="bodyStrong">{label}</Text>
    </Card>
  );
}

const DOCTORS = [
  { name: 'Dkt. Amina Mushi', specialty: 'chipKids', years: 12, fee: 25000, today: true },
  { name: 'Dkt. Baraka Mwakyusa', specialty: 'chipGp', years: 7, fee: 15000, today: false },
  { name: 'Dkt. Neema Kileo', specialty: 'chipWomen', years: 15, fee: 30000, today: true },
] as const;

function DoctorsMock({ c }: { c: PreviewCopy }): React.JSX.Element {
  const [chip, setChip] = useState('all');
  return (
    <>
      <Header title={c.doctorsTitle} onBack={noop} />
      <MockBody>
        <Input label={c.inputSearch} leadingIcon="search" placeholder={c.inputSearch} />
        <ChipGroup
          options={[
            { value: 'all', label: c.chipAll },
            { value: 'gp', label: c.chipGp },
            { value: 'kids', label: c.chipKids },
            { value: 'women', label: c.chipWomen },
          ]}
          value={chip}
          onChange={setChip}
        />
        <Card padded={false} style={{ overflow: 'hidden' }}>
          {DOCTORS.map((doctor, index) => (
            <ListItem
              key={doctor.name}
              title={doctor.name}
              subtitle={`${c[doctor.specialty]} · ${c.years.replace('{n}', String(doctor.years))}`}
              leading={<Avatar name={doctor.name} />}
              meta={
                <>
                  <Badge label={c.badgeVerified} tone="success" icon="shield" />
                  {doctor.today ? (
                    <Badge label={c.available} tone="primary" icon="clock" />
                  ) : (
                    <Badge label={c.nextSlot} tone="neutral" icon="calendar" />
                  )}
                  <Text variant="caption" tone="secondary">
                    {formatTzs(doctor.fee)} {c.perVisit}
                  </Text>
                </>
              }
              onPress={noop}
              divider={index < DOCTORS.length - 1}
            />
          ))}
        </Card>
        <SkeletonGroup>
          <SkeletonListItem />
        </SkeletonGroup>
      </MockBody>
    </>
  );
}

const APPT_STATUS: Record<ApptState, AppointmentStatus> = {
  pending: 'PENDING_PAYMENT',
  processing: 'PENDING_PAYMENT',
  join: 'CONFIRMED',
  done: 'COMPLETED',
};
const PAY_STATUS: Record<ApptState, PaymentStatusValue> = {
  pending: 'PENDING',
  processing: 'PROCESSING',
  join: 'COMPLETED',
  done: 'COMPLETED',
};

function AppointmentMock({ c, state }: { c: PreviewCopy; state: ApptState }): React.JSX.Element {
  const { colors } = useTheme();
  const detail = (icon: IconName, label: string, value: string): React.JSX.Element => (
    <View style={{ flexDirection: 'row', gap: space[3], alignItems: 'flex-start' }}>
      <Icon name={icon} size={20} color={colors.textSecondary} />
      <View style={{ flex: 1 }}>
        <Text variant="caption" tone="secondary">
          {label}
        </Text>
        <Text variant="bodyStrong">{value}</Text>
      </View>
    </View>
  );
  return (
    <>
      <Header title={c.apptTitle} onBack={noop} />
      <MockBody>
        <Card>
          <View style={{ flexDirection: 'row', gap: space[3], alignItems: 'center' }}>
            <Avatar name="Dkt. Amina Mushi" size="lg" />
            <View style={{ flex: 1, gap: space[1] }}>
              <Text variant="heading">Dkt. Amina Mushi</Text>
              <Text variant="caption" tone="secondary">
                {c.chipKids}
              </Text>
              <AppointmentStatusPill status={APPT_STATUS[state]} />
            </View>
          </View>
        </Card>
        <Card>
          {detail('calendar', c.apptWhen, c.headerSubtitle)}
          {detail('video', c.apptType, c.apptTypeValue)}
          {detail('credit-card', c.apptFee, formatTzs(25000))}
          <PaymentStatusPill status={PAY_STATUS[state]} />
        </Card>

        {state === 'pending' ? (
          <Stack gap={3}>
            <Banner tone="warning" title={c.bannerWarningTitle} message={c.bannerWarning} />
            <Button label={c.apptPay} icon="smartphone" onPress={noop} accessibilityHint={c.apptPayHint} />
            <Text variant="caption" tone="secondary" align="center">
              {c.apptPayHint}
            </Text>
            <Button variant="ghost" label={c.apptCancel} onPress={noop} />
          </Stack>
        ) : null}
        {state === 'processing' ? (
          <Stack gap={3}>
            <Banner tone="info" message={c.apptWaiting} icon="loader" />
            <Button label={c.apptPay} loading onPress={noop} />
          </Stack>
        ) : null}
        {state === 'join' ? (
          <Stack gap={3}>
            <Banner tone="success" message={c.bannerSuccess} />
            <Banner tone="info" message={c.apptJoinHint} icon="video" />
            <Button label={c.apptJoinCta} icon="video" onPress={noop} />
          </Stack>
        ) : null}
        {state === 'done' ? (
          <Stack gap={3}>
            <Button variant="secondary" label={c.apptRecord} icon="file-text" onPress={noop} />
            <Button variant="ghost" label={c.apptRate} icon="star" onPress={noop} />
          </Stack>
        ) : null}
      </MockBody>
    </>
  );
}
