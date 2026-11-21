import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';

const String _themeCacheKey = 'bc_theme_settings';

class ThemeProvider extends ChangeNotifier {
  Color _primary = AppColors.primary;
  Color _accent = AppColors.accent;
  Color _accentDark = AppColors.accentDark;
  Color _bg = AppColors.bg;
  Color _blush = AppColors.blush;

  Color get primary => _primary;
  Color get accent => _accent;
  Color get accentDark => _accentDark;
  Color get bg => _bg;
  Color get blush => _blush;

  ThemeData get themeData => AppTheme.light(
        primary: _primary,
        accent: _accent,
        accentDark: _accentDark,
        bg: _bg,
        blush: _blush,
      );

  Future<void> init() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final cached = prefs.getString(_themeCacheKey);
      if (cached != null && cached.isNotEmpty) {
        final decoded = jsonDecode(cached);
        if (decoded is Map<String, dynamic>) {
          _apply(decoded, persist: false);
        }
      }
    } catch (_) {}
    await refresh();
  }

  Future<void> refresh() async {
    try {
      final settings = await ApiService.instance.getSettings();
      applyFromSettings(settings);
    } catch (_) {
      // Keep cached or default palette on offline launch
    }
  }

  void applyFromSettings(Map<String, dynamic> settings) {
    _apply(settings, persist: true);
  }

  void _apply(Map<String, dynamic> settings, {required bool persist}) {
    final nextPrimary =
        parseHexColor(settings['theme_color_primary']?.toString(), AppColors.primary);
    final nextAccent =
        parseHexColor(settings['theme_color_accent']?.toString(), AppColors.accent);
    final nextAccentDark =
        parseHexColor(settings['theme_color_accent_dark']?.toString(), AppColors.accentDark);
    final nextBg =
        parseHexColor(settings['theme_color_bg']?.toString(), AppColors.bg);
    final nextBlush =
        parseHexColor(settings['theme_color_blush']?.toString(), AppColors.blush);

    final changed = nextPrimary != _primary ||
        nextAccent != _accent ||
        nextAccentDark != _accentDark ||
        nextBg != _bg ||
        nextBlush != _blush;

    if (changed) {
      _primary = nextPrimary;
      _accent = nextAccent;
      _accentDark = nextAccentDark;
      _bg = nextBg;
      _blush = nextBlush;
      notifyListeners();
    }

    if (persist) {
      _saveCache({
        if (settings['theme_color_primary'] != null)
          'theme_color_primary': settings['theme_color_primary'].toString(),
        if (settings['theme_color_accent'] != null)
          'theme_color_accent': settings['theme_color_accent'].toString(),
        if (settings['theme_color_accent_dark'] != null)
          'theme_color_accent_dark': settings['theme_color_accent_dark'].toString(),
        if (settings['theme_color_bg'] != null)
          'theme_color_bg': settings['theme_color_bg'].toString(),
        if (settings['theme_color_blush'] != null)
          'theme_color_blush': settings['theme_color_blush'].toString(),
      });
    }
  }

  Future<void> _saveCache(Map<String, String> payload) async {
    if (payload.isEmpty) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_themeCacheKey, jsonEncode(payload));
    } catch (_) {}
  }
}
