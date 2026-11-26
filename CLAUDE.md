# CheckrSpot

Field data-collection app (Capacitor 8, iOS + Android). At each spot the
user scans a short QR code ID tag, and the app saves it with a GPS fix and
optional free-text **locality** (two lines), **taxon** and **collector**. Readings can also be
imported from library photos (EXIF time and GPS, plus a QR code if present). Readings are stored
locally in SQLite; photos are not taken or stored. A **region** (e.g. `US-AZ, Pima Co.`)
is added later by reverse geocoding, on demand. Pre-release proof of concept
with no users yet.

The [README.md](README.md) covers setup, build/run commands, permissions and
persistence for humans. Keep it in sync when behaviour, schema, permissions or
dependencies change.

## Workflow

- After every change to `src/`, `index.html` or config, run
  `npm run build && npx cap copy ios`. The user runs the app from Xcode, which
  loads web assets from `ios/App/App/public`; skipping the copy leaves a stale
  build on the device.
- Adding or removing a native plugin needs `npx cap sync` instead of `copy`.
- `npm run build` runs `tsc` first, so it doubles as the type check. There are
  no tests or linter.
- iOS compile check without a device:
  `xcodebuild -project ios/App/App.xcodeproj -scheme CheckrSpot2 -destination 'generic/platform=iOS Simulator' build CODE_SIGNING_ALLOWED=NO`
  (the Xcode project is `App.xcodeproj`, but the app scheme is **CheckrSpot2**).
  Don't boot or run simulators; the user tests on their own phone.
- `tools.sh` (`iphone <udid>` / `ios` / `android <path>`) is the user's
  build-and-deploy script, copied from `../fence-jobs`. Don't run any of
  these commands unasked.

## Stack

- Vanilla TypeScript + Vite 8, no framework. TypeScript 6.
- `vite.config.ts` sets `build.target` to `es2020`/`chrome91`/`safari16`
  because the app runs in platform WebViews, which can be old (Android 12
  emulator images ship Chrome ~91; iOS 16 is the deployment target). Without
  it the minifier drops CSS fallbacks such as `height: 100%` before `100dvh`.
  When using newer CSS, add a fallback and check it survives in `dist/`.
- Capacitor 8. iOS dependencies via **Swift Package Manager** (no CocoaPods);
  any new plugin must ship a `Package.swift`.
- Plugins: `@capacitor/geolocation`, `@capacitor/barcode-scanner` (official
  Ionic/OutSystems live scanner), `@capacitor-community/sqlite`,
  `@capacitor/splash-screen`, `@capacitor/clipboard` (`navigator.clipboard` is
  unreliable in Android WebView).
