import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect } from 'expo-router';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import LottieView from 'lottie-react-native';

import { useAuth } from '../src/context/AuthContext';
import { useUserProfile } from '../src/context/UserProfileContext';
import {
  Colors,
  Radius,
  Shadows,
  Spacing,
  Typography,
} from '../src/theme/colors';

const featureCards = [
  {
    icon: 'star-four-points-outline',
    title: 'Curated prompts',
    text: 'Start from mood, budget, or travel style instead of filling a rigid form.',
  },
  {
    icon: 'airplane-marker',
    title: 'Live route memory',
    text: 'Your searches, airport choices, and profile preferences stay connected.',
  },
  {
    icon: 'cards-heart-outline',
    title: 'Presentation-ready polish',
    text: 'Built to feel intentional enough for a serious product demo.',
  },
];

const WORLD_MAP_FILTERS = [
  { keypath: "**", color: "#FFFFFF" },
  // planes are grey so they pop off the gradient
  ...(['plane', ...Array.from({ length: 26 }, (_, i) => `plane ${i + 2}`)].map(n => ({
    keypath: `${n}.**`,
    color: "#A0A0A0",
  }))),
];

type AuthMode = 'signin' | 'signup' | 'reset';

export default function LoginScreen() {
  const { width: screenWidth } = useWindowDimensions();
  const isWide = screenWidth >= 768;
  const { user, signIn, signUp, resetPassword, authLoading, hasFirebaseConfig } = useAuth();
  const { profileLoading } = useUserProfile();

  const [mode, setMode] = useState<AuthMode>('signin');
  const [firstName, setFirstName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [authTransition, setAuthTransition] = useState(false);
  const [showTakeoff, setShowTakeoff] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const heroShift = useRef(new Animated.Value(22)).current;
  const heroFade = useRef(new Animated.Value(0)).current;
  const cardShift = useRef(new Animated.Value(28)).current;
  const cardFade = useRef(new Animated.Value(0)).current;
  const glowScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(heroShift, {
        toValue: 0,
        duration: 650,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(heroFade, {
        toValue: 1,
        duration: 520,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(cardShift, {
        toValue: 0,
        duration: 760,
        delay: 90,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(cardFade, {
        toValue: 1,
        duration: 620,
        delay: 120,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(glowScale, {
          toValue: 1.04,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(glowScale, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [cardFade, cardShift, glowScale, heroFade, heroShift]);


  const title = useMemo(() => {
    if (mode === 'signup') return 'Create your travel identity';
    if (mode === 'reset') return 'Reset your access';
    return 'Pick up where your last route left off';
  }, [mode]);

  const subtitle = useMemo(() => {
    if (mode === 'signup') return 'Save your preferences, route memories, and assistant context in one place.';
    if (mode === 'reset') return 'Enter your email and we will send a password reset link.';
    return 'Sign in to reopen saved searches, preferred cabin style, and live travel prompts.';
  }, [mode]);

  const handleSubmit = async () => {
    if (!hasFirebaseConfig) {
      Alert.alert('Firebase not configured', 'Add the Expo public Firebase environment variables before using authentication.');
      return;
    }

    if (!email.trim()) {
      Alert.alert('Missing email', 'Enter your email address first.');
      return;
    }

    if (mode !== 'reset' && !password.trim()) {
      Alert.alert('Missing password', 'Enter your password first.');
      return;
    }

    if (mode === 'signup' && password !== confirmPassword) {
      Alert.alert('Passwords do not match', 'Use the same password in both fields.');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'signin') {
        setAuthTransition(true);
        await signIn(email.trim(), password);
        setShowTakeoff(true);
      } else if (mode === 'signup') {
        setAuthTransition(true);
        await signUp(email.trim(), password, firstName.trim());
        setShowTakeoff(true);
      } else {
        await resetPassword(email.trim());
        setResetSent(true);
      }
    } catch (error) {
      setAuthTransition(false);
      const message = error instanceof Error ? error.message : 'Authentication failed.';
      Alert.alert('Authentication error', message);
    } finally {
      setSubmitting(false);
    }
  };

  const isBusy = authLoading || submitting || profileLoading;

  if (user && !authTransition && !showTakeoff) {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <LinearGradient
        colors={["#1E7BC2", "#3A96D0", "#73B9E2", "#BDD9EE", "#E5EDF4"]}
        locations={[0, 0.22, 0.48, 0.70, 1]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          <Animated.View
            style={[
              styles.heroSection,
              {
                opacity: heroFade,
                transform: [{ translateY: heroShift }],
              },
            ]}
          >
            <View style={styles.topRow}>
              <View style={styles.brandPill}>
                <MaterialCommunityIcons name="airplane-takeoff" size={16} color={Colors.textOnDark} />
                <Text style={styles.brandPillText}>Skylin</Text>
              </View>

              <View style={[styles.statusPill, !hasFirebaseConfig && styles.statusPillWarn]}>
                <Text style={styles.statusPillText}>{hasFirebaseConfig ? 'Cloud auth ready' : 'Firebase setup needed'}</Text>
              </View>
            </View>

            {isWide ? (
              <View style={styles.heroWrapper}>
                <View style={styles.heroTextColumn}>
                  <Text style={styles.heroEyebrow}>Editorial travel assistant</Text>
                  <Text style={styles.heroTitle}>A flight search experience with memory, taste, and speed.</Text>
                  <Text style={styles.heroSubtitle}>
                    Save route intent, reopen searches instantly, and move from inspiration to live results without losing context.
                  </Text>
                </View>
                <View style={styles.heroLottieContainer}>
                  <LottieView
                    source={require('../assets/World map.json')}
                    autoPlay
                    loop
                    resizeMode="contain"
                    style={styles.heroLottie}
                    colorFilters={WORLD_MAP_FILTERS}
                  />
                </View>
              </View>
            ) : (
              <View style={styles.heroWrapperMobile}>
                <View style={styles.heroLottieContainerMobile}>
                  <LottieView
                    source={require('../assets/World map.json')}
                    autoPlay
                    loop
                    resizeMode="contain"
                    style={styles.heroLottieMobile}
                    colorFilters={WORLD_MAP_FILTERS}
                  />
                </View>
                <Text style={styles.heroEyebrow}>Editorial travel assistant</Text>
                <Text style={styles.heroTitle}>A flight search experience with memory, taste, and speed.</Text>
                <Text style={styles.heroSubtitle}>
                  Save route intent, reopen searches instantly, and move from inspiration to live results without losing context.
                </Text>
              </View>
            )}

            <View style={styles.featureStack}>
              {featureCards.map((feature, index) => (
                <Animated.View
                  key={feature.title}
                  style={[
                    styles.featureCard,
                    {
                      opacity: heroFade,
                      transform: [
                        {
                          translateY: heroShift.interpolate({
                            inputRange: [0, 22],
                            outputRange: [0, 22 + index * 4],
                          }),
                        },
                        { scale: glowScale },
                      ],
                    },
                  ]}
                >
                  <View style={styles.featureIconWrap}>
                    <MaterialCommunityIcons name={feature.icon as never} size={18} color={Colors.accent} />
                  </View>
                  <View style={styles.featureBody}>
                    <Text style={styles.featureTitle}>{feature.title}</Text>
                    <Text style={styles.featureText}>{feature.text}</Text>
                  </View>
                </Animated.View>
              ))}
            </View>
          </Animated.View>

          <Animated.View
            style={[
              styles.card,
              {
                opacity: cardFade,
                transform: [{ translateY: cardShift }],
              },
            ]}
          >
            <Text style={styles.cardEyebrow}>{mode === 'signin' ? 'Welcome back' : mode === 'signup' ? 'New traveler' : 'Password reset'}</Text>
            <Text style={styles.cardTitle}>{title}</Text>
            <Text style={styles.cardSubtitle}>{subtitle}</Text>

            <View style={styles.fieldStack}>
              {mode === 'signup' ? (
                <View style={styles.fieldCard}>
                  <Text style={styles.fieldLabel}>First name</Text>
                  <TextInput
                    value={firstName}
                    onChangeText={setFirstName}
                    placeholder="How should we call you?"
                    placeholderTextColor={Colors.textMuted}
                    style={styles.input}
                    autoCapitalize="words"
                  />
                </View>
              ) : null}

              <View style={styles.fieldCard}>
                <Text style={styles.fieldLabel}>Email</Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                />
              </View>

              {mode !== 'reset' ? (
                <View style={styles.fieldCard}>
                  <Text style={styles.fieldLabel}>Password</Text>
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Your password"
                    placeholderTextColor={Colors.textMuted}
                    secureTextEntry
                    style={styles.input}
                  />
                </View>
              ) : null}

              {mode === 'signup' ? (
                <View style={styles.fieldCard}>
                  <Text style={styles.fieldLabel}>Confirm password</Text>
                  <TextInput
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    placeholder="Repeat your password"
                    placeholderTextColor={Colors.textMuted}
                    secureTextEntry
                    style={styles.input}
                  />
                </View>
              ) : null}
            </View>

            {!hasFirebaseConfig ? (
              <View style={styles.warningCard}>
                <Feather name="alert-circle" size={16} color={Colors.primaryDeep} />
                <Text style={styles.warningText}>
                  Add the Expo public Firebase keys in your environment before trying auth flows.
                </Text>
              </View>
            ) : null}

            {mode === 'reset' && resetSent ? (
              <View style={styles.resetSuccessCard}>
                <View style={styles.resetSuccessIconWrap}>
                  <Feather name="mail" size={22} color={Colors.accent} />
                </View>
                <View style={styles.resetSuccessBody}>
                  <Text style={styles.resetSuccessTitle}>Email trimis!</Text>
                  <Text style={styles.resetSuccessText}>
                    Verifică căsuța poștală pentru{' '}
                    <Text style={styles.resetSuccessEmail}>{email.trim()}</Text>
                    {' '}și urmează instrucțiunile pentru a-ți reseta parola.
                  </Text>
                  <Text style={styles.resetSuccessHint}>
                    Dacă nu găsești emailul, verifică și folderul Spam.
                  </Text>
                </View>
                <Pressable
                  style={styles.resetSuccessBtn}
                  onPress={() => {
                    setResetSent(false);
                    setEmail('');
                    setMode('signin');
                  }}
                >
                  <Feather name="arrow-left" size={14} color={Colors.textOnDark} />
                  <Text style={styles.resetSuccessBtnText}>Înapoi la autentificare</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                style={[styles.primaryButton, isBusy && styles.primaryButtonDisabled]}
                onPress={handleSubmit}
                disabled={isBusy}
              >
                <Text style={styles.primaryButtonText}>
                  {isBusy ? 'Working…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
                </Text>
                <Feather name="arrow-right" size={16} color={Colors.textOnDark} />
              </Pressable>
            )}

            {!(mode === 'reset' && resetSent) ? (
              <View style={styles.modeLinks}>
                {mode !== 'signin' ? (
                  <Pressable onPress={() => { setMode('signin'); setResetSent(false); }}>
                    <Text style={styles.modeLink}>Back to sign in</Text>
                  </Pressable>
                ) : (
                  <Pressable onPress={() => { setMode('reset'); setResetSent(false); }}>
                    <Text style={styles.modeLink}>Forgot password?</Text>
                  </Pressable>
                )}

                <Pressable onPress={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setResetSent(false); }}>
                  <Text style={styles.modeLink}>{mode === 'signup' ? 'Already have an account?' : 'Create a new account'}</Text>
                </Pressable>
              </View>
            ) : null}
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>

      {showTakeoff ? (
        <View style={styles.takeoffOverlay} pointerEvents="none">
          <View style={styles.takeoffBackdrop} />
          <LottieView
            source={require('../assets/plane.json')}
            autoPlay
            loop={false}
            onAnimationFinish={() => {
              setShowTakeoff(false);
              setAuthTransition(false);
            }}
            style={styles.takeoffAnimation}
          />
          <Text style={styles.takeoffText}>Boarding your workspace…</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#1E7BC2',
  },
  flex: {
    flex: 1,
  },
  container: {
    padding: Spacing.lg,
    paddingBottom: 48,
    gap: 22,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginBottom: 20,
  },
  heroSection: {
    paddingTop: 10,
  },
  brandPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceDark,
    ...Shadows.soft,
  },
  brandPillText: {
    color: Colors.textOnDark,
    fontFamily: Typography.sansBold,
    fontSize: 12,
  },
  statusPill: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  statusPillWarn: {
    backgroundColor: Colors.secondarySoft,
    borderColor: 'transparent',
  },
  statusPillText: {
    color: '#FFFFFF',
    fontFamily: Typography.sansBold,
    fontSize: 11,
  },
  heroWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 16,
  },
  heroWrapperMobile: {
    marginBottom: 16,
  },
  heroLottieContainerMobile: {
    width: 220,
    height: 165,
    overflow: 'hidden',
    alignSelf: 'center',
    marginBottom: 16,
  },
  heroLottieMobile: {
    width: 220,
    height: 165,
  },
  heroTextColumn: {
    flex: 1,
    minWidth: 0,
  },
  heroLottieContainer: {
    width: 560,
    height: 420,
    flexShrink: 0,
    overflow: 'hidden',
  },
  heroLottie: {
    width: 560,
    height: 420,
  },
  heroEyebrow: {
    color: 'rgba(255,255,255,0.75)',
    fontFamily: Typography.sansBold,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  heroTitle: {
    color: '#FFFFFF',
    fontFamily: Typography.display,
    fontSize: 38,
    lineHeight: 42,
    marginBottom: 12,
  },
  heroSubtitle: {
    color: 'rgba(255,255,255,0.82)',
    fontFamily: Typography.sans,
    fontSize: 15,
    lineHeight: 24,
    maxWidth: 340,
    marginBottom: 20,
  },
  featureStack: {
    gap: 12,
  },
  featureCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: Colors.surfaceRaised,
    borderRadius: Radius.xl,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.soft,
  },
  featureIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accentSoft,
  },
  featureBody: {
    flex: 1,
  },
  featureTitle: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansBold,
    fontSize: 15,
    marginBottom: 4,
  },
  featureText: {
    color: Colors.textSecondary,
    fontFamily: Typography.sans,
    fontSize: 13,
    lineHeight: 19,
  },
  card: {
    backgroundColor: Colors.surfaceRaised,
    borderRadius: Radius.xl,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.card,
  },
  cardEyebrow: {
    color: Colors.accent,
    fontFamily: Typography.sansBold,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  cardTitle: {
    color: Colors.textPrimary,
    fontFamily: Typography.display,
    fontSize: 30,
    lineHeight: 31,
    marginBottom: 8,
  },
  cardSubtitle: {
    color: Colors.textSecondary,
    fontFamily: Typography.sans,
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 18,
  },
  fieldStack: {
    gap: 10,
  },
  fieldCard: {
    backgroundColor: '#E8F7FF',
    borderRadius: Radius.lg,
    padding: 14,
  },
  fieldLabel: {
    color: Colors.textMuted,
    fontFamily: Typography.sansBold,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  input: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansMedium,
    fontSize: 15,
    paddingVertical: Platform.OS === 'ios' ? 8 : 6,
  },
  warningCard: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: Radius.lg,
    padding: 12,
    backgroundColor: Colors.secondarySoft,
  },
  warningText: {
    flex: 1,
    color: Colors.primaryDeep,
    fontFamily: Typography.sansSemiBold,
    fontSize: 12,
    lineHeight: 18,
  },
  primaryButton: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: Radius.pill,
    paddingVertical: 15,
    backgroundColor: Colors.primary,
  },
  primaryButtonDisabled: {
    opacity: 0.7,
  },
  primaryButtonText: {
    color: Colors.textOnDark,
    fontFamily: Typography.sansBold,
    fontSize: 14,
  },
  modeLinks: {
    marginTop: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  modeLink: {
    color: Colors.accent,
    fontFamily: Typography.sansBold,
    fontSize: 12,
  },
  resetSuccessCard: {
    marginTop: 16,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.accentSoft,
    backgroundColor: Colors.accentSoft,
    padding: 16,
    gap: 12,
  },
  resetSuccessIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.soft,
  },
  resetSuccessBody: {
    gap: 6,
  },
  resetSuccessTitle: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansBold,
    fontSize: 16,
  },
  resetSuccessText: {
    color: Colors.textSecondary,
    fontFamily: Typography.sans,
    fontSize: 13,
    lineHeight: 20,
  },
  resetSuccessEmail: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansBold,
  },
  resetSuccessHint: {
    color: Colors.textMuted,
    fontFamily: Typography.sans,
    fontSize: 12,
    lineHeight: 17,
  },
  resetSuccessBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: Radius.pill,
    paddingVertical: 12,
    backgroundColor: Colors.primary,
    marginTop: 4,
  },
  resetSuccessBtnText: {
    color: Colors.textOnDark,
    fontFamily: Typography.sansBold,
    fontSize: 13,
  },
  takeoffOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  takeoffBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(32, 24, 20, 0.72)',
  },
  takeoffAnimation: {
    width: 220,
    height: 220,
  },
  takeoffText: {
    marginTop: -12,
    color: Colors.textOnDark,
    fontFamily: Typography.sansBold,
    fontSize: 14,
  },
});