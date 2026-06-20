import { useState, useRef, useEffect } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';

import { useAuth } from '../../src/context/AuthContext';
import { Colors, Radius, Shadows, Spacing, Typography } from '../../src/theme/colors';
import { useUserProfile } from '../../src/context/UserProfileContext';

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));
const YEARS = Array.from({ length: 71 }, (_, i) => String(2010 - i)); // 2010 → 1940

function SpinnerColumn({ items, index, onIndex }: {
  items: string[];
  index: number;
  onIndex: (i: number) => void;
}) {
  const clamp = (v: number) => Math.max(0, Math.min(v, items.length - 1));
  return (
    <View style={styles.spinnerCol}>
      <Pressable style={styles.spinnerArrow} onPress={() => onIndex(clamp(index - 1))}>
        <Feather name="chevron-up" size={20} color={Colors.accent} />
      </Pressable>
      <View style={styles.spinnerValueBox}>
        <Text style={styles.spinnerValueText}>{items[index]}</Text>
      </View>
      <Pressable style={styles.spinnerArrow} onPress={() => onIndex(clamp(index + 1))}>
        <Feather name="chevron-down" size={20} color={Colors.accent} />
      </Pressable>
    </View>
  );
}

function DateOfBirthPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);

  const initYear = value ? parseInt(value.slice(0, 4)) : 1990;
  const initMonthIdx = value ? parseInt(value.slice(5, 7)) - 1 : 0;
  const initDayIdx = value ? parseInt(value.slice(8, 10)) - 1 : 0;
  const initYearIdx = YEARS.indexOf(String(initYear));

  const [dayIdx, setDayIdx] = useState(Math.max(0, initDayIdx));
  const [monthIdx, setMonthIdx] = useState(Math.max(0, initMonthIdx));
  const [yearIdx, setYearIdx] = useState(initYearIdx >= 0 ? initYearIdx : YEARS.indexOf('1990'));

  const displayValue = value
    ? `${DAYS[dayIdx]} ${MONTHS_SHORT[monthIdx]} ${YEARS[yearIdx]}`
    : '';

  const handleConfirm = () => {
    const day = parseInt(DAYS[dayIdx]);
    const month = monthIdx + 1;
    const year = parseInt(YEARS[yearIdx]);
    onChange(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    setOpen(false);
  };

  return (
    <>
      <Pressable
        style={[styles.inlineInput, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}
        onPress={() => setOpen(v => !v)}
      >
        <Feather name="calendar" size={15} color={Colors.textMuted} />
        <Text style={[
          { flex: 1, fontFamily: Typography.sansMedium, fontSize: 15 },
          displayValue ? { color: Colors.textPrimary } : { color: Colors.textMuted },
        ]}>
          {displayValue || 'Date of birth'}
        </Text>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={14} color={Colors.textMuted} />
      </Pressable>

      {open && (
        <View style={styles.dobPanel}>
          <View style={styles.dobColLabels}>
            <Text style={styles.dobColLabel}>Day</Text>
            <Text style={styles.dobColLabel}>Month</Text>
            <Text style={styles.dobColLabel}>Year</Text>
          </View>
          <View style={styles.dobSpinnerRow}>
            <SpinnerColumn items={DAYS} index={dayIdx} onIndex={setDayIdx} />
            <View style={styles.dobDivider} />
            <SpinnerColumn items={MONTHS_SHORT} index={monthIdx} onIndex={setMonthIdx} />
            <View style={styles.dobDivider} />
            <SpinnerColumn items={YEARS} index={yearIdx} onIndex={setYearIdx} />
          </View>
          <Pressable style={[styles.saveBtn, { marginTop: 12 }]} onPress={handleConfirm}>
            <Text style={styles.saveBtnText}>Confirm date</Text>
          </Pressable>
        </View>
      )}
    </>
  );
}

function AnimatedCard({ delay = 0, children, style }: { delay?: number; children: React.ReactNode; style?: any }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, friction: 7, tension: 50, delay }).start();
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

