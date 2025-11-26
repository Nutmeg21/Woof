
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Switch,
} from "react-native";

/**
 * Expo-ready React Native conversion of the "Woof! Scam Detector App"
 * - Single-file App.js
 * - Mock Firebase mode (no real network)
 * - Mock scam detection (random)
 * - Screens: Home, Call, Message, Notification, Settings
 * - Floating pulsing indicator when a scam is detected
 *
 * To run:
 * 1. expo init my-app (choose blank)
 * 2. Replace App.js with this file
 * 3. expo start
 */

/* -------------------------
   Mock Data & Utility
   ------------------------- */
const initialCallHistory = [
  { id: 1, number: "0123 456 7899", type: "Warning", status: "Blocked by Woof!", time: "1 minute ago" },
  { id: 2, number: "+60 19 123 4567", type: "Safe", status: "Contact: Jane Doe", time: "2 hours ago" },
  { id: 3, number: "Unknown Number", type: "Spam", status: "Marked as Spam", time: "Yesterday" },
  { id: 4, number: "03 8888 1234", type: "Safe", status: "Unanswered", time: "3 days ago" },
];

const scamNews = [
  { id: 1, title: "New Phishing Scam Targets Online Shoppers", source: "Security Weekly", date: "Nov 24, 2025" },
  { id: 2, title: "How to Identify Impersonation Calls from Banks", source: "Consumer Watch", date: "Nov 22, 2025" },
  { id: 3, title: "The Rise of QR Code Scams in Public Places", source: "Local News Daily", date: "Nov 20, 2025" },
];

function mockDetectScam() {
  const percentage = Math.floor(Math.random() * (98 - 60 + 1)) + 60;
  const isScam = percentage > 70;
  return { percentage, isScam };
}

/* -------------------------
   App Component
   ------------------------- */
export default function App() {
  const [screen, setScreen] = useState("home"); // home, call, message, notification, settings
  const [settings, setSettings] = useState({ scamDetectionEnabled: true, darkMode: false });
  const [callHistory, setCallHistory] = useState(initialCallHistory);
  const [isWarning, setIsWarning] = useState(true); // triggers modal on home load
  const [modalVisible, setModalVisible] = useState(false);
  const [modalMessage, setModalMessage] = useState("");
  const [modalActions, setModalActions] = useState([]); // array of {label, action}
  const pulse = useRef(new Animated.Value(1)).current;
  const [indicatorVisible, setIndicatorVisible] = useState(false);
  const [lastConfidence, setLastConfidence] = useState(null);

  useEffect(() => {
    // pulse animation loop
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.1, duration: 750, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1.0, duration: 750, useNativeDriver: true }),
      ])
    ).start();
  }, [pulse]);

  useEffect(() => {
    // Show initial modal on first load if warning is active
    if (screen === "home" && isWarning) {
      setModalMessage(
        "Woof! This number (0123 456 7899) has been reported for impersonation and unsolicited payment requests. DO NOT respond to unknown payment requests or provide personal information."
      );
      setModalActions([{ label: "Block and Report Source", action: () => takeAction("home", "block_report") }]);
      setTimeout(() => setModalVisible(true), 400);
    }
  }, []);

  /* -------------------------
     UI Helpers
     ------------------------- */
  function showIndicator(message, actions = []) {
    setModalMessage(message);
    setModalActions(actions);
    setIndicatorVisible(true);
  }

  function hideIndicator() {
    setIndicatorVisible(false);
    setModalMessage("");
    setModalActions([]);
    setLastConfidence(null);
  }

  function alertUser(text) {
    Alert.alert("Woof!", text);
  }


