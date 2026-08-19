import { Tabs, router, usePathname } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useAppState } from '../../components/AppState';
import { BottomTabs, TabId } from '../../components/BottomTabs';

const ROUTE_BY_TAB: Record<TabId, string> = {
  orders: '/',
  messages: '/messages',
  profile: '/profile',
};

export default function TabsLayout() {
  return (
    <View style={styles.root}>
      {/* Штатная панель вкладок отключена: у приложения своя — плавающая
          «таблетка», которая умеет прятаться под шторками. Она отрисована
          соседом поверх навигатора, чтобы сохранить absolute-позиционирование. */}
      <Tabs
        tabBar={() => null}
        screenOptions={{
          headerShown: false,
          animation: 'fade',
          sceneStyle: { backgroundColor: 'transparent' },
        }}
      >
        <Tabs.Screen name="index" />
        <Tabs.Screen name="messages" />
        <Tabs.Screen name="profile" />
      </Tabs>

      <FloatingTabBar />
    </View>
  );
}

function FloatingTabBar() {
  const pathname = usePathname();
  const { hasUnreadMessages, chatOpen, overlayOpen, masterOpen } = useAppState();

  const active: TabId = pathname.startsWith('/messages')
    ? 'messages'
    : pathname.startsWith('/profile')
      ? 'profile'
      : 'orders';

  return (
    <BottomTabs
      active={active}
      onSelect={(tab) => router.navigate(ROUTE_BY_TAB[tab] as never)}
      hasUnreadMessages={hasUnreadMessages}
      hidden={
        (active === 'messages' && chatOpen) || (active === 'orders' && overlayOpen) || masterOpen
      }
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
