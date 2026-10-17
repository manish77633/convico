import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import {setAssistantAudio} from './db';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { formatVoiceTime } from './VoiceRecorder';
import type { ChatMessage } from './types';

type Playback = {
  activeId: string | null;
  playing: boolean;
  loadingId: string | null;
  currentMs: number;
  error: string | null;
  toggle: (message: ChatMessage) => Promise<void>;
  stop: () => void;
};

const PlaybackContext = createContext<Playback | null>(null);
const StopPlaybackContext = createContext<(() => void) | null>(null);

export function VoicePlaybackProvider({children}: {children: React.ReactNode}) {
  const player = useAudioPlayer(null, {updateInterval: 100});
  const status = useAudioPlayerStatus(player);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingId,setLoadingId]=useState<string|null>(null);
  const loadingRef=useRef(false);
  const cached=useRef(new Map<string,string>());
  const stop = useCallback(() => { player.pause(); setActiveId(null); }, [player]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') player.pause(); });
    return () => { subscription.remove(); player.pause(); };
  }, [player]);

  const toggle = useCallback(async (message: ChatMessage) => {
    if(loadingRef.current)return;
    try {
      let uri=cached.current.get(message.id)||message.audioUri;
      if ((!uri || !new File(uri).exists) && message.role==='assistant' && message.audioToken) {
        const base=process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/,'');
        if(!base)throw new Error('Backend URL configure karo.');
        loadingRef.current=true;setLoadingId(message.id);setActiveId(message.id);setError(null);
        try {
          const response=await fetch(`${base}/api/tts`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:message.content,audioToken:message.audioToken,requestId:Crypto.randomUUID()})});
          if(!response.ok){const body=await response.json() as {error?:{message?:string}};throw new Error(body.error?.message||'AI audio nahi bana.');}
          if(!response.headers.get('content-type')?.includes('audio/wav'))throw new Error('AI audio format galat hai.');
          const bytes=new Uint8Array(await response.arrayBuffer());
          if(!bytes.length||bytes.length>4_100_000)throw new Error('AI audio bahut bada hai.');
          const file=new File(Paths.document,`convico-reply-${message.id}.wav`);
          file.create({overwrite:true});
          await file.write(bytes);
          uri=file.uri;cached.current.set(message.id,uri);
          await setAssistantAudio(message.id,uri);
        }finally{loadingRef.current=false;setLoadingId(null);}
      }
      if (!uri || !new File(uri).exists) { player.pause(); setActiveId(message.id); setError('Audio file nahi mila'); return; }
      setError(null);
      await setAudioModeAsync({allowsRecording: false, playsInSilentMode: true, interruptionMode: 'doNotMix'});
      if (activeId === message.id) {
        if (status.playing) { player.pause(); return; }
        if (status.didJustFinish || (message.audioDurationMs && status.currentTime >= message.audioDurationMs / 1000 - 0.1)) await player.seekTo(0);
        player.play();
      } else {
        player.pause();
        player.replace({uri});
        setActiveId(message.id);
        player.play();
      }
    } catch (cause) { setActiveId(message.id); setError(`Audio play nahi ho pa raha: ${String(cause)}`); }
  }, [activeId, player, status.currentTime, status.didJustFinish, status.playing]);

  const value = useMemo<Playback>(() => ({activeId, playing: status.playing, loadingId, currentMs: status.currentTime * 1000,
    error: error ?? status.error, toggle, stop}), [activeId, loadingId, status.playing, status.currentTime, status.error, error, toggle, stop]);
  return <StopPlaybackContext.Provider value={stop}><PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider></StopPlaybackContext.Provider>;
}

export function useStopVoicePlayback(): () => void {
  const context = useContext(StopPlaybackContext);
  if (!context) throw new Error('VoicePlaybackProvider missing');
  return context;
}

export function VoiceMessage({message}: {message: ChatMessage}) {
  const playback = useContext(PlaybackContext);
  if (!playback) throw new Error('VoicePlaybackProvider missing');
  const active = playback.activeId === message.id;
  const totalMs = message.audioDurationMs ?? 0;
  const currentMs = active ? Math.min(playback.currentMs, totalMs) : 0;
  const progress = totalMs > 0 ? currentMs / totalMs : 0;
  const levels = message.audioWaveform?.length ? message.audioWaveform : Array(24).fill(0.3) as number[];
  const bars = Array.from({length: 26}, (_, index) => levels[Math.min(levels.length - 1, Math.floor(index * levels.length / 26))]);
  return <View style={styles.root}>
    <Pressable accessibilityRole="button" accessibilityLabel={active && playback.playing ? 'Voice pause karo' : 'Voice play karo'} onPress={() => { void playback.toggle(message); }} style={styles.play}><MaterialCommunityIcons name={active && playback.playing ? 'pause' : 'play'} size={22} color="#f0f0e9" /></Pressable>
    <View style={styles.details}>
      <View style={styles.wave} accessibilityLabel="Voice message waveform">
        {bars.map((level, index) => <View key={index} style={[styles.bar, {height: 5 + level * 19, backgroundColor: index / bars.length <= progress ? '#f0f0e9' : '#9dc8b8'}]} />)}
      </View>
      <Text style={styles.time}>{formatVoiceTime(currentMs)} / {formatVoiceTime(totalMs)} · Voice yahin saved hai</Text>
      {active && playback.error && <Text style={styles.error}>{playback.error}</Text>}
    </View>
  </View>;
}

export function AssistantVoice({message}:{message:ChatMessage}) {
  const playback=useContext(PlaybackContext);
  if(!playback)throw new Error('VoicePlaybackProvider missing');
  const active=playback.activeId===message.id;
  const loading=playback.loadingId===message.id;
  return <View style={styles.assistantVoice}>
    <Pressable accessibilityRole="button" accessibilityLabel={loading?'AI audio ban raha hai':active&&playback.playing?'AI audio pause karo':'AI audio play karo'} disabled={loading||!message.audioToken} onPress={()=>{void playback.toggle(message);}} style={styles.play}>
      <MaterialCommunityIcons name={loading?'loading':active&&playback.playing?'pause':'play'} size={20} color="#f0f0e9" />
    </Pressable>
    <Text style={styles.time}>{loading?'Audio ban raha hai…':active&&playback.playing?'Pause audio':'AI reply suno'}</Text>
    {active&&playback.error&&<Text style={styles.error}>{playback.error}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  root: {flexDirection: 'row', alignItems: 'center', minWidth: 210, gap: 10},
  play: {width: 35, height: 35, borderRadius: 18, backgroundColor: '#25433d', alignItems: 'center', justifyContent: 'center'},
  playText: {color: '#f0f0e9', fontSize: 15, fontWeight: '700'}, details: {flex: 1, gap: 5},
  wave: {height: 25, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 2},
  bar: {flex: 1, borderRadius: 2}, time: {color: '#d1dbed', fontSize: 10}, error: {color: '#ffadad', fontSize: 10},
  assistantVoice:{flexDirection:'row',alignItems:'center',gap:8,marginTop:8,flexWrap:'wrap'},
});