function takeAction(type, action) {
    let logMessage = "";
    if (action === "end") logMessage = "Call ended and dismissed alert.";
    else if (action === "block_report") logMessage = '${type} blocked and reported. Thank you!';
    setModalVisible(false);
    alertUser(logMessage);
    if (isWarning) {
      setIsWarning(false);
      // Update home UI if necessary
    }
    hideIndicator();
  }

  /* -------------------------
     Mock Triggers
     ------------------------- */
  function triggerCallScam() {
    if (!settings.scamDetectionEnabled) return alertUser("Scam detection is disabled.");
    const result = mockDetectScam();
    setLastConfidence(result.percentage);
    if (result.isScam) {
      const message = "Woof! We’ve detected suspicious activity during this call with a ${result.percentage}% confidence it may be a scam. Please do not share personal or financial information.";
      const actions = [
        { label: "End Call", action: () => takeAction("call", "end") },
        { label: "Block and Report", action: () => takeAction("call", "block_report") },
      ];
      showIndicator(message, actions);
      setIsWarning(true);
      setModalVisible(false);
      if (screen === "home") {
        /* re-rendering home happens automatically */
      }
      alertUser("Suspicious activity detected! Tap the red badge.");
    } else {
      alertUser("Call is secure (Confidence: " + result.percentage + "%)");
    }
  }

  function triggerMessageScam() {
    if (!settings.scamDetectionEnabled) return alertUser("Scam detection is disabled.");
    const result = mockDetectScam();
    setLastConfidence(result.percentage);
    if (result.isScam) {
      const message = "Woof! We’ve detected suspicious activity during this message with a ${result.percentage}% confidence it may be a scam. The message contains malicious links.";
      const actions = [{ label: "Block Sender and Delete Message", action: () => takeAction("message", "block_report") }];
      showIndicator(message, actions);
      setIsWarning(true);
      alertUser("Suspicious activity detected! Tap the red badge.");
    } else {
      alertUser("Message is secure (Confidence: " + result.percentage + "%)");
    }
  }

  /* -------------------------
     Render helpers for screens
     ------------------------- */
  function SafetyStatusCard() {
    const isWarn = isWarning;
    const cardStyle = isWarn ? styles.cardWarning : styles.cardSafe;
    const messageText = isWarn ? "Warning: Active Threat Detected" : "Safe: No Threats Detected";
    return (
      <View style={[styles.card, cardStyle]}>
        <Text style={[styles.cardTitle]}>Your Current Safety Status</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={[styles.iconCircle, isWarn ? styles.iconWarning : styles.iconSafe]}>
            <Text style={{ fontWeight: "800", color: "#fff", fontSize: 18 }}>{isWarn ? "!" : "✓"}</Text>
          </View>
          <Text style={[styles.statusText, isWarn ? styles.textWarning : styles.textSafe]}>{messageText}</Text>
        </View>
        <Text style={styles.smallText}>This status is based on recent activity and mock checks.</Text>
      </View>
    );
  }

