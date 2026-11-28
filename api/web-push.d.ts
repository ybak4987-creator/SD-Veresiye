declare module 'web-push' {
  export type PushSubscriptionShape = {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };
  export type SendNotificationOptions = {
    TTL?: number;
    urgency?: 'very-low' | 'low' | 'normal' | 'high';
  };
  export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  export function sendNotification(
    subscription: PushSubscriptionShape,
    payload?: string,
    options?: SendNotificationOptions,
  ): Promise<{ statusCode: number; body: string; headers: Record<string, string> }>;
}
