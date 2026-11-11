import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable,
  SafeAreaView, ScrollView, StatusBar, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Audio } from 'expo-av';
import * as SecureStore from 'expo-secure-store';
import { AudioSession, LiveKitRoom, registerGlobals } from '@livekit/react-native';
import { api, clearSession, getSavedUser, imageFor, saveSession, signIn, signOut, User, ApiRecord, verifyMfa, registerAccount } from './src/api';
import { colors } from './src/theme';

registerGlobals();

type Tab = 'Discover' | 'Communities' | 'LIVE' | 'Creator' | 'Profile';
type PlayerState = { title: string; show: string; url: string } | null;
const tabs: Tab[] = ['Discover', 'Communities', 'LIVE', 'Creator', 'Profile'];
const arrayOf = (value: any): ApiRecord[] => Array.isArray(value) ? value : Array.isArray(value?.items) ? value.items : Array.isArray(value?.data) ? value.data : [];

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
  const sound = useRef<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playerMessage, setPlayerMessage] = useState('');

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
    return () => { mounted = false; void sound.current?.unloadAsync(); };
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
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: true, shouldDuckAndroid: true });
      const episode = await api<any>('/episodes/' + encodeURIComponent(item.id));
      const member = Boolean(episode.membershipRequired);
      const playback = await api<any>('/episodes/' + encodeURIComponent(item.id) + (member ? '/member-playback-url' : '/playback-url'));
      await sound.current?.unloadAsync();
      const created = await Audio.Sound.createAsync({ uri: playback.url }, { shouldPlay: true });
      sound.current = created.sound;
      setPlayer({ title: episode.title || item.title || 'VOXA episode', show: episode.show?.title || item.show?.title || 'Podcast', url: playback.url });
      setPlaying(true); setPlayerMessage('');
      created.sound.setOnPlaybackStatusUpdate(status => {
        if (status.isLoaded && status.didJustFinish) setPlaying(false);
      });
    } catch (e) { setPlayerMessage(e instanceof Error ? e.message : 'Unable to play this episode'); }
  }

  async function togglePlayback() {
    if (!sound.current) return;
    const status = await sound.current.getStatusAsync();
    if (status.isLoaded && status.isPlaying) { await sound.current.pauseAsync(); setPlaying(false); }
    else { await sound.current.playAsync(); setPlaying(true); }
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
        <Text style={styles.hint}>New accounts can be created on VOXA web. Verify your email before signing in.</Text>
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
      {tab === 'Discover' && <Discover onPlay={playEpisode} />}
      {tab === 'Communities' && <Communities />}
      {tab === 'LIVE' && <Live />}
      {tab === 'Creator' && <Creator />}
      {tab === 'Profile' && <Profile user={user} onSignOut={async () => { await signOut(); setUser(null); }} />}
    </View>
    {player && <View style={styles.miniPlayer}>
      <View style={{ flex: 1 }}><Text numberOfLines={1} style={styles.playerTitle}>{player.title}</Text><Text style={styles.smallMuted}>{player.show}</Text></View>
      <Pressable onPress={togglePlayback} style={styles.playButton}><Text style={styles.playButtonText}>{playing ? 'Ⅱ' : '▶'}</Text></Pressable>
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

function Discover({ onPlay }: { onPlay: (item: ApiRecord) => void }) {
  const [query, setQuery] = useState('');
  const shows = useLoad<ApiRecord>('/discovery/shows?limit=20');
  const episodes = useLoad<ApiRecord>('/discovery/episodes?limit=20');
  const filteredShows = shows.items.filter(x => !query || (x.title || '').toLowerCase().includes(query.toLowerCase()));
  return <ScrollView contentContainerStyle={styles.scroll}>
    <Text style={styles.eyebrow}>FIND YOUR NEXT LISTEN</Text>
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
  </View>;
}

function Communities() {
  const { items, loading, error, refresh } = useLoad<ApiRecord>('/communities');
  const [busyId, setBusyId] = useState('');
  async function join(id: string) {
    setBusyId(id);
    try { await api('/communities/' + encodeURIComponent(id) + '/join', { method: 'POST' }); Alert.alert('Joined', 'You are now a member of this community.'); refresh(); }
    catch (e) { Alert.alert('Could not join', e instanceof Error ? e.message : 'Try again'); }
    finally { setBusyId(''); }
  }
  return <ScrollView contentContainerStyle={styles.scroll}>
    <Text style={styles.eyebrow}>MEET YOUR PEOPLE</Text><Text style={styles.pageTitle}>Communities</Text>
    {loading ? <ActivityIndicator color={colors.accent} /> : error ? <Empty text={error} /> : items.map(item => <ContentCard key={item.id} item={item} subtitle={(item.category || 'Community') + ' · ' + (item._count?.members ?? item.memberCount ?? 0) + ' members'} action={<Button title={busyId === item.id ? '…' : 'Join'} onPress={() => join(item.id)} disabled={!!busyId} />} />)}
    {!loading && !items.length && <Empty text="Communities will appear here." />}
  </ScrollView>;
}

function Live() {
  const { items, loading, error, refresh } = useLoad<ApiRecord>('/live/rooms');
  const [room, setRoom] = useState<{ id: string; token: string; serverUrl: string; title: string } | null>(null);
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
      setRoom({ id: item.id, token: result.token, serverUrl: result.serverUrl || result.url, title: item.title || 'VOXA LIVE' });
    } catch (e) { Alert.alert('Unable to join room', e instanceof Error ? e.message : 'Try again'); }
    finally { setBusy(''); }
  }
  if (room) return <View style={styles.liveRoom}>
    <Text style={styles.livePill}>● CONNECTING TO LIVE</Text><Text style={styles.pageTitle}>{room.title}</Text>
    <Text style={styles.muted}>Your VOXA live room connection is active when the native room reports connected.</Text>
    <LiveKitRoom serverUrl={room.serverUrl} token={room.token} connect={true} audio={true} video={false} onDisconnected={() => setRoom(null)}>
      <View style={[styles.roomPanel, { flex: 1 }]}><Text style={styles.cardTitle}>You are in the room</Text><Text style={styles.smallMuted}>Microphone permissions may be requested by your device.</Text></View>
    </LiveKitRoom>
    <Button title="Leave room" secondary onPress={() => setRoom(null)} />
  </View>;
  return <ScrollView contentContainerStyle={styles.scroll}>
    <Text style={styles.eyebrow}>HAPPENING RIGHT NOW</Text><Text style={styles.pageTitle}>VOXA LIVE</Text>
    {loading ? <ActivityIndicator color={colors.accent} /> : error ? <Empty text={error} /> : items.map(item => <View key={item.id} style={styles.liveCard}>
      <Text style={styles.livePill}>● {item.status || 'LIVE'}</Text><Text style={styles.cardTitle}>{item.title || 'Live conversation'}</Text><Text style={styles.smallMuted}>{item.host?.displayName || item.creator?.user?.displayName || 'VOXA host'}</Text>
      <Text numberOfLines={2} style={styles.cardDesc}>{item.description || 'Join the conversation.'}</Text>
      <Button title={busy === item.id ? 'Joining…' : 'Join room'} onPress={() => join(item)} disabled={!!busy} />
    </View>)}
    {!loading && !items.length && <Empty text="No public live rooms right now. Check back soon." />}
  </ScrollView>;
}

