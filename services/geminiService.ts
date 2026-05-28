
export async function assessPatientPriority(condition: string, equipment: string[]): Promise<{ priority: string; reason: string }> {
  try {
    const response = await fetch("/api/assess", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ condition, equipment })
    });
    if (!response.ok) {
      throw new Error("HTTP request failed with status: " + response.status);
    }
    return await response.json();
  } catch (error) {
    console.error("AI Assessment proxy failed:", error);
    return { priority: 'MEDIUM', reason: 'ระบบเซิร์ฟเวอร์ขัดข้อง ใช้ค่าประมวลผลเบื้องต้น' };
  }
}
