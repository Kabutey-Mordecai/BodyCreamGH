import 'dart:async';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../widgets/password_strength.dart';

class LoginScreen extends StatefulWidget {
  final bool isCheckoutRedirect;
  const LoginScreen({super.key, this.isCheckoutRedirect = false});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailCtrl = TextEditingController();
  final _passCtrl = TextEditingController();
  bool _obscure = true;
  bool _loading = false;
  String? _errorMsg;
  int _lockoutSecs = 0;
  Timer? _lockoutTimer;

  @override
  void dispose() {
    _lockoutTimer?.cancel();
    _emailCtrl.dispose();
    _passCtrl.dispose();
    super.dispose();
  }

  void _startLockout(int seconds) {
    _lockoutTimer?.cancel();
    setState(() => _lockoutSecs = seconds);
    _lockoutTimer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) {
        t.cancel();
        return;
      }
      if (_lockoutSecs <= 1) {
        t.cancel();
        setState(() {
          _lockoutSecs = 0;
          _errorMsg = null;
        });
      } else {
        setState(() => _lockoutSecs--);
      }
    });
  }

  String _formatCountdown(int secs) {
    final m = (secs ~/ 60).toString().padLeft(2, '0');
    final s = (secs % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  void _goBack() {
    if (context.canPop()) {
      context.pop();
    } else {
      context.go('/');
    }
  }

  Future<void> _submit() async {
    if (_lockoutSecs > 0) return;
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _loading = true;
      _errorMsg = null;
    });
    final auth = context.read<AuthProvider>();
    final ok = await auth.login(
      _emailCtrl.text.trim(),
      _passCtrl.text,
    );
    if (!mounted) return;
    setState(() => _loading = false);
    if (ok) {
      if (widget.isCheckoutRedirect) {
        context.go('/checkout');
      } else {
        _goBack();
      }
    } else {
      if (auth.lastStatusCode == 429) {
        final wait = auth.lastRetryAfter ?? 60;
        _startLockout(wait);
      } else {
        setState(() => _errorMsg = auth.error ?? 'Login failed. Please try again.');
      }
    }
  }

  Future<void> _openForgotPasswordDialog() async {
    final resetEmailCtrl = TextEditingController(text: _emailCtrl.text.trim());
    final action = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Reset Password'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Enter your account email and we will send you a password reset link.',
              style: TextStyle(fontSize: 13.5, color: AppColors.muted),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: resetEmailCtrl,
              keyboardType: TextInputType.emailAddress,
              decoration: const InputDecoration(
                labelText: 'Email Address',
                prefixIcon: Icon(Icons.email_outlined),
              ),
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: () => Navigator.pop(ctx, 'have_token'),
              child: const Text('Already have a reset token?'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, 'cancel'),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, 'send'),
            child: const Text('Send Reset Link'),
          ),
        ],
      ),
    );
    if (action == 'have_token') {
      _openTokenResetDialog();
      return;
    }
    if (action != 'send' || resetEmailCtrl.text.trim().isEmpty) return;
    try {
      await ApiService.instance.forgotPassword(resetEmailCtrl.text.trim());
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
              'Reset token sent! Check your email and paste the token below.'),
        ),
      );
      await _openTokenResetDialog();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            e.toString().replaceFirst(RegExp(r'ApiException\(\d+\): '), ''),
          ),
        ),
      );
    }
  }

  Future<void> _openTokenResetDialog() async {
    final tokenCtrl = TextEditingController();
    final newPassCtrl = TextEditingController();
    final confirmCtrl = TextEditingController();
    String? dialogErr;
    bool saving = false;

    await showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Set New Password'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextField(
                  controller: tokenCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Reset Token (from email)',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: newPassCtrl,
                  obscureText: true,
                  decoration: const InputDecoration(
                    labelText: 'New Password',
                  ),
                  onChanged: (_) => setDialogState(() {}),
                ),
                PasswordStrengthMeter(password: newPassCtrl.text),
                const SizedBox(height: 12),
                TextField(
                  controller: confirmCtrl,
                  obscureText: true,
                  decoration: const InputDecoration(
                    labelText: 'Confirm New Password',
                  ),
                ),
                if (dialogErr != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    dialogErr!,
                    style: const TextStyle(
                        color: AppColors.error, fontSize: 12.5),
                  ),
                ],
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: saving ? null : () => Navigator.pop(ctx),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: saving
                  ? null
                  : () async {
                      final tok = tokenCtrl.text.trim();
                      final pw = newPassCtrl.text;
                      if (tok.isEmpty) {
                        setDialogState(
                            () => dialogErr = 'Please enter your reset token.');
                        return;
                      }
                      if (pw != confirmCtrl.text) {
                        setDialogState(
                            () => dialogErr = 'Passwords do not match.');
                        return;
                      }
                      if (getPasswordStrength(pw).score < 4) {
                        setDialogState(() => dialogErr =
                            'Please meet all 4 password requirements.');
                        return;
                      }
                      setDialogState(() {
                        saving = true;
                        dialogErr = null;
                      });
                      try {
                        await ApiService.instance.verifyResetToken(tok);
                        await ApiService.instance.resetPassword(
                          token: tok,
                          newPassword: pw,
                        );
                        if (!ctx.mounted) return;
                        Navigator.pop(ctx);
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text(
                                  'Password updated! You can now sign in.'),
                            ),
                          );
                        }
                      } catch (e) {
                        if (!ctx.mounted) return;
                        setDialogState(() {
                          saving = false;
                          dialogErr = e
                              .toString()
                              .replaceFirst(RegExp(r'ApiException\(\d+\): '), '');
                        });
                      }
                    },
              child: Text(saving ? 'Updating…' : 'Update Password'),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final isLocked = _lockoutSecs > 0;

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _goBack();
      },
      child: Scaffold(
        appBar: AppBar(
          leading: IconButton(
            icon: const Icon(Icons.arrow_back),
            tooltip: 'Back',
            onPressed: _goBack,
          ),
          title: const Text('Log In'),
        ),
        body: SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Form(
              key: _formKey,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (widget.isCheckoutRedirect) ...[
                    Container(
                      margin: const EdgeInsets.only(bottom: 16),
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: AppColors.accent.withValues(alpha: 0.14),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                            color: AppColors.accent.withValues(alpha: 0.45)),
                      ),
                      child: const Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Sign in to complete your order',
                            style: TextStyle(
                              fontWeight: FontWeight.w700,
                              fontSize: 13.5,
                              color: AppColors.primary,
                            ),
                          ),
                          SizedBox(height: 4),
                          Text(
                            'Your shopping bag is safely saved and will be ready for checkout as soon as you sign in.',
                            style: TextStyle(
                              fontSize: 12.5,
                              color: AppColors.muted,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                  const SizedBox(height: 8),
                  const Text(
                    'BODYCREAM GH',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      letterSpacing: 2.2,
                      color: AppColors.accentDark,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    widget.isCheckoutRedirect
                        ? 'Sign in to Checkout'
                        : 'Welcome back',
                    style: Theme.of(context).textTheme.headlineMedium,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 22),

                  if (isLocked || _errorMsg != null) ...[
                    Container(
                      margin: const EdgeInsets.only(bottom: 16),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: isLocked
                            ? const Color(0xFFFEF3C7)
                            : AppColors.error.withValues(alpha: 0.08),
                        borderRadius: BorderRadius.circular(6),
                        border: Border.all(
                          color: isLocked
                              ? const Color(0xFFD97706)
                              : AppColors.error.withValues(alpha: 0.3),
                        ),
                      ),
                      child: Text(
                        isLocked
                            ? 'Too many login attempts. Try again in ${_formatCountdown(_lockoutSecs)}.'
                            : _errorMsg!,
                        style: TextStyle(
                          fontSize: 13,
                          color: isLocked
                              ? const Color(0xFF92400E)
                              : AppColors.error,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],

                  TextFormField(
                    controller: _emailCtrl,
                    enabled: !isLocked,
                    decoration: const InputDecoration(
                      labelText: 'Email',
                      prefixIcon: Icon(Icons.email_outlined),
                    ),
                    keyboardType: TextInputType.emailAddress,
                    textInputAction: TextInputAction.next,
                    validator: (v) {
                      if (v == null || v.trim().isEmpty) {
                        return 'Enter your email';
                      }
                      if (!v.contains('@')) return 'Enter a valid email';
                      return null;
                    },
                  ),
                  const SizedBox(height: 16),

                  TextFormField(
                    controller: _passCtrl,
                    enabled: !isLocked,
                    decoration: InputDecoration(
                      labelText: 'Password',
                      prefixIcon: const Icon(Icons.lock_outline),
                      suffixIcon: IconButton(
                        icon: Icon(_obscure
                            ? Icons.visibility_outlined
                            : Icons.visibility_off_outlined),
                        onPressed: () => setState(() => _obscure = !_obscure),
                      ),
                    ),
                    obscureText: _obscure,
                    textInputAction: TextInputAction.done,
                    onFieldSubmitted: (_) => _submit(),
                    validator: (v) =>
                        v == null || v.isEmpty ? 'Enter your password' : null,
                  ),
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton(
                      onPressed: _openForgotPasswordDialog,
                      child: const Text('Forgot password?'),
                    ),
                  ),
                  const SizedBox(height: 12),

                  FilledButton(
                    onPressed: (_loading || isLocked) ? null : _submit,
                    child: _loading
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(
                                strokeWidth: 2, color: Colors.white))
                        : Text(
                            isLocked
                                ? 'Try again in ${_formatCountdown(_lockoutSecs)}'
                                : 'Sign In',
                          ),
                  ),
                  const SizedBox(height: 16),

                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Text("Don't have an account?"),
                      TextButton(
                        onPressed: () => context.push(
                          widget.isCheckoutRedirect
                              ? '/register?from=checkout'
                              : '/register',
                        ),
                        child: const Text('Create one'),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Center(
                    child: TextButton.icon(
                      onPressed: _goBack,
                      icon: const Icon(Icons.arrow_back, size: 16),
                      label: const Text('Continue as Guest'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
