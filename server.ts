import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);
const isProduction = process.env.NODE_ENV === 'production';

app.use(express.json());

// Initialize Google GenAI client server-side
const apiKey = process.env.GEMINI_API_KEY;
let aiClient: GoogleGenAI | null = null;
if (apiKey) {
  aiClient = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Prefer a current stable Flash model, then use Google's maintained latest alias.
const CANDIDATE_MODELS = ['gemini-3.8-flash', 'gemini-flash-latest'];

async function generateWithFallback(options: {
  contents: any;
  config?: any;
}) {
  if (!aiClient) throw new Error('Gemini API client not configured with GEMINI_API_KEY');
  let lastError: any = null;
  for (const model of CANDIDATE_MODELS) {
    try {
      const response = await aiClient.models.generateContent({
        model,
        contents: options.contents,
        config: options.config,
      });
      return response;
    } catch (err: any) {
      console.warn(`Model ${model} unavailable: ${err.message}. Trying next candidate model...`);
      const status = Number(err?.status ?? err?.code);
      if (status === 429 || /quota exceeded|resource_exhausted/i.test(String(err?.message ?? ''))) {
        throw err;
      }
      lastError = err;
    }
  }
  throw lastError || new Error('All Gemini candidate models failed');
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    geminiConfigured: !!aiClient,
    timestamp: new Date().toISOString(),
  });
});

// AI Recommendation Explanation endpoint
app.post('/api/recommendation', async (req, res) => {
  try {
    const { forecast, metrics, decisions } = req.body;

    if (!forecast || !metrics || !decisions) {
      return res.status(400).json({ error: 'Missing optimization payload' });
    }

    if (!aiClient) {
      return res.status(503).json({
        error: 'Gemini API client not configured with GEMINI_API_KEY',
      });
    }

    const promptText = `
You are an expert renewable energy system analyst reviewing the output of a deterministic constraint-aware appliance optimizer for a rooftop-solar household.

CRITICAL RULES:
1. You must strictly ground all statements in the supplied numbers.
2. DO NOT recalculate or modify energy values, schedules, percentages, or cost figures.
3. DO NOT invent new appliances or override any decision.
4. If no appliances were shifted, clearly explain why maintaining the normal schedule is the optimal decision.
5. Clearly articulate:
   - What changed vs what stayed fixed
   - How solar peak hours and available surplus drove each shifting decision
   - The reduction in grid import and improvement in solar self-consumption
   - The forecast confidence assessment and cloud condition context
   - Practical guidance for the homeowner (e.g., using appliance delay timers)

OPTIMIZER OUTPUT DATA:
Location: ${forecast.location}
Date: ${forecast.date}
Forecasted Solar Total: ${forecast.totalSolarGenerationKWh} kWh (Confidence interval: ${forecast.confidenceLowerTotal} - ${forecast.confidenceUpperTotal} kWh)
Forecast Confidence: ${forecast.forecastConfidence}
Midday Solar Window: ${forecast.usefulWindow.startHour}:00 - ${forecast.usefulWindow.endHour}:00 (Peak ${forecast.usefulWindow.peakKW} kW)
Weather context: ${forecast.weatherSummary}

SIMULATION IMPACT:
- Solar self-consumption: ${metrics.normalSelfConsumptionPct}% -> ${metrics.optimizedSelfConsumptionPct}% (+${metrics.selfConsumptionGainPctPoints}% points)
- Grid import: ${metrics.normalGridImportKWh} kWh -> ${metrics.optimizedGridImportKWh} kWh (${metrics.gridReductionKWh} kWh avoided)
- Potential cost impact: ₹${metrics.potentialCostImpactINR}
- CO2 emissions avoided: ${metrics.co2AvoidedKg} kg
- Shifted appliances: ${metrics.shiftedCount} of ${metrics.totalCount}

APPLIANCE DECISIONS:
${JSON.stringify(decisions, null, 2)}
`;

    const response = await generateWithFallback({
      contents: promptText,
      config: {
        systemInstruction:
          'You are a clear, objective solar optimization advisor for households. Never compute or fabricate energy or monetary numbers. Always explain the decisions made by the optimizer faithfully.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            headline: {
              type: Type.STRING,
              description: 'Short headline summarizing the optimization outcome (e.g., "Shifted 3 appliances to 11am-2pm solar peak")',
            },
            summaryParagraph: {
              type: Type.STRING,
              description: 'A 2-3 sentence overview explaining how solar self-consumption improved and grid import was reduced.',
            },
            keyInsights: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '3-4 concise bullet points explaining specific appliance movements or reasons for keeping fixed.',
            },
            actionableGuidance: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '2-3 practical steps for the household (e.g., programming delay timer on washing machine, running during recommended solar window).',
            },
            confidenceAssessment: {
              type: Type.STRING,
              description: 'Assessment of forecast reliability based on forecasted weather and confidence bounds.',
            },
          },
          required: ['headline', 'summaryParagraph', 'keyInsights', 'actionableGuidance', 'confidenceAssessment'],
        },
      },
    });

    const jsonText = response.text?.trim() || '{}';
    const parsed = JSON.parse(jsonText);

    return res.json({ explanation: parsed });
  } catch (error: any) {
    console.error('Gemini recommendation error:', error);
    return res.status(500).json({ error: error.message || 'Error generating explanation' });
  }
});

