import express from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProd = process.env.NODE_ENV === 'production';
const PORT = 3000;

// Lazy initialization of Gemini client to prevent crash on startup if key is missing as per guidelines
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required. Please set it in the Secrets panel in the UI.');
    }
    aiClient = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

async function startServer() {
  const app = express();

  // Route to handle base64 image upload and intelligent rotation detection (simplified for speed & large volume)
  app.post('/api/ocr-rotate', express.json({ limit: '50mb' }), async (req: express.Request, res: express.Response) => {
    try {
      const { image, mimeType } = req.body;
      if (!image) {
         res.status(400).json({ error: 'Image base64 data is required' });
         return;
      }

      // Extract raw base64 data and mime type from base64 Data URL if needed
      let base64Data = image;
      let detectedMimeType = mimeType || 'image/jpeg';

      if (image.startsWith('data:')) {
        const match = image.match(/^data:([^;]+);base64,(.*)$/);
        if (match) {
          detectedMimeType = match[1];
          base64Data = match[2];
        }
      }

      const ai = getGeminiClient();

      const systemPrompt = `You are an expert image alignment assistant.
Analyze the uploaded image. Check if the printed text or contents in it is rotated (e.g., printed numbers, sticker labels, specifications, or documents).

1. Determine how many degrees CLOCKWISE the image needs to be rotated in order for the text/content to be perfectly right-side up, horizontal, and readable from left to right.
   - Allowed rotation values are precisely: 0, 90, 180, or 270 degrees.
   - Example 1: If text is vertical reading bottom-to-top, you need to rotate it 90 degrees CLOCKWISE. Return 90.
   - Example 2: If text is rotated right 270 degrees, you need to rotate it 270 degrees CLOCKWISE to restore it. Return 270.
   - Example 3: If text is upside down, you need to rotate 180 degrees CLOCKWISE. Return 180.
   - Example 4: If text is already correct, return 0.

2. Provide a very brief 1-sentence explanation of why (e.g., "Label text is rotated 90 degrees clockwise").`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: [
          {
            inlineData: {
              data: base64Data,
              mimeType: detectedMimeType,
            },
          },
          {
            text: "Analyze the rotation of this image and output JSON.",
          },
        ],
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            required: ['degreesToRotate', 'orientationExplanation'],
            properties: {
              degreesToRotate: {
                type: Type.INTEGER,
                description: 'The clockwise rotation angle in degrees (0, 90, 180, or 270) needed to make the image content right-side up.',
              },
              orientationExplanation: {
                type: Type.STRING,
                description: 'A very short explanation of the detected direction.',
              },
            },
          },
        },
      });

      const resultText = response.text;
      if (!resultText) {
        throw new Error('No content returned from Gemini API');
      }

      const data = JSON.parse(resultText);
       res.json(data);
       return;
    } catch (error: any) {
      console.error('Auto-Rotation analysis failed:', error);
       res.status(500).json({ error: error.message || 'Failed to analyze the image orientation' });
       return;
    }
  });

  // Serve static assets and handle routing
  if (isProd) {
    // In production, serve compiler dist static files
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req: express.Request, res: express.Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    // In development, hook up Vite dev server as middleware
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server environment: ${isProd ? 'production' : 'development'}`);
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
