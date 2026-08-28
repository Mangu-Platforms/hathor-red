/**
 * Legacy player shell — not mounted by App.js.
 * Live UI is MusicPlayer.js + PlayerContext (signed streams, queue, shuffle, seek guards).
 * Pitch-shift / stem controls intentionally absent (not on the audio graph).
 * Kept as a thin re-export so old imports do not break; prefer MusicPlayer.
 */
export { default } from './MusicPlayer';
