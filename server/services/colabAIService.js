const { isConfigured, getFeatureConfig } = require('../config/colabAI');

class ColabAIService {
  constructor() {
    this.initialized = false;
    this.client = null;
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000;
    this.maxCacheSize = 100;
  }

  async initialize() {
    if (this.initialized) return true;
    if (!isConfigured()) {
      console.warn('Colab AI: Not configured. Running in fallback mode.');
      return false;
    }
    try {
      this.client = this._createClient();
      this.initialized = true;
      console.log('Colab AI: Initialized successfully');
      return true;
    } catch (error) {
      console.error('Colab AI: Initialization failed:', error.message);
      return false;
    }
  }

  _createClient() {
    const { COLAB_CONFIG } = require('../config/colabAI');
    return {
      endpoint: COLAB_CONFIG.apiEndpoint,
      projectId: COLAB_CONFIG.projectId,
      region: COLAB_CONFIG.region,
      timeout: COLAB_CONFIG.timeout,
    };
  }

  async _makeRequest(endpoint, payload) {
    if (!this.initialized) throw new Error('Colab AI Service not initialized');
    const { COLAB_CONFIG } = require('../config/colabAI');

    const url = `${this.client.endpoint}/${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${COLAB_CONFIG.apiKey}`,
      'X-Project-ID': COLAB_CONFIG.projectId,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.client.timeout),
      });
      if (!response.ok) throw new Error(`API request failed: ${response.status}`);
      return await response.json();
    } catch (error) {
      console.error(`Colab AI request to ${endpoint} failed:`, error.message);
      throw error;
    }
  }

  async generateText(prompt, options = {}) {
    const { COLAB_CONFIG } = require('../config/colabAI');
    const payload = {
      model: options.model || COLAB_CONFIG.models?.textGeneration || 'gemini-pro',
      prompt,
      temperature: options.temperature || 0.7,
      maxTokens: options.maxTokens || 1024,
      topP: options.topP || 0.9,
    };

    const cacheKey = JSON.stringify(payload);
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, cached);
      return cached.data;
    }

    try {
      const response = await this._makeRequest('generate', payload);
      const result = response.text || response.content || '';

      if (this.cache.size >= this.maxCacheSize) {
        const oldestKey = this.cache.keys().next().value;
        this.cache.delete(oldestKey);
      }
      this.cache.set(cacheKey, { timestamp: Date.now(), data: result });
      return result;
    } catch {
      return this._fallbackGenerate(prompt, options);
    }
  }

  _fallbackGenerate() {
    return JSON.stringify({ fallback: true, message: 'AI service temporarily unavailable', suggestions: [] });
  }

  async analyzePlaylistPrompt(prompt, context = {}) {
    const featureConfig = getFeatureConfig('playlistGeneration');
    if (!featureConfig.enabled || !this.initialized) {
      return this._fallbackPlaylistAnalysis(prompt);
    }

    const systemPrompt = `You are a music curator AI. Analyze the user's playlist request and extract:
1. Mood/energy level (1-10)
2. Genres that match the request
3. Tempo preference (slow/medium/fast)
4. Era preference (decade or range)
5. Special attributes (instrumental, live, acoustic, etc.)
6. Keywords for search

User's listening history: ${JSON.stringify(context.history || [])}
User's favorite genres: ${JSON.stringify(context.favoriteGenres || [])}

Respond in JSON format with:
{ "mood": { "name": "string", "energy": number }, "genres": ["string"], "tempo": "string", "era": { "start": number, "end": number }, "attributes": ["string"], "keywords": ["string"], "songCount": number, "description": "string" }`;

    try {
      const response = await this.generateText(`${systemPrompt}\n\nUser request: "${prompt}"`, { temperature: 0.5 });
      return this._parsePlaylistAnalysis(response, prompt);
    } catch {
      return this._fallbackPlaylistAnalysis(prompt);
    }
  }

  _parsePlaylistAnalysis(response, originalPrompt) {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch { /* parse failed */ }
    return this._fallbackPlaylistAnalysis(originalPrompt);
  }

  _fallbackPlaylistAnalysis(prompt) {
    const promptLower = prompt.toLowerCase();
    const analysis = {
      mood: { name: 'neutral', energy: 5 },
      genres: [],
      tempo: 'medium',
      era: { start: 1960, end: 2026 },
      attributes: [],
      keywords: prompt.split(/\s+/).filter(w => w.length > 3),
      songCount: 10,
      description: `Playlist based on: ${prompt}`,
    };

    const moodPatterns = {
      happy: { keywords: ['happy', 'joy', 'upbeat', 'cheerful', 'fun'], energy: 7 },
      sad: { keywords: ['sad', 'melancholy', 'blue', 'heartbreak'], energy: 3 },
      energetic: { keywords: ['workout', 'energy', 'pump', 'power', 'gym', 'run'], energy: 9 },
      chill: { keywords: ['chill', 'relax', 'calm', 'peaceful', 'zen', 'sleep'], energy: 2 },
      party: { keywords: ['party', 'dance', 'club', 'celebration'], energy: 8 },
      focus: { keywords: ['focus', 'study', 'work', 'concentrate'], energy: 4 },
      romantic: { keywords: ['romantic', 'love', 'date', 'valentine'], energy: 5 },
    };

    for (const [mood, config] of Object.entries(moodPatterns)) {
      if (config.keywords.some(k => promptLower.includes(k))) {
        analysis.mood = { name: mood, energy: config.energy };
        break;
      }
    }

    const genrePatterns = {
      'Rock': ['rock', 'guitar', 'band'],
      'Hip Hop': ['hip hop', 'rap', 'beats', 'urban'],
      'Electronic': ['electronic', 'edm', 'techno', 'house', 'synth'],
      'Jazz': ['jazz', 'swing', 'blues'],
      'Classical': ['classical', 'orchestra', 'symphony', 'piano'],
      'Pop': ['pop', 'hits', 'mainstream', 'top 40'],
      'R&B': ['r&b', 'soul', 'rnb'],
      'Country': ['country', 'folk', 'acoustic'],
      'Metal': ['metal', 'heavy', 'thrash'],
      'Indie': ['indie', 'alternative', 'underground'],
    };

    for (const [genre, keywords] of Object.entries(genrePatterns)) {
      if (keywords.some(k => promptLower.includes(k))) analysis.genres.push(genre);
    }

    if (analysis.genres.length === 0) {
      const moodGenres = {
        happy: ['Pop', 'Rock'], sad: ['R&B', 'Indie'], energetic: ['Rock', 'Electronic', 'Hip Hop'],
        chill: ['Jazz', 'Electronic', 'Indie'], party: ['Electronic', 'Hip Hop', 'Pop'],
        focus: ['Classical', 'Electronic', 'Jazz'], romantic: ['R&B', 'Pop', 'Jazz'], neutral: ['Pop', 'Rock', 'Hip Hop'],
      };
      analysis.genres = moodGenres[analysis.mood.name] || moodGenres.neutral;
    }

    return analysis;
  }

  async getRecommendations(userContext, options = {}) {
    const featureConfig = getFeatureConfig('recommendations');
    if (!featureConfig.enabled || !this.initialized) {
      return this._fallbackRecommendations(userContext, options);
    }

    try {
      const response = await this.generateText(
        `Recommend music based on: recent plays: ${JSON.stringify(userContext.recentPlays || [])}, favorite artists: ${JSON.stringify(userContext.favoriteArtists || [])}, time: ${options.timeOfDay || 'unknown'}`,
        { temperature: 0.6 }
      );
      return this._parseRecommendations(response, userContext);
    } catch {
      return this._fallbackRecommendations(userContext, options);
    }
  }

  _parseRecommendations(response, userContext) {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch { /* parse failed */ }
    return this._fallbackRecommendations(userContext, {});
  }

  _fallbackRecommendations(userContext, options = {}) {
    const favoriteGenres = userContext.favoriteGenres || ['Pop', 'Rock'];
    const hour = new Date().getHours();
    let mood = 'neutral', energyLevel = 5;

    if (hour >= 6 && hour < 12) { mood = 'energetic'; energyLevel = 7; }
    else if (hour >= 12 && hour < 17) { mood = 'focus'; energyLevel = 5; }
    else if (hour >= 17 && hour < 21) { mood = 'chill'; energyLevel = 4; }
    else { mood = 'calm'; energyLevel = 3; }

    return {
      recommendations: [
        { type: 'genre', value: favoriteGenres[0], reason: 'Based on your listening history' },
        { type: 'mood', value: mood, reason: `Perfect for ${this._getTimeOfDay(hour)}` },
      ],
      searchQueries: favoriteGenres.map(g => g.toLowerCase()),
      genres: favoriteGenres,
      mood,
      energyLevel,
    };
  }

  _getTimeOfDay(hour) {
    if (hour >= 6 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 21) return 'evening';
    return 'night';
  }

  async detectMood(input, context = {}) {
    const featureConfig = getFeatureConfig('moodDetection');
    if (!featureConfig.enabled || !this.initialized) {
      return this._fallbackMoodDetection(input);
    }

    try {
      const response = await this.generateText(
        `Analyze the mood of: "${input}". Respond in JSON: { "mood": "string", "confidence": number, "energy": number, "valence": number, "suggestedGenres": ["string"], "playlistSuggestion": "string" }`,
        { temperature: 0.4 }
      );
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch { /* parse failed */ }

    return this._fallbackMoodDetection(input);
  }

  _fallbackMoodDetection(input) {
    const inputLower = input.toLowerCase();
    const moodIndicators = {
      happy: { keywords: ['happy', 'excited', 'great', 'amazing', 'wonderful', 'joy'], energy: 7, valence: 8, genres: ['Pop', 'Dance'] },
      sad: { keywords: ['sad', 'down', 'depressed', 'lonely', 'heartbroken'], energy: 3, valence: 2, genres: ['R&B', 'Indie'] },
      angry: { keywords: ['angry', 'frustrated', 'mad', 'annoyed'], energy: 8, valence: 3, genres: ['Rock', 'Metal'] },
      calm: { keywords: ['calm', 'peaceful', 'relaxed', 'chill', 'tired'], energy: 2, valence: 6, genres: ['Jazz', 'Ambient'] },
      motivated: { keywords: ['motivated', 'workout', 'gym', 'running', 'exercise'], energy: 9, valence: 7, genres: ['Electronic', 'Hip Hop'] },
    };

    for (const [mood, config] of Object.entries(moodIndicators)) {
      if (config.keywords.some(k => inputLower.includes(k))) {
        return { mood, confidence: 0.7, energy: config.energy, valence: config.valence, suggestedGenres: config.genres, suggestedActivities: [], playlistSuggestion: `${mood} vibes playlist` };
      }
    }

    return { mood: 'neutral', confidence: 0.5, energy: 5, valence: 5, suggestedGenres: ['Pop', 'Rock'], suggestedActivities: ['listening', 'discovering'], playlistSuggestion: 'Your daily mix' };
  }

  async semanticSearch(query, options = {}) {
    const featureConfig = getFeatureConfig('semanticSearch');
    if (!featureConfig.enabled || !this.initialized) {
      return this._fallbackSemanticSearch(query);
    }

    try {
      const response = await this.generateText(
        `Convert this music search to structured params: "${query}". Respond in JSON: { "searchTerms": ["string"], "genres": ["string"], "artists": ["string"], "moods": ["string"], "decades": ["string"], "filters": { "instrumental": boolean, "live": boolean } }`,
        { temperature: 0.3 }
      );
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch { /* parse failed */ }

    return this._fallbackSemanticSearch(query);
  }

  _fallbackSemanticSearch(query) {
    const queryLower = query.toLowerCase();
    const words = queryLower.split(/\s+/).filter(w => w.length > 2);
    return {
      searchTerms: words,
      genres: [], artists: [], moods: [], decades: [],
      filters: { instrumental: queryLower.includes('instrumental'), live: queryLower.includes('live'), explicit: false },
    };
  }

  async chat(message, conversationHistory = [], context = {}) {
    const featureConfig = getFeatureConfig('chatAssistant');
    if (!featureConfig.enabled || !this.initialized) {
      return this._fallbackChat(message);
    }

    try {
      const response = await this.generateText(
        `You are Hathor's music assistant. User's favorite genres: ${JSON.stringify(context.favoriteGenres || [])}. Previous: ${conversationHistory.map(m => `${m.role}: ${m.content}`).join('\n')}\n\nUser: ${message}`,
        { temperature: 0.7, maxTokens: 512 }
      );

      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
      } catch { /* not JSON */ }

      return { message: response, actions: [] };
    } catch {
      return this._fallbackChat(message);
    }
  }

  _fallbackChat(message) {
    const messageLower = message.toLowerCase();
    if (messageLower.includes('playlist')) return { message: 'I can help you create a playlist! Tell me what mood or activity you want music for.', actions: [] };
    if (messageLower.includes('recommend') || messageLower.includes('suggestion')) return { message: 'I\'d love to recommend some music! What are you in the mood for?', actions: [] };
    if (messageLower.includes('hello') || messageLower.includes('hi')) return { message: 'Hello! I\'m your Hathor music assistant. I can help you discover new music, create playlists, or find songs that match your mood.', actions: [] };
    return { message: 'I\'m here to help with all things music! Ask me to create playlists, find recommendations, or search for specific songs and artists.', actions: [] };
  }

  getStatus() {
    return {
      initialized: this.initialized,
      configured: isConfigured(),
      features: require('../config/colabAI').COLAB_CONFIG?.features || {},
      fallbackMode: !this.initialized,
    };
  }

  clearCache() {
    this.cache.clear();
  }
}

const colabAIService = new ColabAIService();
module.exports = colabAIService;
