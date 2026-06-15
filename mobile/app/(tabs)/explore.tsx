import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRef, useEffect } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';

import {
  Colors,
  Radius,
  Shadows,
  Spacing,
  Typography,
} from '../../src/theme/colors';
import { SavedBooking, SavedSearch, useUserProfile } from '../../src/context/UserProfileContext';

const quickIdeas = [
  {
    title: 'Romantic weekend',
    note: 'Short-haul city break with mood',
    prompt: 'A romantic weekend in Rome from Bucharest under 350 euro',
    icon: 'heart-outline',
  },
  {
    title: 'Warm reset',
    note: 'Sun, direct when possible',
    prompt: 'Take me somewhere warm and sunny under 300 euro round trip',
    icon: 'white-balance-sunny',
  },
  {
    title: 'Culture trip',
    note: 'Museums, walkability, quick escape',
    prompt: 'A cultural weekend in Europe under 250 euro, direct if possible',
    icon: 'bank',
  },
];

function buildSearchAgainText(search: SavedSearch) {
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

function formatRouteWindow(search: SavedSearch) {
  if (!search.departureDate) return 'Dates flexible';
  if (!search.returnDate) return `${search.departureDate} · One way`;
  return `${search.departureDate} → ${search.returnDate}`;
}

function formatBookingWindow(booking: SavedBooking) {
  if (!booking.returnDate) return `${booking.departureDate} · One way`;
  return `${booking.departureDate} → ${booking.returnDate}`;
}

function formatBookingStatus(status: SavedBooking['status']) {
  return status === 'processing' ? 'Pending' : 'Confirmed';
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

function AnimatedPlane() {
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(x, { toValue: 1, duration: 1800, useNativeDriver: true }),
        Animated.delay(700),
        Animated.timing(x, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return (
    <Animated.View style={{ transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [-6, 6] }) }] }}>
      <MaterialCommunityIcons name="airplane" size={15} color={Colors.primary} />
    </Animated.View>
  );
}

function IdeaCard({ idea, onPress }: { idea: typeof quickIdeas[0]; onPress: () => void }) {
  const scale = useRef(new Animated.Value(1)).current;
  const onPressIn = () =>
    Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, friction: 8 }).start();
  const onPressOut = () =>
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 6 }).start();
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable style={styles.ideaCard} onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut}>
        <View style={styles.ideaIconWrap}>
          <MaterialCommunityIcons name={idea.icon as any} size={20} color={Colors.accent} />
        </View>
        <View style={styles.ideaBody}>
          <Text style={styles.ideaTitle}>{idea.title}</Text>
          <Text style={styles.ideaNote}>{idea.note}</Text>
          <Text style={styles.ideaPrompt}>{idea.prompt}</Text>
        </View>
        <Feather name="arrow-up-right" size={18} color={Colors.textSecondary} />
      </Pressable>
    </Animated.View>
  );
}

