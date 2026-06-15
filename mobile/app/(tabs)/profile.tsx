import { useState, useRef, useEffect } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import LottieView from 'lottie-react-native';

import { useAuth } from '../../src/context/AuthContext';
import {
  Colors,
  Radius,
  Shadows,
  Spacing,
  Typography,
} from '../../src/theme/colors';
import { SavedSearch, useUserProfile } from '../../src/context/UserProfileContext';

function buildSearchAgainText(search: SavedSearch): string {
  const parts: string[] = [];
  if (search.originCity && search.destinationCity) {
    parts.push(`${search.tripType === 'round_trip' ? 'Round trip' : 'One way'} from ${search.originCity} to ${search.destinationCity}`);
  } else if (search.destinationCity) {
    parts.push(`Flight to ${search.destinationCity}`);
  }
  if (search.departureDate) parts.push(`departing ${search.departureDate}`);
  if (search.returnDate) parts.push(`returning ${search.returnDate}`);
  if (search.passengers && search.passengers > 1) parts.push(`${search.passengers} passengers`);
  return parts.join(', ');
}

function AnimatedCard({ delay = 0, children, style }: { delay?: number; children: React.ReactNode; style?: any }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(anim, {
      toValue: 1,
      useNativeDriver: true,
      friction: 7,
      tension: 50,
      delay,
    }).start();
  }, []);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [22, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

function ScalePress({ children, style, onPress, disabled }: { children: React.ReactNode; style?: any; onPress?: () => void; disabled?: boolean }) {
  const scale = useRef(new Animated.Value(1)).current;
  const onPressIn = () =>
    Animated.spring(scale, { toValue: 0.95, useNativeDriver: true, friction: 8 }).start();
  const onPressOut = () =>
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 6 }).start();
  return (
    <Animated.View style={[style, { transform: [{ scale }] }]}>
      <Pressable
        style={{ flex: 1 }}
        onPress={onPress}
        onPressIn={!disabled ? onPressIn : undefined}
        onPressOut={!disabled ? onPressOut : undefined}
        disabled={disabled}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}

