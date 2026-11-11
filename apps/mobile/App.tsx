import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Platform, Pressable,
  SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { AudioSession, LiveKitRoom, registerGlobals } from '@livekit/react-native';
import { api, clearSession, getSavedUser, saveSession, signIn, signOut, User, ApiRecord, verifyMfa, registerAccount } from './src/api';
import { colors } from './src/theme';

registerGlobals();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

type DeepLinkTarget = { kind: 'episode' | 'creator' | 'community' | 'live'; id: string };


type Tab = 'Discover' | 'Communities' | 'LIVE' | 'Creator' | 'Profile';
type PlayerState = { title: string; show: string; url: string } | null;
const tabs: Tab[] = ['Discover', 'Communities', 'LIVE', 'Creator', 'Profile'];
const arrayOf = (value: any): ApiRecord[] => Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : Array.isArray(value?.data) ? value.data : Array.isArray(value?.messages) ? value.messages : [];

function Button({ title, onPress, secondary = false, disabled = false }: { title: string; onPress: () => void; secondary?: boolean; disabled?: boolean }) {
  return <Pressable disabled={disabled} onPress={onPress} style={[styles.button, secondary && styles.secondaryButton, disabled && { opacity: .45 }]}>
    <Text style={[styles.buttonText, secondary && { color: colors.text }]}>{title}</Text>
  </Pressable>;
}
function Field(props: React.ComponentProps<typeof TextInput>) {
  return <TextInput placeholderTextColor={colors.muted} {...props} style={[styles.input, props.style]} />;
}
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}
function Empty({ text }: { text: string }) { return <Text style={styles.empty}>{text}</Text>; }

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [tab, setTab] = useState<Tab>('Discover');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [registerMode, setRegisterMode] = useState(false);
  const [authNotice, setAuthNotice] = useState('');
  const [authError, setAuthError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mfa, setMfa] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [player, setPlayer] = useState<PlayerState>(null);
  const audioPlayer = useAudioPlayer(null);
  const audioStatus = useAudioPlayerStatus(audioPlayer);
  const [playerMessage, setPlayerMessage] = useState('');
  const [pushToken, setPushToken] = useState('');
  const [deepLinkTarget, setDeepLinkTarget] = useState<DeepLinkTarget | null>(null);

  function openDeepLink(rawUrl: string) {
    const match = rawUrl.match(/^voxa:\/\/([^/?#]+)(?:\/([^/?#]+))?/i);
    if (!match) return;
    const kind = match[1].toLowerCase();
    if (kind === 'notifications') { setTab('Profile'); return; }
    if (!match[2]) return;
    const id = decodeURIComponent(match[2]);
    if (kind === 'episodes' || kind === 'episode') { setDeepLinkTarget({ kind: 'episode', id }); setTab('Discover'); }
    else if (kind === 'profiles' || kind === 'creators' || kind === 'creator') { setDeepLinkTarget({ kind: 'creator', id }); setTab('Profile'); }
    else if (kind === 'communities' || kind === 'community') { setDeepLinkTarget({ kind: 'community', id }); setTab('Communities'); }
    else if (kind === 'live' || kind === 'rooms') { setDeepLinkTarget({ kind: 'live', id }); setTab('LIVE'); }
  }

  function openNotificationData(data: Record<string, unknown>) {
    if (typeof data.deepLink === 'string') openDeepLink(data.deepLink);
    else if (typeof data.resourceId === 'string' && typeof data.resourceType === 'string') {
      const kind = data.resourceType.toLowerCase();
      const route = kind.includes('episode') ? 'episodes' : kind.includes('community') || kind === 'post' ? 'communities' : kind.includes('live') || kind.includes('room') ? 'live' : 'profiles';
      openDeepLink('voxa://' + route + '/' + encodeURIComponent(data.resourceId));
    }
  }

  useEffect(() => {
    let active = true;
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(response => {
      openNotificationData(response.notification.request.content.data as Record<string, unknown>);
    });
    void Notifications.getLastNotificationResponseAsync().then(response => {
      if (active && response) openNotificationData(response.notification.request.content.data as Record<string, unknown>);
    });
    void Linking.getInitialURL().then(url => { if (active && url) openDeepLink(url); });
    const linkSubscription = Linking.addEventListener('url', event => openDeepLink(event.url));
    return () => {
      active = false;
      responseSubscription.remove();
      linkSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!user || Platform.OS === 'web') return;
    let active = true;
    (async () => {
      try {
        const permission = await Notifications.getPermissionsAsync();
        const granted = permission.granted || (await Notifications.requestPermissionsAsync()).granted;
        if (!granted || !active) return;
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('voxa-notifications', {
            name: 'VOXA notifications', importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 250, 250, 250], sound: 'default',
          });
        }
        const projectId = Constants.easConfig?.projectId || Constants.expoConfig?.extra?.eas?.projectId;
        if (!projectId) return;
        const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
        if (!active) return;
        await api('/notifications/devices', {
          method: 'POST',
          body: JSON.stringify({ expoPushToken: token, platform: Platform.OS, deviceName: undefined }),
        });
        if (active) setPushToken(token);
      } catch {
        // Push registration is optional; the in-app notification inbox remains available.
      }
    })();
    return () => { active = false; };
  }, [user?.id]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const saved = await getSavedUser();
        const token = await SecureStore.getItemAsync('voxa_access_token');
        if (saved && token) {
          const fresh = await api<User>('/auth/me');
          if (mounted) setUser(fresh);
        }
      } catch {
        await clearSession();
      } finally { if (mounted) setBooting(false); }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    void setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' }).catch(() => undefined);
  }, []);

  async function authenticate() {
    setBusy(true); setAuthError('');
    try {
      if (registerMode && !mfa) {
        await registerAccount(displayName.trim(), email.trim(), password);
        setRegisterMode(false); setPassword('');
        setAuthNotice('Account created. Check your email and verify your address before signing in.');
        return;
      }
      const result = mfa ? await verifyMfa(mfa, mfaCode) : await signIn(email.trim(), password);
      if (result.mfaRequired && result.challengeToken) {
        setMfa(result.challengeToken); setAuthError('Enter your authenticator or backup code.'); return;
      }
      await saveSession(result);
      setUser(result.user);
      setPassword(''); setMfa(''); setMfaCode(''); setAuthNotice('');
    } catch (e) { setAuthError(e instanceof Error ? e.message : 'Sign in failed'); }
    finally { setBusy(false); }
  }

  async function playEpisode(item: ApiRecord) {
    try {
      setPlayerMessage('Preparing audio…');
      const episode = await api<any>('/episodes/' + encodeURIComponent(item.id));
      const member = Boolean(episode.membershipRequired);
      const playback = await api<any>('/episodes/' + encodeURIComponent(item.id) + (member ? '/member-playback-url' : '/playback-url'));
      const title = episode.title || item.title || 'VOXA episode';
      const showTitle = episode.show?.title || item.show?.title || 'Podcast';
      audioPlayer.replace(playback.url);
      audioPlayer.setActiveForLockScreen(true, { title, artist: showTitle, albumTitle: 'VOXA' });
      audioPlayer.play();
      setPlayer({ title, show: showTitle, url: playback.url });
      setPlayerMessage('');
    } catch (e) { setPlayerMessage(e instanceof Error ? e.message : 'Unable to play this episode'); }
  }

  async function togglePlayback() {
    if (audioStatus.playing) audioPlayer.pause();
    else audioPlayer.play();
  }

  if (booting) return <SafeAreaView style={styles.center}><ActivityIndicator color={colors.accent} size="large" /></SafeAreaView>;
  if (!user) return <SafeAreaView style={styles.safe}>
    <StatusBar barStyle="light-content" />
    <KeyboardAvoidingView style={styles.authWrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Text style={styles.brand}>VOXA<Text style={{ color: colors.accent }}>.</Text></Text>
      <Text style={styles.hero}>Your voice{ '\n' }has a place.</Text>
      <Text style={styles.muted}>Listen, host, and connect with a global community.</Text>
      <View style={styles.authCard}>
        <SectionTitle>{mfa ? 'Verify your sign-in' : registerMode ? 'Create your account' : 'Welcome back'}</SectionTitle>
        {!mfa && <>
          {registerMode && <Field value={displayName} onChangeText={setDisplayName} placeholder="Your name" maxLength={60} />}
          <Field value={email} onChangeText={setEmail} placeholder="Email address" autoCapitalize="none" keyboardType="email-address" />
          <Field value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry />
        </>}
        {!!mfa && <Field value={mfaCode} onChangeText={setMfaCode} placeholder="Authenticator or backup code" keyboardType="number-pad" />}
        {!!authNotice && <Text style={styles.notice}>{authNotice}</Text>}{!!authError && <Text style={styles.error}>{authError}</Text>}
        <Button title={busy ? 'Please wait…' : mfa ? 'Verify and sign in' : registerMode ? 'Create account' : 'Sign in'} onPress={authenticate} disabled={busy || (!mfa && (!email || !password || (registerMode && !displayName.trim()))) || (!!mfa && !mfaCode)} />
        {!mfa && <Pressable onPress={() => { setRegisterMode(v => !v); setAuthError(''); setAuthNotice(''); }}><Text style={styles.switchAuth}>{registerMode ? 'Already registered? Sign in' : 'New to VOXA? Create an account'}</Text></Pressable>}
        <Text style={styles.hint}>{registerMode ? 'Use at least 10 characters with uppercase, lowercase, and a number. Verify your email before signing in.' : 'Your session is protected on this device. Forgot your password? Reset it on VOXA web.'}</Text>
      </View>
    </KeyboardAvoidingView>
  </SafeAreaView>;

  return <SafeAreaView style={styles.safe}>
    <StatusBar barStyle="light-content" />
    <View style={styles.header}>
      <Text style={styles.brand}>VOXA<Text style={{ color: colors.accent }}>.</Text></Text>
      <Text style={styles.headerSub}>VOICE • STORIES • COMMUNITY</Text>
    </View>
    <View style={styles.content}>
      {tab === 'Discover' && <Discover onPlay={playEpisode} targetEpisodeId={deepLinkTarget?.kind === 'episode' ? deepLinkTarget.id : undefined} />}
      {tab === 'Communities' && <Communities userId={user.id} targetCommunityId={deepLinkTarget?.kind === 'community' ? deepLinkTarget.id : undefined} />}
      {tab === 'LIVE' && <Live userId={user.id} targetRoomId={deepLinkTarget?.kind === 'live' ? deepLinkTarget.id : undefined} />}
      {tab === 'Creator' && <Creator />}
      {tab === 'Profile' && (deepLinkTarget?.kind === 'creator' ? <CreatorProfile handle={deepLinkTarget.id} viewerId={user.id} /> : <Profile user={user} onSignOut={async () => { if (pushToken) await api('/notifications/devices', { method: 'DELETE', body: JSON.stringify({ expoPushToken: pushToken }) }).catch(() => undefined); audioPlayer.pause(); audioPlayer.clearLockScreenControls(); await signOut(); setPushToken(''); setUser(null); }} />)}
    </View>
    {player && <View style={styles.miniPlayer}>
      <View style={{ flex: 1 }}><Text numberOfLines={1} style={styles.playerTitle}>{player.title}</Text><Text style={styles.smallMuted}>{player.show}</Text></View>
      <Pressable onPress={togglePlayback} style={styles.playButton}><Text style={styles.playButtonText}>{audioStatus.playing ? 'Ⅱ' : '▶'}</Text></Pressable>
    </View>}
    {!!playerMessage && <Text style={styles.playerMessage}>{playerMessage}</Text>}
    <View style={styles.tabBar}>
      {tabs.map(item => <Pressable key={item} onPress={() => setTab(item)} style={styles.tabItem}>
        <Text style={[styles.tabLabel, tab === item && styles.tabActive]}>{item === 'LIVE' ? '● LIVE' : item}</Text>
      </Pressable>)}
    </View>
  </SafeAreaView>;
}

