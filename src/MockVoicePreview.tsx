import React, { memo, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { cancelAnimation, Easing, runOnJS, SharedValue, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

const DURATION_MS = 6000;
const BAR_COUNT = 11;

function WaveBar({progress, index}: {progress: SharedValue<number>; index: number}) {
  const style = useAnimatedStyle(() => {
    const wave = Math.abs(Math.sin(progress.value * 28 + index * 1.7));
    return {transform: [{scaleY: 0.35 + wave * 0.8}], opacity: 0.55 + wave * 0.45};
  });
  return <Animated.View style={[styles.bar, style]} />;
}

export const MockVoicePreview = memo(function MockVoicePreview() {
  const [state, setState] = useState<'idle' | 'playing' | 'paused' | 'done'>('idle');
  const progress = useSharedValue(0);
  const progressRef = useRef(progress);
  useEffect(() => () => cancelAnimation(progressRef.current), []);

  const play = () => {
    if (state === 'done') progress.value = 0;
    const remaining = Math.max(100, (1 - progress.value) * DURATION_MS);
    setState('playing');
    progress.value = withTiming(1, {duration: remaining, easing: Easing.linear}, finished => {
      if (finished) runOnJS(setState)('done');
    });
  };
  const pause = () => { cancelAnimation(progress); setState('paused'); };
  const stop = () => { cancelAnimation(progress); progress.value = 0; setState('idle'); };

  return <View style={styles.row}>
    <Pressable accessibilityRole="button" accessibilityLabel={state === 'playing' ? 'Pause mock voice preview' : 'Play mock voice preview'}
      onPress={state === 'playing' ? pause : play} style={styles.playButton}>
      <Text style={styles.playText}>{state === 'playing' ? 'Ⅱ' : '▶'}</Text>
    </Pressable>
    <View style={styles.wave} accessibilityLabel="Animated mock audio waveform">
      {Array.from({length: BAR_COUNT}, (_, index) => <WaveBar key={index} progress={progress} index={index} />)}
    </View>
    <Text style={styles.label}>{state === 'idle' ? 'Mock voice · 6s' : state === 'playing' ? 'Playing sample' : state === 'paused' ? 'Paused' : 'Replay sample'}</Text>
    {(state === 'playing' || state === 'paused') && <Pressable accessibilityRole="button" accessibilityLabel="Stop mock voice preview" onPress={stop}>
      <Text style={styles.stop}>■</Text>
    </Pressable>}
  </View>;
});

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 9, borderTopColor: '#384550', borderTopWidth: 1},
  playButton: {width: 22, height: 22, borderRadius: 11, backgroundColor: '#365c53', alignItems: 'center', justifyContent: 'center'},
  playText: {color: '#e9f4ed', fontSize: 11, fontWeight: '700'},
  wave: {height: 20, flexDirection: 'row', alignItems: 'center', gap: 2},
  bar: {width: 2, height: 16, borderRadius: 2, backgroundColor: '#a4d4be'},
  label: {color: '#a6b2b8', fontSize: 10, flex: 1},
  stop: {color: '#a6b2b8', fontSize: 12, paddingHorizontal: 4},
});
