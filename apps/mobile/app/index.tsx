import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { HomeScreen } from '../src/home-screen.js';
import { tokenStore } from '../src/session/api.js';

export default function IndexRoute() {
  const [accessToken, setAccessToken] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
    void tokenStore.getAccessToken().then((token) => {
      if (mounted) {
        setAccessToken(token);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (accessToken === undefined) {
    return null;
  }

  if (!accessToken) {
    return <Redirect href="/(auth)/phone" />;
  }

  return <HomeScreen />;
}