export default function ProfileScreen() {
  const { profile, updateProfile, profileLoading, profileSyncError } = useUserProfile();
  const { signOut, user, resetPassword } = useAuth();

  const [editingProfile, setEditingProfile] = useState(false);
  const [editingPrefs, setEditingPrefs] = useState(false);
  const [passwordSent, setPasswordSent] = useState(false);
  const [passwordError, setPasswordError] = useState(false);

  const [profileForm, setProfileForm] = useState({
    firstName: profile.firstName,
    lastName: profile.lastName,
    email: profile.email,
    gender: profile.gender,
    phoneNumber: profile.phoneNumber,
    dateOfBirth: profile.dateOfBirth,
  });

  const [prefsForm, setPrefsForm] = useState({
    cabinStyle: profile.cabinStyle,
    tripPace: profile.tripPace,
    bookingMode: profile.bookingMode,
    needsAccessibleSeating: profile.needsAccessibleSeating,
  });

  useEffect(() => {
    setProfileForm({
      firstName: profile.firstName,
      lastName: profile.lastName,
      email: profile.email,
      gender: profile.gender,
      phoneNumber: profile.phoneNumber,
      dateOfBirth: profile.dateOfBirth,
    });
    setPrefsForm({
      cabinStyle: profile.cabinStyle,
      tripPace: profile.tripPace,
      bookingMode: profile.bookingMode,
      needsAccessibleSeating: profile.needsAccessibleSeating,
    });
  }, [profile]);

  const avatarScale = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(avatarScale, { toValue: 1, useNativeDriver: true, friction: 5, tension: 80, delay: 60 }).start();
  }, []);

  const handleSaveProfile = () => {
    updateProfile(profileForm);
    setEditingProfile(false);
  };

  const handleSavePrefs = () => {
    updateProfile(prefsForm);
    setEditingPrefs(false);
  };

  const handleChangePassword = async () => {
    const email = user?.email || profile.email;
    if (!email) return;
    try {
      await resetPassword(email);
      setPasswordSent(true);
      setPasswordError(false);
      setTimeout(() => setPasswordSent(false), 5000);
    } catch {
      setPasswordError(true);
      setTimeout(() => setPasswordError(false), 4000);
    }
  };

  const displayName = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
  const initials = [profile.firstName?.[0], profile.lastName?.[0]]
    .filter(Boolean)
    .join('')
    .toUpperCase() || (profile.firstName?.[0] || 'A').toUpperCase();

  const parsedDOB = profile.dateOfBirth
    ? `${DAYS[parseInt(profile.dateOfBirth.slice(8, 10)) - 1]} ${MONTHS_SHORT[parseInt(profile.dateOfBirth.slice(5, 7)) - 1]} ${profile.dateOfBirth.slice(0, 4)}`
    : null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>

        {/* ── Card 1: Identity ─────────────────────────────────── */}
        <AnimatedCard delay={0}>
          <View style={styles.identityCard}>
            <View style={styles.orbA} />
            <View style={styles.orbB} />

            <View style={styles.identityRow}>
              <Animated.View style={[styles.avatarCircle, { transform: [{ scale: avatarScale }] }]}>
                <Text style={styles.avatarInitials}>{initials}</Text>
              </Animated.View>

              <View style={styles.identityInfo}>
                <Text style={styles.idEyebrow}>Traveler profile</Text>
                <Text style={styles.idName}>{displayName || 'Your Name'}</Text>
                <Text style={styles.idEmail}>{user?.email || profile.email}</Text>
                {profile.phoneNumber ? (
                  <View style={styles.idMetaRow}>
                    <Feather name="phone" size={11} color="rgba(255,248,240,0.5)" />
                    <Text style={styles.idMeta}>{profile.phoneNumber}</Text>
                  </View>
                ) : null}
                {parsedDOB ? (
                  <View style={styles.idMetaRow}>
                    <Feather name="gift" size={11} color="rgba(255,248,240,0.5)" />
                    <Text style={styles.idMeta}>Born {parsedDOB}</Text>
                  </View>
                ) : null}
              </View>
            </View>

            {profileLoading && (
              <Text style={styles.syncText}>Syncing profile from cloud…</Text>
            )}
            {profileSyncError ? <Text style={styles.syncError}>{profileSyncError}</Text> : null}
          </View>
        </AnimatedCard>

        {/* ── Card 2: General Settings ─────────────────────────── */}
        <AnimatedCard delay={80}>
          <View style={styles.settingsCard}>
            <Text style={styles.cardEyebrow}>Account</Text>
            <Text style={styles.cardTitle}>General Settings</Text>

            {/* Edit profile row */}
            <Pressable
              style={styles.settingsRow}
              onPress={() => { setEditingProfile(v => !v); setEditingPrefs(false); }}
            >
              <View style={styles.rowLeft}>
                <View style={[styles.rowIcon, { backgroundColor: '#FDECEA' }]}>
                  <Feather name="user" size={15} color={Colors.primary} />
                </View>
                <Text style={styles.rowLabel}>Edit profile</Text>
              </View>
              <Feather name={editingProfile ? 'chevron-up' : 'chevron-right'} size={18} color={Colors.textMuted} />
            </Pressable>

            {editingProfile && (
              <View style={styles.inlineForm}>

                {/* Name */}
                <Text style={styles.fieldLabel}>Name</Text>
                <TextInput
                  style={styles.inlineInput}
                  value={profileForm.firstName}
                  onChangeText={t => setProfileForm(f => ({ ...f, firstName: t }))}
                  placeholder="First name"
                  placeholderTextColor={Colors.textMuted}
                />
                <TextInput
                  style={styles.inlineInput}
                  value={profileForm.lastName}
                  onChangeText={t => setProfileForm(f => ({ ...f, lastName: t }))}
                  placeholder="Last name"
                  placeholderTextColor={Colors.textMuted}
                />

                {/* Email */}
                <Text style={styles.fieldLabel}>Email</Text>
                <TextInput
                  style={styles.inlineInput}
                  value={profileForm.email}
                  onChangeText={t => setProfileForm(f => ({ ...f, email: t }))}
                  placeholder="Email"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />

                {/* Gender */}
                <Text style={styles.fieldLabel}>Gender</Text>
                <View style={styles.genderRow}>
                  {(['male', 'female', 'other'] as const).map(g => (
                    <Pressable
                      key={g}
                      style={[styles.genderPill, profileForm.gender === g && styles.genderPillActive]}
                      onPress={() => setProfileForm(f => ({ ...f, gender: g }))}
                    >
                      <Text style={[styles.genderPillText, profileForm.gender === g && styles.genderPillTextActive]}>
                        {g.charAt(0).toUpperCase() + g.slice(1)}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                {/* Phone */}
                <Text style={styles.fieldLabel}>Phone number</Text>
                <TextInput
                  style={styles.inlineInput}
                  value={profileForm.phoneNumber}
                  onChangeText={t => setProfileForm(f => ({ ...f, phoneNumber: t }))}
                  placeholder="+40 7__ ___ ___"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="phone-pad"
                />

                {/* Date of birth */}
                <Text style={styles.fieldLabel}>Date of birth</Text>
                <DateOfBirthPicker
                  value={profileForm.dateOfBirth}
                  onChange={v => setProfileForm(f => ({ ...f, dateOfBirth: v }))}
                />

                <View style={styles.inlineBtnRow}>
                  <Pressable style={styles.cancelBtn} onPress={() => setEditingProfile(false)}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </Pressable>
                  <Pressable style={styles.saveBtn} onPress={handleSaveProfile}>
                    <Text style={styles.saveBtnText}>Save changes</Text>
                  </Pressable>
                </View>
              </View>
            )}

            <View style={styles.divider} />

            {/* Change password row */}
            <Pressable style={styles.settingsRow} onPress={handleChangePassword}>
              <View style={styles.rowLeft}>
                <View style={[styles.rowIcon, { backgroundColor: Colors.accentSoft }]}>
                  <Feather name="lock" size={15} color={Colors.accent} />
                </View>
                <Text style={styles.rowLabel}>Change password</Text>
              </View>
              {passwordSent
                ? <Text style={styles.sentBadge}>Sent ✓</Text>
                : passwordError
                ? <Text style={styles.errorBadge}>Failed</Text>
                : <Feather name="chevron-right" size={18} color={Colors.textMuted} />
              }
            </Pressable>
            {passwordSent && (
              <Text style={styles.passwordHint}>
                A reset link was sent to {user?.email || profile.email}
              </Text>
            )}
          </View>
        </AnimatedCard>

        {/* ── Card 3: Preferences ──────────────────────────────── */}
        <AnimatedCard delay={160}>
          <View style={styles.settingsCard}>
            <Text style={styles.cardEyebrow}>Travel</Text>
            <Text style={styles.cardTitle}>Preferences</Text>

            <View style={styles.prefGrid}>
              <View style={styles.prefTile}>
                <Text style={styles.prefTileLabel}>Cabin</Text>
                <Text style={styles.prefTileValue}>{profile.cabinStyle}</Text>
              </View>
              <View style={styles.prefTile}>
                <Text style={styles.prefTileLabel}>Pace</Text>
                <Text style={styles.prefTileValue}>{profile.tripPace}</Text>
              </View>
              <View style={styles.prefTile}>
                <Text style={styles.prefTileLabel}>Booking</Text>
                <Text style={styles.prefTileValue}>{profile.bookingMode}</Text>
              </View>
              <View style={styles.prefTile}>
                <Text style={styles.prefTileLabel}>Accessibility</Text>
                <Text style={styles.prefTileValue}>
                  {profile.needsAccessibleSeating ? 'Required' : 'Standard'}
                </Text>
              </View>
            </View>

            <Pressable
              style={[styles.settingsRow, { marginTop: 14 }]}
              onPress={() => { setEditingPrefs(v => !v); setEditingProfile(false); }}
            >
              <View style={styles.rowLeft}>
                <View style={[styles.rowIcon, { backgroundColor: Colors.skySoft }]}>
                  <Feather name="sliders" size={15} color={Colors.accent} />
                </View>
                <Text style={styles.rowLabel}>Travel settings</Text>
              </View>
              <Feather name={editingPrefs ? 'chevron-up' : 'chevron-right'} size={18} color={Colors.textMuted} />
            </Pressable>

            {editingPrefs && (
              <View style={styles.inlineForm}>
                <TextInput
                  style={styles.inlineInput}
                  value={prefsForm.cabinStyle}
                  onChangeText={t => setPrefsForm(f => ({ ...f, cabinStyle: t }))}
                  placeholder="Economy first"
                  placeholderTextColor={Colors.textMuted}
                />
                <TextInput
                  style={styles.inlineInput}
                  value={prefsForm.tripPace}
                  onChangeText={t => setPrefsForm(f => ({ ...f, tripPace: t }))}
                  placeholder="City breaks & weekends"
                  placeholderTextColor={Colors.textMuted}
                />
                <TextInput
                  style={styles.inlineInput}
                  value={prefsForm.bookingMode}
                  onChangeText={t => setPrefsForm(f => ({ ...f, bookingMode: t }))}
                  placeholder="Flexible suggestions"
                  placeholderTextColor={Colors.textMuted}
                />
                <Pressable
                  style={[styles.toggleRow, prefsForm.needsAccessibleSeating && styles.toggleRowActive]}
                  onPress={() => setPrefsForm(f => ({ ...f, needsAccessibleSeating: !f.needsAccessibleSeating }))}
                >
                  <View style={[styles.toggleThumb, prefsForm.needsAccessibleSeating && styles.toggleThumbActive]}>
                    {prefsForm.needsAccessibleSeating && <Feather name="check" size={12} color={Colors.textOnDark} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.toggleLabel}>Accessible seating</Text>
                    <Text style={styles.toggleHint}>Prioritize accessible options in search results</Text>
                  </View>
                </Pressable>
                <View style={styles.inlineBtnRow}>
                  <Pressable style={styles.cancelBtn} onPress={() => setEditingPrefs(false)}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </Pressable>
                  <Pressable style={styles.saveBtn} onPress={handleSavePrefs}>
                    <Text style={styles.saveBtnText}>Save changes</Text>
                  </Pressable>
                </View>
              </View>
            )}

            <View style={styles.divider} />

            <Pressable style={styles.settingsRow} onPress={() => signOut()}>
              <View style={styles.rowLeft}>
                <View style={[styles.rowIcon, { backgroundColor: '#FFEBEE' }]}>
                  <Feather name="log-out" size={15} color="#D32F2F" />
                </View>
                <Text style={[styles.rowLabel, { color: '#D32F2F' }]}>Sign out</Text>
              </View>
              <Feather name="chevron-right" size={18} color={Colors.textMuted} />
            </Pressable>
          </View>
        </AnimatedCard>

        {/* ── Travel Signature ─────────────────────────────────── */}
        <AnimatedCard delay={240}>
          <View style={styles.signatureCard}>
            <Text style={styles.cardEyebrow}>Travel signature</Text>
            <Text style={styles.cardTitle}>Your preference moodboard</Text>
            <View style={styles.chipWrap}>
              <View style={styles.chip}>
                <Text style={styles.chipLabel}>Cabin</Text>
                <Text style={styles.chipValue}>{profile.cabinStyle}</Text>
              </View>
              <View style={styles.chip}>
                <Text style={styles.chipLabel}>Pace</Text>
                <Text style={styles.chipValue}>{profile.tripPace}</Text>
              </View>
              <View style={[styles.chip, styles.chipFull]}>
                <Text style={styles.chipLabel}>Booking mode</Text>
                <Text style={styles.chipValue}>{profile.bookingMode}</Text>
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
    gap: 16,
  },

  /* ── Identity card ── */
  identityCard: {
    overflow: 'hidden',
    backgroundColor: Colors.surfaceDark,
    borderRadius: Radius.xl,
    padding: 20,
    ...Shadows.card,
  },
  orbA: {
    position: 'absolute',
    top: -20,
    right: -10,
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: Colors.primary,
    opacity: 0.22,
  },
  orbB: {
    position: 'absolute',
    bottom: -40,
    left: -16,
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: Colors.accent,
    opacity: 0.18,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatarCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,248,240,0.12)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,248,240,0.2)',
  },
  avatarInitials: {
    color: Colors.textOnDark,
    fontFamily: Typography.display,
    fontSize: 30,
    lineHeight: 32,
  },
  identityInfo: {
    flex: 1,
  },
  idEyebrow: {
    color: Colors.secondarySoft,
    fontFamily: Typography.sansBold,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    marginBottom: 4,
  },
  idName: {
    color: Colors.textOnDark,
    fontFamily: Typography.display,
    fontSize: 34,
    lineHeight: 36,
    marginBottom: 4,
  },
  idEmail: {
    color: 'rgba(255,248,240,0.7)',
    fontFamily: Typography.sansMedium,
    fontSize: 13,
  },
  idMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 5,
  },
  idMeta: {
    color: 'rgba(255,248,240,0.6)',
    fontFamily: Typography.sansMedium,
    fontSize: 12,
  },
  syncText: {
    marginTop: 14,
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

  /* ── Settings card (shared by Card 2 & 3) ── */
  settingsCard: {
    backgroundColor: Colors.surfaceRaised,
    borderRadius: Radius.xl,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.soft,
  },
  cardEyebrow: {
    color: Colors.accent,
    fontFamily: Typography.sansBold,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  cardTitle: {
    color: Colors.textPrimary,
    fontFamily: Typography.display,
    fontSize: 26,
    lineHeight: 28,
    marginBottom: 16,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansSemiBold,
    fontSize: 15,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 2,
  },
  sentBadge: {
    color: Colors.success,
    fontFamily: Typography.sansBold,
    fontSize: 13,
  },
  errorBadge: {
    color: Colors.error,
    fontFamily: Typography.sansBold,
    fontSize: 13,
  },
  passwordHint: {
    color: Colors.textSecondary,
    fontFamily: Typography.sansMedium,
    fontSize: 12,
    lineHeight: 18,
    paddingBottom: 6,
  },

  /* ── Inline form ── */
  inlineForm: {
    gap: 10,
    paddingTop: 10,
    paddingBottom: 6,
  },
  fieldLabel: {
    color: Colors.textMuted,
    fontFamily: Typography.sansBold,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 4,
  },
  inlineInput: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
    backgroundColor: Colors.surfaceSoft,
    color: Colors.textPrimary,
    fontFamily: Typography.sansMedium,
    fontSize: 15,
    paddingHorizontal: 13,
    paddingVertical: 13,
  },
  inlineBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  cancelBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceSoft,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cancelBtnText: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansBold,
    fontSize: 14,
  },
  saveBtn: {
    flex: 1.4,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primary,
  },
  saveBtnText: {
    color: Colors.textOnDark,
    fontFamily: Typography.sansBold,
    fontSize: 14,
  },

  /* ── Gender picker ── */
  genderRow: {
    flexDirection: 'row',
    gap: 8,
  },
  genderPill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
    backgroundColor: Colors.surfaceSoft,
  },
  genderPillActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  genderPillText: {
    fontFamily: Typography.sansSemiBold,
    fontSize: 14,
    color: Colors.textPrimary,
  },
  genderPillTextActive: {
    color: Colors.textOnDark,
  },

  /* ── Date of birth picker ── */
  dobPanel: {
    backgroundColor: Colors.surfaceSoft,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
    padding: 14,
    gap: 8,
  },
  dobColLabels: {
    flexDirection: 'row',
  },
  dobColLabel: {
    flex: 1,
    textAlign: 'center',
    fontFamily: Typography.sansBold,
    fontSize: 11,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  dobSpinnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dobDivider: {
    width: 1,
    height: 80,
    backgroundColor: Colors.border,
    marginHorizontal: 4,
  },
  spinnerCol: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  spinnerArrow: {
    padding: 6,
  },
  spinnerValueBox: {
    width: '80%',
    paddingVertical: 10,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceRaised,
    borderWidth: 1.5,
    borderColor: Colors.accent,
    alignItems: 'center',
  },
  spinnerValueText: {
    fontFamily: Typography.sansBold,
    fontSize: 16,
    color: Colors.textPrimary,
  },

  /* ── Preference grid ── */
  prefGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  prefTile: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: Colors.surfaceSoft,
    borderRadius: Radius.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  prefTileLabel: {
    color: Colors.textMuted,
    fontFamily: Typography.sansBold,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  prefTileValue: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansSemiBold,
    fontSize: 14,
  },

  /* ── Accessible toggle ── */
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surfaceSoft,
    borderRadius: Radius.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  toggleRowActive: {
    borderColor: Colors.accent,
  },
  toggleThumb: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceRaised,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
  },
  toggleThumbActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  toggleLabel: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansBold,
    fontSize: 14,
    marginBottom: 2,
  },
  toggleHint: {
    color: Colors.textSecondary,
    fontFamily: Typography.sans,
    fontSize: 12,
    lineHeight: 17,
  },

  /* ── Travel signature card ── */
  signatureCard: {
    backgroundColor: Colors.surfaceRaised,
    borderRadius: Radius.xl,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.soft,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  chip: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: Colors.surfaceSoft,
    borderRadius: Radius.lg,
    padding: 14,
  },
  chipFull: {
    flexBasis: '100%',
    flex: 0,
  },
  chipLabel: {
    color: Colors.textMuted,
    fontFamily: Typography.sansBold,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  chipValue: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansSemiBold,
    fontSize: 15,
  },
});
