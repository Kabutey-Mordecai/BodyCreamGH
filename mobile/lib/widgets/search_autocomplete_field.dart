import 'dart:async';
import 'dart:convert';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../config.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';

const String _recentSearchesKey = 'bc_recent_searches';
const int _maxRecentSearches = 5;

class SearchAutocompleteField extends StatefulWidget {
  final TextEditingController controller;
  final String hintText;
  final bool isHeroVariant;
  final ValueChanged<String> onSubmitted;
  final ValueChanged<String>? onProductSelected;
  final VoidCallback? onClear;

  const SearchAutocompleteField({
    super.key,
    required this.controller,
    required this.onSubmitted,
    this.onProductSelected,
    this.onClear,
    this.hintText = 'Search for body creams, oils, scrubs…',
    this.isHeroVariant = false,
  });

  @override
  State<SearchAutocompleteField> createState() =>
      _SearchAutocompleteFieldState();
}

class _SearchAutocompleteFieldState extends State<SearchAutocompleteField> {
  final FocusNode _focusNode = FocusNode();
  Timer? _debounce;
  List<Map<String, dynamic>> _suggestions = [];
  List<String> _recentSearches = [];
  bool _loading = false;
  bool _showPanel = false;

  @override
  void initState() {
    super.initState();
    _loadRecent();
    _focusNode.addListener(() {
      if (_focusNode.hasFocus) {
        _loadRecent();
        setState(() => _showPanel = true);
      } else {
        Future.delayed(const Duration(milliseconds: 180), () {
          if (mounted && !_focusNode.hasFocus) {
            setState(() => _showPanel = false);
          }
        });
      }
    });
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _focusNode.dispose();
    super.dispose();
  }

