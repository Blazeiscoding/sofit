import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { View } from 'react-native';

import { Button, Card, EmptyState, Row, SectionHeader, Screen, T } from '@/components/ui';
import { Colors, Spacing } from '@/constants/theme';
import { useData, useSync } from '@/lib/hooks';
import type { AgeFactor } from '@/scores/age';
import { getAgeSummary } from '@/scores/compute';
import { useAppStore } from '@/store/settings';

export default function AgeScreen() {
  const profile = useAppStore((s) => s.profile)!;
  const { syncing, sync } = useSync();
  const age = useData(() => getAgeSummary(profile));

  const younger = age.offset < 0;
  const deltaColor = age.offset === 0 ? Colors.textSecondary : younger ? Colors.recoveryHigh : Colors.recoveryLow;
  const sorted = [...age.factors].sort((a, b) => a.years - b.years);

  return (
    <Screen refreshing={syncing} onRefresh={() => sync()}>
      <T variant="title">SoFit Age</T>
      {age.daysWithData < 7 ? (
        <EmptyState
          icon="hourglass-outline"
          title="Gathering data"
          body={`SoFit Age needs about a week of data. ${age.daysWithData} day${age.daysWithData === 1 ? '' : 's'} so far.`}
        />
      ) : (
        <>
          <Card style={{ alignItems: 'center', paddingVertical: Spacing.xl, gap: 6 }}>
            <T variant="label">Biological age</T>
            <T variant="display" color={Colors.age}>
              {age.bioAge.toFixed(1)}
            </T>
            <Row gap={6}>
              <Ionicons name={younger ? 'trending-down' : 'trending-up'} size={16} color={deltaColor} />
              <T variant="body" color={deltaColor} style={{ fontWeight: '700' }}>
                {Math.abs(age.offset).toFixed(1)} years {younger ? 'younger' : 'older'} than your age of {age.chronological}
              </T>
            </Row>
            {age.pace != null && (
              <View style={{ marginTop: Spacing.md, alignItems: 'center' }}>
                <T variant="label">Pace of aging</T>
                <T variant="metric" color={age.pace <= 1 ? Colors.recoveryHigh : Colors.recoveryLow}>
                  {age.pace.toFixed(1)}×
                </T>
                <T variant="caption">
                  {age.pace < 1 ? 'Aging slower than the calendar' : age.pace > 1 ? 'Aging faster than the calendar' : 'In line with the calendar'}
                  {' '}(last 30 days vs prior 6 months)
                </T>
              </View>
            )}
          </Card>

          <SectionHeader title="What's driving it" right={<T variant="caption">30-day averages</T>} />
          <Card style={{ gap: Spacing.md }}>
            {sorted.map((f) => (
              <FactorRow key={f.key} factor={f} />
            ))}
          </Card>

          <Button
            title="Ask the coach how to lower it"
            icon="sparkles-outline"
            kind="secondary"
            onPress={() =>
              router.push({
                pathname: '/coach',
                params: { q: 'Look at my SoFit Age breakdown. Which 2 factors would lower it the most, and what exactly should I do for the next 4 weeks?' },
              })
            }
          />
        </>
      )}
      <T variant="caption" style={{ fontSize: 11 }}>
        SoFit Age is a fitness estimate built from population norms for VO₂ max, resting heart rate, HRV, sleep,
        activity and BMI. It is not a medical measurement.
      </T>
    </Screen>
  );
}

function FactorRow({ factor }: { factor: AgeFactor }) {
  const color = factor.status === 'good' ? Colors.recoveryHigh : factor.status === 'poor' ? Colors.recoveryLow : Colors.textSecondary;
  // Bar extends left (younger) or right (older) from the centre, scaled to ±3 years.
  const width = `${Math.min(50, (Math.abs(factor.years) / 3) * 50)}%` as const;
  return (
    <View style={{ gap: 6 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T variant="body" style={{ fontWeight: '600' }}>
          {factor.label}
        </T>
        <T variant="body" color={color} style={{ fontWeight: '700' }}>
          {factor.years > 0 ? '+' : ''}
          {factor.years.toFixed(1)} y
        </T>
      </Row>
      <View style={{ height: 6, backgroundColor: Colors.cardRaised, borderRadius: 3, flexDirection: 'row' }}>
        <View style={{ flex: 1, alignItems: 'flex-end' }}>
          {factor.years < 0 && <View style={{ width, height: 6, backgroundColor: color, borderRadius: 3 }} />}
        </View>
        <View style={{ width: 2, backgroundColor: Colors.textMuted }} />
        <View style={{ flex: 1 }}>
          {factor.years > 0 && <View style={{ width, height: 6, backgroundColor: color, borderRadius: 3 }} />}
        </View>
      </View>
      <T variant="caption">
        {factor.value.toLocaleString()} {factor.unit} · target {factor.target} {factor.unit}
      </T>
    </View>
  );
}
