import { Fragment } from 'react';
import { StatusBar } from 'expo-status-bar';
import { translate, type Locale } from '../i18n';
import { Body, Screen, Title } from './ui';

const LOCALES: readonly Locale[] = ['sw', 'en'];

/**
 * Shown instead of the whole app when EXPO_PUBLIC_API_URL is missing or
 * invalid. Both languages at once, Swahili first: nothing else in the app
 * works, including the language switch.
 */
export function MisconfiguredScreen(): React.JSX.Element {
  return (
    <Screen>
      <StatusBar style="dark" />
      {LOCALES.map((locale) => (
        <Fragment key={locale}>
          <Title>{translate('config.misconfigured.title', undefined, locale)}</Title>
          <Body>{translate('config.misconfigured.body', undefined, locale)}</Body>
          <Body muted>{translate('config.misconfigured.emergency', undefined, locale)}</Body>
        </Fragment>
      ))}
    </Screen>
  );
}
