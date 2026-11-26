# CheckrSpot

A Capacitor app (Vanilla TS + Vite) for recording spots in the field. At each
spot you scan the short QR code ID tag placed there; the app saves that ID
with the current GPS fix and an optional two-line locality, taxon and collector, in a local SQLite
database.

## Stack

- **Frontend:** Vanilla TypeScript + Vite
- **Native bridge:** Capacitor 8 (iOS + Android)
- **Geolocation:** [`@capacitor/geolocation`](https://capacitorjs.com/docs/apis/geolocation)
  (native GPS on device, browser Geolocation API on web)
- **QR scanning:** [`@capacitor/barcode-scanner`](https://capacitorjs.com/docs/apis/barcode-scanner)
  (native live scanner on device, webcam via `html5-qrcode` on web)
- **Persistence:** [`@capacitor-community/sqlite`](https://github.com/capacitor-community/sqlite)
  (native SQLite on iOS/Android; in-memory stub on web — see [Persistence](#persistence))
- **Printing:** a small plugin inside the app (`PrinterPlugin` in `ios/App/App/`
  and the Android `org.vorthmann.checkrspot` package) that opens the system
  print dialog for the web view; `window.print()` on web
- **Clipboard:** [`@capacitor/clipboard`](https://capacitorjs.com/docs/apis/clipboard)
- **Keyboard:** [`@capacitor/keyboard`](https://capacitorjs.com/docs/apis/keyboard)
  stops iOS scrolling the whole page when a field is focused, and reports the
  keyboard's height so the editor can fit above it, keeping its header bar in
  place
- **Photo import:** a third in-app plugin (`PhotoImportPlugin`): the system
  photo picker, EXIF via ImageIO and QR detection via Vision on iOS; the
  document picker, `androidx.exifinterface` and ML Kit barcode scanning on
  Android. Not available on web
- **Saving files:** another small in-app plugin (`FileSaverPlugin`) that opens
  the system save dialog (iOS document picker, Android "save as"); no
  permissions needed. A browser download on web
- **Dates and times:** [Temporal](https://tc39.es/proposal-temporal/docs/)
  for time-zone arithmetic, with [`temporal-polyfill`](https://github.com/fullcalendar/temporal-polyfill)
  loaded only when the web view lacks it;
  [`@photostructure/tz-lookup`](https://github.com/photostructure/tz-lookup)
  for the time zone at a reading's coordinates (offline);
  [Cally](https://wicky.nillia.ms/cally/) for the calendar in the editor
- **Maps:** [MapLibre GL JS](https://maplibre.org/) with
  [OpenFreeMap](https://openfreemap.org/) tiles (OpenStreetMap data, no key)
  for the location chooser
- **Taxa:** the [iNaturalist API](https://api.inaturalist.org/v1/docs/) for the
  taxon chooser, and [`@capacitor/network`](https://capacitorjs.com/docs/apis/network)
  to disable it when offline
- **Reverse geocoding:** OpenStreetMap's [Nominatim](https://nominatim.org/),
  called with `CapacitorHttp` (part of `@capacitor/core`) — see
  [Region lookup](#region-lookup)
- **Elevation:** [Open-Meteo's elevation API](https://open-meteo.com/en/docs/elevation-api)
  (no key), for the altitude of a pin placed in the location chooser

## Using the app

- The capture button at the bottom turns **green** when the location
  accuracy is good (40 m or better) and **amber** when it is poor or there is
  no fix. You can still record with a poor fix.
- Tap it to open the QR scanner. Once a code is read, enter an optional
  **Locality** (two lines), **Taxon** and **Collector** (keyboard dictation works), then **Save**, or
  **Discard** to drop the reading. The location saved is the one from when you
  tapped the button. Both locality lines and Collector start out filled in
  with the values from the last reading you saved.
- **Import** (top left) creates readings from photos you choose from your
  library. Each photo must have a location and capture date in its metadata;
  the reading gets the photo's time, position, altitude and (when recorded)
  GPS accuracy, and the ID from the QR code in the photo (left empty if there
  is none; photos with more than one are skipped). Import one photo and the
  usual Locality / Taxon / Collector dialog appears; import several and they
  get the last used collector, with no locality or taxon. Photos that can't be used, or whose reading is already in
  the list, are skipped and listed afterwards.
- The list shows each reading's ID and taxon, newest first. Tap one to open
  the **editor**, which slides in from the right. Every field can be edited as
  text: ID, taxon, date and time, latitude, longitude, region, accuracy,
  altitude, both locality lines and collector. **Copy** in the Location
  group puts the coordinates on the clipboard as `lat, lng`, ready to paste
  into Google Maps. **Save** (enabled once something
  has changed) or **Cancel**; swiping in from the left edge (or Android's back
  gesture) also closes it, asking first if there are unsaved changes.
- In the editor, **Choose** next to *Date and time* collapses the other fields
  and slides up a calendar and hour/minute wheels. The date and time fields
  follow them; **Done** keeps the choice, **Cancel** puts the fields back.
- **Choose** next to *Location* opens a map with a pin for the reading, dots
  for all the other readings and a blue dot for where you are. Pan with one
  finger; pan, zoom and rotate with two. Tap to move the pin there (the map
  centres on it, and the region and altitude are looked up again). The circle around the
  pin is always half the map's width, so the zoom sets the accuracy: the
  circle's radius on the ground, shown in the Accuracy field. A reading
  without coordinates gets no pin until you tap; the map starts at its
  region, or else at where you are. Greyed out without a network connection.
- **Choose** next to *Taxon* shows the taxa observed on iNaturalist near the
  reading at that time of year (any year), most observed first: a grid of
  photos with the scientific name and the number of observations. Tap one
  to put its scientific name in the Taxon field. The gear sets the base
  taxon (search by name), the radius and how many weeks either side of the
  reading's date (type them, or use the − / + buttons); the defaults are
  butterflies, 25 km and ±3 weeks, and
  your choices are remembered. Choose is greyed out without a network
  connection.
- Times are always shown and edited as **local time where the reading was
  taken** (the zone, e.g. MST, is shown in the editor), wherever the phone is
  now. The zone comes from the coordinates, so moving a reading in the editor
  keeps its clock time. If the zone can't be determined, times are UTC and
  marked with a **Z**. Seconds are stored but never shown or exported.
- A region you type in the editor is kept and never replaced by a lookup.
  Clear it to have it looked up again. Changing the coordinates drops a
  looked-up region, which is looked up again when next needed.
- **Select** lets you pick readings and delete them, or tap **Labels** to
  preview specimen labels for them (oldest first, shown at twice actual size)
  and **Print** them. Each label has a locality block (region, both locality lines, coordinates
  ± accuracy, date and time, elevation, collector), the taxon if there is one, and the ID in large type.
  If any of the readings still need their region looked up, the sheet shows
  "Reverse geocoding…" first; if a lookup fails you can **Retry**, **Cancel**,
  or **Continue anyway** without the missing regions.
- The copy button next to **Labels** copies the selected readings (oldest
  first) to the clipboard as **JSON** or **CSV**; the format you chose last is
  preselected. Missing regions are looked up first, as for labels. JSON
  includes the full reverse-geocoding response (`revGeocode`, which carries
  the OpenStreetMap licence notice) and leaves out empty fields; CSV has a
  header row and fixed columns.
- The download button next to it saves the same JSON or CSV to a file
  (e.g. `checkrspot-2026-10-25-1432.csv`) wherever you choose in the system
  save dialog. It remembers its own last format, separately from copy.

## Region lookup

Each reading gets a short **region** such as `US-AZ, Pima Co.` (the ISO region
code, then the county or nearest equivalent) from Nominatim. The app is often
used without a network, so nothing is looked up when a reading is captured.
A lookup happens only when you open a reading in the editor (for that reading), move its pin in the location chooser (for the new spot)
or tap **Labels**, copy or download (for the selected readings that don't have one yet). Results
are saved, so each reading is looked up once.

Nominatim's [usage policy](https://operations.osmfoundation.org/policies/nominatim/)
allows at most one request per second across all users of the app, so
requests are queued about 1.5 s apart and nearby readings share a cached
answer. The full response is stored for a future export; its data is
© OpenStreetMap contributors (ODbL). The design is in
[`dev-docs/reverse-geocoding.md`](dev-docs/reverse-geocoding.md).

## Prerequisites

- Node 22+, npm 10+
- **iOS:** Xcode (dependencies are resolved via Swift Package Manager — no CocoaPods needed)
- **Android:** Android Studio + SDK, with `ANDROID_HOME` set; minimum Android 8.0 (API 26)

## Develop (web)

```bash
npm install
npm run dev        # Vite dev server; uses the browser's location and webcam
```

## Build & sync to native

```bash
npm run build      # type-checks, then produces dist/ (Capacitor's webDir)
npx cap copy ios   # copy web assets into the iOS project (after code changes)
npx cap sync       # copy assets and update native plugins (after adding/removing a plugin)
```

## Run on device / simulator

```bash
npx cap run ios        # or: npx cap open ios     (opens Xcode; app scheme is CheckrSpot2)
npx cap run android    # or: npx cap open android (opens Android Studio)
```

Scanning needs a real device; the iOS simulator has no camera.

iOS builds run from Xcode (Debug) install as **CheckrDev**
(`org.vorthmann.checkrspot.dev`), so they can sit alongside the App Store
version of CheckrSpot. Archived (Release) builds use the real bundle id
`org.vorthmann.CheckrSpot` (capitalised, as the old app's) and replace the older CheckrSpot app in the App Store.

## Building and deploying

`tools.sh` builds the web app, copies it into the native project and then:

```sh
./tools.sh iphone <udid>   # Debug build (CheckrDev), installed and launched on a USB iPhone
./tools.sh ios             # Release archive, uploaded to App Store Connect (TestFlight)
./tools.sh android <path>  # debug APK copied to <path> (a file, or a directory → checkrspot-YYYYMMDD.apk)
```

Nothing in it is specific to this app (it came from the `fence-jobs`
project): paths and the app name come from `npx cap config --json`, the Xcode
scheme from the project's target (CheckrSpot2), and the bundle ID from the
built app. `./tools.sh iphone` without a UDID lists the connected devices. The
iOS commands sign with the Xcode account's team; `ios` sets the build number
to a timestamp (`YYYYMMDD.HHMM`) so each upload is higher, without editing the
project. The upload goes to the existing CheckrSpot app record.

## Permissions

- **iOS** — `NSLocationWhenInUseUsageDescription` and `NSCameraUsageDescription`
  in `ios/App/App/Info.plist`. Photo import needs no permission: the system
  picker hands over only the photos chosen, with their metadata.
- **Android** — `ACCESS_COARSE_LOCATION` / `ACCESS_FINE_LOCATION` in
  `android/app/src/main/AndroidManifest.xml`; the camera permission is expected
  to come from the scanner plugin's library (not yet verified on a device).
  `ACCESS_MEDIA_LOCATION` for photo import: without it Android removes the
  location from picked photos. Android's newer photo picker always removes
  it, so import uses the document picker instead.

Location permission is requested when the app first starts; camera permission
the first time you scan; on Android, media location the first time you import.

## Persistence

Each reading is saved to a `readings` table: latitude, longitude, accuracy
(empty for imported photos that don't record it), altitude, recorded-at timestamp, `code` (the scanned ID, at most 25
characters), `locality`, `locality2`, `taxon`, `collector`, and from the
region lookup `region`, `place_source` (e.g. `nominatim`, or `manual` for a
region typed in the editor; empty until looked up) and `place_details` (the service's full response as JSON). See `src/db.ts` for the schema and
`ReadingsStore` interface.

- **Native (iOS/Android):** backed by real SQLite via
  `@capacitor-community/sqlite`. The schema lives in the `UPGRADE_STATEMENTS`
  array. **Until the first release** the version-1 entry is edited in place, so
  after a schema change delete the app from the device and reinstall it. After
  release, add a new `{ toVersion, statements }` entry and bump `DB_VERSION`
  instead; never edit an existing entry.
- **Web (`npm run dev` / `vite preview`):** an in-memory stub is used
  instead, so `npm run dev` works without a jeep-sqlite/wasm setup. Readings
  do **not** persist across page reloads in this mode.

A failed save is reported in an alert rather than crashing the app.

## Project layout

- `src/main.ts` — UI, location watching, scanning and the capture flow
- `src/editor.ts` — the reading editor and its date and time chooser
- `src/locationChooser.ts` — the location chooser's map
- `src/taxonChooser.ts` — the taxon chooser and its settings
- `src/inaturalist.ts` — the iNaturalist API client
- `src/elevation.ts` — ground elevation from Open-Meteo
- `src/motion.ts` — animation timing shared by the editor and choosers
- `src/time.ts` — time zones and conversions (Temporal, tz-lookup)
- `src/polyfills.ts` — small polyfills for the oldest supported web views
- `src/db.ts` — `ReadingsStore` (SQLite on native, in-memory stub on web) and schema
- `src/export.ts` — JSON and CSV formatting for copying and downloading readings
- `src/fileSaver.ts` — JS side of the app's own `FileSaver` plugin
- `src/photoImport.ts` — JS side of the app's own `PhotoImport` plugin, and turning a photo's metadata into a reading
- `src/printer.ts` — JS side of the app's own `Printer` plugin
- `src/geocoder.ts` — the `ReverseGeocoder` interface the app uses for region lookups
- `src/nominatim.ts` — its Nominatim implementation (request queue, cache, region format)
- `src/style.css` — styles (light/dark aware), including the label and print styles
- `capacitor.config.ts` — Capacitor config (appId, webDir)
- `ios/`, `android/` — native platform projects
- `dev-docs/` — design notes
- `CLAUDE.md` — notes for Claude Code sessions
