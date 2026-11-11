import { Injectable, ServiceUnavailableException } from '@nestjs/common';

@Injectable()
export class EmailDeliveryService {
  assertReady() {
    if (process.env.NODE_ENV === 'production' && (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)) {
      throw new ServiceUnavailableException('Account email delivery is not configured');
    }
  }

  async sendAccountLink(to: string, subject: string, message: string, url: string) {
    this.assertReady();
    if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
      // Development-only delivery preview. Never emit account tokens in production logs.
      if (process.env.NODE_ENV !== 'production') process.stdout.write('[VOXA email preview] ' + subject + ' to ' + to + ': ' + url + '\n');
      return;
    }
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, text: message + '\n\n' + url }),
    });
    if (!response.ok) throw new ServiceUnavailableException('Account email could not be delivered');
  }
}
