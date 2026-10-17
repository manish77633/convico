import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { File } from 'expo-file-system';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

type Phase = 'idle' | 'starting' | 'recording' | 'paused' | 'ready' | 'sending';
type VoiceDraft = {uri: string; durationMs: number; waveform: number[]};
const LIMIT_MS = 120_000;
const LIMIT_BYTES = 3_000_000;

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
  const draftRef = useRef<VoiceDraft | null>(null);
  const busy = useRef(false);
  const phaseRef = useRef<Phase>('idle');
  const levelsRef = useRef<number[]>([]);
  const lastSample = useRef(0);
  const setPhaseSafe = (next: Phase) => { phaseRef.current = next; setPhase(next); };

  const stop = useCallback(async () => {
    if (!['recording', 'paused'].includes(phaseRef.current) || busy.current) return null;
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
        return null;
      }
      if (new File(uri).size > LIMIT_BYTES) {
        new File(uri).delete();
        setPhaseSafe('idle');
        setError('Recording 3 MB se badi hai. Chhoti recording banao.');
        return null;
      }
      const result = {uri, durationMs, waveform: levelsRef.current.length ? [...levelsRef.current] : [0.3]};
      draftRef.current = result;
      setDraft(result);
      setPhaseSafe('ready');
      return result;
    } catch (cause) {
      setPhaseSafe('idle');
      setError(`Recording ruk gayi: ${String(cause)}`);
      return null;
    } finally { void setAudioModeAsync({allowsRecording: false}).catch(() => undefined); busy.current = false; }
  }, [recorder]);

  const start = useCallback(async () => {
    if (phaseRef.current !== 'idle' || busy.current) return;
    busy.current = true;
    setPhaseSafe('starting');
    setError(null);
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) { setError('Mic permission allow karo'); setPhaseSafe('idle'); return; }
      onStart();
      await setAudioModeAsync({allowsRecording: true, playsInSilentMode: true, interruptionMode: 'doNotMix'});
      await recorder.prepareToRecordAsync();
      levelsRef.current = [];
      setWaveform([]);
      recorder.record();
      setPhaseSafe('recording');
    } catch (cause) { void setAudioModeAsync({allowsRecording: false}).catch(() => undefined); setPhaseSafe('idle'); setError(`Recording shuru nahi hui: ${String(cause)}`); }
    finally { busy.current = false; }
  }, [onStart, recorder]);

  const pause = useCallback(() => {
    if (phaseRef.current !== 'recording' || busy.current) return;
    busy.current = true;
    try { recorder.pause(); setPhaseSafe('paused'); }
    catch (cause) { setError(`Pause nahi hua: ${String(cause)}`); }
    finally { busy.current = false; }
  }, [recorder]);

  const resume = useCallback(() => {
    if (phaseRef.current !== 'paused' || busy.current) return;
    busy.current = true;
    try { recorder.record(); setPhaseSafe('recording'); }
    catch (cause) { setError(`Resume nahi hua: ${String(cause)}`); }
    finally { busy.current = false; }
  }, [recorder]);

  const cancel = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (phaseRef.current === 'recording' || phaseRef.current === 'paused') {
        await recorder.stop();
        void setAudioModeAsync({allowsRecording: false}).catch(() => undefined);
        if (recorder.uri) new File(recorder.uri).delete();
      } else if (draft?.uri) new File(draft.uri).delete();
      draftRef.current = null; setDraft(null); levelsRef.current = []; setWaveform([]); setError(null); setPhaseSafe('idle');
    } catch (cause) { setError(`Recording cancel nahi hui: ${String(cause)}`); }
    finally { busy.current = false; }
  }, [draft, recorder]);

  const send = useCallback(async () => {
    if (busy.current) return;
    const result = phaseRef.current === 'recording' || phaseRef.current === 'paused' ? await stop() : draft;
    if (!result || phaseRef.current !== 'ready') return;
    busy.current = true; setPhaseSafe('sending');
    try {
      if (await onSend(result.uri, result.durationMs, result.waveform)) {
        draftRef.current = null; setDraft(null); levelsRef.current = []; setWaveform([]); setError(null); setPhaseSafe('idle');
      } else { setError('Voice message save nahi hua. Dobara try karo'); setPhaseSafe('ready'); }
    } catch (cause) { setError(`Voice message nahi gaya: ${String(cause)}`); setPhaseSafe('ready'); }
    finally { busy.current = false; }
  }, [draft, onSend, stop]);

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
      if (state !== 'active' && (phaseRef.current === 'recording' || phaseRef.current === 'paused')) {
        setError('App background mein gayi. Recording rok di');
        void stop();
      }
    });
    return () => subscription.remove();
  }, [stop]);

  useEffect(() => () => {
    if (phaseRef.current === 'recording' || phaseRef.current === 'paused') {
      void recorder.stop().then(() => { if (recorder.uri) new File(recorder.uri).delete(); }).catch(() => undefined);
      void setAudioModeAsync({allowsRecording: false}).catch(() => undefined);
    } else if (phaseRef.current === 'ready' && draftRef.current) {
      try { new File(draftRef.current.uri).delete(); } catch { /* File may already be gone. */ }
    }
  }, [recorder]);

  return {phase, error, waveform, durationMs: phase === 'ready' || phase === 'sending' ? draft?.durationMs ?? 0 : status.durationMillis,
    start, stop, pause, resume, cancel, send, clearError: () => setError(null)};
}

