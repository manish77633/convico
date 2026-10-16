import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { File } from 'expo-file-system';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

type Phase = 'idle' | 'recording' | 'ready' | 'sending';
type VoiceDraft = {uri: string; durationMs: number; waveform: number[]};
const LIMIT_MS = 120_000;

export function formatVoiceTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function levelFromDb(db: number | undefined): number {
  if (db === undefined || !Number.isFinite(db)) return 0.18;
  return Math.max(0.12, Math.min(1, (db + 58) / 58));
}

export function useVoiceRecorder(onSend: (uri: string, durationMs: number, waveform: number[]) => Promise<boolean>, onStart: () => void) {
  const recorder = useAudioRecorder({...RecordingPresets.HIGH_QUALITY, directory: 'document', isMeteringEnabled: true});
  const status = useAudioRecorderState(recorder, 120);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [draft, setDraft] = useState<VoiceDraft | null>(null);
  const busy = useRef(false);
  const phaseRef = useRef<Phase>('idle');
  const levelsRef = useRef<number[]>([]);
  const lastSample = useRef(0);
  const setPhaseSafe = (next: Phase) => { phaseRef.current = next; setPhase(next); };

  const stop = useCallback(async () => {
    if (phaseRef.current !== 'recording' || busy.current) return;
    busy.current = true;
    try {
      const durationMs = recorder.getStatus().durationMillis;
      await recorder.stop();
      void setAudioModeAsync({allowsRecording: false}).catch(() => undefined);
      const uri = recorder.uri;
      if (!uri || !new File(uri).exists || durationMs < 500) {
        if (uri) new File(uri).delete();
        setPhaseSafe('idle');
        setError('Kam se kam aadha second record karo');
        return;
      }
      setDraft({uri, durationMs, waveform: levelsRef.current.length ? [...levelsRef.current] : [0.3]});
      setPhaseSafe('ready');
    } catch (cause) {
      setPhaseSafe('idle');
      setError(`Recording ruk gayi: ${String(cause)}`);
    } finally { busy.current = false; }
  }, [recorder]);

  const start = useCallback(async () => {
    if (phaseRef.current !== 'idle' || busy.current) return;
    busy.current = true;
    setError(null);
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) { setError('Mic permission allow karo'); return; }
      onStart();
      await setAudioModeAsync({allowsRecording: true, playsInSilentMode: true, interruptionMode: 'doNotMix'});
      await recorder.prepareToRecordAsync();
      levelsRef.current = [];
      setWaveform([]);
      recorder.record();
      setPhaseSafe('recording');
    } catch (cause) { void setAudioModeAsync({allowsRecording: false}).catch(() => undefined); setError(`Recording shuru nahi hui: ${String(cause)}`); }
    finally { busy.current = false; }
  }, [onStart, recorder]);

  const cancel = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (phaseRef.current === 'recording') {
        await recorder.stop();
        void setAudioModeAsync({allowsRecording: false}).catch(() => undefined);
        if (recorder.uri) new File(recorder.uri).delete();
      } else if (draft?.uri) new File(draft.uri).delete();
      setDraft(null); levelsRef.current = []; setWaveform([]); setError(null); setPhaseSafe('idle');
    } catch (cause) { setError(`Recording cancel nahi hui: ${String(cause)}`); }
    finally { busy.current = false; }
  }, [draft, recorder]);

  const send = useCallback(async () => {
    if (phaseRef.current !== 'ready' || !draft || busy.current) return;
    busy.current = true; setPhaseSafe('sending');
    try {
      if (await onSend(draft.uri, draft.durationMs, draft.waveform)) {
        setDraft(null); levelsRef.current = []; setWaveform([]); setError(null); setPhaseSafe('idle');
      } else { setError('Voice message save nahi hua. Dobara try karo'); setPhaseSafe('ready'); }
    } catch (cause) { setError(`Voice message nahi gaya: ${String(cause)}`); setPhaseSafe('ready'); }
    finally { busy.current = false; }
  }, [draft, onSend]);

  useEffect(() => {
    if (phase !== 'recording') return;
    const timer = setTimeout(() => {
      if (status.mediaServicesDidReset) { setError('Mic interrupt hua. Recording rok di'); void stop(); return; }
      if (status.durationMillis >= LIMIT_MS) { void stop(); return; }
      const now = Date.now();
      if (now - lastSample.current >= 170) {
        lastSample.current = now;
        levelsRef.current.push(levelFromDb(status.metering));
        setWaveform(levelsRef.current.slice(-32));
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [phase, status.durationMillis, status.mediaServicesDidReset, status.metering, stop]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active' && phaseRef.current === 'recording') {
        setError('App background mein gayi. Recording rok di');
        void stop();
      }
    });
    return () => subscription.remove();
  }, [stop]);

  return {phase, error, waveform, durationMs: phase === 'ready' || phase === 'sending' ? draft?.durationMs ?? 0 : status.durationMillis,
    start, stop, cancel, send, clearError: () => setError(null)};
}

