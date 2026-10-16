import React, { memo, useCallback, useRef, useState } from 'react';
import { FlatList, Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withRepeat, withSpring, withTiming } from 'react-native-reanimated';
import { useChat } from './src/useChat';
import { VoiceMessage, VoicePlaybackProvider, useStopVoicePlayback } from './src/VoiceMessage';
import { useVoiceRecorder, VoiceRecordingBar } from './src/VoiceRecorder';
import type { ChatMessage, StreamMetrics } from './src/types';

const C = {bg: '#11151b', panel: '#1b222b', assistant: '#242d38', user: '#315b5a', text: '#f0f0e9', muted: '#a6b2b8', accent: '#a4d4be', danger: '#ffadad'};

function Pulse() {
  const opacity = useSharedValue(0.35);
  React.useEffect(() => { opacity.value = withRepeat(withTiming(1, {duration: 650}), -1, true); return () => cancelAnimation(opacity); }, [opacity]);
  const style = useAnimatedStyle(() => ({opacity: opacity.value}));
  return <Animated.View style={[styles.pulse, style]} />;
}

const Bubble = memo(function Bubble({message, onReply, onRetry}: {message: ChatMessage; onReply: (message: ChatMessage) => void; onRetry: (message: ChatMessage) => void}) {
  const translation = useSharedValue(0);
  const reply = useCallback(() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined); onReply(message); }, [message, onReply]);
  const gesture = Gesture.Pan().activeOffsetX([-14, 14]).failOffsetY([-12, 12])
    .onUpdate(event => { translation.value = Math.max(0, Math.min(88, event.translationX)); })
    .onEnd(() => { if (translation.value > 65) runOnJS(reply)(); translation.value = withSpring(0); });
  const animatedStyle = useAnimatedStyle(() => ({transform: [{translateX: translation.value}]}));
  const isUser = message.role === 'user';
  return <GestureDetector gesture={gesture}><Animated.View style={[styles.bubbleOuter, isUser && styles.userOuter, animatedStyle]}>
    <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
      {isUser && message.replyToId && <Text style={styles.replyLabel}>↪ Jawab</Text>}
      {message.kind === 'audio' ? <VoiceMessage message={message} /> : <Text style={styles.messageText}>{message.content || 'Soch raha hoon...'}</Text>}
      <View style={styles.metaLine}>{message.status === 'streaming' && <Pulse />}
        <Text style={styles.metaText}>{new Date(message.createdAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})} · {message.status === 'pending' ? '◷ Pending hai' : message.status === 'syncing' ? '↻ Sync ho raha hai' : message.status === 'failed' ? 'Nahi gaya' : message.status === 'streaming' ? 'Jawab aa raha hai' : 'Local sync hua'}</Text></View>
      {message.error && <Text style={styles.errorText}>{message.error}</Text>}
      {message.status === 'failed' && <Pressable accessibilityRole="button" onPress={() => onRetry(message)}><Text style={styles.retryText}>Dobara try karo</Text></Pressable>}
    </View>
  </Animated.View></GestureDetector>;
});

function Metrics({metrics, renders}: {metrics: StreamMetrics; renders: number}) {
  return <View style={styles.metrics}><Text style={styles.metricsText}>TTFT {metrics.ttftMs === null ? '—' : `${Math.round(metrics.ttftMs)} ms`}</Text><Text style={styles.metricsText}>{metrics.tokensPerSecond.toFixed(1)} tok/s</Text><Text style={styles.metricsText}>Renders {renders}</Text></View>;
}

