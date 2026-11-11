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
