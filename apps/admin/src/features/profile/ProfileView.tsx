import { useQuery } from 'urql';
import { ME_QUERY } from '../../graphql/queries';

interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface MeQueryResult {
  me: User | null;
}

interface ProfileViewProps {
  onLogout: () => void;
}

/**
 * Profile view component showing current user info.
 */
export function ProfileView({ onLogout }: ProfileViewProps) {
  const [{ data, fetching, error }] = useQuery<MeQueryResult>({
    query: ME_QUERY,
  });

  if (fetching) {
    return <div>Loading profile...</div>;
  }

  if (error) {
    return (
      <div style={{ color: 'red' }}>
        Error loading profile: {error.message}
      </div>
    );
  }

  if (!data?.me) {
    return (
      <div>
        <p>Not logged in</p>
        <button onClick={onLogout}>Go to Login</button>
      </div>
    );
  }

  const { me } = data;

  return (
    <div>
      <h2>My Profile</h2>
      <div
        style={{
          backgroundColor: '#f5f5f5',
          padding: '20px',
          borderRadius: '8px',
          maxWidth: '400px',
        }}
      >
        <div style={{ marginBottom: '16px' }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>
            Name
          </label>
          <span>{me.name}</span>
        </div>
        <div style={{ marginBottom: '16px' }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>
            Email
          </label>
          <span>{me.email}</span>
        </div>
        <div style={{ marginBottom: '16px' }}>
          <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>
            Member Since
          </label>
          <span>{new Date(me.createdAt).toLocaleDateString()}</span>
        </div>
        <button
          onClick={onLogout}
          style={{
            padding: '10px 20px',
            backgroundColor: '#cc3300',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Logout
        </button>
      </div>
    </div>
  );
}