function useLoad<T>(path: string, deps: any[] = []) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    api<any>(path).then(value => { if (active) setItems(arrayOf(value) as T[]); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Unable to load'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path, reload, ...deps]);
  return { items, loading, error, refresh: () => setReload(v => v + 1) };
}

function Discover({ onPlay, targetEpisodeId }: { onPlay: (item: ApiRecord) => void; targetEpisodeId?: string }) {
  const [targetEpisode, setTargetEpisode] = useState<ApiRecord | null>(null);
  const [targetError, setTargetError] = useState('');
  useEffect(() => {
    let active = true;
    if (!targetEpisodeId) { setTargetEpisode(null); setTargetError(''); return; }
    api<ApiRecord>('/episodes/' + encodeURIComponent(targetEpisodeId))
      .then(item => { if (active) setTargetEpisode(item); })
      .catch(error => { if (active) setTargetError(error instanceof Error ? error.message : 'Episode unavailable'); });
    return () => { active = false; };
  }, [targetEpisodeId]);
  const [query, setQuery] = useState('');
  const shows = useLoad<ApiRecord>('/discovery/shows?limit=20');
  const episodes = useLoad<ApiRecord>('/discovery/episodes?limit=20');
  const filteredShows = shows.items.filter(x => !query || (x.title || '').toLowerCase().includes(query.toLowerCase()));
  return <ScrollView contentContainerStyle={styles.scroll}>
    <Text style={styles.eyebrow}>FIND YOUR NEXT LISTEN</Text>
    {!!targetEpisodeId && <View style={styles.formCard}>
      <Text style={styles.eyebrow}>OPENED FROM NOTIFICATION</Text>
      {targetEpisode ? <><Text style={styles.cardTitle}>{targetEpisode.title || 'Episode'}</Text><Text style={styles.cardDesc}>{targetEpisode.description || ''}</Text><Button title="Play episode" onPress={() => onPlay(targetEpisode)} /></> : targetError ? <Empty text={targetError} /> : <ActivityIndicator color={colors.accent} />}
    </View>}
    <Text style={styles.pageTitle}>Discover</Text>
    <Field value={query} onChangeText={setQuery} placeholder="Search shows and podcasts" />
    <SectionTitle>Featured shows</SectionTitle>
    {shows.loading ? <ActivityIndicator color={colors.accent} /> : shows.error ? <Empty text={shows.error} /> : filteredShows.length ? filteredShows.map(item => <ContentCard key={item.id} item={item} subtitle={item.creator?.user?.displayName || item.creator?.displayName || 'VOXA creator'} />) : <Empty text="No shows found." />}
    <SectionTitle>Latest episodes</SectionTitle>
    {episodes.loading ? <ActivityIndicator color={colors.accent} /> : episodes.error ? <Empty text={episodes.error} /> : episodes.items.map(item => <EpisodeCard key={item.id} item={item} onPlay={() => onPlay(item)} />)}
  </ScrollView>;
}

function ContentCard({ item, subtitle, action }: { item: ApiRecord; subtitle?: string; action?: React.ReactNode }) {
  return <View style={styles.card}>
    <View style={styles.cardArt}><Text style={styles.cardArtText}>{(item.title || item.name || 'V').slice(0,1).toUpperCase()}</Text></View>
    <View style={{ flex: 1 }}><Text style={styles.cardTitle}>{item.title || item.name || 'Untitled'}</Text><Text style={styles.smallMuted}>{subtitle || item.description || item.category || ''}</Text>{!!item.description && <Text numberOfLines={2} style={styles.cardDesc}>{item.description}</Text>}</View>
    {action}
  </View>;
}
function EpisodeCard({ item, onPlay }: { item: ApiRecord; onPlay: () => void }) {
  return <View style={styles.episodeCard}>
    <View style={{ flex: 1 }}><Text style={styles.cardTitle}>{item.title || 'Episode'}</Text><Text style={styles.smallMuted}>{item.show?.title || item.creator?.user?.displayName || 'VOXA'}</Text><Text numberOfLines={2} style={styles.cardDesc}>{item.description || ''}</Text></View>
    <Pressable onPress={onPlay} style={styles.playButton}><Text style={styles.playButtonText}>▶</Text></Pressable>
    <SafetyActions targetType="EPISODE" targetId={item.id} />
  </View>;
}

function Communities({ userId, targetCommunityId }: { userId: string; targetCommunityId?: string }) {
  const { items, loading, error, refresh } = useLoad<ApiRecord>('/communities');
  const [selected, setSelected] = useState<ApiRecord | null>(null);
  const [joined, setJoined] = useState(false);
  const [postText, setPostText] = useState('');
  const [replyText, setReplyText] = useState('');
  const [replyingTo, setReplyingTo] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!targetCommunityId || !items.length) return;
    const target = items.find(item => item.id === targetCommunityId);
    if (target) setSelected(target);
    else Alert.alert('Community unavailable', 'This community may have been removed or is no longer public.');
  }, [targetCommunityId, items]);
  const posts = useLoad<any>(selected ? '/communities/' + encodeURIComponent(selected.id) + '/posts' : '/communities/unselected/posts');
  useEffect(() => {
    let active = true;
    if (selected) api<any>('/communities/' + encodeURIComponent(selected.id) + '/membership')
      .then(value => { if (active) setJoined(Boolean(value.joined)); })
      .catch(() => { if (active) setJoined(false); });
    else setJoined(false);
    return () => { active = false; };
  }, [selected?.id]);
  async function toggleMembership() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      await api('/communities/' + encodeURIComponent(selected.id) + '/join', { method: joined ? 'DELETE' : 'POST' });
      setJoined(!joined);
      if (joined) Alert.alert('Left community', 'You have left this community.');
      else Alert.alert('Welcome', 'You joined the community.');
      posts.refresh(); refresh();
    } catch (e) { Alert.alert('Membership update failed', e instanceof Error ? e.message : 'Try again'); }
    finally { setBusy(false); }
  }
  async function createPost() {
    if (!selected || !postText.trim() || busy) return;
    setBusy(true);
    try {
      await api('/communities/' + encodeURIComponent(selected.id) + '/posts', { method: 'POST', body: JSON.stringify({ content: postText.trim() }) });
      setPostText(''); posts.refresh();
    } catch (e) { Alert.alert('Post not created', e instanceof Error ? e.message : 'Join the community first'); }
    finally { setBusy(false); }
  }
  async function createReply(postId: string) {
    if (!selected || !replyText.trim() || busy) return;
    setBusy(true);
    try {
      await api('/communities/' + encodeURIComponent(selected.id) + '/posts/' + encodeURIComponent(postId) + '/comments', { method: 'POST', body: JSON.stringify({ content: replyText.trim() }) });
      setReplyText(''); setReplyingTo(''); posts.refresh();
    } catch (e) { Alert.alert('Reply not added', e instanceof Error ? e.message : 'Try again'); }
    finally { setBusy(false); }
  }
  if (selected) return <ScrollView contentContainerStyle={styles.scroll}>
    <Pressable onPress={() => setSelected(null)}><Text style={styles.backLink}>‹ All communities</Text></Pressable>
    <Text style={styles.eyebrow}>COMMUNITY DISCUSSIONS</Text><Text style={styles.pageTitle}>{selected.name || selected.title}</Text>
    <Text style={styles.muted}>{selected.description || selected.category || 'A place to connect and share.'}</Text>
    <Button title={busy ? 'Please wait…' : joined ? 'Leave community' : 'Join community'} secondary onPress={toggleMembership} disabled={busy} />
    {joined && <View style={styles.formCard}>
      <SectionTitle>Start a discussion</SectionTitle>
      <Field value={postText} onChangeText={setPostText} placeholder="Share something with the community…" multiline maxLength={5000} />
      <Button title={busy ? 'Posting…' : 'Publish post'} onPress={createPost} disabled={busy || !postText.trim()} />
    </View>}
    <SectionTitle>Recent discussions</SectionTitle>
    {posts.loading ? <ActivityIndicator color={colors.accent} /> : posts.error ? <Empty text={posts.error} /> : posts.items.map((post: any) => <View key={post.id} style={styles.discussionCard}>
      <Text style={styles.cardTitle}>{post.author?.displayName || 'Community member'}</Text>
      <Text style={styles.cardDesc}>{post.content}</Text>
      <Text style={styles.smallMuted}>{post.comments?.length || 0} replies</Text>
      <SafetyActions targetType="COMMUNITY_POST" targetId={post.id} />
      {!!post.author?.id && post.author.id !== userId && <SafetyActions targetType="USER" targetId={post.author.id} allowBlock />}
      {(post.comments || []).map((comment: any) => <View key={comment.id} style={styles.replyCard}>
        <Text style={styles.cardTitle}>{comment.author?.displayName || 'Member'}</Text><Text style={styles.muted}>{comment.content}</Text>
      </View>)}
      {joined && <Pressable onPress={() => setReplyingTo(replyingTo === post.id ? '' : post.id)}><Text style={styles.backLink}>{replyingTo === post.id ? 'Cancel reply' : 'Reply to discussion'}</Text></Pressable>}
      {replyingTo === post.id && <>
        <Field value={replyText} onChangeText={setReplyText} placeholder="Write a reply…" multiline maxLength={5000} />
        <Button title={busy ? 'Sending…' : 'Send reply'} onPress={() => createReply(post.id)} disabled={busy || !replyText.trim()} />
      </>}
    </View>)}
    {!posts.loading && !posts.items.length && <Empty text={joined ? 'Start the first discussion.' : 'Join this community to read and join discussions.'} />}
  </ScrollView>;
  return <ScrollView contentContainerStyle={styles.scroll}>
    <Text style={styles.eyebrow}>MEET YOUR PEOPLE</Text><Text style={styles.pageTitle}>Communities</Text>
    {loading ? <ActivityIndicator color={colors.accent} /> : error ? <Empty text={error} /> : items.map(item => <Pressable key={item.id} onPress={() => setSelected(item)} style={styles.card}>
      <View style={styles.cardArt}><Text style={styles.cardArtText}>{(item.name || 'C').slice(0,1).toUpperCase()}</Text></View>
      <View style={{ flex: 1 }}><Text style={styles.cardTitle}>{item.name}</Text><Text style={styles.smallMuted}>{item.category || 'Community'} · {item._count?.members ?? 0} members</Text><Text numberOfLines={2} style={styles.cardDesc}>{item.description || ''}</Text></View>
      <Text style={styles.backLink}>Open ›</Text>
    </Pressable>)}
    {!loading && !items.length && <Empty text="Communities will appear here." />}
  </ScrollView>;
}

