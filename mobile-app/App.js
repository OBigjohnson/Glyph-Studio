import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import studioLogo from './assets/glyph-logo.png';
import {
  Animated,
  ActivityIndicator,
  BackHandler,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';

const STUDIO_HOST = 'glyphstudio.cv';
const STUDIO_URL = `https://${STUDIO_HOST}/studio?app=mobile`;

function isAllowedAppUrl(uri) {
  try {
    const url = new URL(uri);
    const isStudioRoute = url.pathname === '/studio' || url.pathname.startsWith('/studio/');
    const isAuthRoute = url.pathname === '/sign-in' || url.pathname === '/create-account';
    return url.protocol === 'https:' && url.hostname === STUDIO_HOST && (isStudioRoute || isAuthRoute);
  } catch {
    return false;
  }
}

export default function App() {
  const webView = useRef(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoadError, setHasLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [logoRotation] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!canGoBack) return false;
      webView.current?.goBack();
      return true;
    });

    return () => subscription.remove();
  }, [canGoBack]);

  useEffect(() => {
    if (!isLoading) return undefined;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(logoRotation, {
          toValue: 1,
          duration: 1800,
          useNativeDriver: true,
        }),
        Animated.timing(logoRotation, {
          toValue: 0,
          duration: 1800,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [isLoading, logoRotation]);

  function retry() {
    setHasLoadError(false);
    setIsLoading(true);
    setReloadKey((key) => key + 1);
  }

  return (
    <View style={styles.container}>
      <ExpoStatusBar style="light" />
      <WebView
        key={reloadKey}
        ref={webView}
        source={{ uri: STUDIO_URL }}
        originWhitelist={[`https://${STUDIO_HOST}`]}
        javaScriptEnabled
        domStorageEnabled
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false}
        mixedContentMode="never"
        onShouldStartLoadWithRequest={(request) => isAllowedAppUrl(request.url)}
        onNavigationStateChange={(state) => setCanGoBack(state.canGoBack)}
        onLoadStart={() => {
          setIsLoading(true);
          setHasLoadError(false);
        }}
        onLoadEnd={() => setIsLoading(false)}
        onError={() => {
          setIsLoading(false);
          setHasLoadError(true);
        }}
        style={styles.webView}
      />
      {isLoading && !hasLoadError && (
        <View style={styles.loading}>
          <Animated.Image
            source={studioLogo}
            style={[
              styles.logo,
              {
                transform: [
                  { perspective: 700 },
                  {
                    rotateY: logoRotation.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['-12deg', '12deg'],
                    }),
                  },
                ],
              },
            ]}
          />
          <ActivityIndicator color="#7790ff" size="large" />
          <Text style={styles.loadingText}>Preparing your studio</Text>
          <Text style={styles.loadingCaption}>A thoughtful space for your work.</Text>
        </View>
      )}
      {hasLoadError && (
        <View style={styles.error}>
          <Text style={styles.title}>Couldn’t load your studio</Text>
          <Text style={styles.message}>Check your internet connection and try again.</Text>
          <TouchableOpacity accessibilityRole="button" onPress={retry} style={styles.button}>
            <Text style={styles.buttonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#090c12',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0,
  },
  webView: {
    flex: 1,
    backgroundColor: '#090c12',
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#090c12',
  },
  logo: {
    width: 76,
    height: 76,
    marginBottom: 28,
    borderRadius: 19,
  },
  loadingText: {
    color: '#eef1ff',
    marginTop: 20,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  loadingCaption: {
    color: '#7e89a2',
    fontSize: 12,
    marginTop: 6,
  },
  error: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    backgroundColor: '#090c12',
  },
  title: {
    color: '#eef1ff',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  message: {
    color: '#9aa6bf',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
    textAlign: 'center',
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#4366ff',
    borderRadius: 8,
    marginTop: 22,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
