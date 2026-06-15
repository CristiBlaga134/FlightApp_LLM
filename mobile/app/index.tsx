import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { Colors } from "../src/theme/colors";
import { useAuth } from "../src/context/AuthContext";

export default function Index() {
  const { user, authLoading } = useAuth();

  if (authLoading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: Colors.background,
        }}
      >
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return <Redirect href={user ? "/(tabs)" : "/login"} />;
}