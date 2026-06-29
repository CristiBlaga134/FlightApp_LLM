import { useEffect, useMemo, useRef, useState } from 'react';
import LottieView from 'lottie-react-native';
import {
  Animated,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, useRouter } from 'expo-router';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';

import {
  confirmPayment,
  createPaymentSession,
  PaymentApiError,
  PaymentConfirmationResponse,
  PaymentProviderConfig,
  PaymentSession,
} from '../src/api/payments';
import { useUserProfile } from '../src/context/UserProfileContext';
import {
  Colors,
  Radius,
  Shadows,
  Spacing,
  Typography,
} from '../src/theme/colors';

type CheckoutForm = {
  firstName: string;
  lastName: string;
  email: string;
  cardholderName: string;
  cardNumber: string;
  expiryMonth: string;
  expiryYear: string;
  cvc: string;
  country: string;
  city: string;
  line1: string;
  postalCode: string;
};

const CHECKOUT_STEPS = [
  {
    key: 'passenger',
    shortLabel: 'Passenger',
    eyebrow: 'Traveler',
    title: 'Passenger details',
    description: 'Add the traveler information first. Once this checks out, the payment page slides in.',
    cta: 'Continue to payment',
  },
  {
    key: 'payment',
    shortLabel: 'Payment',
    eyebrow: 'Payment',
    title: 'Payment confirmation',
    description: 'Confirm the card details next. After validation, the address and final charge summary come into view.',
    cta: 'Continue to address',
  },
  {
    key: 'address',
    shortLabel: 'Address',
    eyebrow: 'Billing',
    title: 'Address and final review',
    description: 'Review the billing address and the exact amount before the payment request is sent.',
    cta: 'Confirm payment session',
  },
] as const;

function formatMoney(amount: number, currency: string) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatOfferWindow(departureDate: string, returnDate: string | null) {
  if (!returnDate) return `${departureDate} · One way`;
  return `${departureDate} → ${returnDate}`;
}

function formatCardNumberInput(value: string) {
  return value
    .replace(/\D/g, '')
    .slice(0, 19)
    .replace(/(.{4})/g, '$1 ')
    .trim();
}

function getPaymentErrorMessage(error: unknown) {
  if (error instanceof PaymentApiError) {
    return error.message;
  }

  const message = error instanceof Error ? error.message : String(error || '').trim();
  return message || 'Checkout could not be completed.';
}

function passesLuhnCheck(value: string) {
  const digits = String(value || '').replace(/\D/g, '');

  if (digits.length < 13 || digits.length > 19) {
    return false;
  }

  let sum = 0;
  let shouldDouble = false;

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);

    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

function normalizeExpiryYear(value: string) {
  const digits = String(value || '').replace(/\D/g, '');

  if (!digits) {
    return null;
  }

  if (digits.length === 2) {
    return Number(`20${digits}`);
  }

  return Number(digits.slice(0, 4));
}

function isExpiredCard(expiryMonthValue: string, expiryYearValue: string) {
  const expiryMonth = Number(String(expiryMonthValue || '').replace(/\D/g, '').slice(0, 2));
  const expiryYear = normalizeExpiryYear(expiryYearValue);

  if (!Number.isInteger(expiryMonth) || !Number.isInteger(expiryYear)) {
    return false;
  }

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  return expiryYear < currentYear || (expiryYear === currentYear && expiryMonth < currentMonth);
}

function validatePassengerForm(form: CheckoutForm) {
  const requiredFields: [keyof CheckoutForm, string][] = [
    ['firstName', 'Traveler first name'],
    ['lastName', 'Traveler last name'],
    ['email', 'Traveler email'],
  ];

  const missing = requiredFields.find(([field]) => !String(form[field] || '').trim());
  if (missing) {
    return `${missing[1]} is required.`;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    return 'Enter a valid traveler email address.';
  }

  return null;
}

