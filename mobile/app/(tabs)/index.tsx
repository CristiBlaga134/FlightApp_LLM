import { useEffect, useRef, useState, useCallback } from "react";
import {
  Animated,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter, useFocusEffect, type Href } from "expo-router";

import {
  ChatApiError,
  FlightOffer,
  resetChatSession,
  sendChatMessage,
} from "../../src/api/chat";
import { InlineDatePicker } from "../../components/InlineDatePicker";
import { fetchBackendHealth, HealthResponse } from "../../src/api/health";
import { useUserProfile } from "../../src/context/UserProfileContext";
import {
  Colors,
  Radius,
  Shadows,
  Typography,
} from "../../src/theme/colors";

const QUICK_PROMPTS = [
  {
    id: "cheap-city-break",
    title: "City break under budget",
    meta: "Fast, affordable, specific",
    prompt: "A weekend in Amsterdam from Bucharest under 300 euro",
    icon: "city",
  },
  {
    id: "one-way-hop",
    title: "One-way escape",
    meta: "Flexible route search",
    prompt: "One-way from Cluj to Berlin next week",
    icon: "airplane-takeoff",
  },
  {
    id: "baggage-aware",
    title: "Baggage-aware trip",
    meta: "Useful for realistic planning",
    prompt: "Round trip to Barcelona with 1 checked bag",
    icon: "bag-suitcase",
  },
];

const FEATURE_CARDS = [
  { id: "search",   title: "Search Flights",  desc: "Routes, dates, budgets", icon: "airplane-takeoff", tint: "#C85F3D" },
  { id: "bookings", title: "My Bookings",     desc: "Checkout history",       icon: "receipt",          tint: "#3B82F6" },
  { id: "trips",    title: "Past Trips",      desc: "Saved searches",         icon: "compass-outline",  tint: "#10B981" },
  { id: "profile",  title: "Travel Profile",  desc: "Your preferences",       icon: "account-cog",      tint: "#8B5CF6" },
];

const SURPRISE_PROMPTS = [
  "Surprise me — a cheap weekend escape to somewhere in Europe under 250 euro",
  "Take me somewhere warm and sunny, one-way, under 300 euro",
  "I want a city break somewhere cultural under 200 euro, direct if possible",
  "Find me something relaxing in Europe under 400 euro round trip",
  "A spontaneous trip somewhere next month under 350 euro, any destination",
  "Fly me somewhere interesting in under 2 hours, budget friendly",
  "A cultural weekend escape somewhere in Europe under 300 euro",
  "A budget adventure to anywhere interesting under 250 euro",
  "Take me somewhere I haven't been — one-way under 200 euro",
  "A quick summer getaway somewhere warm, round trip under 300 euro",
];

type Message = {
  id: string;
  text: string;
  role: "user" | "assistant";
  typing?: boolean;
  offers?: FlightOffer[];
  suggestions?: string[];
  warning?: string | null;
  requestId?: string;
  normalizationSummary?: string | null;
  normalizedDateNote?: string | null;
  comparisonSummary?: string | null;
  cheapestOfferId?: string | null;
  datePicker?: {
    needsDeparture: boolean;
    needsReturn: boolean;
    tripType: "one_way" | "round_trip" | null;
  } | null;
  noResults?: boolean;
  noResultsSearch?: {
    originCity: string | null;
    destinationCity: string | null;
    departureDate: string | null;
    returnDate: string | null;
  } | null;
};

function parseSuggestionsFromQuestions(questions: string[] | undefined) {
  if (!questions || questions.length === 0) return [];

  const collected: string[] = [];
  for (const question of questions) {
    const normalized = question.replace(/\?/g, "").trim();
    const fromColon = normalized.includes(":")
      ? normalized.slice(normalized.indexOf(":") + 1)
      : normalized;

    const parts = fromColon
      .split(/\s+or\s+/i)
      .map((part) => part.trim())
      .filter((part) => part.length > 1);

    for (const part of parts) {
      const cleaned = part
        .replace(/^(which airport should i use\s*)/i, "")
        .replace(/^[,.-]+/, "")
        .trim();

      if (!cleaned) continue;
      if (cleaned.length > 48) continue;
      if (collected.includes(cleaned)) continue;
      collected.push(cleaned);
    }
  }

  return collected.slice(0, 6);
}

function getFriendlyErrorMessage(error: unknown) {
  if (error instanceof ChatApiError) {
    if (error.code === "NETWORK") {
      if (/timed out/i.test(error.message)) {
        return "The search is taking longer than usual. Please wait a moment and try again.";
      }
      return "I couldn't reach the flight server. Check that backend is running and try again.";
    }
    if (error.code === "HTTP") {
      if ((error.status || 0) >= 500) {
        return "The flight server is having trouble right now. Please retry in a few moments.";
      }
      return error.message || "Your request could not be processed. Please try again.";
    }
    return "I received an invalid response from the server. Please retry.";
  }

  const fallback = (error as any)?.message;
  return fallback ? `Something went wrong: ${fallback}` : "Something went wrong. Please try again.";
}

