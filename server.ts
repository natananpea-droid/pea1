import express from "express";
import path from "path";
import http from "http";
import fs from "fs";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, setDoc, deleteDoc, getDoc } from "firebase/firestore";

// Initialize Firebase safely inside a try-catch block to prevent server-crash if config is invalid/missing
let db: any = null;
try {
  const firebaseConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(firebaseConfigPath)) {
    const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf8"));
    if (firebaseConfig && firebaseConfig.projectId) {
      const firebaseApp = initializeApp(firebaseConfig);
      db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
      console.log("[Firebase] Successfully initialized Firestore client.");
    } else {
      console.warn("[Firebase] Warning: Config was found but lacks needed fields. Falling back to local db.json.");
    }
  } else {
    console.warn("[Firebase] Warning: firebase-applet-config.json not found. Falling back to local db.json.");
  }
} catch (err) {
  console.error("[Firebase] Error during Firebase initialization:", err);
}

// Standard Express + Http Server
const app = express();
const server = http.createServer(app);
const PORT = 3000;

app.use(express.json());

// Lazy Initialize Google GenAI
let aiInstance: GoogleGenAI | null = null;
function getAI() {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("GEMINI_API_KEY is not defined. Using rule-based fallback assessment.");
      return null;
    }
    aiInstance = new GoogleGenAI({ 
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });
  }
  return aiInstance;
}

// Real-Time Shared Database State (In-Memory on the Server & Persisted in db.json)
let patients: any[] = [];

let plannedZone = {
  center: { lat: 12.6814, lng: 101.2813 },
  radiusKm: 1.5,
  isActive: false
};

let isSimulationEnabled = true;
let lastUpdated = new Date().toISOString();

// Server-Side Google Sheets Integration variables
let googleAccessToken: string | null = null;
let googleUserEmail: string | null = null;
let savedSpreadsheetId: string = "11W01ZXTNRR3uZUHgsfpt7NwbPTiOAdOOZUvtKKOyLbM";
let googleAppsScriptUrl: string = "";

const DB_FILE = path.join(process.cwd(), "db.json");

function loadDBLocalFallback() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
      if (data.patients) patients = data.patients;
      if (data.plannedZone) plannedZone = data.plannedZone;
      if (data.isSimulationEnabled !== undefined) isSimulationEnabled = data.isSimulationEnabled;
      if (data.lastUpdated) lastUpdated = data.lastUpdated;
      if (data.googleAccessToken) googleAccessToken = data.googleAccessToken;
      if (data.googleUserEmail) googleUserEmail = data.googleUserEmail;
      if (data.savedSpreadsheetId) savedSpreadsheetId = data.savedSpreadsheetId;
      if (data.googleAppsScriptUrl) googleAppsScriptUrl = data.googleAppsScriptUrl;
      console.log(`[Local DB] Successfully loaded ${patients.length} patients and settings from db.json.`);
    } else {
      console.log("[Local DB] No local db.json found. System will start with standard defaults.");
    }
  } catch (err) {
    console.error("[Local DB] Failed to load local db.json fallback:", err);
  }
}

// Load local database right away to make sure the app instantly has high-fidelity offline/cached copy
loadDBLocalFallback();

function saveDBLocalFallback() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify({ 
      patients, 
      plannedZone, 
      isSimulationEnabled, 
      lastUpdated,
      googleAccessToken,
      googleUserEmail,
      savedSpreadsheetId,
      googleAppsScriptUrl
    }, null, 2), "utf-8");
  } catch (err) {
    // Silently skip local fallback write glitches
  }
}

