import { pgTable, text, uuid, jsonb, timestamp } from "drizzle-orm/pg-core";

export const routesTable = pgTable("routes", {
  id: uuid("id").primaryKey().defaultRandom(),
  shift: text("shift").notNull(),
  busNumber: text("bus_number").notNull(),
  origin: text("origin").notNull(),
  destination: text("destination").notNull(),
  stops: jsonb("stops").notNull().$type<{ lat: number; lng: number; name?: string }[]>(),
  pathData: jsonb("path_data").$type<{ lat: number; lng: number }[]>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Route = typeof routesTable.$inferSelect;
