
import React from 'react';

export const EQUIPMENT_OPTIONS = [
  'เครื่องช่วยหายใจ (Ventilator)',
  'เครื่องผลิตออกซิเจน (Oxygen Concentrator)',
  'เครื่องดูดเสมหะ (Suction)',
  'เตียงปรับไฟฟ้า',
  'เครื่องพ่นยา',
  'เครื่องวัดสัญญาณชีพ',
  'ที่นอนลม (Air Mattress)'
];

export const MOCK_PATIENTS = [
  {
    id: '1',
    name: 'นายสมชาย รักษาดี',
    age: 72,
    condition: 'ผู้ป่วยอัมพาตครึ่งซีก ต้องใช้เครื่องช่วยหายใจ',
    equipment: ['เครื่องช่วยหายใจ (Ventilator)', 'เตียงปรับไฟฟ้า'],
    address: '123/45 ต.เชิงเนิน อ.เมือง จ.ระยอง',
    coordinates: { lat: 12.6814, lng: 101.2813 },
    contact: '081-234-5678 (บุตรชาย)',
    priority: 'CRITICAL',
    status: 'NORMAL',
    lastUpdated: new Date().toISOString()
  },
  {
    id: '2',
    name: 'นางสมร มีสุข',
    age: 65,
    condition: 'โรคถุงลมโป่งพอง ต้องใช้ออกซิเจน',
    equipment: ['เครื่องผลิตออกซิเจน (Oxygen Concentrator)', 'ที่นอนลม (Air Mattress)'],
    address: '99/1 ต.เนินพระ อ.เมือง จ.ระยอง',
    coordinates: { lat: 12.6761, lng: 101.2488 },
    contact: '089-999-8888 (ญาติ)',
    priority: 'HIGH',
    status: 'NORMAL',
    lastUpdated: new Date().toISOString()
  },
  {
    id: '3',
    name: 'นายวิชัย มาบตาพุด',
    age: 80,
    condition: 'ผู้ป่วยติดเตียงสูงอายุ',
    equipment: ['ที่นอนลม (Air Mattress)'],
    address: 'อ.มาบตาพุด จ.ระยอง',
    coordinates: { lat: 12.6958, lng: 101.1718 },
    contact: '085-111-2222',
    priority: 'MEDIUM',
    status: 'NORMAL',
    lastUpdated: new Date().toISOString()
  }
];