function formatCabinClass(cabinClass: FlightOffer["cabinClass"]) {
  return cabinClass
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatShortDate(dateString: string | null) {
  if (!dateString) return "Flexible";

  const parsedDate = new Date(dateString);
  if (Number.isNaN(parsedDate.getTime())) return dateString;

  return parsedDate.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

function formatStops(stops: number | null) {
  if (stops == null) return "Stops unknown";
  if (stops === 0) return "Direct";
  return `${stops} stop${stops > 1 ? "s" : ""}`;
}

function formatDuration(minutes: number | null) {
  if (!minutes) return "Time TBC";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins.toString().padStart(2, "0")}m`;
}

function formatLocalTime(dateTime: string | null) {
  if (!dateTime) return "--:--";
  const timePart = dateTime.split("T")[1];
  return timePart?.slice(0, 5) || dateTime;
}

function formatSupplierList(suppliers: string[]) {
  if (suppliers.length === 0) return "live suppliers";
  if (suppliers.length === 1) return suppliers[0];
  if (suppliers.length === 2) return `${suppliers[0]} and ${suppliers[1]}`;
  return `${suppliers.slice(0, -1).join(", ")}, and ${suppliers[suppliers.length - 1]}`;
}

function buildEskyUrl(offer: FlightOffer): string {
  const cabin: Record<string, string> = {
    economy: "0",
    premium_economy: "1",
    business: "2",
    first: "3",
  };

  const origin = offer.originAirportCode ?? "";
  const destination = offer.destinationAirportCode ?? "";
  const depart = offer.departureDate ?? "";
  const pax = offer.passengers ?? 1;
  const cls = cabin[offer.cabinClass] ?? "0";

  if (offer.tripType === "round_trip" && offer.returnDate) {
    return `https://www.esky.ro/flights/results/${origin}/${destination}/${depart}/${offer.returnDate}/${pax}/0/0/${cls}`;
  }

  return `https://www.esky.ro/flights/results/${origin}/${destination}/${depart}/${pax}/0/0/${cls}`;
}

function mapCabinClassToVola(cabinClass: FlightOffer["cabinClass"]) {
  if (cabinClass === "premium_economy") return "PREMIUM_ECONOMY";
  if (cabinClass === "business") return "BUSINESS";
  if (cabinClass === "first") return "FIRST";
  return "ECONOMY";
}

function buildVolaUrl(offer: FlightOffer): string | null {
  const origin = offer.originAirportCode ?? "";
  const destination = offer.destinationAirportCode ?? "";

  if (!origin || !destination || !offer.departureDate) {
    return null;
  }

  const params = new URLSearchParams({
    from: `AIRPORT:${origin}`,
    to: `AIRPORT:${destination}`,
    dd: offer.departureDate,
    ad: String(Math.max(1, offer.passengers ?? 1)),
    cc: mapCabinClassToVola(offer.cabinClass),
    cabin: String(Math.max(0, offer.cabinBags ?? 0)),
    checked: String(Math.max(0, offer.checkedBags ?? 0)),
  });

  if (offer.tripType === "round_trip" && offer.returnDate) {
    params.set("rd", offer.returnDate);
  } else {
    params.set("ow", "1");
  }

  return `https://www.vola.ro/flight_search?${params.toString()}`;
}

function resolveOfferUrl(offer: FlightOffer): string | null {
  if (offer.bookingUrl) {
    return offer.bookingUrl;
  }

  if (offer.supplier === "Vola") {
    return buildVolaUrl(offer);
  }

  if (offer.supplier === "eSky") {
    return buildEskyUrl(offer);
  }

  return null;
}

function BookButton({ offer }: { offer: FlightOffer }) {
  const url = resolveOfferUrl(offer);
  const scale = useRef(new Animated.Value(1)).current;
  const router = useRouter();
  const { setPendingCheckoutOffer } = useUserProfile();

  const onPressIn = () => {
    Animated.spring(scale, {
      toValue: 0.96,
      useNativeDriver: true,
      speed: 40,
      bounciness: 4,
    }).start();
  };

  const onPressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 20,
      bounciness: 10,
    }).start();
  };

  return (
    <Pressable
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={() => {
        setPendingCheckoutOffer(offer);
        router.push('/checkout' as Href);
      }}
    >
      <Animated.View style={[styles.bookButton, { transform: [{ scale }] }]}> 
        <Text style={styles.bookButtonText}>{url ? 'Checkout demo' : 'Preview checkout'}</Text>
        <Feather name="arrow-up-right" size={16} color={Colors.textOnDark} />
      </Animated.View>
    </Pressable>
  );
}

function TypingDots() {
  const dotOpacity = useRef([
    new Animated.Value(0.28),
    new Animated.Value(0.28),
    new Animated.Value(0.28),
  ]).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.stagger(
        120,
        dotOpacity.map((opacity) =>
          Animated.sequence([
            Animated.timing(opacity, {
              toValue: 1,
              duration: 220,
              useNativeDriver: true,
            }),
            Animated.timing(opacity, {
              toValue: 0.28,
              duration: 220,
              useNativeDriver: true,
            }),
          ])
        )
      )
    );

    animation.start();
    return () => animation.stop();
  }, [dotOpacity]);

  return (
    <View style={styles.typingDotsRow}>
      {dotOpacity.map((opacity, index) => (
        <Animated.View
          key={`typing-dot-${index}`}
          style={[styles.typingDot, { opacity }]}
        />
      ))}
    </View>
  );
}

