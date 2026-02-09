import 'react-native-gesture-handler';
import React, { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import RootNavigator from './src/navigation/RootNavigator';
import { useAuthStore } from './src/stores/useAuthStore';
import { useChatStore } from './src/stores/useChatStore';

export default function App() {
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        console.log('⚡ App has come to the foreground - Resuming...');
        const { user, token } = useAuthStore.getState();
        if (user && token) {
          useChatStore.getState().connectSocket(token, user.id);
        }
      } else if (nextAppState.match(/inactive|background/)) {
        console.log('💤 App has gone to the background - Pausing to save reads...');
        useChatStore.getState().disconnectSocket();
      }

      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <RootNavigator />
    </SafeAreaProvider>
  );
}
