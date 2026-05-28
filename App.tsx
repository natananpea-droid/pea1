import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Patient, Priority, PowerStatus, PlannedOutageZone } from './types';
import { EQUIPMENT_OPTIONS } from './constants';
import PatientMap from './components/PatientMap';
import PatientCard from './components/PatientCard';
import { assessPatientPriority } from './services/geminiService';
import { Bell, Volume2, VolumeX, AlertTriangle, Crosshair } from 'lucide-react';

const App: React.FC = () => {
  // Real-time synchronization states through Server-authoritative WebSocket
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
  const [isAssessing, setIsAssessing] = useState(false);
  const [isSimulationEnabled, setIsSimulationEnabled] = useState(true);

  // Real-time alarm notification states
  const [isAlertMuted, setIsAlertMuted] = useState(false);
  const [alerts, setAlerts] = useState<{ id: string; patient: Patient; timestamp: string }[]>([]);
  const [activeOutageModal, setActiveOutageModal] = useState<Patient | null>(null);
  const [patientToDelete, setPatientToDelete] = useState<Patient | null>(null);
  const prevPatientsRef = useRef<Patient[]>([]);

  // Programmatic alarm tone synthesizer using Web Audio API
  const playOutageAlarm = useCallback(() => {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const now = ctx.currentTime;

      // Play emergency tone sequence 
      const playTone = (startTime: number, duration: number, frequency: number, type: 'sawtooth' | 'sine' | 'triangle' = 'sawtooth') => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(frequency, startTime);
        // Add sweep
        osc.frequency.linearRampToValueAtTime(frequency + 60, startTime + duration / 3);
        osc.frequency.linearRampToValueAtTime(frequency, startTime + duration);
        
        gain.gain.setValueAtTime(0, startTime);
        gain.gain.linearRampToValueAtTime(0.18, startTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + duration);
      };

      // Two-tone warning siren (High G5 - Low E5, repeated twice)
      playTone(now, 0.35, 784, 'sawtooth');
      playTone(now + 0.4, 0.35, 659, 'sawtooth');
      playTone(now + 0.8, 0.35, 784, 'sawtooth');
      playTone(now + 1.2, 0.5, 659, 'triangle');
    } catch (e) {
      console.warn("Audio Context blocked or uninitialized. Autoplay needs a user action.", e);
    }
  }, []);

  // Admin Module & Pin authorization
  const [isAdmin, setIsAdmin] = useState(false);
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');

  // Phone Verification / Authorized Login Session State
  const [loggedInPhone, setLoggedInPhone] = useState<string | null>(null);
  const [phoneLoginInput, setPhoneLoginInput] = useState<string>('');
  const [phoneLoginError, setPhoneLoginError] = useState<string>('');

  const handleLogout = () => {
    setIsAdmin(false);
    setLoggedInPhone(null);
    setPhoneLoginInput('');
    setPhoneLoginError('');
    setIsPlanningMode(false);
  };

  // WebSocket Server Connection states
  const socketRef = useRef<WebSocket | null>(null);
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  
  // Planning Mode States - Set default center to Rayong City
  const [isPlanningMode, setIsPlanningMode] = useState(false);
  const [plannedZone, setPlannedZone] = useState<PlannedOutageZone>({
    center: { lat: 12.6814, lng: 101.2813 },
    radiusKm: 1.5,
    isActive: false
  });

  // New Patient Form State
  const [newPatient, setNewPatient] = useState({
    name: '',
    age: '',
    condition: '',
    equipment: [] as string[],
    address: '',
    contact: '',
    lat: 12.6814,
    lng: 101.2813
  });

  // Load State from server via REST API on Mount (Immediate & Robust Fallback)
  const fetchStateHTTP = useCallback(async () => {
    try {
      const res = await fetch("/api/state");
      if (res.ok) {
        const data = await res.json();
        if (data.patients) setPatients(data.patients);
        if (data.plannedZone) setPlannedZone(data.plannedZone);
        if (data.isSimulationEnabled !== undefined) setIsSimulationEnabled(data.isSimulationEnabled);
        console.log("System state successfully synced via HTTP REST.");
      }
    } catch (err) {
      console.warn("Failed to retrieve system state via REST API, will retry:", err);
    }
  }, []);

  // Sync state on load
  useEffect(() => {
    fetchStateHTTP();
  }, [fetchStateHTTP]);

  // Establish WebSocket connection and handle auto-reconnection
  useEffect(() => {
    let socket: WebSocket;
    let reconnectTimeout: any;
    let pollingInterval: any;

    const connect = () => {
      setWsStatus('connecting');
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      
      socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        setWsStatus('connected');
        console.log('Real-time connection established successfully.');
        if (pollingInterval) clearInterval(pollingInterval);
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'STATE_SYNC') {
            setPatients(msg.data.patients);
            setPlannedZone(msg.data.plannedZone);
            setIsSimulationEnabled(msg.data.isSimulationEnabled);
          }
        } catch (e) {
          console.error('Failed parsing sync payload:', e);
        }
      };

      socket.onclose = () => {
        setWsStatus('disconnected');
        reconnectTimeout = setTimeout(connect, 3000); // retry connect in 3 seconds
        
        // Start polling fallback when disconnected
        if (!pollingInterval) {
          pollingInterval = setInterval(fetchStateHTTP, 5000);
        }
      };

      socket.onerror = (err) => {
        console.error('WebSocket encountered error:', err);
        socket.close();
      };
    };

    connect();

    return () => {
      if (socket) socket.close();
      clearTimeout(reconnectTimeout);
      if (pollingInterval) clearInterval(pollingInterval);
    };
  }, [fetchStateHTTP]);

  // Monitor patients for newly occurred outages to trigger visual alerts and programmatic sound
  useEffect(() => {
    const prevList = prevPatientsRef.current;
    if (prevList && prevList.length > 0 && patients && patients.length > 0) {
      const detectedOutages: Patient[] = [];
      patients.forEach(newPat => {
        const prevPat = prevList.find(p => p.id === newPat.id);
        
        const isNowOutage = (newPat.status === PowerStatus.OUTAGE || newPat.status === PowerStatus.PLANNED_OUTAGE);
        const wasNormal = !prevPat || prevPat.status === PowerStatus.NORMAL;

        if (isNowOutage && wasNormal) {
          detectedOutages.push(newPat);
        }
      });

      if (detectedOutages.length > 0) {
        const newAlertObjects = detectedOutages.map(pat => ({
          id: `${pat.id}-${Date.now()}`,
          patient: pat,
          timestamp: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
        }));

        setAlerts(prev => [...newAlertObjects, ...prev]);

        // Find the most critical patient affected to serve as the main focus pop-up modal
        const criticalOutage = detectedOutages.find(p => p.priority === Priority.CRITICAL) || detectedOutages[0];
        setActiveOutageModal(criticalOutage);

        if (!isAlertMuted) {
          playOutageAlarm();
        }
      }
    }
    prevPatientsRef.current = patients;
  }, [patients, isAlertMuted, playOutageAlarm]);

  // Send action instructions to server to broadcast and sync
  const sendAction = async (action: string, data: any) => {
    // Optimistic state updates to make the UI ultra-fluid and instant and prevent UI freezes
    if (action === 'ADD_PATIENT') {
      setPatients(prev => [data, ...prev]);
    } else if (action === 'UPDATE_PATIENT') {
      setPatients(prev => prev.map(p => p.id === data.id ? { ...p, ...data } : p));
    } else if (action === 'DELETE_PATIENT') {
      setPatients(prev => prev.filter(p => p.id !== data.id));
    } else if (action === 'UPDATE_PLANNED_ZONE') {
      setPlannedZone(prev => ({ ...prev, ...data }));
    } else if (action === 'UPDATE_SIMULATION') {
      setIsSimulationEnabled(!!data.isSimulationEnabled);
    }

    try {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({
          type: 'ACTION',
          action,
          data
        }));
      } else {
        console.warn('WebSocket not active, syncing action via highly-reliable REST interface.');
        const response = await fetch('/api/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, data })
        });
        if (!response.ok) {
          throw new Error(`REST action post returned error: ${response.status}`);
        }
      }
    } catch (err) {
      console.error('Failed to synchronize and save action payload with server:', err);
    }
  };

  const handleUpdateStatus = (id: string, status: PowerStatus) => {
    const target = patients.find(p => p.id === id);
    if (!target) return;

    const updated = {
      ...target,
      status,
      estimatedRestorationTime: status === PowerStatus.OUTAGE 
        ? new Date(Date.now() + 3600000).toISOString() 
        : undefined
    };
    sendAction('UPDATE_PATIENT', updated);
  };

  const handleDeletePatient = (id: string) => {
    if (!isAdmin) {
      alert("⚠️ ข้อผิดพลาด: เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถลบข้อมูลได้");
      return;
    }
    const target = patients.find(p => p.id === id);
    if (target) {
      setPatientToDelete(target);
    }
  };

  const handleConfirmDelete = () => {
    if (!patientToDelete) return;
    sendAction('DELETE_PATIENT', { id: patientToDelete.id });
    if (selectedPatient?.id === patientToDelete.id) setSelectedPatient(null);
    setPatientToDelete(null);
  };

  const handleAddPatient = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAssessing(true);
    
    try {
      let finalPriority = Priority.MEDIUM;
      try {
        const assessment = await assessPatientPriority(newPatient.condition, newPatient.equipment);
        if (assessment && assessment.priority) {
          finalPriority = assessment.priority as Priority;
        }
      } catch (aiErr) {
        console.warn("AI assessment failed during patient registration, using rule-based fallback:", aiErr);
        // Robust rule-based fallback
        const eqStr = (newPatient.equipment || []).join(' ').toLowerCase();
        const condStr = newPatient.condition.toLowerCase();
        if (eqStr.includes('ช่วยหายใจ') || condStr.includes('เครื่องช่วยหายใจ')) {
          finalPriority = Priority.CRITICAL;
        } else if (eqStr.includes('ออกซิเจน') || eqStr.includes('เสมหะ')) {
          finalPriority = Priority.HIGH;
        }
      }

      const patient: Patient = {
        id: Math.random().toString(36).substring(2, 11),
        name: newPatient.name,
        age: parseInt(newPatient.age) || 0,
        condition: newPatient.condition,
        equipment: newPatient.equipment,
        address: newPatient.address,
        contact: newPatient.contact,
        coordinates: { lat: newPatient.lat, lng: newPatient.lng },
        priority: finalPriority,
        status: PowerStatus.NORMAL,
        lastUpdated: new Date().toISOString()
      };
      
      sendAction('ADD_PATIENT', patient);
      setIsFormOpen(false);
      setNewPatient({ name: '', age: '', condition: '', equipment: [], address: '', contact: '', lat: 12.6814, lng: 101.2813 });
    } catch (err) {
      console.error("Critical error in registering new patient:", err);
    } finally {
      setIsAssessing(false);
    }
  };

  const handleSaveEditPatient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPatient) return;
    setIsAssessing(true);

    try {
      // 1. Attempt to run AI assessment matching edited fields
      let finalPriority = editingPatient.priority;
      try {
        const assessment = await assessPatientPriority(editingPatient.condition, editingPatient.equipment);
        if (assessment && assessment.priority) {
          finalPriority = assessment.priority as Priority;
        }
      } catch (aiErr) {
        console.warn("AI priority assessment failed, using manually-selected/existing priority instead:", aiErr);
      }

      const updated: Patient = {
        ...editingPatient,
        priority: finalPriority,
        lastUpdated: new Date().toISOString()
      };

      sendAction('UPDATE_PATIENT', updated);
      setEditingPatient(null);
    } catch (err) {
      console.error("Critical error in saving edited patient data:", err);
      // Fallback: guaranteed instant save to avoid freezing the Admin modal
      const fallbackUpdated: Patient = {
        ...editingPatient,
        lastUpdated: new Date().toISOString()
      };
      sendAction('UPDATE_PATIENT', fallbackUpdated);
      setEditingPatient(null);
    } finally {
      setIsAssessing(false);
    }
  };

  const toggleEquipment = (item: string) => {
    setNewPatient(prev => ({
      ...prev,
      equipment: prev.equipment.includes(item) 
        ? prev.equipment.filter(e => e !== item) 
        : [...prev.equipment, item]
    }));
  };

  const toggleEditEquipment = (item: string) => {
    if (!editingPatient) return;
    setEditingPatient(prev => {
      if (!prev) return null;
      return {
        ...prev,
        equipment: prev.equipment.includes(item)
          ? prev.equipment.filter(e => e !== item)
          : [...prev.equipment, item]
      };
    });
  };

  // Synchronised Outage Simulation toggle
  const toggleSimulationSync = () => {
    if (!isAdmin) {
      alert("⚠️ สิทธิ์การใช้งานจำกัด: เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่เปิด/ปิดระบบจำลองไฟดับได้");
      return;
    }
    sendAction('UPDATE_SIMULATION', { isSimulationEnabled: !isSimulationEnabled });
  };

  // Sync planned outage zone variables to database
  const updatePlannedZoneSync = (updatedZone: any) => {
    sendAction('UPDATE_PLANNED_ZONE', updatedZone);
  };

  // Logic to identify patients in planned zone
  const affectedByPlanning = useMemo(() => {
    if (!plannedZone.isActive) return [];
    return patients.filter(p => {
      // Euclidean approximation for simple demo (1 deg ~= 111km)
      const distLat = p.coordinates.lat - plannedZone.center.lat;
      const distLng = p.coordinates.lng - plannedZone.center.lng;
      const distance = Math.sqrt(distLat * distLat + distLng * distLng) * 111;
      return distance <= plannedZone.radiusKm;
    });
  }, [patients, plannedZone]);

  const totalCritical = patients.filter(p => p.priority === Priority.CRITICAL).length;
  const currentOutages = patients.filter(p => p.status === PowerStatus.OUTAGE).length;

  // Handle Admin Authorization
  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pinInput.toUpperCase() === 'H02101') {
      setIsAdmin(true);
      setIsPinModalOpen(false);
      setPinInput('');
      setPinError('');
    } else {
      setPinError('รหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง');
    }
  };

  const isUserLoggedIn = isAdmin || loggedInPhone !== null;

  // Find logged-in patient object
  const loggedInPatient = useMemo(() => {
    if (!loggedInPhone) return null;
    const cleanPhone = loggedInPhone.replace(/\D/g, '');
    return patients.find(p => {
      const cleanContact = (p.contact || '').replace(/\D/g, '');
      return cleanContact === cleanPhone;
    }) || null;
  }, [patients, loggedInPhone]);

  // Handle Phone login submission
  const handlePhoneLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneLoginInput || phoneLoginInput.trim() === '') {
      setPhoneLoginError('กรุณากรอกเบอร์โทรศัพท์ที่ลงทะเบียนไว้');
      return;
    }

    const cleanInput = phoneLoginInput.replace(/\D/g, '');
    if (cleanInput.length < 8) {
      setPhoneLoginError('กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้องและครบถ้วน');
      return;
    }

    const found = patients.find(p => {
      const cleanContact = (p.contact || '').replace(/\D/g, '');
      return cleanContact === cleanInput || (cleanContact && cleanContact.endsWith(cleanInput) && cleanInput.length >= 9);
    });

    if (found) {
      setLoggedInPhone(found.contact);
      setPhoneLoginError('');
      setPhoneLoginInput('');
    } else {
      setPhoneLoginError('❌ ไม่พบเบอร์โทรศัพท์นี้ในระบบฐานข้อมูลผู้ป่วยกลุ่มเปราะบาง มีเพียงเบอร์ที่ลงทะเบียนไว้เท่านั้นที่สามารถเข้าใช้ได้');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-['Anuphan']">
      <header className="bg-slate-900 text-white shadow-xl sticky top-0 z-50 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2.5 rounded-2xl shadow-lg shadow-blue-600/30">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M6 3l7 7l-2 2l8 8" />
                <path d="m18 21l-7-7l2-2l-8-8" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-black tracking-tight">การไฟฟ้าส่วนภูมิภาคจังหวัดระยอง</h1>
                {/* Real-time synchronization state badge */}
                <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold flex items-center gap-1 transition-all
                  ${wsStatus === 'connected' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-400/20' : 
                    wsStatus === 'connecting' ? 'bg-amber-500/15 text-amber-400 border border-amber-400/20 animate-pulse' : 
                    'bg-rose-500/15 text-rose-400 border border-rose-400/20'}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${wsStatus === 'connected' ? 'bg-emerald-400 animate-ping' : wsStatus === 'connecting' ? 'bg-amber-400' : 'bg-rose-500'}`} />
                  {wsStatus === 'connected' ? 'ระบบเครือข่ายสิทธิ์พร้อมซิงค์เรียลไทม์' : wsStatus === 'connecting' ? 'กำลังเชื่อมต่อ...' : 'ออฟไลน์'}
                </span>
                
                {loggedInPhone && (
                  <span className="bg-blue-500/15 text-blue-400 border border-blue-400/20 text-[9px] px-2.5 py-0.5 rounded-full font-black uppercase tracking-wider animate-scale-up">
                    👤 เข้าสู่ระบบแล้ว (ผู้ป่วย)
                  </span>
                )}
                {isAdmin && (
                  <span className="bg-rose-500/15 text-rose-400 border border-rose-400/20 text-[9px] px-2.5 py-0.5 rounded-full font-black uppercase tracking-wider animate-scale-up">
                    🛠️ แอดมิน (Admin)
                  </span>
                )}
              </div>
              <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest mt-0.5">ระบบเฝ้าระวังภัยพิบัติและไฟฟ้าดับผู้ป่วยกลุ่มเปราะบาง (ระบบซิงค์เจ้าหน้าที่และผู้ป่วยสด)</p>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center justify-center md:justify-end gap-3 w-full md:w-auto">
            {isUserLoggedIn && (
              <>
                {/* Audio Alarm Sound Toggle & Tester */}
                <div className="flex bg-slate-800 rounded-xl p-0.5 border border-slate-700">
                  <button 
                    onClick={() => {
                      const targetMute = !isAlertMuted;
                      setIsAlertMuted(targetMute);
                      if (!targetMute) {
                        playOutageAlarm();
                      }
                    }}
                    className={`p-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all
                      ${!isAlertMuted 
                        ? 'bg-blue-600/30 text-blue-400 font-bold' 
                        : 'text-slate-500 hover:text-slate-300'}`}
                    title={isAlertMuted ? "เปิดเสียงเตือนไฟดับ" : "ปิดเสียงแจ้งเตือน"}
                  >
                    {!isAlertMuted ? (
                      <Volume2 size={14} className="animate-pulse text-blue-400" />
                    ) : (
                      <VolumeX size={14} className="text-slate-500" />
                    )}
                    <span className="text-[10px] font-bold">{isAlertMuted ? 'ปิดเสียงเตือน' : 'เปิดเสียงไซเรน'}</span>
                  </button>
                  <button 
                    onClick={playOutageAlarm}
                    className="px-2.5 py-1 text-slate-400 hover:text-white transition-colors text-[9px] font-bold border-l border-slate-700 flex items-center gap-1"
                    title="ทดสอบไซเรนเตือนภัย"
                  >
                    <Bell size={10} className="text-amber-400" />
                    ทดสอบเสียงแจ้งเตือน
                  </button>
                </div>

                {/* Simulation Controller Switch (Only core admin can simulate) */}
                {isAdmin && (
                  <button 
                    onClick={toggleSimulationSync}
                    className={`px-3 py-2 rounded-xl text-[11px] font-bold transition-all border flex items-center gap-1.5
                      ${isSimulationEnabled 
                        ? 'bg-indigo-600/20 text-indigo-400 border-indigo-500/30' 
                        : 'bg-slate-800 text-slate-500 border-slate-700'}`}
                    title="สลับโหมดจำลองสถานะภัยไฟฟ้าขัดข้องโดยระบบ"
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${isSimulationEnabled ? 'bg-indigo-400 animate-pulse' : 'bg-slate-600'}`} />
                    จำเลียนไฟขัดข้อง: {isSimulationEnabled ? 'เปิดใช้งาน' : 'ปิด'}
                  </button>
                )}

                {/* Quick Metrics */}
                <div className="flex gap-2">
                  <div className="bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-700 flex flex-col items-center">
                    <span className="text-[8px] text-slate-500 font-bold uppercase tracking-wider">วิกฤต (CRITICAL)</span>
                    <span className="text-sm font-black text-rose-500 leading-none mt-1">{totalCritical}</span>
                  </div>
                  <div className="bg-slate-850 px-3 py-1.5 rounded-xl border border-slate-705 flex flex-col items-center">
                    <span className="text-[8px] text-slate-550 font-bold uppercase tracking-wider">ไฟดับขัดข้อง</span>
                    <span className="text-sm font-black text-amber-500 leading-none mt-1">{currentOutages}</span>
                  </div>
                </div>

                {/* Admin planning mode toggle */}
                {isAdmin && (
                  <button 
                    onClick={() => {
                      const newPlanningVal = !isPlanningMode;
                      setIsPlanningMode(newPlanningVal);
                      updatePlannedZoneSync({ isActive: newPlanningVal });
                    }}
                    className={`px-4 py-2 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 border-2
                      ${isPlanningMode 
                        ? 'bg-amber-400 border-amber-500 text-slate-900 shadow-md' 
                        : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-slate-600'}`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><path d="m16 12-4-4-4 4"/><path d="M12 16V8"/></svg>
                    {isPlanningMode ? 'ยกเลิกจัดเตรียมดับไฟ' : 'วางแผนดับไฟล่วงหน้า'}
                  </button>
                )}

                {/* Administration registration */}
                {isAdmin && (
                  <button 
                    onClick={() => setIsFormOpen(true)}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl font-bold text-xs transition-all shadow-lg flex items-center gap-1.5"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
                    ลงทะเบียนใหม่
                  </button>
                )}

                {/* Logout Button */}
                <button 
                  onClick={handleLogout}
                  className="bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-xl font-bold text-xs transition-all shadow-md flex items-center gap-1.5 border border-rose-700"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                  ออกจากระบบ
                </button>
              </>
            )}

            {!isUserLoggedIn && (
              <span className="text-slate-400 text-xs font-bold bg-slate-800 border border-slate-700 px-3 py-2 rounded-xl flex items-center gap-1.5 select-none">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-amber-500"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                กรุณาระบุสิทธิ์ในการเข้าใช้
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* CASE 1: LOGGED-OUT GUEST (Sees only Register/Verify Phone on Left sidebar) */}
        {!isUserLoggedIn && (
          <div className="lg:col-span-4 space-y-6 order-2 lg:order-1 animate-scale-up">
            <div className="bg-white p-8 rounded-[32px] shadow-xl border border-slate-200/60 space-y-6">
              <div className="text-center space-y-3">
                <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-3xl mx-auto flex items-center justify-center shadow-inner">
                  <svg xmlns="http://www.w3.org/2054/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-blue-600">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                  </svg>
                </div>
                <div className="space-y-1">
                  <h3 className="text-xl font-black text-slate-900 leading-none">เข้าสู่ระบบผู้สิทธิ์ดูแล</h3>
                  <p className="text-[11px] text-slate-500 font-bold leading-relaxed">กรุณาระบุเบอร์โทรศัพท์มือถือที่ได้รับการลงทะเบียนจองเตียงผู้ป่วยเพื่อใช้บริการระยองมอนิเตอร์ไฟตกดับ</p>
                </div>
              </div>

              <form onSubmit={handlePhoneLogin} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-mono">Mobile Phone Number</label>
                  <input 
                    type="tel"
                    required
                    maxLength={12}
                    placeholder="เช่น 0812345678"
                    className="w-full text-center text-lg font-black px-4 py-3.5 rounded-2xl bg-slate-50 border-2 border-slate-100 focus:border-blue-500 hover:border-slate-200 outline-none transition-all placeholder:text-slate-300"
                    value={phoneLoginInput}
                    onChange={e => {
                      setPhoneLoginInput(e.target.value);
                      setPhoneLoginError('');
                    }}
                  />
                </div>

                {phoneLoginError && (
                  <p className="text-[11px] text-rose-500 font-bold text-center bg-rose-50 p-2.5 rounded-xl border border-rose-100">{phoneLoginError}</p>
                )}

                <button 
                  type="submit"
                  className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-extrabold rounded-2xl text-[12px] transition-all shadow-lg"
                >
                  ยืนยันตัวตนตรวจสอบพิกัด
                </button>
              </form>

              <div className="relative flex py-2 items-center">
                <div className="flex-grow border-t border-slate-100"></div>
                <span className="flex-shrink mx-4 text-[9px] text-slate-400 font-black uppercase tracking-wider font-mono">OR STAFF PORTAL</span>
                <div className="flex-grow border-t border-slate-100"></div>
              </div>

              <button 
                onClick={() => setIsPinModalOpen(true)}
                className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-slate-100 text-[11px] font-black rounded-xl transition-all shadow-md flex items-center justify-center gap-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                ลงชื่อเข้าใช้ด้วยบัญชีแอดมิน (Admin)
              </button>
            </div>
          </div>
        )}

        {/* CASE 2: LOGGED-IN PATIENT/RELATIVE (เห็นข้อมูลของตนเองเท่านั้นบน Left sidebar) */}
        {isUserLoggedIn && loggedInPhone && loggedInPatient && (
          <div className="lg:col-span-4 space-y-6 order-2 lg:order-1 animate-scale-up">
            <div className="bg-white p-6 rounded-[28px] shadow-sm border border-slate-200">
              <div className="flex justify-between items-center mb-5">
                <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-blue-600">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                  </svg>
                  โปรไฟล์สุขภาพของท่าน
                </h2>
              </div>

              <div className="space-y-4">
                <PatientCard 
                  patient={loggedInPatient} 
                  onUpdateStatus={handleUpdateStatus} 
                  onEdit={(selectedPat) => {
                    setEditingPatient(selectedPat);
                  }}
                  isAdmin={false}
                  isEditable={true}
                />

                <div className="bg-blue-50/50 rounded-2xl p-4 border border-blue-100 text-xs text-blue-800 space-y-1.5 font-medium leading-relaxed">
                  <h4 className="font-extrabold text-blue-900">💡 คำแนะนำจากการไฟฟ้าระยอง</h4>
                  <p>ท่านสามารถรายงานขอปรับปรุงข้อมูลที่อยู่ อัปเดตรองรับเครื่องผลิตออกซิเจน หรือรายละเอียดเวชภัณฑ์ของตนเองร่วมกับการไฟฟ้าได้ตลอดเวลา</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* CASE 3: LOGGED-IN ADMIN HEADER BANNER (ส่วนหลักแสดงสิทธิ์การปรับแต่งระบบส่วนกลาง) */}
        {isUserLoggedIn && isAdmin && (
          <div className="lg:col-span-12 space-y-4">
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-[28px] shadow-2xl animate-scale-up">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                  <h3 className="text-base font-black text-white leading-none flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
                    บัญชีเจ้าหน้าที่ผู้ดูแลระบบ (Admin Mode Active)
                  </h3>
                  <p className="text-slate-400 text-xs mt-2 font-medium">สิทธิ์การควบคุมระดับสูง: แสดงผู้ป่วยทุกคน ค้นหารายจังหวัด แก้ไขข้อมูลพิกัดความปลอดภัย และลบรายการวิกฤตด่วน</p>
                </div>
                
                <div className="flex gap-2">
                  <button 
                    onClick={() => setIsFormOpen(true)}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-3 rounded-2xl text-xs font-black transition-all shadow-lg flex items-center gap-1.5"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
                    ลงทะเบียนผู้ป่วยใหม่
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* CASE 3-SIDEBAR: ADMIN SIDEBAR FOR VIEWING ALL PATIENT LISTS */}
        {isUserLoggedIn && isAdmin && (
          <div className="lg:col-span-4 space-y-6 order-2 lg:order-1 animate-scale-up">
            <div className="bg-white p-6 rounded-[28px] shadow-sm border border-slate-200">
              <div className="flex justify-between items-center mb-5">
                <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-rose-600">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                  {isPlanningMode ? 'ผู้ได้รับผลกระทบดับไฟ' : 'รายชื่อผู้ป่วยเปราะบางทั้งหมด'}
                </h2>
                <span className="text-[10px] bg-rose-550 text-rose-600 bg-rose-50 font-bold px-2 py-0.5 rounded-full">
                  {isPlanningMode ? affectedByPlanning.length : patients.length} รายการ
                </span>
              </div>

              {/* Quick Admin Search & Info */}
              <div className="mb-4 text-xs font-bold bg-slate-50 border border-slate-100 rounded-xl p-3 flex justify-between items-center text-slate-600">
                <span className="flex items-center gap-1.5">
                  🛡️ ขอบเขตการทำงาน:
                  <span className="bg-rose-100 text-rose-700 font-extrabold px-1.5 py-0.5 rounded text-[9px] animate-pulse">
                    เห็นผู้ป่วยทุกราย
                  </span>
                </span>
              </div>

              <div className="space-y-4 max-h-[620px] overflow-y-auto pr-2 custom-scrollbar">
                {(isPlanningMode ? affectedByPlanning : patients).length === 0 ? (
                  <div className="text-center py-12 text-slate-400 font-bold bg-slate-50 rounded-2xl border border-slate-100 italic text-sm">
                    ไม่พบข้อมูลผู้ป่วยที่ตอบเกณฑ์เงื่อนไข
                  </div>
                ) : (
                  (isPlanningMode ? affectedByPlanning : patients).map(p => (
                    <PatientCard 
                      key={p.id} 
                      patient={p} 
                      onUpdateStatus={handleUpdateStatus} 
                      onEdit={(selectedPat) => {
                        setEditingPatient(selectedPat);
                      }}
                      onDelete={handleDeletePatient}
                      isAdmin={true}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Main interactive maps and tools */}
        <div className="lg:col-span-8 space-y-6 order-1 lg:order-2">
          
          {/* Synchronized Outage Planner Interface (Only available in Planning Mode for Admin) */}
          {isPlanningMode && isAdmin && (
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-[28px] shadow-2xl animate-in slide-in-from-top duration-300">
              <div className="flex flex-col gap-6">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-lg font-bold text-white leading-none flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
                      ศูนย์บริหารแผนงานดับไฟชั่วคราว (Shared)
                    </h3>
                    <p className="text-slate-400 text-xs mt-2 uppercase font-bold tracking-wider">ระบุจัดเตรียมแผนงานตัดไฟล่วงหน้า และพ่นรัศมีคำนวณผู้รับผลร่วมกัน</p>
                  </div>
                  <div className="bg-amber-500/10 border border-amber-500/20 px-3 py-1 rounded-full">
                    <span className="text-amber-500 font-bold text-[10px] tracking-widest uppercase">Planning Synchronized</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-3">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">พิกัดดับไฟ (คลิกลงแผนที่ ได้)</span>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[9px] text-slate-500 font-bold uppercase">Latitude</label>
                        <input 
                          type="number" 
                          step="0.0001" 
                          className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white font-bold text-xs outline-none focus:border-amber-400 transition-colors" 
                          value={plannedZone.center.lat} 
                          onChange={(e) => updatePlannedZoneSync({ center: { ...plannedZone.center, lat: parseFloat(e.target.value) || 12.68 } })} 
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] text-slate-500 font-bold uppercase">Longitude</label>
                        <input 
                          type="number" 
                          step="0.0001" 
                          className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white font-bold text-xs outline-none focus:border-amber-400 transition-colors" 
                          value={plannedZone.center.lng} 
                          onChange={(e) => updatePlannedZoneSync({ center: { ...plannedZone.center, lng: parseFloat(e.target.value) || 101.28 } })} 
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between items-end">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">รัศมีการวางแผน</span>
                      <span className="text-amber-400 font-bold text-[13px]">{plannedZone.radiusKm.toFixed(1)} กม.</span>
                    </div>
                    <input 
                      type="range" 
                      min="0.2" 
                      max="8.0" 
                      step="0.1" 
                      className="w-full accent-amber-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg appearance-none mt-2" 
                      value={plannedZone.radiusKm} 
                      onChange={(e) => updatePlannedZoneSync({ radiusKm: parseFloat(e.target.value) || 1.5 })} 
                    />
                  </div>

                  <div className="bg-slate-800/40 rounded-2xl p-4 border border-slate-800 flex flex-col justify-center gap-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-slate-400">พิกัดสะท้อนผลดับไฟ:</span>
                      <span className="font-black text-white">{affectedByPlanning.length} คน</span>
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-rose-500">กลุ่มวิกฤต (Critical):</span>
                      <span className="font-black text-rose-500">{affectedByPlanning.filter(p => p.priority === Priority.CRITICAL).length} คน</span>
                    </div>
                  </div>
                </div>

                <div className="flex gap-4 pt-4 border-t border-slate-800 text-xs">
                  <button 
                    onClick={() => {
                      alert(`📣 ส่งการแจ้งเตือนประสานงานด่วน ไปยังผู้ป่วยติดบ้านติดเตียงและญาติทั้ง (${affectedByPlanning.length} ราย) เรียบร้อยแล้ว ผ่านเครือข่ายสัญญาณเตือนภัยการไฟฟ้าส่วนภูมิภาค`);
                    }}
                    className={`flex-1 font-bold py-3.5 rounded-2xl transition-all shadow-lg text-xs
                      ${affectedByPlanning.length === 0 
                        ? 'bg-slate-800 text-slate-500 cursor-not-allowed' 
                        : 'bg-amber-400 hover:bg-amber-500 text-slate-900'}`}
                    disabled={affectedByPlanning.length === 0}
                  >
                    ส่งข้อความ SMS & ไฟฉุกเฉินเตือนภัยล่วงหน้า ({affectedByPlanning.length} ราย)
                  </button>
                  <button 
                    onClick={() => {
                      setIsPlanningMode(false);
                      updatePlannedZoneSync({ isActive: false });
                    }} 
                    className="px-6 bg-slate-800 hover:bg-slate-700 text-slate-400 font-bold py-3.5 rounded-2xl transition-all"
                  >
                    ปิดการวางแผน
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Interactive Google maps engine */}
          <PatientMap 
            patients={patients} 
            onSelectPatient={(p) => {
              if (!isUserLoggedIn) {
                alert(`📌 ผู้ป่วย: ${p.name}\nกรุณาระบุความประสงค์เข้าสู่ระบบพอร์ทัลส่วนตัวเพื่อเข้าตรวจเช็กสเตตัสกระแสไฟเวชภัณฑ์ด่วน`);
              } else {
                setSelectedPatient(p);
              }
            }} 
            plannedZone={plannedZone}
            isPlanningMode={isPlanningMode && isAdmin}
            selectedPatient={selectedPatient}
            onMapClick={(lat, lng) => {
              if (!isUserLoggedIn) return;
              if (isPlanningMode && isAdmin) {
                updatePlannedZoneSync({ center: { lat, lng }, isActive: true });
              } else if (isFormOpen && isAdmin) {
                setNewPatient(prev => ({ ...prev, lat, lng }));
              } else if (editingPatient) {
                setEditingPatient(prev => prev ? { ...prev, coordinates: { lat, lng } } : null);
              }
            }}
          />
        </div>
      </main>

      {/* Admin passcode input MODAL */}
      {isPinModalOpen && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md flex items-center justify-center z-[110] p-4 animate-fade-in">
          <div className="bg-white rounded-[40px] shadow-2xl max-w-sm w-full p-8 border border-white/20">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-3xl mx-auto flex items-center justify-center shadow-inner">
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
              </div>
              <div className="space-y-1">
                <h3 className="text-2xl font-black text-slate-900">ปลดล็อกแอดมิน (Admin)</h3>
                <p className="text-xs text-slate-500 font-medium leading-relaxed">กรอกรหัสผ่านเพื่อยืนยันตัวตนระดับผู้ดูแลระบบสำหรับการจัดการข้อมูลและควบคุมพิกัดไฟดับ</p>
              </div>
            </div>

            <form onSubmit={handlePinSubmit} className="mt-6 space-y-4">
              <input 
                type="password"
                required
                maxLength={6}
                placeholder="ป้อนรหัสแอดมินคู่สัญญารักษา..."
                className="w-full text-center tracking-[0.4em] text-2xl font-black px-4 py-3 rounded-2xl bg-slate-50 border-2 border-slate-100 focus:border-blue-600 outline-none transition-colors"
                value={pinInput}
                onChange={e => {
                  setPinInput(e.target.value);
                  setPinError('');
                }}
                autoFocus
              />
              
              {pinError && (
                <p className="text-xs text-red-500 font-bold text-center animate-shake">{pinError}</p>
              )}

              <div className="flex gap-2">
                <button 
                  type="submit"
                  className="flex-1 py-4 bg-slate-900 hover:bg-slate-800 text-white font-black rounded-2xl text-xs transition-all shadow-lg"
                >
                  ยืนยันรหัส
                </button>
                <button 
                  type="button"
                  onClick={() => {
                    setIsPinModalOpen(false);
                    setPinInput('');
                    setPinError('');
                  }}
                  className="px-4 py-4 bg-slate-100 hover:bg-slate-200 text-slate-500 font-bold rounded-2xl text-xs transition-all"
                >
                  ยกเลิก
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Registration Form Modal */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md flex items-center justify-center z-[100] p-4">
           <div className="bg-white rounded-[40px] shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col border border-white/20 animate-scale-up">
              <div className="p-8 border-b border-slate-100 flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-black text-slate-900 leading-none">ลงทะเบียนผู้ป่วยกลุ่มเปราะบางรายใหม่</h2>
                  <p className="text-xs text-slate-400 font-medium mt-1.5">ป้อนข้อมูลจริงและให้ระบบประเมินฉุกเฉินผ่าน Gemini AI (แอดมิน)</p>
                </div>
                <button onClick={() => setIsFormOpen(false)} className="w-12 h-12 flex items-center justify-center rounded-2xl bg-slate-50 text-slate-400 hover:text-rose-500 transition-all shadow-inner">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
              </div>
              <form onSubmit={handleAddPatient} className="p-8 space-y-6 overflow-y-auto custom-scrollbar flex-1">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                       <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">ชื่อ-นามสกุล ผู้ป่วย</label>
                       <input required className="w-full px-5 py-3.5 rounded-2xl bg-slate-50 border border-slate-100 focus:border-blue-500 hover:border-slate-200 outline-none font-bold text-sm" value={newPatient.name} onChange={e => setNewPatient({...newPatient, name: e.target.value})} placeholder="ป้อนชื่อผู้ได้รับสิทธิ์..."/>
                    </div>
                    <div className="space-y-2">
                       <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">อายุ (ปี)</label>
                       <input type="number" required className="w-full px-5 py-3.5 rounded-2xl bg-slate-50 border border-slate-100 focus:border-blue-500 hover:border-slate-200 outline-none font-bold text-sm" value={newPatient.age} onChange={e => setNewPatient({...newPatient, age: e.target.value})} placeholder="ป้อนอายุกาย..."/>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                     <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">เบอร์ติดต่อประสานงาน (ญาติ/ผู้ดูแล)</label>
                     <input required className="w-full px-5 py-3.5 rounded-2xl bg-slate-50 border border-slate-100 focus:border-blue-500 hover:border-slate-200 outline-none font-bold text-sm" value={newPatient.contact} onChange={e => setNewPatient({...newPatient, contact: e.target.value})} placeholder="ระบุเบอร์ติดต่อ..."/>
                  </div>

                  <div className="space-y-2">
                     <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">ภาวะโรคประจำตัวเด่นชัด (AI ประมวลระดับจัดวิกฤตความสำคัญ)</label>
                     <textarea required className="w-full px-5 py-4 rounded-2xl bg-slate-50 border border-slate-100 focus:border-blue-500 hover:border-slate-200 outline-none font-medium text-sm h-20" value={newPatient.condition} onChange={e => setNewPatient({...newPatient, condition: e.target.value})} placeholder="ระบุเช่น: ผู้ป่วยอัมพาตครึ่งซีก ไม่สามารถทรงตัวได้ ต้องประคองใช้ออกซิเจนและเครื่องช่วยหายใจ..." />
                  </div>

                  <div className="space-y-3">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">ระบุอุปกรณ์ช่วยพยุงชีพ</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {EQUIPMENT_OPTIONS.map(item => (
                        <button key={item} type="button" onClick={() => toggleEquipment(item)}
                          className={`px-4 py-2.5 rounded-2xl border text-left text-xs font-bold transition-all
                            ${newPatient.equipment.includes(item) ? 'bg-blue-600 border-blue-600 text-white shadow-lg' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'}`}>
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">ที่อยู่พิกัดเคหะสถาน</label>
                    <input required className="w-full px-5 py-3.5 rounded-2xl bg-slate-50 border border-slate-100 focus:border-blue-500 hover:border-slate-200 outline-none font-bold text-sm" value={newPatient.address} onChange={e => setNewPatient({...newPatient, address: e.target.value})} placeholder="ระบุที่อยู่พิกัดจัดส่ง..."/>
                  </div>

                  <div className="bg-slate-50 p-5 rounded-3xl space-y-4 border border-slate-100">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-slate-500 uppercase tracking-widest block">ระบุตำแหน่งแผนที่ (ละติจูด/ลองจิจูด)</span>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[9px] text-slate-400 font-black uppercase">Latitude</label>
                        <input type="number" step="0.0001" className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold bg-white text-slate-800 outline-none" value={newPatient.lat} onChange={e => setNewPatient(prev => ({ ...prev, lat: parseFloat(e.target.value) || 12.68 }))} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] text-slate-400 font-black uppercase">Longitude</label>
                        <input type="number" step="0.0001" className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold bg-white text-slate-800 outline-none" value={newPatient.lng} onChange={e => setNewPatient(prev => ({ ...prev, lng: parseFloat(e.target.value) || 101.28 }))} />
                      </div>
                    </div>
                  </div>

                  <button type="submit" disabled={isAssessing} className="w-full py-5 rounded-[24px] bg-blue-600 text-white font-black text-lg hover:bg-blue-700 transition-all shadow-xl shadow-blue-600/20 flex items-center justify-center gap-2">
                    {isAssessing ? (
                      <>
                        <svg className="animate-spin text-white" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                        Gemini AI กำลังประเมินและจัดลำดับวิกฤตความสำคัญ...
                      </>
                    ) : 'ลงทะเบียนและประเมินระดับวิกฤตความเสี่ยง'}
                  </button>
              </form>
           </div>
        </div>
      )}

      {/* Edit Patient Modal */}
      {editingPatient && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md flex items-center justify-center z-[100] p-4">
           <div className="bg-white rounded-[40px] shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col border border-white/20 animate-scale-up">
              <div className="p-8 border-b border-slate-100 flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-black text-slate-900 leading-none">แก้ไขข้อมูลผู้ป่วยกลุ่มเปราะบาง (แอดมิน)</h2>
                  <p className="text-xs text-slate-400 font-medium mt-1.5">ปรับปรุงและตรวจสอบพิกัดความปลอดภัยแบบเวลาจริงร่วมกัน</p>
                </div>
                <button onClick={() => setEditingPatient(null)} className="w-12 h-12 flex items-center justify-center rounded-2xl bg-slate-50 text-slate-400 hover:text-rose-500 transition-all shadow-inner">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
              </div>
              <form onSubmit={handleSaveEditPatient} className="p-8 space-y-6 overflow-y-auto custom-scrollbar flex-1">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">ชื่อ-นามสกุล ของสิทธิ์</label>
                      <input required className="w-full px-5 py-3.5 rounded-2xl bg-slate-50 border border-slate-100 focus:border-blue-500 hover:border-slate-200 outline-none font-bold text-sm" value={editingPatient.name} onChange={e => setEditingPatient({...editingPatient, name: e.target.value})} placeholder="ป้อนชื่อจริง..."/>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">อายุกาย (ปี)</label>
                      <input type="number" required className="w-full px-5 py-3.5 rounded-2xl bg-slate-50 border border-slate-100 focus:border-blue-500 hover:border-slate-200 outline-none font-bold text-sm" value={editingPatient.age} onChange={e => setEditingPatient({...editingPatient, age: parseInt(e.target.value) || 0})} placeholder="ระบุอายุกาย..."/>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">เบอร์โทรศัพท์ติดต่อประสานงาน (ญาติ/ผู้ดูแล)</label>
                    <input required className="w-full px-5 py-3.5 rounded-2xl bg-slate-50 border border-slate-100 focus:border-blue-500 hover:border-slate-200 outline-none font-bold text-sm" value={editingPatient.contact} onChange={e => setEditingPatient({...editingPatient, contact: e.target.value})} placeholder="ระบุเบอร์ติดต่อ..."/>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">ภาวะความเจ็บไข้โรคติดตัว (AI ประมวลความเสี่ยงแบบใหม่)</label>
                    <textarea required className="w-full px-5 py-4 rounded-2xl bg-slate-50 border border-slate-100 focus:border-blue-500 hover:border-slate-200 outline-none font-medium text-sm h-20" value={editingPatient.condition} onChange={e => setEditingPatient({...editingPatient, condition: e.target.value})} placeholder="ระบุความจำกัดด้านการพยาบาล..."/>
                  </div>
                  
                  <div className="space-y-3">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">ระบุอุปกรณ์จัดเกณฑ์พยุงชีพ</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {EQUIPMENT_OPTIONS.map(item => (
                        <button key={item} type="button" onClick={() => toggleEditEquipment(item)}
                          className={`px-4 py-2.5 rounded-2xl border text-left text-xs font-bold transition-all
                            ${editingPatient.equipment.includes(item) ? 'bg-blue-600 border-blue-600 text-white shadow-lg' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'}`}>
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">ระดับวิกฤตความสำคัญ (แอดมินกำหนดเอง หรืออัปเดตตามคำแนะนำ AI)</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {Object.values(Priority).map(p => (
                        <button key={p} type="button" onClick={() => setEditingPatient({...editingPatient, priority: p})}
                          className={`px-3 py-2.5 rounded-2xl border text-center text-[11px] font-black transition-all
                            ${editingPatient.priority === p 
                              ? p === Priority.CRITICAL ? 'bg-rose-600 border-rose-600 text-white shadow-lg shadow-rose-600/20'
                                : p === Priority.HIGH ? 'bg-orange-500 border-orange-500 text-white shadow-lg shadow-orange-500/20'
                                : p === Priority.MEDIUM ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-600/20'
                                : 'bg-slate-700 border-slate-700 text-white shadow-lg shadow-slate-700/20'
                              : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'}`}>
                          {p === Priority.CRITICAL ? '🚨 วิกฤตสูงสุด' 
                           : p === Priority.HIGH ? '🟠 สูง' 
                           : p === Priority.MEDIUM ? '🔵 ปานกลาง' 
                           : '🟢 ต่ำ'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">ที่อยู่อภินิหารปณิธานพิกัด</label>
                    <input required className="w-full px-5 py-3.5 rounded-2xl bg-slate-50 border border-slate-100 focus:border-blue-500 hover:border-slate-200 outline-none font-bold text-sm" value={editingPatient.address} onChange={e => setEditingPatient({...editingPatient, address: e.target.value})} placeholder="ระบุที่อยู่จัดส่งไฟสำรอง..."/>
                  </div>

                  <div className="bg-slate-50 p-5 rounded-3xl space-y-4 border border-slate-100">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-bold text-slate-500 uppercase tracking-widest block">พิกัดเคหะสถาน (คลิกปักหมุดบนแผนที่ได้)</span>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[9px] text-slate-400 font-black uppercase">Latitude</label>
                        <input type="number" step="0.0001" className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold bg-white text-slate-800 outline-none" value={editingPatient.coordinates.lat} onChange={e => setEditingPatient({...editingPatient, coordinates: { ...editingPatient.coordinates, lat: parseFloat(e.target.value) || 12.68 }})} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] text-slate-400 font-black uppercase">Longitude</label>
                        <input type="number" step="0.0001" className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-bold bg-white text-slate-800 outline-none" value={editingPatient.coordinates.lng} onChange={e => setEditingPatient({...editingPatient, coordinates: { ...editingPatient.coordinates, lng: parseFloat(e.target.value) || 101.28 }})} />
                      </div>
                    </div>
                  </div>
                  
                  <button type="submit" disabled={isAssessing} className="w-full py-5 rounded-[24px] bg-blue-600 text-white font-black text-lg hover:bg-blue-700 transition-all shadow-xl shadow-blue-600/20 flex items-center justify-center gap-2">
                    {isAssessing ? (
                      <>
                        <svg className="animate-spin text-white" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                        Gemini AI กำลังคำนวณสัดส่วนคะแนนเสียงวิกฤตใหม่...
                      </>
                    ) : 'บันทึกการแก้ไขและวิเคราะห์ความฉับพลันร่วมกัน'}
                  </button>
              </form>
           </div>
        </div>
      )}

      {/* Real-time Outage Warning Pop-ups Stack */}
      {alerts.length > 0 && (
        <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 max-w-sm w-[calc(100%-32px)] md:w-96 select-none animate-in slide-in-from-bottom duration-300">
          <div className="flex justify-between items-center bg-slate-900/95 text-white px-4 py-2.5 rounded-t-2xl border-t border-x border-slate-800 shadow-lg backdrop-blur-sm">
            <span className="text-[11px] font-black uppercase tracking-wider flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
              การแจ้งเตือนไฟดับ ({alerts.length})
            </span>
            <button 
              onClick={() => setAlerts([])}
              className="text-[10px] text-slate-400 hover:text-rose-400 transition-colors uppercase font-bold"
            >
              เคลียร์ทั้งหมด
            </button>
          </div>
          <div className="max-h-[380px] overflow-y-auto space-y-3.5 pr-1 custom-scrollbar">
            {alerts.map((alert) => {
              const p = alert.patient;
              const isCritical = p.priority === Priority.CRITICAL;
              const isHigh = p.priority === Priority.HIGH;
              return (
                <div 
                  key={alert.id} 
                  className={`bg-white/95 rounded-2xl border-2 shadow-2xl p-4 flex flex-col gap-3 shrink-0 relative overflow-hidden backdrop-blur-md transition-all duration-300 hover:scale-[1.01] hover:shadow-2xl
                    ${isCritical ? 'border-rose-500 shadow-rose-300/10' : isHigh ? 'border-orange-500 shadow-orange-300/10' : 'border-blue-500 shadow-blue-300/10'}`}
                >
                  {/* Left priority color stripe */}
                  <div className={`absolute top-0 left-0 w-1.5 h-full ${isCritical ? 'bg-rose-500 animate-pulse' : isHigh ? 'bg-orange-500' : 'bg-blue-500'}`} />

                  <div className="flex justify-between items-start pl-2">
                    <div className="space-y-1">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-black uppercase tracking-wider
                        ${isCritical ? 'bg-rose-50/90 text-rose-700 border border-rose-200' : 
                          isHigh ? 'bg-orange-50/90 text-orange-700 border border-orange-200' : 
                          'bg-blue-50/90 text-blue-700 border border-blue-200'}`}
                      >
                        {p.priority === Priority.CRITICAL ? '🚨 วิกฤตประคองชีพ' : p.priority === Priority.HIGH ? '⚠️ อุปกรณ์สำคัญสูง' : '🔵 ปานกลาง'}
                      </span>
                      <h4 className="text-sm font-black text-slate-900 mt-1">{p.name}</h4>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono font-bold bg-slate-100 px-2 py-0.5 rounded-lg">
                      {alert.timestamp} น.
                    </span>
                  </div>

                  <div className="space-y-1 text-xs text-slate-600 pl-2">
                    <p>
                      <strong className="text-slate-800 font-bold">โรคประจำตัว:</strong> {p.condition}
                    </p>
                    <div className="flex flex-wrap gap-1 leading-none py-1">
                      <strong className="text-slate-800 font-bold mr-1 self-center">อุปกรณ์:</strong>
                      {p.equipment.map((item, idx) => (
                        <span key={idx} className="bg-slate-100 text-slate-700 text-[10px] px-2 py-0.5 rounded-lg font-bold border border-slate-200">
                          {item}
                        </span>
                      ))}
                    </div>
                    <div className="text-[11px] bg-red-50 text-rose-800 font-bold px-2.5 py-2 rounded-xl border border-rose-150 flex items-center gap-1.5 mt-1.5">
                      <AlertTriangle size={14} className="text-rose-600 shrink-0" />
                      <span>สถานะ: กระแสไฟฟ้าขัดข้อง! (ไฟดับ)</span>
                    </div>
                  </div>

                  <div className="flex gap-2 mt-1 pl-2">
                    <button 
                      onClick={() => {
                        setSelectedPatient(p);
                      }}
                      className="flex-1 bg-slate-900 hover:bg-slate-800 text-white font-bold py-2 px-3 rounded-xl text-[10px] transition-all flex items-center justify-center gap-1 shadow-sm"
                    >
                      <Crosshair size={12} className="text-blue-400" />
                      ปักหมุดแผนที่
                    </button>
                    <button 
                      onClick={() => setAlerts(prev => prev.filter(a => a.id !== alert.id))}
                      className="border border-slate-200 hover:bg-slate-100 text-slate-500 hover:text-slate-700 font-bold py-2 px-3 rounded-xl text-[10px] transition-all"
                    >
                      ปิดการแจ้งเตือน
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Visual & Sound emergency interactive MODAL POP-UP */}
      {activeOutageModal && (
        <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-xl flex items-center justify-center z-[99999] p-4 select-none animate-fade-in">
          <div className="bg-white rounded-[40px] shadow-2xl max-w-lg w-full overflow-hidden border-4 border-rose-500 animate-scale-up relative">
            
            {/* Top pulsing red neon alert bar */}
            <div className="bg-rose-600 text-white p-5 text-center flex flex-col items-center justify-center gap-1.5 anim-pulse relative overflow-hidden">
              <div className="absolute inset-0 bg-red-500 opacity-30 animate-ping rounded-full scale-110" />
              <AlertTriangle className="animate-bounce text-white relative z-10 shrink-0" size={32} />
              <h2 className="text-xl font-extrabold tracking-wide relative z-10">🚨 แจ้งเตือนฉุกเฉิน: ตรวจพบกระแสไฟฟ้าขัดข้อง!</h2>
              <p className="text-xs text-rose-100 font-bold tracking-widest relative z-10">ระบบจะทำการแชร์ข้อมูลพิกัดและความพร้อมทางการแพทย์ไปยังเครือข่ายทันที</p>
            </div>

            <div className="p-8 space-y-6">
              {/* Patient mini bio */}
              <div className="bg-slate-50 p-6 rounded-3xl border border-slate-150 space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-[10px] bg-rose-100 text-rose-700 px-3 py-1 rounded-full font-black uppercase tracking-wider">
                      {activeOutageModal.priority === Priority.CRITICAL ? '🚨 ผู้ป่วยกลุ่มวิกฤตความปลอดภัยสูงสุด' : '⚠️ กลุ่มอุปกรณ์สำคัญจำเป็น'}
                    </span>
                    <h3 className="text-2xl font-black text-slate-900 mt-2">{activeOutageModal.name}</h3>
                  </div>
                  <span className="text-sm font-bold text-slate-500 bg-white px-3 py-1 rounded-xl shadow-sm border border-slate-100">
                    อายุ {activeOutageModal.age} ปี
                  </span>
                </div>

                <div className="space-y-4 text-xs text-slate-600 leading-relaxed">
                  <div>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-1">อาการ / ข้อจำกัดทางการพยาบาล</span>
                    <div className="bg-white p-3 rounded-xl border border-slate-200 text-slate-800 font-medium">
                      {activeOutageModal.condition}
                    </div>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-1">อุปกรณ์ประดัดช่วยชีวิต</span>
                    <div className="flex flex-wrap gap-1">
                      {activeOutageModal.equipment.map((item, idx) => (
                        <span key={idx} className="bg-slate-100/80 text-slate-700 text-[10px] px-2.5 py-1 rounded-xl font-bold border border-slate-200">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block mb-1">ที่อยู่อาศัยและการเดินทาง</span>
                    <div className="bg-white p-3 rounded-xl border border-slate-200 text-slate-800 font-medium">
                      {activeOutageModal.address}
                    </div>
                  </div>
                </div>
              </div>

              {/* Action controls */}
              <div className="space-y-3">
                <button 
                  onClick={() => {
                    playOutageAlarm();
                  }}
                  className="w-full py-4 rounded-2xl bg-amber-600 hover:bg-amber-700 text-white font-black transition-all shadow-lg flex items-center justify-center gap-2 text-xs"
                >
                  <Volume2 size={16} className="animate-pulse" />
                  🔊 กดคลิกเพื่อขับเคลื่อนระบบจำลองเสียงไซเรนฉุกเฉินอีกระลอก
                </button>

                <div className="flex gap-3">
                  <button 
                    onClick={() => {
                      setSelectedPatient(activeOutageModal);
                      setActiveOutageModal(null);
                    }}
                    className="flex-1 py-4 bg-slate-900 hover:bg-slate-800 text-white font-black rounded-2xl text-xs transition-all shadow-lg text-center"
                  >
                    🔍 ปักหมุดพิกัดแผนที่ทันที
                  </button>
                  <button 
                    onClick={() => {
                      setActiveOutageModal(null);
                    }}
                    className="px-6 py-4 bg-slate-100 hover:bg-slate-200 text-slate-500 font-black rounded-2xl text-xs transition-all"
                  >
                    รับทราบและปิดหน้าต่างนี้
                  </button>
                </div>
              </div>
            </div>
            
          </div>
        </div>
      )}

      {/* Custom delete confirmation modal to bypass window.confirm iframe restriction */}
      {patientToDelete && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md flex items-center justify-center z-[110] p-4 animate-fade-in">
          <div className="bg-white rounded-[40px] shadow-2xl max-w-sm w-full p-8 border border-white/20 text-center space-y-6 animate-scale-up">
            <div className="w-16 h-16 bg-rose-50 text-rose-600 rounded-3xl mx-auto flex items-center justify-center shadow-inner animate-pulse">
              <AlertTriangle size={28} />
            </div>
            
            <div className="space-y-2">
              <h3 className="text-xl font-black text-slate-900">ยืนยันการลบข้อมูล?</h3>
              <p className="text-xs text-slate-500 font-medium leading-relaxed">
                คุณแน่ใจหรือไม่ว่าต้องการลบข้อมูลของ <span className="font-extrabold text-rose-600 text-sm">“{patientToDelete.name}”</span> ออกจากฐานข้อมูลการดูแลผู้ป่วยกลุ่มเปราะบางส่วนกลาง?
              </p>
              <p className="text-[10px] text-rose-500 font-bold bg-rose-50 p-2 rounded-xl border border-rose-100">
                🚨 เมื่อลบแล้วข้อมูลจะหายไปจากระบบแบบเรียลไทม์ทันทีทุกเซสชัน
              </p>
            </div>

            <div className="flex flex-col gap-2 pt-2">
              <button 
                onClick={handleConfirmDelete}
                className="w-full py-4 bg-rose-600 hover:bg-rose-700 text-white font-extrabold rounded-2xl text-xs transition-all shadow-lg shadow-rose-600/20"
              >
                ยืนยันการลบข้อมูลถาวร
              </button>
              <button 
                type="button"
                onClick={() => setPatientToDelete(null)}
                className="w-full py-4 bg-slate-100 hover:bg-slate-200 text-slate-500 font-bold rounded-2xl text-xs transition-all"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="bg-white border-t border-slate-200 py-10 text-center mt-auto md:px-0 px-4">
        <p className="text-slate-400 text-[10px] font-black uppercase tracking-[0.3em]">
          PEA RAYONG LIFECARE MONITORING SYSTEM v3.0 // Powered by Collaborative WebSocket Server & Gemini AI
        </p>
      </footer>
    </div>
  );
};

export default App;