function AnimatedOfferCard({
  offer,
  index,
  isCheapest,
}: {
  offer: FlightOffer;
  index: number;
  isCheapest: boolean;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(18)).current;
  const lowSeats = (offer.availableSeats ?? 0) > 0 && (offer.availableSeats ?? 0) <= 12;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 320,
        delay: index * 70,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 320,
        delay: index * 70,
        useNativeDriver: true,
      }),
    ]).start();
  }, [index, opacity, translateY]);

  return (
    <Animated.View style={[styles.offerCard, { opacity, transform: [{ translateY }] }]}> 
      <View style={styles.offerHeaderRow}>
        <View style={styles.offerHeaderText}>
          <Text style={isCheapest ? styles.cheapestBadge : index === 0 ? styles.bestBadge : styles.rankBadge}>
            {isCheapest ? "Cheapest overall" : index === 0 ? "Runway pick" : `Alternative ${index + 1}`}
          </Text>
          <Text style={styles.offerRoute}>
            {offer.originCity} to {offer.destinationCity}
          </Text>
          <Text style={styles.offerAirline}>
            {offer.airline} · {formatCabinClass(offer.cabinClass)} · {offer.supplier}
          </Text>
        </View>

        <View style={styles.priceBadge}>
          <Text style={styles.priceCurrency}>{offer.currency || "EUR"}</Text>
          <Text style={styles.offerPrice}>{offer.price}</Text>
        </View>
      </View>

      <View style={styles.timelineCard}>
        <View style={styles.timelineStop}>
          <Text style={styles.timelineTime}>{formatLocalTime(offer.departureTimeLocal)}</Text>
          <Text style={styles.timelineCode}>{offer.originAirportCode || offer.originCity}</Text>
        </View>

        <View style={styles.timelineMiddle}>
          <View style={styles.timelineLine} />
          <Text style={styles.timelineMeta}>{formatStops(offer.stops)} · {formatDuration(offer.durationMinutes)}</Text>
        </View>

        <View style={styles.timelineStopRight}>
          <Text style={styles.timelineTime}>{formatLocalTime(offer.arrivalTimeLocal)}</Text>
          <Text style={styles.timelineCode}>{offer.destinationAirportCode || offer.destinationCity}</Text>
        </View>
      </View>

      <View style={styles.metaWrap}>
        <View style={styles.metaChip}>
          <MaterialCommunityIcons name="calendar-range" size={15} color={Colors.accent} />
          <Text style={styles.metaChipText}>
            {formatShortDate(offer.departureDate)}
            {offer.returnDate ? ` → ${formatShortDate(offer.returnDate)}` : ""}
          </Text>
        </View>

        <View style={styles.metaChip}>
          <MaterialCommunityIcons name="bag-carry-on" size={15} color={Colors.accent} />
          <Text style={styles.metaChipText}>Carry-on {offer.cabinBags ?? "?"}</Text>
        </View>

        <View style={styles.metaChip}>
          <MaterialCommunityIcons name="bag-suitcase" size={15} color={Colors.accent} />
          <Text style={styles.metaChipText}>Checked {offer.checkedBags ?? "?"}</Text>
        </View>
      </View>

      <View style={styles.offerFooterRow}>
        <View style={styles.offerInfoCluster}>
          <Text style={styles.seatText}>
            {lowSeats ? "Few seats left" : "Seat visibility"} · {offer.availableSeats}/{offer.maxSeats}
          </Text>
          {offer.hasAccessibleSeating ? (
            <Text style={styles.accessibilityTag}>Accessible seating</Text>
          ) : null}
        </View>

        <BookButton offer={offer} />
      </View>
    </Animated.View>
  );
}

function mapCabinStyleToCabinClass(style: string | null | undefined) {
  const normalized = String(style || "").toLowerCase();
  if (!normalized) return null;
  if (/first/.test(normalized)) return "first" as const;
  if (/business/.test(normalized)) return "business" as const;
  if (/premium/.test(normalized)) return "premium_economy" as const;
  if (/econom/.test(normalized)) return "economy" as const;
  return null;
}

