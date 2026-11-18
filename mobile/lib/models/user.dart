class User {
  final String id;
  final String email;
  final String firstName;
  final String lastName;
  final String? phone;
  final String? address;
  final String role;

  const User({
    required this.id,
    required this.email,
    required this.firstName,
    required this.lastName,
    this.phone,
    this.address,
    this.role = 'customer',
  });

  String get fullName {
    final full = '$firstName $lastName'.trim();
    return full.isNotEmpty ? full : email;
  }
  bool get isAdmin => role == 'admin';

  factory User.fromJson(Map<String, dynamic> json) {
    return User(
      id: (json['id'] ?? '').toString(),
      email: json['email'] as String? ?? '',
      firstName: json['first_name'] as String? ?? json['firstName'] as String? ?? '',
      lastName: json['last_name'] as String? ?? json['lastName'] as String? ?? '',
      phone: json['phone'] as String?,
      address: json['address'] as String?,
      role: json['role'] as String? ?? 'customer',
    );
  }
}
