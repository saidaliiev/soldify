/**
 * RootErrorBoundary — DIAGNOSTIC (build #11).
 *
 * Catches React render throws AND (via the bootError store) global JS fatals,
 * then renders the error message + stack ON-SCREEN instead of letting the
 * process abort. Reason: the TF#10 cold-start crash is not in Sentry and cannot
 * be symbolicated on this Windows/WSL setup (no Mac/atos/llvm), so making the app
 * self-report the exact JS error is the only way to read it on-device.
 *
 * Pre-public-release: replace the verbose dump with a friendly message + restart.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { COLORS, SPACING } from '@design/tokens';
import { getBootError, subscribeBootError, setBootError } from '@lib/bootError';

type Props = { readonly children: React.ReactNode };
type State = { readonly hasError: boolean };

export class RootErrorBoundary extends React.Component<Props, State> {
  private unsubscribe?: () => void;

  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    setBootError({
      message: error?.message ?? String(error),
      stack: error?.stack,
      source: 'render',
    });
  }

  componentDidMount(): void {
    // Re-render when a global (non-render) fatal is pushed into the store.
    this.unsubscribe = subscribeBootError(() => this.forceUpdate());
  }

  componentWillUnmount(): void {
    this.unsubscribe?.();
  }

  render(): React.ReactNode {
    const boot = getBootError();
    if (!this.state.hasError && !boot) {
      return this.props.children;
    }
    return (
      <View style={styles.fill}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>Boot error (diagnostic build #11)</Text>
          <Text style={styles.source}>source: {boot?.source ?? 'render'}</Text>
          <Text style={styles.message}>{boot?.message ?? 'Unknown error'}</Text>
          <Text style={styles.stack}>{boot?.stack ?? '(no stack)'}</Text>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg, paddingTop: 80, gap: SPACING.md },
  title: { color: COLORS.textPrimary, fontSize: 20, fontWeight: '700' },
  source: { color: COLORS.textMuted, fontSize: 13 },
  message: { color: COLORS.accent, fontSize: 15 },
  stack: { color: COLORS.textMuted, fontSize: 11 },
});
