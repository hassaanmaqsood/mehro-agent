import crypto from 'crypto';
import logger from '../src/logger.js';
import { auditRepo } from './store.js';

export function signWebhookPayload(payloadStr, secret) {
  const hmac = crypto.createHmac('sha256', secret).update(payloadStr).digest('hex');
  return `sha256=${hmac}`;
}

export class WebhookEmitter {
  constructor(config = {}) {
    this.config = config.webhooks || {};
    this.retryDelays = [1000, 4000, 16000]; // 1s, 4s, 16s
  }

  emit(eventName, payload = {}, runId = crypto.randomUUID()) {
    if (!this.config.enabled) return;

    const endpoints = this.config.endpoints || [];
    const matchingEndpoints = endpoints.filter(ep => {
      if (!ep.events || ep.events.length === 0) return true;
      return ep.events.includes(eventName);
    });

    if (matchingEndpoints.length === 0) return;

    const eventBody = {
      event: eventName,
      timestamp: new Date().toISOString(),
      runId,
      payload
    };

    const payloadStr = JSON.stringify(eventBody);

    for (const ep of matchingEndpoints) {
      // Fire-and-forget asynchronously
      this._deliverWithRetry(ep, eventBody, payloadStr, 0).catch(err => {
        logger.error(`[WEBHOOK] Terminal delivery failure to ${ep.url}: ${err.message}`);
      });
    }
  }

  async _deliverWithRetry(endpoint, eventBody, payloadStr, attempt = 0) {
    const secret = endpoint.secret || 'default-webhook-secret';
    const signature = signWebhookPayload(payloadStr, secret);

    try {
      const res = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Mehro-Signature': signature,
          'X-Mehro-Event': eventBody.event
        },
        body: payloadStr,
        signal: AbortSignal.timeout(10000)
      });

      if (!res.ok) {
        throw new Error(`Endpoint returned status ${res.status}`);
      }

      logger.debug(`[WEBHOOK] Delivered ${eventBody.event} to ${endpoint.url}`);
    } catch (err) {
      if (attempt < this.retryDelays.length) {
        const delayMs = this.retryDelays[attempt];
        logger.warn(`[WEBHOOK] Attempt ${attempt + 1} failed for ${endpoint.url}: ${err.message}. Retrying in ${delayMs}ms...`);
        await new Promise(r => setTimeout(r, delayMs));
        return this._deliverWithRetry(endpoint, eventBody, payloadStr, attempt + 1);
      }

      // Max retries exhausted - record in audit log
      auditRepo.log({
        runId: eventBody.runId,
        toolId: 'runtime/webhook',
        input: { endpoint: endpoint.url, event: eventBody.event },
        output: null,
        status: 'failed',
        error: `Webhook delivery exhausted 3 retries: ${err.message}`
      });

      throw err;
    }
  }
}

export const webhookEmitter = new WebhookEmitter();
export default webhookEmitter;
