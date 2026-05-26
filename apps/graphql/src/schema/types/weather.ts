/**
 * Weather GraphQL Type Definitions
 *
 * Defines custom types for weather data (not backed by Prisma).
 * Uses objectRef for type-safe custom object types.
 *
 * Types:
 * - WeatherLocation: Geographic location from IP geolocation
 * - WeatherCondition: Weather condition details (main, description, icon)
 * - Weather: Complete weather data combining location and conditions
 */

import { builder } from '../../builder.js';
import type {
  WeatherLocation as WeatherLocationType,
  WeatherCondition as WeatherConditionType,
  WeatherData,
} from '@octant/validation';

/**
 * WeatherLocation type representing geographic location from IP.
 */
const WeatherLocation = builder
  .objectRef<WeatherLocationType>('WeatherLocation')
  .implement({
    description: 'Geographic location from IP geolocation',
    fields: (t) => ({
      city: t.exposeString('city', {
        description: 'City name',
      }),
      region: t.exposeString('region', {
        description: 'Region or state name',
      }),
      country: t.exposeString('country', {
        description: 'Country code',
      }),
      latitude: t.exposeFloat('latitude', {
        description: 'Latitude coordinate',
      }),
      longitude: t.exposeFloat('longitude', {
        description: 'Longitude coordinate',
      }),
    }),
  });

/**
 * WeatherCondition type representing current weather conditions.
 */
const WeatherCondition = builder
  .objectRef<WeatherConditionType>('WeatherCondition')
  .implement({
    description: 'Current weather condition details',
    fields: (t) => ({
      main: t.exposeString('main', {
        description: 'Main weather condition (e.g., "Clear", "Rain")',
      }),
      description: t.exposeString('description', {
        description: 'Detailed description of weather condition',
      }),
      icon: t.exposeString('icon', {
        description: 'Weather icon code for display',
      }),
    }),
  });

/**
 * Weather type representing complete weather data.
 */
export const Weather = builder.objectRef<WeatherData>('Weather').implement({
  description: 'Weather data including location and current conditions',
  fields: (t) => ({
    location: t.field({
      type: WeatherLocation,
      description: 'Geographic location',
      resolve: (parent) => parent.location,
    }),
    temperature: t.exposeFloat('temperature', {
      description: 'Current temperature in Celsius',
    }),
    feelsLike: t.exposeFloat('feelsLike', {
      description: 'Feels-like temperature in Celsius',
    }),
    humidity: t.exposeInt('humidity', {
      description: 'Humidity percentage (0-100)',
    }),
    pressure: t.exposeInt('pressure', {
      description: 'Atmospheric pressure in hPa',
    }),
    windSpeed: t.exposeFloat('windSpeed', {
      description: 'Wind speed in m/s',
    }),
    windDirection: t.exposeInt('windDirection', {
      description: 'Wind direction in degrees',
    }),
    visibility: t.exposeInt('visibility', {
      description: 'Visibility in meters',
    }),
    condition: t.field({
      type: WeatherCondition,
      description: 'Current weather condition',
      resolve: (parent) => parent.condition,
    }),
    sunrise: t.expose('sunrise', {
      type: 'Date',
      description: 'Sunrise time',
    }),
    sunset: t.expose('sunset', {
      type: 'Date',
      description: 'Sunset time',
    }),
    fetchedAt: t.expose('fetchedAt', {
      type: 'Date',
      description: 'Timestamp when data was fetched',
    }),
  }),
});
