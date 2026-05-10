import { Stack } from 'expo-router';
import { Colors } from '../../theme';

export default function ProfilesLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.background } }}>
      <Stack.Screen name="form" />
    </Stack>
  );
}
