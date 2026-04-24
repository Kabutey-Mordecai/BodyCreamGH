import { useState, useEffect } from 'react';
import { customerAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import './Account.css';

export default function Account() {
  const { user } = useAuth();

  // Two separate sub-forms: profile info and password change
  const [profile, setProfile] = useState({
    first_name: '',
    last_name: '',
    phone: '',
  });
  const [pwdForm, setPwdForm] = useState({
    current_password: '',
    new_password: '',
    confirm: '',
  });

  const [profileMsg, setProfileMsg] = useState({ type: '', text: '' });
  const [pwdMsg, setPwdMsg]         = useState({ type: '', text: '' });
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [loadingPwd, setLoadingPwd]         = useState(false);

  // Load current profile data when the page mounts
  useEffect(() => {
    customerAPI.getProfile().then(({ data }) => {
      setProfile({
        first_name: data.first_name || '',
        last_name:  data.last_name  || '',
        phone:      data.phone      || '',
      });
    });
  }, []);

  const handleProfileChange = e =>
    setProfile(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handlePwdChange = e =>
    setPwdForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    setProfileMsg({ type: '', text: '' });
    setLoadingProfile(true);
    try {
      await customerAPI.updateProfile(profile);
      setProfileMsg({ type: 'success', text: 'Profile updated successfully.' });
    } catch (err) {
      setProfileMsg({
        type: 'error',
        text: err.response?.data?.error || 'Update failed.',
      });
    } finally {
      setLoadingProfile(false);
    }
  };

  const handlePwdSubmit = async (e) => {
    e.preventDefault();
    setPwdMsg({ type: '', text: '' });

    if (pwdForm.new_password !== pwdForm.confirm) {
      return setPwdMsg({ type: 'error', text: 'New passwords do not match.' });
    }
    if (pwdForm.new_password.length < 8) {
      return setPwdMsg({ type: 'error', text: 'Password must be at least 8 characters.' });
    }

    setLoadingPwd(true);
    try {
      await customerAPI.changePassword({
        current_password: pwdForm.current_password,
        new_password:     pwdForm.new_password,
      });
      setPwdMsg({ type: 'success', text: 'Password changed successfully.' });
      // Clear the password fields after success
      setPwdForm({ current_password: '', new_password: '', confirm: '' });
    } catch (err) {
      setPwdMsg({
        type: 'error',
        text: err.response?.data?.error || 'Failed to change password.',
      });
    } finally {
      setLoadingPwd(false);
    }
  };

  return (
    <div className="page-section">
      <div className="container account-container">
        <div className="account-header">
          <span className="section-label">Your Profile</span>
          <h1 className="page-title">My Account</h1>
          <p className="page-subtitle" style={{ marginBottom: 0 }}>
            {/* Show the logged-in user's email */}
            Signed in as <strong>{user?.email}</strong>
          </p>
        </div>

        <div className="account-grid">
          {/* ── Profile info ──────────────────────────── */}
          <section className="account-card">
            <h2>Personal Information</h2>
            <div className="gold-divider" style={{ margin: '0 0 20px' }} />

            {profileMsg.text && (
              <div className={`alert alert-${profileMsg.type}`}>
                {profileMsg.text}
              </div>
            )}

            <form className="auth-form" onSubmit={handleProfileSubmit}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div className="form-group">
                  <label>First name</label>
                  <input
                    name="first_name"
                    value={profile.first_name}
                    onChange={handleProfileChange}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Last name</label>
                  <input
                    name="last_name"
                    value={profile.last_name}
                    onChange={handleProfileChange}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Phone number</label>
                <input
                  name="phone"
                  type="tel"
                  value={profile.phone}
                  onChange={handleProfileChange}
                  placeholder="+233 XX XXX XXXX"
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={loadingProfile}
              >
                {loadingProfile ? 'Saving…' : 'Save Changes'}
              </button>
            </form>
          </section>

          {/* ── Change password ───────────────────────── */}
          <section className="account-card">
            <h2>Change Password</h2>
            <div className="gold-divider" style={{ margin: '0 0 20px' }} />

            {pwdMsg.text && (
              <div className={`alert alert-${pwdMsg.type}`}>
                {pwdMsg.text}
              </div>
            )}

            <form className="auth-form" onSubmit={handlePwdSubmit}>
              <div className="form-group">
                <label>Current password</label>
                <input
                  name="current_password"
                  type="password"
                  value={pwdForm.current_password}
                  onChange={handlePwdChange}
                  required
                  autoComplete="current-password"
                />
              </div>

              <div className="form-group">
                <label>New password</label>
                <input
                  name="new_password"
                  type="password"
                  value={pwdForm.new_password}
                  onChange={handlePwdChange}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              </div>

              <div className="form-group">
                <label>Confirm new password</label>
                <input
                  name="confirm"
                  type="password"
                  value={pwdForm.confirm}
                  onChange={handlePwdChange}
                  required
                  autoComplete="new-password"
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                disabled={loadingPwd}
              >
                {loadingPwd ? 'Updating…' : 'Update Password'}
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
