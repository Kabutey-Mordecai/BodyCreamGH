// Central configuration — change baseUrl to point at your deployed API.
// In development, use your machine's LAN IP so the emulator/device can reach it:
//   Android emulator: http://10.0.2.2:3000/api
//   Physical device:  http://192.168.x.x:3000/api
// In production:      https://api.yourdomain.com/api
class AppConfig {
  static const String baseUrl = String.fromEnvironment(
    'API_URL',
    defaultValue: 'http://10.0.2.2:3000/api',
  );

  static const String appName = 'Cosmetics GH';
  static const String currency = 'GHS';
  static const String currencySymbol = '₵';
}