function CallHistoryList() {
    return (
      <View>
        <Text style={styles.sectionTitle}>Recent Activity</Text>
        <View style={styles.card}>
          <ScrollView style={{ maxHeight: 220 }}>
            {callHistory.map((call) => {
              const isWarningType = call.type === "Warning";
              const isSpam = call.type === "Spam";
              const leftColor = isWarningType ? styles.textWarning : isSpam ? styles.textSpam : styles.textSafe;
              return (
                <View key={call.id} style={styles.callRow}>
                  <View style={[styles.callIcon, leftColor]}>
                    <Text style={{ color: "#fff", fontWeight: "700" }}>{call.type === "Spam" ? "!" : call.type === "Warning" ? "!" : "✓"}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.callNumber}>{call.number}</Text>
                    <Text style={styles.smallText}>{call.status}</Text>
                  </View>
                  <Text style={styles.smallText}>{call.time}</Text>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </View>
    );
  }

  function NewsSection() {
    return (
      <View>
        <Text style={styles.sectionTitle}>Fraud & Scam News</Text>
        <View style={{ gap: 10 }}>
          {scamNews.map((n) => (
            <View key={n.id} style={[styles.card, { borderLeftWidth: 6, borderLeftColor: "#FFCD02" }]}>
              <Text style={{ fontWeight: "700" }}>{n.title}</Text>
              <Text style={styles.smallText}>{n.source}</Text>
              <Text style={[styles.smallText, { color: "#FE9301" }]}>{n.date}</Text>
            </View>
          ))}
        </View>
      </View>
    );
  }

  /* -------------------------
     Screen components
     ------------------------- */
  function HomeScreen() {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <SafetyStatusCard />
        <CallHistoryList />
        <NewsSection />
      </ScrollView>
    );
  }

  function CallScreen() {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Text style={styles.hugeTitle}>Woof! Call/Contacts</Text>
        <View style={styles.card}>
          <View style={styles.contactRow}>
            <View>
              <Text style={{ fontWeight: "700" }}>Mom</Text>
              <Text style={styles.smallText}>Mobile (+60 12-345 6789)</Text>
            </View>
            <TouchableOpacity onPress={() => alertUser("Calling Mom...")} style={[styles.iconButton, styles.safeBg]}>
              <Text>☎️</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.contactRow}>
            <View>
              <Text style={{ fontWeight: "700" }}>Bank Customer Service (Scam Test)</Text>
              <Text style={styles.smallText}>Work (+60 3-1234 5678)</Text>
            </View>
            <TouchableOpacity onPress={triggerCallScam} style={[styles.bigButton]}>
              <Text style={{ color: "#fff", fontWeight: "700" }}>Check</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.smallText, { marginTop: 8 }]}>Tap Check to simulate a suspicious call and trigger the indicator.</Text>
        </View>
      </ScrollView>
    );
  }

  function MessageScreen() {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Text style={styles.hugeTitle}>Woof! Messaging</Text>

Janisa Goh, [25/11/2025 5:07 PM]
<View style={styles.card}>
          <View style={styles.contactRow}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "700" }}>WhatsApp - Unknown Sender (Scam Test)</Text>
              <Text style={styles.smallText}>"Click here to claim your prize!"</Text>
            </View>
            <TouchableOpacity onPress={triggerMessageScam} style={styles.bigButton}>
              <Text style={{ color: "#fff", fontWeight: "700" }}>Check Scam</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.contactRow}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: "700" }}>Email - Netflix Billing (Scam Test)</Text>
              <Text style={styles.smallText}>"Your payment failed. Update details now."</Text>
            </View>
            <TouchableOpacity onPress={triggerMessageScam} style={styles.bigButton}>
              <Text style={{ color: "#fff", fontWeight: "700" }}>Check Scam</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    );
  }

  function NotificationScreen() {
    const mockNotifications = [
      { id: 1, type: "Alert", content: "Suspicious call detected 2 minutes ago.", time: "1:17 PM", color: "#ef4444" },
      { id: 2, type: "Update", content: "New scam database update installed.", time: "10:00 AM", color: "#10b981" },
      { id: 3, type: "Warning", content: "New message from blocked number.", time: "Yesterday", color: "#FE9301" },
      { id: 4, type: "Info", content: "Welcome to Woof! Your protection is active.", time: "Nov 20", color: "#FE9301" },
    ];

    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={styles.hugeTitle}>Woof! Notifications</Text>
        {mockNotifications.map((n) => (
          <View key={n.id} style={[styles.card, { borderLeftWidth: 4, borderLeftColor: n.color }]}>
            <Text style={{ fontWeight: "700" }}>{n.type}: {n.content}</Text>
            <Text style={styles.smallText}>{n.time}</Text>
          </View>
        ))}
        <TouchableOpacity style={[styles.bigButton, { alignSelf: "stretch", marginTop: 12 }]} onPress={() => alertUser("Notifications cleared")}>
          <Text style={{ color: "#fff", fontWeight: "700" }}>Clear Notifications</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  function SettingsScreen() {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={styles.hugeTitle}>Woof! Settings</Text>

        <View style={styles.cardRow}>
          <Text style={{ fontWeight: "700" }}>Scam Detection</Text>
          <Switch value={settings.scamDetectionEnabled} onValueChange={() => setSettings(s => ({ ...s, scamDetectionEnabled: !s.scamDetectionEnabled }))} />
        </View>

        <View style={styles.cardRow}>
          <Text style={{ fontWeight: "700" }}>Dark Mode</Text>
          <Switch value={settings.darkMode} onValueChange={() => setSettings(s => ({ ...s, darkMode: !s.darkMode }))} />
        </View>

        <TouchableOpacity style={[styles.card, { borderLeftWidth: 6, borderLeftColor: "#FFCD02" }]} onPress={() => alertUser("Blocked Numbers (placeholder)")}>
          <Text style={{ fontWeight: "700" }}>Blocked Numbers</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.card, { borderLeftWidth: 6, borderLeftColor: "#FFCD02" }]} onPress={() => alertUser("Privacy and Permissions (placeholder)")}>
          <Text style={{ fontWeight: "700" }}>Privacy and Permissions</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  /* -------------------------
     Main Render
     ------------------------- */
  const themeStyles = settings.darkMode ? darkTheme : lightTheme;