export default function ChatScreen() {
  const {
    profile,
    saveSearch,
    pendingChatPrefill,
    savedSearches,
    setPendingChatPrefill,
  } = useUserProfile();
  const router = useRouter();
  const screenOpacity = useRef(new Animated.Value(0)).current;
  useFocusEffect(
    useCallback(() => {
      screenOpacity.setValue(0);
      const fade = Animated.timing(screenOpacity, { toValue: 1, duration: 260, useNativeDriver: true });
      fade.start();
      return () => fade.stop();
    }, [])
  );

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [lastSurpriseIndex, setLastSurpriseIndex] = useState(-1);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const listRef = useRef<FlatList<Message> | null>(null);
  const inputRef = useRef<import("react-native").TextInput | null>(null);
  const sendMessageRef = useRef<(prefilledText?: string) => Promise<void>>(async () => {});
  const tabBarHeight = useBottomTabBarHeight();
  const composerBottomOffset = tabBarHeight + 18;

  useEffect(() => {
    if (!pendingChatPrefill) return;
    setPendingChatPrefill(null);
    void sendMessageRef.current(pendingChatPrefill);
  }, [pendingChatPrefill, setPendingChatPrefill]);

  useEffect(() => {
    let isMounted = true;

    const runHealthCheck = async () => {
      try {
        const data = await fetchBackendHealth();
        if (!isMounted) return;
        setHealth(data);
        setHealthError(null);
      } catch (error: any) {
        if (!isMounted) return;
        setHealthError(error?.message || "Backend unavailable");
      }
    };

    runHealthCheck();
    const intervalId = setInterval(runHealthCheck, 15000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, []);

  const handleSurpriseMe = () => {
    let index: number;
    do {
      index = Math.floor(Math.random() * SURPRISE_PROMPTS.length);
    } while (index === lastSurpriseIndex && SURPRISE_PROMPTS.length > 1);

    setLastSurpriseIndex(index);
    sendMessage(SURPRISE_PROMPTS[index]);
  };

  const handleStartFresh = () => {
    resetChatSession();
    setMessages([]);
    setInput("");
    setLastSurpriseIndex(-1);
  };

  const sendMessage = async (prefilledText?: string) => {
    const text = (prefilledText ?? input).trim();
    if (!text || isSending) return;

    const userId = Date.now().toString();
    const typingId = (Date.now() + 1).toString();

    setIsSending(true);
    setMessages((prev) => [
      ...prev,
      { id: userId, text, role: "user" },
      {
        id: typingId,
        text: "Scanning routes, fares, and clarifications for the cleanest fit.",
        role: "assistant",
        typing: true,
      },
    ]);
    setInput("");

    try {
      const result = await sendChatMessage(text, {
        cabinClass: mapCabinStyleToCabinClass(profile.cabinStyle),
        needsAccessibleSeating: profile.needsAccessibleSeating,
      });

      if (result.offers && result.offers.length > 0 && result.extracted) {
        saveSearch({
          originCity: result.extracted.originCity,
          originAirportCode: result.extracted.originAirportCode,
          destinationCity: result.extracted.destinationCity,
          destinationAirportCode: result.extracted.destinationAirportCode,
          departureDate: result.extracted.departureDate,
          returnDate: result.extracted.returnDate,
          tripType: result.extracted.tripType,
          passengers: result.extracted.passengers,
        });
      }

      if (result.mode === "clarification") {
        const suggestions = (result.suggestions && result.suggestions.length > 0)
          ? result.suggestions
          : parseSuggestionsFromQuestions(result.questions);

        const pf = result.pendingFields ?? [];
        const needsDeparture = pf.includes("departureDate");
        const needsReturn = pf.includes("returnDate");
        const datePicker = (needsDeparture || needsReturn)
          ? {
              needsDeparture,
              needsReturn,
              tripType: result.extracted?.tripType ?? null,
            }
          : null;

        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === typingId
              ? {
                  ...msg,
                  typing: false,
                  text:
                    result.questions?.join("\n") ??
                    "I need a few more details to refine your trip.",
                  suggestions,
                  datePicker,
                }
              : msg
          )
        );
        return;
      }

      if (result.mode === "no_results") {
        const s = result.noResultsSearch;
        const from = s?.originCity ?? "origin";
        const to = s?.destinationCity ?? "destination";
        const date = s?.departureDate ? formatShortDate(s.departureDate) : "selected date";
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === typingId
              ? {
                  ...msg,
                  typing: false,
                  text: `No flights found from ${from} to ${to} on ${date}.`,
                  noResults: true,
                  noResultsSearch: s ?? null,
                }
              : msg
          )
        );
        return;
      }

      let introText = "";
      const offerCount = (result.offers ?? []).length;
      const liveSuppliers = Array.from(
        new Set(
          (result.offers ?? [])
            .map((offer) => offer.supplier)
            .filter((supplier) => supplier && supplier !== "Demo")
        )
      );

      if (result.mode === "real_and_sample" || result.mode === "real_only") {
        introText = `Live search complete. I found ${offerCount} current offers across ${formatSupplierList(liveSuppliers)} for this trip.`;
      } else if (result.mode === "strict") {
        introText = `I found ${offerCount} offers that match your request very closely.`;
      } else if (result.mode === "relaxed") {
        introText = `I didn't find exact matches, but I found ${offerCount} alternatives that keep your route and dates while relaxing some filters.`;
      } else if (offerCount === 0) {
        introText = "I couldn't find available offers for that request right now. Try another route, airport, or date window.";
      } else {
        introText = `I couldn't satisfy every filter, but here are ${offerCount} route suggestions worth checking.`;
      }

      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === typingId
            ? {
                ...msg,
                typing: false,
                text: introText,
                offers: result.offers ?? [],
                suggestions: result.suggestions ?? [],
                warning: result.warning ?? null,
                requestId: result.requestId,
                normalizationSummary: result.normalization?.summary || null,
                normalizedDateNote:
                  result.normalization?.datePolicy?.supplierAdjustedDates
                    ? `Dates adjusted by supplier: ${result.normalization.datePolicy.requestedDepartureDate || "-"} → ${result.normalization.datePolicy.supplierDepartureDate || "-"}${result.normalization.datePolicy.requestedReturnDate ? `, ${result.normalization.datePolicy.requestedReturnDate} → ${result.normalization.datePolicy.supplierReturnDate || "-"}` : ""}`
                    : null,
                comparisonSummary: result.comparison?.summary || null,
                cheapestOfferId: result.comparison?.cheapestOfferId || null,
              }
            : msg
        )
      );
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === typingId
            ? {
                ...msg,
                typing: false,
                text: getFriendlyErrorMessage(err),
              }
            : msg
        )
      );
    } finally {
      setIsSending(false);
    }
  };

  sendMessageRef.current = sendMessage;

  const renderOfferCard = (offer: FlightOffer, index: number, cheapestOfferId?: string | null) => (
    <AnimatedOfferCard
      key={offer.id}
      offer={offer}
      index={index}
      isCheapest={offer.id === cheapestOfferId}
    />
  );

  return (
    <Animated.View style={[styles.flex, { opacity: screenOpacity }]}>
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={16}
      >
        <LinearGradient
          colors={["#1E7BC2", "#3A96D0", "#73B9E2", "#BDD9EE", "#E5EDF4"]}
          locations={[0, 0.22, 0.48, 0.70, 1]}
          style={styles.pageBackground}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
        >
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[
              styles.listContent,
              { paddingBottom: composerBottomOffset + 150 },
            ]}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            ListHeaderComponent={
              messages.length === 0 ? (
                <View style={styles.homeSection}>
                  {/* Top bar */}
                  <View style={styles.homeTopBar}>
                    <View style={styles.statusPill}>
                      <View style={[styles.statusDot, health?.ok ? styles.statusDotOk : styles.statusDotDown]} />
                      <Text style={styles.statusText}>
                        {health?.ok
                          ? health.scraper?.ready ? "Live · scraper ready" : "Live"
                          : healthError ? "Offline" : "Connecting…"}
                      </Text>
                    </View>
                    <View style={styles.avatarCircle}>
                      {profile.photoBase64 ? (
                        <Image source={{ uri: profile.photoBase64 }} style={styles.avatarImage} />
                      ) : (
                        <Text style={styles.avatarText}>{(profile.firstName || "S")[0].toUpperCase()}</Text>
                      )}
                    </View>
                  </View>

                  {/* Greeting */}
                  <Text style={styles.greetingName}>Hi, {profile.firstName || "Traveler"}!</Text>
                  <Text style={styles.greetingSub}>How can I assist you today?</Text>

                  {/* CTA */}
                  <Pressable onPress={() => inputRef.current?.focus()}>
                    <LinearGradient
                      colors={[Colors.primary, Colors.secondary]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.startSearchBtn}
                    >
                      <Feather name="search" size={18} color={Colors.white} />
                      <Text style={styles.startSearchBtnText}>Start New Search</Text>
                    </LinearGradient>
                  </Pressable>

                  {/* Quick actions */}
                  <View style={styles.quickRow}>
                    <Pressable style={styles.quickBtn} onPress={handleSurpriseMe} disabled={isSending}>
                      <MaterialCommunityIcons name="dice-5" size={20} color="rgba(255,255,255,0.95)" />
                      <Text style={styles.quickBtnLabel}>Surprise me</Text>
                    </Pressable>
                    <Pressable style={styles.quickBtn} onPress={() => router.push('/explore' as Href)}>
                      <Feather name="clock" size={20} color="rgba(255,255,255,0.95)" />
                      <Text style={styles.quickBtnLabel}>Recent trips</Text>
                    </Pressable>
                    <Pressable style={styles.quickBtn} onPress={() => router.push('/profile' as Href)}>
                      <Feather name="user" size={20} color="rgba(255,255,255,0.95)" />
                      <Text style={styles.quickBtnLabel}>Profile</Text>
                    </Pressable>
                  </View>

                  {/* Feature cards 2×2 */}
                  <View style={styles.featureGrid}>
                    {[FEATURE_CARDS.slice(0, 2), FEATURE_CARDS.slice(2, 4)].map((row, ri) => (
                      <View key={ri} style={styles.featureRow}>
                        {row.map((card) => (
                          <Pressable
                            key={card.id}
                            style={{ flex: 1 }}
                            onPress={() => {
                              if (card.id === "search") inputRef.current?.focus();
                              else if (card.id === "bookings") router.push({ pathname: "/explore", params: { scrollTo: "bookings" } } as any);
                              else if (card.id === "trips") router.push({ pathname: "/explore", params: { scrollTo: "searches" } } as any);
                              else if (card.id === "profile") router.push("/profile" as Href);
                            }}
                          >
                            <LinearGradient colors={['#FFFFFF', '#FFFFFF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.featureCard}>
                              <View style={[styles.featureIconWrap, { backgroundColor: card.tint + "22" }]}>
                                <MaterialCommunityIcons name={card.icon as any} size={22} color={card.tint} />
                              </View>
                              <Text style={styles.featureCardTitle}>{card.title}</Text>
                              <Text style={styles.featureCardDesc}>{card.desc}</Text>
                            </LinearGradient>
                          </Pressable>
                        ))}
                      </View>
                    ))}
                  </View>

                  {/* Quick prompt suggestions */}
                  <Text style={styles.suggestionsLabel}>Try asking…</Text>
                  <View style={styles.suggestionPromptList}>
                    {QUICK_PROMPTS.map((item) => (
                      <Pressable
                        key={item.id}
                        onPress={() => sendMessage(item.prompt)}
                        disabled={isSending}
                      >
                        <LinearGradient colors={['#FFFFFF', '#FFFFFF']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.suggestionPromptCard}>
                          <View style={styles.suggestionPromptIcon}>
                            <MaterialCommunityIcons name={item.icon as any} size={18} color={Colors.primary} />
                          </View>
                          <View style={styles.suggestionPromptText}>
                            <Text style={styles.suggestionPromptTitle}>{item.title}</Text>
                            <Text style={styles.suggestionPromptMeta}>{item.meta}</Text>
                          </View>
                          <Feather name="arrow-right" size={14} color={Colors.textMuted} />
                        </LinearGradient>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : (
                <View style={styles.chatHeaderBar}>
                  <View>
                    <Text style={styles.chatBarTitle}>Flight Assistant</Text>
                    <Text style={styles.chatBarSub}>{messages.length} message{messages.length !== 1 ? "s" : ""}</Text>
                  </View>
                  <Pressable style={styles.chatBarReset} onPress={handleStartFresh}>
                    <Feather name="rotate-ccw" size={13} color={Colors.primary} />
                    <Text style={styles.chatBarResetText}>New search</Text>
                  </Pressable>
                </View>
              )
            }
            renderItem={({ item }) => {
              const isUser = item.role === "user";
              const bubbleStyle = [styles.messageBubble, isUser ? styles.userBubble : styles.assistantBubble];

              const bubbleContent = (
                <>
                  <View style={styles.messageHeader}>
                    <Text style={[styles.messageRole, isUser ? styles.userRole : styles.assistantRole]}>
                      {isUser ? "You" : "Flight assistant"}
                    </Text>
                    {!isUser ? (
                      <MaterialCommunityIcons name="airplane-search" size={16} color={Colors.accent} />
                    ) : null}
                  </View>

                  {item.typing && isSending ? (
                    <View style={styles.typingWrap}>
                      <TypingDots />
                      <Text style={styles.typingLabel}>Mapping routes and fares…</Text>
                    </View>
                  ) : (
                    <Text style={[styles.messageText, isUser ? styles.userText : styles.assistantText]}>
                      {item.text}
                    </Text>
                  )}

                  {item.datePicker && !item.typing ? (
                    <InlineDatePicker
                      needsDeparture={item.datePicker.needsDeparture}
                      needsReturn={item.datePicker.needsReturn}
                      tripType={item.datePicker.tripType}
                      onConfirm={(text) => sendMessage(text)}
                      disabled={isSending}
                    />
                  ) : null}

                  {item.noResults ? (
                    <View style={styles.noResultsCard}>
                      <MaterialCommunityIcons name="airplane-off" size={36} color={Colors.textMuted} />
                      <Text style={styles.noResultsTitle}>No flights available</Text>
                      <Text style={styles.noResultsDesc}>
                        We couldn't find any flights matching these parameters. Try different dates, airports, or a nearby route.
                      </Text>
                      <View style={styles.noResultsActions}>
                        <Pressable
                          style={styles.noResultsResetBtn}
                          onPress={handleStartFresh}
                        >
                          <Feather name="rotate-ccw" size={14} color={Colors.textOnDark} />
                          <Text style={styles.noResultsResetText}>New search</Text>
                        </Pressable>
                        <Pressable
                          style={styles.noResultsEditBtn}
                          onPress={() => {
                            const s = item.noResultsSearch;
                            if (s) {
                              const parts: string[] = [];
                              if (s.originCity) parts.push(`from ${s.originCity}`);
                              if (s.destinationCity) parts.push(`to ${s.destinationCity}`);
                              if (s.departureDate) parts.push(`on ${s.departureDate}`);
                              setInput(parts.join(" "));
                            }
                            inputRef.current?.focus();
                          }}
                        >
                          <Feather name="edit-2" size={14} color={Colors.accent} />
                          <Text style={styles.noResultsEditText}>Edit search</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : null}

                  {item.offers && item.offers.length > 0 ? (
                    <View style={styles.offersList}>
                      {item.comparisonSummary ? (
                        <View style={styles.comparisonBox}>
                          <Text style={styles.comparisonTitle}>Cheapest comparison</Text>
                          <Text style={styles.comparisonText}>{item.comparisonSummary}</Text>
                        </View>
                      ) : null}

                      <Text style={styles.offerSectionTitle}>Suggested fare board</Text>
                      {item.offers.map((offer, index) => renderOfferCard(offer, index, item.cheapestOfferId))}
                    </View>
                  ) : null}

                  {item.warning ? (
                    <View style={styles.warningBox}>
                      <Feather name="alert-circle" size={15} color={Colors.primaryDeep} />
                      <Text style={styles.warningText}>{item.warning}</Text>
                    </View>
                  ) : null}

                  {item.normalizationSummary ? (
                    <View style={styles.normalizationBox}>
                      <Text style={styles.normalizationTitle}>Normalization</Text>
                      <Text style={styles.normalizationText}>{item.normalizationSummary}</Text>
                      {item.normalizedDateNote ? (
                        <Text style={styles.normalizationDate}>{item.normalizedDateNote}</Text>
                      ) : null}
                    </View>
                  ) : null}

                  {item.requestId ? (
                    <Text style={styles.requestIdText}>Request ID · {item.requestId}</Text>
                  ) : null}

                  {item.suggestions && item.suggestions.length > 0 ? (
                    <View style={styles.suggestionsList}>
                      {item.suggestions.map((suggestion) => (
                        <Pressable
                          key={`${item.id}-${suggestion}`}
                          style={styles.suggestionChip}
                          onPress={() => sendMessage(suggestion)}
                          disabled={isSending}
                        >
                          <Text style={styles.suggestionChipText}>{suggestion}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </>
              );

              return (
                <View style={[styles.messageRow, isUser ? styles.userRow : styles.assistantRow]}>
                  {isUser ? (
                    <LinearGradient
                      colors={[Colors.primary, Colors.primaryDeep]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={bubbleStyle}
                    >
                      {bubbleContent}
                    </LinearGradient>
                  ) : (
                    <View style={bubbleStyle}>{bubbleContent}</View>
                  )}
                </View>
              );
            }}
          />

          <View style={[styles.composerWrap, { bottom: composerBottomOffset }]}>
            <View style={styles.composerHintRow}>
              <Text style={styles.composerHint}>Try “Bucharest to Amsterdam under 350 euro”</Text>
              {messages.length > 0 ? (
                <Pressable onPress={handleStartFresh}>
                  <Text style={styles.composerReset}>Clear</Text>
                </Pressable>
              ) : null}
            </View>

            <View style={styles.composerCard}>
              <TextInput
                ref={inputRef}
                style={styles.input}
                placeholder="Where do you want to fly next?"
                placeholderTextColor={Colors.textMuted}
                value={input}
                onChangeText={setInput}
                multiline
                textAlignVertical="top"
                returnKeyType="send"
                blurOnSubmit
                onSubmitEditing={() => void sendMessage()}
              />

              <View style={styles.composerActions}>
                <Pressable
                  style={[styles.secondaryComposerButton, isSending && styles.buttonDisabled]}
                  onPress={handleSurpriseMe}
                  disabled={isSending}
                >
                  <MaterialCommunityIcons name="dice-5" size={18} color={Colors.accent} />
                </Pressable>

                <Pressable
                  style={[{ flex: 1 }, isSending && styles.buttonDisabled]}
                  onPress={() => sendMessage()}
                  disabled={isSending}
                >
                  <LinearGradient
                    colors={[Colors.primary, Colors.secondary]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.primaryComposerButton}
                  >
                    <Text style={styles.primaryComposerButtonText}>{isSending ? "Working" : "Send"}</Text>
                    <Feather name="arrow-up-right" size={16} color={Colors.textOnDark} />
                  </LinearGradient>
                </Pressable>
              </View>
            </View>
          </View>
        </LinearGradient>
      </KeyboardAvoidingView>
    </SafeAreaView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: "#E5EDF4" },
  pageBackground: { flex: 1 },
  listContent: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 170,
  },

  // ── Home screen (empty state) ─────────────────────────────────
  homeSection: {
    gap: 18,
    paddingTop: 8,
    marginBottom: 16,
  },
  homeTopBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.30)",
    borderRadius: Radius.pill,
    flexShrink: 1,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusDotOk: { backgroundColor: "#4FFFB0" },
  statusDotDown: { backgroundColor: Colors.error },
  statusText: {
    color: "#FFFFFF",
    fontFamily: Typography.sansSemiBold,
    fontSize: 11,
  },
  avatarCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: {
    width: 42,
    height: 42,
    borderRadius: 21,
  },
  avatarText: {
    color: Colors.white,
    fontFamily: Typography.sansBold,
    fontSize: 18,
  },
  greetingName: {
    color: "#FFFFFF",
    fontFamily: Typography.sansBold,
    fontSize: 32,
    letterSpacing: -0.5,
    lineHeight: 38,
  },
  greetingSub: {
    color: "rgba(255,255,255,0.80)",
    fontFamily: Typography.sans,
    fontSize: 15,
    lineHeight: 22,
    marginTop: -6,
  },
  startSearchBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: Colors.primary,
    borderRadius: Radius.pill,
    paddingVertical: 16,
    ...Shadows.glow,
  },
  startSearchBtnText: {
    color: Colors.white,
    fontFamily: Typography.sansBold,
    fontSize: 16,
  },
  quickRow: {
    flexDirection: "row",
    gap: 10,
  },
  quickBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.22)",
    borderRadius: Radius.lg,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.30)",
  },
  quickBtnLabel: {
    color: "rgba(255,255,255,0.90)",
    fontFamily: Typography.sansMedium,
    fontSize: 10,
    textAlign: "center",
  },
  featureGrid: { gap: 10 },
  featureRow: { flexDirection: "row", gap: 10 },
  featureCard: {
    borderRadius: Radius.xl,
    padding: 16,
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.soft,
  },
  featureIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  featureCardTitle: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansBold,
    fontSize: 14,
  },
  featureCardDesc: {
    color: Colors.textMuted,
    fontFamily: Typography.sans,
    fontSize: 12,
    lineHeight: 16,
  },

  // ── Quick prompt suggestions ──────────────────────────────────
  suggestionsLabel: {
    color: '#FFFFFF',
    fontFamily: Typography.sansSemiBold,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: -4,
  },
  suggestionPromptList: {
    gap: 10,
  },
  suggestionPromptCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 14,
    paddingVertical: 14,
    ...Shadows.soft,
  },
  suggestionPromptIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.primary + "18",
    alignItems: "center",
    justifyContent: "center",
  },
  suggestionPromptText: {
    flex: 1,
    gap: 2,
  },
  suggestionPromptTitle: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansSemiBold,
    fontSize: 13,
  },
  suggestionPromptMeta: {
    color: Colors.textMuted,
    fontFamily: Typography.sans,
    fontSize: 11,
  },

  // ── Active chat header ────────────────────────────────────────
  chatHeaderBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
    paddingTop: 8,
  },
  chatBarTitle: {
    color: "#FFFFFF",
    fontFamily: Typography.sansBold,
    fontSize: 20,
  },
  chatBarSub: {
    color: "rgba(255,255,255,0.70)",
    fontFamily: Typography.sansMedium,
    fontSize: 12,
    marginTop: 2,
  },
  chatBarReset: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    backgroundColor: "rgba(255,255,255,0.20)",
  },
  chatBarResetText: {
    color: "#FFFFFF",
    fontFamily: Typography.sansSemiBold,
    fontSize: 12,
  },
  messageRow: {
    marginBottom: 14,
  },
  userRow: {
    alignItems: "flex-end",
  },
  assistantRow: {
    alignItems: "stretch",
  },
  messageBubble: {
    borderRadius: Radius.xl,
    padding: 16,
  },
  userBubble: {
    maxWidth: "86%",
    backgroundColor: Colors.primary,
    borderBottomRightRadius: 10,
    ...Shadows.soft,
  },
  assistantBubble: {
    width: "100%",
    backgroundColor: Colors.surfaceRaised,
    borderWidth: 1,
    borderColor: Colors.border,
    borderBottomLeftRadius: 10,
    ...Shadows.soft,
  },
  messageHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  messageRole: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.9,
  },
  userRole: {
    color: "rgba(255, 248, 240, 0.76)",
    fontFamily: Typography.sansBold,
  },
  assistantRole: {
    color: Colors.accent,
    fontFamily: Typography.sansBold,
  },
  messageText: {
    fontSize: 14,
    lineHeight: 21,
  },
  userText: {
    color: Colors.textOnDark,
    fontFamily: Typography.sansMedium,
  },
  assistantText: {
    color: Colors.textPrimary,
    fontFamily: Typography.sans,
  },
  typingWrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    gap: 6,
    paddingVertical: 4,
  },
  typingDotsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minWidth: 28,
  },
  typingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.accent,
  },
  typingLabel: {
    color: Colors.textSecondary,
    fontFamily: Typography.sansMedium,
    fontSize: 12,
  },
  offersList: {
    marginTop: 14,
    gap: 12,
  },
  comparisonBox: {
    backgroundColor: Colors.surfaceAccent,
    borderRadius: Radius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.accentSoft,
  },
  comparisonTitle: {
    color: Colors.accent,
    fontFamily: Typography.sansBold,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  comparisonText: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansMedium,
    fontSize: 12,
    lineHeight: 18,
  },
  offerSectionTitle: {
    color: Colors.textPrimary,
    fontFamily: Typography.displaySoft,
    fontSize: 26,
    lineHeight: 26,
  },
  offerCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 14,
    gap: 12,
  },
  offerHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  offerHeaderText: {
    flex: 1,
  },
  bestBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    backgroundColor: Colors.secondarySoft,
    color: Colors.primaryDeep,
    fontFamily: Typography.sansBold,
    fontSize: 11,
    marginBottom: 8,
  },
  cheapestBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accent,
    color: Colors.textOnDark,
    fontFamily: Typography.sansBold,
    fontSize: 11,
    marginBottom: 8,
  },
  rankBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    backgroundColor: Colors.skySoft,
    color: Colors.accent,
    fontFamily: Typography.sansBold,
    fontSize: 11,
    marginBottom: 8,
  },
  offerRoute: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansBold,
    fontSize: 17,
    marginBottom: 4,
  },
  offerAirline: {
    color: Colors.textSecondary,
    fontFamily: Typography.sansMedium,
    fontSize: 13,
  },
  priceBadge: {
    minWidth: 76,
    borderRadius: Radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: Colors.surfaceDark,
    alignItems: "flex-end",
  },
  priceCurrency: {
    color: "rgba(255, 248, 240, 0.68)",
    fontFamily: Typography.sansSemiBold,
    fontSize: 10,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  offerPrice: {
    color: Colors.textOnDark,
    fontFamily: Typography.display,
    fontSize: 28,
    lineHeight: 28,
  },
  timelineCard: {
    borderRadius: Radius.lg,
    padding: 14,
    backgroundColor: Colors.skySoft,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  timelineStop: {
    alignItems: "flex-start",
    minWidth: 68,
  },
  timelineStopRight: {
    alignItems: "flex-end",
    minWidth: 68,
  },
  timelineTime: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansBold,
    fontSize: 18,
    marginBottom: 2,
  },
  timelineCode: {
    color: Colors.textSecondary,
    fontFamily: Typography.sansSemiBold,
    fontSize: 12,
  },
  timelineMiddle: {
    flex: 1,
    alignItems: "center",
    gap: 6,
  },
  timelineLine: {
    width: "100%",
    height: 1,
    backgroundColor: Colors.borderStrong,
  },
  timelineMeta: {
    color: Colors.textSecondary,
    fontFamily: Typography.sansSemiBold,
    fontSize: 11,
  },
  metaWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: Colors.surfaceSoft,
  },
  metaChipText: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansSemiBold,
    fontSize: 12,
  },
  offerFooterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  offerInfoCluster: {
    flex: 1,
    gap: 6,
  },
  seatText: {
    color: Colors.textSecondary,
    fontFamily: Typography.sansMedium,
    fontSize: 12,
  },
  accessibilityTag: {
    alignSelf: "flex-start",
    color: Colors.accent,
    fontFamily: Typography.sansBold,
    fontSize: 11,
    backgroundColor: Colors.accentSoft,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.pill,
  },
  bookButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: Radius.pill,
  },
  bookButtonDisabled: {
    opacity: 0.45,
  },
  bookButtonText: {
    color: Colors.textOnDark,
    fontFamily: Typography.sansBold,
    fontSize: 12,
  },
  warningBox: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: Colors.secondarySoft,
    borderRadius: Radius.md,
    padding: 10,
  },
  warningText: {
    flex: 1,
    color: Colors.primaryDeep,
    fontFamily: Typography.sansSemiBold,
    fontSize: 12,
    lineHeight: 18,
  },
  normalizationBox: {
    marginTop: 12,
    backgroundColor: Colors.accentSoft,
    borderRadius: Radius.md,
    padding: 12,
  },
  normalizationTitle: {
    color: Colors.accent,
    fontFamily: Typography.sansBold,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  normalizationText: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansMedium,
    fontSize: 12,
    lineHeight: 18,
  },
  normalizationDate: {
    marginTop: 4,
    color: Colors.textSecondary,
    fontFamily: Typography.sans,
    fontSize: 12,
    lineHeight: 18,
  },
  requestIdText: {
    marginTop: 10,
    color: Colors.textMuted,
    fontFamily: Typography.sansMedium,
    fontSize: 10,
  },
  suggestionsList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  suggestionChip: {
    backgroundColor: Colors.skySoft,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  suggestionChipText: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansSemiBold,
    fontSize: 12,
  },
  composerWrap: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 16,
    gap: 8,
  },
  composerHintRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 6,
  },
  composerHint: {
    color: Colors.textSecondary,
    fontFamily: Typography.sansMedium,
    fontSize: 11,
  },
  composerReset: {
    color: Colors.accent,
    fontFamily: Typography.sansBold,
    fontSize: 11,
  },
  composerCard: {
    backgroundColor: Colors.surfaceRaised,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    ...Shadows.card,
  },
  input: {
    minHeight: 58,
    maxHeight: 120,
    color: Colors.textPrimary,
    fontFamily: Typography.sansMedium,
    fontSize: 15,
    lineHeight: 22,
    paddingHorizontal: 6,
    paddingTop: 6,
    paddingBottom: 10,
  },
  composerActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  secondaryComposerButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.accentSoft,
  },
  primaryComposerButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    flex: 1,
    borderRadius: Radius.pill,
    paddingVertical: 14,
  },
  primaryComposerButtonText: {
    color: Colors.textOnDark,
    fontFamily: Typography.sansBold,
    fontSize: 14,
  },
  buttonDisabled: {
    opacity: 0.7,
  },

  // ── No results card ───────────────────────────────────────────
  noResultsCard: {
    marginTop: 16,
    alignItems: "center",
    gap: 10,
    backgroundColor: Colors.skySoft,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.accentSoft,
    padding: 20,
  },
  noResultsTitle: {
    color: Colors.textPrimary,
    fontFamily: Typography.sansBold,
    fontSize: 16,
  },
  noResultsDesc: {
    color: Colors.textSecondary,
    fontFamily: Typography.sans,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  noResultsActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  noResultsResetBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: Radius.pill,
  },
  noResultsResetText: {
    color: Colors.textOnDark,
    fontFamily: Typography.sansBold,
    fontSize: 13,
  },
  noResultsEditBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.surfaceAccent,
    borderWidth: 1,
    borderColor: Colors.accentSoft,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: Radius.pill,
  },
  noResultsEditText: {
    color: Colors.accent,
    fontFamily: Typography.sansBold,
    fontSize: 13,
  },
});