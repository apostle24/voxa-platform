import { NotificationRealtimeService } from './notification-realtime.service';
import { notificationEventBus } from './notification-events';

describe('NotificationRealtimeService', () => {
  let service: NotificationRealtimeService;
  beforeEach(() => { service = new NotificationRealtimeService(); });

  it('streams only events addressed to the connected user', () => {
    const received: any[] = [];
    const subscription = service.stream('user-a').subscribe(event => received.push(event));
    notificationEventBus.emit('notification.created', { recipientId: 'user-b', notification: { id: 'private' } });
    notificationEventBus.emit('notification.created', { recipientId: 'user-a', notification: { id: 'notice-1' } });
    expect(received).toHaveLength(2);
    expect(received[0]).toMatchObject({ type: 'connected' });
    expect(received[1]).toMatchObject({ type: 'notification.created', data: { notification: { id: 'notice-1' } } });
    subscription.unsubscribe();
  });

  it('stops delivering events after a client disconnects', () => {
    const received: any[] = [];
    const subscription = service.stream('user-a').subscribe(event => received.push(event));
    subscription.unsubscribe();
    notificationEventBus.emit('notification.created', { recipientId: 'user-a', notification: { id: 'after-disconnect' } });
    expect(received).toHaveLength(1);
  });
});
