
export enum Priority {
  CRITICAL = 'CRITICAL', // ต้องใช้ไฟฟ้าตลอดเวลา (เครื่องช่วยหายใจ)
  HIGH = 'HIGH',         // อุปกรณ์พยุงชีพ (เครื่องดูดเสมหะ, เครื่องผลิตออกซิเจน)
  MEDIUM = 'MEDIUM',     // ผู้ป่วยติดเตียงทั่วไป (เตียงไฟฟ้า, แอร์ควบคุมอุณหภูมิ)
  LOW = 'LOW'            // ผู้ป่วยพักฟื้น
}

export enum PowerStatus {
  NORMAL = 'NORMAL',
  OUTAGE = 'OUTAGE',
  PLANNED_OUTAGE = 'PLANNED_OUTAGE'
}

export interface Patient {
  id: string;
  name: string;
  age: number;
  condition: string;
  equipment: string[];
  address: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  contact: string;
  priority: Priority;
  status: PowerStatus;
  lastUpdated: string;
  outageStartTime?: string;
  estimatedRestorationTime?: string;
}

export interface PlannedOutageZone {
  center: { lat: number; lng: number };
  radiusKm: number;
  isActive: boolean;
  plannedStartTime?: string;
}

export interface OutageZone {
  id: string;
  areaName: string;
  startTime: string;
  estimatedRestoration: string;
  affectedPatientIds: string[];
}
