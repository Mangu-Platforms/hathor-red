/**
 * Hathor Red v2.0 - TypeScript Type Definitions
 * Comprehensive types for all entities, API requests/responses, and socket events
 */

// ============================================================================
// CORE ENTITY TYPES
// ============================================================================

export type UserRole = 'listener' | 'artist' | 'admin' | 'moderator';
export type OAuthProvider = 'google' | 'spotify' | 'apple' | 'local';
export type SubscriptionTier = 'free' | 'supporter' | 'premium' | 'creator';
export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'unpaid';

export interface User {
  id: number;
  username: string;
  email: string;
  passwordHash?: string;
  displayName: string;
  avatarUrl?: string;
  role: UserRole;
  emailVerified: boolean;
  authProvider: OAuthProvider;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicUser {
  id: number;
  username: string;
  displayName: string;
  avatarUrl?: string;
  role: UserRole;
  createdAt: Date;
}

export interface Artist {
  id: number;
  name: string;
  bio?: string;
  imageUrl?: string;
  genres?: string[];
  spotifyId?: string;
  socialLinks?: Record<string, string>;
  verified: boolean;
  followerCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Album {
  id: number;
  title: string;
  artistId?: number;
  coverUrl?: string;
  releaseDate?: Date;
  totalTracks: number;
  albumType: 'album' | 'single' | 'ep';
  genres?: string[];
  createdAt: Date;
}

export interface Song {
  id: number;
  title: string;
  artist: string;
  artistId?: number;
  album?: string;
  albumId?: number;
  duration: number;
  filePath: string;
  coverUrl?: string;
  genre?: string;
  year?: number;
  bpm?: number;
  keySignature?: string;
  energy?: number;
  valence?: number;
  embeddings?: number[];
  playCount: number;
  uploadedBy?: number;
  createdAt: Date;
}

export interface Playlist {
  id: number;
  userId: number;
  name: string;
  description?: string;
  isAiGenerated: boolean;
  prompt?: string;
  isPublic: boolean;
  coverUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlaylistSong {
  id: number;
  playlistId: number;
  songId: number;
  position: number;
  addedAt: Date;
  song?: Song;
}

// ============================================================================
// LISTENING ROOM TYPES
// ============================================================================

export interface ListeningRoom {
  id: number;
  name: string;
  hostId: number;
  currentSongId?: number;
  currentPosition: number;
  isPlaying: boolean;
  isPublic: boolean;
  maxListeners: number;
  description?: string;
  theme: string;
  hasVideoChat: boolean;
  is3d: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoomParticipant {
  id: number;
  roomId: number;
  userId: number;
  joinedAt: Date;
}

export interface RoomMessage {
  id: number;
  roomId: number;
  userId?: number;
  username: string;
  message: string;
  messageType: 'chat' | 'system' | 'reaction';
  createdAt: Date;
}

export interface ChatMessage {
  userId: number;
  username: string;
  message: string;
  timestamp: number;
}

export interface UserPresence {
  userId: number;
  username: string;
  timestamp: number;
  status?: 'online' | 'away' | 'dnd' | 'invisible';
}

// ============================================================================
// AUTH TYPES
// ============================================================================

export interface JWTPayload {
  userId: number;
  username: string;
  role: UserRole;
  jti?: string;
  iat?: number;
  exp?: number;
  iss?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface RefreshToken {
  id: number;
  userId: number;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  revokedAt?: Date;
  ipAddress?: string;
  userAgent?: string;
}

export interface OAuthAccount {
  id: number;
  userId: number;
  provider: OAuthProvider;
  providerAccountId: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface OAuthProfile {
  id: string;
  email?: string;
  displayName?: string;
  photos?: { value: string }[];
  provider: OAuthProvider;
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
  displayName?: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  message: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: PublicUser;
}

export interface UpdateProfileRequest {
  displayName?: string;
  avatarUrl?: string;
}

export interface CreateSongRequest {
  title: string;
  artist: string;
  album?: string;
  duration: number;
  genre?: string;
  year?: number;
}

export interface SongResponse {
  song: Song;
}

export interface PlaylistResponse {
  playlist: Playlist;
  songs: Song[];
}

export interface CreateRoomRequest {
  name: string;
  description?: string;
  isPublic?: boolean;
  maxListeners?: number;
  theme?: string;
  hasVideoChat?: boolean;
}

export interface RoomResponse {
  room: ListeningRoom;
  participants: RoomParticipant[];
  messages?: RoomMessage[];
}

export interface APIError {
  error: string;
  message?: string;
  code?: string;
  requestId?: string;
  timestamp?: string;
}

// ============================================================================
// SEARCH TYPES
// ============================================================================

export interface SemanticSearchRequest {
  query: string;
  limit?: number;
  threshold?: number;
}

export interface HybridSearchRequest {
  query: string;
  genres?: string[];
  yearFrom?: number;
  yearTo?: number;
  limit?: number;
  vectorWeight?: number;
  textWeight?: number;
}

export interface SearchResultItem {
  song: Song;
  similarity?: number;
  textScore?: number;
  combinedScore?: number;
}

export interface HybridSearchResponse {
  results: SearchResultItem[];
  totalResults: number;
  query: string;
  timing: {
    embeddingMs?: number;
    vectorMs?: number;
    textMs?: number;
    totalMs: number;
  };
}

// ============================================================================
// AI SERVICE TYPES
// ============================================================================

export interface MoodAnalysis {
  mood: string;
  energy: number;
  valence: number;
  genres: string[];
  description: string;
  suggestedSongs?: Song[];
}

export interface PlaylistAnalysis {
  name: string;
  description: string;
  genres: string[];
  moods: string[];
  era?: { start: number; end: number };
  keywords: string[];
  explanation: string;
  songIds?: number[];
}

export interface AIPlaylistRequest {
  prompt: string;
  name?: string;
  songCount?: number;
  stream?: boolean;
}

export interface AIPlaylistResponse {
  message: string;
  playlist: Playlist;
  songs: Song[];
  analysis: PlaylistAnalysis;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AIChatRequest {
  message: string;
  conversationHistory?: ChatMessage[];
  context?: Record<string, unknown>;
  stream?: boolean;
}

export interface AIChatResponse {
  response: string;
  actions?: AIAction[];
}

export interface AIAction {
  type: 'search' | 'play' | 'create_playlist';
  params: Record<string, unknown>;
}

export interface AIJobStatus {
  status: 'pending' | 'processing' | 'complete' | 'failed';
  progress?: number;
  result?: unknown;
  error?: string;
}

// ============================================================================
// HLS STREAMING TYPES
// ============================================================================

export type QualityTier = '64k' | '128k' | '192k' | '256k' | '320k' | 'lossless';

export interface HLSVariant {
  bandwidth: number;
  resolution?: string;
  codec: string;
  qualityTier: QualityTier;
  manifestPath: string;
}

export interface HLSManifest {
  version: number;
  targetDuration: number;
  mediaSequence: number;
  playlistType: string;
  segments: HLSSegment[];
  variants?: HLSVariant[];
}

export interface HLSSegment {
  duration: number;
  url: string;
  sequence: number;
}

export interface TranscodeJob {
  id: number;
  songId: number;
  qualityTier: QualityTier;
  status: 'pending' | 'processing' | 'complete' | 'failed';
  progress: number;
  manifestPath?: string;
  segmentCount: number;
  errorMessage?: string;
  createdAt: Date;
  completedAt?: Date;
}

// ============================================================================
// SOCKET.IO TYPES
// ============================================================================

export interface RoomState {
  currentSongId?: number;
  position: number;
  isPlaying: boolean;
}

export interface RoomUpdate {
  action: 'play' | 'pause' | 'seek' | 'change-song';
  songId?: number;
  position: number;
  timestamp: number;
  controlledBy: string;
}

export interface RoomControlData {
  roomId: number;
  action: string;
  songId?: number;
  position?: number;
}

export interface ChatData {
  roomId: number;
  message: string;
}

export interface PlaybackState {
  currentSongId?: number;
  position: number;
  isPlaying: boolean;
  volume: number;
  playbackSpeed: number;
  pitchShift: number;
  stemsConfig: Record<string, boolean>;
}

export interface VideoSignal {
  roomId: number;
  userId: number;
  signal: RTCSessionDescriptionInit | RTCIceCandidateInit;
  targetUserId?: number;
}

export interface VideoJoinData {
  roomId: number;
  userId: number;
}

export interface ReactionData {
  roomId: number;
  messageId: number;
  emoji: string;
}

export interface ModerationData {
  roomId: number;
  targetUserId: number;
  action: 'kick' | 'mute' | 'unmute' | 'ban';
}

export interface QueueActionData {
  roomId: number;
  songId?: number;
  position?: number;
}

// WebRTC Types
export interface PeerConnection {
  userId: number;
  socketId: string;
  username: string;
  videoEnabled: boolean;
  audioEnabled: boolean;
  isScreenSharing: boolean;
}

// ============================================================================
// ANALYTICS TYPES
// ============================================================================

export type AnalyticsEventType = 
  | 'song_play' | 'song_skip' | 'song_complete' | 'song_like'
  | 'playlist_create' | 'playlist_add_song' | 'playlist_share'
  | 'room_join' | 'room_leave' | 'room_create'
  | 'search_query' | 'ai_request'
  | 'auth_login' | 'auth_register' | 'auth_oauth'
  | 'stream_start' | 'stream_quality_change';

export interface AnalyticsEvent {
  id: number;
  userId?: number;
  eventType: AnalyticsEventType;
  eventData: Record<string, unknown>;
  sessionId?: string;
  ipHash?: string;
  userAgentHash?: string;
  createdAt: Date;
}

export interface AnalyticsMetrics {
  totalPlays: number;
  uniqueListeners: number;
  avgSessionDuration: number;
  topGenres: { genre: string; count: number }[];
  topSongs: { songId: number; title: string; plays: number }[];
  activeRooms: number;
  aiRequests: number;
}

// ============================================================================
// CONFIG TYPES
// ============================================================================

export interface ServerConfig {
  port: number;
  nodeEnv: string;
  logLevel: string;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
  poolSize: number;
}

export interface RedisConfig {
  url: string;
  bullMqUrl: string;
}

export interface JWTConfig {
  secret: string;
  expire: string;
  refreshExpire: string;
}

export interface AIConfig {
  openaiApiKey?: string;
  chatModel: string;
  embeddingModel: string;
  maxTokens: number;
  temperature: number;
}

export interface OAuthConfig {
  googleClientId?: string;
  googleClientSecret?: string;
  spotifyClientId?: string;
  spotifyClientSecret?: string;
}

export interface StorageConfig {
  uploadDir: string;
  maxFileSize: number;
  hlsOutputDir: string;
}

export interface FeatureFlags {
  hlsStreaming: boolean;
  stemSeparation: boolean;
  vectorSearch: boolean;
  llmPlaylist: boolean;
  webRTCVideo: boolean;
  analytics: boolean;
  oauth: boolean;
  otel: boolean;
}

// ============================================================================
// PAGINATION & UTILITIES
// ============================================================================

export interface PaginationParams {
  page?: number;
  limit?: number;
  offset?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface HealthCheckResponse {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  uptime: number;
  version: string;
  checks: Record<string, {
    status: 'healthy' | 'unhealthy' | 'not_configured';
    responseTime?: number;
    details?: Record<string, unknown>;
  }>;
}

export interface StreamRequest {
  songId: number;
  quality?: QualityTier;
  range?: string;
}

export interface StreamResponse {
  url: string;
  contentType: string;
  contentLength?: number;
  range?: { start: number; end: number };
}