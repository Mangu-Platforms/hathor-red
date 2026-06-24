/**
 * Passport OAuth Strategy Configuration
 * Hathor Red v2.0
 */

import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as SpotifyStrategy } from 'passport-spotify';
import { OAuthProfile } from '../types';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/api/v1/auth/oauth/google/callback';

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || '';
const SPOTIFY_CALLBACK_URL = process.env.SPOTIFY_CALLBACK_URL || 'http://localhost:5000/api/v1/auth/oauth/spotify/callback';

export function initPassport(p: typeof passport): void {
  // Google OAuth Strategy
  if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
    p.use(new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: GOOGLE_CALLBACK_URL,
        scope: ['profile', 'email'],
        state: true,
      },
      (_accessToken, _refreshToken, profile, done) => {
        const oauthProfile: OAuthProfile = {
          id: profile.id,
          email: profile.emails?.[0]?.value,
          displayName: profile.displayName,
          photos: profile.photos?.map(p => ({ value: p.value })),
          provider: 'google',
        };
        done(null, oauthProfile);
      }
    ));
  } else {
    console.warn('[Auth] Google OAuth credentials not configured');
  }

  // Spotify OAuth Strategy
  if (SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET) {
    p.use(new SpotifyStrategy(
      {
        clientID: SPOTIFY_CLIENT_ID,
        clientSecret: SPOTIFY_CLIENT_SECRET,
        callbackURL: SPOTIFY_CALLBACK_URL,
        scope: ['user-read-email', 'user-read-private'],
        state: true,
      },
      (_accessToken, _refreshToken, _expires_in, profile, done) => {
        const oauthProfile: OAuthProfile = {
          id: profile.id,
          email: profile.emails?.[0]?.value,
          displayName: profile.displayName,
          photos: profile.photos?.map(p => ({ value: p.value })),
          provider: 'spotify',
        };
        done(null, oauthProfile);
      }
    ));
  } else {
    console.warn('[Auth] Spotify OAuth credentials not configured');
  }

  // Serialization
  p.serializeUser((user: any, done) => {
    done(null, JSON.stringify(user));
  });

  p.deserializeUser((data: string, done) => {
    try {
      done(null, JSON.parse(data));
    } catch {
      done(null, null);
    }
  });
}

export function getOAuthConfigStatus(): { google: boolean; spotify: boolean } {
  return {
    google: !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
    spotify: !!(SPOTIFY_CLIENT_ID && SPOTIFY_CLIENT_SECRET),
  };
}

export function createSimulatedOAuthProfile(provider: 'google' | 'spotify', userIndex: number = 0): OAuthProfile {
  return {
    id: `simulated_${provider}_${userIndex}`,
    email: `user${userIndex}@${provider}.test`,
    displayName: `Test User ${userIndex}`,
    photos: [{ value: `https://via.placeholder.com/150?text=User${userIndex}` }],
    provider,
  };
}