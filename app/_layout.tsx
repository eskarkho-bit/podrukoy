import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import 'react-native-reanimated';
import { AppStateProvider, useAppState } from '../components/AppState';
import { MasterScreen } from '../screens/MasterScreen';
import { useTheme } from '../theme';

export default function RootLayout() {
  return (
    <AppStateProvider>
      <RootShell />
    </AppStateProvider>
  );
}

// Оболочка живёт внутри провайдера — только так она видит тему и режим мастера
function RootShell() {
  const { mode, colors } = useTheme();
  const { masterOpen, setMasterOpen } = useAppState();

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />

      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      />

      {/* Режим мастера — оверлей поверх всего приложения. Он намеренно остаётся
          смонтированным: иначе сессия мастера и его заявки сбрасывались бы при
          каждом выходе в профиль. */}
      <MasterScreen open={masterOpen} onClose={() => setMasterOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
