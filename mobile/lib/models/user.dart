class User {
  final int id;
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

  String get fullName => '$firstName $lastName';
  bool get isAdmin => role == 'admin';

  factory User.fromJson(Map<String, dynamic> json) {
    return User(
      id: json['id'] as int,
      email: json['email'] as String,
      firstName: json['first_name'] as String,
      lastName: json['last_name'] as String,
      phone: json['phone'] as String?,
      address: json['address'] as String?,
      role: json['role'] as String? ?? 'customer',
    );
  }
}
