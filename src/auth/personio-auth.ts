import axios, { AxiosInstance } from 'axios';

export interface PersonioAuthConfig {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  useV2Auth?: boolean; // Option to use v2 OAuth authentication
  scopes?: string[]; // OAuth2 scopes to request (e.g., 'personio:recruiting:read')
}

export interface AuthToken {
  access_token: string;
  token_type: string;
  expires_in: number;
  expires_at: number;
}

export class PersonioAuth {
  private config: PersonioAuthConfig;
  private token: AuthToken | null = null;
  private axiosInstance: AxiosInstance;

  constructor(config: PersonioAuthConfig) {
    this.config = {
      baseUrl: 'https://api.personio.de',
      ...config,
    };

    this.axiosInstance = axios.create({
      baseURL: this.config.baseUrl,
      timeout: 30000,
    });
  }

  /**
   * Authenticate with Personio API and get access token
   */
  async authenticate(): Promise<string> {
    try {
      // Try v2 OAuth authentication first if enabled or for v2 endpoints
      if (this.config.useV2Auth !== false) {
        try {
          return await this.authenticateV2();
        } catch (v2Error) {
          // If v2 fails, fall back to v1 unless explicitly v2-only
          if (this.config.useV2Auth === true) {
            throw v2Error;
          }
          console.warn('V2 authentication failed, falling back to v1:', v2Error instanceof Error ? v2Error.message : 'Unknown error');
        }
      }

      // V1 authentication (original method)
      // IMPORTANT: credentials MUST go in the request body, never the query string.
      // Personio deprecates POST /v1/auth?client_id=...&client_secret=... → 403 from 2026-12-01.
      // Passing an object as the axios body serializes it as JSON (Content-Type: application/json),
      // which is the compliant form. Do NOT move these into the URL/query params.
      const response = await this.axiosInstance.post('/v1/auth', {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      });

      if (response.data && response.data.data) {
        this.token = {
          access_token: response.data.data.token,
          token_type: 'Bearer',
          expires_in: 86400, // 24 hours as per Personio docs
          expires_at: Date.now() + (86400 * 1000), // 24 hours from now
        };

        return this.token.access_token;
      } else {
        throw new Error('Invalid authentication response from Personio API');
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const message = error.response?.data?.error?.message || error.message;
        throw new Error(`Personio authentication failed: ${message}`);
      }
      throw error;
    }
  }

  /**
   * Authenticate with Personio v2 OAuth2 API
   */
  private async authenticateV2(): Promise<string> {
    try {
      // V2 uses OAuth 2.0 Client Credentials Grant
      // Request must be URL-encoded
      const params = new URLSearchParams();
      params.append('grant_type', 'client_credentials');
      params.append('client_id', this.config.clientId);
      params.append('client_secret', this.config.clientSecret);
      if (this.config.scopes && this.config.scopes.length > 0) {
        params.append('scope', this.config.scopes.join(' '));
      }

      const response = await this.axiosInstance.post('/v2/auth/token', params, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
      });

      if (response.data && response.data.access_token) {
        this.token = {
          access_token: response.data.access_token,
          token_type: response.data.token_type || 'Bearer',
          expires_in: response.data.expires_in || 86400,
          expires_at: Date.now() + ((response.data.expires_in || 86400) * 1000),
        };

        return this.token.access_token;
      } else {
        throw new Error('Invalid v2 authentication response from Personio API');
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const message = error.response?.data?.error?.message ||
                       error.response?.data?.error ||
                       error.response?.data?.message ||
                       error.message;
        throw new Error(`Personio v2 authentication failed: ${message}`);
      }
      throw error;
    }
  }

  /**
   * Get valid access token, refreshing if necessary
   */
  async getValidToken(): Promise<string> {
    if (!this.token || this.isTokenExpired()) {
      await this.authenticate();
    }

    return this.token!.access_token;
  }

  /**
   * Check if current token is expired
   */
  private isTokenExpired(): boolean {
    if (!this.token) return true;
    
    // Add 5 minute buffer before actual expiration
    const bufferTime = 5 * 60 * 1000; // 5 minutes
    return Date.now() >= (this.token.expires_at - bufferTime);
  }

  /**
   * Get authorization header for API requests
   */
  async getAuthHeader(): Promise<{ Authorization: string }> {
    const token = await this.getValidToken();
    return {
      Authorization: `Bearer ${token}`,
    };
  }

  /**
   * Clear stored token (useful for testing or manual refresh)
   */
  clearToken(): void {
    this.token = null;
  }
}
