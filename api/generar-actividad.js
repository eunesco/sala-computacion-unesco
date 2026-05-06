const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

function cleanJsonText(text) {
  return String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function buildPrompt(values) {
  return `
Eres un asistente pedagógico para la Escuela Unesco "Educar para la Paz".
Genera una planificación formal para una actividad en sala de computación.

Datos:
- Profesor/a: ${values.teacher}
- Curso: ${values.course}
- Asignatura: ${values.subject}
- OA: ${values.oa}
- Duración: ${values.duration || "60 minutos"}
- Actividad base sugerida: ${values.name || ""}
- Tipo sugerido: ${values.type || ""}
- Producto esperado sugerido: ${values.product || ""}

Reglas:
- Debe ser concreto, escolar y aplicable en sala de computación.
- Debe proponer una actividad específica, no decir "recurso que indique el profesor".
- Inicio dura 10 minutos, desarrollo 40 minutos, cierre 10 minutos.
- La guía debe ser clara para estudiantes y terminar con "Autoevaluación y metacognición".
- La rúbrica debe ir separada y tener al menos 4 criterios con 3 niveles.
- Usa HTML simple en los campos largos: p, ul, ol, li, table, tr, th, td, strong.
- No incluyas markdown ni texto fuera del JSON.
- No puedes generar la misma actividad para el objetivo al presionar inmediatamente generar en ese mismo objetivo.

Devuelve SOLO un JSON válido con esta forma:
{
  "plan": {
    "name": "string",
    "type": "string",
    "difficulty": "Básico | Intermedio | Avanzado",
    "objective": "string",
    "materials": "html",
    "start": "html",
    "development": "html",
    "closure": "html",
    "product": "string",
    "criteria": "html",
    "formative": "html",
    "guide": "html",
    "rubric": "html",
    "observations": "string"
  }
}
`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método no permitido." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: "Gemini no está configurado. Falta la variable de entorno GEMINI_API_KEY en Vercel.",
    });
  }

  try {
    const { values } = req.body || {};
    if (!values || !values.course || !values.subject || !values.oa) {
      return res.status(400).json({ error: "Faltan datos de la actividad." });
    }

    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const response = await fetch(`${GEMINI_ENDPOINT}/${model}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: buildPrompt(values) }],
          },
        ],
        generationConfig: {
          temperature: 0.65,
          responseMimeType: "application/json",
        },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || "Gemini no pudo generar la actividad.",
      });
    }

    const text = (data.candidates?.[0]?.content?.parts || [])
      .map(part => part.text || "")
      .join("")
      .trim();

    const parsed = JSON.parse(cleanJsonText(text));
    if (!parsed.plan) {
      return res.status(502).json({ error: "Gemini respondió sin plan válido." });
    }

    return res.status(200).json({ plan: parsed.plan, source: "gemini" });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Error interno generando actividad con Gemini.",
    });
  }
};
