import { Platform } from "react-native";
import Constants from "expo-constants";

const PORT = 3000;

function getExpoHost(): string | null {
  const hostUri =
    Constants.expoConfig?.hostUri ||
    (Constants as any)?.manifest2?.extra?.expoGo?.debuggerHost ||
    (Constants as any)?.manifest?.debuggerHost ||
    null;

  if (!hostUri || typeof hostUri !== "string") return null;

  return hostUri.split(":")[0];
}

export async function getApiBaseUrl(): Promise<string> {
  if (Platform.OS === "web") {
    return `http://localhost:${PORT}`;
  }

  const expoHost = getExpoHost();

  if (expoHost) {
    return `http://${expoHost}:${PORT}`;
  }

  if (Platform.OS === "android") {
    return `http://10.0.2.2:${PORT}`;
  }

  throw new Error("Could not determine backend URL");
}