function Creator() {
  const { items, loading, error, refresh } = useLoad<ApiRecord>('/creators/me/shows');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  async function createShow() {
    if (title.trim().length < 2) return;
    setCreating(true);
    try { await api('/shows', { method: 'POST', body: JSON.stringify({ title: title.trim(), description: description.trim() }) }); setTitle(''); setDescription(''); refresh(); Alert.alert('Show created', 'Your new show draft is ready in Creator Studio.'); }
    catch (e) { Alert.alert('Unable to create show', e instanceof Error ? e.message : 'Try again'); }
    finally { setCreating(false); }
  }
  return <ScrollView contentContainerStyle={styles.scroll}>
    <Text style={styles.eyebrow}>YOUR CREATOR WORKSPACE</Text><Text style={styles.pageTitle}>Creator Studio</Text>
    <View style={styles.formCard}><SectionTitle>Create a show</SectionTitle><Field value={title} onChangeText={setTitle} placeholder="Show title" maxLength={120} /><Field value={description} onChangeText={setDescription} placeholder="What is your show about?" multiline /><Button title={creating ? 'Creating…' : 'Create show draft'} onPress={createShow} disabled={creating || title.trim().length < 2} /></View>
    <SectionTitle>Your shows</SectionTitle>
    {loading ? <ActivityIndicator color={colors.accent} /> : error ? <Empty text={error} /> : items.map(item => <ContentCard key={item.id} item={item} subtitle={item.status || 'Show'} />)}
    {!loading && !items.length && <Empty text="Your published and draft shows will appear here." />}
  </ScrollView>;
}

function Profile({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  return <ScrollView contentContainerStyle={styles.scroll}>
    <Text style={styles.eyebrow}>YOUR VOXA ACCOUNT</Text><Text style={styles.pageTitle}>Profile</Text>
    <View style={styles.profileCard}><View style={styles.avatar}><Text style={styles.avatarText}>{user.displayName.slice(0,1).toUpperCase()}</Text></View>
      <Text style={styles.profileName}>{user.displayName}</Text><Text style={styles.muted}>{user.email}</Text><Text style={styles.smallMuted}>Account role: {user.role}</Text></View>
    <Button title="Sign out" secondary onPress={onSignOut} />
  </ScrollView>;
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
  roomPanel: { backgroundColor: colors.panel, borderRadius: 16, padding: 20, marginVertical: 18, minHeight: 120 },
  formCard: { backgroundColor: colors.panel, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14 },
  profileCard: { alignItems: 'center', backgroundColor: colors.panel, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 24, marginBottom: 20 },
  avatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.panel2, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarText: { color: colors.accent, fontSize: 30, fontWeight: '900' }, profileName: { color: colors.text, fontSize: 20, fontWeight: '800', marginBottom: 5 },
});