function ChatScreen() {
  const {messages, online, ready, hasOlder, loadingOlder, loadOlder, seedBenchmark, error, metrics, send, sendVoice, retry, clearError} = useChat();
  const [draft, setDraft] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const atBottom = useRef(true);
  const list = useRef<FlatList<ChatMessage>>(null);
  const stopVoicePlayback = useStopVoicePlayback();
  const submitVoice = useCallback(async (uri: string, durationMs: number, waveform: number[]) => {
    const saved = await sendVoice(uri, durationMs, waveform, replyTo?.id ?? null);
    if (saved) { setReplyTo(null); atBottom.current = true; setTimeout(() => list.current?.scrollToEnd({animated: true}), 80); }
    return saved;
  }, [replyTo, sendVoice]);
  const startVoice = useCallback(() => { Keyboard.dismiss(); stopVoicePlayback(); }, [stopVoicePlayback]);
  const voice = useVoiceRecorder(submitVoice, startVoice);
  const renders = useRef(0);
  renders.current += 1;
  const onReply = useCallback((message: ChatMessage) => setReplyTo(message), []);
  const onRetry = useCallback((message: ChatMessage) => { void retry(message); }, [retry]);
  const submit = useCallback(async () => {
    if (sendingRef.current || !draft.trim()) return;
    sendingRef.current = true;
    setSending(true);
    try { const saved = await send(draft, replyTo?.id ?? null); if (saved) { setDraft(''); setReplyTo(null); atBottom.current = true; setTimeout(() => list.current?.scrollToEnd({animated: true}), 80); } }
    finally { sendingRef.current = false; setSending(false); }
  }, [draft, replyTo, send, sending]);
  const renderItem = useCallback(({item}: {item: ChatMessage}) => <Bubble message={item} onReply={onReply} onRetry={onRetry} />, [onReply, onRetry]);
  return <SafeAreaView style={styles.screen}><StatusBar style="light" /><KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <View style={styles.header}><Pressable onLongPress={() => { if (__DEV__) void seedBenchmark(); }}><Text style={styles.title}>convico<Text style={styles.titleAccent}>.ai</Text></Text><Text style={styles.subtitle}>Local demo · chats isi device par hain</Text></Pressable><View style={[styles.connection, online ? styles.online : styles.offline]}><Text style={styles.connectionText}>{online ? '● Online' : '◷ Offline'}</Text></View></View>
    <Metrics metrics={metrics} renders={renders.current} />
    {error && <Pressable onPress={clearError} style={styles.banner}><Text style={styles.errorText}>{error}  ×</Text></Pressable>}
    {voice.error && <Pressable onPress={voice.clearError} style={styles.banner}><Text style={styles.errorText}>{voice.error}  ×</Text></Pressable>}
    <FlatList ref={list} data={messages} renderItem={renderItem} keyExtractor={item => item.id} style={styles.fill} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled"
      initialNumToRender={16} maxToRenderPerBatch={12} windowSize={9} removeClippedSubviews={Platform.OS === 'android'}
      maintainVisibleContentPosition={{minIndexForVisible: 0}}
      ListHeaderComponent={loadingOlder ? <Text style={styles.historyLabel}>Purane messages aa rahe hain…</Text> : hasOlder ? <Text style={styles.historyLabel}>Purane messages ke liye upar scroll karo</Text> : undefined}
      onScroll={event => { const {contentOffset, contentSize, layoutMeasurement} = event.nativeEvent; atBottom.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 100; if (contentOffset.y < 160 && hasOlder) void loadOlder(); }} scrollEventThrottle={100}
      onContentSizeChange={() => { if (atBottom.current) list.current?.scrollToEnd({animated: false}); }}
      ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyEyebrow}>AAPKI CHAT</Text><Text style={styles.emptyTitle}>{ready ? 'Kya baat karein?' : 'Chat khul rahi hai…'}</Text><Text style={styles.emptyCopy}>Sawal poocho, idea samjho, ya plan banao. Offline hone par bhi messages yahin rahenge.</Text></View>} />
    {replyTo && <View style={styles.replyBar}><Text style={styles.replyText} numberOfLines={1}>Jawab: {replyTo.kind === 'audio' ? 'Voice message' : replyTo.content}</Text><Pressable onPress={() => setReplyTo(null)}><Text style={styles.close}>×</Text></Pressable></View>}
    {voice.phase === 'idle' ? <View style={styles.composerWrap}>
      {showEmoji && <View style={styles.emojiTray}>{['😀', '😂', '❤️', '👍', '🙏', '🔥', '🎉', '😊', '🤔', '👏', '💚', '👋'].map(emoji => <Pressable key={emoji} accessibilityRole="button" accessibilityLabel={`${emoji} add karo`} onPress={() => setDraft(value => value + emoji)} style={styles.emojiChoice}><Text style={styles.emojiChoiceText}>{emoji}</Text></Pressable>)}</View>}
      <View style={styles.composer}><View style={styles.inputShell}>
        <Pressable accessibilityRole="button" accessibilityLabel="Emoji chuno" onPress={() => { Keyboard.dismiss(); setShowEmoji(value => !value); }} style={styles.emojiButton}><MaterialCommunityIcons name="emoticon-outline" size={26} color={C.muted} /></Pressable>
        <TextInput style={styles.input} value={draft} onChangeText={setDraft} onFocus={() => setShowEmoji(false)} placeholder="Message" placeholderTextColor={C.muted} multiline maxLength={2000} accessibilityLabel="Message likho" />
      </View>
      {draft.trim() ? <Pressable accessibilityRole="button" accessibilityLabel="Message bhejo" disabled={!ready || sending} onPress={() => { void submit(); }} style={[styles.send, (!ready || sending) && styles.disabled]}><MaterialCommunityIcons name="send" size={25} color="#071910" /></Pressable>
        : <Pressable accessibilityRole="button" accessibilityLabel="Voice record karo" disabled={!ready} onPress={() => { setShowEmoji(false); void voice.start(); }} style={[styles.mic, !ready && styles.disabled]}><MaterialCommunityIcons name="microphone" size={27} color="#071910" /></Pressable>}
      </View></View> : <VoiceRecordingBar voice={voice} />}
  </KeyboardAvoidingView></SafeAreaView>;
}

