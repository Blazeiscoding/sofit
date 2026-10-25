import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type ChatMessage, runAgent } from '@/ai/openrouter';
import { coachSystemPrompt } from '@/ai/prompts';
import { runTool, TOOL_DEFINITIONS } from '@/ai/tools';
import { Markdown } from '@/components/markdown';
import { Button, Chip, IconButton, Row, Screen, T } from '@/components/ui';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { addChatMessage, type ChatRow, clearChat, getChatHistory } from '@/db/repo';
import { getSecret, SecretKeys } from '@/lib/secrets';
import { useAppStore } from '@/store/settings';

const SUGGESTIONS = [
  'Why is my recovery what it is today?',
  'How should I train today?',
  'Compare this week to last week',
  'How can I get more deep sleep?',
  'Is anything in my data worth worrying about?',
];

const TOOL_LABELS: Record<string, string> = {
  get_daily_metrics: 'Reading daily metrics',
  get_sleep: 'Checking sleep',
  get_workouts: 'Looking at workouts',
  get_heart_rate_day: 'Scanning heart rate',
  get_bio_age: 'Computing SoFit Age',
  get_alerts_and_device: 'Checking alerts',
};

type UiMessage = { id: string; role: 'user' | 'assistant'; content: string };

export default function CoachScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ q?: string }>();
  const profile = useAppStore((s) => s.profile)!;
  const model = useAppStore((s) => s.settings.aiModel);
  const [apiKey, setApiKey] = useState<string | null | undefined>(undefined);
  const [messages, setMessages] = useState<UiMessage[]>(() =>
    getChatHistory().map((m: ChatRow) => ({ id: String(m.id), role: m.role, content: m.content })),
  );
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const list = useRef<FlatList<UiMessage>>(null);
  const abort = useRef<AbortController | null>(null);
  const handledQuery = useRef<string | null>(null);

  // Re-read on focus so a key added in Settings takes effect without a restart.
  useFocusEffect(
    useCallback(() => {
      getSecret(SecretKeys.openRouterKey).then(setApiKey);
    }, []),
  );

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy || !apiKey) return;
    setInput('');
    const history: ChatMessage[] = messages.slice(-12).map((m) => ({ role: m.role, content: m.content }));
    const userMsg: UiMessage = { id: `u${Date.now()}`, role: 'user', content: question };
    const replyId = `a${Date.now()}`;
    setMessages((m) => [...m, userMsg, { id: replyId, role: 'assistant', content: '' }]);
    addChatMessage('user', question);
    setBusy(true);
    setStatus('Thinking');
    abort.current = new AbortController();

    let streamed = '';
    try {
      const answer = await runAgent({
        apiKey,
        model,
        messages: [{ role: 'system', content: coachSystemPrompt(profile) }, ...history, { role: 'user', content: question }],
        tools: TOOL_DEFINITIONS,
        runTool: (name, args) => runTool(name, args, profile),
        onToolCall: (name) => {
          streamed = '';
          setStatus(TOOL_LABELS[name] ?? 'Working');
        },
        onText: (delta) => {
          streamed += delta;
          setStatus(null);
          setMessages((m) => m.map((x) => (x.id === replyId ? { ...x, content: streamed } : x)));
        },
        signal: abort.current.signal,
      });
      const final = answer || streamed || '(no answer)';
      setMessages((m) => m.map((x) => (x.id === replyId ? { ...x, content: final } : x)));
      addChatMessage('assistant', final);
    } catch (e) {
      const msg = (e as Error).name === 'AbortError' ? streamed || 'Stopped.' : `⚠️ ${(e as Error).message}`;
      setMessages((m) => m.map((x) => (x.id === replyId ? { ...x, content: msg } : x)));
    } finally {
      setBusy(false);
      setStatus(null);
      abort.current = null;
    }
  };

  // A question handed over from another screen (e.g. the Age tab).
  useEffect(() => {
    if (params.q && apiKey && handledQuery.current !== params.q) {
      handledQuery.current = params.q;
      send(params.q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.q, apiKey]);

  if (apiKey === undefined) return <Screen scroll={false}>{null}</Screen>;

  if (!apiKey) {
    return (
      <Screen>
        <T variant="title">Coach</T>
        <T variant="body" color={Colors.textSecondary}>
          The coach runs on your own OpenRouter key and reads your synced data on-device to answer.
        </T>
        <Button title="Add OpenRouter key" onPress={() => router.push('/settings')} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
        <Row style={{ justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm }}>
          <View>
            <T variant="title">Coach</T>
            <T variant="caption" numberOfLines={1}>
              {model}
            </T>
          </View>
          {messages.length > 0 && (
            <IconButton
              icon="trash-outline"
              size={18}
              onPress={() => {
                clearChat();
                setMessages([]);
              }}
            />
          )}
        </Row>
        <FlatList
          ref={list}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: Spacing.md, gap: Spacing.md, flexGrow: 1 }}
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={
            <View style={{ flex: 1, justifyContent: 'center', gap: Spacing.md }}>
              <Ionicons name="sparkles" size={28} color={Colors.recoveryHigh} />
              <T variant="heading">Ask anything about your data</T>
              <T variant="caption">The coach pulls your recovery, sleep, strain, workouts and SoFit Age before answering.</T>
            </View>
          }
          renderItem={({ item, index }) =>
            item.role === 'user' ? (
              <View style={styles.userBubble}>
                <T variant="body">{item.content}</T>
              </View>
            ) : (
              <View style={styles.assistant}>
                {item.content ? (
                  <Markdown text={item.content} />
                ) : index === messages.length - 1 && status ? (
                  <Row gap={6}>
                    <Ionicons name="pulse" size={14} color={Colors.textSecondary} />
                    <T variant="caption">{status}…</T>
                  </Row>
                ) : null}
              </View>
            )
          }
        />
        {messages.length === 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm }}>
            {SUGGESTIONS.map((s) => (
              <Chip key={s} label={s} onPress={() => send(s)} />
            ))}
          </ScrollView>
        )}
        <View style={[styles.inputBar, { paddingBottom: Platform.OS === 'ios' ? insets.bottom + 56 : Spacing.sm }]}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Ask your coach…"
            placeholderTextColor={Colors.textMuted}
            style={styles.input}
            multiline
            onSubmitEditing={() => send(input)}
          />
          <Pressable
            onPress={() => (busy ? abort.current?.abort() : send(input))}
            style={[styles.send, { backgroundColor: busy || input.trim() ? Colors.text : Colors.cardRaised }]}>
            <Ionicons name={busy ? 'stop' : 'arrow-up'} size={18} color={busy || input.trim() ? Colors.background : Colors.textMuted} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  userBubble: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    backgroundColor: Colors.cardRaised,
    borderRadius: Radius.lg,
    borderBottomRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  assistant: { alignSelf: 'stretch', paddingRight: Spacing.md },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 44,
    backgroundColor: Colors.card,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    color: Colors.text,
    fontSize: 15,
  },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
