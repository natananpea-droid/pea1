
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Patient, Priority, PowerStatus, PlannedOutageZone } from './types';
import { MOCK_PATIENTS, EQUIPMENT_OPTIONS } from './constants';
import PatientMap from './components/PatientMap';
import PatientCard from './components/PatientCard';
import { assessPatientPriority } from './services/geminiService';

const App: React.FC = () => {
  const [patients, setPatients] = useState<Patient[]>(MOCK_PATIENTS as Patient[]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isAssessing, setIsAssessing] = useState(false);
  const [isSimulationEnabled, setIsSimulationEnabled] = useState(true);
  
  // Planning Mode States - Set default center to Rayong City
  const [isPlanningMode, setIsPlanningMode] = useState(false);
  const [plannedZone, setPlannedZone] = useState<PlannedOutageZone>({
    center: { lat: 12.6814, lng: 101.2813 },
    radiusKm: 1.5,
    isActive: false
  });

  // Form State
  const [newPatient, setNewPatient] = useState({
    name: '',
    age: '',
    condition: '',
    equipment: [] as string[],
    address: '',
    contact: '',
    lat: 12.68,
    lng: 101.28
  });

  // Outage Simulation Logic
  useEffect(() => {
    if (!isSimulationEnabled) return;
    const interval = setInterval(() => {
      setPatients(prev => {
        if (Math.random() > 0.1) return prev;
        const normalPatients = prev.filter(p => p.status === PowerStatus.NORMAL);
        if (normalPatients.length === 0) return prev;
        const randomIndex = Math.floor(Math.random() * normalPatients.length);
        const targetId = normalPatients[randomIndex].id;
        const durationMinutes = Math.floor(Math.random() * 20) + 10;
        const restorationTime = new Date();
        restorationTime.setMinutes(restorationTime.getMinutes() + durationMinutes);
        return prev.map(p => p.id === targetId ? { 
          ...p, status: PowerStatus.OUTAGE, outageStartTime: new Date().toISOString(),
          estimatedRestorationTime: restorationTime.toISOString(), lastUpdated: new Date().toISOString() 
        } : p);
      });
    }, 20000);
    return () => clearInterval(interval);
  }, [isSimulationEnabled]);

  const handleUpdateStatus = (id: string, status: PowerStatus) => {
    setPatients(prev => prev.map(p => 
      p.id === id ? { 
        ...p, 
        status, 
        lastUpdated: new Date().toISOString(),
        estimatedRestorationTime: status === PowerStatus.OUTAGE ? new Date(Date.now() + 3600000).toISOString() : undefined
      } : p
    ));
  };

  const handleDeletePatient = (id: string) => {
    if (window.confirm('คุณแน่ใจหรือไม่ว่าต้องการลบข้อมูลผู้ป่วยรายนี้ออกจากระบบ?')) {
      setPatients(prev => prev.filter(p => p.id !== id));
      if (selectedPatient?.id === id) setSelectedPatient(null);
    }
  };

  const handleAddPatient = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAssessing(true);
    const assessment = await assessPatientPriority(newPatient.condition, newPatient.equipment);
    const patient: Patient = {
      id: Math.random().toString(36).substr(2, 9),
      name: newPatient.name,
      age: parseInt(newPatient.age) || 0,
      condition: newPatient.condition,
      equipment: newPatient.equipment,
      address: newPatient.address,
      contact: newPatient.contact,
      coordinates: { lat: newPatient.lat, lng: newPatient.lng },
      priority: assessment.priority as Priority,
      status: PowerStatus.NORMAL,
      lastUpdated: new Date().toISOString()
    };
    setPatients(prev => [patient, ...prev]);
    setIsFormOpen(false);
    setIsAssessing(false);
    setNewPatient({ name: '', age: '', condition: '', equipment: [], address: '', contact: '', lat: 12.68, lng: 101.28 });
  };

  const toggleEquipment = (item: string) => {
    setNewPatient(prev => ({
      ...prev,
      equipment: prev.equipment.includes(item) ? prev.equipment.filter(e => e !== item) : [...prev.equipment, item]
    }));
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

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-['Anuphan']">
      <header className="bg-slate-900 text-white shadow-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2.5 rounded-2xl">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m6 3 7 7l-2 2l8 8"/><path d="m18 21l-7-7l2-2l-8-8"/></svg>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">การไฟฟ้าส่วนภูมิภาคจังหวัดระยอง</h1>
              <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest">ระบบเฝ้าระวังผู้ป่วยกลุ่มเปราะบางทางการไฟฟ้า</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden md:flex gap-2">
              <div className="bg-slate-800 px-3 py-1 rounded-xl border border-slate-700 flex flex-col items-center">
                <span className="text-[9px] text-slate-500 font-bold">วิกฤต</span>
                <span className="text-lg font-black text-red-500 leading-none">{totalCritical}</span>
              </div>
              <div className="bg-slate-800 px-3 py-1 rounded-xl border border-slate-700 flex flex-col items-center">
                <span className="text-[9px] text-slate-500 font-bold">ไฟดับขณะนี้</span>
                <span className="text-lg font-black text-yellow-500 leading-none">{currentOutages}</span>
              </div>
            </div>

            <button 
              onClick={() => {
                setIsPlanningMode(!isPlanningMode);
                setPlannedZone(prev => ({ ...prev, isActive: !isPlanningMode }));
              }}
              className={`px-5 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center gap-2 border-2
                ${isPlanningMode ? 'bg-yellow-400 border-yellow-500 text-yellow-900 shadow-lg' : 'bg-slate-800 border-slate-700 text-slate-300'}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><path d="m16 12-4-4-4 4"/><path d="M12 16V8"/></svg>
              {isPlanningMode ? 'ยกเลิกการวางแผน' : 'โหมดเตรียมการดับไฟ'}
            </button>
            <button 
              onClick={() => setIsFormOpen(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-bold text-xs transition-all shadow-lg flex items-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
              ลงทะเบียนผู้ป่วย
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Sidebar */}
        <div className="lg:col-span-4 space-y-6 order-2 lg:order-1">
          <div className="bg-white p-6 rounded-[32px] shadow-sm border border-slate-200">
            <h2 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-blue-600"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              {isPlanningMode ? 'ผู้ป่วยที่ได้รับผลกระทบจากแผนงาน' : 'รายชื่อผู้ป่วยทั้งหมด'}
            </h2>
            <div className="space-y-4 max-h-[calc(100vh-250px)] overflow-y-auto pr-2 custom-scrollbar">
              {(isPlanningMode ? affectedByPlanning : patients).length === 0 ? (
                <div className="text-center py-10 opacity-50 font-bold">ไม่พบข้อมูลผู้ป่วย</div>
              ) : (
                (isPlanningMode ? affectedByPlanning : patients).map(p => (
                  <PatientCard 
                    key={p.id} 
                    patient={p} 
                    onUpdateStatus={handleUpdateStatus} 
                    onDelete={handleDeletePatient}
                  />
                ))
              )}
            </div>
          </div>
        </div>

        {/* Main Content (Map & Tools) */}
        <div className="lg:col-span-8 space-y-6 order-1 lg:order-2">
          
          {/* Planning Tools */}
          {isPlanningMode && (
            <div className="bg-slate-900 border border-slate-800 p-6 rounded-[32px] shadow-2xl animate-in slide-in-from-top duration-300">
              <div className="flex flex-col gap-6">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-xl font-bold text-white leading-none">ศูนย์บริหารแผนงานดับไฟ (กฟจ.ระยอง)</h3>
                    <p className="text-slate-400 text-xs mt-2 uppercase font-bold tracking-widest">ระบุจุดซ่อมบำรุงและรัศมีผลกระทบเพื่อตรวจสอบผู้ป่วย</p>
                  </div>
                  <div className="bg-yellow-500/10 border border-yellow-500/20 px-3 py-1 rounded-full">
                    <span className="text-yellow-500 font-bold text-[10px]">ANALYSIS ACTIVE</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="space-y-3">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">ตำแหน่งพิกัดงาน</span>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label className="text-[9px] text-slate-600 font-bold uppercase">Latitude</label>
                        <input type="number" step="0.0001" className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white font-bold text-sm outline-none focus:border-yellow-500 transition-colors" value={plannedZone.center.lat} onChange={(e) => setPlannedZone(prev => ({ ...prev, center: { ...prev.center, lat: parseFloat(e.target.value) } }))} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] text-slate-600 font-bold uppercase">Longitude</label>
                        <input type="number" step="0.0001" className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-white font-bold text-sm outline-none focus:border-yellow-500 transition-colors" value={plannedZone.center.lng} onChange={(e) => setPlannedZone(prev => ({ ...prev, center: { ...prev.center, lng: parseFloat(e.target.value) } }))} />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between items-end">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">รัศมีผลกระทบ</span>
                      <span className="text-yellow-500 font-bold text-lg leading-none">{plannedZone.radiusKm.toFixed(1)} กม.</span>
                    </div>
                    <input type="range" min="0.1" max="10.0" step="0.1" className="w-full accent-yellow-500 cursor-pointer h-2 bg-slate-800 rounded-lg appearance-none mt-2" value={plannedZone.radiusKm} onChange={(e) => setPlannedZone(prev => ({ ...prev, radiusKm: parseFloat(e.target.value) }))} />
                  </div>

                  <div className="bg-slate-800/50 rounded-2xl p-4 border border-slate-700 flex flex-col justify-center gap-2">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-slate-400">ผู้ป่วยได้รับผลกระทบ:</span>
                      <span className="text-lg font-black text-white">{affectedByPlanning.length}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold text-red-500">กลุ่มวิกฤต (Critical):</span>
                      <span className="text-lg font-black text-red-500">{affectedByPlanning.filter(p => p.priority === Priority.CRITICAL).length}</span>
                    </div>
                  </div>
                </div>

                <div className="flex gap-4 pt-4 border-t border-slate-800">
                  <button onClick={() => alert(`ดำเนินการแจ้งเตือนผู้ป่วยล่วงหน้าเรียบร้อย (${affectedByPlanning.length} ราย)`)} className="flex-1 bg-yellow-500 hover:bg-yellow-600 text-slate-900 font-bold py-3.5 rounded-2xl transition-all shadow-lg active:scale-95 text-sm" disabled={affectedByPlanning.length === 0}>
                    ส่งประกาศแจ้งเตือนผู้ป่วยล่วงหน้า
                  </button>
                  <button onClick={() => setIsPlanningMode(false)} className="px-6 bg-slate-800 hover:bg-slate-700 text-slate-400 font-bold py-3.5 rounded-2xl transition-all text-sm">
                    ปิดโหมดงาน
                  </button>
                </div>
              </div>
            </div>
          )}

          <PatientMap 
            patients={patients} 
            onSelectPatient={setSelectedPatient} 
            plannedZone={plannedZone}
            isPlanningMode={isPlanningMode}
            onMapClick={(lat, lng) => setPlannedZone(prev => ({ ...prev, center: { lat, lng }, isActive: true }))}
          />
        </div>
      </main>

      {/* Register Modal */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md flex items-center justify-center z-[100] p-4">
           <div className="bg-white rounded-[40px] shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col border border-white/20">
              <div className="p-8 border-b border-slate-100 flex justify-between items-center">
                <h2 className="text-2xl font-bold text-slate-900">ลงทะเบียนผู้ป่วยใหม่ (กฟจ.ระยอง)</h2>
                <button onClick={() => setIsFormOpen(false)} className="w-12 h-12 flex items-center justify-center rounded-2xl bg-slate-50 text-slate-400 hover:text-red-500 transition-all">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                </button>
              </div>
              <form onSubmit={handleAddPatient} className="p-8 space-y-6 overflow-y-auto custom-scrollbar">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">ชื่อ-นามสกุล</label>
                      <input required className="w-full px-5 py-4 rounded-2xl bg-slate-50 border-2 border-transparent focus:border-blue-500 outline-none font-bold" value={newPatient.name} onChange={e => setNewPatient({...newPatient, name: e.target.value})} placeholder="ระบุชื่อจริง..."/>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">อายุ</label>
                      <input type="number" required className="w-full px-5 py-4 rounded-2xl bg-slate-50 border-2 border-transparent focus:border-blue-500 outline-none font-bold" value={newPatient.age} onChange={e => setNewPatient({...newPatient, age: e.target.value})}/>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">อาการสำคัญ (AI จะใช้ประเมินความเสี่ยง)</label>
                    <textarea required className="w-full px-5 py-4 rounded-2xl bg-slate-50 border-2 border-transparent focus:border-blue-500 outline-none font-medium h-24" value={newPatient.condition} onChange={e => setNewPatient({...newPatient, condition: e.target.value})} placeholder="เช่น ต้องใช้เครื่องช่วยหายใจตลอดเวลา, ผู้ป่วยอัมพาตครึ่งตัว..."/>
                  </div>
                  <div className="space-y-4">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">อุปกรณ์สนับสนุน</label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {EQUIPMENT_OPTIONS.map(item => (
                        <button key={item} type="button" onClick={() => toggleEquipment(item)}
                          className={`px-4 py-3 rounded-2xl border-2 text-left text-xs font-bold transition-all
                            ${newPatient.equipment.includes(item) ? 'bg-blue-600 border-blue-600 text-white shadow-lg' : 'bg-white border-slate-100 text-slate-600 hover:border-slate-300'}`}>
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="bg-slate-50 p-6 rounded-3xl space-y-4">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">ระบุพิกัด (คลิกบนแผนที่หลักได้)</label>
                    <div className="grid grid-cols-2 gap-4">
                      <input type="number" step="0.0001" className="px-4 py-2 rounded-xl border border-slate-200" value={newPatient.lat} onChange={e => setNewPatient({...newPatient, lat: parseFloat(e.target.value)})}/>
                      <input type="number" step="0.0001" className="px-4 py-2 rounded-xl border border-slate-200" value={newPatient.lng} onChange={e => setNewPatient({...newPatient, lng: parseFloat(e.target.value)})}/>
                    </div>
                  </div>
                  <button type="submit" disabled={isAssessing} className="w-full py-5 rounded-[24px] bg-blue-600 text-white font-black text-xl hover:bg-blue-700 transition-all shadow-xl shadow-blue-600/20">
                    {isAssessing ? 'AI กำลังประเมินระดับความสำคัญ...' : 'ลงทะเบียนและประเมินผล'}
                  </button>
              </form>
           </div>
        </div>
      )}

      <footer className="bg-white border-t border-slate-200 py-10 text-center">
        <p className="text-slate-400 text-[10px] font-black uppercase tracking-[0.3em]">
          PEA RAYONG LIFECARE MONITORING SYSTEM v2.8 // Resilience and Response
        </p>
      </footer>
    </div>
  );
};

export default App;
