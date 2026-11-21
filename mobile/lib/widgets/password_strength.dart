import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

class PasswordRule {
  final String key;
  final String label;
  final bool Function(String) test;
  const PasswordRule(this.key, this.label, this.test);
}

final List<PasswordRule> passwordRules = [
  PasswordRule('length', 'At least 8 characters', (pw) => pw.length >= 8),
  PasswordRule(
      'uppercase', 'One uppercase letter', (pw) => RegExp(r'[A-Z]').hasMatch(pw)),
  PasswordRule('number', 'One number', (pw) => RegExp(r'[0-9]').hasMatch(pw)),
  PasswordRule('special', 'One special character',
      (pw) => RegExp(r'[^A-Za-z0-9]').hasMatch(pw)),
];

class PasswordStrengthResult {
  final int score;
  final List<MapEntry<PasswordRule, bool>> checks;
  const PasswordStrengthResult(this.score, this.checks);
}

PasswordStrengthResult getPasswordStrength(String password) {
  final checks = passwordRules.map((r) => MapEntry(r, r.test(password))).toList();
  final score = checks.where((c) => c.value).length;
  return PasswordStrengthResult(score, checks);
}

class PasswordStrengthMeter extends StatelessWidget {
  final String password;
  const PasswordStrengthMeter({super.key, required this.password});

  static const _labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
  static const _colors = [
    AppColors.border,
    Color(0xFFC0392B),
    Color(0xFFD4880F),
    Color(0xFF7A9E3B),
    Color(0xFF2D6A4F),
  ];

  @override
  Widget build(BuildContext context) {
    if (password.isEmpty) return const SizedBox.shrink();
    final result = getPasswordStrength(password);
    final score = result.score.clamp(0, 4);
    final activeColor = _colors[score];

    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Row(
                  children: List.generate(4, (i) {
                    final filled = i < score;
                    return Expanded(
                      child: Container(
                        height: 4,
                        margin: EdgeInsets.only(right: i < 3 ? 5 : 0),
                        decoration: BoxDecoration(
                          color: filled ? activeColor : AppColors.border,
                          borderRadius: BorderRadius.circular(2),
                        ),
                      ),
                    );
                  }),
                ),
              ),
              if (score > 0) ...[
                const SizedBox(width: 10),
                Text(
                  _labels[score],
                  style: TextStyle(
                    fontSize: 11.5,
                    fontWeight: FontWeight.w700,
                    color: activeColor,
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 12,
            runSpacing: 4,
            children: result.checks.map((entry) {
              final met = entry.value;
              return Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    met ? '✓' : '·',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                      color: met ? const Color(0xFF2D6A4F) : AppColors.muted,
                    ),
                  ),
                  const SizedBox(width: 4),
                  Text(
                    entry.key.label,
                    style: TextStyle(
                      fontSize: 11.5,
                      color: met ? const Color(0xFF2D6A4F) : AppColors.muted,
                      fontWeight: met ? FontWeight.w600 : FontWeight.w400,
                    ),
                  ),
                ],
              );
            }).toList(),
          ),
        ],
      ),
    );
  }
}
