import type { Logger } from "./events";

export type BookingStatus = "PENDING" | "CONFIRMED" | "CANCELLED";

export interface BookingRow {
  id: number;
  riderId: number;
  pickupLat: number;
  pickupLon: number;
  status: BookingStatus;
  driverId?: number;
}

export interface DriverRow {
  id: number;
  name: string;
  available: boolean;
}

/**
 * The SQL source of truth. Writes that decide ownership are compare-and-set updates
 * (UPDATE ... WHERE status = ...), exactly like the backend's repositories.
 */
export class FakeDb {
  readonly bookings = new Map<number, BookingRow>();
  readonly drivers = new Map<number, DriverRow>();
  private nextBookingId = 41;

  constructor(private readonly log: Logger) {}

  insertDriver(id: number, name: string): void {
    this.drivers.set(id, { id, name, available: true });
  }

  insertBooking(riderId: number, pickupLat: number, pickupLon: number): BookingRow {
    const row: BookingRow = { id: this.nextBookingId++, riderId, pickupLat, pickupLon, status: "PENDING" };
    this.bookings.set(row.id, row);
    this.log({
      component: "DB",
      text: `INSERT INTO bookings (passenger_id, pickup, status) VALUES (${riderId}, '${pickupLat.toFixed(4)},${pickupLon.toFixed(4)}', 'PENDING')`,
      result: `id = ${row.id}`,
      bookingId: row.id,
    });
    this.log({ component: "DB", text: "COMMIT", bookingId: row.id });
    return row;
  }

  findBooking(id: number): BookingRow | undefined {
    const row = this.bookings.get(id);
    this.log({ component: "DB", text: `SELECT * FROM bookings WHERE id = ${id}`, result: row ? row.status : "no row", level: "quiet", bookingId: id });
    return row;
  }

  findAvailableIds(ids: number[], bookingId?: number): Set<number> {
    const available = new Set(ids.filter((id) => this.drivers.get(id)?.available));
    this.log({
      component: "DB",
      text: `SELECT id FROM drivers WHERE id IN (${ids.join(", ")}) AND is_available = true`,
      result: available.size ? [...available].join(", ") : "(no rows)",
      bookingId,
    });
    return available;
  }

  assignDriverIfPending(bookingId: number, driverId: number): number {
    const row = this.bookings.get(bookingId);
    const changed = row && row.status === "PENDING" ? 1 : 0;
    if (row && changed) {
      row.status = "CONFIRMED";
      row.driverId = driverId;
    }
    this.log({
      component: "DB",
      text: `UPDATE bookings SET driver_id = ${driverId}, status = 'CONFIRMED' WHERE id = ${bookingId} AND status = 'PENDING'`,
      result: `${changed} row${changed === 1 ? "" : "s"} updated`,
      level: changed ? "info" : "warn",
      bookingId,
    });
    return changed;
  }

  transitionStatus(bookingId: number, from: BookingStatus, to: BookingStatus): number {
    const row = this.bookings.get(bookingId);
    const changed = row && row.status === from ? 1 : 0;
    if (row && changed) row.status = to;
    this.log({
      component: "DB",
      text: `UPDATE bookings SET status = '${to}' WHERE id = ${bookingId} AND status = '${from}'`,
      result: `${changed} row${changed === 1 ? "" : "s"} updated`,
      bookingId,
    });
    return changed;
  }

  markBusyIfAvailable(driverId: number, bookingId?: number): number {
    const row = this.drivers.get(driverId);
    const changed = row && row.available ? 1 : 0;
    if (row && changed) row.available = false;
    this.log({
      component: "DB",
      text: `UPDATE drivers SET is_available = false WHERE id = ${driverId} AND is_available = true`,
      result: `${changed} row${changed === 1 ? "" : "s"} updated`,
      level: changed ? "info" : "warn",
      bookingId,
    });
    return changed;
  }

  markAvailable(driverId: number, bookingId?: number): void {
    const row = this.drivers.get(driverId);
    if (row) row.available = true;
    this.log({ component: "DB", text: `UPDATE drivers SET is_available = true WHERE id = ${driverId}`, result: "1 row updated", bookingId });
  }
}
