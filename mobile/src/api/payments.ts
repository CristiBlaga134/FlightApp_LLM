import type { FlightOffer } from './chat';
import { getApiBaseUrl } from './baseUrl';

export class PaymentApiError extends Error {
  code: 'NETWORK' | 'HTTP' | 'INVALID_RESPONSE';
  status?: number;
  details?: string[];

  constructor(
    message: string,
    code: 'NETWORK' | 'HTTP' | 'INVALID_RESPONSE',
    status?: number,
    details?: string[]
  ) {
    super(message);
    this.name = 'PaymentApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type PaymentProviderConfig = {
  activeProvider: string;
  integrationShape: 'stripe-compatible';
  merchantDisplayName: string;
  supportedAdapters: string[];
  routes: {
    createSession: string;
    confirm: string;
    webhook: string;
  };
  supportsPaymentSheet: boolean;
  publishableKey: string | null;
  stripePlaceholders: {
    publishableKeyConfigured: boolean;
    secretKeyConfigured: boolean;
    webhookSecretConfigured: boolean;
  };
  testCards: {
    label: string;
    number: string;
    note: string;
    expectedEvent: string;
  }[];
};

export type PaymentSession = {
  id: string;
  provider: string;
  providerMode: 'test';
  status: 'requires_payment_method' | 'processing' | 'succeeded' | 'failed';
  amount: number;
  currency: string;
  customerEmail: string | null;
  merchantDisplayName: string;
  supportedPaymentMethods: string[];
  paymentIntent: {
    id: string;
    object: 'payment_intent';
    providerReference: string | null;
    status: 'requires_payment_method' | 'processing' | 'succeeded';
    clientSecret: string | null;
    nextAction: string | null;
    captureMethod: 'automatic';
    confirmationMethod: 'manual';
    paymentMethodTypes: string[];
    metadata: {
      paymentSessionId: string;
      supplier: string;
      route: string;
      bookingReference: string | null;
    };
  };
  offer: {
    id: string;
    supplier: string;
    airline: string | null;
    originCity: string;
    destinationCity: string;
    departureDate: string;
    returnDate: string | null;
    tripType: 'one_way' | 'round_trip';
    price: number;
    currency: string;
  };
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PaymentSessionRequest = {
  offer: FlightOffer;
  customerEmail?: string | null;
  customerName?: string | null;
};

export type PaymentSessionResponse = {
  requestId?: string;
  paymentSession: PaymentSession;
  providerConfig: PaymentProviderConfig;
};

export type PaymentConfirmationRequest = {
  paymentSessionId: string;
  traveler: {
    firstName: string;
    lastName: string;
    email: string;
  };
  paymentMethod: {
    cardholderName: string;
    cardNumber: string;
    expiryMonth: string;
    expiryYear: string;
    cvc: string;
  };
  billingAddress: {
    country: string;
    city: string;
    line1: string;
    postalCode: string;
  };
};

export type PaymentBooking = {
  paymentId: string;
  paymentSessionId: string;
  paymentIntentId: string;
  bookingReference: string;
  status: 'succeeded' | 'processing';
  supplier: string;
  airline: string | null;
  amount: number;
  currency: string;
  paymentProvider: string;
  traveler: {
    firstName: string;
    lastName: string;
    email: string;
  };
  paymentMethod: {
    brand: string;
    last4: string;
    cardholderName: string;
  };
  billingAddress: {
    country: string;
    city: string;
    line1: string;
    postalCode: string;
  };
  offer: {
    id: string;
    supplier: string;
    originCity: string;
    destinationCity: string;
    departureDate: string;
    returnDate: string | null;
    airline: string | null;
    tripType: 'one_way' | 'round_trip';
  };
  createdAt: string;
  estimatedConfirmationAt: string | null;
};

export type PaymentEvent = {
  id: string;
  type: 'payment_intent.succeeded' | 'payment_intent.processing' | 'payment_intent.payment_failed';
  provider: string;
  livemode: boolean;
  createdAt: string;
  data: {
    object: {
      id: string;
      object: 'payment_intent';
      amount: number;
      currency: string;
      status: string;
      client_secret: string | null;
      metadata: {
        paymentSessionId: string;
        bookingReference: string | null;
        supplier: string;
        route: string;
      };
    };
  };
};

export type PaymentConfirmationResponse = {
  requestId?: string;
  paymentSession: PaymentSession;
  booking: PaymentBooking | null;
  paymentEvent: PaymentEvent | null;
  providerConfig: PaymentProviderConfig;
};

export async function createPaymentSession(payload: PaymentSessionRequest): Promise<PaymentSessionResponse> {
  const baseUrl = await getApiBaseUrl();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${baseUrl}/payments/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const raw = await response.text();
    let data: any = null;

    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      throw new PaymentApiError('Server returned invalid JSON for the payment session request.', 'INVALID_RESPONSE', response.status);
    }

    if (!response.ok) {
      const details = Array.isArray(data?.details) ? data.details.map((detail: unknown) => String(detail)) : undefined;
      const message = details && details.length > 0
        ? details.join(' ')
        : (data?.error || 'Payment session request failed.');
      throw new PaymentApiError(message, 'HTTP', response.status, details);
    }

    return data as PaymentSessionResponse;
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new PaymentApiError('The payment service timed out while preparing the session. Please try again.', 'NETWORK');
    }
    if (error instanceof PaymentApiError) {
      throw error;
    }
    throw new PaymentApiError('Could not reach the payment service.', 'NETWORK');
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function confirmPayment(payload: PaymentConfirmationRequest): Promise<PaymentConfirmationResponse> {
  const baseUrl = await getApiBaseUrl();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(`${baseUrl}/payments/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const raw = await response.text();
    let data: any = null;

    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      throw new PaymentApiError('Server returned invalid JSON for the payment confirmation request.', 'INVALID_RESPONSE', response.status);
    }

    if (!response.ok) {
      const details = Array.isArray(data?.details) ? data.details.map((detail: unknown) => String(detail)) : undefined;
      const message = details && details.length > 0
        ? details.join(' ')
        : (data?.error || 'Payment confirmation request failed.');
      throw new PaymentApiError(message, 'HTTP', response.status, details);
    }

    return data as PaymentConfirmationResponse;
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new PaymentApiError('The payment confirmation timed out. Please try again.', 'NETWORK');
    }
    if (error instanceof PaymentApiError) {
      throw error;
    }
    throw new PaymentApiError('Could not reach the payment confirmation service.', 'NETWORK');
  } finally {
    clearTimeout(timeoutId);
  }
}