# VOXA Mobile

Expo / React Native application for Android and iOS.

## Setup
- Node.js 22.13+ and npm
- From `apps/mobile`: `npm install` (this native app has its own dependency install so it does not change the web/API lockfile)
- Copy `.env.example` to `.env` and set `EXPO_PUBLIC_VOXA_API_URL` to the API base URL including `/v1`. For a physical phone, use the computer's LAN IP; Android emulators typically use `10.0.2.2` instead of `localhost`.
- Run `npx expo start` for the Metro bundler, then use `npx expo run:android` or `npx expo run:ios` to create a native development build
- Use an Android/iOS development build for native device testing.

Authentication stores access and rotating refresh tokens in Expo SecureStore. The API mobile endpoints are `POST /auth/mobile/register`, `POST /auth/mobile/login`, `POST /auth/mobile/mfa/challenge`, `POST /auth/mobile/refresh`, and `POST /auth/mobile/logout`. Native refresh tokens are returned only to the mobile client and should remain in SecureStore; browser clients continue using the HttpOnly refresh cookie.

Audio playback, discovery, creator show management, communities, and live-room entry are included. LiveKit room connection requires a native development build; Expo Go does not include the required WebRTC native modules.


## Creator and community workflows
- Creator Studio can create shows and episode drafts, edit draft metadata, upload supported audio/video formats directly to VOXA's signed object-storage URL, retry failed media processing, publish ready episodes, and unpublish episodes.
- A show must be published before its episodes can be published. Episode media must finish processing and have a duration before publication.
- Communities support joining/leaving, member-only discussion feeds, new posts, and replies.
- VOXA LIVE includes room chat, stage requests, host approval/rejection, speaker removal, and microphone controls for participants with publish permission.
- Apply the API migration `20261111260000_community_post_comments` before using community replies.
