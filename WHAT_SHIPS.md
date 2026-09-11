# WHAT_SHIPS — Hathor Red live capability snapshot

Last updated: 2026-09-10 (dose-1.21 restore full PlayerContext).

## Ships today

- **Auth**: email/password + JWT. No OAuth routes mounted.
- **Playback (Dose 1 core)**: signed stream URLs for HTML5 audio (`stream-url` + `streamAuth` + `streamToken`).
- **Player**: full `PlayerContext` restored (queue, Fisher-Yates shuffle, repeat, seek guards, play-generation, stream retry on media error with resume position, volume/speed, hydrate from `/playback/state`, clear on logout). Queue UI, addToQueue dedupe, insertNext / makeNext (shuffle-aware), moveInQueue, playAtIndex.
- **Pitch/stems**: not implemented; UI controls remain hidden.

## Next item

Optional multi-device live queue list (not claimed). Dose 2 profile/settings polish after playback solid.