return (
    <SafeAreaView style={[styles.container, themeStyles.container]}>
      <StatusBar barStyle={settings.darkMode ? "light-content" : "dark-content"} />
      {/* Header */}
      <View style={[styles.header, themeStyles.header]}>
        <Text style={[styles.title, { color: "#FE9301", fontWeight: "800" }]}>Woof!</Text>
        <Text style={styles.headerTime}>1:28 PM</Text>
      </View>

      {/* Main */}
      <View style={{ flex: 1 }}>
        {screen === "home" && <HomeScreen />}
        {screen === "call" && <CallScreen />}
        {screen === "message" && <MessageScreen />}
        {screen === "notification" && <NotificationScreen />}
        {screen === "settings" && <SettingsScreen />}
      </View>

      {/* Bottom Navigation */}
      <View style={[styles.navBar, themeStyles.navBar]}>
        <NavButton label="Call" active={screen === "call"} onPress={() => setScreen("call")} />
        <NavButton label="Message" active={screen === "message"} onPress={() => setScreen("message")} />
        <NavButton label="Home" active={screen === "home"} onPress={() => setScreen("home")} primary />
        <NavButton label="Notif" active={screen === "notification"} onPress={() => setScreen("notification")} />
        <NavButton label="Settings" active={screen === "settings"} onPress={() => setScreen("settings")} />
      </View>

      {/* Floating Scam Indicator */}
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

      {/* Modal (details + actions) */}
      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { borderTopColor: "#FE9301" }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Text style={{ fontSize: 22, fontWeight: "900", color: "#FE9301" }}>⚠️</Text>
              <Text style={{ fontSize: 20, fontWeight: "900", color: "#FE9301" }}>SCAM ALERT!</Text>
            </View>
            <Text style={{ marginTop: 12 }}>{modalMessage}</Text>

            {lastConfidence !== null && (
              <Text style={{ marginTop: 8, fontWeight: "700", color: "#FE9301" }}>Confidence: {lastConfidence}%</Text>
            )}

            <View style={{ marginTop: 14 }}>
              {modalActions && modalActions.length > 0 ? (
                modalActions.map((a, idx) => (
                  <TouchableOpacity key={idx} onPress={a.action} style={[styles.bigButton, { marginBottom: 8 }]}>
                    <Text style={{ color: "#fff", fontWeight: "800" }}>{a.label}</Text>
                  </TouchableOpacity>
                ))
              ) : (
                <TouchableOpacity onPress={() => setModalVisible(false)} style={[styles.bigButton]}>
                  <Text style={{ color: "#fff", fontWeight: "800" }}>OK</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={() => { setModalVisible(false); hideIndicator(); }} style={[styles.secondaryButton]}>
                <Text>Ignore for now</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* -------------------------
   Small components & styles
   ------------------------- */

function NavButton({ label, active, onPress, primary }) {
  return (
    <TouchableOpacity onPress={onPress} style={{ flex: 1, alignItems: "center", padding: 10 }}>
      <Text style={{ color: primary ? "#FE9301" : active ? "#FE9301" : "#6b7280", fontWeight: active ? "800" : "600" }}>{label}</Text>
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
  cardTitle: { fontSize: 16, fontWeight: "800", marginBottom: 8 },
  iconCircle: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  iconWarning: { backgroundColor: "#FE9301" },
  iconSafe: { backgroundColor: "#10b981" },
  statusText: { fontSize: 20, fontWeight: "900" },
  textWarning: { color: "#FE9301" },
  textSafe: { color: "#10b981" },
  smallText: { color: "#6b7280", fontSize: 12 },

  sectionTitle: { fontSize: 18, fontWeight: "900", marginBottom: 8 },
  callRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  callIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  callNumber: { fontWeight: "800" },
  callRowRight: { color: "#6b7280" },

  contactRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  iconButton: { padding: 10, borderRadius: 999 },
  safeBg: { backgroundColor: "rgba(16,185,129,0.12)" },

  bigButton: { backgroundColor: "#FE9301", paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  secondaryButton: { borderWidth: 1, borderColor: "#e5e7eb", padding: 10, borderRadius: 12, alignItems: "center", marginTop: 8 },

  floatingIndicator: { position: "absolute", right: 20, bottom: 90, zIndex: 60 },
  floatingInner: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", backgroundColor: "#ef4444", shadowColor: "#000", shadowOpacity: 0.2, elevation: 6 },
  badge: { position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: "#FFCD02", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#ef4444", zIndex: 2 },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center", padding: 20 },
  modalCard: { width: "100%", maxWidth: 420, backgroundColor: "#fff", padding: 18, borderRadius: 14, borderTopWidth: 6 },

  cardRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", padding: 12, borderRadius: 10, shadowColor: "#000", shadowOpacity: 0.04, elevation: 2 },
});

const lightTheme = StyleSheet.create({
  container: { backgroundColor: "#f0f4f8" },
  header: { backgroundColor: "#fff" },
  navBar: { backgroundColor: "#fff" },
});

const darkTheme = StyleSheet.create({
  container: { backgroundColor: "#151428" },
  header: { backgroundColor: "#1f1b2e", borderBottomColor: "#2b2540" },
  navBar: { backgroundColor: "#1f1b2e", borderTopColor: "#2b2540" },
});