
import React, { useEffect, useRef, useState } from 'react';
import { Patient, Priority, PlannedOutageZone } from '../types';

// Fix: Add global declaration for google to resolve "Cannot find name 'google'"
declare var google: any;

interface PatientMapProps {
  patients: Patient[];
  onSelectPatient: (p: Patient) => void;
  plannedZone: PlannedOutageZone;
  onMapClick?: (lat: number, lng: number) => void;
  isPlanningMode: boolean;
}

const PatientMap: React.FC<PatientMapProps> = ({ 
  patients, 
  onSelectPatient, 
  plannedZone, 
  onMapClick,
  isPlanningMode
}) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const googleMap = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const circleRef = useRef<any>(null);
  const [isLegendOpen, setIsLegendOpen] = useState(false);

  // Initialize Map - Set center to Rayong City
  useEffect(() => {
    if (mapRef.current && !googleMap.current) {
      googleMap.current = new google.maps.Map(mapRef.current, {
        center: { lat: 12.6814, lng: 101.2813 }, // Rayong Coordinates
        zoom: 13,
        mapId: 'RAYONG_MAP_ID',
        disableDefaultUI: false,
        zoomControl: true,
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: true,
        styles: [
          {
            featureType: "all",
            elementType: "geometry.fill",
            stylers: [{ weight: 2.0 }]
          }
        ]
      });

      googleMap.current.addListener('click', (e: any) => {
        if (e.latLng && onMapClick) {
          onMapClick(e.latLng.lat(), e.latLng.lng());
        }
      });
    }
  }, []);

  // Update Markers
  useEffect(() => {
    if (!googleMap.current) return;

    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];

    patients.forEach((p) => {
      const color = p.priority === Priority.CRITICAL ? '#dc2626' : 
                    p.priority === Priority.HIGH ? '#f97316' : '#2563eb';
      
      const marker = new google.maps.Marker({
        position: p.coordinates,
        map: googleMap.current,
        title: p.name,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: color,
          fillOpacity: 1,
          strokeColor: '#FFFFFF',
          strokeWeight: 2,
          scale: 12,
        },
        label: {
          text: p.name.charAt(0),
          color: 'white',
          fontSize: '10px',
          fontWeight: 'bold'
        }
      });

      marker.addListener('click', () => onSelectPatient(p));
      markersRef.current.push(marker);
    });
  }, [patients, onSelectPatient]);

  // Update Planned Zone Circle
  useEffect(() => {
    if (!googleMap.current) return;

    if (circleRef.current) {
      circleRef.current.setMap(null);
    }

    if (plannedZone.isActive) {
      circleRef.current = new google.maps.Circle({
        strokeColor: "#eab308",
        strokeOpacity: 0.8,
        strokeWeight: 2,
        fillColor: "#eab308",
        fillOpacity: 0.25,
        map: googleMap.current,
        center: plannedZone.center,
        radius: plannedZone.radiusKm * 1000, 
        clickable: false
      });
    }
  }, [plannedZone]);

  useEffect(() => {
    if (googleMap.current && plannedZone.isActive) {
      googleMap.current.panTo(plannedZone.center);
    }
  }, [plannedZone.center]);

  return (
    <div className="relative w-full h-[600px] rounded-[32px] overflow-hidden shadow-inner border-2 border-slate-200">
      <div ref={mapRef} className="w-full h-full" />
      
      {/* Collapsible Legend Overlay */}
      <div className="absolute bottom-6 right-6 flex flex-col items-end gap-2">
        {isLegendOpen && (
          <div className="bg-white/95 backdrop-blur-md p-4 rounded-2xl shadow-xl border border-slate-200 text-[10px] space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-200 w-48">
            <div className="font-bold text-slate-800 border-b border-slate-100 pb-2 mb-2 uppercase tracking-wider flex justify-between items-center">
               สัญลักษณ์บนแผนที่
               <button onClick={() => setIsLegendOpen(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
               </button>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-600"></div> 
              <span className="font-bold text-slate-600">วิกฤต (ต้องการไฟตลอด)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-orange-500"></div> 
              <span className="font-bold text-slate-600">สูง (เฝ้าระวังพิเศษ)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-600"></div> 
              <span className="font-bold text-slate-600">ปกติ (ติดเตียงทั่วไป)</span>
            </div>
            {plannedZone.isActive && (
              <div className="pt-2 border-t border-slate-100 mt-2">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full border border-yellow-500 bg-yellow-200"></div> 
                  <span className="font-bold text-yellow-700">พื้นที่ดับไฟตามแผน</span>
                </div>
              </div>
            )}
          </div>
        )}
        
        <button 
          onClick={() => setIsLegendOpen(!isLegendOpen)}
          className={`bg-white shadow-lg border border-slate-200 rounded-full px-4 py-2 flex items-center gap-2 transition-all hover:bg-slate-50 group
            ${isLegendOpen ? 'text-blue-600 font-bold' : 'text-slate-600'}`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="group-hover:rotate-12 transition-transform"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
          <span className="text-xs font-bold">{isLegendOpen ? 'ปิดคำอธิบาย' : 'คำอธิบายสัญลักษณ์'}</span>
        </button>
      </div>
    </div>
  );
};

export default PatientMap;
