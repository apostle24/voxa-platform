import { Injectable, MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import { notificationEventBus } from './notification-events';

@Injectable()
export class NotificationRealtimeService {
  stream(userId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const onNotification = (event: { recipientId: string; notification?: unknown }) => {
        if (event.recipientId !== userId) return;
        subscriber.next({
          type: 'notification.created',
          data: { notification: event.notification ?? null, refresh: !event.notification },
        });
      };
      notificationEventBus.on('notification.created', onNotification);
      subscriber.next({ type: 'connected', data: { connected: true } });
      const heartbeat = setInterval(() => subscriber.next({ type: 'heartbeat', data: { at: new Date().toISOString() } }), 25000);
      return () => {
        clearInterval(heartbeat);
        notificationEventBus.off('notification.created', onNotification);
      };
    });
  }
}
