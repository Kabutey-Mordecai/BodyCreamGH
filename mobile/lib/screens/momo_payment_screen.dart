import 'dart:async';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../config.dart';
import '../providers/auth_provider.dart';
import '../providers/cart_provider.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import '../utils/payment_url.dart';

const int _maxPollAttempts = 25;
const Duration _pollInterval = Duration(seconds: 3);

class MomoPaymentScreen extends StatefulWidget {
  final String orderId;
  final String orderNumber;
  final double amount;
  final String reference;
  final String initialStatus; // send_otp | pay_offline | pending | success | failed
  final String displayText;
  final String phone;
  final String provider; // mtn | vod | atl
  final String? guestEmail;

  const MomoPaymentScreen({
    super.key,
    required this.orderId,
    required this.orderNumber,
    required this.amount,
    required this.reference,
    required this.initialStatus,
    required this.displayText,
    required this.phone,
    required this.provider,
    this.guestEmail,
  });

  @override
  State<MomoPaymentScreen> createState() => _MomoPaymentScreenState();
}

class _MomoPaymentScreenState extends State<MomoPaymentScreen> {
  final _otpCtrl = TextEditingController();
  Timer? _pollTimer;

  late String _reference;
  late String _stage; // send_otp | waiting | verifying | success | failed
  late String _displayText;
  String? _errorMsg;
  bool _submittingOtp = false;
  bool _checkingNow = false;
  bool _retrying = false;
  int _pollCount = 0;

  String get _providerLabel {
    switch (widget.provider.toLowerCase()) {
      case 'mtn':
        return 'MTN Mobile Money';
      case 'vod':
        return 'Telecel Cash';
      case 'atl':
        return 'AT Money';
      default:
        return 'Mobile Money';
    }
  }

  @override
  void initState() {
    super.initState();
    _reference = widget.reference;
    _displayText = widget.displayText;

    final init = widget.initialStatus.toLowerCase();
    if (init == 'send_otp') {
      _stage = 'send_otp';
    } else if (init == 'success') {
      _stage = 'verifying';
      WidgetsBinding.instance.addPostFrameCallback((_) => _verifyOnce());
    } else if (init == 'failed') {
      _stage = 'failed';
      _errorMsg = _displayText.isNotEmpty
          ? _displayText
          : 'Mobile Money charge was declined.';
    } else {
      _stage = 'waiting';
      _startPolling();
    }
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _otpCtrl.dispose();
    super.dispose();
  }

  void _startPolling() {
    _pollTimer?.cancel();
    _pollCount = 0;
    _pollTimer = Timer.periodic(_pollInterval, (_) async {
      if (!mounted || _stage != 'waiting') {
        _pollTimer?.cancel();
        return;
      }
      _pollCount++;
      await _verifyOnce(silent: true);
      if (_pollCount >= _maxPollAttempts && mounted && _stage == 'waiting') {
        _pollTimer?.cancel();
      }
    });
  }

  Future<void> _verifyOnce({bool silent = false}) async {
    if (_checkingNow) return;
    if (!silent && mounted) {
      setState(() {
        _checkingNow = true;
        _errorMsg = null;
      });
    } else {
      _checkingNow = true;
    }

    try {
      final data = await ApiService.instance.verifyPayment(_reference);
      if (!mounted) return;
      final httpStatus = data['httpStatus'] as int? ?? 200;
      final status = (data['status'] ?? '').toString().toLowerCase();

      if (httpStatus == 202 || status == 'pending') {
        if (!silent) {
          setState(() {
            _checkingNow = false;
            _errorMsg =
                'Still waiting for approval on ${widget.phone}. Check your phone for the MoMo PIN prompt.';
          });
        } else {
          _checkingNow = false;
        }
        return;
      }

      _pollTimer?.cancel();
      // Clear local cart on confirmed payment
      if (mounted) {
        context.read<CartProvider>().clear();
        setState(() {
          _checkingNow = false;
          _stage = 'success';
          _errorMsg = null;
        });
      }
    } catch (e) {
      if (!mounted) return;
      final msg =
          e.toString().replaceFirst(RegExp(r'ApiException\(\d+\): '), '');
      // Keep polling on transient "pending" messages; fail on definitive failures
      final lower = msg.toLowerCase();
      if (lower.contains('failed') ||
          lower.contains('declined') ||
          lower.contains('reversed') ||
          lower.contains('abandoned')) {
        _pollTimer?.cancel();
        setState(() {
          _checkingNow = false;
          _stage = 'failed';
          _errorMsg = msg;
        });
      } else {
        setState(() {
          _checkingNow = false;
          if (!silent) _errorMsg = msg;
        });
      }
    }
  }

