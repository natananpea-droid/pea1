
import React, { useState, useEffect } from 'react';
import { Patient, Priority, PowerStatus } from '../types';

interface PatientCardProps {
  patient: Patient;
  onUpdateStatus: (id: string, status: PowerStatus) => void;
  onEdit?: (patient: Patient) => void;
  onDelete?: (id: string) => void;
  isAdmin: boolean;
  isEditable?: boolean; // True if the card represents the logged-in patient's own profile
}

const PatientCard: React.FC<PatientCardProps> = ({ patient, onUpdateStatus, onEdit, onDelete, isAdmin, isEditable = false }) => {
  const [timeLeft, setTimeLeft] = useState<string>('');
  const isCritical = patient.priority === Priority.CRITICAL;
  const isOutage = patient.status !== PowerStatus.NORMAL;

  useEffect(() => {
    if (!isOutage || !patient.estimatedRestorationTime) {
      setTimeLeft('');
      return;
    }

    const timer = setInterval(() => {
      const now = new Date().getTime();
      const end = new Date(patient.estimatedRestorationTime!).getTime();
      const distance = end - now;

      if (distance < 0) {
        setTimeLeft('กำลังดำเนินการคืนไฟฟ้า...');
        clearInterval(timer);
        return;
      }

      const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((distance % (1000 * 60)) / 1000);
      setTimeLeft(`${minutes}น. ${seconds}ว.`);
    }, 1000);

    return () => clearInterval(timer);
  }, [isOutage, patient.estimatedRestorationTime]);

  const handleStatusChange = (status: PowerStatus) => {
    // Both matching owners (isEditable) and Admin are allowed to update power status in Rayong
    if (!isEditable && !isAdmin) {
      alert("⚠️ สิทธิ์การใช้งานจำกัด: คุณสามารถรายงานและแจ้งเรื่องระบบไฟฟ้าผู้ป่วยเฉพาะบัญชีตนเองเท่านั้น");
      return;
    }
    onUpdateStatus(patient.id, status);
  };

  return (
    <div className={`relative p-5 rounded-3xl border-l-[6px] shadow-sm transition-all hover:shadow-md bg-white
      ${isCritical ? 'border-l-rose-500' : 'border-l-blue-500'} 
      ${isOutage ? 'ring-2 ring-rose-450 scale-[1.01] bg-rose-50/10' : ''}`}
    >
      {/* Top right editing button panel - only visible to matching authorized owners or Admins */}
      {(isEditable || isAdmin) && (
        <div className="absolute top-3 right-3 flex items-center gap-1 bg-white/90 backdrop-blur-sm p-1 rounded-2xl shadow-sm border border-slate-100 z-10">
          {onEdit && (
            <button 
              onClick={(e) => { e.stopPropagation(); onEdit(patient); }}
              className="px-2.5 py-1 text-blue-600 hover:bg-blue-50 text-[10px] font-bold rounded-xl transition-all flex items-center gap-1"
              title="แก้ไขรายละเอียดข้อมูล"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              {isAdmin ? 'แก้ไข' : 'แก้ไขข้อมูลตนเอง'}
            </button>
          )}
          {isAdmin && onDelete && (
            <button 
              onClick={(e) => { 
                e.stopPropagation(); 
                onDelete(patient.id); 
              }}
              className="px-2.5 py-1 text-red-600 hover:bg-red-50 text-[10px] font-bold rounded-xl transition-all flex items-center gap-1 border-l border-slate-100"
              title="ลบรายชื่อผู้ป่วย"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
              ลบ
            </button>
          )}
        </div>
      )}

      <div className={`flex justify-between items-start mb-3 ${(isEditable || isAdmin) ? 'pr-28' : 'pr-4'}`}>
        <div>
          <h3 className="font-extrabold text-base text-slate-900">{patient.name}</h3>
          <p className="text-[10px] text-slate-500 font-medium">อายุ: {patient.age} ปี // อัปเดตเมื่อ: {new Date(patient.lastUpdated).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`px-2 py-0.5 rounded-full text-[9px] font-black tracking-wider uppercase
            ${isCritical ? 'bg-rose-100 text-rose-700 border border-rose-200' : 'bg-blue-100 text-blue-700 border border-blue-200'}`}>
            {isCritical ? '🚨 วิกฤตสูงสุด' : '🔵 ปานกลาง'}
          </span>
          {isOutage && (
            <span className="text-[9px] font-bold text-rose-600 bg-rose-50 px-1.5 rounded-full border border-rose-200 animate-pulse">
              OUTAGE (ไฟดับ)
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2 mb-4">
        <p className="text-sm text-slate-600 leading-tight">
          <span className="font-semibold text-slate-800">อาการ:</span> {patient.condition}
        </p>
        <div className="flex flex-wrap gap-1">
          {patient.equipment.map(item => (
            <span key={item} className="bg-slate-100 text-slate-600 text-[10px] px-2 py-0.5 rounded-full border border-slate-200">
              {item}
            </span>
          ))}
        </div>
        <p className="text-sm text-slate-600">
          <span className="font-semibold text-slate-800">ที่อยู่:</span> {patient.address}
        </p>
        
        {isOutage && timeLeft && (
          <div className="mt-2 p-2 bg-red-50 rounded-lg border border-red-100 flex items-center justify-between">
            <span className="text-[10px] font-bold text-red-700 uppercase">ประมาณเวลาคืนไฟ:</span>
            <span className="text-xs font-mono font-bold text-red-600">{timeLeft}</span>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button 
          onClick={() => handleStatusChange(PowerStatus.NORMAL)}
          className={`flex-1 py-1.5 rounded text-sm font-bold transition-all
            ${patient.status === PowerStatus.NORMAL ? 'bg-green-100 text-green-700 border border-green-200 cursor-default' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
        >
          {patient.status === PowerStatus.NORMAL ? '✓ จ่ายไฟปกติ' : 'กู้คืนไฟฟ้า'}
        </button>
        <button 
          onClick={() => handleStatusChange(PowerStatus.OUTAGE)}
          className={`flex-1 py-1.5 rounded text-sm font-bold transition-all
            ${patient.status === PowerStatus.OUTAGE ? 'bg-red-600 text-white shadow-lg animate-pulse' : 'bg-red-50 text-red-600 border border-red-200 hover:bg-red-100'}`}
        >
          🚨 แจ้งไฟดับ
        </button>
      </div>
    </div>
  );
};

export default PatientCard;
