import type { Scheduler } from "./clock";
import type { SimConfig } from "./config";
import type { AppEvent, Logger } from "./events";

export interface RideRequestMessage {
  bookingId: number;
  /** A message whose body cannot be read: fails on every attempt. */
  corrupt?: boolean;
}

export const QUEUE = "ride.requests.v2.q";
export const DEAD_LETTER_QUEUE = "ride.requests.dlq";

/**
 * RabbitMQ as the backend configures it: publisher confirms, at-least-once delivery,
 * 3 attempts with exponential backoff (500 ms, x2), then reject without requeue into the dead-letter queue.
 */
export class FakeQueue {
  readonly deadLetters: RideRequestMessage[] = [];
  /** The next published message is delivered twice, as happens when an ack is lost. */
  duplicateNext = false;

  constructor(
    private readonly clock: Scheduler,
    private readonly log: Logger,
    private readonly consumer: (message: RideRequestMessage) => void,
    private readonly emit: (event: AppEvent) => void,
    private readonly cfg: SimConfig,
  ) {}

  publish(message: RideRequestMessage): void {
    this.log({
      component: "RabbitMQ",
      text: `basic.publish ${QUEUE} {"bookingId":${message.bookingId}}`,
      result: "publisher confirm: ack",
      bookingId: message.bookingId,
    });
    const duplicate = this.duplicateNext;
    this.duplicateNext = false;
    this.clock.after(this.cfg.deliveryDelayMs, () => this.deliver(message, 1, duplicate));
  }

  private deliver(message: RideRequestMessage, attempt: number, duplicate: boolean): void {
    const { maxAttempts, initialMs, multiplier } = this.cfg.retry;
    this.log({
      component: "RabbitMQ",
      text: `deliver ${QUEUE} -> RideRequestConsumer`,
      result: `attempt ${attempt}/${maxAttempts}`,
      bookingId: message.bookingId,
    });
    try {
      if (message.corrupt) throw new Error("MessageConversionException: cannot read message body");
      this.consumer(message);
      this.log({ component: "RabbitMQ", text: "basic.ack", bookingId: message.bookingId });
      if (duplicate) {
        this.clock.after(400, () => {
          this.log({
            component: "RabbitMQ",
            text: `redeliver ${QUEUE} {"bookingId":${message.bookingId}}`,
            result: "the ack was lost when the connection dropped (at-least-once delivery)",
            level: "warn",
            bookingId: message.bookingId,
          });
          this.deliver(message, 1, false);
        });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.log({ component: "RabbitMQ", text: "consumer threw", result: reason, level: "error", bookingId: message.bookingId });
      this.emit({ type: "matchingFailed", bookingId: message.bookingId, attempt, error: reason });
      if (attempt < maxAttempts) {
        const delayMs = initialMs * multiplier ** (attempt - 1);
        this.log({
          component: "RabbitMQ",
          text: `retry ${attempt + 1}/${maxAttempts} scheduled`,
          result: `in ${delayMs} ms (exponential backoff)`,
          level: "warn",
          bookingId: message.bookingId,
        });
        this.emit({ type: "retryScheduled", bookingId: message.bookingId, attempt: attempt + 1, delayMs });
        this.clock.after(delayMs, () => this.deliver(message, attempt + 1, duplicate));
      } else {
        this.log({
          component: "RabbitMQ",
          text: "basic.reject (requeue = false)",
          result: `dead-lettered to ${DEAD_LETTER_QUEUE}`,
          level: "error",
          bookingId: message.bookingId,
        });
        this.deadLetters.push(message);
        this.emit({ type: "deadLettered", bookingId: message.bookingId });
      }
    }
  }
}
