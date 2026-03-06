import { pgTable, text, serial, integer, boolean, timestamp, jsonb, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  displayName: text("display_name"),
  level: integer("level").default(1).notNull(),
  credits: integer("credits").default(0).notNull(),
  experience: integer("experience").default(0).notNull(),
  highestWave: integer("highest_wave").default(0).notNull(),
  totalKills: integer("total_kills").default(0).notNull(),
  hasFlightArmor: boolean("has_flight_armor").default(false).notNull(),
  lastLogin: timestamp("last_login"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const playerProgress = pgTable("player_progress", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  saveData: jsonb("save_data"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const gameSessions = pgTable("game_sessions", {
  id: serial("id").primaryKey(),
  roomCode: varchar("room_code", { length: 8 }).notNull().unique(),
  hostUserId: integer("host_user_id").notNull(),
  maxPlayers: integer("max_players").default(4).notNull(),
  currentPlayers: integer("current_players").default(1).notNull(),
  status: varchar("status", { length: 20 }).default("waiting").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const userSessions = pgTable("user_sessions", {
  sid: text("sid").primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type PlayerProgress = typeof playerProgress.$inferSelect;
export type GameSession = typeof gameSessions.$inferSelect;
