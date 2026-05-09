import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Modal, StyleSheet, Alert, Switch } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { ensureReadSmsPermission, scrapeBillsAndSubscriptionsFromSms } from './smsBillScraper';

const COLORS = ['#FF6384','#36A2EB','#FFCE56','#4BC0C0','#9966FF','#FF9F40','#E7E9ED'];

const DEFAULT_CATEGORIES = [
  { id:1, name:'Food', budget:300, color:'#FF6384' },
  { id:2, name:'Transport', budget:150, color:'#36A2EB' },
  { id:3, name:'Entertainment', budget:100, color:'#FFCE56' },
  { id:4, name:'Utilities', budget:200, color:'#4BC0C0' },
  { id:5, name:'Shopping', budget:250, color:'#9966FF' },
];

const DEFAULT_BILLS = [
  { id:1, name:'Spotify', amount:15.90, due:1, paid:false },
  { id:2, name:'Netflix', amount:29.90, due:5, paid:false },
  { id:3, name:'Phone Bill', amount:60.00, due:10, paid:false },
  { id:4, name:'Rent', amount:600.00, due:1, paid:false },
];

const DEFAULT_TXN = [
  { id:1, desc:'KFC', category:'Food', amount:18.50, date:new Date(Date.now()-86400000) },
  { id:2, desc:'Grab', category:'Transport', amount:9.00, date:new Date(Date.now()-2*86400000) },
  { id:3, desc:'Movie', category:'Entertainment', amount:25.00, date:new Date(Date.now()-3*86400000) },
  { id:4, desc:'Uniqlo', category:'Shopping', amount:89.00, date:new Date(Date.now()-8*86400000) },
  { id:5, desc:'TNB Bill', category:'Utilities', amount:85.00, date:new Date(Date.now()-10*86400000) },
  { id:6, desc:'McDonald', category:'Food', amount:22.30, date:new Date(Date.now()-12*86400000) },
];

const TXN_STORAGE_FILE = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}woof_budget_transactions_v1.json`
  : null;

const PROCESSED_SMS_STORAGE_FILE = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}woof_budget_processed_sms_v1.json`
  : null;

async function readJsonFile(path, fallbackValue) {
  if (!path) return fallbackValue;
  try {
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return fallbackValue;
    const raw = await FileSystem.readAsStringAsync(path);
    return JSON.parse(raw);
  } catch (e) {
    return fallbackValue;
  }
}

async function writeJsonFile(path, value) {
  if (!path) return;
  await FileSystem.writeAsStringAsync(path, JSON.stringify(value));
}

