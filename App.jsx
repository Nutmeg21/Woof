import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, Alert, Animated, Vibration, Platform,
  Modal, Pressable, SafeAreaView, ScrollView, StatusBar, Switch
} from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import * as TaskManager from 'expo-task-manager';

// --- CONFIGURATION ---
const SERVER_URL = 'ws://10.207.110.192:8000/ws/audio'; 
const LOCATION_TASK_NAME = 'background-location-task';

TaskManager.defineTask(LOCATION_TASK_NAME, ({ data, error }) => {
  if (error) return;
});

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/* -------------------------
   APP COMPONENT
   ------------------------- */
export default function App() {
  const [screen, setScreen] = useState("home"); 
  const [settings, setSettings] = useState({ scamDetectionEnabled: false, darkMode: false });
  const [modalVisible, setModalVisible] = useState(false);
  const [modalMessage, setModalMessage] = useState("");
  const [modalActions, setModalActions] = useState([]);
  const [indicatorVisible, setIndicatorVisible] = useState(false);
  const [lastConfidence, setLastConfidence] = useState(null);
  
  const [scamStatus, setScamStatus] = useState({ status: 'IDLE', message: 'Ready to protect', color: '#10b981' });
  const socketRef = useRef(null);
  const pulse = useRef(new Animated.Value(1)).current;
  
  // LOGIC REFS
  const isMonitoringRef = useRef(false); // The master switch
  const recordingRef = useRef(null);
  const hasAlertedRef = useRef(false);

  useEffect(() => {
    (async () => {
      await Audio.requestPermissionsAsync();
      await Notifications.requestPermissionsAsync();
      await Location.requestForegroundPermissionsAsync();
      await Location.requestBackgroundPermissionsAsync();
    })();

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.1, duration: 750, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1.0, duration: 750, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  // --- TRIGGER ALERT ---
  const triggerScamAlert = async (data) => {
    if (hasAlertedRef.current) return; 
    hasAlertedRef.current = true;

    setLastConfidence(data.confidence || 95); 
    setModalMessage("Woof! Suspicious audio detected. Do not share personal info.");
    setModalActions([
        { label: "End Call", action: () => { stopMonitoring(); setModalVisible(false); } },
        { label: "Ignore", action: () => { setModalVisible(false); } }
    ]);
    setIndicatorVisible(true);
    setModalVisible(true);

    await Notifications.scheduleNotificationAsync({
      content: {
        title: "⚠️ SCAM DETECTED",
        body: "Hang up immediately!",
        priority: Notifications.AndroidNotificationPriority.MAX,
        vibrate: [0, 500, 200, 500],
      },
      trigger: null,
    });
    Vibration.vibrate([0, 500, 200, 500]);
    Speech.speak("Warning. Scam detected. Hang up now.");
  };

  // --- CLEANUP (With Hardware Delay) ---
  const cleanupRecording = async () => {
    if (recordingRef.current) {
        try {
            const status = await recordingRef.current.getStatusAsync();
            if (status.isLoaded) await recordingRef.current.stopAndUnloadAsync();
            else await recordingRef.current.unloadAsync(); 
        } catch (error) { 
            console.log("Cleanup warning:", error);
        }
        recordingRef.current = null;
    }
    // HARDWARE COOLDOWN: Give the OS 200ms to release the mic
    await new Promise(resolve => setTimeout(resolve, 200));
  };

  // --- START MONITORING ---
  const startMonitoring = async () => {
    try {
      // 1. Force Stop First
      await stopMonitoring(false);
      
      // 2. Set State
      isMonitoringRef.current = true;
      setSettings(s => ({ ...s, scamDetectionEnabled: true }));
      setScamStatus({ status: 'CONNECTING', message: 'Connecting to server...', color: '#007AFF' });

      // 3. Configure Audio
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      });

      // 4. Background Keep-Alive
      await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 2000, 
        distanceInterval: 1,
        foregroundService: {
          notificationTitle: "Woof! Guard Active",
          notificationBody: "Listening for scams...",
          notificationColor: "#FF9301",
        },
      });

      // 5. Connect Socket
      const ws = new WebSocket(SERVER_URL);
      socketRef.current = ws;
      
      ws.onopen = () => {
        console.log(`Socket Open. Starting Loop...`);
        setScamStatus({ status: 'SAFE', message: 'Protected. Listening...', color: '#10b981' });
        
        // START THE LOOP (Not recursive anymore)
        runRecordingLoop();
      };

      ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            let uiColor = '#10b981'; 
            if (data.status === 'SCAM') uiColor = '#ef4444';
            if (data.status === 'SUSPICIOUS') uiColor = '#FE9301';

            setScamStatus({ 
                status: data.status, 
                message: data.message || "Analyzing...", 
                color: uiColor 
            });

            if (data.status === 'SCAM') triggerScamAlert(data);
        } catch (e) { }
      };

      ws.onerror = () => {
        Alert.alert("Connection Error", "Is backend running?");
        stopMonitoring();
      };
      
    } catch (err) {
      console.error(err);
    }
  };

  // --- THE NEW LINEAR LOOP (No Recursion) ---
  const runRecordingLoop = async () => {
    console.log("Entering Recording Loop...");
    
    // Continue running as long as the switch is ON
    while (isMonitoringRef.current) {
        try {
            // A. Clean previous
            await cleanupRecording();

            // Check again in case user stopped during cleanup
            if (!isMonitoringRef.current) break;

            // B. Start New Recording
            const recording = new Audio.Recording();
            await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
            await recording.startAsync();
            recordingRef.current = recording;

            // C. Wait 2 seconds (Recording...)
            await new Promise(resolve => setTimeout(resolve, 2000));

            // D. Stop & Send
            if (recordingRef.current && isMonitoringRef.current) {
                await recordingRef.current.stopAndUnloadAsync();
                const uri = recordingRef.current.getURI();
                recordingRef.current = null;

                if (uri && socketRef.current?.readyState === WebSocket.OPEN) {
                    const base64Data = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
                    socketRef.current.send(JSON.stringify({ type: "audio_chunk", data: base64Data }));
                    await FileSystem.deleteAsync(uri, { idempotent: true });
                    console.log("Chunk sent.");
                }
            }
        } catch (err) {
            console.log("Loop Error:", err);
            // If error, wait 1s before retrying to avoid crash loop
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    console.log("Exited Recording Loop.");
  };

  const stopMonitoring = async (updateUI = true) => {
    isMonitoringRef.current = false; // Breaks the while loop
    hasAlertedRef.current = false;
    
    if (updateUI) {
        setSettings(s => ({ ...s, scamDetectionEnabled: false }));
        setScamStatus({ status: 'IDLE', message: 'Ready to protect', color: '#6b7280' });
        setIndicatorVisible(false);
    }

    await cleanupRecording();
    Speech.stop();
    
    try {
        const hasStarted = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
        if (hasStarted) await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
    } catch (e) {}

    if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
    }
  };

  // --- UI ---
  const toggleProtection = () => {
      if (settings.scamDetectionEnabled) stopMonitoring();
      else startMonitoring();
  };

  function SafetyStatusCard() {
    const isWarn = scamStatus.status === 'SCAM';
    const isIdle = scamStatus.status === 'IDLE';

    let cardStyle = styles.cardSafe;
    if (isWarn) cardStyle = styles.cardWarning;
    if (isIdle) cardStyle = styles.cardIdle;

    return (
      <View style={[styles.card, cardStyle]}>
        <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
            <Text style={[styles.cardTitle]}>Protection Status</Text>
            <Switch 
                value={settings.scamDetectionEnabled} 
                onValueChange={toggleProtection}
                trackColor={{ false: "#767577", true: "#FE9301" }}
            />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={[styles.iconCircle, { backgroundColor: scamStatus.color }]}>
            <Text style={{ fontWeight: "800", color: "#fff", fontSize: 18 }}>
                {isWarn ? "!" : isIdle ? "-" : "✓"}
            </Text>
          </View>
          <View style={{flex: 1}}>
            <Text style={[styles.statusText, { color: scamStatus.color }]}>
                {scamStatus.status}
            </Text>
            <Text style={styles.smallText}>{scamStatus.message}</Text>
          </View>
        </View>
      </View>
    );
  }

  /* --- SCREEN RENDERERS --- */
  function HomeScreen() {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <SafetyStatusCard />
        <View>
            <Text style={styles.sectionTitle}>Recent Activity</Text>
            <View style={styles.card}>
                <Text style={styles.smallText}>No recent threats detected.</Text>
            </View>
        </View>
      </ScrollView>
    );
  }
  function CallScreen() {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Text style={styles.hugeTitle}>Woof! Contacts</Text>
        <View style={styles.card}>
          <Text style={{marginBottom: 10, fontStyle:'italic', color:'#666'}}>
             *Test Mode: Start protection, minimize, use Speakerphone.*
          </Text>
          <View style={styles.contactRow}>
            <View>
              <Text style={{ fontWeight: "700" }}>Bank Test</Text>
              <Text style={styles.smallText}>+60 3-1234 5678</Text>
            </View>
            <TouchableOpacity style={[styles.bigButton]}>
              <Text style={{ color: "#fff", fontWeight: "700" }}>Call</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    );
  }
  function MessageScreen() {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Text style={styles.hugeTitle}>Woof! Messaging</Text>
        <View style={styles.card}><Text>Coming soon.</Text></View>
      </ScrollView>
    );
  }
  function NotificationScreen() {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={styles.hugeTitle}>Notifications</Text>
        <View style={[styles.card, { borderLeftWidth: 4, borderLeftColor: "#10b981" }]}>
            <Text style={{ fontWeight: "700" }}>System: App started</Text>
        </View>
      </ScrollView>
    );
  }
  function SettingsScreen() {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={styles.hugeTitle}>Settings</Text>
        <View style={styles.cardRow}>
          <Text style={{ fontWeight: "700" }}>Dark Mode</Text>
          <Switch value={settings.darkMode} onValueChange={() => setSettings(s => ({ ...s, darkMode: !s.darkMode }))} />
        </View>
      </ScrollView>
    );
  }

  const themeStyles = settings.darkMode ? darkTheme : lightTheme;

  return (
    <SafeAreaView style={[styles.container, themeStyles.container]}>
      <StatusBar barStyle={settings.darkMode ? "light-content" : "dark-content"} />
      <View style={[styles.header, themeStyles.header]}>
        <Text style={[styles.title, { color: "#FE9301", fontWeight: "800" }]}>Woof!</Text>
        <Text style={styles.headerTime}>Demo Mode</Text>
      </View>
      <View style={{ flex: 1 }}>
        {screen === "home" && <HomeScreen />}
        {screen === "call" && <CallScreen />}
        {screen === "message" && <MessageScreen />}
        {screen === "notification" && <NotificationScreen />}
        {screen === "settings" && <SettingsScreen />}
      </View>
      <View style={[styles.navBar, themeStyles.navBar]}>
        <NavButton label="Call" active={screen === "call"} onPress={() => setScreen("call")} />
        <NavButton label="Message" active={screen === "message"} onPress={() => setScreen("message")} />
        <NavButton label="Home" active={screen === "home"} onPress={() => setScreen("home")} />
        <NavButton label="Notif" active={screen === "notification"} onPress={() => setScreen("notification")} />
        <NavButton label="Settings" active={screen === "settings"} onPress={() => setScreen("settings")} />
      </View>
      {indicatorVisible && (
        <Animated.View style={[styles.floatingIndicator, { transform: [{ scale: pulse }] }]}>
          <Pressable onPress={() => { setModalVisible(true); }}>
            <View style={styles.floatingInner}>
              <View style={styles.badge}>
                <Text style={{ fontSize: 11, fontWeight: "800", color: "#7a2b00" }}>!</Text>
              </View>
              <Text style={{ color: "#fff", fontWeight: "900", fontSize: 20 }}>⚠️</Text>
            </View>
          </Pressable>
        </Animated.View>
      )}
      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { borderTopColor: "#FE9301" }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Text style={{ fontSize: 22, fontWeight: "900", color: "#FE9301" }}>⚠️</Text>
              <Text style={{ fontSize: 20, fontWeight: "900", color: "#FE9301" }}>SCAM ALERT!</Text>
            </View>
            <Text style={{ marginTop: 12 }}>{modalMessage}</Text>
            {lastConfidence && <Text style={{ marginTop: 8, fontWeight: "700", color: "#FE9301" }}>Confidence: {lastConfidence}%</Text>}
            <View style={{ marginTop: 14 }}>
              {modalActions.map((a, idx) => (
                <TouchableOpacity key={idx} onPress={a.action} style={[styles.bigButton, { marginBottom: 8 }]}>
                  <Text style={{ color: "#fff", fontWeight: "800" }}>{a.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function NavButton({ label, active, onPress }) {
  const textColor = active ? "#FE9301" : "#6b7280";
  return (
    <TouchableOpacity onPress={onPress} style={{ flex: 1, alignItems: "center", padding: 10 }}>
      <Text style={{ color: textColor, fontWeight: active ? "800" : "600" }}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { height: 60, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: "#e5e7eb", backgroundColor: "#fff" },
  title: { fontSize: 20 },
  headerTime: { color: "#6b7280" },
  navBar: { height: 64, flexDirection: "row", borderTopWidth: 1, borderTopColor: "#e5e7eb", backgroundColor: "#fff" },
  card: { backgroundColor: "#fff", padding: 12, borderRadius: 12, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  cardWarning: { borderWidth: 2, borderColor: "#FE9301", backgroundColor: "#FFF3E0" },
  cardSafe: { borderWidth: 2, borderColor: "#10b981", backgroundColor: "#ECFDF5" },
  cardIdle: { borderWidth: 1, borderColor: "#ddd", backgroundColor: "#f9f9f9" },
  cardTitle: { fontSize: 16, fontWeight: "800", marginBottom: 8 },
  iconCircle: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  statusText: { fontSize: 20, fontWeight: "900" },
  smallText: { color: "#6b7280", fontSize: 12 },
  sectionTitle: { fontSize: 18, fontWeight: "900", marginBottom: 8 },
  contactRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  bigButton: { backgroundColor: "#FE9301", paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  hugeTitle: { fontSize: 24, fontWeight: "800", marginBottom: 12 },
  floatingIndicator: { position: "absolute", right: 20, bottom: 90, zIndex: 60 },
  floatingInner: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", backgroundColor: "#ef4444", shadowColor: "#000", shadowOpacity: 0.2, elevation: 6 },
  badge: { position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: "#FFCD02", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#ef4444", zIndex: 2 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 20 },
  modalCard: { width: "100%", maxWidth: 420, backgroundColor: "#fff", padding: 18, borderRadius: 14, borderTopWidth: 6 },
  cardRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", padding: 12, borderRadius: 10, shadowColor: "#000", shadowOpacity: 0.04, elevation: 2 },
});

const lightTheme = StyleSheet.create({ container: { backgroundColor: "#f0f4f8" }, header: { backgroundColor: "#fff" }, navBar: { backgroundColor: "#fff" } });
const darkTheme = StyleSheet.create({ container: { backgroundColor: "#151428" }, header: { backgroundColor: "#1f1b2e", borderBottomColor: "#2b2540" }, navBar: { backgroundColor: "#1f1b2e", borderTopColor: "#2b2540" } });