export default function ProfileScreen() {
  const {
    profile,
    updateProfile,
    profileLoading,
    profileSyncError,
    savedSearches,
    setPendingChatPrefill,
  } = useUserProfile();
  const { signOut, user } = useAuth();
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);

  const avatarScale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(avatarScale, {
      toValue: 1,
      useNativeDriver: true,
      friction: 5,
      tension: 80,
      delay: 60,
    }).start();
  }, []);

  const [formData, setFormData] = useState({
    firstName: profile.firstName,
    email: profile.email,
    cabinStyle: profile.cabinStyle,
    tripPace: profile.tripPace,
    bookingMode: profile.bookingMode,
    needsAccessibleSeating: profile.needsAccessibleSeating,
  });

  const handleSave = () => {
    updateProfile(formData);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setFormData({
      firstName: profile.firstName,
      email: profile.email,
      cabinStyle: profile.cabinStyle,
      tripPace: profile.tripPace,
      bookingMode: profile.bookingMode,
      needsAccessibleSeating: profile.needsAccessibleSeating,
    });
    setIsEditing(false);
  };

  const handleSearchAgain = (search: SavedSearch) => {
    const text = buildSearchAgainText(search);
    if (!text) return;
    setPendingChatPrefill(text);
    router.push('/(tabs)');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <AnimatedCard delay={0}>
          <View style={styles.heroCard}>
            <View style={styles.heroOrbOne} />
            <View style={styles.heroOrbTwo} />

            <View style={styles.avatarRow}>
              <Animated.View style={[styles.avatarWrap, { transform: [{ scale: avatarScale }] }]}>
                <Text style={styles.avatarLetter}>{(profile.firstName || 'A').charAt(0).toUpperCase()}</Text>
              </Animated.View>

              <View style={styles.heroBody}>
                <Text style={styles.heroEyebrow}>Traveler profile</Text>
                <Text style={styles.heroTitle}>{profile.firstName}</Text>
                <Text style={styles.heroSubtitle}>{user?.email || profile.email}</Text>
              </View>
            </View>

            <View style={styles.heroStatRow}>
              <View style={styles.heroStatCard}>
                <Text style={styles.heroStatValue}>{savedSearches.length}</Text>
                <Text style={styles.heroStatLabel}>Saved searches</Text>
              </View>
              <View style={styles.heroStatCardWide}>
                <Text style={styles.heroStatValueSmall}>{profile.bookingMode}</Text>
                <Text style={styles.heroStatLabel}>Booking preference</Text>
              </View>
            </View>

            {profileLoading ? (
              <View style={styles.syncRow}>
                <View style={styles.syncAnimationFrame}>
                  <View style={styles.syncAnimationHalo} />
                  <LottieView
                    source={require('../../assets/Loading sand clock.json')}
                    autoPlay
                    loop
                    style={styles.syncAnimation}
                  />
                </View>
                <Text style={styles.syncInfo}>Syncing profile from cloud…</Text>
              </View>
            ) : null}

            {profileSyncError ? <Text style={styles.syncError}>{profileSyncError}</Text> : null}
          </View>
        </AnimatedCard>

        <AnimatedCard delay={80}>
          <View style={styles.preferenceGrid}>
            <View style={styles.preferenceTile}>
              <View style={styles.preferenceAccent} />
              <Text style={styles.preferenceLabel}>Cabin style</Text>
              <Text style={styles.preferenceValue}>{profile.cabinStyle}</Text>
            </View>
            <View style={styles.preferenceTile}>
              <View style={[styles.preferenceAccent, { backgroundColor: Colors.accent }]} />
              <Text style={styles.preferenceLabel}>Trip pace</Text>
              <Text style={styles.preferenceValue}>{profile.tripPace}</Text>
            </View>
            <View style={styles.preferenceTileWide}>
              <View style={[styles.preferenceAccent, { backgroundColor: Colors.primaryDeep }]} />
              <Text style={styles.preferenceLabel}>Accessibility</Text>
              <Text style={styles.preferenceValue}>{profile.needsAccessibleSeating ? 'Accessible seating required' : 'Standard seating okay'}</Text>
            </View>
          </View>
        </AnimatedCard>

        <AnimatedCard delay={160}>
          <View style={styles.editorCard}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionEyebrow}>Profile editor</Text>
                <Text style={styles.sectionTitle}>Travel settings</Text>
              </View>
              {!isEditing ? (
                <ScalePress style={styles.editPillWrap} onPress={() => setIsEditing(true)}>
                  <View style={styles.editPill}>
                    <Feather name="edit-3" size={14} color={Colors.textOnDark} />
                    <Text style={styles.editPillText}>Edit</Text>
                  </View>
                </ScalePress>
              ) : null}
            </View>

            <View style={styles.fieldStack}>
              <View style={styles.fieldCard}>
                <Text style={styles.fieldLabel}>First name</Text>
                {isEditing ? (
                  <TextInput
                    style={styles.input}
                    value={formData.firstName}
                    onChangeText={(text) => setFormData({ ...formData, firstName: text })}
                    placeholder="Your name"
                    placeholderTextColor={Colors.textMuted}
                  />
                ) : (
                  <Text style={styles.fieldValue}>{profile.firstName}</Text>
                )}
              </View>

              <View style={styles.fieldCard}>
                <Text style={styles.fieldLabel}>Email</Text>
                {isEditing ? (
                  <TextInput
                    style={styles.input}
                    value={formData.email}
                    onChangeText={(text) => setFormData({ ...formData, email: text })}
                    placeholder="your@email.com"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="email-address"
                  />
                ) : (
                  <Text style={styles.fieldValue}>{profile.email}</Text>
                )}
              </View>

              <View style={styles.fieldCard}>
                <Text style={styles.fieldLabel}>Cabin preference</Text>
                {isEditing ? (
                  <TextInput
                    style={styles.input}
                    value={formData.cabinStyle}
                    onChangeText={(text) => setFormData({ ...formData, cabinStyle: text })}
                    placeholder="Economy first"
                    placeholderTextColor={Colors.textMuted}
                  />
                ) : (
                  <Text style={styles.fieldValue}>{profile.cabinStyle}</Text>
                )}
              </View>

              <View style={styles.fieldCard}>
                <Text style={styles.fieldLabel}>Trip pace</Text>
                {isEditing ? (
                  <TextInput
                    style={styles.input}
                    value={formData.tripPace}
                    onChangeText={(text) => setFormData({ ...formData, tripPace: text })}
                    placeholder="City breaks & weekends"
                    placeholderTextColor={Colors.textMuted}
                  />
                ) : (
                  <Text style={styles.fieldValue}>{profile.tripPace}</Text>
                )}
              </View>

              <View style={styles.fieldCard}>
                <Text style={styles.fieldLabel}>Booking mode</Text>
                {isEditing ? (
                  <TextInput
                    style={styles.input}
                    value={formData.bookingMode}
                    onChangeText={(text) => setFormData({ ...formData, bookingMode: text })}
                    placeholder="Flexible suggestions"
                    placeholderTextColor={Colors.textMuted}
                  />
                ) : (
                  <Text style={styles.fieldValue}>{profile.bookingMode}</Text>
                )}
              </View>

              <Pressable
                style={[styles.toggleCard, formData.needsAccessibleSeating && styles.toggleCardActive]}
                onPress={() => {
                  if (!isEditing) return;
                  setFormData({
                    ...formData,
                    needsAccessibleSeating: !formData.needsAccessibleSeating,
                  });
                }}
                disabled={!isEditing}
              >
                <View style={[styles.toggleThumb, formData.needsAccessibleSeating && styles.toggleThumbActive]}>
                  {formData.needsAccessibleSeating ? <Feather name="check" size={14} color={Colors.textOnDark} /> : null}
                </View>
                <View style={styles.toggleBody}>
                  <Text style={styles.toggleTitle}>Accessible seating</Text>
                  <Text style={styles.toggleHint}>Use this when you want the assistant to prioritize accessible seating options.</Text>
                </View>
              </Pressable>
            </View>

            {isEditing ? (
              <View style={styles.buttonRow}>
                <ScalePress style={styles.buttonFlex} onPress={handleCancel}>
                  <View style={styles.secondaryButton}>
                    <Text style={styles.secondaryButtonText}>Cancel</Text>
                  </View>
                </ScalePress>
                <ScalePress style={styles.buttonFlex} onPress={handleSave}>
                  <View style={styles.primaryButton}>
                    <Text style={styles.primaryButtonText}>Save changes</Text>
                  </View>
                </ScalePress>
              </View>
            ) : (
              <View style={styles.buttonColumn}>
                <ScalePress style={styles.buttonBlock} onPress={() => setIsEditing(true)}>
                  <View style={styles.primaryButton}>
                    <Text style={styles.primaryButtonText}>Edit preferences</Text>
                  </View>
                </ScalePress>
                <ScalePress style={styles.buttonBlock} onPress={() => signOut()}>
                  <View style={styles.secondaryButton}>
                    <Text style={styles.secondaryButtonText}>Sign out</Text>
                  </View>
                </ScalePress>
              </View>
            )}
          </View>
        </AnimatedCard>

        <AnimatedCard delay={240}>
          <View style={styles.savedCard}>
            <Text style={styles.sectionEyebrow}>Recent search memory</Text>
            <Text style={styles.sectionTitle}>Jump back into a route</Text>

            <View style={styles.savedStack}>
              {savedSearches.length === 0 ? (
                <Text style={styles.savedEmptyText}>Your saved route history will appear here after you search with the assistant.</Text>
              ) : (
                savedSearches.map((search, index) => (
                  <View key={search.id ?? `${search.originCity}-${search.destinationCity}-${index}`} style={styles.savedRow}>
                    <View style={styles.savedContent}>
                      <Text style={styles.savedRoute}>{search.originCity ?? '?'} → {search.destinationCity ?? '?'}</Text>
                      <Text style={styles.savedMeta}>
                        {search.departureDate ?? 'Dates flexible'}
                        {search.returnDate ? ` → ${search.returnDate}` : ''}
                        {' · '}
                        {search.tripType === 'round_trip' ? 'Round trip' : 'One way'}
                      </Text>
                    </View>

                    <ScalePress style={styles.savedActionWrap} onPress={() => handleSearchAgain(search)}>
                      <View style={styles.savedAction}>
                        <Text style={styles.savedActionText}>Search again</Text>
                      </View>
                    </ScalePress>
                  </View>
                ))
              )}
            </View>
          </View>
        </AnimatedCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  container: {
    padding: Spacing.lg,
    paddingBottom: 140,
    gap: 18,
  },
  heroCard: {
    overflow: 'hidden',
    backgroundColor: Colors.surfaceDark,
    borderRadius: Radius.xl,
    padding: 20,
    ...Shadows.card,
  },
  heroOrbOne: {
    position: 'absolute',
    top: -22,
    right: -10,
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: Colors.primary,
    opacity: 0.22,
  },
  heroOrbTwo: {
    position: 'absolute',
    bottom: -40,
    left: -16,
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: Colors.accent,
    opacity: 0.18,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 18,
  },
  avatarWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 248, 240, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 248, 240, 0.16)',
  },
  avatarLetter: {
    color: Colors.textOnDark,
    fontFamily: Typography.display,
    fontSize: 32,
    lineHeight: 32,
  },
  heroBody: {
    flex: 1,
  },
  heroEyebrow: {
    color: Colors.secondarySoft,
    fontFamily: Typography.sansBold,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  heroTitle: {
    color: Colors.textOnDark,
    fontFamily: Typography.display,
    fontSize: 38,
    lineHeight: 38,
    marginBottom: 4,
  },
  heroSubtitle: {
    color: 'rgba(255, 248, 240, 0.74)',
    fontFamily: Typography.sansMedium,
    fontSize: 13,
  },
  heroStatRow: {
    flexDirection: 'row',
    gap: 10,
  },
  heroStatCard: {
    flex: 1,
    borderRadius: Radius.lg,
    padding: 14,
    backgroundColor: 'rgba(255, 249, 242, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 249, 242, 0.12)',
  },
  heroStatCardWide: {
    flex: 1.35,
    borderRadius: Radius.lg,
    padding: 14,
    backgroundColor: 'rgba(255, 249, 242, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 249, 242, 0.12)',
  },
  heroStatValue: {
    color: Colors.textOnDark,
    fontFamily: Typography.display,
    fontSize: 30,
    lineHeight: 30,
    marginBottom: 6,
  },
  heroStatValueSmall: {
    color: Colors.textOnDark,
    fontFamily: Typography.sansSemiBold,
    fontSize: 13,
    marginBottom: 6,
  },
  heroStatLabel: {
    color: 'rgba(255, 248, 240, 0.72)',
    fontFamily: Typography.sansMedium,
    fontSize: 11,
  },
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
  },
  syncAnimationFrame: {
    width: 34,
    height: 34,
    borderRadius: 17,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(98, 219, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(98, 219, 255, 0.22)',
  },
  syncAnimationHalo: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(98, 219, 255, 0.22)',
  },
  syncAnimation: {
    width: 120,
    height: 120,
    transform: [{ scale: 0.23 }],
  },
  syncInfo: {
    color: Colors.secondarySoft,
    fontFamily: Typography.sansSemiBold,
    fontSize: 12,
  },
  syncError: {
    marginTop: 10,
    color: '#FFD4D4',
    fontFamily: Typography.sansSemiBold,
    fontSize: 12,
    lineHeight: 18,
  },
  preferenceGrid: {
    gap: 10,
  },
  preferenceTile: {
    backgroundColor: Colors.surfaceRaised,
    borderRadius: Radius.lg,
    padding: 16,
    paddingLeft: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    ...Shadows.soft,
  },
  preferenceTileWide: {
    backgroundColor: Colors.surfaceRaised,
    borderRadius: Radius.lg,
    padding: 16,
    paddingLeft: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
    ...Shadows.soft,
  },
  preferenceAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    borderRadius: 2,
    backgroundColor: Colors.primary,
  },
  preferenceLabel: {
    color: Colors.textMuted,
    fontFamily: Typography.sansBold,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.9,
    marginBottom: 6,
  },
  preferenceValue: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansSemiBold,
    fontSize: 15,
  },
  editorCard: {
    backgroundColor: Colors.surfaceRaised,
    borderRadius: Radius.xl,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.soft,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 14,
  },
  sectionEyebrow: {
    color: Colors.accent,
    fontFamily: Typography.sansBold,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  sectionTitle: {
    color: Colors.textPrimary,
    fontFamily: Typography.display,
    fontSize: 28,
    lineHeight: 28,
  },
  editPillWrap: {
    borderRadius: Radius.pill,
  },
  editPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primary,
  },
  editPillText: {
    color: Colors.textOnDark,
    fontFamily: Typography.sansBold,
    fontSize: 12,
  },
  fieldStack: {
    gap: 10,
  },
  fieldCard: {
    backgroundColor: Colors.surfaceSoft,
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
  fieldValue: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansSemiBold,
    fontSize: 15,
  },
  input: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
    backgroundColor: Colors.surfaceRaised,
    color: Colors.textPrimary,
    fontFamily: Typography.sansMedium,
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  toggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: Radius.lg,
    padding: 14,
    backgroundColor: Colors.surfaceSoft,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  toggleCardActive: {
    borderColor: Colors.accent,
  },
  toggleThumb: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.surfaceRaised,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleThumbActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  toggleBody: {
    flex: 1,
  },
  toggleTitle: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansBold,
    fontSize: 15,
    marginBottom: 4,
  },
  toggleHint: {
    color: Colors.textSecondary,
    fontFamily: Typography.sans,
    fontSize: 12,
    lineHeight: 18,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  buttonColumn: {
    gap: 12,
    marginTop: 16,
  },
  buttonFlex: {
    flex: 1,
  },
  buttonBlock: {
    alignSelf: 'stretch',
  },
  primaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primary,
  },
  secondaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceSoft,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  primaryButtonText: {
    color: Colors.textOnDark,
    fontFamily: Typography.sansBold,
    fontSize: 14,
  },
  secondaryButtonText: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansBold,
    fontSize: 14,
  },
  savedCard: {
    backgroundColor: Colors.surfaceRaised,
    borderRadius: Radius.xl,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.soft,
  },
  savedStack: {
    marginTop: 14,
    gap: 10,
  },
  savedEmptyText: {
    color: Colors.textSecondary,
    fontFamily: Typography.sans,
    fontSize: 13,
    lineHeight: 20,
  },
  savedRow: {
    backgroundColor: Colors.surfaceSoft,
    borderRadius: Radius.lg,
    padding: 14,
    gap: 10,
  },
  savedContent: {
    gap: 4,
  },
  savedRoute: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansBold,
    fontSize: 15,
  },
  savedMeta: {
    color: Colors.textSecondary,
    fontFamily: Typography.sansMedium,
    fontSize: 12,
  },
  savedActionWrap: {
    alignSelf: 'flex-start',
    borderRadius: Radius.pill,
  },
  savedAction: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  savedActionText: {
    color: Colors.textOnDark,
    fontFamily: Typography.sansBold,
    fontSize: 12,
  },
});
