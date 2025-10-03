// Copyright Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache 2.0

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Logger, ILogObj } from 'tslog';
import { ApiKeyAuthProvider } from '@citrineos/util';

interface HasuraWebhookRequest {
  headers: Record<string, string>;
  request: {
    query: string;
    variables: Record<string, any>;
    operationName?: string;
  };
}

interface HasuraWebhookResponse {
  'X-Hasura-User-Id': string;
  'X-Hasura-Role': string;
  'X-Hasura-Allowed-Roles': string;
  'X-Hasura-Default-Role': string;
  'X-Hasura-Tenant-Id': string;
}

export class GraphQLAuthWebhook {
  constructor(
    private _server: FastifyInstance,
    private _apiKeyProvider: ApiKeyAuthProvider,
    private _logger: Logger<ILogObj>,
  ) {
    this.registerWebhook();
  }

  private registerWebhook() {
    // Support both GET and POST methods for Hasura webhook
    this._server.get(
      '/webhook/graphql-auth',
      async (request: FastifyRequest, reply: FastifyReply) => {
        return this.handleWebhookRequest(request, reply);
      },
    );

    this._server.post(
      '/webhook/graphql-auth',
      async (request: FastifyRequest<{ Body: HasuraWebhookRequest }>, reply: FastifyReply) => {
        return this.handleWebhookRequest(request, reply);
      },
    );
  }

  private async handleWebhookRequest(request: FastifyRequest, reply: FastifyReply) {
    try {
      // For GET requests, headers are in request.headers
      // For POST requests, headers are in request.body.headers
      const headers =
        request.method === 'GET' ? request.headers : (request.body as any)?.headers || {};

      // Check for admin secret first
      const adminSecret = headers['x-hasura-admin-secret'];
      if (adminSecret === 'CitrineOS!') {
        this._logger.debug('GraphQL admin authentication successful');
        return reply.send({
          'X-Hasura-User-Id': 'admin',
          'X-Hasura-Role': 'admin',
          'X-Hasura-Allowed-Roles': 'admin,user',
          'X-Hasura-Default-Role': 'admin',
          'X-Hasura-Tenant-Id': '1',
        });
      }

      // Extract Authorization header for regular user authentication
      const authHeader = headers['authorization'] || headers['Authorization'];
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({
          error: 'Unauthorized',
          message: 'Missing or invalid authorization header',
        });
      }

      const token = authHeader.substring(7);

      // Validate using our API key provider
      const authResult = await this._apiKeyProvider.authenticateToken(token);

      if (!authResult.isAuthenticated || !authResult.user) {
        return reply.code(401).send({
          error: 'Unauthorized',
          message: authResult.error || 'Invalid credentials',
        });
      }

      // Return Hasura session variables
      const response: HasuraWebhookResponse = {
        'X-Hasura-User-Id': authResult.user.id,
        'X-Hasura-Role': 'user',
        'X-Hasura-Allowed-Roles': 'user',
        'X-Hasura-Default-Role': 'user',
        'X-Hasura-Tenant-Id': authResult.user.tenantId || '1',
      };

      this._logger.debug('GraphQL authentication successful for external backend');
      return reply.send(response);
    } catch (error) {
      this._logger.error('GraphQL webhook authentication failed:', error);
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Authentication failed',
      });
    }
  }
}