function Dot() {
  const opacity = useSharedValue(1);
  useEffect(() => { opacity.value = withRepeat(withTiming(0.35, {duration: 650}), -1, true); }, [opacity]);
  const style = useAnimatedStyle(() => ({opacity: opacity.value}));
  return <Animated.View style={[styles.dot, style]} />;
}

export function VoiceRecordingBar({voice}: {voice: ReturnType<typeof useVoiceRecorder>}) {
  const recording = voice.phase === 'recording';
  return <View style={styles.root}>
    <View style={styles.top}><View style={styles.left}>{recording && <Dot />}<Text style={styles.title}>{recording ? 'Voice record kar rahe ho...' : voice.phase === 'sending' ? 'Voice save ho rahi hai...' : 'Voice ready hai'}</Text></View><Text style={styles.timer}>{formatVoiceTime(voice.durationMs)}</Text></View>
    <View style={styles.wave} accessibilityLabel="Voice waveform">
      {Array.from({length: 32}, (_, index) => <View key={index} style={[styles.bar, {height: 5 + (voice.waveform[Math.max(0, voice.waveform.length - 32 + index)] ?? 0.15) * 22}]} />)}
    </View>
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" accessibilityLabel="Recording cancel karo" onPress={() => { void voice.cancel(); }}><Text style={styles.cancel}>✕  Cancel karo</Text></Pressable>
      {recording ? <Pressable accessibilityRole="button" accessibilityLabel="Recording roko" onPress={() => { void voice.stop(); }} style={styles.actionButton}><Text style={styles.actionText}>■  Roko</Text></Pressable>
        : <Pressable accessibilityRole="button" accessibilityLabel="Voice message bhejo" disabled={voice.phase === 'sending'} onPress={() => { void voice.send(); }} style={styles.actionButton}><Text style={styles.actionText}>↑  Bhejo</Text></Pressable>}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: {backgroundColor: '#1b222b', paddingHorizontal: 16, paddingVertical: 10, gap: 9},
  top: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}, left: {flexDirection: 'row', alignItems: 'center', gap: 7},
  dot: {width: 8, height: 8, borderRadius: 4, backgroundColor: '#f27e73'}, title: {color: '#f0f0e9', fontSize: 12, fontWeight: '600'}, timer: {color: '#a4d4be', fontSize: 13, fontVariant: ['tabular-nums']},
  wave: {height: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}, bar: {width: 3, borderRadius: 2, backgroundColor: '#a4d4be'},
  actions: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}, cancel: {color: '#ffadad', fontSize: 12, paddingVertical: 8},
  actionButton: {backgroundColor: '#315b5a', borderRadius: 18, paddingHorizontal: 15, paddingVertical: 8}, actionText: {color: '#f0f0e9', fontSize: 12, fontWeight: '700'},
});