function Dot() {
  const opacity = useSharedValue(1);
  useEffect(() => { opacity.value = withRepeat(withTiming(0.35, {duration: 650}), -1, true); }, [opacity]);
  const style = useAnimatedStyle(() => ({opacity: opacity.value}));
  return <Animated.View style={[styles.dot, style]} />;
}

export function VoiceRecordingBar({voice}: {voice: ReturnType<typeof useVoiceRecorder>}) {
  const recording = voice.phase === 'recording';
  const paused = voice.phase === 'paused';
  const locked = voice.phase === 'sending' || voice.phase === 'starting';
  return <View style={styles.root}>
    <View style={styles.top}><View style={styles.left}>{recording && <Dot />}<Text style={styles.timer}>{formatVoiceTime(voice.durationMs)}</Text></View>
      <View style={styles.wave} accessibilityLabel="Live voice waveform">
        {Array.from({length: 38}, (_, index) => <View key={index} style={[styles.bar, {height: 4 + (voice.waveform[Math.max(0, voice.waveform.length - 38 + index)] ?? 0.12) * 27}]} />)}
      </View>
    </View>
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" accessibilityLabel="Recording delete karo" disabled={locked} onPress={() => { void voice.cancel(); }} style={styles.deleteButton}><MaterialCommunityIcons name="delete-outline" size={26} color="#ff657a" /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={recording ? 'Recording pause karo' : 'Recording resume karo'} disabled={locked || (!recording && !paused)} onPress={() => { if (recording) voice.pause(); else voice.resume(); }} style={[styles.actionButton, paused && styles.resumeButton]}><MaterialCommunityIcons name={recording ? 'pause' : 'microphone'} size={22} color="#f0f0e9" /><Text style={styles.actionText}>{recording ? 'Pause' : paused ? 'Resume' : voice.phase === 'sending' ? 'Saving…' : 'Ready'}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Voice message bhejo" disabled={locked} onPress={() => { void voice.send(); }} style={styles.sendButton}><MaterialCommunityIcons name="send" size={26} color="#071910" /></Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: {backgroundColor: '#151c21', paddingHorizontal: 12, paddingTop: 15, paddingBottom: 11, gap: 15},
  top: {flexDirection: 'row', alignItems: 'center', gap: 13, minHeight: 36}, left: {flexDirection: 'row', alignItems: 'center', gap: 7},
  dot: {width: 8, height: 8, borderRadius: 4, backgroundColor: '#f27e73'}, timer: {color: '#f0f0e9', fontSize: 19, fontVariant: ['tabular-nums'], minWidth: 45},
  wave: {flex: 1, height: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', overflow: 'hidden', gap: 2}, bar: {flex: 1, maxWidth: 4, borderRadius: 2, backgroundColor: '#9bacb0'},
  actions: {flexDirection: 'row', alignItems: 'center', gap: 9}, deleteButton: {width: 46, height: 46, borderRadius: 23, backgroundColor: '#4c2031', alignItems: 'center', justifyContent: 'center'}, deleteText: {color: '#ff657a', fontSize: 24},
  actionButton: {flex: 1, height: 46, backgroundColor: '#30363a', borderRadius: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9}, resumeButton: {backgroundColor: '#064b3a'}, actionText: {color: '#f0f0e9', fontSize: 15, fontWeight: '700'},
  sendButton: {width: 48, height: 48, borderRadius: 24, backgroundColor: '#02c767', alignItems: 'center', justifyContent: 'center'}, sendText: {color: '#071910', fontSize: 23, fontWeight: '900'},
});
