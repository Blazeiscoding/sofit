import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { ageFrom } from '@/lib/date';
import type { Profile, Sex } from '@/store/settings';

import { Button, Chip, Row, T } from './ui';

function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboard = 'numeric',
  suffix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboard?: 'numeric' | 'default' | 'numbers-and-punctuation';
  suffix?: string;
}) {
  return (
    <View style={{ flex: 1, gap: 6 }}>
      <T variant="label">{label}</T>
      <View style={styles.inputWrap}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={Colors.textMuted}
          keyboardType={keyboard}
          style={styles.input}
        />
        {suffix ? <T variant="caption">{suffix}</T> : null}
      </View>
    </View>
  );
}

export function ProfileForm({ initial, onSave, saveLabel = 'Save' }: { initial: Profile | null; onSave: (p: Profile) => void; saveLabel?: string }) {
  const [birthDate, setBirthDate] = useState(initial?.birthDate ?? '');
  const [sex, setSex] = useState<Sex>(initial?.sex ?? 'male');
  const [height, setHeight] = useState(initial ? String(initial.heightCm) : '');
  const [weight, setWeight] = useState(initial ? String(initial.weightKg) : '');
  const [sleepHours, setSleepHours] = useState(initial ? String(initial.sleepBaselineMin / 60) : '7.5');

  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(birthDate) && ageFrom(birthDate) >= 13 && ageFrom(birthDate) < 110;
  const h = Number(height);
  const w = Number(weight);
  const s = Number(sleepHours);
  const valid = validDate && h > 100 && h < 250 && w > 30 && w < 300 && s >= 5 && s <= 11;

  return (
    <View style={{ gap: Spacing.md }}>
      <Field label="Birth date" value={birthDate} onChange={setBirthDate} placeholder="1995-04-21" keyboard="numbers-and-punctuation" />
      <View style={{ gap: 6 }}>
        <T variant="label">Sex (for heart-rate and VO₂ norms)</T>
        <Row>
          <Chip label="Male" active={sex === 'male'} onPress={() => setSex('male')} />
          <Chip label="Female" active={sex === 'female'} onPress={() => setSex('female')} />
        </Row>
      </View>
      <Row gap={Spacing.sm}>
        <Field label="Height" value={height} onChange={setHeight} placeholder="178" suffix="cm" />
        <Field label="Weight" value={weight} onChange={setWeight} placeholder="74" suffix="kg" />
      </Row>
      <Field label="Usual sleep need" value={sleepHours} onChange={setSleepHours} placeholder="7.5" suffix="hours" />
      <Button
        title={saveLabel}
        disabled={!valid}
        onPress={() =>
          onSave({ birthDate, sex, heightCm: h, weightKg: w, sleepBaselineMin: Math.round(s * 60) })
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.cardRaised,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    gap: 6,
  },
  input: { flex: 1, color: Colors.text, fontSize: 16, paddingVertical: 12 },
});