export default function App() { return <GestureHandlerRootView style={styles.fill}><SafeAreaProvider><VoicePlaybackProvider><ChatScreen /></VoicePlaybackProvider></SafeAreaProvider></GestureHandlerRootView>; }

const styles = StyleSheet.create({
  fill: {flex: 1}, screen: {flex: 1, backgroundColor: C.bg}, header: {paddingHorizontal: 18, paddingTop: 14, paddingBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  title: {fontSize: 23, fontWeight: '700', color: C.text, letterSpacing: -0.7}, titleAccent: {color: C.accent}, subtitle: {fontSize: 11, color: C.muted, marginTop: 3}, connection: {paddingVertical: 7, paddingHorizontal: 10, borderRadius: 20}, online: {backgroundColor: '#25443d'}, offline: {backgroundColor: '#594526'}, connectionText: {color: C.text, fontSize: 12},
  metrics: {marginHorizontal: 16, marginBottom: 8, backgroundColor: C.panel, borderRadius: 12, padding: 10, flexDirection: 'row', justifyContent: 'space-between'}, metricsText: {color: C.accent, fontSize: 11, fontWeight: '600'}, banner: {marginHorizontal: 16, padding: 8, backgroundColor: '#53313e', borderRadius: 8},
  listContent: {paddingHorizontal: 14, paddingBottom: 12}, bubbleOuter: {marginVertical: 5, maxWidth: '88%', alignSelf: 'flex-start'}, userOuter: {alignSelf: 'flex-end'}, bubble: {paddingHorizontal: 14, paddingVertical: 11, borderRadius: 17}, userBubble: {backgroundColor: C.user, borderBottomRightRadius: 4}, assistantBubble: {backgroundColor: C.assistant, borderBottomLeftRadius: 4},
  messageText: {color: C.text, fontSize: 15, lineHeight: 22}, replyLabel: {color: C.accent, fontSize: 11, marginBottom: 5}, metaLine: {flexDirection: 'row', alignItems: 'center', marginTop: 7}, metaText: {color: '#d1dbed', fontSize: 10}, pulse: {width: 7, height: 7, borderRadius: 4, backgroundColor: C.accent, marginRight: 5}, errorText: {color: C.danger, fontSize: 11}, retryText: {color: C.accent, marginTop: 6, fontSize: 12, fontWeight: '700'},
  empty: {paddingHorizontal: 28, paddingTop: 55, alignItems: 'flex-start'}, emptyEyebrow: {color: C.accent, fontSize: 10, fontWeight: '700', letterSpacing: 2, marginBottom: 12}, emptyTitle: {color: C.text, fontSize: 24, fontWeight: '600', marginBottom: 10, letterSpacing: -0.5}, emptyCopy: {color: C.muted, fontSize: 13, lineHeight: 20}, replyBar: {backgroundColor: C.panel, marginHorizontal: 12, padding: 9, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}, replyText: {color: C.accent, flex: 1, fontSize: 12}, close: {color: C.text, fontSize: 20, paddingHorizontal: 8}, composerWrap: {backgroundColor: C.bg}, composer: {flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 9, paddingVertical: 8, gap: 8}, inputShell: {flex: 1, flexDirection: 'row', alignItems: 'flex-end', backgroundColor: '#202a2c', borderRadius: 25, minHeight: 48, paddingLeft: 3}, emojiButton: {width: 42, height: 48, alignItems: 'center', justifyContent: 'center'}, emojiText: {fontSize: 27, color: C.muted}, emojiTray: {flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around', paddingHorizontal: 12, paddingVertical: 7, backgroundColor: C.panel}, emojiChoice: {width: '16%', alignItems: 'center', paddingVertical: 7}, emojiChoiceText: {fontSize: 22}, input: {flex: 1, maxHeight: 125, minHeight: 48, color: C.text, paddingRight: 12, paddingTop: 12, paddingBottom: 10, fontSize: 16}, send: {backgroundColor: '#02c767', height: 48, width: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center'}, disabled: {opacity: 0.45}, sendText: {color: '#071910', fontSize: 25, fontWeight: '900'},
  historyLabel: {color: C.muted, textAlign: 'center', fontSize: 11, paddingVertical: 8},
  mic: {backgroundColor: '#02c767', height: 48, width: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center'},
  micText: {color: '#071910', fontSize: 23},
});