- `@capacitor/keyboard` with `resize: none` and iOS `scrollEnabled: false`
  (`capacitor.config.ts`): WKWebView otherwise scrolls the whole page to
  reveal a focused field, moving fixed headers (the editor's Cancel/Save bar)
  off screen. On iOS, `main.ts` sets `--keyboard-height` on
  `keyboardWillShow`/`WillHide` and screens with fields subtract it (the
  editor's `.screen` height); it then scrolls the focused field into view,
  and again on every `focusin`. `resize: native` was tried and was
  unreliable: the plugin resizes the web view ~0.2 s after the keyboard has
  finished appearing. Android resizes the web view itself, so there the
  reveal runs on window `resize`. The plugin hides iOS's keyboard accessory
  bar by default; `main.ts` turns it back on.
  Capacitor blocks page pinch-zoom on iOS by being the web view's scroll
  delegate; the Keyboard plugin replaces that delegate when scrolling is
  disabled, so `index.html`'s viewport meta also sets `maximum-scale=1,
  user-scalable=no`. Without it, two-finger gestures zoom the whole page.
- `@capacitor/network`: only to grey out the taxon chooser's Choose button
  when offline.
- Web libraries: `cally` (calendar web components; falls back to `<style>`
  where constructable stylesheets are missing), `temporal-polyfill` (loaded
  by dynamic import only when `globalThis.Temporal` is missing; its own
  chunk), `@photostructure/tz-lookup` (offline coordinates → IANA zone, about
  70 KB). Types for Temporal come from TS's `ESNext.Temporal` lib.
- `src/polyfills.ts` (imported first) adds what dependencies need beyond the
  oldest WebViews: `Array.prototype.at` (Cally; missing before Chrome 92).
  Check new dependencies for such APIs. MapLibre also uses `.at()` and
  `Object.hasOwn` in its web worker, which this can't reach, so the map
  fails on WebViews older than Chrome 92 (old emulator images only; real
  devices update their WebView). The fix, if ever needed: load a polyfill
  into the workers with `maplibregl.importScriptInWorkers`.
- `maplibre-gl` **5.x** (BSD) for the location chooser, with OpenFreeMap's
  `liberty` style (OSM vector tiles, no key). Loaded by dynamic import with
  the chooser (its own ~275 KB gzipped chunk and CSS). 6.x is ESM-only with
  a module worker; 5.x's UMD build works with Vite as is. No satellite
  view, by the user's choice (it would need a keyed imagery service).

## Files

- `src/main.ts` — UI and logic except the editor. Markup is one
  `app.innerHTML` template (list, capture button, `<dialog>`s), followed by
  plain DOM code. No components or state library.
- `src/editor.ts` — the reading editor (`createEditor(host)` → `open(r)`),
  with its own markup template appended to `#app`, the general chooser
  mechanism (`Chooser`: group, panel, fields, `begin`) and the date/time
  chooser (Cally calendar + `makeWheel` scroll-snap wheels). `EditorHost` gives it
  `lookUpPlace` (= `resolvePlace`) and `save` (`updateReading` + refresh).
- `src/taxonChooser.ts` — the taxon chooser panel (`TAXON_CHOOSER_MARKUP`,
  included in the editor's markup; `createTaxonChooser(host)` → `begin(spot)`),
  its settings (`localStorage` `taxonChooser`) and grid.
- `src/inaturalist.ts` — iNaturalist API client: `nearbyTaxa`
  (`/observations/species_counts`, session cache by query), `searchTaxa`
  (`/taxa/autocomplete`), `isoWeek`, `weeksAround`. `CapacitorHttp` with
  User-Agent `CheckrSpot/2.0`, as for Nominatim.
- `src/elevation.ts` — `elevationAt(lat, lng)`: Open-Meteo's elevation API
  (Copernicus 90 m DEM, no key; free for non-commercial use, CC BY 4.0, so
  credit it before release). Same `CapacitorHttp` and User-Agent.
- `src/locationChooser.ts` — the location chooser's map
  (`createLocationChooser(wrap, host)` → `begin(start)` / `end()`); its
  panel markup is in `editor.ts`.
- `src/motion.ts` — `SLIDE_MS` (matches the CSS transitions),
  `reducedMotion`, `afterSlide`, `expand` (height animation for a panel).
- `src/time.ts` — `initTime` (polyfill), `zoneAt(lat, lng)` (IANA zone or
  null), `wallTime` / `fromWallTime` (epoch ms ↔ date, `hh:mm` and the
  sub-minute ms in a zone; UTC when the zone is null), `parseWallTime`,
  `zoneName` (e.g. "MST").
- `src/db.ts` — `Reading` type, `ReadingsStore` interface, schema, and two
  implementations: SQLite on native, in-memory stub on web (`npm run dev`).
- `src/geocoder.ts` — `Place` and `ReverseGeocoder`, the service-neutral
  interface for region lookups, and `AreaFinder` (`areaOf(place)` from the
  stored details, `findArea(regionText)` by search) returning `Bounds`
  (south, north, west, east). The app depends only on these.
- `src/nominatim.ts` — `NominatimGeocoder`: serial request queue (≥ 1.5 s
  apart), cache keyed by coordinates rounded to 0.001°, offline fail-fast,
  region formatting; `findArea` searches (`/search`, through the same queue)
  with the region text turned back into a query ("US-AZ, Pima Co." →
  "Pima County, US-AZ"). Uses `CapacitorHttp` so it can send a User-Agent.
- `dev-docs/reverse-geocoding.md` — design of the region lookup, including
  the decisions behind it (temperature and elevation lookups dropped).
- `src/export.ts` — `toJSON` / `toCSV` / `exportFilename` for Copy and
  Download, and `formatReading` (the reading's date and `hh:mm` in its own
  zone, `Z`-suffixed when unknown; shared with labels).
- `src/fileSaver.ts` — `FileSaver` plugin wrapper (`saveFile`); browser
  download on web.
- `src/photoImport.ts` — `PhotoImport` plugin wrapper (`pickPhotos`, native
  only) and `photoReading`, which validates a picked photo and turns its
  metadata into a `Fix` + code.
- `src/printer.ts` — `Printer` plugin wrapper (`printWebView`); falls back to
  `window.print()` on web.
- `src/style.css` — light/dark themes via CSS variables on `:root`; iOS-like
  look. Also the label styles (ported from the old app's
  `CheckrSpot/Resources/styles.css`) and the `@media print` rules.
- `ios/App/App/PrinterPlugin.swift` — the app's own `Printer` plugin plus
  `AppViewController` (a `CAPBridgeViewController` subclass that registers
  it and `FileSaverPlugin`; `SceneDelegate` uses it as the root view
  controller).
- `ios/App/App/FileSaverPlugin.swift` — the app's own `FileSaver` plugin:
  writes a temp file and presents `UIDocumentPickerViewController(forExporting:)`.
  Added to `project.pbxproj` by hand (the project doesn't use synchronized
  folders), as were `PrinterPlugin.swift` and `PhotoImportPlugin.swift`.
- `ios/App/App/PhotoImportPlugin.swift` — the app's own `PhotoImport`
  plugin: `PHPickerViewController` (no permission, `.current` representation
  so the original file and metadata come through), ImageIO for EXIF/GPS,
  Vision for QR codes.
- `android/app/src/main/java/org/vorthmann/checkrspot/PrinterPlugin.java` and
  `FileSaverPlugin.java` (`ACTION_CREATE_DOCUMENT`, no storage permission) and
  `PhotoImportPlugin.java` — Android plugins, registered in `MainActivity`.
  PhotoImport uses `ACTION_OPEN_DOCUMENT`, not the photo picker (which always
  strips GPS), requests `ACCESS_MEDIA_LOCATION`, and reads the
  `MediaStore.setRequireOriginal` URI when it can; EXIF via
  `androidx.exifinterface`, QR via ML Kit (same version as the scanner
  plugin's); both are declared in `android/app/build.gradle`. No official Capacitor plugin
  offers a "save as" dialog, hence our own (the user chose this over
  Filesystem + Share).
- `ios/App/App/Info.plist` — camera and location usage strings.
- `android/variables.gradle` — `minSdkVersion = 26` (required by the scanner).

## Data model

Table `readings` (`src/db.ts`): `id` (autoincrement row id), `latitude`,
`longitude`, `accuracy` (m, nullable: imported photos often lack
`GPSHPositioningError`), `altitude` (m, nullable), `recorded_at` (epoch
ms, from the fix's timestamp), `code` (text, NOT NULL, CHECK length ≤
`MAX_CODE_LENGTH` = 25), `locality`, `locality2`, `taxon` and `collector`
(text, null when blank), `region`, `place_source` and `place_details`
(reverse geocoding; all null until looked up; `place_source` is `manual`,
with null details, for a region typed in the editor). `locality2` is the locality's second line. TS fields are camelCase (`recordedAt`); `ReadingDetails` = code +
locality + locality2 + taxon + collector. `Fix` = latitude, longitude,
accuracy, altitude, recordedAt; `insertReading(fix, details)` takes one, built
from a `Position` (capture) or a photo (import).

- `id` is the row id. The scanned value is **`code`** (the user rejected
  reusing `id` for it). The UI labels the code "ID".
- Codes are short alphanumerics, typically 2–5 characters, never more than 25.
- `place_source` null means "not looked up yet" (TS: `place == null`).
  `place_details` is the service's whole response as JSON, kept for a future
  JSON export (which must credit © OpenStreetMap contributors). A spot with
  no name (open ocean) has a place but `region` null. The data field is
  `region`, not `location` (too close to `locality`).
- **Schema policy before first release:** edit the version-1 statement in
  place and keep `DB_VERSION = 1`; no migrations. Existing installs must be
  deleted and reinstalled after a schema change; tell the user this. After
  release, add new `{ toVersion, statements }` entries instead.

## Behaviour

- **Location watch** runs only while the app is visible (`visibilitychange`
  starts/stops it). Fixes older than `STALE_FIX_MS` (3 s) are ignored, which
  drops the stale cached location iOS sends first. If no updates arrive for
  3 s the fix is cleared.
- **Capture button** (QR icon + location arrow) is amber when there's no fix
  or accuracy is poor, and green when accuracy is good: ≤ 40 m to turn green,
  > 50 m to drop back (hysteresis). The colour is advisory only; any current
  fix can be recorded.
- **Capture flow** (`recordFix`): snapshot the current fix at tap time (on
  Android the scanner covers the app, which stops the watch) → native live
  scanner restricted to QR codes → reject codes over 25 characters → details
  dialog with optional Locality / Taxon / Collector → insert → refresh list.
  - Cancelling the scanner rejects with code `OS-PLUG-BARC-0006`, treated as
    a silent cancel. This was taken from the plugin's iOS source; not yet
    confirmed on Android.
  - Details dialog: Discard drops the whole reading. The second locality
    input sits under the first, inside the same Locality label, with no label
    of its own. Return in the locality lines and Taxon moves to the next field, and in Collector dismisses the keyboard
    (otherwise it would submit the form via its first button, Discard).
    Both locality lines and Collector are prefilled from the last saved
    reading, kept as one JSON object in `localStorage` (`lastDetails`;
    written only on Save, blanks included). The locality lines are stored
    as a pair because they correlate. No backdrop-tap close, so typed
    text isn't lost. Taxon has autocorrect/spellcheck off (Latin names).
    Inputs are ≥ 16px to avoid iOS focus zoom. The dialog sits near the top so
    the keyboard doesn't cover it. Native keyboard dictation works with no
    extra permission.
- **Photo import** (toolbar Import, hidden in selection mode;
  `importPhotos`): native picker, multiple selection → for each photo,
  `photoReading` requires lat/long, a capture time and at most one QR code
  (≤ 25 chars); with none, `code` is `''` (column stays NOT NULL). Time: EXIF DateTimeOriginal + OffsetTimeOriginal, else GPS
  date/time (UTC), else DateTimeOriginal as local time in the zone at the
  photo's coordinates. Photos whose
  code + recordedAt match an existing reading are skipped as duplicates. One
  photo picked → details dialog (as at capture; Discard drops it); several →
  saved with the remembered collector (`lastDetails`), no locality or taxon.
  Native reads photos one at a time (iOS: chained completion handlers, no
  blocking) and sends `importProgress` events before each; the app shows
  them in a modal `#import-status` dialog ("Reading photos… n of m"). Problems are listed in an alert afterwards (toast
  if none); the list then scrolls to the newest imported reading. Accuracy
  is blank ("Unknown") in the editor and left off labels when null.
- **Time zones**: `recorded_at` is UTC; every display, edit and export uses
  the zone at the reading's coordinates (`zoneAt`), never the device's. The
  user chose deriving it over storing it. Null zone (no Temporal, unknown
  place, or a zone the WebView's Intl lacks) → UTC, times suffixed `Z`.
  Seconds are stored but never shown or exported. `localDateTime` (device
  time) is only for the export file name.
- **List**: all readings, newest first. Each row shows code (bold, left) and
  taxon (right, ellipsized). Tap opens the editor (it replaced a read-only
  inspector dialog).
- **Editor** (`editor.ts`): full-screen `<dialog class="screen">` sliding in
  from the right; Cancel / code title / Save (disabled until a field
  changes). Field groups, in order: ID, Taxon (with Choose), Date and time
  (with zone name and Choose), Location (with Choose: latitude | longitude,
  Region, then Accuracy | Altitude | Copy), Locality (two lines),
  Collector. Region and Altitude sit in Location because they're derived
  from the coordinates. Copy puts "lat, lng" as typed on the clipboard (the form
  Google Maps accepts) and briefly reads "Copied". Every field is text; return moves to the
  next. Closing with changes (Cancel, left-edge swipe, Escape / Android back
  via the dialog's `cancel` event) asks "Discard changes?".
  - Saving: a field left as shown keeps the stored value (text has less
    precision). Date and time are wall-clock in the zone of the *new*
    coordinates, so moving a reading keeps its clock time; seconds are kept
    unless the time text changed. Typed region → manual place; cleared →
    place null; moved coordinates drop a non-manual place.
  - Choosers: Choose collapses the other groups (height animation on
    `.field-group`, the card inside keeps its size), slides the chooser up
    from the bottom (capped below the group via `--chooser-top`), makes all
    inputs read-only and writes the chooser's values into the group's fields
    live. Done keeps them; Cancel restores. Choosers that need the network
    (taxon, location) have Choose disabled offline.
  - The user wants Cally for the calendar; the time is hour and minute
    wheels (24-hour).
  - **Taxon chooser**: iNat `species_counts` for the base taxon within the
    radius of the typed coordinates, in the ISO weeks of the year around the
    typed date (any year; `week=`, wrapping at New Year, 53 added there;
    omitted when the window covers the year), `verifiable=true`, up to 500,
    most observed first. A 3-column grid of square thumbnails (`medium_url`,
    `object-fit: cover`) with the count overlaid top right at a quarter of
    the tile edge (`--tile-size`, set from the tile width by a
    ResizeObserver) and the scientific name below (italic at genus and
    below). Tapping a tile puts the scientific name in Taxon and closes the
    chooser (as Done); the bar has Cancel, a summary ("Butterflies · 25 km ·
    ±3 wk") and a gear. The gear expands settings: base taxon (searched by
    name via autocomplete; stored as id + display name, the name used only
    for display), radius km (0–500) and ± weeks (0–26, one number for both sides), applied
    on leaving the field, invalid values undone. Both have − / + buttons:
    weeks by 1, radius through `RADIUS_STEPS` (1, 2, 5 … 500); the summary
    updates at once and the grid reloads 0.5 s after the last tap. Defaults: Butterflies
    (47224), 25 km, ±3 weeks. Choose is disabled offline (`@capacitor/network`);
    a failed request shows "Couldn't reach iNaturalist." with Retry.
  - **Location chooser** (fields: latitude, longitude, accuracy, altitude, region;
    Copy is hidden while it's open). MapLibre's CSS loads after ours, so
    the container rule needs two classes (`.map-wrap .location-map`) to keep
    `position: absolute`; with MapLibre's `relative` the map has no height.
    Unfilled circle.
    MapLibre map filling the panel; bar Cancel / "Tap to place the pin" /
    Done. One finger pans; two fingers pan, zoom and rotate; no tilt
    (`maxPitch: 0`, so the accuracy maths holds). A tap moves the pin there,
    eases the map to centre on it (instant with reduced motion) and writes
    lat/lng (5 dp). The accuracy circle is an HTML overlay always half the
    map's width, centred on the pin (`map.project` on every move); accuracy
    = its radius on the ground (quarter width × metres per pixel at the
    pin's latitude, 512-px world), written live on zoom. On opening, the
    zoom is set from the typed accuracy (25 m if unknown). Dots for every
    other reading; a blue dot for the device, fed from `main.ts`'s location
    watch (`fixListeners`, notified in `render()`), not
    `navigator.geolocation`, which would ask for permission again on iOS.
    Compass (NavigationControl) shown only while rotated. Without valid
    typed coordinates there's no pin until a tap, and the map starts at the
    region's area (stored Nominatim `boundingbox`, else `findArea` on the
    text), else the device's position, else the world.
    Moving the pin looks up its region (`placeAt` = `geocoder.lookup`, not
    saved) into the Region field ("Looking up…" meanwhile; older lookups
    dropped, and cancelled with the chooser). If the reading is saved with
    those coordinates and that region text, the looked-up place is saved
    with it (`pinPlace`), not treated as a typed region. The same run
    looks up the pin's altitude (`elevationAt`) into the Altitude field,
    which is cleared meanwhile and left blank if the lookup fails. Typed
    coordinates don't trigger either lookup.
- **Region lookup** (Nominatim, `zoom=9`, `accept-language=en`,
  User-Agent `CheckrSpot/2.0`, no contact email by the user's choice) runs
  only on demand, never at capture or in the background: moving the pin in
  the location chooser looks up that spot, and opening the
  editor looks up **that reading only** (Region placeholder "Looking up…",
  filled in if still open and not typed over), and Labels looks up the
  selected readings. `resolvePlace` in `main.ts` does lookup → `setPlace` →
  replaces the reading in `readings`; list rows look readings up by id for
  this reason.
- **Selection mode** (toolbar Select/Cancel): rows toggle iOS-style
  checkmarks, the capture button is replaced by an action bar with a
  Labels button, copy and download icons (left) and a delete button (right), and
  deletion asks for confirmation.
- **Labels**: a full-screen sheet that slides up, previewing labels for the
  selected readings (oldest first) at 2× via CSS `zoom`, with Done and Print.
  If any selected reading has no place yet, the sheet first shows
  "Reverse geocoding… n of m" (Print disabled); on failures it shows
  Cancel / Retry / Continue anyway (renders labels without those regions and
  prints). Each opening or retry is a run (`labelsRun`); stale runs' results
  are saved but don't touch the sheet. Region is the first line of the
  label's locality block.
  Labels are rendered twice: in the sheet, and into a `.print-only` copy
  appended to `<body>`. Print calls the native plugin, which prints the whole
  web view; `@media print` hides `#app` (and every `dialog`) and shows only the
  copy. WKWebView and Android WebView ignore `window.print()`, hence the
  plugin. Label text is 3pt (~4px); Android WebView enlarges text under 8px by
  default, so the plugin's `load()` lowers the minimum font size.
- **Copy and Download** (copy and download icons) share one flow
  (`ExportAction`): a small dialog picks JSON or CSV (segmented control; the
  selected segment is accent-filled, with no focus ring because the dialog
  autofocuses it), each action preselecting its own last choice
  (`localStorage` `copyFormat` / `downloadFormat`). Then the same region
  lookup as Labels runs (`lookUpPlaces`, shared), shown in a modal status
  dialog with Cancel, and Retry / Continue anyway on failure (runs via
  `exportRun`). Then `Clipboard.write` or `FileSaver.saveFile` (file name
  `checkrspot-yyyy-mm-dd-hhmm.json|csv`), and a brief toast (none if the save
  dialog is cancelled). Readings oldest first.
  JSON: array of objects, keys `id` (the code), `timestamp` (ISO 8601 to the
  minute, in the reading's zone with its offset, or `Z`), `date`, `time`, `latitude`, `longitude` (5 dp), `accuracy`,
  `altitude` (whole m), `region`, `locality`, `locality2`, `taxon`,
  `collector` (verbatim), `revGeocode` (the whole `place_details`); null
  fields omitted. CSV (RFC 4180, CRLF): `id,date,time,latitude,longitude,
  accuracy_m,altitude_m,region,locality,locality2,taxon,collector`.
- Errors are shown with `alert()`.

## App identity and App Store plan

- App id is `org.vorthmann.checkrspot` (`capacitor.config.ts`, Android
  `applicationId`/`namespace`; `MainActivity` lives in that Java package).
  The iOS Release bundle id is **`org.vorthmann.CheckrSpot`**, capitalised to
  match the old app's App Store record exactly; don't lowercase it.
- iOS Debug builds (Run from Xcode) use bundle id
  `org.vorthmann.checkrspot.dev` and home-screen name "CheckrDev", so they
  install alongside the old App Store app on the user's phone. Release builds
  (Archive) use the real id and "CheckrSpot". Both come from per-configuration
  target build settings (`PRODUCT_BUNDLE_IDENTIFIER`, `APP_DISPLAY_NAME`);
  Info.plist's `CFBundleDisplayName` is `$(APP_DISPLAY_NAME)`. The Xcode
  target/scheme is still named CheckrSpot2.
- That bundle id belongs to the user's older iPhone-only app **CheckrSpot**
  (`../checkrspot`; last shipped 1.0.x, iOS 16+), which this app will replace
  in the App Store as an update to the same app record. So: keep the bundle
  id and team (`85ZT5UZ396`); `MARKETING_VERSION` must stay above the old
  app's latest App Store version (currently set to 2.0); iPhone only
  (`TARGETED_DEVICE_FAMILY = 1`, by the user's choice; adding iPad would need
  iPad screenshots and review). The iOS deployment target is 16.0, the old
  app's minimum, so no existing user is left behind (raised from 15.0 for
  MapLibre); don't raise it further without considering existing users. The old project also built a Mac app,
  but it was never published, so it doesn't matter here. Updating users
  keep the old app's sandbox data; the old app stored none, so no import is
  needed.

## Icons and splash

The butterfly icon comes from the old app
(`../checkrspot/CheckrSpot/CheckrSpot/Assets.xcassets/AppIcon.appiconset/icon-1024.png`).
iOS uses it directly. The Android launcher icons and Android splash images
(`drawable*/splash.png`) were generated from it with throwaway CoreGraphics
scripts: the butterfly centred on its own flat grey,
**`#C1C1C1`** (raw pixel value; colour-converted sampling misreports it as
`#CCCCCC`). Android's `ic_launcher_background` and Android 12+
`windowSplashScreenBackground` use that grey.

iOS launch screen (`LaunchScreen.storyboard`): grey `#C1C1C1` view with the
`Splash` image (the icon at 240/480/720 px) centred at 240 pt. Don't go back
to Capacitor's full-screen 2732 px splash image: the user saw only a black
launch screen with it, likely because iOS couldn't render an image that large.
`@capacitor/splash-screen` re-shows that storyboard and, with
`launchAutoHide: false`, keeps it up until `SplashScreen.hide()` at the end of
startup in `src/main.ts`; this covers the blank white web view.

## Known quirks

- The scanner plugin bundles `html5-qrcode` for web, so the JS bundle is about
  400 KB. Harmless for native; it lets scanning work with a webcam in
  `npm run dev`.
- The web store is in-memory only; readings vanish on reload.
