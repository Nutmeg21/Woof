import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Alert, Animated, Vibration, Platform } from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import notifee, { AndroidImportance, AndroidVisibility, AndroidCategory } from '@notifee/react-native';

const SERVER_URL = 'ws://10.207.110.192:8000/ws/audio'; 

export default function App() {
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [scamStatus, setScamStatus] = useState({ status: 'IDLE', message: 'Ready to protect', color: '#333' });
  
  const socketRef = useRef(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const isMonitoringRef = useRef(false);
  const recordingRef = useRef(null);
  const hasAlertedRef = useRef(false);

  useEffect(() => {
    (async () => {
      // Request all permissions
      await Audio.requestPermissionsAsync();
      await Location.requestForegroundPermissionsAsync();
      await notifee.requestPermission();
    })();
  }, []);

  const startPulse = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.2, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ])
    ).start();
  };

  const triggerScamAlert = async () => {
    if (hasAlertedRef.current) return;
    hasAlertedRef.current = true;

    // 1. Create Channel
    const channelId = await notifee.createChannel({
      id: 'scam_alert',
      name: 'Scam Alerts',
      importance: AndroidImportance.HIGH,
      visibility: AndroidVisibility.PUBLIC,
      sound: 'default',
      vibration: true,
    });

    // 2. Full Screen Overlay Alert
    await notifee.displayNotification({
      title: '🚨 SCAM DETECTED',
      body: 'HANG UP NOW!',
      android: {
        channelId,
        category: AndroidCategory.CALL,
        importance: AndroidImportance.HIGH,
        fullScreenAction: {
          id: 'default',
        },
        // Make the notification RED
        color: '#FF0000',
        actions: [
          {
            title: 'STOP ALARM',
            pressAction: { id: 'stop' },
          },
        ],
        vibrationPattern: [0, 500, 200, 500],
        ongoing: true, 
        loopSound: true,
      },
    });

    // 3. Audio & Haptics
    Vibration.vibrate([0, 500, 200, 500]);
    Speech.speak("Warning. Scam detected. Hang up immediately.");
  };

  // --- RECORDING LOGIC (Standard Chunking) ---
  const cleanupRecording = async () => {
    if (recordingRef.current) {
        try {
            const status = await recordingRef.current.getStatusAsync();
            if (status.isLoaded) await recordingRef.current.stopAndUnloadAsync();
            else await recordingRef.current.unloadAsync();
        } catch (e) {}
        recordingRef.current = null;
    }
  };

  const startMonitoring = async () => {
    try {
      await stopMonitoring();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      // Background Keep-Alive
      await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Lowest, timeInterval: 5000, distanceInterval: 100 },
        () => {} 
      );

      setIsMonitoring(true);
      isMonitoringRef.current = true;
      hasAlertedRef.current = false;
      startPulse();

      socketRef.current = new WebSocket(SERVER_URL);
      
      socketRef.current.onopen = () => {
        console.log('Connected');
        startRecordingLoop();
      };

      socketRef.current.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            setScamStatus(data);
            if (data.status === 'SCAM') triggerScamAlert();
        } catch (e) {}
      };

      socketRef.current.onerror = () => stopMonitoring();
      
    } catch (err) {
      console.error(err);
    }
  };

  const startRecordingLoop = async () => {
    if (!isMonitoringRef.current) return;
    try {
      await cleanupRecording();
      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();
      recordingRef.current = recording;

      await new Promise(resolve => setTimeout(resolve, 2000));

      if (recordingRef.current && isMonitoringRef.current) {
          await recordingRef.current.stopAndUnloadAsync();
          const uri = recordingRef.current.getURI();
          recordingRef.current = null;

          if (uri && socketRef.current?.readyState === WebSocket.OPEN) {
              const base64Data = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
              socketRef.current.send(JSON.stringify({ type: "audio_chunk", data: base64Data }));
              await FileSystem.deleteAsync(uri, { idempotent: true });
          }
      }
      if (isMonitoringRef.current) startRecordingLoop();
    } catch (err) {
      await cleanupRecording();
      if (isMonitoringRef.current) setTimeout(startRecordingLoop, 1500);
    }
  };

  const stopMonitoring = async () => {
    setIsMonitoring(false);
    isMonitoringRef.current = false;
    hasAlertedRef.current = false;
    pulseAnim.setValue(1);
    await cleanupRecording();
    Speech.stop();
    await notifee.cancelAllNotifications(); // Stop the alarm
    if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
    }
    setScamStatus({ status: 'IDLE', message: 'Ready to protect', color: '#333' });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>ScamGuard (Dev)</Text>
      <View style={[styles.indicatorContainer, { backgroundColor: scamStatus.color }]}>
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <Text style={styles.statusText}>{scamStatus.status}</Text>
        </Animated.View>
        <Text style={styles.subText}>{scamStatus.message}</Text>
      </View>
      <TouchableOpacity
        style={[styles.button, { backgroundColor: isMonitoring ? '#ff4444' : '#007AFF' }]}
        onPress={isMonitoring ? stopMonitoring : startMonitoring}
      >
        <Text style={styles.buttonText}>{isMonitoring ? 'Stop Monitoring' : 'Start Protection'}</Text>
      </TouchableOpacity>
      <Text style={styles.disclaimer}>*Running in Native Dev Mode*</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', padding: 20 },
  title: { fontSize: 28, fontWeight: 'bold', marginBottom: 40 },
  indicatorContainer: { width: 250, height: 250, borderRadius: 125, justifyContent: 'center', alignItems: 'center', marginBottom: 50, elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 3.84 },
  statusText: { fontSize: 32, fontWeight: 'bold', color: 'white' },
  subText: { fontSize: 14, color: 'white', marginTop: 10, textAlign: 'center', paddingHorizontal: 20 },
  button: { paddingHorizontal: 40, paddingVertical: 15, borderRadius: 30 },
  buttonText: { color: 'white', fontSize: 18, fontWeight: '600' },
  disclaimer: { marginTop: 30, fontSize: 12, color: '#888', textAlign: 'center' },
});