async function loadDBFromFirestore() {
  if (!db) {
    console.log("[Firestore] Integration skipped: Firestore database client is not initialized.");
    return;
  }
  try {
    console.log("[Firestore] Booting up, pulling latest data from cloud...");

    // 1. Load settings (plannedZone, isSimulationEnabled, Google Sheets)
    const settingsDocRef = doc(db, "settings", "globalState");
    const settingsSnap = await getDoc(settingsDocRef);
    if (settingsSnap.exists()) {
      const data = settingsSnap.data();
      if (data.plannedZone) plannedZone = data.plannedZone;
      if (data.isSimulationEnabled !== undefined) isSimulationEnabled = data.isSimulationEnabled;
      if (data.lastUpdated) lastUpdated = data.lastUpdated;
      if (data.googleAccessToken) googleAccessToken = data.googleAccessToken;
      if (data.googleUserEmail) googleUserEmail = data.googleUserEmail;
      if (data.savedSpreadsheetId) savedSpreadsheetId = data.savedSpreadsheetId;
      if (data.googleAppsScriptUrl) googleAppsScriptUrl = data.googleAppsScriptUrl;
      console.log("[Firestore] Global settings loaded successfully:", { isSimulationEnabled, lastUpdated, googleUserEmail, savedSpreadsheetId, googleAppsScriptUrl });
    } else {
      // Setup initial settings document
      await setDoc(settingsDocRef, {
        plannedZone,
        isSimulationEnabled,
        lastUpdated: new Date().toISOString(),
        googleAccessToken: null,
        googleUserEmail: null,
        savedSpreadsheetId,
        googleAppsScriptUrl: ""
      });
      console.log("[Firestore] Created initial global settings document.");
    }

    // 2. Load patients
    const patientsColRef = collection(db, "patients");
    const patientsSnap = await getDocs(patientsColRef);
    const loadedPatients: any[] = [];
    patientsSnap.forEach((doc) => {
      loadedPatients.push({ id: doc.id, ...doc.data() });
    });

    if (loadedPatients.length > 0) {
      patients = loadedPatients;
      console.log(`[Firestore] Synced successfully. Loaded ${patients.length} patients from cloud.`);
    } else {
      console.log("[Firestore] Cloud database is empty. Seeding initial fallback patients...");
      const initialPatients = [
        {
          id: "pat_1",
          name: "นางมณี รัตนมงคล",
          age: 78,
          condition: "ผู้ป่วยติดเตียง เป็นอัมพาตท่อนล่างตั้งแต่สะโพกลงไป มีแผลกดทับที่ต้องดูแลความสะอาดและพลิกตัว",
          equipment: ["เตียงพยาบาลไฟฟ้า", "ที่นอนลมป้องกันแผลกดทับ"],
          address: "142/9 หมู่ 2 ตำบลเชิงเนิน อำเภอเมือง ระยอง",
          contact: "081-345-6789 (ลูกสาว)",
          coordinates: { lat: 12.6845, lng: 101.2842 },
          priority: "CRITICAL",
          status: "NORMAL",
          lastUpdated: new Date().toISOString()
        },
        {
          id: "pat_2",
          name: "นายวิชัย สมบูรณ์ทรัพย์",
          age: 84,
          condition: "โรคปอดอุดกั้นเรื้อรัง (COPD) ระยะก้าวหน้า อ่อนแรงมาก ต้องพ่นยาขยายหลอดลมเป็นช่วงๆ",
          equipment: ["เครื่องพ่นยาขยายหลอดลม", "เครื่องดูดเสมหะไฟฟ้า"],
          address: "55/12 ถนนจันทอุดม ตำบลท่าประดู่ อำเภอเมือง ระยอง",
          contact: "089-765-4321 (คุณสมเกียรติ - หลาน)",
          coordinates: { lat: 12.6892, lng: 101.2785 },
          priority: "HIGH",
          status: "NORMAL",
          lastUpdated: new Date().toISOString()
        },
        {
          id: "pat_3",
          name: "ยายทองดี สมนึก",
          age: 81,
          condition: "กระดูกสะโพกหักจากการหกล้ม เคลื่อนไหวร่างกายไม่ได้ ช่วยเหลือตัวเองแทบไม่ได้",
          equipment: ["เครื่องผลิตออกซิเจน 5 ลิตร", "ที่นอนลมป้องกันแผลกดทับ"],
          address: "88 หมู่ 4 ตำบลเนินพระ อำเภอเมือง ระยอง",
          contact: "086-111-2222 (ลูกสะใภ้)",
          coordinates: { lat: 12.6781, lng: 101.2910 },
          priority: "MEDIUM",
          status: "NORMAL",
          lastUpdated: new Date().toISOString()
        }
      ];

      for (const p of initialPatients) {
        await setDoc(doc(db, "patients", p.id), p);
      }
      patients = initialPatients;
      console.log(`[Firestore] Successfully seeded ${patients.length} patients and loaded in-memory.`);
    }

    saveDBLocalFallback();
  } catch (err) {
    console.error("[Firestore] Initial load failed. Falling back to local/in-memory:", err);
  }
}