function Live({ userId, targetRoomId }: { userId: string; targetRoomId?: string }) {
  const { items, loading, error } = useLoad<ApiRecord>('/live/rooms');
  const [room, setRoom] = useState<{ id: string; token: string; serverUrl: string; title: string; canPublish: boolean } | null>(null);
  const [busy, setBusy] = useState('');
  useEffect(() => {
    if (!room) return;
    void AudioSession.startAudioSession();
    return () => { void AudioSession.stopAudioSession(); };
  }, [room?.id]);
  async function join(item: ApiRecord) {
    setBusy(item.id);
    try {
      const result = await api<any>('/live/rooms/' + encodeURIComponent(item.id) + '/join-token', { method: 'POST' });
      setRoom({ id: item.id, token: result.token, serverUrl: result.serverUrl || result.url, title: item.title || 'VOXA LIVE', canPublish: Boolean(result.canPublish) });
    } catch (e) { Alert.alert('Unable to join room', e instanceof Error ? e.message : 'Try again'); }
    finally { setBusy(''); }
  }
  useEffect(() => {
    if (!targetRoomId || !items.length || room) return;
    const target = items.find(item => item.id === targetRoomId);
    if (target) void join(target);
    else Alert.alert('Live room unavailable', 'This live room may have ended or is no longer public.');
  }, [targetRoomId, items]);
  if (room) return <View style={styles.liveRoom}>
    <Text style={styles.livePill}>● CONNECTED TO VOXA LIVE</Text><Text style={styles.pageTitle}>{room.title}</Text>
    <LiveKitRoom key={room.id + room.token} serverUrl={room.serverUrl} token={room.token} connect={true} audio={room.canPublish} video={false} onDisconnected={() => setRoom(null)}>
      <LiveRoomPanel roomId={room.id} userId={userId} canPublish={room.canPublish}
        onPublishGranted={async () => {
          const fresh = await api<any>('/live/rooms/' + encodeURIComponent(room.id) + '/join-token', { method: 'POST' });
          setRoom(current => current ? { ...current, token: fresh.token, canPublish: Boolean(fresh.canPublish) } : current);
        }}
        onMicToggle={enabled => setRoom(current => current ? { ...current, canPublish: enabled } : current)} />
    </LiveKitRoom>
    <Button title="Leave room" secondary onPress={() => setRoom(null)} />
  </View>;
  return <ScrollView contentContainerStyle={styles.scroll}>
    <Text style={styles.eyebrow}>HAPPENING RIGHT NOW</Text><Text style={styles.pageTitle}>VOXA LIVE</Text>
    {loading ? <ActivityIndicator color={colors.accent} /> : error ? <Empty text={error} /> : items.map(item => <View key={item.id} style={styles.liveCard}>
      <Text style={styles.livePill}>● {item.status || 'LIVE'}</Text><Text style={styles.cardTitle}>{item.title || 'Live conversation'}</Text><Text style={styles.smallMuted}>{item.host?.displayName || item.creator?.user?.displayName || 'VOXA host'}</Text>
      <Text numberOfLines={2} style={styles.cardDesc}>{item.description || 'Join the conversation.'}</Text>
      <Button title={busy === item.id ? 'Joining…' : 'Join room'} onPress={() => join(item)} disabled={!!busy} />
      <SafetyActions targetType="LIVE_ROOM" targetId={item.id} />
      {!!item.host?.id && item.host.id !== userId && <SafetyActions targetType="USER" targetId={item.host.id} allowBlock />}
    </View>)}
    {!loading && !items.length && <Empty text="No public live rooms right now. Check back soon." />}
  </ScrollView>;
}

