import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import type { Purpose } from '@/lib/permissions';

// In-app purpose statement shown before an OS permission prompt. The OS prompt
// only fires from the affirmative button; "Not now" leaves the step red.
export function PurposeSheet({ purpose, onConfirm, onDismiss }: {
  purpose: Purpose | null;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const colors = useColors();
  return (
    <Modal visible={purpose !== null} transparent animationType="slide" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>{purpose?.title}</Text>
          {purpose?.body.map(paragraph => (
            <Text key={paragraph} style={[styles.body, { color: colors.foreground }]}>{paragraph}</Text>
          ))}
          <View style={styles.actions}>
            <Pressable testID="purpose-dismiss" onPress={onDismiss} style={[styles.button, { borderColor: colors.border, borderWidth: 1 }]}>
              <Text style={[styles.buttonText, { color: colors.foreground }]}>Not now</Text>
            </Pressable>
            <Pressable testID="purpose-confirm" onPress={onConfirm} style={[styles.button, { backgroundColor: colors.primary }]}>
              <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>{purpose?.confirm}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { borderWidth: 1, padding: 20, paddingBottom: 32, gap: 12 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 20 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  button: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
});
