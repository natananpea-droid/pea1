import express from "express";
import path from "path";
import http from "http";
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

// Real-Time Shared Database State (In-Memory on the Server)
let patients: any[] = [];

let plannedZone = {
  center: { lat: 12.6814, lng: 101.2813 },
  radiusKm: 1.5,
  isActive: false
};

let isSimulationEnabled = true;

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
            broadcastFullState();
            break;
          case "UPDATE_PATIENT":
            patients = patients.map(p => p.id === data.id ? { ...p, ...data, lastUpdated: new Date().toISOString() } : p);
            broadcastFullState();
            break;
          case "DELETE_PATIENT":
            patients = patients.filter(p => p.id !== data.id);
            broadcastFullState();
            break;
          case "UPDATE_PLANNED_ZONE":
            plannedZone = { ...plannedZone, ...data };
            broadcastFullState();
            break;
          case "UPDATE_SIMULATION":
            isSimulationEnabled = !!data.isSimulationEnabled;
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

  broadcastFullState();
}, 15000);

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
