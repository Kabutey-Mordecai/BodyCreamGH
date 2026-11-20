# BodyCream GH Mobile App (Flutter)

## Configuration (`--dart-define`)

The mobile app reads two compile-time flags in [`lib/config.dart`](lib/config.dart):

| Flag | Default (dev only) | Description |
| --- | --- | --- |
| `API_URL` | `http://10.0.2.2:3000/api` | Backend API base URL (including `/api`). |
| `STOREFRONT_URL` | `http://localhost:5173` | Public storefront origin. **Must match the backend's `FRONTEND_URL`**, which sets Paystack's `callback_url`. |

> **Release builds:** `AppConfig.validateConfig()` runs at startup in `main.dart` and throws a `StateError` in release mode if `STOREFRONT_URL` is unset or points to `localhost`/`127.0.0.1`, preventing silent Paystack callback detection failures.

## Release Build Commands

Run from the `mobile/` directory, replacing the URLs with your production endpoints:

### Android APK
```bash
flutter build apk --release \
  --dart-define=API_URL=https://api.yourdomain.com/api \
  --dart-define=STOREFRONT_URL=https://yourdomain.com
```

### Android App Bundle (Google Play)
```bash
flutter build appbundle --release \
  --dart-define=API_URL=https://api.yourdomain.com/api \
  --dart-define=STOREFRONT_URL=https://yourdomain.com
```

## Local Development

```bash
flutter run \
  --dart-define=API_URL=http://10.0.2.2:3000/api \
  --dart-define=STOREFRONT_URL=http://localhost:5173
```

## Tests

```bash
flutter test
```
