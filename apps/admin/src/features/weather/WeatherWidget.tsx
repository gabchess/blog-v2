import { useQuery } from 'urql';
import { WEATHER_QUERY } from '../../graphql/queries';

interface WeatherLocation {
  city: string;
  region: string;
  country: string;
}

interface WeatherCondition {
  main: string;
  description: string;
  icon: string;
}

interface WeatherData {
  location: WeatherLocation;
  temperature: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  condition: WeatherCondition;
  fetchedAt: string;
}

interface WeatherQueryResult {
  weatherByIP: WeatherData | null;
}

const styles = {
  container: {
    backgroundColor: '#f0f7ff',
    padding: '16px',
    borderRadius: '8px',
    maxWidth: '280px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  },
  title: {
    margin: 0,
    fontSize: '14px',
    fontWeight: 600,
    color: '#333',
  },
  refreshButton: {
    padding: '4px 8px',
    backgroundColor: 'transparent',
    border: '1px solid #ccc',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
  },
  location: {
    fontSize: '13px',
    color: '#666',
    marginBottom: '8px',
  },
  tempContainer: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
    marginBottom: '8px',
  },
  temperature: {
    fontSize: '32px',
    fontWeight: 700,
    color: '#1a1a1a',
    margin: 0,
  },
  feelsLike: {
    fontSize: '12px',
    color: '#888',
  },
  condition: {
    fontSize: '14px',
    color: '#555',
    textTransform: 'capitalize' as const,
    marginBottom: '12px',
  },
  details: {
    display: 'flex',
    gap: '16px',
    fontSize: '12px',
    color: '#666',
  },
  detailItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  skeleton: {
    backgroundColor: '#e0e0e0',
    borderRadius: '4px',
    animation: 'pulse 1.5s ease-in-out infinite',
  },
  error: {
    backgroundColor: '#fff0f0',
    padding: '16px',
    borderRadius: '8px',
    maxWidth: '280px',
    color: '#cc3300',
    fontSize: '13px',
  },
  unavailable: {
    backgroundColor: '#f5f5f5',
    padding: '16px',
    borderRadius: '8px',
    maxWidth: '280px',
    color: '#888',
    fontSize: '13px',
  },
};

function WeatherSkeleton() {
  return (
    <div style={styles.container}>
      <div style={{ ...styles.skeleton, width: '100px', height: '16px', marginBottom: '12px' }} />
      <div style={{ ...styles.skeleton, width: '60px', height: '32px', marginBottom: '8px' }} />
      <div style={{ ...styles.skeleton, width: '120px', height: '14px', marginBottom: '12px' }} />
      <div style={{ display: 'flex', gap: '16px' }}>
        <div style={{ ...styles.skeleton, width: '60px', height: '12px' }} />
        <div style={{ ...styles.skeleton, width: '60px', height: '12px' }} />
      </div>
    </div>
  );
}

interface WeatherErrorProps {
  onRetry: () => void;
}

function WeatherError({ onRetry }: WeatherErrorProps) {
  return (
    <div style={styles.error}>
      <p style={{ margin: '0 0 8px 0' }}>Could not load weather data</p>
      <button
        onClick={onRetry}
        style={{
          padding: '6px 12px',
          backgroundColor: '#cc3300',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '12px',
        }}
      >
        Retry
      </button>
    </div>
  );
}

function WeatherUnavailable() {
  return (
    <div style={styles.unavailable}>
      <p style={{ margin: 0 }}>Weather data unavailable for your location</p>
    </div>
  );
}

/**
 * Weather widget displaying current weather based on user IP location.
 * Uses the weatherByIP GraphQL query.
 */
export function WeatherWidget() {
  const [{ data, fetching, error }, reexecute] = useQuery<WeatherQueryResult>({
    query: WEATHER_QUERY,
  });

  const handleRefresh = () => {
    reexecute({ requestPolicy: 'network-only' });
  };

  if (fetching) {
    return <WeatherSkeleton />;
  }

  if (error) {
    return <WeatherError onRetry={handleRefresh} />;
  }

  if (!data?.weatherByIP) {
    return <WeatherUnavailable />;
  }

  const { location, temperature, feelsLike, humidity, windSpeed, condition } = data.weatherByIP;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>Current Weather</h3>
        <button
          onClick={handleRefresh}
          style={styles.refreshButton}
          title="Refresh weather"
        >
          ↻
        </button>
      </div>
      <div style={styles.location}>
        {location.city}, {location.region}
      </div>
      <div style={styles.tempContainer}>
        <p style={styles.temperature}>{Math.round(temperature)}°C</p>
        <span style={styles.feelsLike}>Feels like {Math.round(feelsLike)}°</span>
      </div>
      <div style={styles.condition}>{condition.description}</div>
      <div style={styles.details}>
        <div style={styles.detailItem}>
          <span>💧</span>
          <span>{humidity}%</span>
        </div>
        <div style={styles.detailItem}>
          <span>💨</span>
          <span>{windSpeed} m/s</span>
        </div>
      </div>
    </div>
  );
}
