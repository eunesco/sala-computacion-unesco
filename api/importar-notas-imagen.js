const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

function cleanJsonText(text) {
  return String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function splitDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

function normalizeGrade(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 10 && number <= 70 ? number : null;
}

function buildPrompt({ course, subject, teacher, gradeSlots, students }) {
  const studentLines = (students || [])
    .map(student => `- id: ${student.id} | nombre: ${student.name} | run: ${student.run || ""}`)
    .join("\n");

  return `
Eres un asistente de transcripcion para una escuela chilena.
Tu tarea es leer una fotografia de un libro de clases o planilla de notas y proponer notas para la planilla digital.

Contexto:
- Curso: ${course}
- Asignatura: ${subject}
- Profesor/a que carga la planilla: ${teacher}
- Cantidad maxima de columnas de notas: ${gradeSlots}

Reglas importantes:
- Las notas validas en Chile van de 10 a 70, sin decimales.
- No inventes notas. Si una nota no se ve con claridad, deja el espacio vacio.
- Usa la lista oficial de estudiantes para asociar las notas.
- Devuelve solo estudiantes para los que detectes al menos una nota o una coincidencia relevante.
- Si dudas entre dos estudiantes, usa el campo notes para advertirlo y baja la confidence.
- No guardes nada; solo devuelve una propuesta para revision humana.

Lista oficial de estudiantes:
${studentLines}

Devuelve SOLO un JSON valido, sin markdown, con esta forma:
{
  "summary": "breve resumen para el profesor",
  "rows": [
    {
      "studentId": "id exacto de la lista oficial si se reconoce",
      "studentName": "nombre detectado o nombre oficial",
      "grades": [10, 55, null, null, null, null, null, null],
      "confidence": 0-100,
      "notes": "advertencia opcional"
    }
  ]
}
`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Metodo no permitido." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: "Gemini no esta configurado. Falta la variable de entorno GEMINI_API_KEY en Vercel.",
    });
  }

  try {
    const { imageDataUrl, course, subject, teacher, gradeSlots = 8, students = [] } = req.body || {};
    const image = splitDataUrl(imageDataUrl);
    if (!image || !course || !subject || !students.length) {
      return res.status(400).json({ error: "Faltan la imagen, el curso, la asignatura o la nomina de estudiantes." });
    }

    const model = process.env.GEMINI_VISION_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash";
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
            parts: [
              { text: buildPrompt({ course, subject, teacher, gradeSlots, students }) },
              {
                inline_data: {
                  mime_type: image.mimeType,
                  data: image.data,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        },
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({
        error: data.error?.message || "Gemini no pudo leer la imagen.",
      });
    }

    const text = (data.candidates?.[0]?.content?.parts || [])
      .map(part => part.text || "")
      .join("")
      .trim();
    const parsed = JSON.parse(cleanJsonText(text));
    const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
    const normalizedRows = rows.map(row => ({
      studentId: row.studentId || "",
      studentName: row.studentName || "",
      grades: Array.from({ length: Number(gradeSlots) || 8 }, (_, index) => normalizeGrade((row.grades || [])[index])),
      confidence: Math.max(0, Math.min(100, Math.round(Number(row.confidence || 0)))),
      notes: row.notes || "",
    }));

    return res.status(200).json({
      summary: parsed.summary || "Propuesta generada. Revisa antes de aplicar.",
      rows: normalizedRows,
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Error interno leyendo la imagen de notas.",
    });
  }
};
