// Features the app's dependencies use that the oldest supported WebViews
// (iOS 15.0–15.3, Chrome 91) lack. Imported first, from main.ts.

// Used by Cally (via Atomico).
if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, 'at', {
    configurable: true,
    writable: true,
    value: function at<T>(this: T[], index: number): T | undefined {
      const i = Math.trunc(index) || 0;
      return this[i < 0 ? this.length + i : i];
    },
  });
}
