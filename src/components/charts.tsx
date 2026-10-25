import { useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { Colors } from '@/constants/theme';
import type { SleepStage, SleepStageType } from '@/db/types';
import { formatClock, minutesOfDay } from '@/lib/date';

function useWidth(): [number, (e: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(0);
  return [width, (e) => setWidth(Math.round(e.nativeEvent.layout.width))];
}

export type Point = { label: string; value: number | null };

/** Line chart with a soft fill. Null values break the line. */
export function LineChart({
  data,
  color,
  height = 140,
  baseline,
  showLabels = true,
  format = (v: number) => String(Math.round(v)),
}: {
  data: Point[];
  color: string;
  height?: number;
  baseline?: number | null;
  showLabels?: boolean;
  format?: (v: number) => string;
}) {
  const [width, onLayout] = useWidth();
  const values = data.map((d) => d.value).filter((v): v is number => v != null);
  const pad = { top: 12, bottom: showLabels ? 20 : 6, left: 4, right: 36 };
  const innerW = Math.max(1, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;

  let min = Math.min(...values, baseline ?? Infinity);
  let max = Math.max(...values, baseline ?? -Infinity);
  if (!values.length) [min, max] = [0, 1];
  if (max - min < 1e-6) [min, max] = [min - 1, max + 1];
  const [rawMin, rawMax] = [min, max];
  const span = max - min;
  min -= span * 0.1;
  max += span * 0.1;

  const x = (i: number) => pad.left + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const y = (v: number) => pad.top + innerH - ((v - min) / (max - min)) * innerH;

  let line = '';
  let area = '';
  let segStart: number | null = null;
  data.forEach((d, i) => {
    if (d.value == null) {
      if (segStart != null) area += `L${x(i - 1)},${pad.top + innerH} L${x(segStart)},${pad.top + innerH} Z `;
      segStart = null;
      return;
    }
    const cmd = segStart == null ? 'M' : 'L';
    if (segStart == null) segStart = i;
    line += `${cmd}${x(i)},${y(d.value)} `;
    area += `${cmd}${x(i)},${y(d.value)} `;
  });
  if (segStart != null) area += `L${x(data.length - 1)},${pad.top + innerH} L${x(segStart)},${pad.top + innerH} Z`;

  const lastIdx = data.map((d) => d.value).findLastIndex((v) => v != null);
  const labelEvery = Math.max(1, Math.ceil(data.length / 7));
  // When callers pre-blank labels (e.g. only every 6 hours), show exactly the non-empty ones.
  const sparse = data.some((d) => !d.label);

  return (
    <View onLayout={onLayout} style={{ height }}>
      {width > 0 && (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity={0.35} />
              <Stop offset="1" stopColor={color} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          {baseline != null && (
            <Line
              x1={pad.left}
              x2={pad.left + innerW}
              y1={y(baseline)}
              y2={y(baseline)}
              stroke={Colors.textMuted}
              strokeDasharray="4 4"
              strokeWidth={1}
            />
          )}
          <Path d={area} fill="url(#fill)" />
          <Path d={line} stroke={color} strokeWidth={2.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
          {lastIdx >= 0 && <Circle cx={x(lastIdx)} cy={y(data[lastIdx].value!)} r={4} fill={color} />}
        </Svg>
      )}
      {width > 0 && values.length > 0 && (
        <>
          <Text style={[styles.axis, { top: y(rawMax) - 7, right: 0 }]}>{format(rawMax)}</Text>
          <Text style={[styles.axis, { top: y(rawMin) - 7, right: 0 }]}>{format(rawMin)}</Text>
        </>
      )}
      {showLabels && width > 0 && (
        <View style={[StyleSheet.absoluteFill, { top: height - 16 }]} pointerEvents="none">
          {data.map((d, i) =>
            (sparse ? !!d.label : i % labelEvery === 0 || i === data.length - 1) ? (
              <Text key={i} style={[styles.axis, { position: 'absolute', left: x(i) - 14, width: 28, textAlign: 'center' }]}>
                {d.label}
              </Text>
            ) : null,
          )}
        </View>
      )}
    </View>
  );
}

/** Vertical bars, each with its own color. */
export function BarChart({
  data,
  colors,
  height = 120,
  max,
  format = (v: number) => String(Math.round(v)),
}: {
  data: Point[];
  colors: string | ((v: number) => string);
  height?: number;
  max?: number;
  format?: (v: number) => string;
}) {
  const [width, onLayout] = useWidth();
  const top = max ?? Math.max(1, ...data.map((d) => d.value ?? 0));
  const gap = 6;
  const barW = data.length ? Math.max(4, (width - gap * (data.length - 1)) / data.length) : 0;
  const innerH = height - 34;
  return (
    <View onLayout={onLayout} style={{ height }}>
      {width > 0 &&
        data.map((d, i) => {
          const h = d.value != null ? Math.max(3, (d.value / top) * innerH) : 0;
          const color = typeof colors === 'string' ? colors : d.value != null ? colors(d.value) : Colors.textMuted;
          return (
            <View key={i} style={{ position: 'absolute', left: i * (barW + gap), width: barW, bottom: 16, alignItems: 'center' }}>
              <Text style={[styles.barValue, { color: d.value != null ? Colors.text : Colors.textMuted }]}>
                {d.value != null ? format(d.value) : '–'}
              </Text>
              <View style={{ width: '100%', height: h, backgroundColor: color, borderRadius: 4 }} />
            </View>
          );
        })}
      {width > 0 &&
        data.map((d, i) => (
          <Text key={`l${i}`} style={[styles.axis, { position: 'absolute', bottom: 0, left: i * (barW + gap), width: barW, textAlign: 'center' }]}>
            {d.label}
          </Text>
        ))}
    </View>
  );
}

const STAGE_ROWS: SleepStageType[] = ['AWAKE', 'REM', 'LIGHT', 'DEEP'];
const STAGE_COLORS: Record<SleepStageType, string> = {
  AWAKE: Colors.stageAwake,
  REM: Colors.stageRem,
  LIGHT: Colors.stageLight,
  DEEP: Colors.stageDeep,
  ASLEEP: Colors.stageLight,
  RESTLESS: Colors.stageAwake,
};

function stageRow(type: SleepStageType): number {
  if (type === 'ASLEEP') return 2;
  if (type === 'RESTLESS') return 0;
  return STAGE_ROWS.indexOf(type);
}

/** Sleep stage timeline: one lane per stage, bars across the night. */
export function Hypnogram({ stages, start, end, height = 150 }: { stages: SleepStage[]; start: string; end: string; height?: number }) {
  const [width, onLayout] = useWidth();
  const t0 = new Date(start).getTime();
  const t1 = new Date(end).getTime();
  const labelW = 46;
  const laneH = (height - 20) / STAGE_ROWS.length;
  const innerW = Math.max(1, width - labelW);
  const x = (t: number) => labelW + ((t - t0) / Math.max(1, t1 - t0)) * innerW;
  return (
    <View onLayout={onLayout} style={{ height }}>
      {width > 0 && (
        <Svg width={width} height={height - 20}>
          {STAGE_ROWS.map((_, i) => (
            <Line key={i} x1={labelW} x2={width} y1={laneH * (i + 0.5)} y2={laneH * (i + 0.5)} stroke={Colors.border} strokeWidth={1} />
          ))}
          {stages.map((s, i) => {
            const row = stageRow(s.type);
            const x0 = x(new Date(s.start).getTime());
            const x1 = x(new Date(s.end).getTime());
            return (
              <Rect
                key={i}
                x={x0}
                y={laneH * row + laneH * 0.18}
                width={Math.max(1.5, x1 - x0)}
                height={laneH * 0.64}
                rx={2}
                fill={STAGE_COLORS[s.type]}
              />
            );
          })}
        </Svg>
      )}
      {STAGE_ROWS.map((s, i) => (
        <Text key={s} style={[styles.axis, { position: 'absolute', left: 0, top: laneH * (i + 0.5) - 7 }]}>
          {s === 'AWAKE' ? 'Awake' : s === 'REM' ? 'REM' : s === 'LIGHT' ? 'Light' : 'Deep'}
        </Text>
      ))}
      <Text style={[styles.axis, { position: 'absolute', left: labelW, bottom: 0 }]}>{formatClock(minutesOfDay(start))}</Text>
      <Text style={[styles.axis, { position: 'absolute', right: 0, bottom: 0 }]}>{formatClock(minutesOfDay(end))}</Text>
    </View>
  );
}

/** Horizontal stacked bar for time in zones or sleep stages. */
export function StackBar({ parts, height = 12 }: { parts: { value: number; color: string }[]; height?: number }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  return (
    <View style={{ flexDirection: 'row', height, borderRadius: height / 2, overflow: 'hidden', backgroundColor: Colors.cardRaised }}>
      {total > 0 &&
        parts.map((p, i) => (p.value > 0 ? <View key={i} style={{ flex: p.value, backgroundColor: p.color }} /> : null))}
    </View>
  );
}

const styles = StyleSheet.create({
  axis: { position: 'absolute', fontSize: 10, color: Colors.textMuted, fontVariant: ['tabular-nums'] },
  barValue: { fontSize: 10, fontWeight: '700', marginBottom: 3, fontVariant: ['tabular-nums'] },
});
