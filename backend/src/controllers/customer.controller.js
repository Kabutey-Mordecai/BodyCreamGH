const bcrypt = require('bcryptjs');
const UserModel = require('../models/user.model');
const CustomerModel = require('../models/customer.model');

const getProfile = async (req, res) => {
  try {
    const [user, customer] = await Promise.all([
      UserModel.findById(req.user.id),
      CustomerModel.findByUserId(req.user.id),
    ]);
    res.json({ ...user, ...customer, id: user.id });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
};

const updateProfile = async (req, res) => {
  try {
    const { first_name, last_name, phone, address, city, region, postal_code } = req.body;

    await Promise.all([
      UserModel.updateProfile(req.user.id, { first_name, last_name, phone }),
      CustomerModel.updateProfile(req.user.id, { phone, address, city, region, postal_code }),
    ]);

    res.json({ message: 'Profile updated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
};

const changePassword = async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'current_password and new_password are required' });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const user = await UserModel.findByIdWithHash(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const match = await bcrypt.compare(current_password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(new_password, 10);
    await UserModel.updatePassword(req.user.id, hash);

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to change password' });
  }
};

module.exports = { getProfile, updateProfile, changePassword };
