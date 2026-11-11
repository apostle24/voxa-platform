# VOXA Mobile

Expo / React Native application for Android and iOS.

## Setup
- Node.js 20+ and pnpm 9+
- From `apps/mobile`: `npm install` (this native app has its own dependency install so it does not change the web/API lockfile)
- Set `EXPO_PUBLIC_VOXA_API_URL` to the API base URL including `/v1`
- Run `npx expo start`
- Use an Android/iOS development build for native device testing.

Authentication stores access and rotating refresh tokens in Expo SecureStore. The API mobile session endpoints return refresh tokens only to the mobile client; browser clients continue using the HttpOnly refresh cookie.

Audio playback, discovery, creator show management, communities, and live-room entry are included. LiveKit room connection requires a native development build; Expo Go does not include the required WebRTC native modules.
