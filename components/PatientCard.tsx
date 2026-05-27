
import React, { useState, useEffect } from 'react';
import { Patient, Priority, PowerStatus } from '../types';

interface PatientCardProps {
  patient: Patient;
  onUpdateStatus: (id: string, status: PowerStatus) => void;
  onDelete?: (id: string) => void;
}

const PatientCard: React.FC<PatientCardProps> = ({ patient, onUpdateStatus, onDelete }) => {
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

  return (
    <div className={`relative p-4 rounded-xl border-l-4 shadow-sm transition-all hover:shadow-md bg-white
      ${isCritical ? 'border-l-red-600' : 'border-l-blue-500'} 
      ${isOutage ? 'ring-2 ring-red-400 scale-[1.02]' : ''}`}
    >
      {/* Delete Button */}
      {onDelete && (
        <button 
          onClick={(e) => { e.stopPropagation(); onDelete(patient.id); }}
          className="absolute top-2 right-2 p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors group"
          title="ลบข้อมูลผู้ป่วย"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
        </button>
      )}

      <div className="flex justify-between items-start mb-3 pr-8">
        <div>
          <h3 className="font-bold text-lg text-slate-800">{patient.name}</h3>
          <p className="text-xs text-slate-500">อายุ: {patient.age} ปี | อัปเดตล่าสุด: {new Date(patient.lastUpdated).toLocaleTimeString()}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase
            ${isCritical ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
            {patient.priority}
          </span>
          {isOutage && (
            <span className="text-[10px] font-bold text-red-600 animate-pulse bg-red-50 px-1 rounded border border-red-100">
              OUTAGE
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
          onClick={() => onUpdateStatus(patient.id, PowerStatus.NORMAL)}
          className={`flex-1 py-1.5 rounded text-sm font-bold transition-all
            ${patient.status === PowerStatus.NORMAL ? 'bg-green-100 text-green-700 border border-green-200 cursor-default' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
        >
          {patient.status === PowerStatus.NORMAL ? '✓ จ่ายไฟปกติ' : 'กู้คืนไฟฟ้า'}
        </button>
        <button 
          onClick={() => onUpdateStatus(patient.id, PowerStatus.OUTAGE)}
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