// Dedicated Solar AI Assistant endpoint
app.post('/api/assistant', async (req, res) => {
  try {
    const { question, context, history } = req.body;

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'Missing question' });
    }

    if (!aiClient) {
      return res.status(503).json({
        error: 'Gemini API client not configured with GEMINI_API_KEY',
      });
    }

    const systemPrompt = `You are a solar energy assistant for this specific household. Only answer questions about solar generation, household electricity demand, this household’s energy schedule, appliances, tariffs, or energy savings. If the user asks something unrelated to solar/energy, politely redirect them back to solar topics instead of answering.

STRICT GUIDELINES:
1. DIRECT & ACCURATE: Answer the specific question directly without unnecessary filler, repetitive preambles, or conversational fluff.
2. NO REPETITION: Do NOT repeat previously stated points or regurgitate the same answers. Give fresh, specific details tailored to what was asked.
3. CONCISE LENGTH: Keep responses to 2–4 informative sentences or 3–4 punchy bullet points. Avoid walls of text.
5. HOUSEHOLD CONTEXT: Use the supplied solar forecast and home configuration only when the user asks about their own system, forecast, or schedule. Do NOT mention household numbers or appliances for general solar questions.
6. DATA ACCURACY: Treat the supplied context as authoritative app data. Do not invent missing forecast values, local weather, or system details. If the context does not contain an answer, say what information is missing.
7. HOUSEHOLD CONTEXT: Use the provided forecast, 24-hour demand profiles, optimized appliance schedule, and tariff data whenever they help answer the user's question.
8. SCOPE: If a question is unrelated to solar generation or household energy, do not answer it. Politely redirect the user to solar and household-energy topics.
`;

    // Construct prompt with optional recent conversation turns
    let conversation = '';
    if (Array.isArray(history) && history.length > 0) {
      const recentHistory = history.slice(-4).map((h: any) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.text}`).join('\n');
      conversation = `Recent conversation:\n${recentHistory}\n\nUser: ${question}`;
    } else {
      conversation = question;
    }

    const contents = `SOLAR HOUSEHOLD AND FORECAST CONTEXT (JSON; may be incomplete):\n${JSON.stringify(context ?? {})}\n\n${conversation}`;

    const response = await generateWithFallback({
      contents,
      config: {
        systemInstruction: systemPrompt,
      },
    });

    const reply = response.text?.trim() || 'I could not generate an answer right now.';
    return res.json({ answer: reply });
  } catch (error: any) {
    console.error('Assistant API error:', error);
    const status = Number(error?.status ?? error?.code);
    const quotaExceeded = status === 429 || /quota exceeded|resource_exhausted/i.test(String(error?.message ?? ''));
    return res.status(quotaExceeded ? 429 : 500).json({ error: error.message || 'Error generating assistant answer' });
  }
});

// Setup Vite dev server or static serve
async function startServer() {
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      // Avoid Rolldown bundling Tailwind's Windows native .node dependency.
      configLoader: 'runner',
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Solar Optimizer Server listening on http://0.0.0.0:${port} (production: ${isProduction})`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
