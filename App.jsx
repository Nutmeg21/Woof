import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet, Text, View, TouchableOpacity, Alert, SafeAreaView, ScrollView, StatusBar, Switch, Linking, Animated, Vibration, Pressable, Modal
} from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import * as TaskManager from 'expo-task-manager';
import * as Contacts from 'expo-contacts';
import BudgetScreen from './BudgetScreen';

// ⚠️ UPDATE THIS WITH YOUR CURRENT LAPTOP IP ⚠️
const SERVER_URL = 'ws://10.171.71.71:8081/ws/audio'; 
const LOCATION_TASK_NAME = 'background-location-task';

// Mock News Data
const MALAYSIA_NEWS = [
  { id: 1, title: "Macau Scam losses hit RM100m", source: "The Star", url: "https://www.thestar.com.my" },
  { id: 2, title: "Never share your OTP/TAC", source: "BNM Alert", url: "https://www.bnm.gov.my" },
  { id: 3, title: "Fake Touch 'n Go SMS", source: "TechNave", url: "https://technave.com" },
];

TaskManager.defineTask(LOCATION_TASK_NAME, ({ data, error }) => { if (error) return; });

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: false, shouldSetBadge: false }),
});

export default function App() {
  const [screen, setScreen] = useState("home"); 
  const [settings, setSettings] = useState({ scamDetectionEnabled: false, darkMode: false });
  const [contacts, setContacts] = useState([]);

  // --- AUDIO SCANNER STATES ---
  const [scamStatus, setScamStatus] = useState({ status: 'IDLE', message: 'Ready to protect', color: '#10b981' });
  const [modalVisible, setModalVisible] = useState(false);
  const [modalMessage, setModalMessage] = useState("");
  const [modalActions, setModalActions] = useState([]);
  const [indicatorVisible, setIndicatorVisible] = useState(false);
  const [lastConfidence, setLastConfidence] = useState(null);

  const socketRef = useRef(null);
  const pulse = useRef(new Animated.Value(1)).current;
  const isMonitoringRef = useRef(false);
  const recordingRef = useRef(null);
  const hasAlertedRef = useRef(false);

  useEffect(() => {
    (async () => {
      // Request permissions for Audio Scanner and Contacts
      await Audio.requestPermissionsAsync();
      await Notifications.requestPermissionsAsync();
      await Location.requestForegroundPermissionsAsync();
      await Location.requestBackgroundPermissionsAsync();

      const { status } = await Contacts.requestPermissionsAsync();
      if (status === 'granted') {
        const { data } = await Contacts.getContactsAsync({
          fields: [Contacts.Fields.PhoneNumbers],
        });
        if (data.length > 0) {
          setContacts(data.slice(0, 20)); 
        }
      } else {
        Alert.alert("Permission Required", "Please enable Contacts for the Finance feature.");
      }
    })();

    // Start pulsing animation for the alert badge
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.1, duration: 750, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1.0, duration: 750, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const themeStyles = settings.darkMode ? darkTheme : lightTheme;
  const textColor = settings.darkMode ? "#FFFFFF" : "#000000";
  const subTextColor = settings.darkMode ? "#9CA3AF" : "#6b7280";
  const cardBg = settings.darkMode ? "#1f1b2e" : "#FFFFFF";
  const inputBg = settings.darkMode ? "#2b2540" : "#f9fafb";

  const callNumber = (phoneNumber) => Linking.openURL(`tel:${phoneNumber}`);
  const openNews = (url) => Linking.openURL(url);

  // --- AUDIO SCANNER LOGIC ---
  const triggerScamAlert = async (data) => {
    if (hasAlertedRef.current) return; 
    hasAlertedRef.current = true;
    setLastConfidence(data.confidence || 95);
    setModalMessage(data.message || "Suspicious activity detected.");
    setModalActions([
        { label: "End Call", action: () => { stopMonitoring(); setModalVisible(false); } },
        { label: "Ignore", action: () => { setModalVisible(false); } }
    ]);
    setIndicatorVisible(true);
    setModalVisible(true);
    await Notifications.scheduleNotificationAsync({
      content: { title: "⚠️ SCAM DETECTED", body: "Hang up immediately!", priority: Notifications.AndroidNotificationPriority.MAX, vibrate: [0, 500, 200, 500] },
      trigger: null,
    });
    Vibration.vibrate([0, 500, 200, 500]);
    Speech.speak("Warning. Scam detected.");
  };

  const cleanupRecording = async () => {
    if (recordingRef.current) {
        try {
            const status = await recordingRef.current.getStatusAsync();
            if (status.isLoaded) await recordingRef.current.stopAndUnloadAsync();
            else await recordingRef.current.unloadAsync(); 
        } catch (error) { }
        recordingRef.current = null;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  };

  const SPEAKERPHONE_OPTIONS = {
    ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
    android: { ...Audio.RecordingOptionsPresets.HIGH_QUALITY.android, audioSource: 6 },
  };

  const runRecordingLoop = async () => {
    while (isMonitoringRef.current) {
        try {
            await cleanupRecording();
            if (!isMonitoringRef.current) break;

            const recording = new Audio.Recording();
            try {
                await recording.prepareToRecordAsync(SPEAKERPHONE_OPTIONS);
                await recording.startAsync();
                recordingRef.current = recording;
            } catch (prepError) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                continue; 
            }

            await new Promise(resolve => setTimeout(resolve, 10000)); 

            if (recordingRef.current && isMonitoringRef.current) {
                try { await recordingRef.current.stopAndUnloadAsync(); } 
                catch (e) { recordingRef.current = null; continue; }

                const uri = recordingRef.current.getURI();
                recordingRef.current = null;

                if (uri && socketRef.current?.readyState === WebSocket.OPEN) {
                    const base64Data = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
                    socketRef.current.send(JSON.stringify({ type: "audio_chunk", data: base64Data }));
                    await FileSystem.deleteAsync(uri, { idempotent: true });
                }
            }
        } catch (err) {
            await cleanupRecording();
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
  };

  const startMonitoring = async () => {
    try {
      await stopMonitoring(false);
      isMonitoringRef.current = true;
      setSettings(s => ({ ...s, scamDetectionEnabled: true }));
      setScamStatus({ status: 'CONNECTING', message: 'Connecting to AI Guard...', color: '#007AFF' });

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true, playsInSilentModeIOS: true, staysActiveInBackground: true,
        shouldDuckAndroid: true, playThroughEarpieceAndroid: false,
      });

      await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
        accuracy: Location.Accuracy.BestForNavigation, timeInterval: 2000, distanceInterval: 1,
        foregroundService: { notificationTitle: "Woof! Guard Active", notificationBody: "Monitoring call audio...", notificationColor: "#FF9301" },
      });

      const ws = new WebSocket(SERVER_URL);
      socketRef.current = ws;
      
      ws.onopen = () => {
        setScamStatus({ status: 'SAFE', message: 'Call Audio Protected.', color: '#10b981' });
        runRecordingLoop();
      };

      ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            let uiColor = '#10b981'; 
            if (data.status === 'SCAM') uiColor = '#ef4444';
            if (data.status === 'SUSPICIOUS') uiColor = '#FE9301';
            setScamStatus({ status: data.status, message: data.message, color: uiColor });
            if (data.status === 'SCAM') triggerScamAlert(data);
            if (data.status !== 'SAFE' && !isMonitoringRef.current) Alert.alert(data.status, data.message);
        } catch (e) { }
      };

      ws.onerror = () => { stopMonitoring(); };
    } catch (err) { console.error(err); }
  };

  const stopMonitoring = async (updateUI = true) => {
    isMonitoringRef.current = false;
    hasAlertedRef.current = false;
    if (updateUI) {
        setSettings(s => ({ ...s, scamDetectionEnabled: false }));
        setScamStatus({ status: 'IDLE', message: 'Call scanning disabled', color: '#6b7280' });
        setIndicatorVisible(false);
    }
    await cleanupRecording();
    Speech.stop();
    try { await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME); } catch (e) {}
    if (socketRef.current) { socketRef.current.close(); socketRef.current = null; }
  };

  const toggleProtection = () => {
      if (settings.scamDetectionEnabled) stopMonitoring(); else startMonitoring();
  };

  // --- E-WALLET COMPONENTS ---
  const WalletAction = ({ icon, label }) => (
    <TouchableOpacity style={{ alignItems: 'center', gap: 6 }}>
      <View style={styles.actionIconBg}>
        <Text style={{ fontSize: 20 }}>{icon}</Text>
      </View>
      <Text style={{ color: '#fff', fontWeight: '700', fontSize: 13 }}>{label}</Text>
    </TouchableOpacity>
  );

  const ServiceIcon = ({ icon, label }) => (
    <TouchableOpacity style={{ width: '25%', alignItems: 'center', marginBottom: 16, gap: 8 }}>
      <View style={[styles.serviceIconBg, { backgroundColor: inputBg }]}>
        <Text style={{ fontSize: 24 }}>{icon}</Text>
      </View>
      <Text style={{ color: textColor, fontSize: 12, fontWeight: '600' }}>{label}</Text>
    </TouchableOpacity>
  );

  function SafetyStatusCard() {
    return (
      <View style={[styles.card, { borderColor: scamStatus.color, borderWidth: 2, backgroundColor: cardBg, marginBottom: 16 }]}>
        <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
            <Text style={[styles.cardTitle, { color: textColor }]}>🛡️ Live Call Guard</Text>
            <Switch value={settings.scamDetectionEnabled} onValueChange={toggleProtection} trackColor={{ false: "#767577", true: "#FE9301" }} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={[styles.iconCircle, { backgroundColor: scamStatus.color }]}>
            <Text style={{ fontWeight: "800", color: "#fff", fontSize: 18 }}>{scamStatus.status === 'SAFE' ? "✓" : "!"}</Text>
          </View>
          <View style={{flex: 1}}>
            <Text style={[styles.statusText, { color: scamStatus.color }]}>{scamStatus.status}</Text>
            <Text style={styles.smallText}>{scamStatus.message}</Text>
          </View>
        </View>
      </View>
    );
  }

  // --- PURE E-WALLET HOME SCREEN ---
  function HomeScreen() {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        
        {/* 1. E-Wallet Balance Card */}
        <View style={[styles.walletCard, { backgroundColor: '#FE9301' }]}>
          <Text style={styles.walletLabel}>Available Balance</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={styles.walletBalance}>RM 3,450.50</Text>
            <TouchableOpacity style={styles.historyBtn}>
              <Text style={styles.historyBtnText}>History {'>'}</Text>
            </TouchableOpacity>
          </View>

          {/* Quick Actions */}
          <View style={styles.walletActions}>
            <WalletAction icon="➕" label="Top Up" />
            <WalletAction icon="💸" label="Transfer" />
            <WalletAction icon="📷" label="Scan QR" />
            <WalletAction icon="📥" label="Receive" />
          </View>
        </View>

        {/* 2. Services Grid */}
        <View style={[styles.card, { backgroundColor: cardBg, paddingVertical: 20 }]}>
          <Text style={[styles.sectionTitle, { color: textColor, marginBottom: 16, marginLeft: 8 }]}>Quick Services</Text>
          <View style={styles.servicesGrid}>
            <ServiceIcon icon="💡" label="Utilities" />
            <ServiceIcon icon="📱" label="Prepaid" />
            <ServiceIcon icon="🍿" label="Movies" />
            <ServiceIcon icon="✈️" label="Travel" />
            <ServiceIcon icon="🏥" label="Insurance" />
            <ServiceIcon icon="🛒" label="Groceries" />
            <ServiceIcon icon="🎁" label="Rewards" />
            <ServiceIcon icon="⚙️" label="More" />
          </View>
        </View>

        {/* 3. Scam News / Alerts Banner */}
        <View>
            <Text style={[styles.sectionTitle, { color: textColor }]}>Security Alerts</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginLeft: -5 }}>
                {MALAYSIA_NEWS.map((news) => (
                    <TouchableOpacity key={news.id} onPress={() => openNews(news.url)} style={[styles.newsCard, { backgroundColor: cardBg }]}>
                        <Text style={[styles.newsTitle, { color: textColor }]}>{news.title}</Text>
                        <Text style={styles.newsSource}>{news.source}</Text>
                    </TouchableOpacity>
                ))}
            </ScrollView>
        </View>

      </ScrollView>
    );
  }

  // --- FINANCE (CALL) SCREEN ---
  function FinanceScreen() {
    return (
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        
        {/* THE AUDIO DETECTION BUTTON INTEGRATED HERE */}
        <SafetyStatusCard />

        <Text style={[styles.hugeTitle, { color: textColor, marginTop: 8 }]}>Finance Contacts</Text>
        <View style={{ gap: 16 }}>
          {contacts.length === 0 ? <Text style={{color: subTextColor}}>Loading contacts...</Text> : contacts.map((c, i) => (
              c.phoneNumbers && (
                  <View key={i} style={[styles.contactRowCard, { backgroundColor: cardBg }]}>
                      <View>
                          <Text style={{ fontWeight: "700", fontSize: 16, color: textColor }}>{c.name}</Text>
                          <Text style={[styles.smallText, { color: subTextColor }]}>{c.phoneNumbers[0].number}</Text>
                      </View>
                      <TouchableOpacity onPress={() => callNumber(c.phoneNumbers[0].number)} style={[styles.bigButton]}>
                          <Text style={{ color: "#fff", fontWeight: "700" }}>Contact</Text>
                      </TouchableOpacity>
                  </View>
              )
          ))}
        </View>
      </ScrollView>
    );
  }

  function SettingsScreen() {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={[styles.hugeTitle, { color: textColor }]}>Settings</Text>
        <View style={[styles.cardRow, { backgroundColor: cardBg }]}>
          <Text style={{ fontWeight: "700", color: textColor }}>Dark Mode</Text>
          <Switch value={settings.darkMode} onValueChange={() => setSettings(s => ({ ...s, darkMode: !s.darkMode }))} />
        </View>
      </ScrollView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, themeStyles.container]}>
      <StatusBar barStyle={settings.darkMode ? "light-content" : "dark-content"} />
      <View style={[styles.header, themeStyles.header]}>
        <Text style={[styles.title, { color: "#FE9301", fontWeight: "800" }]}>Walley</Text>
        <Text style={[styles.headerTime, { color: subTextColor }]}>Demo Mode</Text>
      </View>
      <View style={{ flex: 1 }}>
        {screen === "home" && <HomeScreen />}
        {screen === "finance" && <FinanceScreen />}
        {screen === "budget" && <BudgetScreen darkMode={settings.darkMode} />}
        {screen === "settings" && <SettingsScreen />}
      </View>
      <View style={[styles.navBar, themeStyles.navBar]}>
        <NavButton label="Home" active={screen === "home"} onPress={() => setScreen("home")} />
        <NavButton label="Finance" active={screen === "finance"} onPress={() => setScreen("finance")} />
        <NavButton label="Budget" active={screen === "budget"} onPress={() => setScreen("budget")} />
        <NavButton label="Settings" active={screen === "settings"} onPress={() => setScreen("settings")} />
      </View>

      {/* FLOATING AUDIO ALERTS (Restored) */}
      {indicatorVisible && (
        <Animated.View style={[styles.floatingIndicator, { transform: [{ scale: pulse }] }]}>
          <Pressable onPress={() => { setModalVisible(true); }}>
            <View style={styles.floatingInner}>
              <View style={styles.badge}><Text style={{ fontSize: 11, fontWeight: "800", color: "#7a2b00" }}>!</Text></View>
              <Text style={{ color: "#fff", fontWeight: "900", fontSize: 20 }}>⚠️</Text>
            </View>
          </Pressable>
        </Animated.View>
      )}
      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { borderTopColor: "#FE9301", backgroundColor: cardBg }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Text style={{ fontSize: 22, fontWeight: "900", color: "#FE9301" }}>⚠️</Text>
              <Text style={{ fontSize: 20, fontWeight: "900", color: "#FE9301" }}>SCAM ALERT!</Text>
            </View>
            <Text style={{ marginTop: 12, color: textColor }}>{modalMessage}</Text>
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
  sectionTitle: { fontSize: 18, fontWeight: "900", marginBottom: 8 },
  contactRowCard: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: '#fff', padding: 15, marginBottom: 10, borderRadius: 12, elevation: 1 },
  bigButton: { backgroundColor: "#FE9301", paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  hugeTitle: { fontSize: 24, fontWeight: "800", marginBottom: 12 },
  cardRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", padding: 12, borderRadius: 10, shadowColor: "#000", shadowOpacity: 0.04, elevation: 2 },
  newsCard: { backgroundColor: '#fff', width: 250, padding: 15, marginRight: 15, borderRadius: 12, elevation: 2, borderLeftWidth: 5, borderLeftColor: '#FE9301' },
  newsTitle: { fontWeight: '700', fontSize: 16, marginBottom: 5 },
  newsSource: { color: '#FE9301', fontSize: 12, fontWeight: '600' },
  smallText: { color: "#6b7280", fontSize: 12 },
  
  // Audio Scanner UI Styles Restored
  cardTitle: { fontSize: 16, fontWeight: "800", marginBottom: 8 },
  iconCircle: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  statusText: { fontSize: 20, fontWeight: "900" },
  floatingIndicator: { position: "absolute", right: 20, bottom: 90, zIndex: 60 },
  floatingInner: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", backgroundColor: "#ef4444", shadowColor: "#000", shadowOpacity: 0.2, elevation: 6 },
  badge: { position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: "#FFCD02", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#ef4444", zIndex: 2 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 20 },
  modalCard: { width: "100%", maxWidth: 420, backgroundColor: "#fff", padding: 18, borderRadius: 14, borderTopWidth: 6 },

  // E-Wallet Specific Styles
  walletCard: { padding: 20, borderRadius: 16, elevation: 6, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  walletLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: '600', marginBottom: 4 },
  walletBalance: { color: '#fff', fontSize: 32, fontWeight: '900', letterSpacing: 0.5 },
  historyBtn: { backgroundColor: 'rgba(255,255,255,0.25)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 },
  historyBtnText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  walletActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 24, paddingHorizontal: 10 },
  actionIconBg: { width: 48, height: 48, backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  servicesGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start' },
  serviceIconBg: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});

const lightTheme = StyleSheet.create({ container: { backgroundColor: "#f0f4f8" }, header: { backgroundColor: "#fff" }, navBar: { backgroundColor: "#fff" } });
const darkTheme = StyleSheet.create({ container: { backgroundColor: "#151428" }, header: { backgroundColor: "#1f1b2e", borderBottomColor: "#2b2540" }, navBar: { backgroundColor: "#1f1b2e", borderTopColor: "#2b2540" } });