import express from "express";
import path from "path";
import http from "http";
import fs from "fs";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

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

const DB_FILE = path.join(process.cwd(), "db.json");

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const content = fs.readFileSync(DB_FILE, "utf-8");
      const parsed = JSON.parse(content);
      if (parsed.patients) patients = parsed.patients;
      if (parsed.plannedZone) plannedZone = parsed.plannedZone;
      if (parsed.isSimulationEnabled !== undefined) isSimulationEnabled = parsed.isSimulationEnabled;
      console.log(`[DB] Loaded successfully with ${patients.length} patients.`);
    } else {
      // Setup mock / default patients if database is empty so the app has data initially
      patients = [
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
      saveDB();
      console.log("[DB] Created initial fallback DB configuration.");
    }
  } catch (err) {
    console.error("[DB] Failed to load database:", err);
  }
}

function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify({ patients, plannedZone, isSimulationEnabled }, null, 2), "utf-8");
  } catch (err) {
    console.error("[DB] Failed to save database:", err);
  }
}

// Immediately load database state at boot
loadDB();

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
    isSimulationEnabled
  });
}

wss.on("connection", (ws) => {
  // Immediately send current sync state to the newly connected terminal
  ws.send(JSON.stringify({
    type: "STATE_SYNC",
    data: {
      patients,
      plannedZone,
      isSimulationEnabled
    }
  }));

  ws.on("message", (message) => {
    try {
      const { type, action, data } = JSON.parse(message.toString());

      if (type === "ACTION") {
        switch (action) {
          case "ADD_PATIENT":
            patients = [data, ...patients];
            saveDB();
            broadcastFullState();
            break;
          case "UPDATE_PATIENT":
            patients = patients.map(p => p.id === data.id ? { ...p, ...data, lastUpdated: new Date().toISOString() } : p);
            saveDB();
            broadcastFullState();
            break;
          case "DELETE_PATIENT":
            patients = patients.filter(p => p.id !== data.id);
            saveDB();
            broadcastFullState();
            break;
          case "UPDATE_PLANNED_ZONE":
            plannedZone = { ...plannedZone, ...data };
            saveDB();
            broadcastFullState();
            break;
          case "UPDATE_SIMULATION":
            isSimulationEnabled = !!data.isSimulationEnabled;
            saveDB();
            broadcastFullState();
            break;
          default:
            break;
        }
      }
    } catch (err) {
      console.error("Failed to parse websocket message:", err);
    }
  });
});

// Outage Simulator Loop (Server-authoritative, runs 100% synchronised!)
setInterval(() => {
  if (!isSimulationEnabled) return;
  if (Math.random() > 0.15) return; // 15% chance to disrupt one patient of normal status

  const normalPatients = patients.filter(p => p.status === "NORMAL");
  if (normalPatients.length === 0) return;

  const randomIndex = Math.floor(Math.random() * normalPatients.length);
  const targetId = normalPatients[randomIndex].id;
  const durationMinutes = Math.floor(Math.random() * 20) + 10;
  const restorationTime = new Date();
  restorationTime.setMinutes(restorationTime.getMinutes() + durationMinutes);

  patients = patients.map(p => p.id === targetId ? {
    ...p,
    status: "OUTAGE",
    outageStartTime: new Date().toISOString(),
    estimatedRestorationTime: restorationTime.toISOString(),
    lastUpdated: new Date().toISOString()
  } : p);

  saveDB();
  broadcastFullState();
}, 15000);

// REST API to fetch full system state
app.get("/api/state", (req, res) => {
  res.json({
    patients,
    plannedZone,
    isSimulationEnabled
  });
});

// REST API fallback for action syncing (highly reliable fallback when WebSockets are unstable or blocked)
app.post("/api/actions", (req, res) => {
  const { action, data } = req.body;
  if (!action) {
    return res.status(400).json({ error: "Action is required" });
  }

  try {
    switch (action) {
      case "ADD_PATIENT":
        patients = [data, ...patients];
        break;
      case "UPDATE_PATIENT":
        patients = patients.map(p => p.id === data.id ? { ...p, ...data, lastUpdated: new Date().toISOString() } : p);
        break;
      case "DELETE_PATIENT":
        patients = patients.filter(p => p.id !== data.id);
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

    saveDB();
    broadcastFullState();
    return res.json({ success: true, message: `Action ${action} executed and broadcasted successfully.` });
  } catch (err: any) {
    console.error("Failed to execute REST API action:", err);
    return res.status(500).json({ error: "Internal server error" });
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
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server fully boots and listens on port ${PORT}`);
  });
}

configureServer();