function LiveRoomPanel({ roomId, userId, canPublish, onPublishGranted, onMicToggle }: {
  roomId: string; userId: string; canPublish: boolean; onPublishGranted: () => Promise<void>; onMicToggle: (enabled: boolean) => void;
}) {
  const [messages, setMessages] = useState<any[]>([]);
  const [stage, setStage] = useState<any>(null);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [stageBusy, setStageBusy] = useState('');
  const [micEnabled, setMicEnabled] = useState(canPublish);
  const [loadError, setLoadError] = useState('');
  const isHost = Boolean(stage?.isHost);
  const isSpeaker = isHost || (stage?.speakers || []).some((speaker: any) => speaker.userId === userId);
  async function refreshRoom() {
    try {
      const [chat, state] = await Promise.all([
        api<any>('/live/rooms/' + encodeURIComponent(roomId) + '/chat'),
        api<any>('/live/rooms/' + encodeURIComponent(roomId) + '/stage'),
      ]);
      setMessages(chat.messages || chat || []);
      setStage(state);
      setLoadError('');
      if (!canPublish && (state.speakers || []).some((speaker: any) => speaker.userId === userId)) await onPublishGranted();
    } catch (e) { setLoadError(e instanceof Error ? e.message : 'Unable to refresh live room'); }
  }
  useEffect(() => { void refreshRoom(); }, [roomId]);
  async function sendMessage() {
    const content = message.trim();
    if (!content || sending) return;
    setSending(true);
    try {
      await api('/live/rooms/' + encodeURIComponent(roomId) + '/chat', { method: 'POST', body: JSON.stringify({ content }) });
      setMessage(''); await refreshRoom();
    } catch (e) { Alert.alert('Message not sent', e instanceof Error ? e.message : 'Try again'); }
    finally { setSending(false); }
  }
  async function requestToSpeak() {
    setStageBusy('request');
    try { await api('/live/rooms/' + encodeURIComponent(roomId) + '/stage-requests', { method: 'POST' }); Alert.alert('Request sent', 'The host can review your request.'); await refreshRoom(); }
    catch (e) { Alert.alert('Request not sent', e instanceof Error ? e.message : 'Try again'); }
    finally { setStageBusy(''); }
  }
  async function decideRequest(requestId: string, approve: boolean) {
    setStageBusy(requestId);
    try {
      await api('/live/rooms/' + encodeURIComponent(roomId) + '/stage-requests/' + encodeURIComponent(requestId) + '/' + (approve ? 'approve' : 'reject'), { method: 'POST' });
      await refreshRoom();
    } catch (e) { Alert.alert('Stage action failed', e instanceof Error ? e.message : 'Try again'); }
    finally { setStageBusy(''); }
  }
  async function removeSpeaker(userId: string) {
    setStageBusy(userId);
    try {
      await api('/live/rooms/' + encodeURIComponent(roomId) + '/speakers/' + encodeURIComponent(userId) + '/remove', { method: 'POST' });
      await refreshRoom();
    } catch (e) { Alert.alert('Unable to remove speaker', e instanceof Error ? e.message : 'Try again'); }
    finally { setStageBusy(''); }
  }
  function toggleMic() {
    const next = !micEnabled;
    setMicEnabled(next);
    onMicToggle(next);
  }
  return <View style={[styles.roomPanel, { flex: 1 }]}>
    <Text style={styles.cardTitle}>Live stage</Text>
    <Text style={styles.smallMuted}>{isHost ? 'You are hosting this room.' : isSpeaker ? 'You are on stage.' : 'You are listening to the conversation.'}</Text>
    {(isHost || isSpeaker) && <Button title={micEnabled ? 'Mute microphone' : 'Unmute microphone'} secondary onPress={toggleMic} />}
    {!isHost && !isSpeaker && <Button title={stageBusy === 'request' ? 'Requesting…' : stage?.ownRequest?.status === 'PENDING' ? 'Request pending' : 'Request to speak'} secondary onPress={requestToSpeak} disabled={stageBusy === 'request' || stage?.ownRequest?.status === 'PENDING'} />}
    <Button title="Refresh stage and chat" secondary onPress={refreshRoom} />
    {!!loadError && <Text style={styles.error}>{loadError}</Text>}
    {isHost && <>
      <SectionTitle>Speaker requests ({stage?.requests?.length || 0})</SectionTitle>
      {(stage?.requests || []).map((request: any) => <View key={request.id} style={styles.stageRow}>
        <Text style={[styles.muted, { flex: 1 }]}>{request.userId}</Text>
        <Pressable onPress={() => decideRequest(request.id, true)} disabled={!!stageBusy}><Text style={styles.backLink}>Approve</Text></Pressable>
        <Pressable onPress={() => decideRequest(request.id, false)} disabled={!!stageBusy}><Text style={styles.error}>Reject</Text></Pressable>
      </View>)}
    </>}
    <SectionTitle>On stage ({stage?.speakers?.length || 0})</SectionTitle>
    {(stage?.speakers || []).map((speaker: any) => <View key={speaker.userId} style={styles.stageRow}>
      <Text style={[styles.muted, { flex: 1 }]}>{speaker.userId} · {speaker.role}</Text>
      {isHost && speaker.role !== 'HOST' && <Pressable onPress={() => removeSpeaker(speaker.userId)} disabled={!!stageBusy}><Text style={styles.error}>Remove</Text></Pressable>}
    </View>)}
    <SectionTitle>Room chat</SectionTitle>
    <ScrollView style={{ maxHeight: 190 }}>
      {messages.map((item: any, index: number) => <View key={item.id || index} style={styles.chatBubble}>
        <Text style={styles.cardTitle}>{item.author?.displayName || item.user?.displayName || 'Listener'}</Text>
        <Text style={styles.muted}>{item.content || item.message || ''}</Text>
      </View>)}
      {!messages.length && <Empty text="Be the first to join the conversation." />}
    </ScrollView>
    <Field value={message} onChangeText={setMessage} placeholder="Write a message…" maxLength={1000} />
    <Button title={sending ? 'Sending…' : 'Send message'} onPress={sendMessage} disabled={sending || !message.trim()} />
  </View>;
}

