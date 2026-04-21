import { Stack } from 'expo-router';
import { Colors } from '../../../theme';

export default function MessagesLayout() {
  return (
    <Stack screenOptions={{ headerShown: true, contentStyle: { backgroundColor: Colors.background } }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[id]" />
    </Stack>
  );
}
