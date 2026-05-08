import express from "express";
import cors from "cors";
import Anthropic from "@anthropic-ai/sdk";

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.get("/", (req, res) => res.json({ status: "ok" }));

// ─── Endpoint existente: análisis de facturas ────────────────────────────────
app.post("/api/analyze", async (req, res) => {
  const { base64, mediaType } = req.body;
  if (!base64 || !mediaType) return res.status(400).json({ error: "Faltan datos" });
  try {
    const isImg = mediaType.startsWith("image/");
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          isImg
            ? { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } }
            : { type: "document", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: `Analiza este documento. Responde SOLO en JSON sin markdown:
{"tipo":"","monto":null,"fecha":null,"vencimiento":null,"descripcion":"","categoria_sugerida":"","foco_sugerido":""}` }
        ]
      }]
    });
    const txt = msg.content?.find(c => c.type === "text")?.text || "";
    const parsed = JSON.parse(txt.replace(/```json|```/g, "").trim());
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Endpoint nuevo: parsear resumen de tarjeta de crédito ───────────────────
app.post("/api/parse-resumen", async (req, res) => {
  const { base64, mediaType } = req.body;
  if (!base64 || !mediaType) return res.status(400).json({ error: "Faltan datos" });
  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 8000,
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: mediaType, data: base64 } },
          { type: "text", text: `Sos un parser de resúmenes de tarjeta de crédito VISA ICBC Argentina.
Extraé TODAS las transacciones de consumo del resumen.

REGLAS:
- Incluir: todos los consumos con fecha DD.MM.AA y monto en pesos ARS
- Incluir reversiones/devoluciones con monto NEGATIVO (montos con - al final en el PDF)
- Excluir: SALDO ANTERIOR, SU PAGO EN PESOS, SU PAGO EN USD, TRANSFERENCIA DEUDA
- Excluir: líneas de separación (_______)
- Excluir: gastos cuyos pesos y dólares son iguales (gastos en USD puros que vienen en el próximo resumen)
- Para cuotas con formato "C.NN/MM": agregar "Cuota N/M" al final de la descripción
- Impuestos (INTERESES FINANCIACION, PUNIT, DB IVA, IIBB PERCEP, IVA RG, DB.RG, COMISION PAQUETE): incluir con categoria "impuesto_tarjeta"
- Si hay múltiples tarjetas adicionales en el mismo resumen, incluir todas las transacciones

Respondé SOLO con JSON válido, sin markdown, sin texto extra:
{
  "transacciones": [
    {
      "fecha": "YYYY-MM-DD",
      "descripcion": "nombre del comercio limpio",
      "monto_ars": 1234.56,
      "es_reversion": false,
      "categoria_sugerida": "comida|nafta|peajes|nube|seguro|supermercado|impuesto_tarjeta|ropa|otros"
    }
  ],
  "total_ars": 12345.67,
  "periodo": "MM/YYYY"
}` }
        ]
      }]
    });
    const txt = msg.content?.find(c => c.type === "text")?.text || "";
    const parsed = JSON.parse(txt.replace(/```json|```/g, "").trim());
    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend corriendo en puerto ${PORT}`));
