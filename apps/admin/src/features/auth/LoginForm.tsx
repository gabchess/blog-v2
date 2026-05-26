import { useState, type FormEvent } from 'react';
import { useMutation } from 'urql';
import { LOGIN_MUTATION, SIGNUP_MUTATION } from '../../graphql/queries';
import { setTokens } from '../../graphql/client';

interface LoginFormProps {
  onSuccess: () => void;
}

interface AuthPayload {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    name: string;
  };
}

/**
 * Login/Signup form component.
 * Toggles between login and signup modes.
 */
export function LoginForm({ onSuccess }: LoginFormProps) {
  const [isSignup, setIsSignup] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [loginResult, login] = useMutation(LOGIN_MUTATION);
  const [signupResult, signup] = useMutation(SIGNUP_MUTATION);

  const isSaving = loginResult.fetching || signupResult.fetching;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      if (isSignup) {
        const result = await signup({ input: { email, password, name } });
        if (result.error) {
          setError(result.error.message);
          return;
        }
        const payload = result.data?.signup as AuthPayload;
        setTokens(payload.accessToken, payload.refreshToken);
      } else {
        const result = await login({ input: { email, password } });
        if (result.error) {
          setError(result.error.message);
          return;
        }
        const payload = result.data?.login as AuthPayload;
        setTokens(payload.accessToken, payload.refreshToken);
      }
      onSuccess();
    } catch {
      setError('An unexpected error occurred');
    }
  };

  return (
    <div>
      <h2>{isSignup ? 'Sign Up' : 'Login'}</h2>

      {error && (
        <div style={{ color: 'red', marginBottom: '16px' }}>
          Error: {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ maxWidth: '400px' }}>
        {isSignup && (
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #ccc',
                borderRadius: '4px',
                boxSizing: 'border-box',
              }}
            />
          </div>
        )}

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{
              width: '100%',
              padding: '8px',
              border: '1px solid #ccc',
              borderRadius: '4px',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={12}
            placeholder={isSignup ? 'Min 12 characters' : ''}
            style={{
              width: '100%',
              padding: '8px',
              border: '1px solid #ccc',
              borderRadius: '4px',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: '8px', flexDirection: 'column' }}>
          <button
            type="submit"
            disabled={isSaving}
            style={{
              padding: '10px 20px',
              backgroundColor: '#0066cc',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: isSaving ? 'not-allowed' : 'pointer',
              opacity: isSaving ? 0.7 : 1,
            }}
          >
            {isSaving ? 'Processing...' : isSignup ? 'Sign Up' : 'Login'}
          </button>
          <button
            type="button"
            onClick={() => setIsSignup(!isSignup)}
            style={{
              padding: '10px 20px',
              backgroundColor: 'transparent',
              color: '#0066cc',
              border: 'none',
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            {isSignup ? 'Already have an account? Login' : "Don't have an account? Sign Up"}
          </button>
        </div>
      </form>
    </div>
  );
}
