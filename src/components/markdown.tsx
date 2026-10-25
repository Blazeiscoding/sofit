import { Text, View } from 'react-native';

import { cleanAiText } from '@/ai/text';
import { Colors } from '@/constants/theme';

/** Renders the small subset of Markdown the coach uses: headings, bullets, numbered lists, **bold**. */
export function Markdown({ text, color = Colors.text }: { text: string; color?: string }) {
  const lines = cleanAiText(text).replace(/\r/g, '').split('\n');
  return (
    <View style={{ gap: 6 }}>
      {lines.map((raw, i) => {
        const line = raw.trimEnd();
        if (!line.trim()) return null;
        const heading = /^#{1,4}\s+(.*)/.exec(line);
        if (heading) {
          return (
            <Text key={i} style={{ color, fontSize: 16, fontWeight: '800', marginTop: 4 }}>
              {inline(heading[1], color)}
            </Text>
          );
        }
        const bullet = /^\s*[-*•]\s+(.*)/.exec(line);
        const numbered = /^\s*(\d+)[.)]\s+(.*)/.exec(line);
        if (bullet || numbered) {
          return (
            <View key={i} style={{ flexDirection: 'row', gap: 8, paddingLeft: 2 }}>
              <Text style={{ color: Colors.textSecondary, fontSize: 15, lineHeight: 21 }}>
                {numbered ? `${numbered[1]}.` : '•'}
              </Text>
              <Text style={{ color, fontSize: 15, lineHeight: 21, flex: 1 }}>
                {inline(numbered ? numbered[2] : bullet![1], color)}
              </Text>
            </View>
          );
        }
        return (
          <Text key={i} style={{ color, fontSize: 15, lineHeight: 21 }}>
            {inline(line, color)}
          </Text>
        );
      })}
    </View>
  );
}

function inline(text: string, color: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <Text key={i} style={{ fontWeight: '800', color }}>
        {part.slice(2, -2)}
      </Text>
    ) : (
      part.replace(/(^|\s)\*([^*]+)\*/g, '$1$2')
    ),
  );
}
