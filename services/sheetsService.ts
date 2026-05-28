// Cache the access token in memory
let cachedAccessToken: string | null = null;

// Mock authentications since we are removing Firebase Auth to prevent 'unauthorized-domain' issues
export const initAuth = (
  onAuthSuccess?: (user: any, token: string) => void,
  onAuthFailure?: () => void
) => {
  // Silent fallback - no active Firebase Session
  if (onAuthFailure) onAuthFailure();
  return () => {};
};

export const googleSignIn = async (): Promise<{ user: any; accessToken: string } | null> => {
  throw new Error('Google Sign-In with Firebase Auth is disabled. Please use Google Apps Script Web App or a direct Access Token.');
};

export const logout = async () => {
  cachedAccessToken = null;
};

// Original Google Sheets API Fetch integration (Can still be used if a direct access token is supplied)
export async function getFirstSheetName(spreadsheetId: string, accessToken: string): Promise<string> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to fetch spreadsheet metadata: ${res.status} ${res.statusText} - ${errText}`);
  }
  const data = await res.json();
  if (data.sheets && data.sheets.length > 0) {
    return data.sheets[0].properties.title;
  }
  return 'Sheet1';
}

export async function writePatientsToSheet(spreadsheetId: string, accessToken: string, patients: any[]): Promise<void> {
  const sheetName = await getFirstSheetName(spreadsheetId, accessToken);
  
  // 1. Clear the sheet first to prevent trailing old data
  const clearRange = `${sheetName}!A1:M1000`;
  const clearUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(clearRange)}:clear`;
  const clearRes = await fetch(clearUrl, {
    method: 'POST',
    headers: { 
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
  });
  if (!clearRes.ok) {
    const clearErr = await clearRes.text();
    console.warn(`Could not clear sheet values: ${clearRes.status} - ${clearErr}`);
  }

  // 2. Prepare headers and row values
  const headers = [
    'ID', 
    'ชื่อ-นามสกุล', 
    'อายุ', 
    'ระดับวิกฤตความปลอดภัย', 
    'สถานะกระแสไฟ', 
    'โรคประจำตัว/ข้อจำกัดพยาบาล', 
    'อุปกรณ์หลีกเลี่ยงความเสี่ยง', 
    'ที่อยู่', 
    'เบอร์ติดต่อประสานงาน', 
    'ละติจูด', 
    'ลองจิจูด', 
    'ปรับปรุงล่าสุด'
  ];

  const rows = patients.map(p => [
    p.id || '',
    p.name || '',
    p.age !== undefined ? p.age.toString() : '',
    p.priority || 'LOW',
    p.status || 'NORMAL',
    p.condition || '',
    p.equipment ? p.equipment.join('|') : '',
    p.address || '',
    p.contact || '',
    p.coordinates?.lat !== undefined ? p.coordinates.lat.toString() : '',
    p.coordinates?.lng !== undefined ? p.coordinates.lng.toString() : '',
    p.lastUpdated || new Date().toISOString()
  ]);

  const values = [headers, ...rows];

  // 3. Put range
  const putRange = `${sheetName}!A1`;
  const putUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(putRange)}?valueInputOption=USER_ENTERED`;
  const response = await fetch(putUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ values })
  });

  if (!response.ok) {
    const putErr = await response.text();
    throw new Error(`Failed to write to Google Sheets: ${response.status} ${response.statusText} - ${putErr}`);
  }
}

export async function readPatientsFromSheet(spreadsheetId: string, accessToken: string): Promise<any[]> {
  const sheetName = await getFirstSheetName(spreadsheetId, accessToken);
  const readRange = `${sheetName}!A2:L1000`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(readRange)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const readErr = await res.text();
    throw new Error(`Failed to read Google Sheets values: ${res.status} ${res.statusText} - ${readErr}`);
  }
  const data = await res.json();
  if (!data.values || data.values.length === 0) {
    return [];
  }

  // Parse rows back to patients format
  return data.values.map((row: any) => {
    const ageVal = parseInt(row[2]);
    const latVal = parseFloat(row[9]);
    const lngVal = parseFloat(row[10]);
    return {
      id: row[0] || `pat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: row[1] || '',
      age: isNaN(ageVal) ? 0 : ageVal,
      priority: row[3] || 'LOW',
      status: row[4] || 'NORMAL',
      condition: row[5] || '',
      equipment: row[6] ? row[6].split('|').filter(Boolean) : [],
      address: row[7] || '',
      contact: row[8] || '',
      coordinates: {
        lat: isNaN(latVal) ? 12.6814 : latVal,
        lng: isNaN(lngVal) ? 101.2813 : lngVal
      },
      lastUpdated: row[11] || new Date().toISOString()
    };
  });
}
