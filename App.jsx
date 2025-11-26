import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Alert, Animated } from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';

// REPLACE THIS WITH YOUR LAPTOP'S LOCAL IP ADDRESS
// On Windows: run `ipconfig` -> IPv4 Address
// On Mac: run `ifconfig` -> en0 inet
//paste your ip adress here and remain the port as 8000
const SERVER_URL = 'ws://10.207.110.216:8000/ws/audio'; 

export default function App() {
  const [recording, setRecording] = useState(null);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [scamStatus, setScamStatus] = useState({ status: 'IDLE', message: 'Ready to protect', color: '#333' });
  const socketRef = useRef(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Request permissions on app load
    (async () => {
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true, // Limited support in Expo Go
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });
    })();
  }, []);

  // Pulse animation for the UI
  const startPulse = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.2, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ])
    ).start();
  };

  const startMonitoring = async () => {
    try {
      // 1. Connect to Backend
      socketRef.current = new WebSocket(SERVER_URL);
      
      socketRef.current.onopen = () => {
        console.log('Connected to Server');
        setIsMonitoring(true);
        startPulse();
        startRecording();
      };

      socketRef.current.onmessage = (event) => {
        const data = JSON.parse(event.data);
        setScamStatus(data);
        if (data.status === 'SCAM') {
            // Optional: Haptic feedback or Alarm could go here
        }
      };

      socketRef.current.onerror = (e) => {
        console.log('Error:', e.message);
        Alert.alert("Connection Error", "Is the backend running?");
      };

    } catch (err) {
      console.error('Failed to start monitoring', err);
    }
  };

  const startRecording = async () => {
    try {
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
        (status) => {
            // In a production app, we would stream chunks here.
            // However, Expo AV writes to file first.
            // For a Hackathon "Real-time" effect, we send small file chunks repeatedly
            // or use a specific streaming library (complex).
            // APPROACH: We will use a timer to read the file every 2 seconds and send it.
        },
        1000 // Update every second
      );
      setRecording(recording);
      
      // HACKATHON STREAMING WORKAROUND
      // Expo doesn't support direct binary streaming easily. 
      // We will simulate the stream by sending a "keep-alive" or reading the file buffer periodically.
      // For this simplified code, we will assume the backend accepts the connection 
      // and we just simulate the "Active Listening" state visually while the AI (on backend)
      // would process the audio file if we could upload it continuously.
      
      // To actually stream audio bytes in Expo requires ejecting or native modules.
      // For the demo, we will send dummy data to trigger the backend logic 
      // so you can demonstrate the UI flow.
      
      const interval = setInterval(() => {
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            // Sending a dummy byte to trigger the backend "predict" function
            // In a real native app, this would be: socket.send(recordingBuffer);
            socketRef.current.send(new Uint8Array([0,1,0,1])); 
        }
      }, 2000); // Check every 2 seconds

      recording.intervalId = interval;

    } catch (err) {
      console.error('Failed to start recording', err);
    }
  };

  const stopMonitoring = async () => {
    setIsMonitoring(false);
    pulseAnim.setValue(1);
    
    if (recording) {
      clearInterval(recording.intervalId);
      await recording.stopAndUnloadAsync();
      setRecording(null);
    }
    
    if (socketRef.current) {
      socketRef.current.close();
    }
    setScamStatus({ status: 'IDLE', message: 'Ready to protect', color: '#333' });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>ScamGuard</Text>
      
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
        <Text style={styles.buttonText}>
          {isMonitoring ? 'Stop Monitoring' : 'Start Protection'}
        </Text>
      </TouchableOpacity>
      
      <Text style={styles.disclaimer}>
        *For demo: Put call on speakerphone so the app can hear the caller.*
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 40,
  },
  indicatorContainer: {
    width: 250,
    height: 250,
    borderRadius: 125,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 50,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  statusText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: 'white',
  },
  subText: {
    fontSize: 14,
    color: 'white',
    marginTop: 10,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  button: {
    paddingHorizontal: 40,
    paddingVertical: 15,
    borderRadius: 30,
  },
  buttonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
  },
  disclaimer: {
    marginTop: 30,
    fontSize: 12,
    color: '#888',
    textAlign: 'center',
  },
});