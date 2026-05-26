import { gql } from 'urql';

/**
 * Get current authenticated user.
 */
export const ME_QUERY = gql`
  query Me {
    me {
      id
      email
      name
      createdAt
      updatedAt
    }
  }
`;

/**
 * Login mutation.
 */
export const LOGIN_MUTATION = gql`
  mutation Login($input: LoginInput!) {
    login(input: $input) {
      accessToken
      refreshToken
      user {
        id
        email
        name
      }
    }
  }
`;

/**
 * Signup mutation.
 */
export const SIGNUP_MUTATION = gql`
  mutation Signup($input: SignupInput!) {
    signup(input: $input) {
      accessToken
      refreshToken
      user {
        id
        email
        name
      }
    }
  }
`;

/**
 * Logout mutation.
 */
export const LOGOUT_MUTATION = gql`
  mutation Logout($refreshToken: String!) {
    logout(refreshToken: $refreshToken)
  }
`;

/**
 * Refresh token mutation.
 */
export const REFRESH_TOKEN_MUTATION = gql`
  mutation RefreshToken($refreshToken: String!) {
    refreshToken(refreshToken: $refreshToken) {
      accessToken
      refreshToken
      user {
        id
        email
        name
      }
    }
  }
`;

/**
 * Get weather by client IP location.
 */
export const WEATHER_QUERY = gql`
  query WeatherByIP {
    weatherByIP {
      location {
        city
        region
        country
      }
      temperature
      feelsLike
      humidity
      windSpeed
      condition {
        main
        description
        icon
      }
      fetchedAt
    }
  }
`;
