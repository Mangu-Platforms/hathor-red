/**
 * OpenAI LLM Service
 * Hathor Red v2.0 - GPT-4o integration for intelligent music features
 */

import OpenAI from 'openai';
import { MoodAnalysis, PlaylistAnalysis, AIChatResponse, ChatMessage } from '../types';

let openai: OpenAI | null = null;
let isInitialized = false;

const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';

export async function initialize(): Promise<boolean> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('[LLM] OPENAI_API_KEY not set, running in fallback mode');
    return false;
  }

  try {
    openai = new OpenAI({ apiKey });
    // Quick validation call
    await openai.models.list();
    isInitialized = true;
    console.log('[LLM] OpenAI service initialized with model:', CHAT_MODEL);
    return true;
  } catch (error) {
    console.error('[LLM] Failed to initialize OpenAI:', error);
    return false;
  }
}

/**
 * Generate a playlist based on natural language prompt
 */
export async function generatePlaylist(
  prompt: string,
  userContext?: { favoriteGenres?: string[]; recentArtists?: string[] },
  songCount: number = 20
): Promise<PlaylistAnalysis> {
  if (!isInitialized || !openai) {
    return fallbackPlaylistAnalysis(prompt);
  }

  try {
    const contextStr = userContext
      ? `User context: favorite genres: ${userContext.favoriteGenres?.join(', ') || 'unknown'}, recent artists: ${userContext.recentArtists?.join(', ') || 'unknown'}.`
      : '';

    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        {
          role: 'system',
          content: `You are a music recommendation AI. Analyze the user's request and return a JSON object with these fields: name (playlist name), description, genres (array), moods (array), keywords (array), explanation. Keep it concise.`,
        },
        {
          role: 'user',
          content: `Create a playlist for: "${prompt}". ${contextStr} Return ${songCount} songs.`,
        },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 500,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('Empty response from OpenAI');

    const parsed = JSON.parse(content);
    return {
      name: parsed.name || `AI: ${prompt.slice(0, 40)}`,
      description: parsed.description || `AI-generated playlist for: ${prompt}`,
      genres: parsed.genres || [],
      moods: parsed.moods || [],
      keywords: parsed.keywords || [],
      explanation: parsed.explanation || '',
    };
  } catch (error) {
    console.error('[LLM] Playlist generation error:', error);
    return fallbackPlaylistAnalysis(prompt);
  }
}

/**
 * Detect mood from text input
 */
export async function detectMood(input: string): Promise<MoodAnalysis> {
  if (!isInitialized || !openai) {
    return fallbackMoodAnalysis(input);
  }

  try {
    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        {
          role: 'system',
          content: `Analyze the emotional tone and return JSON: { mood, energy (0-1), valence (0-1), genres[], description }`,
        },
        { role: 'user', content: input },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 300,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('Empty response');

    const parsed = JSON.parse(content);
    return {
      mood: parsed.mood || 'neutral',
      energy: clamp(parsed.energy, 0, 1),
      valence: clamp(parsed.valence, 0, 1),
      genres: parsed.genres || [],
      description: parsed.description || '',
    };
  } catch (error) {
    console.error('[LLM] Mood detection error:', error);
    return fallbackMoodAnalysis(input);
  }
}

/**
 * Chat with AI music assistant
 */
export async function chat(
  message: string,
  history: ChatMessage[] = [],
  context?: Record<string, unknown>
): Promise<AIChatResponse> {
  if (!isInitialized || !openai) {
    return {
      response: 'AI service is currently unavailable. Please try again later.',
    };
  }

  try {
    const messages: any[] = [
      {
        role: 'system',
        content: `You are Hathor, an AI music assistant. Help users discover music, create playlists, and learn about artists. Be concise and friendly.`,
      },
    ];

    if (context) {
      messages.push({
        role: 'system',
        content: `Context: ${JSON.stringify(context)}`,
      });
    }

    messages.push(...history.map(m => ({ role: m.role, content: m.content })));
    messages.push({ role: 'user', content: message });

    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages,
      max_tokens: 1000,
    });

    return {
      response: completion.choices[0]?.message?.content || 'No response',
    };
  } catch (error) {
    console.error('[LLM] Chat error:', error);
    return {
      response: 'Sorry, I encountered an error. Please try again.',
    };
  }
}

/**
 * Generate text embedding for vector search
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!isInitialized || !openai) {
    // Return mock embedding (deterministic for testing)
    return generateMockEmbedding(text);
  }

  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
    });

    return response.data[0]?.embedding || generateMockEmbedding(text);
  } catch (error) {
    console.error('[LLM] Embedding error:', error);
    return generateMockEmbedding(text);
  }
}

// Helpers
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function fallbackPlaylistAnalysis(prompt: string): PlaylistAnalysis {
  const lower = prompt.toLowerCase();
  const genres: string[] = [];
  
  if (lower.includes('rock')) genres.push('rock');
  if (lower.includes('pop')) genres.push('pop');
  if (lower.includes('jazz')) genres.push('jazz');
  if (lower.includes('classical')) genres.push('classical');
  if (lower.includes('electronic') || lower.includes('edm')) genres.push('electronic');
  if (lower.includes('hip hop') || lower.includes('rap')) genres.push('hip-hop');
  if (genres.length === 0) genres.push('pop', 'rock');

  return {
    name: `AI: ${prompt.slice(0, 40)}`,
    description: `AI-generated playlist for: ${prompt}`,
    genres,
    moods: [],
    keywords: prompt.split(' ').filter(w => w.length > 3),
    explanation: 'Generated using fallback mode (OpenAI not available)',
  };
}

function fallbackMoodAnalysis(input: string): MoodAnalysis {
  const lower = input.toLowerCase();
  let mood = 'neutral';
  let energy = 0.5;
  let valence = 0.5;

  if (lower.includes('happy') || lower.includes('excited')) {
    mood = 'happy';
    energy = 0.8;
    valence = 0.9;
  } else if (lower.includes('sad') || lower.includes('depressed')) {
    mood = 'sad';
    energy = 0.2;
    valence = 0.1;
  } else if (lower.includes('energetic') || lower.includes('pumped')) {
    mood = 'energetic';
    energy = 0.95;
    valence = 0.8;
  } else if (lower.includes('relaxed') || lower.includes('calm')) {
    mood = 'relaxed';
    energy = 0.2;
    valence = 0.7;
  }

  return { mood, energy, valence, genres: [], description: `Detected ${mood} mood` };
}

function generateMockEmbedding(text: string): number[] {
  // Deterministic mock embedding based on text hash
  const hash = text.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const embedding: number[] = [];
  for (let i = 0; i < 1536; i++) {
    embedding.push(Math.sin(hash + i * 0.1) * 0.5);
  }
  return embedding;
}