function Creator() {
  const { items, loading, error, refresh } = useLoad<ApiRecord>('/creators/me/shows');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedShow, setSelectedShow] = useState<ApiRecord | null>(null);
  const [episodeTitle, setEpisodeTitle] = useState('');
  const [episodeDescription, setEpisodeDescription] = useState('');
  const [duration, setDuration] = useState('');
  const [editingEpisode, setEditingEpisode] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadState, setUploadState] = useState('');
  async function createShow() {
    if (title.trim().length < 2 || busy) return;
    setBusy(true);
    try { await api('/shows', { method: 'POST', body: JSON.stringify({ title: title.trim(), description: description.trim() }) }); setTitle(''); setDescription(''); refresh(); Alert.alert('Show created', 'Your show draft is ready.'); }
    catch (e) { Alert.alert('Unable to create show', e instanceof Error ? e.message : 'Try again'); }
    finally { setBusy(false); }
  }
  async function publishShow(show: ApiRecord) {
    setBusy(true);
    try { await api('/shows/' + encodeURIComponent(show.id) + '/publish', { method: 'POST' }); refresh(); }
    catch (e) { Alert.alert('Unable to publish show', e instanceof Error ? e.message : 'Try again'); }
    finally { setBusy(false); }
  }
  async function createEpisode() {
    if (!selectedShow || episodeTitle.trim().length < 2 || busy) return;
    setBusy(true);
    try {
      await api('/shows/' + encodeURIComponent(selectedShow.id) + '/episodes', { method: 'POST', body: JSON.stringify({ title: episodeTitle.trim(), description: episodeDescription.trim(), durationSeconds: duration ? Number(duration) : undefined }) });
      setEpisodeTitle(''); setEpisodeDescription(''); setDuration(''); refresh();
      Alert.alert('Episode draft created', 'Select the episode below to attach its audio or video file.');
    } catch (e) { Alert.alert('Unable to create episode', e instanceof Error ? e.message : 'Try again'); }
    finally { setBusy(false); }
  }
  async function uploadEpisode(show: ApiRecord, episode: ApiRecord) {
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: ['audio/*','video/mp4','video/webm','video/quicktime'], copyToCacheDirectory: true, multiple: false });
      if (picked.canceled || !picked.assets?.[0]) return;
      const file = picked.assets[0];
      if (!file.size) throw new Error('The selected file has no readable size.');
      const rawType = file.mimeType || 'application/octet-stream';
      const contentType = rawType === 'audio/x-m4a' || rawType === 'audio/m4a' ? 'audio/mp4' : rawType === 'audio/x-wav' ? 'audio/wav' : rawType;
      const supported = ['audio/mpeg','audio/mp4','audio/aac','audio/wav','audio/ogg','audio/webm','video/mp4','video/webm','video/quicktime'];
      if (!supported.includes(contentType)) throw new Error('This audio/video format is not supported. Choose MP3, M4A, AAC, WAV, OGG, WebM, MP4, or MOV.');
      setBusy(true); setUploadState('Requesting secure upload…');
      const signed = await api<any>('/shows/' + encodeURIComponent(show.id) + '/episodes/' + encodeURIComponent(episode.id) + '/upload-url', {
        method: 'POST', body: JSON.stringify({ contentType, sizeBytes: file.size }),
      });
      setUploadState('Uploading media…');
      const uploaded = await FileSystem.uploadAsync(signed.uploadUrl, file.uri, {
        httpMethod: 'PUT', uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        mimeType: contentType, headers: signed.headers || { 'Content-Type': contentType },
      });
      if (uploaded.status < 200 || uploaded.status >= 300) throw new Error('Storage rejected the media upload (' + uploaded.status + ').');
      setUploadState('Queuing media processing…');
      await api('/shows/' + encodeURIComponent(show.id) + '/episodes/' + encodeURIComponent(episode.id) + '/complete-upload', {
        method: 'POST', body: JSON.stringify({ objectKey: signed.objectKey }),
      });
      setUploadState(''); refresh(); Alert.alert('Upload complete', 'VOXA is processing your media. Refresh Creator Studio to see its status.');
    } catch (e) { setUploadState(''); Alert.alert('Upload failed', e instanceof Error ? e.message : 'Try again'); }
    finally { setBusy(false); }
  }
  async function saveEpisodeEdits(show: ApiRecord, episode: ApiRecord) {
    if (editTitle.trim().length < 2 || busy) return;
    setBusy(true);
    try {
      await api('/shows/' + encodeURIComponent(show.id) + '/episodes/' + encodeURIComponent(episode.id), {
        method: 'PATCH', body: JSON.stringify({ title: editTitle.trim(), description: editDescription.trim() }),
      });
      setEditingEpisode(''); refresh();
    } catch (e) { Alert.alert('Unable to save episode', e instanceof Error ? e.message : 'Try again'); }
    finally { setBusy(false); }
  }
  async function retryProcessing(show: ApiRecord, episode: ApiRecord) {
    setBusy(true);
    try {
      await api('/shows/' + encodeURIComponent(show.id) + '/episodes/' + encodeURIComponent(episode.id) + '/retry-processing', { method: 'POST' });
      refresh();
    } catch (e) { Alert.alert('Retry unavailable', e instanceof Error ? e.message : 'Try again'); }
    finally { setBusy(false); }
  }
  async function publishEpisode(show: ApiRecord, episode: ApiRecord) {
    setBusy(true);
    try { await api('/shows/' + encodeURIComponent(show.id) + '/episodes/' + encodeURIComponent(episode.id) + '/publish', { method: 'POST' }); refresh(); }
    catch (e) { Alert.alert('Unable to publish episode', e instanceof Error ? e.message : 'Media must finish processing first.'); }
    finally { setBusy(false); }
  }
  async function unpublishEpisode(show: ApiRecord, episode: ApiRecord) {
    setBusy(true);
    try { await api('/shows/' + encodeURIComponent(show.id) + '/episodes/' + encodeURIComponent(episode.id) + '/unpublish', { method: 'POST' }); refresh(); }
    catch (e) { Alert.alert('Unable to unpublish episode', e instanceof Error ? e.message : 'Try again'); }
    finally { setBusy(false); }
  }
  return <ScrollView contentContainerStyle={styles.scroll}>
    <Text style={styles.eyebrow}>YOUR CREATOR WORKSPACE</Text><Text style={styles.pageTitle}>Creator Studio</Text>
    <View style={styles.formCard}><SectionTitle>Create a show</SectionTitle>
      <Field value={title} onChangeText={setTitle} placeholder="Show title" maxLength={120} />
      <Field value={description} onChangeText={setDescription} placeholder="What is your show about?" multiline />
      <Button title={busy ? 'Please wait…' : 'Create show draft'} onPress={createShow} disabled={busy || title.trim().length < 2} />
    </View>
    <SectionTitle>Your shows</SectionTitle>
    {loading ? <ActivityIndicator color={colors.accent} /> : error ? <Empty text={error} /> : items.map(show => <View key={show.id} style={styles.creatorShow}>
      <Pressable onPress={() => setSelectedShow(selectedShow?.id === show.id ? null : show)}>
        <Text style={styles.cardTitle}>{show.title}</Text><Text style={styles.smallMuted}>{show.status} · {show.episodes?.length || 0} episodes</Text>
      </Pressable>
      {show.status !== 'PUBLISHED' && <Button title="Publish show" secondary onPress={() => publishShow(show)} disabled={busy} />}
      <Button title={selectedShow?.id === show.id ? 'Close episodes' : 'Manage episodes'} secondary onPress={() => setSelectedShow(selectedShow?.id === show.id ? null : show)} />
      {selectedShow?.id === show.id && <>
        <View style={styles.formCard}>
          <SectionTitle>New episode</SectionTitle>
          <Field value={episodeTitle} onChangeText={setEpisodeTitle} placeholder="Episode title" maxLength={160} />
          <Field value={episodeDescription} onChangeText={setEpisodeDescription} placeholder="Episode description" multiline maxLength={8000} />
          <Field value={duration} onChangeText={setDuration} placeholder="Duration in seconds (required to publish)" keyboardType="number-pad" />
          <Button title={busy ? 'Please wait…' : 'Create episode draft'} onPress={createEpisode} disabled={busy || episodeTitle.trim().length < 2} />
        </View>
        {(show.episodes || []).map((episode: ApiRecord) => <View key={episode.id} style={styles.episodeManage}>
          <Text style={styles.cardTitle}>{episode.title}</Text><Text style={styles.smallMuted}>{episode.status} · Media: {episode.mediaAssets?.[0]?.status || (episode.mediaKey ? 'Uploaded' : 'Not uploaded')}</Text>
          {episode.status !== 'PUBLISHED' && <>
            <Button title={editingEpisode === episode.id ? 'Cancel editing' : 'Edit episode details'} secondary onPress={() => {
              if (editingEpisode === episode.id) setEditingEpisode('');
              else { setEditingEpisode(episode.id); setEditTitle(episode.title || ''); setEditDescription(episode.description || ''); }
            }} disabled={busy} />
            {editingEpisode === episode.id && <>
              <Field value={editTitle} onChangeText={setEditTitle} placeholder="Episode title" maxLength={160} />
              <Field value={editDescription} onChangeText={setEditDescription} placeholder="Episode description" multiline maxLength={8000} />
              <Button title={busy ? 'Saving…' : 'Save episode details'} onPress={() => saveEpisodeEdits(show, episode)} disabled={busy || editTitle.trim().length < 2} />
            </>}

            <Button title="Upload audio / video" secondary onPress={() => uploadEpisode(show, episode)} disabled={busy} />
            {episode.mediaAssets?.[0]?.status === 'FAILED' && <Button title="Retry media processing" secondary onPress={() => retryProcessing(show, episode)} disabled={busy} />}
            <Button title="Publish episode" onPress={() => publishEpisode(show, episode)} disabled={busy || show.status !== 'PUBLISHED'} />
          </>}
          {episode.status === 'PUBLISHED' && <Button title="Unpublish episode" secondary onPress={() => Alert.alert('Unpublish episode?', 'It will be removed from public discovery and returned to drafts.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Unpublish', style: 'destructive', onPress: () => unpublishEpisode(show, episode) }])} disabled={busy} />}
        </View>)}
      </>}
    </View>)}
    {!!uploadState && <Text style={styles.notice}>{uploadState}</Text>}
    {!loading && !items.length && <Empty text="Create your first show to begin publishing." />}
  </ScrollView>;
}

