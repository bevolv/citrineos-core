// Copyright Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache 2.0

import { FastifyRequest } from 'fastify';
import { IApiAuthProvider, ApiAuthenticationResult, UserInfo } from '@citrineos/base';
import { Logger, ILogObj } from 'tslog';
import crypto from 'crypto';

export interface ApiKeyConfig {
  apiKey: string;
  secretKey: string;
}

/**
 * API Key authentication provider for external backends
 * Validates external backends using API key and secret key
 */
export class ApiKeyAuthProvider implements IApiAuthProvider {
  private readonly _config: ApiKeyConfig;
  private readonly _logger: Logger<ILogObj>;

  constructor(config: ApiKeyConfig, logger?: Logger<ILogObj>) {
    this._config = config;
    this._logger = logger || new Logger<ILogObj>({ name: this.constructor.name });
  }

  /**
   * Extracts the API key from the Authorization header
   * Expected format: "Bearer <api_key>"
   */
  async extractToken(request: FastifyRequest): Promise<string | null> {
    const authHeader = request.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }

    return authHeader.substring(7); // Remove "Bearer " prefix
  }

  /**
   * Authenticates an API key and signature using HMAC validation
   * Expected token format: "apiKey:signature"
   */
  async authenticateToken(token: string): Promise<ApiAuthenticationResult> {
    try {
      // Split the token to get API key and signature
      const [apiKey, signature] = token.split(':');

      if (!apiKey || !signature) {
        this._logger.warn('Invalid token format - expected "apiKey:signature"');
        return ApiAuthenticationResult.failure('Invalid token format');
      }

      // Validate the API key
      if (apiKey !== this._config.apiKey) {
        this._logger.warn('Invalid API key provided');
        return ApiAuthenticationResult.failure('Invalid API key');
      }

      // Create expected signature using our secret key
      const expectedSignature = crypto
        .createHmac('sha256', this._config.secretKey)
        .update(apiKey)
        .digest('hex');

      // Validate the signature
      if (signature !== expectedSignature) {
        this._logger.warn('Invalid signature provided');
        return ApiAuthenticationResult.failure('Invalid signature');
      }

      // Create user info for the authenticated external backend
      const user: UserInfo = {
        id: 'external-backend',
        name: 'External Backend',
        email: '',
        roles: ['external_backend'],
        tenantId: '1', // Default tenant for external backends
        metadata: {
          authType: 'api_key_hmac',
          apiKey: apiKey,
        },
      };

      this._logger.debug('External backend authenticated successfully with HMAC');
      return ApiAuthenticationResult.success(user);
    } catch (error) {
      this._logger.error('API key authentication failed:', error);
      return ApiAuthenticationResult.failure(
        error instanceof Error ? error.message : 'Authentication failed',
      );
    }
  }

  /**
   * Authorizes the external backend for the requested resource
   * For API key auth, we allow all requests once authenticated
   */
  async authorizeUser(
    user: UserInfo,
    request: FastifyRequest,
  ): Promise<{ isAuthorized: boolean; error?: string }> {
    try {
      // For API key authentication, we allow all requests once the key is validated
      this._logger.debug(`Authorizing external backend for ${request.method} ${request.url}`);
      return { isAuthorized: true };
    } catch (error) {
      this._logger.error('Authorization failed:', error);
      return {
        isAuthorized: false,
        error: error instanceof Error ? error.message : 'Authorization failed',
      };
    }
  }
}