  Future<void> _loadRecent() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_recentSearchesKey);
      if (raw != null && raw.isNotEmpty) {
        final decoded = (jsonDecode(raw) as List<dynamic>)
            .map((e) => e.toString())
            .where((e) => e.isNotEmpty)
            .take(_maxRecentSearches)
            .toList();
        if (mounted) setState(() => _recentSearches = decoded);
      }
    } catch (_) {}
  }

  Future<void> _saveRecent(String term) async {
    final clean = term.trim();
    if (clean.isEmpty) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      final next = [
        clean,
        ..._recentSearches.where(
          (r) => r.toLowerCase() != clean.toLowerCase(),
        ),
      ].take(_maxRecentSearches).toList();
      await prefs.setString(_recentSearchesKey, jsonEncode(next));
      if (mounted) setState(() => _recentSearches = next);
    } catch (_) {}
  }

  Future<void> _clearRecent() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_recentSearchesKey);
      if (mounted) setState(() => _recentSearches = []);
    } catch (_) {}
  }

  void _onChanged(String val) {
    setState(() => _showPanel = true);
    _debounce?.cancel();
    final q = val.trim();
    if (q.length < 2) {
      setState(() {
        _suggestions = [];
        _loading = false;
      });
      return;
    }
    setState(() => _loading = true);
    _debounce = Timer(const Duration(milliseconds: 220), () async {
      try {
        final raw = await ApiService.instance.suggestProducts(q);
        if (!mounted) return;
        setState(() {
          _suggestions = raw.whereType<Map<String, dynamic>>().toList();
          _loading = false;
        });
      } catch (_) {
        if (mounted) setState(() => _loading = false);
      }
    });
  }

  void _submit(String term) {
    final clean = term.trim();
    if (clean.isNotEmpty) {
      _saveRecent(clean);
    }
    _focusNode.unfocus();
    setState(() => _showPanel = false);
    widget.onSubmitted(clean);
  }

  @override
  Widget build(BuildContext context) {
    final q = widget.controller.text.trim();
    final showSuggestions = _showPanel && q.length >= 2;
    final showRecent = _showPanel && q.length < 2 && _recentSearches.isNotEmpty;

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SizedBox(
          height: widget.isHeroVariant ? 40 : 44,
          child: TextField(
            controller: widget.controller,
            focusNode: _focusNode,
            style: const TextStyle(fontSize: 13, color: AppColors.text),
            decoration: InputDecoration(
              hintText: widget.hintText,
              hintStyle: const TextStyle(fontSize: 12.5, color: AppColors.muted),
              prefixIcon:
                  const Icon(Icons.search, size: 18, color: AppColors.muted),
              suffixIcon: widget.controller.text.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.clear, size: 17),
                      onPressed: () {
                        widget.controller.clear();
                        setState(() {
                          _suggestions = [];
                          _showPanel = false;
                        });
                        widget.onClear?.call();
                      },
                    )
                  : null,
              filled: true,
              fillColor: widget.isHeroVariant
                  ? Colors.white.withValues(alpha: 0.96)
                  : AppColors.surface,
              contentPadding: const EdgeInsets.symmetric(horizontal: 12),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(6),
                borderSide: widget.isHeroVariant
                    ? BorderSide.none
                    : const BorderSide(color: AppColors.border),
              ),
              isDense: true,
            ),
            onChanged: _onChanged,
            onSubmitted: _submit,
          ),
        ),
        if (showRecent || showSuggestions)
          Container(
            margin: const EdgeInsets.only(top: 4),
            constraints: const BoxConstraints(maxHeight: 240),
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: AppColors.border),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withValues(alpha: 0.12),
                  blurRadius: 12,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: showRecent
                ? Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Padding(
                        padding: const EdgeInsets.fromLTRB(12, 8, 8, 4),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            const Text(
                              'RECENT SEARCHES',
                              style: TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.w700,
                                letterSpacing: 1.1,
                                color: AppColors.muted,
                              ),
                            ),
                            GestureDetector(
                              onTap: _clearRecent,
                              child: const Text(
                                'Clear',
                                style: TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w600,
                                  color: AppColors.accentDark,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      Flexible(
                        child: ListView.builder(
                          shrinkWrap: true,
                          padding: EdgeInsets.zero,
                          itemCount: _recentSearches.length,
                          itemBuilder: (_, i) {
                            final term = _recentSearches[i];
                            return ListTile(
                              dense: true,
                              visualDensity: VisualDensity.compact,
                              leading: const Icon(Icons.history,
                                  size: 16, color: AppColors.muted),
                              title: Text(
                                term,
                                style: const TextStyle(
                                    fontSize: 13, color: AppColors.text),
                              ),
                              onTap: () {
                                widget.controller.text = term;
                                _submit(term);
                              },
                            );
                          },
                        ),
                      ),
                    ],
                  )
                : _loading
                    ? const Padding(
                        padding: EdgeInsets.all(14),
                        child: Text(
                          'Searching…',
                          style: TextStyle(fontSize: 12.5, color: AppColors.muted),
                        ),
                      )
                    : _suggestions.isEmpty
                        ? Padding(
                            padding: const EdgeInsets.all(14),
                            child: Text(
                              'No products matching "$q"',
                              style: const TextStyle(
                                  fontSize: 12.5, color: AppColors.muted),
                            ),
                          )
                        : ListView.separated(
                            shrinkWrap: true,
                            padding: const EdgeInsets.symmetric(vertical: 4),
                            itemCount: _suggestions.length + 1,
                            separatorBuilder: (_, __) =>
                                const Divider(height: 1),
                            itemBuilder: (_, i) {
                              if (i == _suggestions.length) {
                                return InkWell(
                                  onTap: () => _submit(q),
                                  child: Padding(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 12, vertical: 10),
                                    child: Text(
                                      'See all results for "$q" →',
                                      style: const TextStyle(
                                        fontSize: 12.5,
                                        fontWeight: FontWeight.w700,
                                        color: AppColors.accentDark,
                                      ),
                                    ),
                                  ),
                                );
                              }
                              final p = _suggestions[i];
                              final pid = (p['id'] ?? '').toString();
                              final name = (p['name'] ?? '').toString();
                              final cat = (p['category'] ?? '').toString();
                              final price = double.tryParse(
                                      (p['price'] ?? 0).toString()) ??
                                  0;
                              final rawImg = (p['image_url'] ?? '').toString();
                              final img = rawImg.isNotEmpty
                                  ? AppConfig.resolveImageUrl(rawImg)
                                  : null;

                              return ListTile(
                                dense: true,
                                visualDensity: VisualDensity.compact,
                                leading: ClipRRect(
                                  borderRadius: BorderRadius.circular(4),
                                  child: SizedBox(
                                    width: 34,
                                    height: 34,
                                    child: img != null
                                        ? CachedNetworkImage(
                                            imageUrl: img,
                                            fit: BoxFit.cover,
                                          )
                                        : const ColoredBox(
                                            color: AppColors.blush,
                                            child: Icon(Icons.spa_outlined,
                                                size: 16,
                                                color: AppColors.accent),
                                          ),
                                  ),
                                ),
                                title: Text(
                                  name,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w600,
                                    color: AppColors.primary,
                                  ),
                                ),
                                subtitle: cat.isNotEmpty
                                    ? Text(
                                        cat,
                                        style: const TextStyle(
                                            fontSize: 11,
                                            color: AppColors.muted),
                                      )
                                    : null,
                                trailing: Text(
                                  '${AppConfig.currencySymbol}${price.toStringAsFixed(2)}',
                                  style: const TextStyle(
                                    fontSize: 12.5,
                                    fontWeight: FontWeight.w700,
                                    color: AppColors.primary,
                                  ),
                                ),
                                onTap: () {
                                  _saveRecent(name);
                                  _focusNode.unfocus();
                                  setState(() => _showPanel = false);
                                  if (widget.onProductSelected != null &&
                                      pid.isNotEmpty) {
                                    widget.onProductSelected!(pid);
                                  } else {
                                    _submit(name);
                                  }
                                },
                              );
                            },
                          ),
          ),
      ],
    );
  }
}
