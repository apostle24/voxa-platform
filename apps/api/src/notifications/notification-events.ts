import { EventEmitter } from 'node:events';

export type NotificationRealtimeEvent = {
  recipientId: string;
  notification?: {
    id: string;
    type: string;
    title: string;
    body?: string | null;
    resourceType?: string | null;
    resourceId?: string | null;
    readAt?: Date | null;
    createdAt: Date;
  };
};

class NotificationEventBus extends EventEmitter {}
export const notificationEventBus = new NotificationEventBus();
notificationEventBus.setMaxListeners(0);

export function publishNotificationEvent(event: NotificationRealtimeEvent) {
  notificationEventBus.emit('notification.created', event);
}