export default function BudgetScreen({ darkMode }) {
  const [tab, setTab] = useState('overview');
  const [txnFilter, setTxnFilter] = useState('week');
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [bills, setBills] = useState(DEFAULT_BILLS);
  const [transactions, setTransactions] = useState(DEFAULT_TXN);
  const [hydrated, setHydrated] = useState(false);
  const smsScrapeStartedRef = useRef(false);
  const [addModal, setAddModal] = useState(false);
  const [addBillModal, setAddBillModal] = useState(false);
  const [addTxnModal, setAddTxnModal] = useState(false);
  const [editCat, setEditCat] = useState(null);
  const [newCat, setNewCat] = useState({ name:'', budget:'' });
  const [newBill, setNewBill] = useState({ name:'', amount:'', due:'' });
  const [newTxn, setNewTxn] = useState({ desc:'', category:'Food', amount:'' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const parsed = await readJsonFile(TXN_STORAGE_FILE, null);
        if (!Array.isArray(parsed)) return;

        const revived = parsed
          .filter(Boolean)
          .map((t) => ({
            ...t,
            amount: Number(t.amount),
            date: new Date(t.date),
          }))
          .filter((t) => Number.isFinite(t.amount) && t.date instanceof Date && !Number.isNaN(t.date.getTime()));

        if (!cancelled && revived.length > 0) setTransactions(revived);
      } catch (e) {
        console.warn('Failed to load saved transactions', e);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    (async () => {
      try {
        const serializable = transactions.map((t) => ({
          ...t,
          date: t.date instanceof Date ? t.date.getTime() : t.date,
        }));
        await writeJsonFile(TXN_STORAGE_FILE, serializable);
      } catch (e) {
        console.warn('Failed to persist transactions', e);
      }
    })();
  }, [transactions, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    if (smsScrapeStartedRef.current) return;
    smsScrapeStartedRef.current = true;

    (async () => {
      try {
        const permission = await ensureReadSmsPermission();
        if (!permission.granted) return;

        const candidates = await scrapeBillsAndSubscriptionsFromSms({ daysBack: 30 });
        if (candidates.length === 0) return;

        const processedList = await readJsonFile(PROCESSED_SMS_STORAGE_FILE, []);
        const processedKeys = new Set(processedList);

        const newOnes = candidates.filter((c) => c?.key && !processedKeys.has(c.key));
        if (newOnes.length === 0) return;

        setTransactions((prev) => {
          const maxId = prev.reduce((m, t) => Math.max(m, Number(t.id) || 0), 0);
          let nextId = maxId + 1;

          const added = newOnes.map((c) => ({
            id: nextId++,
            desc: c.desc,
            category: c.category,
            amount: c.amount,
            date: new Date(c.dateMs),
          }));

          const merged = [...added, ...prev];
          merged.sort((a, b) => b.date - a.date);
          return merged;
        });

        newOnes.forEach((c) => processedKeys.add(c.key));
        const trimmed = Array.from(processedKeys).slice(-1500);
        await writeJsonFile(PROCESSED_SMS_STORAGE_FILE, trimmed);
      } catch (e) {
        console.warn('SMS bill scrape failed', e);
      }
    })();
  }, [hydrated]);

  const bg = darkMode ? '#151428' : '#f0f4f8';
  const card = darkMode ? '#1f1b2e' : '#fff';
  const txt = darkMode ? '#fff' : '#1a1a2e';
  const sub = darkMode ? '#9CA3AF' : '#6b7280';
  const accent = '#FE9301';

  const now = Date.now();
  const weekAgo = now - 7*86400000;
  const monthAgo = now - 30*86400000;

  const filtered = transactions.filter(t => {
    if (txnFilter === 'week') return t.date >= weekAgo;
    if (txnFilter === 'month') return t.date >= monthAgo;
    return true;
  });

  const totalSpent = transactions.filter(t => t.date >= monthAgo).reduce((s,t) => s+t.amount, 0);
  const totalBudget = categories.reduce((s,c) => s+c.budget, 0);
  const isOverBudget = totalSpent > totalBudget;

  const spentByCategory = categories.map(c => ({
    ...c,
    spent: transactions.filter(t => t.category === c.name && t.date >= monthAgo).reduce((s,t) => s+t.amount, 0)
  }));

  const unpaidBills = bills.filter(b => !b.paid);
  const totalBills = unpaidBills.reduce((s,b) => s+b.amount, 0);

  function PieChart({ data, total }) {
    if (total === 0) return <Text style={{ color: sub, textAlign:'center', marginVertical:20 }}>No spending data yet.</Text>;
    let startAngle = 0;
    const size = 160;
    const cx = size/2, cy = size/2, r = 60, stroke = 28;
    const circumference = 2 * Math.PI * r;
    const slices = data.map(d => {
      const pct = total > 0 ? d.spent / total : 0;
      const dash = pct * circumference;
      const offset = -startAngle * circumference / (2 * Math.PI);
      startAngle += pct * 2 * Math.PI;
      return { ...d, dash, offset, pct };
    }).filter(d => d.spent > 0);
    return (
      <View style={{ alignItems:'center', marginVertical:10 }}>
        <View style={{ width:size, height:size }}>
          {slices.map((s,i) => (
            <View key={i} style={[StyleSheet.absoluteFill, { borderRadius:size/2, borderWidth:stroke, borderColor:s.color, opacity: s.pct }]} />
          ))}
          <View style={{ position:'absolute', top:size/2-30, left:size/2-30, width:60, height:60, borderRadius:30, backgroundColor:card, alignItems:'center', justifyContent:'center' }}>
            <Text style={{ fontSize:11, fontWeight:'800', color:accent }}>RM{total.toFixed(0)}</Text>
            <Text style={{ fontSize:9, color:sub }}>spent</Text>
          </View>
        </View>
        <View style={{ flexDirection:'row', flexWrap:'wrap', justifyContent:'center', marginTop:8, gap:6 }}>
          {slices.map((s,i) => (
            <View key={i} style={{ flexDirection:'row', alignItems:'center', gap:4, marginHorizontal:4 }}>
              <View style={{ width:10, height:10, borderRadius:5, backgroundColor:s.color }} />
              <Text style={{ fontSize:11, color:txt }}>{s.name} {(s.pct*100).toFixed(0)}%</Text>
            </View>
          ))}
        </View>
      </View>
    );
  }

  function OverviewTab() {
    return (
      <ScrollView contentContainerStyle={{ padding:16, gap:14 }}>
        {isOverBudget && (
          <View style={[styles.warningBanner, { backgroundColor:'#FFF3E0', borderColor:accent }]}>
            <Text style={{ fontSize:18 }}>⚠️</Text>
            <View style={{ flex:1 }}>
              <Text style={{ fontWeight:'800', color:accent, fontSize:14 }}>Overspending Alert!</Text>
              <Text style={{ color:'#92400E', fontSize:12 }}>You've spent RM{totalSpent.toFixed(2)} of your RM{totalBudget} budget this month.</Text>
            </View>
          </View>
        )}
        <View style={[styles.card, { backgroundColor:card }]}>
          <Text style={[styles.sectionTitle, { color:txt }]}>Monthly Summary</Text>
          <View style={{ flexDirection:'row', justifyContent:'space-between', marginTop:8 }}>
            <View style={{ alignItems:'center' }}>
              <Text style={{ fontSize:20, fontWeight:'900', color: isOverBudget ? '#ef4444' : '#10b981' }}>RM{totalSpent.toFixed(2)}</Text>
              <Text style={{ fontSize:11, color:sub }}>Spent</Text>
            </View>
            <View style={{ width:1, backgroundColor:'#e5e7eb' }} />
            <View style={{ alignItems:'center' }}>
              <Text style={{ fontSize:20, fontWeight:'900', color:accent }}>RM{totalBudget}</Text>
              <Text style={{ fontSize:11, color:sub }}>Budget</Text>
            </View>
            <View style={{ width:1, backgroundColor:'#e5e7eb' }} />
            <View style={{ alignItems:'center' }}>
              <Text style={{ fontSize:20, fontWeight:'900', color: totalBudget-totalSpent < 0 ? '#ef4444' : '#10b981' }}>RM{(totalBudget-totalSpent).toFixed(2)}</Text>
              <Text style={{ fontSize:11, color:sub }}>Remaining</Text>
            </View>
          </View>
          <View style={{ height:10, backgroundColor:'#f3f4f6', borderRadius:5, marginTop:14, overflow:'hidden' }}>
            <View style={{ height:10, width:`${Math.min(100,(totalSpent/totalBudget)*100)}%`, backgroundColor: isOverBudget ? '#ef4444' : '#10b981', borderRadius:5 }} />
          </View>
          <Text style={{ fontSize:11, color:sub, marginTop:4 }}>{Math.min(100,(totalSpent/totalBudget)*100).toFixed(0)}% of budget used</Text>
        </View>
        <View style={[styles.card, { backgroundColor:card }]}>
          <Text style={[styles.sectionTitle, { color:txt }]}>Spending by Category</Text>
          <PieChart data={spentByCategory} total={totalSpent} />
        </View>
        <View style={[styles.card, { backgroundColor:card }]}>
          <Text style={[styles.sectionTitle, { color:txt }]}>Categories</Text>
          {spentByCategory.map(c => (
            <TouchableOpacity key={c.id} onPress={() => { setEditCat(c); setNewCat({ name:c.name, budget:String(c.budget) }); setAddModal(true); }} style={styles.catRow}>
              <View style={{ width:12, height:12, borderRadius:6, backgroundColor:c.color, marginRight:10 }} />
              <Text style={{ flex:1, fontWeight:'700', color:txt, fontSize:13 }}>{c.name}</Text>
              <Text style={{ fontSize:12, color: c.spent > c.budget ? '#ef4444' : '#10b981' }}>RM{c.spent.toFixed(2)}</Text>
              <Text style={{ fontSize:12, color:sub, marginLeft:4 }}>/ RM{c.budget}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity onPress={() => { setEditCat(null); setNewCat({ name:'', budget:'' }); setAddModal(true); }} style={[styles.addBtn, { borderColor:accent }]}>
            <Text style={{ color:accent, fontWeight:'700' }}>+ Add Category</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  function TransactionsTab() {
    return (
      <ScrollView contentContainerStyle={{ padding:16, gap:12 }}>
        <View style={{ flexDirection:'row', gap:8, marginBottom:4 }}>
          {['week','month','all'].map(f => (
            <TouchableOpacity key={f} onPress={() => setTxnFilter(f)} style={[styles.filterBtn, { backgroundColor: txnFilter===f ? accent : card, borderColor: accent }]}>
              <Text style={{ color: txnFilter===f ? '#fff' : accent, fontWeight:'700', fontSize:12 }}>{f==='week'?'Past Week':f==='month'?'Past Month':'All'}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {filtered.length === 0 && <Text style={{ color:sub, textAlign:'center', marginTop:20 }}>No transactions found.</Text>}
        {filtered.map(t => {
          const cat = categories.find(c => c.name === t.category);
          return (
            <View key={t.id} style={[styles.card, { backgroundColor:card, flexDirection:'row', alignItems:'center', padding:12 }]}>
              <View style={{ width:40, height:40, borderRadius:20, backgroundColor: cat?.color || accent, alignItems:'center', justifyContent:'center', marginRight:12 }}>
                <Text style={{ color:'#fff', fontSize:16 }}>{t.category === 'Food' ? '🍔' : t.category === 'Transport' ? '🚗' : t.category === 'Entertainment' ? '🎬' : t.category === 'Shopping' ? '🛍️' : '💡'}</Text>
              </View>
              <View style={{ flex:1 }}>
                <Text style={{ fontWeight:'700', color:txt, fontSize:14 }}>{t.desc}</Text>
                <Text style={{ fontSize:11, color:sub }}>{t.category} · {t.date.toLocaleDateString()}</Text>
              </View>
              <Text style={{ fontWeight:'800', color:'#ef4444', fontSize:15 }}>-RM{t.amount.toFixed(2)}</Text>
            </View>
          );
        })}
        <TouchableOpacity onPress={() => setAddTxnModal(true)} style={[styles.bigBtn, { backgroundColor:accent }]}>
          <Text style={{ color:'#fff', fontWeight:'800', fontSize:15 }}>+ Add Transaction</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  function BillsTab() {
    const approveAll = () => {
      Alert.alert('Approve All Bills', `Pay RM${totalBills.toFixed(2)} for ${unpaidBills.length} bills?`, [
        { text:'Cancel', style:'cancel' },
        { text:'Approve All', onPress: () => setBills(b => b.map(x => ({ ...x, paid:true }))) }
      ]);
    };
    return (
      <ScrollView contentContainerStyle={{ padding:16, gap:12 }}>
        <View style={[styles.card, { backgroundColor: '#FFF3E0', borderColor:accent, borderWidth:1.5 }]}>
          <Text style={{ fontWeight:'800', color:accent, fontSize:15, marginBottom:4 }}>Monthly Bills</Text>
          <Text style={{ color:'#92400E', fontSize:13 }}>Total due: <Text style={{ fontWeight:'800' }}>RM{totalBills.toFixed(2)}</Text></Text>
        </View>
        {bills.map(b => (
          <View key={b.id} style={[styles.card, { backgroundColor:card, flexDirection:'row', alignItems:'center' }]}>
            <View style={{ flex:1 }}>
              <Text style={{ fontWeight:'700', color:txt, fontSize:14 }}>{b.name}</Text>
              <Text style={{ fontSize:12, color:sub }}>Due: {b.due}{b.due===1?'st':b.due===2?'nd':b.due===3?'rd':'th'} of month</Text>
            </View>
            <Text style={{ fontWeight:'800', color: b.paid ? '#10b981' : '#ef4444', marginRight:12, fontSize:14 }}>RM{b.amount.toFixed(2)}</Text>
            <TouchableOpacity onPress={() => setBills(bl => bl.map(x => x.id===b.id ? { ...x, paid:!x.paid } : x))}
              style={[styles.payBtn, { backgroundColor: b.paid ? '#10b981' : accent }]}>
              <Text style={{ color:'#fff', fontWeight:'800', fontSize:12 }}>{b.paid ? '✓ Paid' : 'Pay'}</Text>
            </TouchableOpacity>
          </View>
        ))}
        {unpaidBills.length > 0 && (
          <TouchableOpacity onPress={approveAll} style={[styles.bigBtn, { backgroundColor:'#10b981' }]}>
            <Text style={{ color:'#fff', fontWeight:'800', fontSize:15 }}>✓ Approve All ({unpaidBills.length}) Bills</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={() => { setNewBill({ name:'', amount:'', due:'' }); setAddBillModal(true); }} style={[styles.addBtn, { borderColor:accent }]}>
          <Text style={{ color:accent, fontWeight:'700' }}>+ Add Bill / Subscription</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <View style={{ flex:1, backgroundColor:bg }}>
      <View style={{ padding:16, paddingBottom:0 }}>
        <Text style={{ fontSize:24, fontWeight:'900', color: darkMode ? '#fff' : '#1a1a2e', marginBottom:12 }}>💰 Budget Tracker</Text>
        <View style={{ flexDirection:'row', gap:8 }}>
          {[['overview','📊 Overview'],['transactions','💳 Transactions'],['bills','📋 Bills']].map(([t,l]) => (
            <TouchableOpacity key={t} onPress={() => setTab(t)} style={[styles.tabBtn, { backgroundColor: tab===t ? accent : card, flex:1 }]}>
              <Text style={{ color: tab===t ? '#fff' : sub, fontWeight:'700', fontSize:11, textAlign:'center' }}>{l}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      {tab === 'overview' && <OverviewTab />}
      {tab === 'transactions' && <TransactionsTab />}
      {tab === 'bills' && <BillsTab />}

      {/* Add/Edit Category Modal */}
      <Modal visible={addModal} transparent animationType="slide" onRequestClose={() => setAddModal(false)}>
        <View style={styles.modalBg}>
          <View style={[styles.modalCard, { backgroundColor:card }]}>
            <Text style={{ fontSize:18, fontWeight:'900', color:txt, marginBottom:16 }}>{editCat ? 'Edit Category' : 'New Category'}</Text>
            <TextInput style={[styles.input, { color:txt, borderColor:'#e5e7eb', backgroundColor: darkMode ? '#2b2540' : '#f9fafb' }]} placeholder="Category name" placeholderTextColor={sub} value={newCat.name} onChangeText={v => setNewCat(p => ({ ...p, name:v }))} />
            <TextInput style={[styles.input, { color:txt, borderColor:'#e5e7eb', backgroundColor: darkMode ? '#2b2540' : '#f9fafb', marginTop:10 }]} placeholder="Monthly budget (RM)" placeholderTextColor={sub} keyboardType="numeric" value={newCat.budget} onChangeText={v => setNewCat(p => ({ ...p, budget:v }))} />
            <View style={{ flexDirection:'row', gap:10, marginTop:16 }}>
              {editCat && <TouchableOpacity onPress={() => { setCategories(c => c.filter(x => x.id !== editCat.id)); setAddModal(false); }} style={[styles.bigBtn, { flex:1, backgroundColor:'#ef4444' }]}><Text style={{ color:'#fff', fontWeight:'800' }}>Delete</Text></TouchableOpacity>}
              <TouchableOpacity onPress={() => setAddModal(false)} style={[styles.bigBtn, { flex:1, backgroundColor:'#e5e7eb' }]}><Text style={{ fontWeight:'800' }}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.bigBtn, { flex:1, backgroundColor:accent }]} onPress={() => {
                if (!newCat.name || !newCat.budget) return;
                if (editCat) {
                  setCategories(c => c.map(x => x.id===editCat.id ? { ...x, name:newCat.name, budget:parseFloat(newCat.budget) } : x));
                } else {
                  setCategories(c => [...c, { id:Date.now(), name:newCat.name, budget:parseFloat(newCat.budget), color:COLORS[c.length % COLORS.length] }]);
                }
                setAddModal(false);
              }}><Text style={{ color:'#fff', fontWeight:'800' }}>Save</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Add Bill Modal */}
      <Modal visible={addBillModal} transparent animationType="slide" onRequestClose={() => setAddBillModal(false)}>
        <View style={styles.modalBg}>
          <View style={[styles.modalCard, { backgroundColor:card }]}>
            <Text style={{ fontSize:18, fontWeight:'900', color:txt, marginBottom:16 }}>Add Bill / Subscription</Text>
            <TextInput style={[styles.input, { color:txt, borderColor:'#e5e7eb', backgroundColor: darkMode ? '#2b2540' : '#f9fafb' }]} placeholder="Name (e.g. Netflix)" placeholderTextColor={sub} value={newBill.name} onChangeText={v => setNewBill(p => ({ ...p, name:v }))} />
            <TextInput style={[styles.input, { color:txt, borderColor:'#e5e7eb', backgroundColor: darkMode ? '#2b2540' : '#f9fafb', marginTop:10 }]} placeholder="Amount (RM)" placeholderTextColor={sub} keyboardType="numeric" value={newBill.amount} onChangeText={v => setNewBill(p => ({ ...p, amount:v }))} />
            <TextInput style={[styles.input, { color:txt, borderColor:'#e5e7eb', backgroundColor: darkMode ? '#2b2540' : '#f9fafb', marginTop:10 }]} placeholder="Due day of month (1-31)" placeholderTextColor={sub} keyboardType="numeric" value={newBill.due} onChangeText={v => setNewBill(p => ({ ...p, due:v }))} />
            <View style={{ flexDirection:'row', gap:10, marginTop:16 }}>
              <TouchableOpacity onPress={() => setAddBillModal(false)} style={[styles.bigBtn, { flex:1, backgroundColor:'#e5e7eb' }]}><Text style={{ fontWeight:'800' }}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.bigBtn, { flex:1, backgroundColor:accent }]} onPress={() => {
                if (!newBill.name || !newBill.amount) return;
                setBills(b => [...b, { id:Date.now(), name:newBill.name, amount:parseFloat(newBill.amount), due:parseInt(newBill.due)||1, paid:false }]);
                setAddBillModal(false);
              }}><Text style={{ color:'#fff', fontWeight:'800' }}>Add</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Add Transaction Modal */}
      <Modal visible={addTxnModal} transparent animationType="slide" onRequestClose={() => setAddTxnModal(false)}>
        <View style={styles.modalBg}>
          <View style={[styles.modalCard, { backgroundColor:card }]}>
            <Text style={{ fontSize:18, fontWeight:'900', color:txt, marginBottom:16 }}>Log Transaction</Text>
            <TextInput style={[styles.input, { color:txt, borderColor:'#e5e7eb', backgroundColor: darkMode ? '#2b2540' : '#f9fafb' }]} placeholder="Description" placeholderTextColor={sub} value={newTxn.desc} onChangeText={v => setNewTxn(p => ({ ...p, desc:v }))} />
            <TextInput style={[styles.input, { color:txt, borderColor:'#e5e7eb', backgroundColor: darkMode ? '#2b2540' : '#f9fafb', marginTop:10 }]} placeholder="Amount (RM)" placeholderTextColor={sub} keyboardType="numeric" value={newTxn.amount} onChangeText={v => setNewTxn(p => ({ ...p, amount:v }))} />
            <Text style={{ color:sub, marginTop:10, marginBottom:6, fontWeight:'700' }}>Category:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom:4 }}>
              {categories.map(c => (
                <TouchableOpacity key={c.id} onPress={() => setNewTxn(p => ({ ...p, category:c.name }))} style={{ paddingHorizontal:12, paddingVertical:6, borderRadius:20, marginRight:8, backgroundColor: newTxn.category===c.name ? c.color : '#f3f4f6' }}>
                  <Text style={{ fontWeight:'700', color: newTxn.category===c.name ? '#fff' : '#6b7280', fontSize:12 }}>{c.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <View style={{ flexDirection:'row', gap:10, marginTop:16 }}>
              <TouchableOpacity onPress={() => setAddTxnModal(false)} style={[styles.bigBtn, { flex:1, backgroundColor:'#e5e7eb' }]}><Text style={{ fontWeight:'800' }}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.bigBtn, { flex:1, backgroundColor:accent }]} onPress={() => {
                if (!newTxn.desc || !newTxn.amount) return;
                setTransactions(t => [{ id:Date.now(), desc:newTxn.desc, category:newTxn.category, amount:parseFloat(newTxn.amount), date:new Date() }, ...t]);
                setAddTxnModal(false);
              }}><Text style={{ color:'#fff', fontWeight:'800' }}>Add</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius:14, padding:14, shadowColor:'#000', shadowOpacity:0.06, shadowRadius:8, elevation:3 },
  sectionTitle: { fontSize:16, fontWeight:'900', marginBottom:4 },
  catRow: { flexDirection:'row', alignItems:'center', paddingVertical:10, borderBottomWidth:1, borderBottomColor:'#f3f4f6' },
  addBtn: { borderWidth:1.5, borderRadius:12, padding:12, alignItems:'center', marginTop:8 },
  bigBtn: { borderRadius:12, paddingVertical:12, paddingHorizontal:16, alignItems:'center', justifyContent:'center' },
  payBtn: { borderRadius:10, paddingVertical:6, paddingHorizontal:12 },
  filterBtn: { borderRadius:20, paddingVertical:8, paddingHorizontal:12, borderWidth:1.5, alignItems:'center' },
  tabBtn: { borderRadius:12, paddingVertical:10, paddingHorizontal:8 },
  warningBanner: { flexDirection:'row', alignItems:'center', gap:10, borderRadius:14, padding:14, borderWidth:1.5 },
  modalBg: { flex:1, backgroundColor:'rgba(0,0,0,0.5)', justifyContent:'flex-end' },
  modalCard: { borderTopLeftRadius:24, borderTopRightRadius:24, padding:24, paddingBottom:40 },
  input: { borderWidth:1, borderRadius:10, padding:12, fontSize:15 },
});