  Future<void> _submitOtp() async {
    final otp = _otpCtrl.text.trim();
    if (otp.length < 4) {
      setState(() => _errorMsg = 'Enter the OTP sent to ${widget.phone}.');
      return;
    }
    setState(() {
      _submittingOtp = true;
      _errorMsg = null;
    });
    try {
      final data = await ApiService.instance.submitMobileMoneyOtp(
        reference: _reference,
        otp: otp,
      );
      if (!mounted) return;
      final status = (data['status'] ?? 'pay_offline').toString().toLowerCase();
      final dt = (data['display_text'] ?? data['message'] ?? '').toString();
      setState(() {
        _submittingOtp = false;
        if (dt.isNotEmpty) _displayText = dt;
      });
      if (status == 'success') {
        setState(() => _stage = 'verifying');
        await _verifyOnce();
      } else if (status == 'failed') {
        setState(() {
          _stage = 'failed';
          _errorMsg = dt.isNotEmpty ? dt : 'OTP verification failed.';
        });
      } else {
        setState(() => _stage = 'waiting');
        _startPolling();
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _submittingOtp = false;
        _errorMsg =
            e.toString().replaceFirst(RegExp(r'ApiException\(\d+\): '), '');
      });
    }
  }

  Future<void> _retryMomo() async {
    if (_retrying) return;
    setState(() {
      _retrying = true;
      _errorMsg = null;
    });
    try {
      final data = await ApiService.instance.chargeMobileMoney(
        orderId: widget.orderId,
        phone: widget.phone,
        provider: widget.provider,
        email: widget.guestEmail,
      );
      if (!mounted) return;
      final status = (data['status'] ?? 'pay_offline').toString().toLowerCase();
      setState(() {
        _retrying = false;
        _reference = (data['reference'] ?? _reference).toString();
        _displayText =
            (data['display_text'] ?? data['message'] ?? '').toString();
        _otpCtrl.clear();
      });
      if (status == 'send_otp') {
        setState(() => _stage = 'send_otp');
      } else if (status == 'success') {
        setState(() => _stage = 'verifying');
        await _verifyOnce();
      } else {
        setState(() => _stage = 'waiting');
        _startPolling();
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _retrying = false;
        _errorMsg =
            e.toString().replaceFirst(RegExp(r'ApiException\(\d+\): '), '');
      });
    }
  }

  Future<void> _fallbackToPaystackWeb() async {
    if (_retrying) return;
    setState(() {
      _retrying = true;
      _errorMsg = null;
    });
    try {
      final isAuthed = context.read<AuthProvider>().isLoggedIn;
      final data = isAuthed
          ? await ApiService.instance.initializePayment(widget.orderId)
          : await ApiService.instance.initializeGuestPayment(
              widget.orderId,
              widget.guestEmail ?? '',
            );
      final url = data['authorization_url']?.toString() ?? '';
      if (!isSafePaystackCheckoutUrl(url)) {
        throw Exception('Invalid payment redirect URL.');
      }
      if (!mounted) return;
      context.go('/payment', extra: {
        'url': url,
        'order_id': widget.orderId,
        'order_number': widget.orderNumber,
        if (widget.guestEmail != null) 'guest_email': widget.guestEmail,
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _retrying = false;
        _errorMsg = e
            .toString()
            .replaceFirst(RegExp(r'ApiException\(\d+\): '), '')
            .replaceFirst('Exception: ', '');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final isAuthed = context.watch<AuthProvider>().isLoggedIn;
    final cs = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: () {
            if (_stage == 'success' && isAuthed) {
              context.go('/order/${widget.orderId}', extra: {'justPaid': true});
            } else {
              context.go(isAuthed ? '/orders' : '/shop');
            }
          },
        ),
        title: Text(_providerLabel),
      ),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    // Order + Amount pill
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 14, vertical: 8),
                      decoration: BoxDecoration(
                        color: cs.secondaryContainer,
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Text(
                        '${widget.orderNumber}  ·  ${AppConfig.currencySymbol}${widget.amount.toStringAsFixed(2)}',
                        style: TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 13,
                          color: cs.primary,
                        ),
                      ),
                    ),
                    const SizedBox(height: 22),

                    if (_stage == 'send_otp') ...[
                      Icon(Icons.sms_outlined, size: 52, color: cs.secondary),
                      const SizedBox(height: 14),
                      Text('Enter Verification Code',
                          style: Theme.of(context).textTheme.headlineSmall,
                          textAlign: TextAlign.center),
                      const SizedBox(height: 8),
                      Text(
                        _displayText.isNotEmpty
                            ? _displayText
                            : 'Enter the SMS OTP sent to ${widget.phone} to authorize your $_providerLabel payment.',
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: AppColors.muted),
                      ),
                      const SizedBox(height: 18),
                      TextField(
                        controller: _otpCtrl,
                        keyboardType: TextInputType.number,
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                            fontSize: 22,
                            letterSpacing: 6,
                            fontWeight: FontWeight.w700),
                        decoration: const InputDecoration(
                          hintText: '123456',
                          labelText: 'SMS OTP',
                        ),
                      ),
                      if (_errorMsg != null) ...[
                        const SizedBox(height: 10),
                        Text(_errorMsg!,
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                                color: AppColors.error, fontSize: 13)),
                      ],
                      const SizedBox(height: 18),
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton(
                          onPressed: _submittingOtp ? null : _submitOtp,
                          child: _submittingOtp
                              ? const SizedBox(
                                  height: 18,
                                  width: 18,
                                  child: CircularProgressIndicator(
                                      strokeWidth: 2, color: Colors.white),
                                )
                              : const Text('Confirm Code'),
                        ),
                      ),
                    ] else if (_stage == 'waiting' || _stage == 'verifying') ...[
                      SizedBox(
                        height: 54,
                        width: 54,
                        child: CircularProgressIndicator(
                          strokeWidth: 3.5,
                          color: cs.secondary,
                        ),
                      ),
                      const SizedBox(height: 18),
                      Text(
                        _stage == 'verifying'
                            ? 'Confirming Payment…'
                            : 'Approve on Your Phone',
                        style: Theme.of(context).textTheme.headlineSmall,
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 10),
                      Text(
                        _displayText.isNotEmpty
                            ? _displayText
                            : 'A $_providerLabel prompt has been sent to ${widget.phone}. Enter your MoMo PIN on your phone to complete payment.',
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                            color: AppColors.muted, height: 1.45),
                      ),
                      const SizedBox(height: 14),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: cs.surfaceContainerHighest,
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: AppColors.border),
                        ),
                        child: const Text(
                          'Didn\'t see the popup? On MTN, dial *170# → Option 6 (My Wallet) → Option 3 (My Approvals) to approve.',
                          style:
                              TextStyle(fontSize: 12, color: AppColors.muted),
                          textAlign: TextAlign.center,
                        ),
                      ),
                      if (_errorMsg != null) ...[
                        const SizedBox(height: 10),
                        Text(_errorMsg!,
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                                color: AppColors.error, fontSize: 12.5)),
                      ],
                      const SizedBox(height: 18),
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton(
                          onPressed: _checkingNow ? null : () => _verifyOnce(),
                          child: _checkingNow
                              ? const SizedBox(
                                  height: 18,
                                  width: 18,
                                  child: CircularProgressIndicator(
                                      strokeWidth: 2, color: Colors.white),
                                )
                              : const Text("I've Approved — Check Now"),
                        ),
                      ),
                      const SizedBox(height: 8),
                      TextButton(
                        onPressed: _retrying ? null : _fallbackToPaystackWeb,
                        child: const Text('Pay with Card / Paystack Web instead'),
                      ),
                    ] else if (_stage == 'success') ...[
                      const Icon(Icons.check_circle,
                          size: 64, color: AppColors.success),
                      const SizedBox(height: 14),
                      Text('Payment Confirmed!',
                          style: Theme.of(context).textTheme.headlineSmall,
                          textAlign: TextAlign.center),
                      const SizedBox(height: 8),
                      Text(
                        'Your $_providerLabel payment for order ${widget.orderNumber} was received.',
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: AppColors.muted),
                      ),
                      const SizedBox(height: 22),
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton(
                          onPressed: () {
                            if (isAuthed) {
                              context.go('/order/${widget.orderId}',
                                  extra: {'justPaid': true});
                            } else {
                              context.go(
                                '/track-order?order_number=${Uri.encodeComponent(widget.orderNumber)}',
                              );
                            }
                          },
                          child: Text(isAuthed
                              ? 'View Order Detail'
                              : 'Track Your Order'),
                        ),
                      ),
                      const SizedBox(height: 10),
                      SizedBox(
                        width: double.infinity,
                        child: OutlinedButton(
                          onPressed: () => context.go('/shop'),
                          child: const Text('Continue Shopping'),
                        ),
                      ),
                    ] else ...[
                      const Icon(Icons.error_outline,
                          size: 56, color: AppColors.error),
                      const SizedBox(height: 14),
                      Text('Payment Not Completed',
                          style: Theme.of(context).textTheme.headlineSmall,
                          textAlign: TextAlign.center),
                      const SizedBox(height: 8),
                      Text(
                        _errorMsg ??
                            'The Mobile Money prompt was not approved or timed out.',
                        textAlign: TextAlign.center,
                        style: const TextStyle(color: AppColors.muted),
                      ),
                      const SizedBox(height: 20),
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton(
                          onPressed: _retrying ? null : _retryMomo,
                          child: _retrying
                              ? const SizedBox(
                                  height: 18,
                                  width: 18,
                                  child: CircularProgressIndicator(
                                      strokeWidth: 2, color: Colors.white),
                                )
                              : const Text('Send MoMo Prompt Again'),
                        ),
                      ),
                      const SizedBox(height: 10),
                      SizedBox(
                        width: double.infinity,
                        child: OutlinedButton(
                          onPressed: _retrying ? null : _fallbackToPaystackWeb,
                          child: const Text('Pay via Paystack Web (Card / MoMo)'),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
