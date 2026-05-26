/**
 * Weather Service
 *
 * Provides weather data by combining IP geolocation and weather API.
 * - Uses ip-api.com for free IP geolocation (45 req/min)
 * - Uses OpenWeatherMap for weather data (1000 calls/day free tier)
 *
 * Features:
 * - In-memory caching to minimize API calls
 * - Graceful handling of localhost/private IPs
 * - Structured logging with request IDs
 */

import type { WeatherData, WeatherLocation } from '@octant/validation';

// ============================================================================
// Configuration
// ============================================================================

const OPENWEATHERMAP_API_KEY = process.env['OPENWEATHERMAP_API_KEY'] || '';

// Cache TTLs
const GEO_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours (IPs don't move)
const WEATHER_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes (weather changes)

// Default location for localhost/private IPs (San Francisco)
const DEFAULT_LOCATION: WeatherLocation = {
  city: 'San Francisco',
  region: 'California',
  country: 'US',
  latitude: 37.7749,
  longitude: -122.4194,
};

// ============================================================================
// Types
// ============================================================================

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

interface IpApiResponse {
  status: 'success' | 'fail';
  city?: string;
  regionName?: string;
  country?: string;
  lat?: number;
  lon?: number;
  message?: string;
}

interface OpenWeatherResponse {
  main: {
    temp: number;
    feels_like: number;
    humidity: number;
    pressure: number;
  };
  wind: {
    speed: number;
    deg: number;
  };
  visibility: number;
  weather: Array<{
    main: string;
    description: string;
    icon: string;
  }>;
  sys: {
    sunrise: number;
    sunset: number;
  };
}

// ============================================================================
// In-Memory Cache
// ============================================================================

const geoCache = new Map<string, CacheEntry<WeatherLocation>>();
const weatherCache = new Map<string, CacheEntry<WeatherData>>();

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  data: T,
  ttlMs: number
): void {
  cache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
  });
}

// ============================================================================
// IP Detection Helpers
// ============================================================================

/**
 * Check if an IP is private/localhost (needs default location).
 */
function isPrivateIP(ip: string): boolean {
  // Localhost variants
  if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost') {
    return true;
  }
  // Private IPv4 ranges
  if (
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)
  ) {
    return true;
  }
  return false;
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Get location from IP address using ip-api.com.
 */
async function geolocateIP(
  ip: string,
  requestId: string
): Promise<WeatherLocation | null> {
  // Handle private/localhost IPs
  if (isPrivateIP(ip)) {
    console.log(`[${requestId}] Private IP detected, using default location`);
    return DEFAULT_LOCATION;
  }

  // Check cache
  const cached = getCached(geoCache, ip);
  if (cached) {
    console.log(`[${requestId}] Geo cache hit for IP: ${ip}`);
    return cached;
  }

  try {
    console.log(`[${requestId}] Fetching geolocation for IP: ${ip}`);
    const response = await fetch(
      `http://ip-api.com/json/${ip}?fields=status,message,city,regionName,country,lat,lon`
    );

    if (!response.ok) {
      console.error(`[${requestId}] Geolocation API error: ${response.status}`);
      return null;
    }

    const data = (await response.json()) as IpApiResponse;

    if (data.status !== 'success') {
      console.error(`[${requestId}] Geolocation failed: ${data.message}`);
      return null;
    }

    const location: WeatherLocation = {
      city: data.city || 'Unknown',
      region: data.regionName || 'Unknown',
      country: data.country || 'Unknown',
      latitude: data.lat || 0,
      longitude: data.lon || 0,
    };

    setCache(geoCache, ip, location, GEO_CACHE_TTL_MS);
    console.log(`[${requestId}] Geolocation success: ${location.city}, ${location.region}`);
    return location;
  } catch (error) {
    console.error(`[${requestId}] Geolocation error:`, error);
    return null;
  }
}

/**
 * Fetch weather data from OpenWeatherMap.
 */
async function fetchWeather(
  lat: number,
  lon: number,
  requestId: string
): Promise<Omit<WeatherData, 'location'> | null> {
  if (!OPENWEATHERMAP_API_KEY || OPENWEATHERMAP_API_KEY === 'your_openweathermap_api_key') {
    console.warn(`[${requestId}] OpenWeatherMap API key not configured`);
    return null;
  }

  // Create cache key from coordinates (rounded to 2 decimal places)
  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;

  try {
    console.log(`[${requestId}] Fetching weather for coordinates: ${lat}, ${lon}`);
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OPENWEATHERMAP_API_KEY}&units=metric`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`[${requestId}] Weather API error: ${response.status}`);
      return null;
    }

    const data = (await response.json()) as OpenWeatherResponse;
    const weather = data.weather[0];

    if (!weather) {
      console.error(`[${requestId}] Weather data missing condition`);
      return null;
    }

    const weatherData = {
      temperature: data.main.temp,
      feelsLike: data.main.feels_like,
      humidity: data.main.humidity,
      pressure: data.main.pressure,
      windSpeed: data.wind.speed,
      windDirection: data.wind.deg,
      visibility: data.visibility,
      condition: {
        main: weather.main,
        description: weather.description,
        icon: weather.icon,
      },
      sunrise: new Date(data.sys.sunrise * 1000),
      sunset: new Date(data.sys.sunset * 1000),
      fetchedAt: new Date(),
    };

    console.log(`[${requestId}] Weather fetch success: ${weatherData.temperature}°C, ${weather.main}`);
    return weatherData;
  } catch (error) {
    console.error(`[${requestId}] Weather fetch error:`, error);
    return null;
  }
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Get weather data based on client IP address.
 *
 * @param ip - Client IP address
 * @param requestId - Request ID for logging
 * @returns Weather data or null on failure
 */
export async function getWeatherByIP(
  ip: string,
  requestId: string
): Promise<WeatherData | null> {
  // Check weather cache first (using IP as key)
  const cachedWeather = getCached(weatherCache, ip);
  if (cachedWeather) {
    console.log(`[${requestId}] Weather cache hit for IP: ${ip}`);
    return cachedWeather;
  }

  // Get location from IP
  const location = await geolocateIP(ip, requestId);
  if (!location) {
    console.log(`[${requestId}] Could not determine location for IP: ${ip}`);
    return null;
  }

  // Fetch weather for location
  const weather = await fetchWeather(location.latitude, location.longitude, requestId);
  if (!weather) {
    return null;
  }

  // Combine location and weather
  const weatherData: WeatherData = {
    location,
    ...weather,
  };

  // Cache the complete result
  setCache(weatherCache, ip, weatherData, WEATHER_CACHE_TTL_MS);
  return weatherData;
}
