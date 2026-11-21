import 'package:flutter/material.dart';

/// Design tokens mirrored from frontend/src/index.css (BodyCream GH luxury system).
class AppColors {
  AppColors._();

  // Brand
  static const Color primary     = Color(0xFF1C1410); // Warm near-black espresso
  static const Color accent      = Color(0xFFC9A55A); // Rich luxury gold
  static const Color accentDark  = Color(0xFFA8863D); // Deeper gold on light bg
  static const Color accentLight = Color(0xFFF0E2C4); // Pale gold highlight

  // Backgrounds
  static const Color bg      = Color(0xFFFAF7F4); // Warm ivory
  static const Color surface = Color(0xFFFFFFFF); // Crisp white cards
  static const Color blush   = Color(0xFFFDF4F0); // Warm rose-tinted tint
  static const Color dark    = Color(0xFF141010); // Announcement bar / hero dark

  // Text & Borders
  static const Color text   = Color(0xFF1C1410);
  static const Color muted  = Color(0xFF7A6E68); // Warm taupe
  static const Color border = Color(0xFFEDE5DB); // Warm beige 1px divider

  // Feedback
  static const Color error   = Color(0xFFC0392B);
  static const Color success = Color(0xFF27AE60);
}

/// Safely parses a CSS hex color string (e.g. `#c9a55a`, `#fff`, `1c1410`).
Color parseHexColor(String? raw, Color fallback) {
  if (raw == null) return fallback;
  var cleaned = raw.trim().replaceFirst('#', '');
  if (cleaned.length == 3) {
    cleaned = cleaned.split('').map((c) => '$c$c').join();
  }
  if (cleaned.length == 6) {
    final val = int.tryParse('FF$cleaned', radix: 16);
    if (val != null) return Color(val);
  } else if (cleaned.length == 8) {
    final val = int.tryParse(cleaned, radix: 16);
    if (val != null) return Color(val);
  }
  return fallback;
}

class AppTheme {
  AppTheme._();

  static ThemeData light({
    Color? primary,
    Color? accent,
    Color? accentDark,
    Color? bg,
    Color? blush,
  }) {
    final p = primary ?? AppColors.primary;
    final a = accent ?? AppColors.accent;
    final ad = accentDark ?? AppColors.accentDark;
    final background = bg ?? AppColors.bg;
    final blushTint = blush ?? AppColors.blush;
    final accentLight = Color.lerp(a, Colors.white, 0.72) ?? AppColors.accentLight;

    final colorScheme = ColorScheme(
      brightness: Brightness.light,
      primary: p,
      onPrimary: Colors.white,
      primaryContainer: accentLight,
      onPrimaryContainer: p,
      secondary: a,
      onSecondary: p,
      secondaryContainer: blushTint,
      onSecondaryContainer: p,
      error: AppColors.error,
      onError: Colors.white,
      surface: AppColors.surface,
      onSurface: AppColors.text,
      surfaceContainerHighest: background,
      onSurfaceVariant: AppColors.muted,
      outline: AppColors.border,
      outlineVariant: AppColors.border,
    );

    final base = ThemeData(
      useMaterial3: true,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: background,
    );

    return base.copyWith(
      textTheme: base.textTheme.copyWith(
        headlineLarge: const TextStyle(
          fontFamily: 'serif',
          fontSize: 30,
          fontWeight: FontWeight.w600,
          color: AppColors.text,
          height: 1.18,
          letterSpacing: 0.2,
        ),
        headlineMedium: const TextStyle(
          fontFamily: 'serif',
          fontSize: 26,
          fontWeight: FontWeight.w600,
          color: AppColors.text,
          height: 1.2,
          letterSpacing: 0.2,
        ),
        headlineSmall: const TextStyle(
          fontFamily: 'serif',
          fontSize: 22,
          fontWeight: FontWeight.w600,
          color: AppColors.text,
          height: 1.22,
        ),
        titleLarge: const TextStyle(
          fontFamily: 'serif',
          fontSize: 20,
          fontWeight: FontWeight.w600,
          color: AppColors.text,
          letterSpacing: 0.2,
        ),
        titleMedium: const TextStyle(
          fontSize: 15,
          fontWeight: FontWeight.w600,
          color: AppColors.text,
        ),
        titleSmall: const TextStyle(
          fontSize: 13.5,
          fontWeight: FontWeight.w600,
          color: AppColors.text,
          height: 1.3,
        ),
        bodyMedium: const TextStyle(
          fontSize: 14,
          color: AppColors.text,
          height: 1.5,
        ),
        bodySmall: const TextStyle(
          fontSize: 12.5,
          color: AppColors.muted,
          height: 1.4,
        ),
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.text,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: TextStyle(
          fontFamily: 'serif',
          fontSize: 20,
          fontWeight: FontWeight.w600,
          color: AppColors.text,
          letterSpacing: 0.6,
        ),
        shape: Border(
          bottom: BorderSide(color: AppColors.border, width: 1),
        ),
      ),
      cardTheme: CardThemeData(
        color: AppColors.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
          side: const BorderSide(color: AppColors.border, width: 1),
        ),
      ),
      dividerTheme: const DividerThemeData(
        color: AppColors.border,
        thickness: 1,
        space: 1,
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: p,
          foregroundColor: Colors.white,
          minimumSize: const Size(0, 48),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 13),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(6),
          ),
          textStyle: const TextStyle(
            fontSize: 13.5,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.8,
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: p,
          minimumSize: const Size(0, 48),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 13),
          side: BorderSide(color: p, width: 1.2),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(6),
          ),
          textStyle: const TextStyle(
            fontSize: 13.5,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.6,
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: ad,
          textStyle: const TextStyle(
            fontSize: 13.5,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.3,
          ),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.surface,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        hintStyle: const TextStyle(color: AppColors.muted, fontSize: 14),
        labelStyle: const TextStyle(color: AppColors.muted, fontSize: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(6),
          borderSide: const BorderSide(color: AppColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(6),
          borderSide: const BorderSide(color: AppColors.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(6),
          borderSide: BorderSide(color: a, width: 1.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(6),
          borderSide: const BorderSide(color: AppColors.error),
        ),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: AppColors.surface,
        selectedColor: p,
        showCheckmark: false,
        side: const BorderSide(color: AppColors.border),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(6),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: AppColors.surface,
        surfaceTintColor: Colors.transparent,
        indicatorColor: accentLight,
        height: 68,
        labelTextStyle: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return TextStyle(
            fontSize: 11.5,
            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
            color: selected ? p : AppColors.muted,
          );
        }),
        iconTheme: WidgetStateProperty.resolveWith((states) {
          final selected = states.contains(WidgetState.selected);
          return IconThemeData(
            color: selected ? p : AppColors.muted,
            size: 22,
          );
        }),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: p,
        contentTextStyle: const TextStyle(color: Colors.white, fontSize: 13.5),
        behavior: SnackBarBehavior.floating,
        insetPadding: const EdgeInsets.fromLTRB(14, 14, 14, 76),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: a,
      ),
    );
  }
}