function CreatorProfile({ handle, viewerId }: { handle: string; viewerId: string }) {
  const [creator, setCreator] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api<any>('/creators/' + encodeURIComponent(handle))
      .then(value => { if (active) setCreator(value); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Creator unavailable'); });
    return () => { active = false; };
  }, [handle]);
  return <ScrollView contentContainerStyle={styles.scroll}>
    <Text style={styles.eyebrow}>VOXA CREATOR</Text><Text style={styles.pageTitle}>Creator profile</Text>
    {!creator && !error && <ActivityIndicator color={colors.accent} />}
    {!!error && <Empty text={error} />}
    {!!creator && <View style={styles.profileCard}>
      <Text style={styles.profileName}>{creator.user?.displayName || creator.displayName || creator.handle || handle}</Text>
      <Text style={styles.muted}>{creator.bio || 'VOXA creator'}</Text>
      {!!creator.handle && <Text style={styles.smallMuted}>@{creator.handle}</Text>}
      {!!creator.user?.id && creator.user.id !== viewerId && <SafetyActions targetType="USER" targetId={creator.user.id} allowBlock />}
    </View>}
  </ScrollView>;
}

function Profile({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  return <ScrollView contentContainerStyle={styles.scroll}>
    <Text style={styles.eyebrow}>YOUR VOXA ACCOUNT</Text><Text style={styles.pageTitle}>Profile</Text>
    <View style={styles.profileCard}><View style={styles.avatar}><Text style={styles.avatarText}>{user.displayName.slice(0,1).toUpperCase()}</Text></View>
      <Text style={styles.profileName}>{user.displayName}</Text><Text style={styles.muted}>{user.email}</Text><Text style={styles.smallMuted}>Account role: {user.role}</Text></View>
    {['ADMIN', 'MODERATOR'].includes(user.role) && <ModerationPanel />}
    <BlockedUsersPanel />
    <Button title="Sign out" secondary onPress={onSignOut} />
  </ScrollView>;
}


const REPORT_REASONS = [
  { value: 'HARASSMENT', label: 'Harassment or bullying' },
  { value: 'HATE', label: 'Hateful content' },
  { value: 'VIOLENCE', label: 'Violence or threats' },
  { value: 'SEXUAL_CONTENT', label: 'Sexual content' },
  { value: 'SPAM', label: 'Spam or misleading content' },
  { value: 'COPYRIGHT', label: 'Copyright concern' },
  { value: 'SELF_HARM', label: 'Self-harm concern' },
  { value: 'OTHER', label: 'Something else' },
];

function SafetyActions({ targetType, targetId, allowBlock = false }: { targetType: 'EPISODE' | 'MOMENT' | 'LIVE_ROOM' | 'USER' | 'COMMUNITY_POST'; targetId: string; allowBlock?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  async function report(reason: string) {
    if (busy) return;
    setBusy(true); setNotice('');
    try {
      const result = await api<any>('/reports', { method: 'POST', body: JSON.stringify({ targetType, targetId, reason }) });
      setNotice(result.duplicate ? 'You have already reported this item recently.' : 'Report sent to the VOXA safety team.');
      setReportOpen(false);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Report could not be sent.'); }
    finally { setBusy(false); }
  }
  async function block() {
    if (busy) return;
    Alert.alert('Block this account?', 'You will be able to unblock this account from your profile.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Block account', style: 'destructive', onPress: async () => {
        setBusy(true);
        try { await api('/users/' + encodeURIComponent(targetId) + '/block', { method: 'POST' }); setNotice('Account blocked.'); }
        catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to block account.'); }
        finally { setBusy(false); }
      }},
    ]);
  }
  return <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
    <Pressable disabled={busy} onPress={() => setReportOpen(value => !value)}><Text style={styles.backLink}>{busy ? 'Please wait…' : reportOpen ? 'Cancel report' : '⚑ Report'}</Text></Pressable>
    {allowBlock && <Pressable disabled={busy} onPress={() => void block()}><Text style={styles.backLink}>Block account</Text></Pressable>}
    {reportOpen && <View style={{ width: '100%', gap: 6, marginTop: 6 }}>
      <Text style={styles.smallMuted}>Choose a report reason:</Text>
      {REPORT_REASONS.map(reason => <Pressable key={reason.value} disabled={busy} onPress={() => void report(reason.value)} style={styles.replyCard}><Text style={styles.muted}>{reason.label}</Text></Pressable>)}
    </View>}
    {!!notice && <Text style={styles.smallMuted}>{notice}</Text>}
  </View>;
}

function BlockedUsersPanel() {
  const blocked = useLoad<any>('/users/me/blocked');
  async function unblock(id: string) {
    try { await api('/users/' + encodeURIComponent(id) + '/block', { method: 'DELETE' }); blocked.refresh(); }
    catch (error) { Alert.alert('Unable to unblock', error instanceof Error ? error.message : 'Try again'); }
  }
  return <View style={styles.formCard}>
    <SectionTitle>Blocked accounts</SectionTitle>
    {blocked.loading ? <ActivityIndicator color={colors.accent} /> : blocked.error ? <Empty text={blocked.error} /> : blocked.items.length ? blocked.items.map((item: any) => <View key={item.blockedUserId} style={styles.stageRow}>
      <Text style={{ color: colors.text, flex: 1 }}>{item.blockedUser?.displayName || item.blockedUserId}</Text>
      <Pressable onPress={() => void unblock(item.blockedUserId)}><Text style={styles.backLink}>Unblock</Text></Pressable>
    </View>) : <Empty text="You have not blocked any accounts." />}
  </View>;
}

function ModerationPanel() {
  const [statusFilter, setStatusFilter] = useState('NEW');
  const reports = useLoad<any>('/admin/reports?status=' + statusFilter, [statusFilter]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState('');
  async function review(id: string, status: 'REVIEWING' | 'ACTIONED' | 'DISMISSED') {
    if (status !== 'REVIEWING' && !notes[id]?.trim()) { Alert.alert('Moderator note required', 'Enter a short reason before closing a report.'); return; }
    setBusyId(id);
    try {
      await api('/admin/reports/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify({ status, moderatorNote: notes[id]?.trim() }) });
      reports.refresh();
    } catch (error) { Alert.alert('Review failed', error instanceof Error ? error.message : 'Try again'); }
    finally { setBusyId(''); }
  }
  async function action(id: string, actionName: string, days?: number) {
    if (!notes[id]?.trim()) { Alert.alert('Moderator note required', 'Enter the reason for this action.'); return; }
    setBusyId(id);
    try {
      await api('/admin/reports/' + encodeURIComponent(id) + '/actions', {
        method: 'POST', body: JSON.stringify({ action: actionName, moderatorNote: notes[id].trim(), ...(days ? { suspensionDays: days } : {}) }),
      });
      reports.refresh();
    } catch (error) { Alert.alert('Action failed', error instanceof Error ? error.message : 'Try again'); }
    finally { setBusyId(''); }
  }
  return <View style={styles.formCard}>
    <SectionTitle>Safety moderation queue</SectionTitle>
    <Button title={'Queue status: ' + statusFilter + ' · Change'} secondary onPress={() => setStatusFilter(current => current === 'NEW' ? 'REVIEWING' : current === 'REVIEWING' ? 'ACTIONED' : current === 'ACTIONED' ? 'DISMISSED' : 'NEW')} />
    <Button title="Refresh reports" secondary onPress={reports.refresh} />
    {reports.loading ? <ActivityIndicator color={colors.accent} /> : reports.error ? <Empty text={reports.error} /> : reports.items.length ? reports.items.map((item: any) => <View key={item.id} style={styles.discussionCard}>
      <Text style={styles.cardTitle}>{item.targetType} · {item.reason}</Text>
      <Text style={styles.smallMuted}>Reported by {item.reporter?.displayName || 'VOXA user'} · {item.status}</Text>
      <Text style={styles.cardDesc}>{item.details || item.targetLabel || item.targetId}</Text>
      <Field value={notes[item.id] || ''} onChangeText={value => setNotes(current => ({ ...current, [item.id]: value }))} placeholder="Required moderator note" multiline maxLength={1000} />
      {item.status === 'NEW' && <Button title={busyId === item.id ? 'Saving…' : 'Mark reviewing'} secondary onPress={() => void review(item.id, 'REVIEWING')} disabled={!!busyId} />}
      {item.status !== 'ACTIONED' && item.status !== 'DISMISSED' && item.targetType === 'EPISODE' && <Button title="Hide episode" onPress={() => void action(item.id, 'HIDE_EPISODE')} disabled={!!busyId} />}
      {item.status !== 'ACTIONED' && item.status !== 'DISMISSED' && item.targetType === 'MOMENT' && <Button title="Hide Moment" onPress={() => void action(item.id, 'HIDE_MOMENT')} disabled={!!busyId} />}
      {item.targetType === 'COMMUNITY_POST' && item.status !== 'ACTIONED' && <Button title="Hide community post" onPress={() => void action(item.id, 'HIDE_COMMUNITY_POST')} disabled={!!busyId} />}
      {item.status === 'ACTIONED' && item.targetType === 'COMMUNITY_POST' && <Button title="Restore community post" secondary onPress={() => void action(item.id, 'RESTORE_COMMUNITY_POST')} disabled={!!busyId} />}
      {item.status === 'ACTIONED' && item.targetType === 'EPISODE' && <Button title="Restore episode" secondary onPress={() => void action(item.id, 'RESTORE_EPISODE')} disabled={!!busyId} />}
      {item.status === 'ACTIONED' && item.targetType === 'MOMENT' && <Button title="Restore Moment" secondary onPress={() => void action(item.id, 'RESTORE_MOMENT')} disabled={!!busyId} />}
      {item.status === 'ACTIONED' && item.targetType === 'USER' && !!item.targetSuspendedUntil && <Button title="Reinstate account" secondary onPress={() => void action(item.id, 'REINSTATE_USER')} disabled={!!busyId} />}
      {item.status !== 'ACTIONED' && item.status !== 'DISMISSED' && item.targetType === 'USER' && <>
        <Button title="Warn account" onPress={() => void action(item.id, 'WARN_USER')} disabled={!!busyId} />
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {[1, 7, 30].map(days => <View key={days} style={{ flex: 1 }}><Button title={days + ' day suspension'} onPress={() => void action(item.id, 'SUSPEND_USER', days)} disabled={!!busyId} /></View>)}
        </View>
      </>}
      {item.status !== 'ACTIONED' && item.status !== 'DISMISSED' && <Button title="Dismiss report" secondary onPress={() => void review(item.id, 'DISMISSED')} disabled={!!busyId} />}
    </View>) : <Empty text="No reports need review." />}
  </View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg }, center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 14, borderBottomWidth: 1, borderColor: colors.border },
  brand: { color: colors.text, fontSize: 28, fontWeight: '900', letterSpacing: 2 }, headerSub: { color: colors.muted, fontSize: 9, letterSpacing: 2, marginTop: 3 },
  content: { flex: 1 }, scroll: { padding: 18, paddingBottom: 30 }, pageTitle: { color: colors.text, fontSize: 30, fontWeight: '800', marginBottom: 16 },
  eyebrow: { color: colors.accent2, fontSize: 10, fontWeight: '800', letterSpacing: 2, marginBottom: 8 },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '800', marginTop: 22, marginBottom: 12 },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 21 }, smallMuted: { color: colors.muted, fontSize: 11, marginTop: 5 },
  input: { backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 12, color: colors.text, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 10, minHeight: 48 },
  button: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  secondaryButton: { backgroundColor: colors.panel2, borderWidth: 1, borderColor: colors.border }, buttonText: { color: '#100D1D', fontWeight: '800', fontSize: 13 },
  card: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: colors.panel, borderRadius: 16, padding: 13, marginBottom: 10, borderWidth: 1, borderColor: colors.border },
  cardArt: { width: 52, height: 52, borderRadius: 12, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center' }, cardArtText: { color: colors.accent, fontSize: 23, fontWeight: '900' },
  cardTitle: { color: colors.text, fontSize: 14, fontWeight: '800' }, cardDesc: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 6 },
  episodeCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.panel, borderRadius: 14, padding: 14, marginBottom: 9, borderWidth: 1, borderColor: colors.border },
  playButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }, playButtonText: { color: '#100D1D', fontWeight: '900', fontSize: 16 },
  empty: { color: colors.muted, paddingVertical: 20, fontSize: 13 }, tabBar: { flexDirection: 'row', backgroundColor: colors.panel, borderTopWidth: 1, borderColor: colors.border, paddingVertical: 12, paddingHorizontal: 4 },
  tabItem: { flex: 1, alignItems: 'center' }, tabLabel: { color: colors.muted, fontSize: 10, fontWeight: '700' }, tabActive: { color: colors.accent2 },
  miniPlayer: { backgroundColor: colors.panel2, borderTopWidth: 1, borderColor: colors.border, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  playerTitle: { color: colors.text, fontSize: 12, fontWeight: '800' }, playerMessage: { color: colors.danger, paddingHorizontal: 14, paddingVertical: 5, fontSize: 11 },
  authWrap: { flex: 1, justifyContent: 'center', padding: 24 }, hero: { color: colors.text, fontSize: 44, lineHeight: 49, fontWeight: '900', marginTop: 26, marginBottom: 12 },
  authCard: { backgroundColor: colors.panel, borderRadius: 20, borderWidth: 1, borderColor: colors.border, padding: 18, marginTop: 26 },
  hint: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 14 }, notice: { color: colors.accent2, fontSize: 12, lineHeight: 18, marginBottom: 10 }, switchAuth: { color: colors.accent2, textAlign: 'center', fontWeight: '700', marginTop: 16 }, error: { color: colors.danger, fontSize: 12, marginBottom: 10 },
  liveCard: { backgroundColor: colors.panel, borderRadius: 16, borderColor: colors.border, borderWidth: 1, padding: 16, marginBottom: 12 },
  livePill: { color: colors.live, fontSize: 10, fontWeight: '900', letterSpacing: 1.2, marginBottom: 10 }, liveRoom: { flex: 1, padding: 18 },
  backLink: { color: colors.accent2, fontWeight: '800', marginVertical: 8 }, discussionCard: { backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 12 }, replyCard: { backgroundColor: colors.panel2, borderRadius: 10, padding: 10, marginTop: 8 }, creatorShow: { backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 12 }, episodeManage: { borderTopWidth: 1, borderColor: colors.border, paddingTop: 12, marginTop: 12 }, stageRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.border }, chatBubble: { backgroundColor: colors.panel2, borderRadius: 10, padding: 9, marginBottom: 7 }, roomPanel: { backgroundColor: colors.panel, borderRadius: 16, padding: 20, marginVertical: 18, minHeight: 120 },
  formCard: { backgroundColor: colors.panel, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14 },
  profileCard: { alignItems: 'center', backgroundColor: colors.panel, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 24, marginBottom: 20 },
  avatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarText: { color: colors.accent, fontSize: 30, fontWeight: '900' }, profileName: { color: colors.text, fontSize: 20, fontWeight: '800', marginBottom: 5 },
});