async function savePatientToFirestore(patient: any) {
  if (!db) return;
  try {
    await setDoc(doc(db, "patients", patient.id), patient);
    console.log(`[Firestore] Saved patient ${patient.id} / ${patient.name}`);
  } catch (err) {
    console.error(`[Firestore] Failed to save patient ${patient.id}:`, err);
  }
}

async function deletePatientFromFirestore(patientId: string) {
  if (!db) return;
  try {
    await deleteDoc(doc(db, "patients", patientId));
    console.log(`[Firestore] Deleted patient ${patientId}`);
  } catch (err) {
    console.error(`[Firestore] Failed to delete patient ${patientId}:`, err);
  }
}

async function saveSettingsToFirestore() {
  if (!db) return;
  try {
    await setDoc(doc(db, "settings", "globalState"), {
      plannedZone,
      isSimulationEnabled,
      lastUpdated,
      googleAccessToken,
      googleUserEmail,
      savedSpreadsheetId,
      googleAppsScriptUrl
    });
    console.log("[Firestore] Global settings saved to cloud.");
  } catch (err) {
    console.error("[Firestore] Failed to save global settings:", err);
  }
}

// WebSocket Server setups
const wss = new WebSocketServer({ noServer: true });

// Listen and Upgrade HTTP server requests on same port
server.on("upgrade", (request, socket, head) => {
  const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;
  if (pathname === "/ws") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

function broadcast(type: string, data: any) {
  const payload = JSON.stringify({ type, data });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

function broadcastFullState() {
  broadcast("STATE_SYNC", {
    patients,
    plannedZone,
    isSimulationEnabled,
    lastUpdated
  });
}

wss.on("connection", (ws) => {
  // Immediately send current sync state to the newly connected terminal
  ws.send(JSON.stringify({
    type: "STATE_SYNC",
    data: {
      patients,
      plannedZone,
      isSimulationEnabled,
      lastUpdated
    }
  }));

  ws.on("message", (message) => {
    try {
      const { type, action, data } = JSON.parse(message.toString());

      if (type === "ACTION") {
        lastUpdated = new Date().toISOString();
        const executeAction = async () => {
          switch (action) {
            case "ADD_PATIENT":
              patients = [data, ...patients];
              broadcastFullState();
              saveDBLocalFallback();
              await savePatientToFirestore(data);
              await saveSettingsToFirestore();
              syncToGoogleSheetsServerSide().catch(err => console.error("[WS ADD] Sheets sync failed:", err));
              break;
            case "UPDATE_PATIENT": {
              const updated = { ...data, lastUpdated: new Date().toISOString() };
              patients = patients.map(p => p.id === data.id ? { ...p, ...updated } : p);
              broadcastFullState();
              saveDBLocalFallback();
              await savePatientToFirestore(updated);
              await saveSettingsToFirestore();
              syncToGoogleSheetsServerSide().catch(err => console.error("[WS UPDATE] Sheets sync failed:", err));
              break;
            }
            case "DELETE_PATIENT":
              patients = patients.filter(p => p.id !== data.id);
              broadcastFullState();
              saveDBLocalFallback();
              await deletePatientFromFirestore(data.id);
              await saveSettingsToFirestore();
              syncToGoogleSheetsServerSide().catch(err => console.error("[WS DELETE] Sheets sync failed:", err));
              break;
            case "UPDATE_PLANNED_ZONE":
              plannedZone = { ...plannedZone, ...data };
              broadcastFullState();
              saveDBLocalFallback();
              await saveSettingsToFirestore();
              break;
            case "UPDATE_SIMULATION":
              isSimulationEnabled = !!data.isSimulationEnabled;
              broadcastFullState();
              saveDBLocalFallback();
              await saveSettingsToFirestore();
              break;
            default:
              break;
          }
        };
        executeAction().catch(e => console.error("Error executing action:", e));
      }
    } catch (err) {
      console.error("Failed to parse websocket message:", err);
    }
  });
});

// Outage Simulator Loop (Server-authoritative, runs 100% synchronised!)
setInterval(async () => {
  if (!isSimulationEnabled) return;
  if (Math.random() > 0.15) return; // 15% chance to disrupt one patient of normal status

  const normalPatients = patients.filter(p => p.status === "NORMAL");
  if (normalPatients.length === 0) return;

  const randomIndex = Math.floor(Math.random() * normalPatients.length);
  const targetId = normalPatients[randomIndex].id;
  const durationMinutes = Math.floor(Math.random() * 20) + 10;
  const restorationTime = new Date();
  restorationTime.setMinutes(restorationTime.getMinutes() + durationMinutes);

  let updatedTarget: any = null;
  patients = patients.map(p => {
    if (p.id === targetId) {
      updatedTarget = {
        ...p,
        status: "OUTAGE",
        outageStartTime: new Date().toISOString(),
        estimatedRestorationTime: restorationTime.toISOString(),
        lastUpdated: new Date().toISOString()
      };
      return updatedTarget;
    }
    return p;
  });

  lastUpdated = new Date().toISOString();
  broadcastFullState();
  saveDBLocalFallback();
  if (updatedTarget) {
    await savePatientToFirestore(updatedTarget);
    syncToGoogleSheetsServerSide().catch(err => console.error("[Sim Outage] Sheets sync failed:", err));
  }
  await saveSettingsToFirestore();
}, 15000);

// Server-Side Google Sheets Proxy Sync function
async function syncToGoogleSheetsServerSide() {
  if (!googleAccessToken || !savedSpreadsheetId) {
    console.log("[Server Google Sheets] Sync skipped: No token or spreadsheet ID configured on server.");
    return;
  }

  try {
    const spreadsheetId = savedSpreadsheetId;
    const accessToken = googleAccessToken;

    // 1. Get first sheet name
    const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`;
    const metaRes = await fetch(metaUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!metaRes.ok) {
      if (metaRes.status === 401) {
        console.warn("[Server Google Sheets] Unauthorized (401), resetting credentials.");
        googleAccessToken = null;
        googleUserEmail = null;
        return;
      }
      const errText = await metaRes.text();
      throw new Error(`Failed to fetch spreadsheet metadata: ${metaRes.status} ${metaRes.statusText} - ${errText}`);
    }

    const metaData: any = await metaRes.json();
    const sheetName = (metaData.sheets && metaData.sheets.length > 0)
      ? metaData.sheets[0].properties.title
      : 'Sheet1';

    // 2. Clear first A1:M1000
    const clearRange = `${sheetName}!A1:M1000`;
    const clearUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(clearRange)}:clear`;
    await fetch(clearUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
    });

    // 3. Headers and row values
    const headers = [
      'ID', 
      'ชื่อ-นามสกุล', 
      'อายุ', 
      'ระดับวิกฤตความปลอดภัย', 
      'สถานะกระแสไฟ', 
      'โรคประจำตัว/ข้อจำกัดพยาบาล', 
      'อุปกรณ์ช่วยเลี่ยงความเสี่ยง', 
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

    // 4. PUT updated patients data
    const putRange = `${sheetName}!A1`;
    const putUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(putRange)}?valueInputOption=USER_ENTERED`;
    const putRes = await fetch(putUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ values })
    });

    if (!putRes.ok) {
      const putErr = await putRes.text();
      throw new Error(`Failed to write to Google Sheets: ${putRes.status} ${putRes.statusText} - ${putErr}`);
    }

    console.log(`[Server Google Sheets] Successfully synced ${patients.length} patients to sheet '${sheetName}' in spreadsheet: ${spreadsheetId}`);
  } catch (err: any) {
    console.error("[Server Google Sheets] Sync failed:", err);
  }
}

// Google Sheets endpoints
app.post("/api/sheets/config", async (req, res) => {
  const { accessToken, email, spreadsheetId } = req.body;
  if (accessToken) googleAccessToken = accessToken;
  if (email) googleUserEmail = email;
  if (spreadsheetId) {
    const trimmed = spreadsheetId.trim();
    const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    savedSpreadsheetId = (match && match[1]) ? match[1] : trimmed;
  }

  await saveSettingsToFirestore();
  saveDBLocalFallback();

  console.log(`[Google Sheets API Config] Connected by ${googleUserEmail} on sheet ID ${savedSpreadsheetId}`);
  
  // Trigger immediate write sync
  syncToGoogleSheetsServerSide().catch(err => console.error("Initial sheets sync failed:", err));

  res.json({ 
    success: true, 
    email: googleUserEmail, 
    spreadsheetId: savedSpreadsheetId 
  });
});

app.get("/api/sheets/status", (req, res) => {
  res.json({
    connected: !!googleAccessToken,
    email: googleUserEmail,
    spreadsheetId: savedSpreadsheetId,
    patientsCount: patients.length
  });
});

app.post("/api/sheets/disconnect", async (req, res) => {
  googleAccessToken = null;
  googleUserEmail = null;
  await saveSettingsToFirestore();
  saveDBLocalFallback();
  res.json({ success: true });
});

// Google Apps Script Proxy and Config endpoints
app.post("/api/sheets/apps-script-config", async (req, res) => {
  const { url } = req.body;
  googleAppsScriptUrl = url || "";
  await saveSettingsToFirestore();
  saveDBLocalFallback();
  res.json({ success: true, url: googleAppsScriptUrl });
});

app.get("/api/sheets/apps-script-status", (req, res) => {
  res.json({ url: googleAppsScriptUrl });
});

app.get("/api/sheets/apps-script-proxy", async (req, res) => {
  const { url } = req.query;
  const targetUrl = url || googleAppsScriptUrl;
  if (!targetUrl) return res.status(400).json({ error: "Missing Google Apps Script Web App URL" });
  try {
    const rawRes = await fetch(targetUrl as string);
    if (!rawRes.ok) throw new Error(`Google Web App returned status ${rawRes.status}`);
    const data = await rawRes.json();
    res.json(data);
  } catch (err: any) {
    console.error("[Apps Script Proxy GET] failed:", err);
    res.status(500).json({ error: err.message || "Failed to contact Apps Script Web App" });
  }
});

app.post("/api/sheets/apps-script-proxy", async (req, res) => {
  const { url, patients: clientPatients } = req.body;
  const targetUrl = url || googleAppsScriptUrl;
  if (!targetUrl) return res.status(400).json({ error: "Missing Google Apps Script Web App URL" });
  try {
    const response = await fetch(targetUrl as string, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ patients: clientPatients || patients })
    });
    const textData = await response.text();
    try {
      const jsonData = JSON.parse(textData);
      res.json(jsonData);
    } catch {
      res.json({ success: true, message: "Exported successfully!", rawResponse: textData });
    }
  } catch (err: any) {
    console.error("[Apps Script Proxy POST] failed:", err);
    res.status(500).json({ error: err.message || "Proxy connection to Web App failed" });
  }
});

app.post("/api/sheets/force-sync", async (req, res) => {
  if (!googleAccessToken) {
    return res.status(401).json({ error: "Google Sheets is not connected" });
  }
  try {
    await syncToGoogleSheetsServerSide();
    res.json({ success: true, message: "Google Sheets sync completed successfully." });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to force sync" });
  }
});

app.post("/api/sheets/import", async (req, res) => {
  if (!googleAccessToken) {
    return res.status(401).json({ error: "Google Sheets is not connected" });
  }

  try {
    const spreadsheetId = savedSpreadsheetId;
    const accessToken = googleAccessToken;

    // 1. Get first sheet name
    const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`;
    const metaRes = await fetch(metaUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!metaRes.ok) {
      throw new Error(`Metadata error: ${metaRes.status}`);
    }

    const metaData: any = await metaRes.json();
    const sheetName = (metaData.sheets && metaData.sheets.length > 0)
      ? metaData.sheets[0].properties.title
      : 'Sheet1';

    // 2. Read values
    const queryRange = `${sheetName}!A1:M1000`;
    const getUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(queryRange)}`;
    const getRes = await fetch(getUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!getRes.ok) {
      throw new Error(`Data fetch error: ${getRes.status}`);
    }

    const data: any = await getRes.json();
    const rows = data.values;
    if (!rows || rows.length < 2) {
      return res.json({ success: true, patients: [] });
    }

    const headers = rows[0];
    const patientRows = rows.slice(1);

    const importedPatients = patientRows.map((row: any) => {
      // Find coordinates
      let lat = 12.6814;
      let lng = 101.2813;
      if (row[9] && row[10]) {
        lat = parseFloat(row[9]) || 12.6814;
        lng = parseFloat(row[10]) || 101.2813;
      }

      // Convert equipment string back to array
      const equipment = row[6] ? row[6].split('|').filter(Boolean) : [];

      return {
        id: row[0] || Math.random().toString(36).substring(2, 11),
        name: row[1] || '',
        age: parseInt(row[2]) || 0,
        priority: row[3] || 'LOW',
        status: row[4] || 'NORMAL',
        condition: row[5] || '',
        equipment: equipment,
        address: row[7] || '',
        contact: row[8] || '',
        coordinates: { lat, lng },
        lastUpdated: row[11] || new Date().toISOString()
      };
    });

    // Replace system state
    patients = importedPatients;
    
    // Save to Firestore & local
    if (db) {
      for (const p of patients) {
        await setDoc(doc(db, "patients", p.id), p);
      }
    }
    await saveSettingsToFirestore();
    saveDBLocalFallback();
    broadcastFullState();

    res.json({ success: true, patients: importedPatients });
  } catch (err: any) {
    console.error("[Server Google Sheets Import] failed:", err);
    res.status(500).json({ error: err.message || "Failed to import from Google Sheets" });
  }
});

// REST API to fetch full system state
app.get("/api/state", (req, res) => {
  res.json({
    patients,
    plannedZone,
    isSimulationEnabled,
    lastUpdated
  });
});

// REST API fallback for action syncing (highly reliable fallback when WebSockets are unstable or blocked)
app.post("/api/actions", async (req, res) => {
  const { action, data } = req.body;
  if (!action) {
    return res.status(400).json({ error: "Action is required" });
  }

  try {
    lastUpdated = new Date().toISOString();
    switch (action) {
      case "ADD_PATIENT":
        patients = [data, ...patients];
        await savePatientToFirestore(data);
        syncToGoogleSheetsServerSide().catch(err => console.error("[REST ADD] Sheets sync failed:", err));
        break;
      case "UPDATE_PATIENT": {
        const updated = { ...data, lastUpdated: new Date().toISOString() };
        patients = patients.map(p => p.id === data.id ? { ...p, ...updated } : p);
        await savePatientToFirestore(updated);
        syncToGoogleSheetsServerSide().catch(err => console.error("[REST UPDATE] Sheets sync failed:", err));
        break;
      }
      case "DELETE_PATIENT":
        patients = patients.filter(p => p.id !== data.id);
        await deletePatientFromFirestore(data.id);
        syncToGoogleSheetsServerSide().catch(err => console.error("[REST DELETE] Sheets sync failed:", err));
        break;
      case "UPDATE_PLANNED_ZONE":
        plannedZone = { ...plannedZone, ...data };
        break;
      case "UPDATE_SIMULATION":
        isSimulationEnabled = !!data.isSimulationEnabled;
        break;
      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    await saveSettingsToFirestore();
    saveDBLocalFallback();
    broadcastFullState();
    return res.json({ success: true, message: `Action ${action} executed, saved to cloud, and broadcasted successfully.` });
  } catch (err: any) {
    console.error("Failed to execute REST API action:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// REST API to restore whole database from client backup (robust peer persistence)
app.post("/api/restore", async (req, res) => {
  const { patients: clientPatients, plannedZone: clientPlannedZone, isSimulationEnabled: clientSim, lastUpdated: clientLastUpdated } = req.body;
  
  if (!clientPatients || !clientLastUpdated) {
    return res.status(400).json({ error: "Invalid backup data" });
  }

  const clientTime = new Date(clientLastUpdated).getTime();
  const serverTime = new Date(lastUpdated).getTime();

  // Accept restore if client timestamp is actually newer
  if (clientTime > serverTime) {
    console.log(`[RESTORE] Restoring database due to newer client timestamp. Server: ${lastUpdated}, Client: ${clientLastUpdated}`);
    patients = clientPatients;
    if (clientPlannedZone) plannedZone = clientPlannedZone;
    if (clientSim !== undefined) isSimulationEnabled = !!clientSim;
    lastUpdated = clientLastUpdated;

    try {
      // Re-seed all patients in Firestore if available
      if (db) {
        for (const p of patients) {
          await setDoc(doc(db, "patients", p.id), p);
        }
      }
      await saveSettingsToFirestore();
      saveDBLocalFallback();
      broadcastFullState();
      return res.json({ success: true, message: "Database state restored successfully." });
    } catch (err) {
      console.error("[RESTORE] Failed to restore to cloud database:", err);
      return res.status(500).json({ error: "Failed to restore content to Firestore" });
    }
  } else {
    return res.json({ success: false, message: "Server database is already up-to-date.", serverLastUpdated: lastUpdated });
  }
});

// API for AI Assessment (Proxied safely from server to keep keys secure)
app.post("/api/assess", async (req, res) => {
  const { condition, equipment } = req.body;
  if (!condition) {
    return res.status(400).json({ error: "Condition is required" });
  }

  const getFallback = () => {
    let priority = "LOW";
    let reason = "ระบบคำนวณสัญลักษณ์ความเสี่ยงปฐมภูมิตามข้อมูลอุปกรณ์ช่วยพยุงชีพของท่าน";
    const eqStr = (equipment || []).join(' ').toLowerCase();
    const condStr = condition.toLowerCase();
    
    if (eqStr.includes('ventilator') || eqStr.includes('ช่วยหายใจ') || condStr.includes('เครื่องช่วยหายใจ')) {
      priority = "CRITICAL";
      reason = "ตรวจพบความจำเป็นเร่งด่วนในการทำงานของเครื่องช่วยหายใจพยุงชีวิต";
    } else if (eqStr.includes('oxygen') || eqStr.includes('ออกซิเจน') || eqStr.includes('suction') || eqStr.includes('เสมหะ')) {
      priority = "HIGH";
      reason = "พิจารณาจากการใช้อุปกรณ์พ่นออกซิเจนหรือดูดเสมหะที่มีความเสี่ยงสูงเมื่อไฟดับ";
    } else if (eqStr.includes('เตียง') || eqStr.includes('ที่นอนลม')) {
      priority = "MEDIUM";
      reason = "ต้องการใช้เครื่องปรับอากาศควบคุมอุณหภูมิหรือเตียงพยาบาลไฟฟ้า";
    }
    return { priority, reason };
  };

  const ai = getAI();
  if (!ai) {
    return res.json(getFallback());
  }

  const prompt = `ประเมินระดับความสำคัญของผู้ป่วยติดเตียงสำหรับหน่วยงานไฟฟ้า (PEA) 
  โดยพิจารณาจากอาการ: ${condition} และอุปกรณ์ที่ใช้: ${equipment ? equipment.join(', ') : 'ไม่มี'}
  ระดับความสำคัญ: CRITICAL (วิกฤต - ต้องใช้ไฟฟ้าตลอดเวลาเพื่อพยุงชีพ), HIGH (สูง - มีอุปกรณ์สำคัญแต่มีแบตสำรองสั้นๆ), MEDIUM (ปานกลาง), LOW (ต่ำ)
  ตอบกลับเป็น JSON ภาษาไทย`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            priority: { type: Type.STRING, description: "CRITICAL, HIGH, MEDIUM, or LOW" },
            reason: { type: Type.STRING, description: "เหตุผลสั้นๆ ในการจัดระดับ" }
          },
          required: ["priority", "reason"]
        }
      }
    });

    res.json(JSON.parse(response.text));
  } catch (err: any) {
    console.error("AI Server-side Assessment failed:", err);
    res.json(getFallback());
  }
});

// Start integration with Vite/Production Server Assets
async function configureServer() {
  // Load from Firestore in the background so it doesn't block prompt port listening & dev server startup
  loadDBFromFirestore().catch((err) => {
    console.error("[Firestore] Background startup sync failed:", err);
  });

  if (process.env.NODE_ENV !== "production") {
    // Development mode
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production mode
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server fully boots and listens on port ${PORT}`);
  });
}

configureServer();
