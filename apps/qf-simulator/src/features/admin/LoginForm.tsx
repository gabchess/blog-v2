import { useState, type FormEvent } from 'react';
import { useAuth } from '../../hooks';

interface LoginFormProps {
  onSuccess: () => void;
}

export function LoginForm({ onSuccess }: LoginFormProps) {
  const [isSignup, setIsSignup] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');

  const { signup, login, loading, error, clearError } = useAuth();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();

    try {
      if (isSignup) {
        await signup(email, password, name);
      } else {
        await login(email, password);
      }
      onSuccess();
    } catch {
      // Error already set by useAuth hook
    }
  };

  return (
    <div className="login-form">
      <h2>{isSignup ? 'Create Admin Account' : 'Admin Login'}</h2>

      {error && <div className="error" onClick={clearError}>{error}</div>}

      <form onSubmit={handleSubmit} className="login-form__form">
        {isSignup && (
          <div className="login-form__field">
            <label htmlFor="name">Name</label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
            />
          </div>
        )}

        <div className="login-form__field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>

        <div className="login-form__field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            required
            minLength={12}
            placeholder={isSignup ? 'Min 12 characters' : ''}
          />
        </div>

        <div className="login-form__actions">
          <button type="submit" disabled={loading} className="login-form__submit">
            {loading ? 'Processing...' : isSignup ? 'Sign Up' : 'Login'}
          </button>
          <button type="button" onClick={() => setIsSignup(!isSignup)} className="login-form__toggle">
            {isSignup ? 'Already have an account? Login' : "Don't have an account? Sign Up"}
          </button>
        </div>
      </form>
    </div>
  );
}