function validatePaymentForm(form: CheckoutForm) {
  const requiredFields: [keyof CheckoutForm, string][] = [
    ['cardholderName', 'Cardholder name'],
    ['cardNumber', 'Card number'],
    ['expiryMonth', 'Expiry month'],
    ['expiryYear', 'Expiry year'],
    ['cvc', 'CVC'],
  ];

  const missing = requiredFields.find(([field]) => !String(form[field] || '').trim());
  if (missing) {
    return `${missing[1]} is required.`;
  }

  if (form.cardNumber.replace(/\D/g, '').length < 13) {
    return 'Card number looks too short.';
  }

  if (!passesLuhnCheck(form.cardNumber)) {
    return 'Card number failed the checksum.';
  }

  if (form.expiryMonth.replace(/\D/g, '').length !== 2) {
    return 'Expiry month must contain 2 digits.';
  }

  const expiryMonth = Number(form.expiryMonth.replace(/\D/g, ''));
  if (!Number.isInteger(expiryMonth) || expiryMonth < 1 || expiryMonth > 12) {
    return 'Expiry month is invalid.';
  }

  if (form.expiryYear.replace(/\D/g, '').length < 2) {
    return 'Expiry year is incomplete.';
  }

  if (!Number.isInteger(normalizeExpiryYear(form.expiryYear))) {
    return 'Expiry year is invalid.';
  }

  if (isExpiredCard(form.expiryMonth, form.expiryYear)) {
    return 'Card expiry date is in the past.';
  }

  if (form.cvc.replace(/\D/g, '').length < 3) {
    return 'CVC must contain at least 3 digits.';
  }

  return null;
}

function validateAddressForm(form: CheckoutForm) {
  const requiredFields: [keyof CheckoutForm, string][] = [
    ['country', 'Billing country'],
    ['city', 'Billing city'],
    ['line1', 'Billing address'],
    ['postalCode', 'Billing postal code'],
  ];

  const missing = requiredFields.find(([field]) => !String(form[field] || '').trim());
  if (missing) {
    return `${missing[1]} is required.`;
  }

  return null;
}

function validateForm(form: CheckoutForm) {
  return validatePassengerForm(form) || validatePaymentForm(form) || validateAddressForm(form);
}

function getFirstInvalidStep(form: CheckoutForm) {
  if (validatePassengerForm(form)) return 0;
  if (validatePaymentForm(form)) return 1;
  if (validateAddressForm(form)) return 2;
  return null;
}

function CheckoutField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize = 'words',
  maxLength,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: 'default' | 'email-address' | 'number-pad';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  maxLength?: number;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.textMuted}
        style={styles.fieldInput}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        maxLength={maxLength}
      />
    </View>
  );
}

