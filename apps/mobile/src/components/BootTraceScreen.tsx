/**
 * BootTraceScreen — DIAGNOSTIC (build #11).
 *
 * Rendered by RootLayout when didPreviousBootCrash() is true: the previous cold
 * start recorded boot milestones but never reached 'render', so it crashed right
 * after the last milestone shown below. Rendering this INSTEAD of re-running the
 * risky boot path both breaks the crash loop and surfaces the exact stage on-device
 * (the TF#10 SIGABRT is invisible to Sentry and unsymbolicatable on this WSL setup).
 *
 * Remove with the rest of the build #11 instrumentation once the crash is fixed.
 */
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { COLORS, RADIUS, SPACING } from '@design/tokens';

type Props = {
  readonly trail: string | null;
  readonly onClear: () => void;
};

export function BootTraceScreen({ trail, onClear }: Props) {
  const [cleared, setCleared] = useState(false);
  const lastStage = trail ? (trail.split(' > ').pop() ?? trail) : 'unknown';

  if (cleared) {
    return (
      <View style={styles.fill}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>Trace cleared</Text>
          <Text style={styles.lead}>
            Fully close and reopen the app to boot normally.
          </Text>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Boot crash trace (diagnostic build #11)</Text>
        <Text style={styles.lead}>
          The previous launch crashed right after this milestone:
        </Text>
        <Text style={styles.stage}>{lastStage}</Text>
        <Text style={styles.label}>full trail</Text>
        <Text style={styles.trail}>{trail ?? '(none)'}</Text>
        <Text style={styles.note}>
          If you force-quit during unlock, this is a false alarm — tap retry.
        </Text>
        <Pressable
          style={styles.button}
          onPress={() => {
            onClear();
            setCleared(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Clear boot trace and retry"
        >
          <Text style={styles.buttonText}>Clear &amp; retry</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg, paddingTop: 80, gap: SPACING.md },
  title: { color: COLORS.textPrimary, fontSize: 20, fontWeight: '700' },
  lead: { color: COLORS.textMuted, fontSize: 14 },
  stage: { color: COLORS.accent, fontSize: 22, fontWeight: '700' },
  label: { color: COLORS.textMuted, fontSize: 12, marginTop: SPACING.md },
  trail: { color: COLORS.textPrimary, fontSize: 13 },
  note: { color: COLORS.textMuted, fontSize: 12, marginTop: SPACING.md },
  button: {
    marginTop: SPACING.lg,
    minHeight: 44,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: COLORS.background, fontSize: 16, fontWeight: '700' },
});
