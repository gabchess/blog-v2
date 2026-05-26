/**
 * Weather Query Definitions
 *
 * Provides the `weatherByIP` query for fetching weather based on client IP.
 *
 * Security: This is a PUBLIC endpoint (no authentication required).
 * The IP address is automatically extracted from the request context,
 * not from user input, preventing injection attacks.
 */

import { builder } from '../../builder.js';
import { Weather } from '../types/weather.js';
import { getWeatherByIP } from '../../services/weather.js';

/**
 * Query to fetch current weather based on client IP location.
 * Returns null if weather cannot be determined.
 *
 * This is a PUBLIC endpoint - anyone can call it without authentication.
 */
builder.queryField('weatherByIP', (t) =>
  t.field({
    type: Weather,
    nullable: true,
    description: 'Get current weather based on client IP location',
    // Mark as public - no authentication required
    skipTypeScopes: true,
    resolve: async (_parent, _args, context) => {
      try {
        return await getWeatherByIP(context.ipAddress, context.requestId);
      } catch (error) {
        console.error(`[${context.requestId}] Weather query error:`, error);
        return null; // Graceful degradation
      }
    },
  })
);
