import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * SMS gateway abstraction — ready for Twilio / Africa's Talking / custom providers.
 * Enable with SMS_ENABLED=true and provider credentials.
 */
export async function sendSms(to: string, message: string): Promise<boolean> {
  if (!env.SMS_ENABLED) {
    logger.info('SMS skipped (disabled)', { to, preview: message.slice(0, 40) });
    return false;
  }

  // Provider integration point
  logger.info('SMS queued', { to, length: message.length });
  return true;
}

export async function sendOtpSms(phone: string, otp: string): Promise<boolean> {
  return sendSms(phone, `Your ${env.APP_NAME || 'IMS'} verification code is: ${otp}. Valid for 10 minutes.`);
}
