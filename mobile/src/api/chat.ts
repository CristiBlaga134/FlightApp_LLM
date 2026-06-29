import { getApiBaseUrl } from "./baseUrl";

export class ChatApiError extends Error {
  code: "NETWORK" | "HTTP" | "INVALID_RESPONSE";
  status?: number;

  constructor(
    message: string,
    code: "NETWORK" | "HTTP" | "INVALID_RESPONSE",
    status?: number
  ) {
    super(message);
    this.name = "ChatApiError";
    this.code = code;
    this.status = status;
  }
}

export type FlightOffer = {
  id: string;
  supplier: string;
  bookingUrl: string | null;
  originCity: string;
  originAirportCode: string | null;
  destinationCity: string;
  destinationAirportCode: string | null;
  tripType: "one_way" | "round_trip";
  departureDate: string;
  returnDate: string | null;
  airline: string;
  cabinClass: "economy" | "premium_economy" | "business" | "first";
  price: number;
  currency: string;
  cabinBags: number | null;
  checkedBags: number | null;
  passengers: number;
  stops: number | null;
  durationMinutes: number;
  departureTimeLocal: string;
  arrivalTimeLocal: string;
  maxSeats: number;
  availableSeats: number;
  hasAccessibleSeating: boolean;
  score?: number;
};

export type ChatSearchResponse = {
  requestId?: string;
  sessionId?: string;
  extracted: {
    originCity: string | null;
    originAirportCode: string | null;
    destinationCity: string | null;
    destinationAirportCode: string | null;
    departureDate: string | null;
    returnDate: string | null;
    tripType: "one_way" | "round_trip" | null;
    maxPrice: number | null;
    currency: string | null;
    cabinClass: "economy" | "premium_economy" | "business" | "first" | null;
    cabinBags: number | null;
    checkedBags: number | null;
    passengers: number | null;
    maxStops: number | null;
    needsAccessibleSeating: boolean | null;
  };
  mode:
    | "strict"
    | "relaxed"
    | "suggestions"
    | "clarification"
    | "real_and_sample"
    | "real_only"
    | "no_results";
  offers?: FlightOffer[];
  questions?: string[];
  suggestions?: string[];
  pendingFields?: string[];
  noResultsSearch?: {
    originCity: string | null;
    destinationCity: string | null;
    departureDate: string | null;
    returnDate: string | null;
  } | null;
  normalization?: {
    policy?: string;
    requiresUserConfirmation?: boolean;
    userConfirmed?: boolean;
    requested: Record<string, string | number | null>;
    normalized: Record<string, string | number | null>;
    diffs: {
      field: string;
      requested: string | number | null;
      normalized: string | number | null;
    }[];
    summary?: string;
    datePolicy?: {
      requestedDepartureDate: string | null;
      requestedReturnDate: string | null;
      supplierDepartureDate: string | null;
      supplierReturnDate: string | null;
      supplierAdjustedDates: boolean;
    };
  };
  comparison?: {
    cheapestOfferId: string;
    supplier: string;
    price: number;
    currency: string;
    savingsVsNext: number | null;
    summary: string;
    supplierBreakdown: {
      supplier: string;
      price: number;
      currency: string;
      offerId: string;
    }[];
  };
  warning?: string | null;
};

export type ChatProfileDefaults = {
  cabinClass?: "economy" | "premium_economy" | "business" | "first" | null;
  needsAccessibleSeating?: boolean;
};

let activeChatSessionId: string | null = null;

export function resetChatSession() {
  activeChatSessionId = null;
}

export async function sendChatMessage(
  message: string,
  profileDefaults?: ChatProfileDefaults
): Promise<ChatSearchResponse> {
  const baseUrl = await getApiBaseUrl();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90000);

  try {
    const response = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        profile: profileDefaults || {},
        sessionId: activeChatSessionId,
      }),
      signal: controller.signal,
    });

    const raw = await response.text();
    let data: any = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      if (!response.ok) {
        throw new ChatApiError("Server returned an invalid error payload.", "INVALID_RESPONSE", response.status);
      }
      throw new ChatApiError("Server returned invalid JSON.", "INVALID_RESPONSE", response.status);
    }

    if (typeof data?.sessionId === "string" && data.sessionId.trim()) {
      activeChatSessionId = data.sessionId.trim();
    }

    if (!response.ok) {
      throw new ChatApiError(data?.error || "Server error", "HTTP", response.status);
    }

    return data as ChatSearchResponse;
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new ChatApiError("The request timed out. Please try again.", "NETWORK");
    }
    if (error instanceof ChatApiError) {
      throw error;
    }
    throw new ChatApiError("Could not reach the server. Check connection and backend status.", "NETWORK");
  } finally {
    clearTimeout(timeoutId);
  }
}