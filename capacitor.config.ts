import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

const config: CapacitorConfig = {
  appId: 'org.vorthmann.checkrspot',
  appName: 'CheckrSpot',
  webDir: 'dist',
  ios: {
    // Stops WKWebView scrolling the whole page to reveal a focused field,
    // which would move fixed headers such as the editor's Cancel/Save bar.
    // The Keyboard plugin enforces this; scrolling inside elements works.
    scrollEnabled: false,
  },
  plugins: {
    SplashScreen: {
      // Hidden from src/main.ts once the saved readings have been drawn.
      launchAutoHide: false,
    },
    Keyboard: {
      // Leave the web view full height: screens make room for the keyboard
      // themselves (--keyboard-height, set in src/main.ts), at the moment
      // it starts to appear rather than after the plugin's delayed resize.
      resize: KeyboardResize.None,
    },
  },
};

export default config;
