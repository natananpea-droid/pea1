import React, { useState, useMemo } from 'react';
import { Patient, Priority, PowerStatus } from '../types';
import { Search, FileDown, Filter, MapPin, Eye, Edit2, Trash2, ShieldAlert, CheckCircle, Info } from 'lucide-react';

interface PatientsRegistryProps {
  patients: Patient[];
  isAdmin: boolean;
  onLocatePatient: (patient: Patient) => void;
  onEditPatient: (patient: Patient) => void;
  onDeletePatient: (patientId: string) => void;
  onOpenRegisterForm: () => void;
}

const PatientsRegistry: React.FC<PatientsRegistryProps> = ({
  patients,
  isAdmin,
  onLocatePatient,
  onEditPatient,
  onDeletePatient,
  onOpenRegisterForm
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Filter patients based on search term and dropdown selections
  const filteredPatients = useMemo(() => {
    return patients.filter(p => {
      const cleanSearch = searchTerm.trim().toLowerCase();
      
      const matchesSearch = !cleanSearch || 
        p.name.toLowerCase().includes(cleanSearch) ||
        p.contact.replace(/\D/g, '').includes(cleanSearch.replace(/\D/g, '')) ||
        p.contact.toLowerCase().includes(cleanSearch) ||
        p.condition.toLowerCase().includes(cleanSearch) ||
        p.address.toLowerCase().includes(cleanSearch) ||
        p.id.toLowerCase().includes(cleanSearch);

      const matchesPriority = priorityFilter === 'ALL' || p.priority === priorityFilter;
      
      const matchesStatus = statusFilter === 'ALL' || 
        (statusFilter === 'OUTAGE' && (p.status === PowerStatus.OUTAGE || p.status === PowerStatus.PLANNED_OUTAGE)) ||
        (statusFilter === 'NORMAL' && p.status === PowerStatus.NORMAL);

      return matchesSearch && matchesPriority && matchesStatus;
    });
  }, [patients, searchTerm, priorityFilter, statusFilter]);

  // Statistics calculation for filtered status
  const stats = useMemo(() => {
    const total = patients.length;
    const critical = patients.filter(p => p.priority === Priority.CRITICAL).length;
    const high = patients.filter(p => p.priority === Priority.HIGH).length;
    const activeOutage = patients.filter(p => p.status === PowerStatus.OUTAGE || p.status === PowerStatus.PLANNED_OUTAGE).length;
    return { total, critical, high, activeOutage };
  }, [patients]);

  // Client-side CSV download trigger
  const exportToCSV = () => {
    try {
      const headers = ['ID', 'ชื่อ-นามสกุล', 'อายุ', 'ระดับวิกฤตความปลอดภัย', 'สถานะกระแสไฟ', 'โรคประจำตัว/ข้อจำกัดพยาบาล', 'อุปกรณ์หลักเลี่ยงความเสี่ยง', 'ที่อยู่', 'เบอร์ติดต่อประสานงาน', 'ละติจูด', 'ลองจิจูด'];
      const rows = patients.map(p => [
        p.id,
        p.name,
        p.age,
        p.priority === Priority.CRITICAL ? 'วิกฤตสูงสุด' : p.priority === Priority.HIGH ? 'สูง' : p.priority === Priority.MEDIUM ? 'ปานกลาง' : 'ต่ำ',
        p.status === PowerStatus.NORMAL ? 'ปกติ' : 'กระแสไฟฟ้าขัดข้อง',
        p.condition.replace(/,/g, ';').replace(/\n/g, ' '),
        p.equipment.join('|'),
        p.address.replace(/,/g, ';').replace(/\n/g, ' '),
        p.contact.replace(/,/g, ';'),
        p.coordinates.lat,
        p.coordinates.lng
      ]);

      const csvContent = "\uFEFF" + [
        headers.join(','),
        ...rows.map(e => e.map(val => `"${val}"`).join(','))
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", `PEA_Rayong_Patients_Registry_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Failed to export registry spreadsheet:", err);
      alert("ไม่สามารถสร้างไฟล์ CSV ได้ชั่วคราว");
    }
  };

  return (
    <div className="bg-white rounded-[32px] border border-slate-200/80 shadow-sm p-6 sm:p-8 space-y-8 animate-scale-up">
      {/* Search Header Banner */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pb-6 border-b border-slate-100">
        <div className="space-y-1">
          <h2 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <span className="p-1.5 bg-blue-550/10 text-blue-600 bg-blue-50 rounded-xl">
              <FileDown size={22} />
            </span>
            ทะเบียนรวมรายชื่อผู้ป่วยเปราะบางสำเร็จ
          </h2>
          <p className="text-xs text-slate-500 font-bold">
            ฐานข้อมูลผู้ป่วยติดเตียงและพิกัดเครื่องผลิตระบบไฟฟ้าหลักระยอง (บันทึกข้อมูลแบบ Cloud Firestore สำเร็จ)
          </p>
        </div>
        
        <div className="flex flex-wrap gap-2 w-full md:w-auto">
          {isAdmin && (
            <button 
              onClick={onOpenRegisterForm}
              className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-black rounded-xl transition-all shadow-md shadow-blue-600/10 hover:-translate-y-0.5"
            >
              + ลงทะเบียนผู้ป่วยวิกฤตใหม่
            </button>
          )}
          <button 
            onClick={exportToCSV}
            className="px-4 py-2.5 border-2 border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-black rounded-xl transition-all flex items-center gap-1.5 hover:-translate-y-0.5"
            title="ดาวน์โหลดรายชื่อผู้ป่วยทั้งหมดรูปแบบไฟล์สรุป Excel/CSV"
          >
            <FileDown size={14} />
            ดาวน์โหลดรายงานฐานข้อมูล (CSV)
          </button>
        </div>
      </div>

      {/* Interactive Database Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 flex flex-col justify-between">
          <span className="text-[10px] text-slate-400 font-black uppercase tracking-wider">ผู้ลงทะเบียนทั้งหมดในระบบ</span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-3xl font-black text-slate-900 leading-none">{stats.total}</span>
            <span className="text-[10px] text-slate-400 font-bold">รายชื่อ</span>
          </div>
        </div>
        
        <div className="bg-rose-50/40 p-4 rounded-2xl border border-rose-100 flex flex-col justify-between">
          <span className="text-[10px] text-rose-500 font-black uppercase tracking-wider">🚨 กลุ่มวิกฤตดูแลเร่งด่วนที่สุด</span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-3xl font-black text-rose-600 leading-none">{stats.critical}</span>
            <span className="text-[10px] text-rose-500 font-bold">รายชื่อ</span>
          </div>
        </div>

        <div className="bg-orange-50/40 p-4 rounded-2xl border border-orange-100 flex flex-col justify-between">
          <span className="text-[10px] text-orange-600 font-black uppercase tracking-wider">🟠 กลุ่มความสำคัญจำพยุงชีพสูง</span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-3xl font-black text-orange-600 leading-none">{stats.high}</span>
            <span className="text-[10px] text-orange-500 font-bold">รายชื่อ</span>
          </div>
        </div>

        <div className="bg-amber-50/40 p-4 rounded-2xl border border-amber-100 flex flex-col justify-between">
          <span className="text-[10px] text-amber-600 font-black uppercase tracking-wider">⚡ กระแสไฟดับ/วิกฤตขณะนี้</span>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="text-3xl font-black text-amber-500 leading-none">{stats.activeOutage}</span>
            <span className="text-[10px] text-amber-500 font-bold">กรณี</span>
          </div>
        </div>
      </div>

      {/* Filtering Toolbar */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center bg-slate-50/70 border border-slate-100 rounded-3xl p-4">
        {/* Search */}
        <div className="md:col-span-6 relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input 
            type="text"
            className="w-full text-xs font-bold pl-11 pr-4 py-3 rounded-xl bg-white border border-slate-200 focus:border-blue-500 outline-none transition-colors placeholder:text-slate-400"
            placeholder="ค้นหาด่วนด้วยชื่อผู้ป่วย, อายุ, เบอร์โทรศัพท์, อาการป่วย หรือที่อยู่..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>

        {/* Priority Filter */}
        <div className="md:col-span-3 flex items-center gap-2">
          <Filter size={14} className="text-slate-400 shrink-0" />
          <select 
            className="w-full text-xs font-bold px-3 py-3 rounded-xl bg-white border border-slate-200 focus:border-blue-500 outline-none transition-colors"
            value={priorityFilter}
            onChange={e => setPriorityFilter(e.target.value)}
          >
            <option value="ALL">ระดับความวิกฤต: ทั้งหมด</option>
            <option value={Priority.CRITICAL}>🚨 วิกฤตสูงสุด (Critical)</option>
            <option value={Priority.HIGH}>🟠 สูง (High)</option>
            <option value={Priority.MEDIUM}>🔵 ปานกลาง (Medium)</option>
            <option value={Priority.LOW}>🟢 ต่ำ (Low)</option>
          </select>
        </div>

        {/* Status Filter */}
        <div className="md:col-span-3">
          <select 
            className="w-full text-xs font-bold px-3 py-3 rounded-xl bg-white border border-slate-200 focus:border-blue-500 outline-none transition-colors"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
          >
            <option value="ALL">สถานะไฟฟ้าปัจจุบัน: ทั้งหมด</option>
            <option value="NORMAL">🟢 ปกติ (มีไฟฟ้าใช้งาน)</option>
            <option value="OUTAGE">🔴 กระแสไฟฟ้าขัดข้อง (ไฟดับ)</option>
          </select>
        </div>
      </div>

      {/* Database Active Information Info alert */}
      <div className="bg-amber-50 text-amber-850 p-4 rounded-2xl border border-amber-100 flex gap-3 text-xs leading-relaxed">
        <Info className="text-amber-600 shrink-0 self-center" size={18} />
        <div>
          <strong className="font-extrabold text-amber-900 block mb-0.5">💡 คำแนะนำสำหรับการตรวจสอบพิกัดข้อมูลผู้ป่วย</strong>
          <p>ข้อมูลทั้งหมดบันทึกร่วมแกนกลางผ่านระบบ <strong className="font-bold">Cloud FireStore (Database Synchronized)</strong> เรียบร้อยแล้ว สมาชิกหรือเจ้าหน้าที่สามารถเปิดดูหน้าตรวจสอบนี้ ตรวจเช็กพิกัดรายชื่อที่เคยบันทึกไว้ และสั่งปักหมุดนำทางระบบพิกัด GPS ได้ทันทีจากผู้ใช้นอกสถานที่ทุกอุปกรณ์</p>
        </div>
      </div>

      {/* Main Database Table Container */}
      <div className="overflow-x-auto border border-slate-200/60 rounded-2xl select-none">
        <table className="min-w-full divide-y divide-slate-200 text-left">
          <thead className="bg-slate-50 font-bold uppercase tracking-wider text-slate-500 text-[10px]">
            <tr>
              <th scope="col" className="px-5 py-4">ข้อมูลผู้รับสิทธิ์ / อายุ</th>
              <th scope="col" className="px-5 py-4">สถานะระดับความวิกฤต</th>
              <th scope="col" className="px-5 py-4">กระแสไฟฟ้า</th>
              <th scope="col" className="px-5 py-4">เครื่องมือแพทย์พยุงชีพจำเป็น</th>
              <th scope="col" className="px-5 py-4 max-w-xs">ภาวะอาการเจ็บป่วยเด่นชัด</th>
              <th scope="col" className="px-5 py-4">เบอร์ติดต่อหลัก</th>
              <th scope="col" className="px-5 py-4">ที่อยู่พิกัดจัดส่ง / GPS</th>
              <th scope="col" className="px-5 py-4 text-center">จัดการข้อมูล</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-slate-200/80 text-xs text-slate-700 font-medium">
            {filteredPatients.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-5 py-12 text-center text-slate-400 italic font-bold">
                  ไม่พบพิกัดผู้รับสิทธิ์ตามเงื่อนไขที่กรอกค้นหา กรุณาทบทวนคำกรอก หรือกดสลับแสดงผลเพื่อตรวจสอบความจำเพาะทางการลงทะเบียน
                </td>
              </tr>
            ) : (
              filteredPatients.map(p => {
                const isCritical = p.priority === Priority.CRITICAL;
                const isHigh = p.priority === Priority.HIGH;
                const isOutage = p.status === PowerStatus.OUTAGE || p.status === PowerStatus.PLANNED_OUTAGE;

                return (
                  <tr key={p.id} className="hover:bg-slate-50/55 transition-colors duration-150">
                    {/* Patient detail */}
                    <td className="px-5 py-4 font-black text-slate-900">
                      <div className="space-y-0.5">
                        <span className="block text-sm">{p.name}</span>
                        <span className="block text-[10px] text-slate-400 font-bold">อายุ {p.age} ปี // ID: {p.id}</span>
                      </div>
                    </td>

                    {/* Priority label */}
                    <td className="px-5 py-4 whitespace-nowrap">
                      <span className={`text-[9px] px-2.5 py-1 rounded-full font-black uppercase tracking-wider block text-center max-w-[120px]
                        ${isCritical ? 'bg-rose-50 text-rose-700 border border-rose-200' :
                          isHigh ? 'bg-orange-50 text-orange-700 border border-orange-200' :
                          p.priority === Priority.MEDIUM ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                          'bg-slate-50 text-slate-700 border border-slate-200'}`}
                      >
                        {p.priority === Priority.CRITICAL ? '🚨 วิกฤตประคองชีพ' :
                          p.priority === Priority.HIGH ? '⚠️ สำคัญพยุงชีพสูง' :
                          p.priority === Priority.MEDIUM ? '🔵 ปานกลางทั่วไป' :
                          '🟢 ความสำคัญต่ำ'}
                      </span>
                    </td>

                    {/* Live System Status */}
                    <td className="px-5 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 justify-start">
                        <span className={`w-2 h-2 rounded-full ${isOutage ? 'bg-red-500 animate-ping' : 'bg-emerald-500'}`} />
                        <span className={`font-extrabold ${isOutage ? 'text-rose-600 animate-pulse' : 'text-emerald-600'}`}>
                          {isOutage ? 'ไฟฟ้าขัดข้อง!' : 'ปกติ'}
                        </span>
                      </div>
                    </td>

                    {/* Equipment needed */}
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-1 max-w-[180px]">
                        {p.equipment.map((item, index) => (
                          <span key={index} className="bg-slate-100/90 text-slate-800 text-[9px] font-bold px-2 py-0.5 rounded border border-slate-200">
                            {item}
                          </span>
                        ))}
                        {p.equipment.length === 0 && (
                          <span className="text-slate-400 italic">เตียงผู้จัดชั่วคราวทั่วไป</span>
                        )}
                      </div>
                    </td>

                    {/* Condition details */}
                    <td className="px-5 py-4 text-xs max-w-xs text-slate-600 font-bold leading-normal truncate" title={p.condition}>
                      {p.condition}
                    </td>

                    {/* Contact details */}
                    <td className="px-5 py-4 whitespace-nowrap text-slate-900 font-black">
                      {p.contact}
                    </td>

                    {/* Address details */}
                    <td className="px-5 py-4 max-w-xs leading-relaxed">
                      <span className="block truncate font-bold text-slate-600" title={p.address}>{p.address}</span>
                      <span className="text-[10px] text-slate-400 font-mono block mt-0.5">({p.coordinates.lat.toFixed(4)}, {p.coordinates.lng.toFixed(4)})</span>
                    </td>

                    {/* Interactive operations */}
                    <td className="px-5 py-4 whitespace-nowrap text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button 
                          onClick={() => onLocatePatient(p)}
                          className="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg transition-all flex items-center gap-1"
                          title="นำร่องพิกัด บนแผนที่นำทางระบบสัญจร"
                        >
                          <MapPin size={11} className="text-blue-400" />
                          <span>ปักหมุดแผนที่</span>
                        </button>

                        {isAdmin && (
                          <>
                            <button 
                              onClick={() => onEditPatient(p)}
                              className="p-1.5 border border-slate-200 hover:bg-slate-100 text-slate-600 hover:text-slate-800 rounded-lg transition-all"
                              title="แก้ไขแฟ้มประวัตินี้"
                            >
                              <Edit2 size={12} />
                            </button>
                            <button 
                              onClick={() => onDeletePatient(p.id)}
                              className="p-1.5 border border-slate-200 hover:bg-rose-50 hover:border-rose-200 text-slate-500 hover:text-rose-600 rounded-lg transition-all"
                              title="ลบพิกัดข้อมูลผู้ป่วยรายนี้"
                            >
                              <Trash2 size={12} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PatientsRegistry;