export default function CheckoutScreen() {
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const slideTranslateX = useRef(new Animated.Value(0)).current;
  const {
    profile,
    pendingCheckoutOffer,
    setPendingCheckoutOffer,
    saveBooking,
  } = useUserProfile();
  const [form, setForm] = useState<CheckoutForm>({
    firstName: '',
    lastName: '',
    email: '',
    cardholderName: '',
    cardNumber: '',
    expiryMonth: '12',
    expiryYear: '2029',
    cvc: '123',
    country: 'Romania',
    city: 'Bucharest',
    line1: '',
    postalCode: '',
  });
  const [currentStep, setCurrentStep] = useState(0);
  const [paymentResult, setPaymentResult] = useState<PaymentConfirmationResponse | null>(null);
  const [paymentSession, setPaymentSession] = useState<PaymentSession | null>(null);
  const [providerConfig, setProviderConfig] = useState<PaymentProviderConfig | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isSessionLoading, setIsSessionLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      firstName: prev.firstName || profile.firstName,
      email: prev.email || profile.email,
      cardholderName: prev.cardholderName || profile.firstName,
    }));
  }, [profile.email, profile.firstName]);

  const offer = pendingCheckoutOffer;
  const slideWidth = Math.max(windowWidth - (Spacing.lg * 2), 280);

  const priceBreakdown = useMemo(() => {
    if (!offer) return { serviceFee: 0, baseFare: 0, total: 0 };
    const serviceFee = Math.min(18, Math.max(8, Math.round(offer.price * 0.07)));
    return {
      serviceFee,
      baseFare: Math.max(0, offer.price - serviceFee),
      total: offer.price,
    };
  }, [offer]);

  useEffect(() => {
    Animated.spring(slideTranslateX, {
      toValue: -(currentStep * slideWidth),
      friction: 9,
      tension: 70,
      useNativeDriver: true,
    }).start();
  }, [currentStep, slideTranslateX, slideWidth]);

  useEffect(() => {
    let cancelled = false;

    if (!offer) {
      setPaymentSession(null);
      setProviderConfig(null);
      return () => {
        cancelled = true;
      };
    }

    setIsSessionLoading(true);
    setPaymentError(null);

    void createPaymentSession({
      offer,
      customerEmail: profile.email,
      customerName: profile.firstName,
    })
      .then((response) => {
        if (cancelled) return;
        setPaymentSession(response.paymentSession);
        setProviderConfig(response.providerConfig);
      })
      .catch((error) => {
        if (cancelled) return;
        setPaymentError(getPaymentErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) {
          setIsSessionLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [offer, profile.email, profile.firstName]);

  if (!offer) {
    return <Redirect href='/(tabs)' />;
  }

  const updateField = (field: keyof CheckoutForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const applyTestCard = (cardNumber: string) => {
    setPaymentError(null);
    setForm((prev) => ({
      ...prev,
      cardNumber,
      expiryMonth: '12',
      expiryYear: '2029',
      cvc: '123',
      cardholderName: prev.cardholderName || `${prev.firstName} ${prev.lastName}`.trim() || profile.firstName,
    }));
  };

  const goToStep = (nextStep: number) => {
    const clamped = Math.max(0, Math.min(nextStep, CHECKOUT_STEPS.length - 1));
    setPaymentError(null);
    setCurrentStep(clamped);
  };

  const handleBack = () => {
    if (currentStep === 0) {
      router.back();
      return;
    }

    goToStep(currentStep - 1);
  };

  const handleAdvance = () => {
    const validationError = currentStep === 0 ? validatePassengerForm(form) : validatePaymentForm(form);

    if (validationError) {
      setPaymentError(validationError);
      return;
    }

    goToStep(currentStep + 1);
  };

  const openTrips = () => {
    setPendingCheckoutOffer(null);
    router.replace('/(tabs)/explore');
  };

  const openAssistant = () => {
    setPendingCheckoutOffer(null);
    router.replace('/(tabs)');
  };

  const testCards = providerConfig?.testCards || [];
  const activeStep = CHECKOUT_STEPS[currentStep];
  const cardDigits = form.cardNumber.replace(/\D/g, '');
  const maskedCard = cardDigits.length >= 4 ? `•••• ${cardDigits.slice(-4)}` : 'No card selected yet';

  const handleSubmit = async () => {
    const validationError = validateForm(form);
    if (validationError) {
      setPaymentError(validationError);
      const invalidStep = getFirstInvalidStep(form);
      if (invalidStep !== null) {
        setCurrentStep(invalidStep);
      }
      return;
    }

    if (!paymentSession) {
      setPaymentError('Payment session is still being prepared. Please try again in a moment.');
      return;
    }

    setIsSubmitting(true);
    setPaymentError(null);

    try {
      const response = await confirmPayment({
        paymentSessionId: paymentSession.id,
        traveler: {
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim(),
        },
        paymentMethod: {
          cardholderName: form.cardholderName.trim(),
          cardNumber: form.cardNumber,
          expiryMonth: form.expiryMonth.trim(),
          expiryYear: form.expiryYear.trim(),
          cvc: form.cvc.trim(),
        },
        billingAddress: {
          country: form.country.trim(),
          city: form.city.trim(),
          line1: form.line1.trim(),
          postalCode: form.postalCode.trim(),
        },
      });

      setPaymentSession(response.paymentSession);
      setProviderConfig(response.providerConfig);

      if (response.paymentSession.status === 'failed' || !response.booking) {
        setPaymentError(response.paymentSession.lastErrorMessage || 'Payment could not be authorized.');
        return;
      }

      saveBooking({
        bookingReference: response.booking.bookingReference,
        paymentId: response.booking.paymentId,
        paymentSessionId: response.booking.paymentSessionId,
        paymentIntentId: response.booking.paymentIntentId,
        paymentProvider: response.booking.paymentProvider,
        paymentEventType: response.paymentEvent?.type || null,
        status: response.booking.status,
        supplier: response.booking.supplier,
        airline: response.booking.airline,
        amount: response.booking.amount,
        currency: response.booking.currency,
        originCity: response.booking.offer.originCity,
        destinationCity: response.booking.offer.destinationCity,
        departureDate: response.booking.offer.departureDate,
        returnDate: response.booking.offer.returnDate,
        tripType: response.booking.offer.tripType,
        travelerName: `${response.booking.traveler.firstName} ${response.booking.traveler.lastName}`.trim(),
        travelerEmail: response.booking.traveler.email,
        cardBrand: response.booking.paymentMethod.brand,
        cardLast4: response.booking.paymentMethod.last4,
        estimatedConfirmationAt: response.booking.estimatedConfirmationAt,
      });

      setPaymentResult(response);
    } catch (error) {
      setPaymentError(getPaymentErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (paymentResult) {
    const booking = paymentResult.booking;

    if (!booking) {
      return <Redirect href='/(tabs)' />;
    }

    return (
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          <View style={styles.confirmationCard}>
            <LottieView
              source={
                paymentResult.paymentSession.status === 'processing'
                  ? require('../assets/Success checkmark.json')
                  : require('../assets/Sastaticket Confirmation.json')
              }
              autoPlay
              loop
              style={styles.confirmationLottie}
            />
            <Text style={styles.confirmationEyebrow}>
              {paymentResult.paymentSession.status === 'processing' ? 'Payment authorized' : 'Booking confirmed'}
            </Text>
            <Text style={styles.confirmationTitle}>{booking.bookingReference}</Text>
            <Text style={styles.confirmationText}>
              {paymentResult.paymentEvent?.type ? `Latest event: ${paymentResult.paymentEvent.type}` : 'Payment session confirmed.'}
            </Text>

            <View style={styles.confirmationMetaCard}>
              <Text style={styles.confirmationMetaLabel}>Route</Text>
              <Text style={styles.confirmationMetaValue}>{offer.originCity} → {offer.destinationCity}</Text>
              <Text style={styles.confirmationDetail}>{formatOfferWindow(offer.departureDate, offer.returnDate)}</Text>

              <View style={styles.confirmationDivider} />

              <Text style={styles.confirmationMetaLabel}>Payment</Text>
              <Text style={styles.confirmationMetaValue}>{formatMoney(booking.amount, booking.currency)}</Text>
              <Text style={styles.confirmationDetail}>
                {booking.paymentMethod.brand.toUpperCase()} ending in {booking.paymentMethod.last4}
              </Text>
              <Text style={styles.confirmationDetail}>Session {paymentResult.paymentSession.id}</Text>

              {booking.estimatedConfirmationAt ? (
                <Text style={styles.pendingNote}>
                  Supplier confirmation ETA: {booking.estimatedConfirmationAt}
                </Text>
              ) : null}
            </View>

            <Pressable style={styles.primaryButton} onPress={openTrips}>
              <Text style={styles.primaryButtonText}>View trip history</Text>
              <Feather name='arrow-right' size={16} color={Colors.textOnDark} />
            </Pressable>

            {offer.bookingUrl ? (
              <Pressable style={styles.secondaryButton} onPress={() => void Linking.openURL(offer.bookingUrl!)}>
                <Text style={styles.secondaryButtonText}>Open supplier page</Text>
              </Pressable>
            ) : null}

            <Pressable style={styles.linkButton} onPress={openAssistant}>
              <Text style={styles.linkButtonText}>Back to assistant</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
          <Pressable style={styles.backButton} onPress={handleBack}>
            <Feather name='arrow-left' size={16} color={Colors.textPrimary} />
            <Text style={styles.backButtonText}>{currentStep === 0 ? 'Back to offers' : 'Previous step'}</Text>
          </Pressable>

          <View style={styles.heroCard}>
            <View style={styles.heroOrbWarm} />
            <View style={styles.heroOrbCool} />
            <Text style={styles.heroEyebrow}>Checkout demo</Text>
            <Text style={styles.heroTitle}>Finish the booking journey inside the app.</Text>

            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>Selected fare</Text>
              <Text style={styles.summaryValue}>{offer.originCity} → {offer.destinationCity}</Text>
              <Text style={styles.summaryDetail}>{offer.airline} • {offer.supplier}</Text>
              <Text style={styles.summaryDetail}>{formatOfferWindow(offer.departureDate, offer.returnDate)}</Text>
              <Text style={styles.summaryPrice}>{formatMoney(priceBreakdown.total, offer.currency)}</Text>
              {paymentSession ? (
                <Text style={styles.summaryDetail}>Session {paymentSession.id} • {paymentSession.paymentIntent.status}</Text>
              ) : null}
            </View>
          </View>

          <View style={styles.stepMetaCard}>
            <View style={styles.stepPillRow}>
              {CHECKOUT_STEPS.map((step, index) => {
                const isActive = index === currentStep;
                const isComplete = index < currentStep;

                return (
                  <Pressable
                    key={step.key}
                    style={[
                      styles.stepPill,
                      isActive && styles.stepPillActive,
                      isComplete && styles.stepPillComplete,
                    ]}
                    onPress={() => goToStep(index)}
                    disabled={index > currentStep}>
                    <View style={[
                      styles.stepPillBadge,
                      isActive && styles.stepPillBadgeActive,
                      isComplete && styles.stepPillBadgeComplete,
                    ]}>
                      <Text style={[
                        styles.stepPillBadgeText,
                        (isActive || isComplete) && styles.stepPillBadgeTextActive,
                      ]}>
                        {index + 1}
                      </Text>
                    </View>
                    <Text style={[
                      styles.stepPillLabel,
                      isActive && styles.stepPillLabelActive,
                    ]}>
                      {step.shortLabel}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.stepMetaLabel}>Step {currentStep + 1} of {CHECKOUT_STEPS.length}</Text>
            <Text style={styles.stepMetaTitle}>{activeStep.title}</Text>
            <Text style={styles.stepMetaDescription}>{activeStep.description}</Text>
          </View>

          {paymentError ? (
            <View style={styles.errorCard}>
              <Feather name='alert-circle' size={18} color={Colors.error} />
              <Text style={styles.errorText}>{paymentError}</Text>
            </View>
          ) : null}

          <View style={styles.carouselViewport}>
            <Animated.View
              style={[
                styles.carouselTrack,
                {
                  width: slideWidth * CHECKOUT_STEPS.length,
                  transform: [{ translateX: slideTranslateX }],
                },
              ]}>
              <View style={[styles.slidePage, { width: slideWidth }]}>
                <View style={styles.sectionCard}>
                  <Text style={styles.sectionEyebrow}>Traveler</Text>
                  <Text style={styles.sectionTitle}>Passenger details</Text>
                  <Text style={styles.sectionDescription}>
                    These details are used for the booking record and the confirmation trail shown in the demo.
                  </Text>
                  <View style={styles.fieldRow}>
                    <CheckoutField
                      label='First name'
                      value={form.firstName}
                      onChangeText={(value) => updateField('firstName', value)}
                      placeholder='Alex'
                    />
                    <CheckoutField
                      label='Last name'
                      value={form.lastName}
                      onChangeText={(value) => updateField('lastName', value)}
                      placeholder='Popescu'
                    />
                  </View>
                  <CheckoutField
                    label='Email'
                    value={form.email}
                    onChangeText={(value) => updateField('email', value)}
                    placeholder='alex@example.com'
                    keyboardType='email-address'
                    autoCapitalize='none'
                  />
                </View>

                <View style={styles.stepActionsSingle}>
                  <Pressable style={[styles.primaryButton, styles.stepButton]} onPress={handleAdvance}>
                    <Text style={styles.primaryButtonText}>{CHECKOUT_STEPS[0].cta}</Text>
                    <Feather name='arrow-right' size={16} color={Colors.textOnDark} />
                  </Pressable>
                </View>
              </View>

              <View style={[styles.slidePage, { width: slideWidth }]}>
                <View style={styles.sectionCard}>
                  <Text style={styles.sectionEyebrow}>Payment</Text>
                  <Text style={styles.sectionTitle}>Payment confirmation</Text>
                  <Text style={styles.sectionDescription}>
                    Pick a demo card or enter one manually. Once the payment details validate, the final address and review page slides in.
                  </Text>

                  <View style={styles.testCardWrap}>
                    {testCards.map((card) => (
                      <Pressable key={card.number} style={styles.testCardChip} onPress={() => applyTestCard(card.number)}>
                        <Text style={styles.testCardLabel}>{card.label}</Text>
                        <Text style={styles.testCardNumber}>{card.number}</Text>
                        <Text style={styles.testCardNote}>{card.note}</Text>
                        <Text style={styles.testCardEvent}>{card.expectedEvent}</Text>
                      </Pressable>
                    ))}
                  </View>

                  <CheckoutField
                    label='Cardholder name'
                    value={form.cardholderName}
                    onChangeText={(value) => updateField('cardholderName', value)}
                    placeholder='Alex Popescu'
                  />
                  <CheckoutField
                    label='Card number'
                    value={form.cardNumber}
                    onChangeText={(value) => updateField('cardNumber', formatCardNumberInput(value))}
                    placeholder='4242 4242 4242 4242'
                    keyboardType='number-pad'
                    autoCapitalize='none'
                    maxLength={23}
                  />
                  <View style={styles.fieldRowCompact}>
                    <CheckoutField
                      label='Expiry month'
                      value={form.expiryMonth}
                      onChangeText={(value) => updateField('expiryMonth', value.replace(/\D/g, '').slice(0, 2))}
                      placeholder='12'
                      keyboardType='number-pad'
                      autoCapitalize='none'
                      maxLength={2}
                    />
                    <CheckoutField
                      label='Expiry year'
                      value={form.expiryYear}
                      onChangeText={(value) => updateField('expiryYear', value.replace(/\D/g, '').slice(0, 4))}
                      placeholder='2029'
                      keyboardType='number-pad'
                      autoCapitalize='none'
                      maxLength={4}
                    />
                    <CheckoutField
                      label='CVC'
                      value={form.cvc}
                      onChangeText={(value) => updateField('cvc', value.replace(/\D/g, '').slice(0, 4))}
                      placeholder='123'
                      keyboardType='number-pad'
                      autoCapitalize='none'
                      maxLength={4}
                    />
                  </View>
                </View>

                <View style={styles.stepActionsRow}>
                  <Pressable style={[styles.secondaryButton, styles.stepButton]} onPress={() => goToStep(0)}>
                    <Text style={styles.secondaryButtonText}>Back to passenger</Text>
                  </Pressable>
                  <Pressable style={[styles.primaryButton, styles.stepButton]} onPress={handleAdvance}>
                    <Text style={styles.primaryButtonText}>{CHECKOUT_STEPS[1].cta}</Text>
                    <Feather name='arrow-right' size={16} color={Colors.textOnDark} />
                  </Pressable>
                </View>
              </View>

              <View style={[styles.slidePage, { width: slideWidth }]}>
                <View style={styles.sectionCard}>
                  <Text style={styles.sectionEyebrow}>Billing</Text>
                  <Text style={styles.sectionTitle}>Review billing address</Text>
                  <Text style={styles.sectionDescription}>
                    This is the last page before the payment request is sent. Review the billing address and final amount together.
                  </Text>
                  <CheckoutField
                    label='Street address'
                    value={form.line1}
                    onChangeText={(value) => updateField('line1', value)}
                    placeholder='Strada Aviatorilor 10'
                  />
                  <View style={styles.fieldRow}>
                    <CheckoutField
                      label='City'
                      value={form.city}
                      onChangeText={(value) => updateField('city', value)}
                      placeholder='Bucharest'
                    />
                    <CheckoutField
                      label='Country'
                      value={form.country}
                      onChangeText={(value) => updateField('country', value)}
                      placeholder='Romania'
                    />
                  </View>
                  <CheckoutField
                    label='Postal code'
                    value={form.postalCode}
                    onChangeText={(value) => updateField('postalCode', value)}
                    placeholder='010000'
                    autoCapitalize='characters'
                  />
                </View>

                <View style={styles.sectionCard}>
                  <Text style={styles.sectionEyebrow}>Breakdown</Text>
                  <Text style={styles.sectionTitle}>Charge summary</Text>
                  <Text style={styles.sectionDescription}>
                    Review the amount below before confirming your payment.
                  </Text>

                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>Base fare</Text>
                    <Text style={styles.breakdownValue}>{formatMoney(priceBreakdown.baseFare, offer.currency)}</Text>
                  </View>
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>Service fee</Text>
                    <Text style={styles.breakdownValue}>{formatMoney(priceBreakdown.serviceFee, offer.currency)}</Text>
                  </View>
                  <View style={styles.breakdownDivider} />
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownTotalLabel}>Total</Text>
                    <Text style={styles.breakdownTotalValue}>{formatMoney(priceBreakdown.total, offer.currency)}</Text>
                  </View>

                  <View style={styles.reviewCard}>
                    <View style={styles.reviewRow}>
                      <Text style={styles.reviewLabel}>Passenger</Text>
                      <Text style={styles.reviewValue}>{`${form.firstName} ${form.lastName}`.trim() || 'Missing passenger'}</Text>
                    </View>
                    <View style={styles.reviewRow}>
                      <Text style={styles.reviewLabel}>Payment method</Text>
                      <Text style={styles.reviewValue}>{maskedCard}</Text>
                    </View>
                    <View style={styles.reviewRow}>
                      <Text style={styles.reviewLabel}>Billing city</Text>
                      <Text style={styles.reviewValue}>{form.city.trim() || 'Missing city'}</Text>
                    </View>
                    <View style={styles.reviewRow}>
                      <Text style={styles.reviewLabel}>Session state</Text>
                      <Text style={styles.reviewValue}>
                        {isSessionLoading
                          ? 'Preparing session'
                          : paymentSession
                            ? paymentSession.paymentIntent.status
                            : 'Session unavailable'}
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={styles.stepActionsRow}>
                  <Pressable style={[styles.secondaryButton, styles.stepButton]} onPress={() => goToStep(1)}>
                    <Text style={styles.secondaryButtonText}>Back to payment</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.primaryButton, styles.stepButton, (isSubmitting || isSessionLoading || !paymentSession) && styles.primaryButtonDisabled]}
                    onPress={handleSubmit}
                    disabled={isSubmitting || isSessionLoading || !paymentSession}>
                    <Text style={styles.primaryButtonText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                      {isSessionLoading
                        ? 'Preparing payment session...'
                        : isSubmitting
                          ? 'Confirming payment session...'
                          : CHECKOUT_STEPS[2].cta}
                    </Text>
                    <Feather name='lock' size={16} color={Colors.textOnDark} />
                  </Pressable>
                </View>
              </View>
            </Animated.View>
          </View>

          {offer.bookingUrl ? (
            <Pressable style={styles.secondaryButton} onPress={() => void Linking.openURL(offer.bookingUrl!)}>
              <Text style={styles.secondaryButtonText}>Open supplier page instead</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  flex: {
    flex: 1,
  },
  container: {
    padding: Spacing.lg,
    paddingBottom: 96,
    gap: 16,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
  },
  backButtonText: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansSemiBold,
    fontSize: 13,
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
    right: -10,
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: Colors.primary,
    opacity: 0.22,
  },
  heroOrbCool: {
    position: 'absolute',
    bottom: -48,
    left: -24,
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
    maxWidth: 340,
  },
  heroSubtitle: {
    color: 'rgba(255, 248, 240, 0.78)',
    fontFamily: Typography.sans,
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 18,
  },
  summaryCard: {
    backgroundColor: 'rgba(255, 249, 242, 0.1)',
    borderRadius: Radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 249, 242, 0.12)',
    gap: 4,
  },
  summaryLabel: {
    color: Colors.textMuted,
    fontFamily: Typography.sansBold,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  summaryValue: {
    color: Colors.textOnDark,
    fontFamily: Typography.sansBold,
    fontSize: 18,
  },
  summaryDetail: {
    color: 'rgba(255, 248, 240, 0.75)',
    fontFamily: Typography.sans,
    fontSize: 13,
  },
  summaryPrice: {
    color: Colors.secondarySoft,
    fontFamily: Typography.display,
    fontSize: 28,
    marginTop: 6,
  },
  noticeCard: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: Colors.surfaceAccent,
    borderRadius: Radius.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'flex-start',
  },
  noticeText: {
    flex: 1,
    color: Colors.textPrimary,
    fontFamily: Typography.sans,
    fontSize: 13,
    lineHeight: 20,
  },
  providerCard: {
    backgroundColor: Colors.surfaceRaised,
    borderRadius: Radius.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
    ...Shadows.soft,
  },
  providerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  providerLabel: {
    color: Colors.textSecondary,
    fontFamily: Typography.sansBold,
    fontSize: 12,
  },
  providerValue: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansSemiBold,
    fontSize: 12,
    textAlign: 'right',
    flex: 1,
  },
  stepMetaCard: {
    backgroundColor: Colors.surfaceRaised,
    borderRadius: Radius.xl,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
    ...Shadows.soft,
  },
  stepPillRow: {
    flexDirection: 'row',
    gap: 10,
  },
  stepPill: {
    flex: 1,
    minHeight: 72,
    borderRadius: Radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'space-between',
    gap: 8,
  },
  stepPillActive: {
    backgroundColor: Colors.surfaceAccent,
    borderColor: Colors.accent,
  },
  stepPillComplete: {
    backgroundColor: Colors.surfaceSoft,
    borderColor: Colors.primary,
  },
  stepPillBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceRaised,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  stepPillBadgeActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  stepPillBadgeComplete: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  stepPillBadgeText: {
    color: Colors.textSecondary,
    fontFamily: Typography.sansBold,
    fontSize: 12,
  },
  stepPillBadgeTextActive: {
    color: Colors.textOnDark,
  },
  stepPillLabel: {
    color: Colors.textSecondary,
    fontFamily: Typography.sansBold,
    fontSize: 12,
  },
  stepPillLabelActive: {
    color: Colors.textPrimary,
  },
  stepMetaLabel: {
    color: Colors.accent,
    fontFamily: Typography.sansBold,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  stepMetaTitle: {
    color: Colors.textPrimary,
    fontFamily: Typography.display,
    fontSize: 30,
    lineHeight: 30,
  },
  stepMetaDescription: {
    color: Colors.textSecondary,
    fontFamily: Typography.sans,
    fontSize: 14,
    lineHeight: 22,
  },
  errorCard: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#FDECEC',
    borderRadius: Radius.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: '#F5C7C7',
    alignItems: 'flex-start',
  },
  errorText: {
    flex: 1,
    color: Colors.error,
    fontFamily: Typography.sansMedium,
    fontSize: 13,
    lineHeight: 20,
  },
  carouselViewport: {
    overflow: 'hidden',
  },
  carouselTrack: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  slidePage: {
    gap: 16,
  },
  sectionCard: {
    backgroundColor: Colors.surfaceRaised,
    borderRadius: Radius.xl,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
    ...Shadows.soft,
  },
  sectionEyebrow: {
    color: Colors.accent,
    fontFamily: Typography.sansBold,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  sectionTitle: {
    color: Colors.textPrimary,
    fontFamily: Typography.display,
    fontSize: 28,
    lineHeight: 28,
    marginBottom: 4,
  },
  sectionDescription: {
    color: Colors.textSecondary,
    fontFamily: Typography.sans,
    fontSize: 14,
    lineHeight: 22,
  },
  fieldGroup: {
    flex: 1,
    gap: 6,
  },
  fieldLabel: {
    color: Colors.textSecondary,
    fontFamily: Typography.sansBold,
    fontSize: 12,
  },
  fieldInput: {
    height: 52,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: '#E8F7FF',
    paddingHorizontal: 14,
    color: Colors.textPrimary,
    fontFamily: Typography.sansMedium,
    fontSize: 14,
  },
  fieldRow: {
    flexDirection: 'row',
    gap: 12,
  },
  fieldRowCompact: {
    flexDirection: 'row',
    gap: 10,
  },
  testCardWrap: {
    gap: 10,
  },
  testCardChip: {
    backgroundColor: Colors.surfaceAccent,
    borderRadius: Radius.lg,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.accentSoft,
    gap: 2,
  },
  testCardLabel: {
    color: Colors.accent,
    fontFamily: Typography.sansBold,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  testCardNumber: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansSemiBold,
    fontSize: 14,
  },
  testCardNote: {
    color: Colors.textSecondary,
    fontFamily: Typography.sans,
    fontSize: 12,
  },
  testCardEvent: {
    color: Colors.accent,
    fontFamily: Typography.sansBold,
    fontSize: 11,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  breakdownLabel: {
    color: Colors.textSecondary,
    fontFamily: Typography.sansMedium,
    fontSize: 14,
  },
  breakdownValue: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansSemiBold,
    fontSize: 14,
  },
  breakdownDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 4,
  },
  breakdownTotalLabel: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansBold,
    fontSize: 15,
  },
  breakdownTotalValue: {
    color: Colors.primaryDeep,
    fontFamily: Typography.display,
    fontSize: 26,
  },
  reviewCard: {
    backgroundColor: Colors.surfaceSoft,
    borderRadius: Radius.lg,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  reviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  reviewLabel: {
    color: Colors.textSecondary,
    fontFamily: Typography.sansBold,
    fontSize: 12,
  },
  reviewValue: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansSemiBold,
    fontSize: 12,
    textAlign: 'right',
    flex: 1,
  },
  stepActionsSingle: {
    flexDirection: 'row',
  },
  stepActionsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  stepButton: {
    flex: 1,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: Radius.pill,
    paddingVertical: 16,
    paddingHorizontal: 12,
    overflow: 'hidden',
    ...Shadows.glow,
  },
  primaryButtonDisabled: {
    opacity: 0.65,
  },
  primaryButtonText: {
    color: Colors.textOnDark,
    fontFamily: Typography.sansBold,
    fontSize: 14,
  },
  secondaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceRaised,
    borderRadius: Radius.pill,
    paddingVertical: 15,
    borderWidth: 1,
    borderColor: Colors.borderStrong,
  },
  secondaryButtonText: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansBold,
    fontSize: 14,
  },
  linkButton: {
    alignItems: 'center',
    paddingTop: 6,
  },
  linkButtonText: {
    color: Colors.accent,
    fontFamily: Typography.sansBold,
    fontSize: 13,
  },
  confirmationCard: {
    backgroundColor: Colors.surfaceRaised,
    borderRadius: Radius.xl,
    padding: 22,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 14,
    ...Shadows.card,
  },
  confirmationLottie: {
    width: 160,
    height: 160,
    alignSelf: 'center',
  },
  confirmationEyebrow: {
    color: Colors.accent,
    fontFamily: Typography.sansBold,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
  confirmationTitle: {
    color: Colors.textPrimary,
    fontFamily: Typography.display,
    fontSize: 40,
    lineHeight: 40,
  },
  confirmationText: {
    color: Colors.textSecondary,
    fontFamily: Typography.sans,
    fontSize: 14,
    lineHeight: 22,
  },
  confirmationMetaCard: {
    backgroundColor: Colors.surfaceSoft,
    borderRadius: Radius.lg,
    padding: 16,
    gap: 6,
  },
  confirmationDetail: {
    color: Colors.textSecondary,
    fontFamily: Typography.sansMedium,
    fontSize: 13,
  },
  confirmationDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 6,
  },
  confirmationMetaLabel: {
    color: Colors.textMuted,
    fontFamily: Typography.sansBold,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  confirmationMetaValue: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansBold,
    fontSize: 18,
  },
  pendingNote: {
    color: Colors.accent,
    fontFamily: Typography.sansSemiBold,
    fontSize: 12,
    marginTop: 6,
  },
});