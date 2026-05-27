
import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export async function assessPatientPriority(condition: string, equipment: string[]): Promise<{ priority: string; reason: string }> {
  const prompt = `ประเมินระดับความสำคัญของผู้ป่วยติดเตียงสำหรับหน่วยงานไฟฟ้า (PEA/MEA) 
  โดยพิจารณาจากอาการ: ${condition} และอุปกรณ์ที่ใช้: ${equipment.join(', ')}
  ระดับความสำคัญ: CRITICAL (วิกฤต - ต้องใช้ไฟฟ้าตลอดเวลาเพื่อพยุงชีพ), HIGH (สูง - มีอุปกรณ์สำคัญแต่มีแบตสำรองสั้นๆ), MEDIUM (ปานกลาง), LOW (ต่ำ)
  ตอบกลับเป็น JSON ภาษาไทย`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            priority: { type: Type.STRING, description: 'CRITICAL, HIGH, MEDIUM, or LOW' },
            reason: { type: Type.STRING, description: 'เหตุผลสั้นๆ ในการจัดระดับ' }
          },
          required: ['priority', 'reason']
        }
      }
    });

    return JSON.parse(response.text);
  } catch (error) {
    console.error("AI Assessment failed:", error);
    return { priority: 'MEDIUM', reason: 'การประเมินผิดพลาด ใช้ค่าเริ่มต้น' };
  }
}
