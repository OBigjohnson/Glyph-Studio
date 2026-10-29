import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  BackHandler,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

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
  const savingDocument = useRef(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [hasLoadError, setHasLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!canGoBack) return false;
      webView.current?.goBack();
      return true;
    });

    return () => subscription.remove();
  }, [canGoBack]);

  function retry() {
    setHasLoadError(false);
    setReloadKey((key) => key + 1);
  }

  async function handleWebViewMessage(event) {
    if (savingDocument.current) return;
    let message;
    try {
      message = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (message?.type !== 'glyph.document.download') return;
    if (
      typeof message.data !== 'string'
      || message.data.length > 20_000_000
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(message.data)
    ) {
      Alert.alert('Could not save PDF', 'The document data is invalid or too large.');
      return;
    }

    savingDocument.current = true;
    try {
      const fileName = `${String(message.filename || 'GLYPH-document')
        .replace(/\.pdf$/i, '')
        .replace(/[^a-zA-Z0-9_-]/g, '-')}-${Date.now()}`;
      if (Platform.OS === 'android') {
        const downloadFolder = FileSystem.StorageAccessFramework.getUriForDirectoryInRoot('Download');
        const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync(downloadFolder);
        if (!permission.granted) {
          Alert.alert('Save cancelled', 'Choose a folder when prompted to save your PDF.');
          return;
        }
        const fileUri = await FileSystem.StorageAccessFramework.createFileAsync(
          permission.directoryUri,
          fileName,
          'application/pdf',
        );
        await FileSystem.writeAsStringAsync(fileUri, message.data, {
          encoding: FileSystem.EncodingType.Base64,
        });
        Alert.alert('PDF saved', 'Your document has been saved to the selected folder.');
      } else {
        const fileUri = `${FileSystem.documentDirectory}${fileName}.pdf`;
        await FileSystem.writeAsStringAsync(fileUri, message.data, {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (!(await Sharing.isAvailableAsync())) {
          Alert.alert('PDF saved', 'Your document is saved in the GLYPH Studio app documents.');
          return;
        }
        await Sharing.shareAsync(fileUri, {
          mimeType: 'application/pdf',
          UTI: 'com.adobe.pdf',
          dialogTitle: 'Save receipt PDF',
        });
      }
    } catch (error) {
      Alert.alert('Could not save PDF', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      savingDocument.current = false;
    }
  }

  return (
    <View style={styles.container}>
      <ExpoStatusBar style="light" />
      {!hasLoadError && (
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
          onMessage={handleWebViewMessage}
          onError={() => setHasLoadError(true)}
          style={styles.webView}
        />
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