export default function TripsScreen() {
  const { profile, savedSearches, bookings, setPendingChatPrefill } = useUserProfile();
  const router = useRouter();

  const launchPrompt = (prompt: string) => {
    setPendingChatPrefill(prompt);
    router.push('/(tabs)');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <AnimatedCard delay={0}>
          <View style={styles.heroCard}>
            <View style={styles.heroOrbWarm} />
            <View style={styles.heroOrbCool} />

            <Text style={styles.heroEyebrow}>Trip atlas</Text>
            <Text style={styles.heroTitle}>Keep your best routes within reach.</Text>
            <Text style={styles.heroSubtitle}>
              Use saved searches as launch points, keep a few moods ready, and move back into the assistant with one tap.
            </Text>

            <View style={styles.heroStatsRow}>
              <View style={styles.heroStatCard}>
                <Text style={styles.heroStatValue}>{savedSearches.length}</Text>
                <Text style={styles.heroStatLabel}>Saved route memories</Text>
              </View>
              <View style={styles.heroStatCardWide}>
                <Text style={styles.heroStatValueSmall}>{profile.tripPace}</Text>
                <Text style={styles.heroStatLabel}>Current travel rhythm</Text>
              </View>
            </View>
          </View>
        </AnimatedCard>

        <AnimatedCard delay={80}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionEyebrow}>Booked trips</Text>
            <Text style={styles.sectionTitle}>Recent checkout activity</Text>
          </View>
        </AnimatedCard>

        <AnimatedCard delay={130}>
          <View style={styles.routeStack}>
            {bookings.length === 0 ? (
              <View style={styles.emptyCard}>
                <MaterialCommunityIcons name="credit-card-check-outline" size={24} color={Colors.accent} />
                <Text style={styles.emptyTitle}>No bookings yet</Text>
                <Text style={styles.emptyText}>
                  Complete a checkout from the assistant and the confirmation will appear here as part of your demo trail.
                </Text>
              </View>
            ) : (
              bookings.map((booking, index) => (
                <View key={booking.id ?? `${booking.bookingReference}-${index}`} style={styles.routeCard}>
                  <View style={styles.routeTopRow}>
                    <View>
                      <View style={styles.routeTitleRow}>
                        <Text style={styles.routeCity}>{booking.originCity}</Text>
                        <AnimatedPlane />
                        <Text style={styles.routeCity}>{booking.destinationCity}</Text>
                      </View>
                      <Text style={styles.routeSubtitle}>{formatBookingWindow(booking)}</Text>
                    </View>
                    <Text
                      style={[
                        styles.routeMode,
                        booking.status === 'processing' ? styles.routeModeProcessing : styles.routeModeSuccess,
                      ]}>
                      {formatBookingStatus(booking.status)}
                    </Text>
                  </View>

                  <View style={styles.routeMetaRow}>
                    <Text style={styles.routeMetaChip}>{booking.supplier} • {booking.airline || 'Live supplier fare'}</Text>
                    <Text style={styles.routeMetaChip}>{booking.amount} {booking.currency}</Text>
                    <Text style={styles.routeMetaChip}>Ref {booking.bookingReference}</Text>
                  </View>

                  <Text style={styles.bookingNote}>
                    {booking.status === 'processing'
                      ? `Payment cleared. Supplier confirmation expected by ${booking.estimatedConfirmationAt || 'shortly'}.`
                      : `Charged on ${booking.cardBrand.toUpperCase()} ending in ${booking.cardLast4} for ${booking.travelerName}.`}
                  </Text>
                </View>
              ))
            )}
          </View>
        </AnimatedCard>

        <AnimatedCard delay={200}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionEyebrow}>Launch pads</Text>
            <Text style={styles.sectionTitle}>Start from a feeling</Text>
          </View>
        </AnimatedCard>

        <View style={styles.ideaStack}>
          {quickIdeas.map((idea, index) => (
            <AnimatedCard key={idea.title} delay={250 + index * 70}>
              <IdeaCard idea={idea} onPress={() => launchPrompt(idea.prompt)} />
            </AnimatedCard>
          ))}
        </View>

        <AnimatedCard delay={480}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionEyebrow}>Recent searches</Text>
            <Text style={styles.sectionTitle}>Return to a route</Text>
          </View>
        </AnimatedCard>

        <AnimatedCard delay={530}>
          <View style={styles.routeStack}>
            {savedSearches.length === 0 ? (
              <View style={styles.emptyCard}>
                <MaterialCommunityIcons name="map-search-outline" size={24} color={Colors.accent} />
                <Text style={styles.emptyTitle}>No saved routes yet</Text>
                <Text style={styles.emptyText}>
                  Once you search through the assistant, the strongest route context will start appearing here.
                </Text>
              </View>
            ) : (
              savedSearches.map((search, index) => (
                <View key={search.id ?? `${search.originCity}-${search.destinationCity}-${index}`} style={styles.routeCard}>
                  <View style={styles.routeTopRow}>
                    <View>
                      <View style={styles.routeTitleRow}>
                        <Text style={styles.routeCity}>{search.originCity ?? '?'}</Text>
                        <AnimatedPlane />
                        <Text style={styles.routeCity}>{search.destinationCity ?? '?'}</Text>
                      </View>
                      <Text style={styles.routeSubtitle}>{formatRouteWindow(search)}</Text>
                    </View>
                    <Text style={styles.routeMode}>
                      {search.tripType === 'round_trip' ? 'Round trip' : 'One way'}
                    </Text>
                  </View>

                  <View style={styles.routeMetaRow}>
                    <Text style={styles.routeMetaChip}>Airport {search.originAirportCode ?? '—'} → {search.destinationAirportCode ?? '—'}</Text>
                    <Text style={styles.routeMetaChip}>{search.passengers ?? 1} traveler{(search.passengers ?? 1) > 1 ? 's' : ''}</Text>
                  </View>

                  <Pressable style={styles.routeAction} onPress={() => launchPrompt(buildSearchAgainText(search))}>
                    <Text style={styles.routeActionText}>Search again</Text>
                    <Feather name="arrow-right" size={15} color={Colors.textOnDark} />
                  </Pressable>
                </View>
              ))
            )}
          </View>
        </AnimatedCard>

        <AnimatedCard delay={600}>
          <View style={styles.styleCard}>
            <View style={styles.sectionHeaderCompact}>
              <Text style={styles.sectionEyebrow}>Travel signature</Text>
              <Text style={styles.sectionTitle}>Your preference moodboard</Text>
            </View>

            <View style={styles.preferenceChipWrap}>
              <View style={styles.preferenceChip}>
                <Text style={styles.preferenceLabel}>Cabin</Text>
                <Text style={styles.preferenceValue}>{profile.cabinStyle}</Text>
              </View>
              <View style={styles.preferenceChip}>
                <Text style={styles.preferenceLabel}>Pace</Text>
                <Text style={styles.preferenceValue}>{profile.tripPace}</Text>
              </View>
              <View style={[styles.preferenceChip, styles.preferenceChipFull]}>
                <Text style={styles.preferenceLabel}>Booking mode</Text>
                <Text style={styles.preferenceValue}>{profile.bookingMode}</Text>
              </View>
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
  heroOrbWarm: {
    position: 'absolute',
    top: -30,
    right: -12,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: Colors.primary,
    opacity: 0.24,
  },
  heroOrbCool: {
    position: 'absolute',
    bottom: -40,
    left: -20,
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: Colors.accent,
    opacity: 0.16,
  },
  heroEyebrow: {
    color: Colors.secondarySoft,
    fontFamily: Typography.sansBold,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  heroTitle: {
    color: Colors.textOnDark,
    fontFamily: Typography.display,
    fontSize: 38,
    lineHeight: 40,
    marginBottom: 10,
    maxWidth: 320,
  },
  heroSubtitle: {
    color: 'rgba(255, 248, 240, 0.78)',
    fontFamily: Typography.sans,
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 18,
    maxWidth: 320,
  },
  heroStatsRow: {
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
  sectionHeader: {
    marginTop: 4,
  },
  sectionHeaderCompact: {
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
  ideaStack: {
    gap: 12,
  },
  ideaCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    backgroundColor: Colors.surfaceRaised,
    borderRadius: Radius.xl,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.soft,
  },
  ideaIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accentSoft,
  },
  ideaBody: {
    flex: 1,
  },
  ideaTitle: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansBold,
    fontSize: 16,
    marginBottom: 4,
  },
  ideaNote: {
    color: Colors.accent,
    fontFamily: Typography.sansSemiBold,
    fontSize: 12,
    marginBottom: 8,
  },
  ideaPrompt: {
    color: Colors.textSecondary,
    fontFamily: Typography.sans,
    fontSize: 13,
    lineHeight: 19,
  },
  routeStack: {
    gap: 12,
  },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: Colors.surfaceRaised,
    borderRadius: Radius.xl,
    padding: 22,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
  },
  emptyTitle: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansBold,
    fontSize: 17,
  },
  emptyText: {
    color: Colors.textSecondary,
    fontFamily: Typography.sans,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  routeCard: {
    backgroundColor: Colors.surfaceRaised,
    borderRadius: Radius.xl,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
    ...Shadows.soft,
  },
  routeTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  routeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  routeCity: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansBold,
    fontSize: 17,
  },
  routeTitle: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansBold,
    fontSize: 17,
    marginBottom: 4,
  },
  routeSubtitle: {
    color: Colors.textSecondary,
    fontFamily: Typography.sansMedium,
    fontSize: 12,
  },
  routeMode: {
    color: Colors.primaryDeep,
    backgroundColor: Colors.secondarySoft,
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontFamily: Typography.sansBold,
    fontSize: 11,
  },
  routeModeSuccess: {
    color: Colors.success,
    backgroundColor: Colors.accentSoft,
  },
  routeModeProcessing: {
    color: Colors.accent,
    backgroundColor: Colors.skySoft,
  },
  routeMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  routeMetaChip: {
    color: Colors.textPrimary,
    backgroundColor: Colors.surfaceSoft,
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontFamily: Typography.sansSemiBold,
    fontSize: 12,
  },
  routeAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: Radius.pill,
    paddingVertical: 13,
  },
  routeActionText: {
    color: Colors.textOnDark,
    fontFamily: Typography.sansBold,
    fontSize: 13,
  },
  bookingNote: {
    color: Colors.textSecondary,
    fontFamily: Typography.sans,
    fontSize: 13,
    lineHeight: 19,
  },
  styleCard: {
    backgroundColor: Colors.surfaceRaised,
    borderRadius: Radius.xl,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.soft,
  },
  preferenceChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  preferenceChip: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: Colors.surfaceSoft,
    borderRadius: Radius.lg,
    padding: 14,
  },
  preferenceChipFull: {
    flexBasis: '100%',
    flex: 0,
  },
  preferenceLabel: {
    color: Colors.textMuted,
    fontFamily: Typography.sansBold,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  preferenceValue: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansSemiBold,
    fontSize: 15,
  },
});
